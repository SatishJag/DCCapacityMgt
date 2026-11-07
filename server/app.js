import fs from 'node:fs';
import path from 'node:path';
import { ENTITIES, ROLES, READ_ONLY_ROLES, RACK_STATUS, ASSET_STATUS, REDUNDANCY, POWER_TYPES, COOLING_TYPES, COOLING_METHODS, PLANNING_FIELDS } from './schema.js';
import { compute, diffStates, assessImpact, planningHash, rIdx, aIdx, assetCommissioned, RULES } from './engine.js';
import { decode, encodeValue, httpError, getRow, loadState, audit, notify, syncExceptions, tx, now } from './db.js';

const SLUGS = { 'projects': 'projects', 'data-halls': 'data_halls', 'zones': 'zones', 'tiers': 'density_tiers', 'racks': 'racks', 'power-assets': 'power_assets', 'cooling-assets': 'cooling_assets', 'forecasts': 'forecasts' };
const MAX_BODY = 15 * 1024 * 1024;
export const DEFAULT_TIERS = [
  { name: 'Standard density', max_kw: 10, cooling_methods: ['air', 'in_row', 'rdhx', 'hybrid'], liquid: false, description: 'Air-cooled with containment' },
  { name: 'High density', max_kw: 40, cooling_methods: ['in_row', 'rdhx', 'dlc', 'hybrid'], liquid: false, description: 'Enhanced air: in-row or rear-door heat exchanger' },
  { name: 'Liquid-cooled high density', max_kw: 150, cooling_methods: ['dlc', 'immersion', 'hybrid'], liquid: true, description: 'AI/GPU: direct-to-chip or immersion' },
];

// ---------------- helpers ----------------
const json = (res, status, body) => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(s);
};
const csvCell = (v) => { const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(';') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCsv = (rows, cols) => [cols.map((c) => csvCell(c.label || c.key)).join(','), ...rows.map((r) => cols.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n') + '\n';
const sendCsv = (res, name, csv) => { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` }); res.end(csv); };

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(httpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const isAdmin = (u) => u.role === 'admin';
function requireRole(user, roles, what = 'perform this action') {
  if (isAdmin(user) || roles.includes(user.role)) return;
  throw httpError(403, `${ROLES[user.role]} is not permitted to ${what}. Required: ${roles.map((r) => ROLES[r]).join(', ')}.`);
}
function userProjects(user) { try { return user.project_ids ? JSON.parse(user.project_ids) : null; } catch { return null; } }
function requireProject(db, user, projectId) {
  const p = getRow(db, 'projects', projectId);
  if (!p) throw httpError(404, 'Project not found');
  const allowed = userProjects(user);
  if (allowed && !isAdmin(user) && !allowed.includes(p.id)) throw httpError(403, 'You do not have access to this project');
  return p;
}

// ---------------- generic entity CRUD ----------------
function codeScope(table, values) {
  if (table === 'projects') return null;
  if (table === 'racks' || table === 'zones') return ['hall_id', values.hall_id];
  if (table === 'density_tiers') return ['hall_id', values.hall_id, 'name'];
  if (table === 'forecasts') return null;
  return ['project_id', values.project_id];
}

function checkRefs(db, table, row) {
  const ent = ENTITIES[table];
  for (const fd of ent.fields) {
    if (fd.type === 'ref' && row[fd.name] !== null && row[fd.name] !== undefined) {
      const ref = db.prepare(`SELECT * FROM ${fd.ref} WHERE id = ?`).get(row[fd.name]);
      if (!ref || ref.project_id !== row.project_id) throw httpError(400, `${fd.label}: referenced ${ENTITIES[fd.ref].label.toLowerCase()} not found in this project`);
      if (table === 'racks' && (fd.name === 'zone_id' || fd.name === 'tier_id') && ref.hall_id !== row.hall_id) throw httpError(400, `${fd.label} must belong to the rack's data hall`);
      if (table === 'cooling_assets' && fd.name === 'zone_id' && ref.hall_id !== row.hall_id) throw httpError(400, 'Dedicated zone must be in the same data hall');
    }
    if (fd.type === 'multiref') {
      for (const id of (typeof row[fd.name] === 'string' ? JSON.parse(row[fd.name] || '[]') : row[fd.name] || [])) {
        const ref = db.prepare(`SELECT project_id FROM ${fd.ref} WHERE id = ?`).get(id);
        if (!ref || ref.project_id !== row.project_id) throw httpError(400, `${fd.label}: asset ${id} not found in this project`);
      }
    }
  }
  if (table === 'power_assets' && row.parent_id) {
    let cur = row.parent_id, guard = 0;
    while (cur && guard++ < 100) {
      if (cur === row.id) throw httpError(400, 'Upstream asset would create a loop in the power path');
      cur = db.prepare('SELECT parent_id FROM power_assets WHERE id = ?').get(cur)?.parent_id;
    }
  }
  const scope = codeScope(table, row);
  const codeField = scope?.[2] || 'code';
  if (scope && row[codeField]) {
    const dup = db.prepare(`SELECT id FROM ${table} WHERE ${scope[0]} = ? AND ${codeField} = ? AND id != ?`).get(scope[1], row[codeField], row.id ?? -1);
    if (dup) throw httpError(409, `${ENTITIES[table].label} '${row[codeField]}' already exists`);
  }
}

export function createEntity(db, user, table, body, ctx = {}, source = 'ui') {
  const ent = ENTITIES[table];
  requireRole(user, ent.createRoles || ent.writeRoles, `create a ${ent.label.toLowerCase()}`);
  const row = {};
  for (const fd of ent.fields) {
    if (fd.readOnly) { row[fd.name] = encodeValue(fd, fd.default); continue; }
    const v = body[fd.name] !== undefined ? body[fd.name] : fd.default;
    if (fd.required && (v === undefined || v === null || v === '')) throw httpError(400, `${fd.label} is required`);
    row[fd.name] = v === undefined ? null : encodeValue(fd, v);
  }
  if (table !== 'projects') row.project_id = ctx.project_id;
  if (ent.parent === 'data_halls') row.hall_id = ctx.hall_id;
  checkRefs(db, table, row);
  row.created_at = row.updated_at = now(); row.created_by = row.updated_by = user.id;
  const cols = Object.keys(row);
  const r = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c] ?? null));
  const id = Number(r.lastInsertRowid);
  const created = getRow(db, table, id);
  audit(db, { user, action: 'create', entity_type: table, entity_id: id, project_id: table === 'projects' ? id : ctx.project_id, after: created, reason: body._reason, source });
  return created;
}

