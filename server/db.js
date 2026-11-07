import { DatabaseSync } from 'node:sqlite';
import { ENTITIES, STATE_COLLECTIONS, buildSchemaSql } from './schema.js';
import { compute } from './engine.js';

export const now = () => new Date().toISOString();

export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(buildSchemaSql());
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Convert a raw SQLite row to typed JS (bools, JSON arrays). */
export function decode(table, row) {
  if (!row) return row;
  const ent = ENTITIES[table];
  if (!ent) return row;
  const out = { ...row };
  for (const fd of ent.fields) {
    if (fd.type === 'bool') out[fd.name] = !!row[fd.name];
    else if (fd.type === 'multiselect' || fd.type === 'multiref') {
      try { out[fd.name] = row[fd.name] ? JSON.parse(row[fd.name]) : []; } catch { out[fd.name] = []; }
    }
  }
  return out;
}

/** Coerce an incoming value to the stored representation; throws on invalid input. */
export function encodeValue(fd, v) {
  if (v === undefined) return undefined;
  if (fd.type === 'bool') return v === true || v === 1 || v === 'true' || v === '1' ? 1 : 0;
  if (fd.type === 'multiselect' || fd.type === 'multiref') {
    const arr = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[;,|]/).map((s) => s.trim()).filter(Boolean) : [];
    if (fd.type === 'multiselect' && fd.options) for (const x of arr) if (!fd.options.includes(x)) throw httpError(400, `${fd.label}: '${x}' is not a valid option`);
    return JSON.stringify(fd.type === 'multiref' ? arr.map(Number) : arr);
  }
  if (v === null || v === '') {
    if (fd.required) throw httpError(400, `${fd.label} is required`);
    return fd.type === 'text' || fd.type === 'select' ? (v === '' ? '' : null) : null;
  }
  if (fd.type === 'number' || fd.type === 'int' || fd.type === 'ref') {
    const x = Number(v);
    if (!Number.isFinite(x)) throw httpError(400, `${fd.label} must be a number`);
    if (fd.type !== 'ref' && x < 0) throw httpError(400, `${fd.label} cannot be negative`);
    return fd.type === 'number' ? x : Math.round(x);
  }
  if (fd.type === 'select' && fd.options && !fd.options.includes(String(v))) throw httpError(400, `${fd.label}: '${v}' is not a valid option`);
  return String(v);
}

export function httpError(status, message, extra) {
  const e = new Error(message); e.status = status; if (extra) e.extra = extra; return e;
}

export function getRow(db, table, id) {
  return decode(table, db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id)));
}

export function loadState(db, projectId) {
  const project = getRow(db, 'projects', projectId);
  if (!project) return null;
  const state = { project };
  for (const [key, table] of Object.entries(STATE_COLLECTIONS)) {
    state[key] = db.prepare(`SELECT * FROM ${table} WHERE project_id = ? ORDER BY id`).all(projectId).map((r) => decode(table, r));
  }
  return state;
}

export function audit(db, { user, action, entity_type, entity_id, project_id, before, after, reason, source = 'ui' }) {
  db.prepare(`INSERT INTO audit_log (at, user_id, action, entity_type, entity_id, project_id, before, after, reason, source)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(now(), user?.id ?? null, action, entity_type, entity_id ?? null, project_id ?? null,
    before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after), reason ?? null, source);
}

export function notify(db, { project_id, roles, kind, alert, message, ref_type, ref_id }) {
  const st = db.prepare('INSERT INTO notifications (project_id, role, kind, alert, message, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const role of new Set(roles)) st.run(project_id ?? null, role, kind, alert ?? null, message, ref_type ?? null, ref_id ?? null, now());
}

/** Recompute validation for a project and reconcile the persistent exception register. */
export function syncExceptions(db, projectId) {
  const state = loadState(db, projectId);
  if (!state) return null;
  const result = compute(state);
  const ts = now();
  const existing = new Map(db.prepare('SELECT * FROM exceptions WHERE project_id = ?').all(projectId).map((e) => [e.key, e]));
  const seen = new Set();
  const ins = db.prepare(`INSERT INTO exceptions (project_id, key, rule, alert, severity, discipline, recipients, entity_type, entity_id, hall_id, message, status, first_seen, last_seen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`);
  const upd = db.prepare(`UPDATE exceptions SET message = ?, severity = ?, last_seen = ?, status = 'open', resolved_at = NULL WHERE id = ?`);
  for (const e of result.exceptions) {
    seen.add(e.key);
    const old = existing.get(e.key);
    if (!old) {
      const r = ins.run(projectId, e.key, e.rule, e.alert, e.severity, e.discipline, JSON.stringify(e.recipients), e.entity_type, e.entity_id ?? null, e.hall_id ?? null, e.message, ts, ts);
      notify(db, { project_id: projectId, roles: e.recipients, kind: 'exception', alert: e.alert, message: `${e.title}: ${e.message}`, ref_type: 'exception', ref_id: Number(r.lastInsertRowid) });
    } else {
      const reopened = old.status === 'resolved';
      upd.run(e.message, e.severity, ts, old.id);
      if (reopened) notify(db, { project_id: projectId, roles: e.recipients, kind: 'exception', alert: e.alert, message: `Re-opened — ${e.title}: ${e.message}`, ref_type: 'exception', ref_id: old.id });
    }
  }
  const res = db.prepare(`UPDATE exceptions SET status = 'resolved', resolved_at = ? WHERE id = ?`);
  for (const [key, old] of existing) if (!seen.has(key) && old.status === 'open') res.run(ts, old.id);
  return result;
}