export function updateEntity(db, user, table, id, body, source = 'ui') {
  const ent = ENTITIES[table];
  const before = getRow(db, table, id);
  if (!before) throw httpError(404, `${ent.label} not found`);
  if (READ_ONLY_ROLES.includes(user.role)) throw httpError(403, `${ROLES[user.role]} has read-only access`);
  const set = {}; const denied = [];
  for (const fd of ent.fields) {
    if (body[fd.name] === undefined || fd.readOnly) continue;
    const v = encodeValue(fd, body[fd.name]);
    let old; try { old = encodeValue(fd, before[fd.name] ?? null); } catch { old = null; }
    if (v === old || (v === null && (old === null || old === undefined))) continue;
    const roles = fd.roles || ent.writeRoles;
    if (!isAdmin(user) && !roles.includes(user.role)) { denied.push(fd.label); continue; }
    set[fd.name] = v;
  }
  if (denied.length) throw httpError(403, `${ROLES[user.role]} cannot change: ${denied.join(', ')}`);
  if (!Object.keys(set).length) return before;
  const merged = { ...before };
  for (const fd of ent.fields) if (fd.type === 'multiselect' || fd.type === 'multiref') merged[fd.name] = JSON.stringify(before[fd.name] || []);
  Object.assign(merged, set);
  checkRefs(db, table, merged);
  set.updated_at = now(); set.updated_by = user.id;
  const cols = Object.keys(set);
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => set[c]), id);
  const after = getRow(db, table, id);
  const b = {}, a = {};
  for (const c of cols) if (!['updated_at', 'updated_by'].includes(c)) { b[c] = before[c]; a[c] = after[c]; }
  audit(db, { user, action: 'update', entity_type: table, entity_id: id, project_id: table === 'projects' ? id : before.project_id, before: b, after: a, reason: body._reason, source });
  return after;
}

export function deleteEntity(db, user, table, id, reason) {
  const ent = ENTITIES[table];
  const before = getRow(db, table, id);
  if (!before) throw httpError(404, `${ent.label} not found`);
  requireRole(user, table === 'projects' ? [] : ent.writeRoles, `delete a ${ent.label.toLowerCase()}`);
  if (table === 'racks' && rIdx(before.status) >= rIdx('installed')) throw httpError(409, 'Installed racks cannot be deleted — decommission them through the commissioning workflow');
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  audit(db, { user, action: 'delete', entity_type: table, entity_id: id, project_id: table === 'projects' ? id : before.project_id, before, reason });
  return before;
}

// ---------------- workflows ----------------
export function createHall(db, user, projectId, body) {
  const hall = createEntity(db, user, 'data_halls', body, { project_id: projectId });
  const sys = { ...user, role: 'admin' }; // default tiers are system-generated
  for (const t of DEFAULT_TIERS) createEntity(db, sys, 'density_tiers', t, { project_id: projectId, hall_id: hall.id }, 'system');
  return hall;
}

export function rackPlan(db, user, hall, body) {
  requireRole(user, ENTITIES.racks.writeRoles, 'create a rack plan');
  const rows = String(body.rows || '').split(/[,\s]+/).filter(Boolean);
  const per = Number(body.racks_per_row);
  if (!rows.length || !(per > 0) || per > 500) throw httpError(400, 'Provide row names and racks per row (1–500)');
  const created = [];
  for (const row of rows) {
    for (let i = 1; i <= per; i++) {
      const code = `${hall.code}-${row}-${String(i).padStart(2, '0')}`;
      created.push(createEntity(db, user, 'racks', {
        code, row, position: i, zone_id: body.zone_id, tier_id: body.tier_id, rack_type: body.rack_type || 'compute',
        planned_kw: body.planned_kw, max_kw: body.max_kw, rack_pdu_kw: body.rack_pdu_kw, feed_a_id: body.feed_a_id, feed_b_id: body.feed_b_id,
        allocation: body.allocation, tenant: body.tenant,
      }, { project_id: hall.project_id, hall_id: hall.id }, 'rack-plan'));
    }
  }
  return created;
}

export function importRacks(db, user, hall, text) {
  requireRole(user, ENTITIES.racks.writeRoles, 'import racks');
  const rows = parseCsv(text);
  if (rows.length < 2) throw httpError(400, 'CSV needs a header row and at least one rack');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  if (!header.includes('code')) throw httpError(400, 'CSV must include a "code" column');
  const zones = new Map(db.prepare('SELECT id, code FROM zones WHERE hall_id = ?').all(hall.id).map((z) => [z.code, z.id]));
  const tiers = new Map(db.prepare('SELECT id, name FROM density_tiers WHERE hall_id = ?').all(hall.id).map((t) => [t.name.toLowerCase(), t.id]));
  const assets = new Map(db.prepare('SELECT id, code FROM power_assets WHERE project_id = ?').all(hall.project_id).map((a) => [a.code, a.id]));
  const results = { created: 0, updated: 0, errors: [] };
  rows.slice(1).forEach((cells, i) => {
    const rec = Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()]));
    const line = i + 2;
    try {
      const body = { ...rec };
      for (const k of Object.keys(body)) if (body[k] === '') delete body[k];
      if (rec.zone !== undefined && rec.zone !== '') { if (!zones.has(rec.zone)) throw new Error(`unknown zone '${rec.zone}'`); body.zone_id = zones.get(rec.zone); }
      if (rec.tier !== undefined && rec.tier !== '') { if (!tiers.has(rec.tier.toLowerCase())) throw new Error(`unknown tier '${rec.tier}'`); body.tier_id = tiers.get(rec.tier.toLowerCase()); }
      for (const [col, f] of [['feed_a', 'feed_a_id'], ['feed_b', 'feed_b_id']]) if (rec[col]) { if (!assets.has(rec[col])) throw new Error(`unknown power asset '${rec[col]}'`); body[f] = assets.get(rec[col]); }
      delete body.status; delete body.actual_kw;
      const existing = db.prepare('SELECT id FROM racks WHERE hall_id = ? AND code = ?').get(hall.id, rec.code);
      db.exec('SAVEPOINT imp');
      try {
        if (existing) { updateEntity(db, user, 'racks', existing.id, body, 'excel-import'); results.updated++; }
        else { createEntity(db, user, 'racks', body, { project_id: hall.project_id, hall_id: hall.id }, 'excel-import'); results.created++; }
        db.exec('RELEASE imp');
      } catch (e) { db.exec('ROLLBACK TO imp'); db.exec('RELEASE imp'); throw e; }
    } catch (e) { results.errors.push({ line, code: rec.code, error: e.message }); }
  });
  audit(db, { user, action: 'import', entity_type: 'racks', project_id: hall.project_id, after: { hall: hall.code, ...results, errors: results.errors.length }, source: 'excel-import' });
  return results;
}

function baselineOf(db, project) {
  return project.baseline_plan_id ? db.prepare('SELECT * FROM plans WHERE id = ?').get(project.baseline_plan_id) : null;
}
const parsePlan = (p, full = false) => p && ({
  ...p,
  snapshot: full ? JSON.parse(p.snapshot || 'null') : undefined,
  validation: JSON.parse(p.validation || '[]'), diff: JSON.parse(p.diff || 'null'), impact: JSON.parse(p.impact || 'null'),
  required_roles: JSON.parse(p.required_roles || '[]'), change_types: JSON.parse(p.change_types || '[]'),
});

export function submitPlan(db, user, projectId, body) {
  requireRole(user, ['planner', 'design_manager', 'project_manager', 'electrical', 'mechanical', 'ict'], 'submit a capacity plan');
  const project = getRow(db, 'projects', projectId);
  const state = loadState(db, projectId);
  const base = baselineOf(db, project);
  const baseState = base ? JSON.parse(base.snapshot) : { project: state.project, halls: [], tiers: [], zones: [], racks: [], power: [], cooling: [] };
  const assessed = assessImpact(baseState, state);
  if (base && assessed.diff.total === 0) throw httpError(400, 'No planning changes since the approved baseline');
  const open = db.prepare("SELECT id FROM plans WHERE project_id = ? AND status = 'submitted'").get(projectId);
  if (open) throw httpError(409, `Plan v${db.prepare('SELECT version FROM plans WHERE id=?').get(open.id).version} is already awaiting review — decide it first`);
  const validation = compute(state).exceptions;
  const version = (db.prepare('SELECT MAX(version) v FROM plans WHERE project_id = ?').get(projectId).v || 0) + 1;
  const kind = base ? 'change_request' : 'baseline';
  const roles = base ? assessed.required_roles : ['design_manager'];
  const r = db.prepare(`INSERT INTO plans (project_id, version, kind, status, title, justification, change_types, snapshot, snapshot_hash, validation, diff, impact, required_roles, base_plan_id, submitted_by, submitted_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(projectId, version, kind, 'submitted', body.title || (base ? `Change request v${version}` : 'Initial capacity baseline'), body.justification || '',
    JSON.stringify(base ? assessed.change_types : ['baseline']), JSON.stringify(state), planningHash(state), JSON.stringify(validation),
    JSON.stringify(assessed.diff), JSON.stringify(assessed.impact), JSON.stringify(roles), base?.id ?? null, user.id, now());
  const planId = Number(r.lastInsertRowid);
  const ins = db.prepare("INSERT INTO plan_reviews (plan_id, role, decision) VALUES (?, ?, 'pending')");
  for (const role of roles) ins.run(planId, role);
  const blocking = validation.filter((e) => e.severity === 'blocking').length;
  notify(db, { project_id: projectId, roles, kind: 'review', message: `${kind === 'baseline' ? 'Baseline' : 'Change request'} v${version} "${body.title || ''}" awaits your review (${blocking} blocking exception(s)).`, ref_type: 'plan', ref_id: planId });
  if (base && assessed.commercial_review) notify(db, { project_id: projectId, roles: ['commercial'], kind: 'alert', alert: 'AL-009', message: `Change request v${version} requires commercial review: ${Math.round(assessed.impact.planned_kw_delta)} kW, ${assessed.impact.racks_delta} racks, cost impact ${assessed.impact.currency} ${Math.round(assessed.impact.cost_delta).toLocaleString('en-GB')}.`, ref_type: 'plan', ref_id: planId });
  audit(db, { user, action: 'submit_plan', entity_type: 'plans', entity_id: planId, project_id: projectId, after: { version, kind, roles, change_types: assessed.change_types, blocking }, reason: body.justification });
  return getPlan(db, planId);
}

export function getPlan(db, id, full = false) {
  const p = parsePlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(id), full);
  if (!p) throw httpError(404, 'Plan not found');
  p.reviews = db.prepare('SELECT pr.*, u.name user_name FROM plan_reviews pr LEFT JOIN users u ON u.id = pr.user_id WHERE plan_id = ? ORDER BY pr.id').all(id);
  p.submitted_by_name = db.prepare('SELECT name FROM users WHERE id = ?').get(p.submitted_by)?.name;
  p.override_by_name = p.override_by ? db.prepare('SELECT name FROM users WHERE id = ?').get(p.override_by)?.name : null;
  return p;
}

export function reviewPlan(db, user, planId, body) {
  const plan = getPlan(db, planId);
  if (plan.status !== 'submitted') throw httpError(409, `Plan is ${plan.status}`);
  const decision = body.decision;
  if (!['approve', 'reject'].includes(decision)) throw httpError(400, 'decision must be approve or reject');
  const role = isAdmin(user) ? null : user.role;
  const review = plan.reviews.find((r) => r.role === role && r.decision === 'pending');
  if (!review) throw httpError(403, `No pending review for ${ROLES[user.role] || user.role} on this plan`);
  if (plan.submitted_by === user.id) throw httpError(403, 'Segregation of duties: the submitter cannot review their own plan');
  if (decision === 'reject' && !(body.comment || '').trim()) throw httpError(400, 'A rejection comment is required');
  const ts = now();
  if (decision === 'approve') {
    const current = loadState(db, plan.project_id);
    if (planningHash(current) !== plan.snapshot_hash) throw httpError(409, 'The working plan has changed since this version was submitted. Reject it and resubmit so reviewers see the actual plan.');
    const blocking = plan.validation.filter((e) => e.severity === 'blocking');
    if (role === 'design_manager' && blocking.length) {
      const just = (body.override_justification || '').trim();
      if (just.length < 20) throw httpError(422, `Approval blocked: ${blocking.length} mandatory infrastructure validation(s) failed (FR-057). Resolve them or provide an override justification of at least 20 characters.`, { blocking });
      db.prepare('UPDATE plans SET override_justification = ?, override_by = ?, override_at = ? WHERE id = ?').run(just, user.id, ts, planId);
      notify(db, { project_id: plan.project_id, roles: ['design_manager', 'project_manager', 'auditor'], kind: 'alert', alert: 'AL-010', message: `Manual override on plan v${plan.version} by ${user.name}: ${blocking.length} blocking exception(s) accepted. Justification: ${just}`, ref_type: 'plan', ref_id: planId });
      audit(db, { user, action: 'override', entity_type: 'plans', entity_id: planId, project_id: plan.project_id, after: { overridden: blocking.map((b) => b.key) }, reason: just });
    }
  }
  db.prepare('UPDATE plan_reviews SET decision = ?, user_id = ?, comment = ?, at = ? WHERE id = ?').run(decision === 'approve' ? 'approved' : 'rejected', user.id, body.comment || null, ts, review.id);
  audit(db, { user, action: `review_${decision}`, entity_type: 'plans', entity_id: planId, project_id: plan.project_id, after: { role: user.role }, reason: body.comment });
  if (decision === 'reject') {
    db.prepare("UPDATE plans SET status = 'rejected', decided_at = ? WHERE id = ?").run(ts, planId);
    notify(db, { project_id: plan.project_id, roles: ['planner', 'design_manager', 'project_manager'], kind: 'review', message: `Plan v${plan.version} rejected by ${ROLES[user.role]}: ${body.comment}`, ref_type: 'plan', ref_id: planId });
  } else {
    const pending = db.prepare("SELECT COUNT(*) c FROM plan_reviews WHERE plan_id = ? AND decision != 'approved'").get(planId).c;
    if (pending === 0) {
      if (plan.base_plan_id) db.prepare("UPDATE plans SET status = 'superseded' WHERE id = ?").run(plan.base_plan_id);
      db.prepare("UPDATE plans SET status = 'approved', decided_at = ? WHERE id = ?").run(ts, planId);
      db.prepare("UPDATE projects SET baseline_plan_id = ? WHERE id = ?").run(planId, plan.project_id);
      audit(db, { user, action: 'baseline_approved', entity_type: 'plans', entity_id: planId, project_id: plan.project_id, after: { version: plan.version } });
      notify(db, { project_id: plan.project_id, roles: ['planner', 'design_manager', 'project_manager', 'electrical', 'mechanical', 'ict', 'commercial'], kind: 'review', message: `Plan v${plan.version} approved — it is now the controlled baseline.`, ref_type: 'plan', ref_id: planId });
    }
  }
  return getPlan(db, planId);
}

// --- commissioning gates (FR-080..086) ---
function zoneGateIssues(zone) {
  const out = [];
  if (!zone) return ['rack has no zone'];
  if (!zone.network_commissioned) out.push(`network not commissioned in zone ${zone.code}`);
  if (!zone.safety_commissioned) out.push(`fire/life-safety not commissioned in zone ${zone.code}`);
  return out;
}

export function updateRackStatus(db, user, body) {
  const ids = (body.rack_ids || []).map(Number);
  const target = body.status;
  if (!ids.length) throw httpError(400, 'rack_ids required');
  if (!RACK_STATUS.includes(target)) throw httpError(400, 'Invalid status');
  const roleFor = { installed: ['commissioning'], commissioned: ['commissioning'], handed_over: ['commissioning'], occupied: ['operations'], decommissioned: ['operations', 'design_manager'], planned: ['commissioning', 'planner'] };
  requireRole(user, roleFor[target], `set racks to ${target}`);
  const evidence = (body.evidence || '').trim();
  const attachment = body.attachment_id ? Number(body.attachment_id) : null;
  if (['commissioned', 'handed_over'].includes(target) && !evidence && !attachment) throw httpError(400, 'Commissioning evidence (reference or attachment) is required (FR-083)');
  const racks = ids.map((id) => getRow(db, 'racks', id));
  if (racks.some((r) => !r)) throw httpError(404, 'Rack not found');
  const projectId = racks[0].project_id;
  if (racks.some((r) => r.project_id !== projectId)) throw httpError(400, 'Racks must belong to one project');
  requireProject(db, user, projectId);
  const state = loadState(db, projectId);
  const powerById = new Map(state.power.map((a) => [a.id, a]));
  const zoneById = new Map(state.zones.map((z) => [z.id, z]));
  const chainIssues = (r) => {
    const issues = [];
    for (const [label, fid] of [['A', r.feed_a_id], ['B', r.feed_b_id]]) {
      let cur = fid, guard = 0;
      while (cur && powerById.has(cur) && guard++ < 50) { const a = powerById.get(cur); if (!assetCommissioned(a)) issues.push(`${label}-feed ${a.type} ${a.code} is ${a.status}`); cur = a.parent_id; }
    }
    if (!r.feed_a_id) issues.push('no A-feed allocated');
    return issues;
  };
  const blocked = [], ok = [];
  for (const r of racks) {
    const from = r.status, reasons = [];
    const fi = rIdx(from), ti = rIdx(target);
    if (target === 'decommissioned') { if (from === 'occupied') reasons.push('vacate the rack before decommissioning'); }
    else if (target === 'handed_over' && from === 'occupied') { /* vacate */ }
    else if (target === 'planned') { if (from !== 'installed') reasons.push('only installed racks can be reverted to planned'); }
    else if (from === 'decommissioned') reasons.push('rack is decommissioned');
    else if (ti !== fi + 1) reasons.push(`cannot move from ${from} to ${target}; next step is ${RACK_FLOW_NEXT(from)}`);
    if (!reasons.length && target === 'commissioned') reasons.push(...chainIssues(r));
    if (!reasons.length && target === 'handed_over' && from !== 'occupied') reasons.push(...chainIssues(r), ...zoneGateIssues(zoneById.get(r.zone_id)));
    if (!reasons.length && target === 'occupied') {
      const actual = body.actual_kw !== undefined && body.actual_kw !== '' ? Number(body.actual_kw) : Number(r.actual_kw);
      if (!(actual > 0)) reasons.push('actual occupied kW must be provided');
      else if (Number(r.max_kw) > 0 && actual > Number(r.max_kw)) reasons.push(`actual ${actual} kW exceeds rack maximum ${r.max_kw} kW`);
      reasons.push(...chainIssues(r), ...zoneGateIssues(zoneById.get(r.zone_id)));
      r._actual = actual;
    }
    (reasons.length ? blocked : ok).push({ rack: r, reasons });
  }
  // Cooling gate: hypothetically commission the passing racks and check commissioned cooling (AL-007).
  if (target === 'commissioned' && ok.length) {
    const okIds = new Set(ok.map((o) => o.rack.id));
    const before = new Set(compute(state).exceptions.filter((e) => e.rule === 'COOL-COMM').map((e) => e.hall_id));
    const hypo = { ...state, racks: state.racks.map((r) => (okIds.has(r.id) ? { ...r, status: 'commissioned' } : r)) };
    const failHalls = new Set(compute(hypo).exceptions.filter((e) => e.rule === 'COOL-COMM' && !before.has(e.hall_id)).map((e) => e.hall_id));
    for (let i = ok.length - 1; i >= 0; i--) if (failHalls.has(ok[i].rack.hall_id)) { ok[i].reasons.push('commissioned cooling capacity insufficient for this release (AL-007)'); blocked.push(ok.splice(i, 1)[0]); }
  }
  const ts = now();
  const hist = db.prepare('INSERT INTO status_history (project_id, entity_type, entity_id, entity_code, from_status, to_status, milestone, evidence, attachment_id, source, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  for (const { rack } of ok) {
    const set = target === 'occupied' ? { status: target, actual_kw: rack._actual } : target === 'handed_over' && rack.status === 'occupied' ? { status: target, actual_kw: 0 } : { status: target };
    db.prepare(`UPDATE racks SET ${Object.keys(set).map((k) => `${k} = ?`).join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).run(...Object.values(set), ts, user.id, rack.id);
    hist.run(projectId, 'rack', rack.id, rack.code, rack.status, target, body.milestone || null, evidence || null, attachment, body.source || 'ui', user.id, ts);
    audit(db, { user, action: 'status', entity_type: 'racks', entity_id: rack.id, project_id: projectId, before: { status: rack.status, actual_kw: rack.actual_kw }, after: set, reason: evidence || body.milestone, source: body.source || 'ui' });
  }
  return { updated: ok.map((o) => ({ id: o.rack.id, code: o.rack.code })), blocked: blocked.map((b) => ({ id: b.rack.id, code: b.rack.code, reasons: b.reasons })), project_id: projectId };
}
const RACK_FLOW_NEXT = (s) => ['planned', 'installed', 'commissioned', 'handed_over', 'occupied'][rIdx(s) + 1] || '—';

export function updateAssetStatus(db, user, body) {
  const kind = body.kind === 'cooling' ? 'cooling_assets' : 'power_assets';
  requireRole(user, ['commissioning', kind === 'power_assets' ? 'electrical' : 'mechanical'], 'update asset commissioning status');
  const target = body.status;
  if (!ASSET_STATUS.includes(target)) throw httpError(400, 'Invalid status');
  const evidence = (body.evidence || '').trim();
  const attachment = body.attachment_id ? Number(body.attachment_id) : null;
  if (aIdx(target) >= aIdx('commissioned') && !evidence && !attachment) throw httpError(400, 'Commissioning evidence (reference or attachment) is required (FR-083)');
  const ok = [], blocked = [];
  const ts = now();
  const ids = (body.ids || []).map(Number);
  if (!ids.length) throw httpError(400, 'ids required');
  let projectId = null;
  for (const id of ids) {
    const a = getRow(db, kind, id);
    if (!a) throw httpError(404, 'Asset not found');
    projectId = a.project_id; requireProject(db, user, projectId);
    const reasons = [];
    if (kind === 'power_assets' && aIdx(target) >= aIdx('commissioned') && a.parent_id) {
      const parent = getRow(db, 'power_assets', a.parent_id);
      if (parent && !assetCommissioned(parent) && !ids.slice(0, ids.indexOf(id)).includes(parent.id)) reasons.push(`upstream ${parent.code} is ${parent.status}`);
    }
    if (reasons.length) { blocked.push({ id, code: a.code, reasons }); continue; }
    db.prepare(`UPDATE ${kind} SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(target, ts, user.id, id);
    db.prepare('INSERT INTO status_history (project_id, entity_type, entity_id, entity_code, from_status, to_status, milestone, evidence, attachment_id, source, user_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(a.project_id, kind === 'power_assets' ? 'power_asset' : 'cooling_asset', id, a.code, a.status, target, body.milestone || null, evidence || null, attachment, 'ui', user.id, ts);
    audit(db, { user, action: 'status', entity_type: kind, entity_id: id, project_id: a.project_id, before: { status: a.status }, after: { status: target }, reason: evidence });
    ok.push({ id, code: a.code });
  }
  return { updated: ok, blocked, project_id: projectId };
}

// ---------------- reporting ----------------
function utilisationRows(db, projectId) {
  const m = compute(loadState(db, projectId));
  const hallCode = new Map(m.halls.map((h) => [h.id, h.code]));
  return [
    ...m.halls.map((h) => ({ level: 'hall', hall: h.code, zone: '', ...h })),
    ...m.zones.map((z) => ({ level: 'zone', hall: hallCode.get(z.hall_id), zone: z.code, ...z })),
  ];
}
const UTIL_COLS = ['level', 'hall', 'zone', 'planned_racks', 'installed_racks', 'commissioned_racks', 'handed_over_racks', 'occupied_racks', 'reserved_racks', 'installed_pct', 'commissioned_pct', 'occupied_pct', 'remaining_racks', 'approved_it_kw', 'planned_kw', 'commissioned_kw', 'occupied_kw', 'available_kw', 'it_util_pct', 'heat_kw', 'cooling_kw', 'cooling_util_pct']
  .map((k) => ({ key: k, get: (r) => (typeof r[k] === 'number' ? Math.round(r[k] * 10) / 10 : r[k]) }));

// ---------------- router ----------------
export function createApp(db, { publicDir, uploadDir, reseed } = {}) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = []; const rx = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, rx, keys, handler });
  };
  const entityProject = (table, id) => { const row = getRow(db, table, id); if (!row) throw httpError(404, `${ENTITIES[table].label} not found`); return row; };
  const afterWrite = (projectId) => { if (projectId) syncExceptions(db, projectId); };

  route('GET', '/api/meta', () => ({ roles: ROLES, entities: ENTITIES, rack_status: RACK_STATUS, asset_status: ASSET_STATUS, redundancy: REDUNDANCY, power_types: POWER_TYPES, cooling_types: COOLING_TYPES, cooling_methods: COOLING_METHODS, rules: RULES, planning_fields: PLANNING_FIELDS }));
  route('GET', '/api/me', ({ user }) => user);
  route('GET', '/api/users', () => db.prepare('SELECT * FROM users WHERE active = 1 ORDER BY id').all());
  route('POST', '/api/users', ({ user, body }) => {
    requireRole(user, [], 'manage users');
    if (!body.name || !ROLES[body.role]) throw httpError(400, 'name and valid role required');
    const r = db.prepare('INSERT INTO users (name, email, role, project_ids) VALUES (?,?,?,?)').run(body.name, body.email || null, body.role, body.project_ids?.length ? JSON.stringify(body.project_ids.map(Number)) : null);
    audit(db, { user, action: 'create', entity_type: 'users', entity_id: Number(r.lastInsertRowid), after: body });
    return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  });
  route('PUT', '/api/users/:id', ({ user, body, params }) => {
    requireRole(user, [], 'manage users');
    const before = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!before) throw httpError(404, 'User not found');
    if (body.role && !ROLES[body.role]) throw httpError(400, 'Invalid role');
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, project_ids = ?, active = ? WHERE id = ?').run(body.name ?? before.name, body.email ?? before.email, body.role ?? before.role,
      body.project_ids !== undefined ? (body.project_ids?.length ? JSON.stringify(body.project_ids.map(Number)) : null) : before.project_ids, body.active === undefined ? before.active : (body.active ? 1 : 0), params.id);
    const after = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    audit(db, { user, action: 'update', entity_type: 'users', entity_id: Number(params.id), before, after });
    return after;
  });

  // Projects
  route('GET', '/api/projects', ({ user }) => {
    const allowed = userProjects(user);
    return db.prepare('SELECT * FROM projects ORDER BY id').all().filter((p) => !allowed || isAdmin(user) || allowed.includes(p.id)).map((p) => {
      const m = compute(loadState(db, p.id));
      return { ...decode('projects', p), summary: m.summary, halls: m.halls.length };
    });
  });
  route('POST', '/api/projects', ({ user, body }) => { const p = createEntity(db, user, 'projects', body); afterWrite(p.id); return p; });
  route('GET', '/api/projects/:id', ({ user, params }) => requireProject(db, user, params.id));
  route('GET', '/api/projects/:id/state', ({ user, params }) => {
    const project = requireProject(db, user, params.id);
    const state = loadState(db, project.id);
    const metrics = compute(state);
    const base = baselineOf(db, project);
    let baseline = null;
    if (base) {
      const baseState = JSON.parse(base.snapshot);
      const diff = diffStates(baseState, state);
      baseline = { id: base.id, version: base.version, decided_at: base.decided_at, changes: diff.total, in_sync: planningHash(state) === base.snapshot_hash };
    }
    const pending = db.prepare("SELECT id, version, kind, title FROM plans WHERE project_id = ? AND status = 'submitted'").all(project.id);
    const forecasts = db.prepare('SELECT * FROM forecasts WHERE project_id = ? ORDER BY period').all(project.id);
    return { ...state, forecasts, metrics, baseline, pending_plans: pending };
  });
  route('PUT', '/api/projects/:id', ({ user, params, body }) => { requireProject(db, user, params.id); const p = updateEntity(db, user, 'projects', Number(params.id), body); afterWrite(p.id); return p; });
  route('DELETE', '/api/projects/:id', ({ user, params }) => { requireProject(db, user, params.id); return deleteEntity(db, user, 'projects', Number(params.id)); });

  // Child creation
  route('POST', '/api/projects/:id/data-halls', ({ user, params, body }) => { requireProject(db, user, params.id); const h = createHall(db, user, Number(params.id), body); afterWrite(h.project_id); return h; });
  for (const [slug, table] of [['power-assets', 'power_assets'], ['cooling-assets', 'cooling_assets'], ['forecasts', 'forecasts']]) {
    route('POST', `/api/projects/:id/${slug}`, ({ user, params, body }) => { requireProject(db, user, params.id); const r = createEntity(db, user, table, body, { project_id: Number(params.id) }); afterWrite(r.project_id); return r; });
  }
  for (const [slug, table] of [['zones', 'zones'], ['tiers', 'density_tiers'], ['racks', 'racks']]) {
    route('POST', `/api/data-halls/:id/${slug}`, ({ user, params, body }) => {
      const hall = entityProject('data_halls', params.id); requireProject(db, user, hall.project_id);
      const r = createEntity(db, user, table, body, { project_id: hall.project_id, hall_id: hall.id }); afterWrite(hall.project_id); return r;
    });
  }
  route('GET', '/api/data-halls/:id', ({ user, params }) => {
    const hall = entityProject('data_halls', params.id); requireProject(db, user, hall.project_id);
    const m = compute(loadState(db, hall.project_id));
    return { ...hall, metrics: m.halls.find((h) => h.id === hall.id), zones: m.zones.filter((z) => z.hall_id === hall.id), exceptions: m.exceptions.filter((e) => e.hall_id === hall.id) };
  });
  route('POST', '/api/data-halls/:id/it-load', ({ user, params, body }) => {
    const hall = entityProject('data_halls', params.id); requireProject(db, user, hall.project_id);
    const allowed = ['approved_it_kw', 'peak_it_kw', 'standard_density_kw', 'load_criticality', 'power_redundancy', 'ups_topology', 'required_ups_autonomy_min', 'required_gen_runtime_h'];
    const r = updateEntity(db, user, 'data_halls', hall.id, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k) || k === '_reason'))); afterWrite(hall.project_id); return r;
  });
  route('POST', '/api/data-halls/:id/rack-plan', ({ user, params, body }) => {
    const hall = entityProject('data_halls', params.id); requireProject(db, user, hall.project_id);
    const created = tx(db, () => rackPlan(db, user, hall, body)); afterWrite(hall.project_id); return { created: created.length };
  });
  route('POST', '/api/data-halls/:id/racks/import', ({ user, params, raw }) => {
    const hall = entityProject('data_halls', params.id); requireProject(db, user, hall.project_id);
    const r = importRacks(db, user, hall, raw); afterWrite(hall.project_id); return r;
  });
  route('POST', '/api/racks/bulk-update', ({ user, body }) => {
    const ids = (body.ids || []).map(Number); if (!ids.length) throw httpError(400, 'ids required');
    let pid = null;
    tx(db, () => { for (const id of ids) { const r = entityProject('racks', id); pid = r.project_id; requireProject(db, user, pid); updateEntity(db, user, 'racks', id, body.values || {}, 'bulk'); } });
    afterWrite(pid); return { updated: ids.length };
  });

  // Generic update / delete
  route('PUT', '/api/:slug/:id', ({ user, params, body }) => {
    const table = SLUGS[params.slug]; if (!table || table === 'projects') throw httpError(404, 'Not found');
    const row = entityProject(table, params.id); requireProject(db, user, row.project_id);
    const r = tx(db, () => updateEntity(db, user, table, row.id, body)); afterWrite(row.project_id); return r;
  });
  route('DELETE', '/api/:slug/:id', ({ user, params, query }) => {
    const table = SLUGS[params.slug]; if (!table || table === 'projects') throw httpError(404, 'Not found');
    const row = entityProject(table, params.id); requireProject(db, user, row.project_id);
    const r = deleteEntity(db, user, table, row.id, query.get('reason')); afterWrite(row.project_id); return r;
  });

  // Validation & exceptions
  route('POST', '/api/projects/:id/validate', ({ user, params }) => { requireProject(db, user, params.id); const m = syncExceptions(db, Number(params.id)); return { summary: m.summary, exceptions: m.exceptions }; });
  route('GET', '/api/projects/:id/exceptions', ({ user, params, query }) => {
    requireProject(db, user, params.id);
    const status = query.get('status') || 'open';
    const rows = db.prepare(`SELECT * FROM exceptions WHERE project_id = ? ${status === 'all' ? '' : 'AND status = ?'} ORDER BY CASE severity WHEN 'blocking' THEN 0 ELSE 1 END, id DESC`).all(...(status === 'all' ? [params.id] : [params.id, status]));
    return rows.map((e) => ({ ...e, recipients: JSON.parse(e.recipients || '[]'), title: RULES[e.rule]?.title, ref: RULES[e.rule]?.ref }));
  });

  // Plans / change control
  route('GET', '/api/projects/:id/plans', ({ user, params }) => { requireProject(db, user, params.id); return db.prepare('SELECT id FROM plans WHERE project_id = ? ORDER BY version DESC').all(params.id).map((p) => getPlan(db, p.id)); });
  route('POST', '/api/projects/:id/plans', ({ user, params, body }) => { requireProject(db, user, params.id); return tx(db, () => submitPlan(db, user, Number(params.id), body)); });
  route('POST', '/api/change-requests', ({ user, body }) => { requireProject(db, user, body.project_id); return tx(db, () => submitPlan(db, user, Number(body.project_id), body)); });
  route('GET', '/api/plans/:id', ({ user, params }) => { const p = getPlan(db, Number(params.id)); requireProject(db, user, p.project_id); return p; });
  route('POST', '/api/plans/:id/review', ({ user, params, body }) => { const p = getPlan(db, Number(params.id)); requireProject(db, user, p.project_id); return tx(db, () => reviewPlan(db, user, Number(params.id), body)); });
  route('POST', '/api/rack-plans/:id/validate', ({ user, params }) => {
    const p = getPlan(db, Number(params.id), true); requireProject(db, user, p.project_id);
    const m = compute(p.snapshot); return { summary: m.summary, exceptions: m.exceptions };
  });
  route('GET', '/api/rack-plans/:id/exceptions', ({ user, params }) => { const p = getPlan(db, Number(params.id)); requireProject(db, user, p.project_id); return p.validation; });
  route('GET', '/api/projects/:id/compare', ({ user, params, query }) => {
    const project = requireProject(db, user, params.id);
    const current = loadState(db, project.id);
    const fromId = query.get('from') ? Number(query.get('from')) : project.baseline_plan_id;
    const toId = query.get('to') ? Number(query.get('to')) : null;
    const getSnap = (id) => { const p = db.prepare('SELECT snapshot, project_id, version FROM plans WHERE id = ?').get(id); if (!p || p.project_id !== project.id) throw httpError(404, 'Plan not found'); return JSON.parse(p.snapshot); };
    const from = fromId ? getSnap(fromId) : { project: current.project, halls: [], tiers: [], zones: [], racks: [], power: [], cooling: [] };
    const to = toId ? getSnap(toId) : current;
    const a = assessImpact(from, to);
    const ma = compute(from), mb = compute(to);
    return { from: fromId, to: toId || 'current', ...a, before: { summary: ma.summary, halls: ma.halls }, after: { summary: mb.summary, halls: mb.halls } };
  });

  // Commissioning
  route('POST', '/api/commissioning/rack-status', ({ user, body }) => { const r = tx(db, () => updateRackStatus(db, user, body)); afterWrite(r.project_id); return r; });
  route('POST', '/api/commissioning/asset-status', ({ user, body }) => { const r = tx(db, () => updateAssetStatus(db, user, body)); afterWrite(r.project_id); return r; });
  route('GET', '/api/projects/:id/history', ({ user, params, query }) => {
    requireProject(db, user, params.id);
    const lim = Math.min(Number(query.get('limit')) || 300, 2000);
    return db.prepare('SELECT h.*, u.name user_name, a.name attachment_name FROM status_history h LEFT JOIN users u ON u.id = h.user_id LEFT JOIN attachments a ON a.id = h.attachment_id WHERE h.project_id = ? ORDER BY h.id DESC LIMIT ?').all(params.id, lim);
  });

  // Attachments (evidence)
  route('POST', '/api/attachments', ({ user, body }) => {
    if (READ_ONLY_ROLES.includes(user.role)) throw httpError(403, 'Read-only role');
    requireProject(db, user, body.project_id);
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length) throw httpError(400, 'Empty file');
    if (buf.length > 10 * 1024 * 1024) throw httpError(413, 'Attachments are limited to 10 MB');
    fs.mkdirSync(uploadDir, { recursive: true });
    const r = db.prepare('INSERT INTO attachments (project_id, name, content_type, size, uploaded_by, at) VALUES (?,?,?,?,?,?)').run(Number(body.project_id), path.basename(String(body.name || 'evidence')).slice(0, 200), String(body.content_type || 'application/octet-stream'), buf.length, user.id, now());
    const id = Number(r.lastInsertRowid);
    const file = path.join(uploadDir, `${id}.bin`);
    fs.writeFileSync(file, buf);
    db.prepare('UPDATE attachments SET path = ? WHERE id = ?').run(file, id);
    audit(db, { user, action: 'upload', entity_type: 'attachments', entity_id: id, project_id: Number(body.project_id), after: { name: body.name, size: buf.length } });
    return { id, name: body.name, size: buf.length };
  });
  route('GET', '/api/attachments/:id', ({ user, params, res }) => {
    const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(params.id);
    if (!a) throw httpError(404, 'Attachment not found');
    requireProject(db, user, a.project_id);
    res.writeHead(200, { 'Content-Type': a.content_type, 'Content-Disposition': `attachment; filename="${a.name.replace(/"/g, '')}"` });
    res.end(fs.readFileSync(a.path));
    return undefined;
  });

  // Notifications
  route('GET', '/api/notifications', ({ user, query }) => {
    const pid = query.get('project_id');
    const rows = db.prepare(`SELECT n.*, (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.id AND r.user_id = ?) is_read FROM notifications n
      WHERE (n.role = ? OR ? = 'admin') ${pid ? 'AND n.project_id = ?' : ''} ORDER BY n.id DESC LIMIT 200`).all(user.id, user.role, user.role, ...(pid ? [pid] : []));
    const seen = new Set();
    const list = rows.filter((n) => { const k = `${n.kind}|${n.ref_type}|${n.ref_id}|${n.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { unread: list.filter((n) => !n.is_read).length, items: list };
  });
  route('POST', '/api/notifications/read', ({ user, body }) => {
    const ids = body.all ? db.prepare("SELECT id FROM notifications WHERE role = ? OR ? = 'admin'").all(user.role, user.role).map((r) => r.id) : (body.ids || []).map(Number);
    const st = db.prepare('INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)');
    for (const id of ids) st.run(id, user.id);
    return { read: ids.length };
  });

  // Audit
  route('GET', '/api/audit', ({ user, query }) => {
    const pid = query.get('project_id'); if (pid) requireProject(db, user, pid);
    else requireRole(user, ['auditor'], 'view the global audit log');
    const lim = Math.min(Number(query.get('limit')) || 300, 5000);
    const et = query.get('entity_type');
    const rows = db.prepare(`SELECT a.*, u.name user_name, u.role user_role FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE 1=1 ${pid ? 'AND a.project_id = ?' : ''} ${et ? 'AND a.entity_type = ?' : ''} ORDER BY a.id DESC LIMIT ?`).all(...[pid, et].filter(Boolean), lim);
    if (query.get('format') === 'csv') return { __csv: toCsv(rows, ['at', 'user_name', 'user_role', 'action', 'entity_type', 'entity_id', 'before', 'after', 'reason', 'source'].map((k) => ({ key: k }))), name: 'audit-log.csv' };
    return rows;
  });

  // Dashboards & reports
  route('GET', '/api/dashboards/capacity-summary', ({ user, query }) => {
    const pid = query.get('project_id');
    if (!pid) {
      const allowed = userProjects(user);
      const projects = db.prepare('SELECT * FROM projects ORDER BY id').all().filter((p) => !allowed || isAdmin(user) || allowed.includes(p.id));
      return projects.map((p) => ({ id: p.id, code: p.code, name: p.name, stage: p.stage, ...compute(loadState(db, p.id)).summary }));
    }
    requireProject(db, user, pid);
    const m = compute(loadState(db, Number(pid)));
    const openEx = db.prepare("SELECT discipline, severity, COUNT(*) c FROM exceptions WHERE project_id = ? AND status = 'open' GROUP BY discipline, severity").all(pid);
    return { summary: m.summary, halls: m.halls, byPhase: m.byPhase, byType: m.byType, byTier: m.byTier, exceptions_by_discipline: openEx };
  });
  route('GET', '/api/reports/utilisation', ({ user, query }) => {
    const pid = query.get('project_id'); requireProject(db, user, pid);
    const rows = utilisationRows(db, Number(pid));
    if (query.get('format') === 'csv') return { __csv: toCsv(rows, UTIL_COLS), name: 'rack-utilisation-report.csv' };
    return rows;
  });
  route('GET', '/api/reports/racks', ({ user, query }) => {
    const pid = query.get('project_id'); requireProject(db, user, pid);
    const s = loadState(db, Number(pid));
    const hall = new Map(s.halls.map((h) => [h.id, h.code])), zone = new Map(s.zones.map((z) => [z.id, z.code])), tier = new Map(s.tiers.map((t) => [t.id, t.name])), pa = new Map(s.power.map((a) => [a.id, a.code]));
    const cols = [{ key: 'hall', get: (r) => hall.get(r.hall_id) }, { key: 'code' }, { key: 'zone', get: (r) => zone.get(r.zone_id) }, { key: 'row' }, { key: 'position' }, { key: 'rack_type' }, { key: 'tier', get: (r) => tier.get(r.tier_id) },
      { key: 'planned_kw' }, { key: 'max_kw' }, { key: 'rack_pdu_kw' }, { key: 'actual_kw' }, { key: 'status' }, { key: 'feed_a', get: (r) => pa.get(r.feed_a_id) }, { key: 'feed_b', get: (r) => pa.get(r.feed_b_id) }, { key: 'allocation' }, { key: 'tenant' }];
    return { __csv: toCsv(s.racks, cols), name: `racks-${s.project.code}.csv` };
  });
  route('POST', '/api/admin/reset-demo', ({ user }) => { requireRole(user, [], 'reset demo data'); reseed?.(); return { ok: true }; });

  // ---------------- request handler ----------------
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(publicDir, url.pathname, res);
      const r = routes.find((x) => x.method === req.method && x.rx.test(url.pathname));
      if (!r) throw httpError(404, 'Not found');
      const m = url.pathname.match(r.rx);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const raw = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : '';
      let body = {};
      if (raw && !(req.headers['content-type'] || '').includes('text/csv')) { try { body = JSON.parse(raw); } catch { throw httpError(400, 'Invalid JSON body'); } }
      let user = null;
      if (url.pathname !== '/api/meta' && !(url.pathname === '/api/users' && req.method === 'GET')) {
        const uid = req.headers['x-user-id'] || url.searchParams.get('as');
        user = uid ? db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(uid)) : null;
        if (!user) throw httpError(401, 'Sign in required (X-User-Id header)');
        if (req.method !== 'GET' && READ_ONLY_ROLES.includes(user.role) && url.pathname !== '/api/notifications/read') throw httpError(403, `${ROLES[user.role]} has read-only access`);
      }
      const out = await r.handler({ req, res, user, params, body, raw, query: url.searchParams });
      if (out === undefined) return;
      if (out && out.__csv !== undefined) return sendCsv(res, out.name, out.__csv);
      json(res, req.method === 'POST' && /\/(projects|data-halls|zones|tiers|racks|power-assets|cooling-assets|forecasts|users)$/.test(url.pathname) ? 201 : 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? 'Internal server error' : e.message, ...(e.extra || {}) });
    }
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.csv': 'text/csv' };
function serveStatic(dir, pathname, res) {
  const safe = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(dir, safe);
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}
