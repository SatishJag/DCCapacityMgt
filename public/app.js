// DC Capacity Control — single-page client (no build step).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const fmtN = (v, d = 0) => n(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtKw = (v) => (Math.abs(n(v)) >= 1000 ? `${fmtN(n(v) / 1000, 2)} MW` : `${fmtN(v)} kW`);
const fmtPct = (v) => (v === null || v === undefined ? '—' : `${fmtN(v, 1)}%`);
const fmtDate = (s) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const label = (s) => String(s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const S = { meta: null, users: [], user: null, projects: [], pid: null, st: null, notes: { unread: 0, items: [] }, ui: { rackSel: new Set(), floorMode: 'status' } };
const role = () => S.user?.role;
const isAdmin = () => role() === 'admin';
const ROLE = (r) => S.meta?.roles[r] || r;

// ---------------- API ----------------
async function api(method, url, body, { csv = false, raw = false } = {}) {
  const headers = { 'X-User-Id': String(S.user?.id || '') };
  let payload;
  if (body !== undefined) { headers['Content-Type'] = csv ? 'text/csv' : 'application/json'; payload = csv ? body : JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: payload });
  if (raw) { if (!res.ok) throw new Error((await res.json()).error); return res; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || res.statusText); e.data = data; e.status = res.status; throw e; }
  return data;
}
const GET = (u) => api('GET', u);

async function download(url) {
  try {
    const res = await api('GET', url, undefined, { raw: true });
    const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'export.csv';
    const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (e) { toast(e.message, true); }
}

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = `toast show${err ? ' err' : ''}`;
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), err ? 6000 : 3000);
}

async function uploadFile(file) {
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error('Attachments are limited to 10 MB');
  const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = bad; r.readAsDataURL(file); });
  const a = await api('POST', '/api/attachments', { project_id: S.pid, name: file.name, content_type: file.type, data });
  return a.id;
}

// ---------------- state ----------------
const L = {}; // lookups rebuilt after each load
function index() {
  const st = S.st;
  const by = (arr) => new Map(arr.map((x) => [x.id, x]));
  Object.assign(L, {
    hall: by(st.halls), zone: by(st.zones), tier: by(st.tiers), power: by(st.power), cooling: by(st.cooling), rack: by(st.racks),
    mHall: by(st.metrics.halls), mZone: by(st.metrics.zones), mPower: by(st.metrics.power), mCooling: by(st.metrics.cooling),
    flags: st.metrics.rack_flags || {},
  });
}
async function loadProject() {
  if (!S.pid) { S.st = null; return; }
  S.st = await GET(`/api/projects/${S.pid}/state`);
  index();
}
async function loadNotes() { try { S.notes = await GET(`/api/notifications`); } catch { S.notes = { unread: 0, items: [] }; } const b = $('#bell-count'); b.hidden = !S.notes.unread; b.textContent = S.notes.unread > 99 ? '99+' : S.notes.unread; }
async function refresh() { await Promise.all([loadProject(), loadNotes()]); await render(); }

// ---------------- UI atoms ----------------
const STATUS_VAR = { planned: 'planned', installed: 'installed', pre_commissioned: 'installed', commissioned: 'commissioned', integrated_tested: 'handed_over', handed_over: 'handed_over', operational: 'occupied', occupied: 'occupied', decommissioned: 'decommissioned' };
const pill = (s) => `<span class="pill"><span class="dot" style="background:var(--st-${STATUS_VAR[s] || 'planned'})"></span>${esc(label(s))}</span>`;
const sev = (s) => (s === 'blocking' ? '<span class="sev blocking">⛔ Blocking</span>' : s === 'warning' ? '<span class="sev warning">⚠ Warning</span>' : '<span class="sev ok">✓ OK</span>');
function meter(p, txt) {
  if (p === null || p === undefined || Number.isNaN(p)) return '<span class="muted">—</span>';
  const cls = p > 100 ? 'critical' : p >= 95 ? 'serious' : p >= 80 ? 'warning' : 'good';
  const icon = p > 100 ? '⛔ ' : p >= 95 ? '▲ ' : '';
  return `<div class="meter ${cls}" title="${cls === 'good' ? 'Within capacity' : cls === 'warning' ? 'Approaching limit (≥80%)' : cls === 'serious' ? 'Near limit (≥95%)' : 'Over capacity'}"><div class="track"><div class="fill" style="width:${Math.min(100, Math.max(0, p))}%"></div></div><span class="val">${icon}${txt ?? fmtPct(p)}</span></div>`;
}
const kpi = (lbl, val, sub = '') => `<div class="kpi"><div class="label">${esc(lbl)}</div><div class="value">${val}</div><div class="sub">${sub}</div></div>`;
const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
function table(cols, rows, { emptyMsg = 'Nothing to show', select = null, rowAttr = null, cls = '' } = {}) {
  if (!rows.length) return empty(emptyMsg);
  const head = (select ? `<th><input type="checkbox" data-act="sel-all" aria-label="Select all"></th>` : '') + cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.h)}</th>`).join('');
  const body = rows.map((r) => `<tr ${rowAttr ? rowAttr(r) : ''}>${select ? `<td><input type="checkbox" data-sel="${r.id}" ${select.has(r.id) ? 'checked' : ''} aria-label="Select"></td>` : ''}${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.f ? c.f(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap ${cls}"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
const canWrite = (entity) => { const e = S.meta.entities[entity]; return isAdmin() || (e.createRoles || e.writeRoles).includes(role()); };
const canField = (entity, fd) => isAdmin() || (fd.roles || S.meta.entities[entity].writeRoles).includes(role());
const can = (...roles) => isAdmin() || roles.includes(role());
const btn = (act, text, attrs = '', cls = '') => `<button class="btn ${cls}" data-act="${act}" ${attrs}>${text}</button>`;

// ---------------- charts ----------------
function showTip(e, html) { const t = $('#tip'); t.innerHTML = html; t.hidden = false; const x = Math.min(e.clientX + 14, innerWidth - t.offsetWidth - 8); t.style.left = `${x}px`; t.style.top = `${e.clientY + 14}px`; }
function hideTip() { $('#tip').hidden = true; }
document.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(e, el.dataset.tip); else if (!e.target.closest('[data-xhair]')) hideTip(); });

function hbars(items, { unit = fmtKw } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const W = 640, rowH = 30, lw = 120, vw = 90, H = items.length * rowH + 4;
  const bw = W - lw - vw;
  const bars = items.map((it, i) => {
    const w = Math.max(2, (it.value / max) * bw), y = i * rowH + 4;
    return `<g data-tip="${esc(`<strong>${it.label}</strong>${unit(it.value)}${it.note ? ' · ' + it.note : ''}`)}"><rect x="${lw}" y="${y}" width="${bw}" height="${rowH - 6}" fill="transparent"/><text x="${lw - 8}" y="${y + 16}" text-anchor="end">${esc(it.label)}</text>
      <rect x="${lw}" y="${y + 3}" width="${w}" height="${rowH - 12}" rx="4" fill="${it.color || 'var(--accent)'}"/><text x="${lw + w + 6}" y="${y + 16}" style="fill:var(--text)">${esc(unit(it.value))}</text></g>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Capacity funnel">${bars}</svg>`;
}

function lineChart(periods, series, refs = []) {
  const W = 640, H = 240, l = 56, r = 110, t = 12, b = 28;
  const all = [...series.flatMap((s) => s.values), ...refs.map((x) => x.value), 1];
  const max = Math.max(...all) * 1.08;
  const x = (i) => l + (periods.length <= 1 ? 0 : (i * (W - l - r)) / (periods.length - 1));
  const y = (v) => t + (1 - v / max) * (H - t - b);
  const ticks = [0, .25, .5, .75, 1].map((f) => f * max);
  const grid = ticks.map((v) => `<line class="grid-line" x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end">${esc(fmtKw(v))}</text>`).join('');
  const xl = periods.map((p, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p)}</text>`).join('');
  const refL = refs.map((rf) => `<line x1="${l}" x2="${W - r}" y1="${y(rf.value)}" y2="${y(rf.value)}" stroke="var(--text-3)" stroke-dasharray="4 4"/><text x="${W - r + 6}" y="${y(rf.value) + 4}">${esc(rf.label)}</text>`).join('');
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    const last = s.values.length - 1;
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>${s.values.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join('')}<text x="${x(last) + 8}" y="${y(s.values[last]) + 4}" style="fill:var(--text)">${esc(s.name)}</text>`;
  }).join('');
  const hits = periods.map((p, i) => {
    const tip = `<strong>${p}</strong>${series.map((s) => `<div><span class="sw" style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${s.color};margin-right:6px"></span>${s.name}: ${fmtKw(s.values[i])}</div>`).join('')}`;
    const w = periods.length > 1 ? (W - l - r) / (periods.length - 1) : 40;
    return `<rect data-tip="${esc(tip)}" data-xhair x="${x(i) - w / 2}" y="${t}" width="${w}" height="${H - t - b}" fill="transparent"/>`;
  }).join('');
  const legend = `<div class="legend" style="margin-top:6px">${series.map((s) => `<span><span class="sw" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('')}${refs.map((rf) => `<span><span class="sw" style="background:none;border-top:2px dashed var(--text-3);height:0;border-radius:0"></span>${esc(rf.label)}</span>`).join('')}</div>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="IT load forecast">${grid}<line class="axis" x1="${l}" x2="${W - r}" y1="${y(0)}" y2="${y(0)}"/>${refL}${lines}${xl}${hits}</svg>${legend}`;
}

// ---------------- modal & forms ----------------
function modal(title, body, foot, onMount) {
  const d = $('#modal');
  d.innerHTML = `<form method="dialog" id="mform" novalidate><div class="modal-head"><h2 style="margin:0">${esc(title)}</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="Close">✕</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot ?? `<button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" value="ok">Save</button>`}</div></form>`;
  d.showModal();
  onMount?.(d);
  return d;
}
const closeModal = () => $('#modal').close();

function refOptions(entity, fd, values, ctx) {
  const hallId = Number(values.hall_id ?? ctx.hall_id) || null;
  const st = S.st;
  if (fd.ref === 'data_halls') return st.halls.map((h) => [h.id, `${h.code} — ${h.name}`]);
  if (fd.ref === 'zones') return st.zones.filter((z) => !hallId || z.hall_id === hallId).map((z) => [z.id, `${z.code}${z.name ? ' — ' + z.name : ''}`]);
  if (fd.ref === 'density_tiers') return st.tiers.filter((t) => !hallId || t.hall_id === hallId).map((t) => [t.id, `${t.name} (≤ ${t.max_kw} kW)`]);
  if (fd.ref === 'power_assets') {
    let list = st.power.filter((a) => a.id !== values.id);
    if (entity === 'racks') list = list.filter((a) => ['PDU', 'RPP', 'BUSWAY', 'RACK_PDU', 'UPS'].includes(a.type) && (!a.hall_id || !hallId || a.hall_id === hallId));
    return list.map((a) => [a.id, `${a.code} (${a.type})`]);
  }
  return [];
}

function fieldHtml(entity, fd, values, ctx, mode) {
  const v = values[fd.name] ?? (mode === 'create' ? fd.default : undefined);
  const locked = mode === 'edit' && !canField(entity, fd);
  const dis = locked ? 'disabled' : '';
  const req = fd.required ? ' *' : '';
  const help = fd.help ? `<span class="help">${esc(fd.help)}</span>` : '';
  const nm = `name="${fd.name}" data-type="${fd.type}"`;
  if (fd.type === 'bool') return `<label class="field check ${locked ? 'locked' : ''}"><input type="checkbox" ${nm} ${v ? 'checked' : ''} ${dis}> ${esc(fd.label)}</label>`;
  let input;
  if (fd.type === 'select') input = `<select ${nm} ${dis}>${fd.options.map((o) => `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(label(o))}</option>`).join('')}</select>`;
  else if (fd.type === 'multiselect') input = `<select multiple ${nm} ${dis}>${fd.options.map((o) => `<option value="${esc(o)}" ${(v || []).includes(o) ? 'selected' : ''}>${esc(label(o))}</option>`).join('')}</select>`;
  else if (fd.type === 'ref') input = `<select ${nm} ${dis}><option value="">—</option>${refOptions(entity, fd, values, ctx).map(([id, t]) => `<option value="${id}" ${Number(v) === id ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else if (fd.type === 'multiref') input = `<select multiple ${nm} ${dis}>${refOptions(entity, fd, values, ctx).map(([id, t]) => `<option value="${id}" ${(v || []).includes(id) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  else input = `<input ${nm} type="${['number', 'int'].includes(fd.type) ? 'number' : 'text'}" ${fd.type === 'number' ? 'step="any"' : ''} ${['number', 'int'].includes(fd.type) ? 'min="0"' : ''} value="${esc(v ?? '')}" ${fd.required ? 'required' : ''} ${dis}>`;
  return `<label class="field ${locked ? 'locked' : ''}">${esc(fd.label)}${req}${input}${help}</label>`;
}

function readForm(form) {
  const out = {};
  for (const el of $$('[name]', form)) {
    if (el.disabled || !el.dataset.type) continue;
    const t = el.dataset.type;
    if (t === 'bool') out[el.name] = el.checked;
    else if (t === 'multiselect') out[el.name] = [...el.selectedOptions].map((o) => o.value);
    else if (t === 'multiref') out[el.name] = [...el.selectedOptions].map((o) => Number(o.value));
    else if (['number', 'int', 'ref'].includes(t)) out[el.name] = el.value === '' ? null : Number(el.value);
    else out[el.name] = el.value;
  }
  return out;
}

function entityForm({ entity, title, values = {}, ctx = {}, mode = 'edit', submit, extraFoot = '', omit = [] }) {
  const ent = S.meta.entities[entity];
  const fields = ent.fields.filter((f) => !f.readOnly && !omit.includes(f.name));
  const groups = new Map();
  for (const fd of fields) { const g = fd.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(fd); }
  const body = [...groups.entries()].map(([g, fds]) => {
    const inner = `<div class="form-grid">${fds.map((fd) => fieldHtml(entity, fd, values, ctx, mode)).join('')}</div>`;
    return g ? `<fieldset><legend>${esc(g)}</legend>${inner}</fieldset>` : inner;
  }).join('') + (mode === 'edit' ? `<label class="field" style="margin-top:4px">Reason for change (audit trail)<input name="_reason" data-type="text" placeholder="Optional — recorded in the audit log"></label>` : '');
  const foot = `${extraFoot}<span style="flex:1"></span><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" value="ok">${mode === 'create' ? 'Create' : 'Save changes'}</button>`;
  modal(title, body, foot, (d) => {
    const form = $('#mform', d);
    // keep zone/tier choices consistent with the chosen hall
    form.addEventListener('change', (e) => {
      if (e.target.name === 'hall_id') {
        for (const sel of $$('select[name=zone_id], select[name=tier_id]', form)) {
          const fd = ent.fields.find((f) => f.name === sel.name);
          sel.innerHTML = `<option value="">—</option>` + refOptions(entity, fd, { ...values, hall_id: e.target.value }, ctx).map(([id, t]) => `<option value="${id}">${esc(t)}</option>`).join('');
        }
      }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = readForm(form);
      const missing = fields.filter((f) => f.required && (data[f.name] === '' || data[f.name] === null) && !(mode === 'edit' && !canField(entity, f)));
      if (missing.length) return toast(`${missing.map((f) => f.label).join(', ')} required`, true);
      try { await submit(data); closeModal(); toast('Saved'); await refresh(); } catch (err) { toast(err.message, true); }
    });
  });
}

const SLUG = { data_halls: 'data-halls', zones: 'zones', density_tiers: 'tiers', racks: 'racks', power_assets: 'power-assets', cooling_assets: 'cooling-assets', forecasts: 'forecasts' };
function editEntity(entity, id) {
  const coll = { data_halls: 'halls', zones: 'zones', density_tiers: 'tiers', racks: 'racks', power_assets: 'power', cooling_assets: 'cooling' }[entity];
  const row = entity === 'forecasts' ? S.st.forecasts.find((f) => f.id === id) : L[{ halls: 'hall', zones: 'zone', tiers: 'tier', racks: 'rack', power: 'power', cooling: 'cooling' }[coll]].get(id);
  const del = canWrite(entity) ? `<button type="button" class="btn danger" data-act="delete" data-entity="${entity}" data-id="${id}">Delete</button>` : '';
  entityForm({ entity, title: `Edit ${S.meta.entities[entity].label.toLowerCase()} ${row.code || row.name || row.period || ''}`, values: row, ctx: { hall_id: row.hall_id }, submit: (d) => api('PUT', `/api/${SLUG[entity]}/${id}`, d), extraFoot: del });
}
function createEntityForm(entity, ctx = {}, preset = {}) {
  const parent = S.meta.entities[entity].parent;
  const url = parent === 'data_halls' ? `/api/data-halls/${ctx.hall_id}/${SLUG[entity]}` : `/api/projects/${S.pid}/${SLUG[entity]}`;
  entityForm({ entity, title: `New ${S.meta.entities[entity].label.toLowerCase()}`, values: preset, ctx, mode: 'create', submit: (d) => api('POST', url, d) });
}

// ---------------- navigation ----------------
const NAV = [
  ['dashboard', '📊', 'Dashboards'], ['halls', '🏢', 'Data halls'], ['racks', '🗄️', 'Racks'], ['power', '⚡', 'Power'], ['cooling', '❄️', 'Cooling'],
  ['exceptions', '⛔', 'Exceptions'], ['plans', '📝', 'Plans & changes'], ['commissioning', '✅', 'Commissioning'], ['project', '📅', 'Project & phasing'], ['audit', '🧾', 'Audit trail'],
  ['-', '', 'Portfolio'], ['portfolio', '🌍', 'All projects'], ['admin', '👥', 'Users & roles'],
];
function renderNav(route) {
  const blocking = S.st?.metrics.summary.blocking || 0;
  const pending = S.st?.pending_plans.length || 0;
  $('#sidenav').innerHTML = NAV.map(([k, ic, t]) => (k === '-' ? `<div class="sep">${t}</div>` : (k === 'admin' && !isAdmin()) ? '' :
    `<a href="#/${k}" class="${route === k ? 'active' : ''}"><span aria-hidden="true">${ic}</span>${t}${k === 'exceptions' && blocking ? `<span class="count">${blocking}</span>` : ''}${k === 'plans' && pending ? `<span class="count" style="background:var(--accent)">${pending}</span>` : ''}</a>`)).join('');
}
function renderTop() {
  $('#project-select').innerHTML = S.projects.map((p) => `<option value="${p.id}" ${p.id === S.pid ? 'selected' : ''}>${esc(p.code)} — ${esc(p.name)}</option>`).join('');
  $('#user-select').innerHTML = S.users.map((u) => `<option value="${u.id}" ${u.id === S.user.id ? 'selected' : ''}>${esc(u.name)} · ${esc(ROLE(u.role))}</option>`).join('');
}

async function render() {
  const [route = 'dashboard', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  renderNav(route); renderTop();
  const main = $('#main');
  if (!S.st && !['portfolio', 'admin'].includes(route)) { main.innerHTML = `<div class="card">${empty('No project yet.')}<div class="actions" style="justify-content:center">${can('project_manager') ? btn('new-project', '+ New project', '', 'primary') : ''}</div></div>`; return; }
  try {
    const view = VIEWS[route] || VIEWS.dashboard;
    main.innerHTML = await view(rest);
  } catch (e) { main.innerHTML = `<div class="card">${empty('Could not load this view: ' + e.message)}</div>`; }
}

// ---------------- views ----------------
const VIEWS = {};

function pageHead(title, desc, actions = '') {
  const p = S.st?.project;
  return `<div class="page-head"><div><small>${p ? esc(p.code) + ' · ' + esc(label(p.stage)) : ''}</small><h1>${esc(title)}</h1>${desc ? `<p>${desc}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
}
function baselineNotice() {
  const b = S.st.baseline;
  if (!b) return `<div class="notice warn"><span>⚠ No approved capacity baseline yet. Submit the plan for Design Manager approval.</span><a class="btn small" href="#/plans">Plans &amp; changes</a></div>`;
  if (b.in_sync) return '';
  return `<div class="notice warn"><span>⚠ The working plan has <strong>${b.changes}</strong> change(s) since approved baseline v${b.version}. Changes after baseline approval require a change request (FR-087).</span><a class="btn small" href="#/plans">Review &amp; submit change request</a></div>`;
}

VIEWS.dashboard = async ([tab = 'executive']) => {
  const tabs = [['executive', 'Executive'], ['design', 'Design Manager'], ['electrical', 'Electrical'], ['mechanical', 'Mechanical'], ['operations', 'Operations']];
  const body = await DASH[tab]();
  return pageHead('Capacity dashboards', 'IT load, rack utilisation and infrastructure headroom validated against the approved power, cooling, cabling and space design.',
    `${btn('export-util', '⬇ Utilisation report (CSV)')}`) + baselineNotice() +
    `<nav class="tabs">${tabs.map(([k, t]) => `<a href="#/dashboard/${k}" class="${k === tab ? 'active' : ''}">${t}</a>`).join('')}</nav>` + body;
};

const exRows = (list) => table([
  { h: 'Severity', f: (e) => sev(e.severity) }, { h: 'Alert', f: (e) => `<span class="code">${esc(e.alert || '—')}</span>` }, { h: 'Rule', f: (e) => `<span class="code" title="${esc(e.ref || '')}">${esc(e.rule)}</span>` },
  { h: 'Finding', f: (e) => `<strong>${esc(e.title || '')}</strong><br><span class="muted">${esc(e.message)}</span>` }, { h: 'Routed to', f: (e) => esc((e.recipients || []).map(ROLE).join(', ')) },
], list, { emptyMsg: 'No exceptions — plan is within infrastructure design limits.', cls: 'short' });

const DASH = {
  async executive() {
    const s = S.st.metrics.summary, m = S.st.metrics;
    const kp = `<div class="kpis">
      ${kpi('Approved IT load', fmtKw(s.approved_it_kw), `Target ${fmtKw(s.target_it_kw)} · Ultimate ${fmtKw(s.ultimate_it_kw)}`)}
      ${kpi('Planned IT load', fmtKw(s.planned_kw), `${fmtN(s.planned_racks)} racks · avg ${fmtN(s.avg_density_kw, 1)} kW/rack`)}
      ${kpi('Commissioned IT load', fmtKw(s.commissioned_kw), `${fmtN(s.commissioned_racks)} racks (${fmtPct(s.commissioned_pct)} of planned)`)}
      ${kpi('Occupied IT load', fmtKw(s.occupied_kw), `IT utilisation ${fmtPct(s.it_util_pct)} of approved`)}
      ${kpi('Available IT load', fmtKw(s.available_kw), `Commissioned headroom ${fmtKw(s.commissioned_available_kw)}`)}
      ${kpi('Occupied racks', `${fmtN(s.occupied_racks)} / ${fmtN(s.commissioned_racks)}`, `${fmtPct(s.occupied_pct)} of commissioned · ${fmtN(s.remaining_racks)} free`)}
      ${kpi('Open exceptions', `${s.blocking ? '⛔ ' : ''}${fmtN(s.blocking)}`, `blocking · ${fmtN(s.warnings)} warning(s)`)}
    </div>`;
    const funnel = hbars([
      { label: 'Approved', value: s.approved_it_kw }, { label: 'Planned', value: s.planned_kw, note: `${s.planned_racks} racks` },
      { label: 'Installed', value: s.installed_kw, note: `${s.installed_racks} racks` }, { label: 'Commissioned', value: s.commissioned_kw, note: `${s.commissioned_racks} racks` },
      { label: 'Handed over', value: s.handed_over_kw, note: `${s.handed_over_racks} racks` }, { label: 'Occupied (actual)', value: s.occupied_kw, note: `${s.occupied_racks} racks` },
    ]);
    const halls = table([
      { h: 'Hall', f: (h) => `<a href="#/halls/${h.id}"><strong>${esc(h.code)}</strong></a> <span class="muted">${esc(h.name)}</span>` }, { h: 'Phase', f: (h) => esc(label(h.phase)) },
      { h: 'Approved', num: true, f: (h) => fmtKw(h.approved_it_kw) }, { h: 'Planned', num: true, f: (h) => fmtKw(h.planned_kw) },
      { h: 'Commissioned', num: true, f: (h) => fmtKw(h.commissioned_kw) }, { h: 'Occupied', num: true, f: (h) => fmtKw(h.occupied_kw) },
      { h: 'Planned vs approved', f: (h) => meter(h.planned_vs_approved_pct) }, { h: 'Rack occupancy', f: (h) => meter(h.occupied_pct, h.commissioned_racks ? `${h.occupied_racks}/${h.commissioned_racks}` : '—') },
      { h: 'Cooling load', f: (h) => meter(h.cooling_util_pct) },
      { h: 'Exceptions', num: true, f: (h) => { const c = m.exceptions.filter((e) => e.hall_id === h.id && e.severity === 'blocking').length; return c ? `<span class="sev blocking">⛔ ${c}</span>` : '<span class="sev ok">✓</span>'; } },
    ], m.halls);
    const fc = S.st.forecasts;
    const forecast = fc.length ? lineChart(fc.map((f) => f.period), [{ name: 'Forecast', color: 'var(--series-1)', values: fc.map((f) => n(f.forecast_kw)) }, { name: 'Committed', color: 'var(--series-2)', values: fc.map((f) => n(f.committed_kw)) }], [{ label: 'Approved', value: s.approved_it_kw }, { label: 'Commissioned', value: s.commissioned_kw }]) : empty('No forecast entered — add periods under Project & phasing.');
    const phase = table([{ h: 'Phase', f: (p) => esc(label(p.key)) }, { h: 'Approved', num: true, f: (p) => fmtKw(p.approved_it_kw) }, { h: 'Planned', num: true, f: (p) => fmtKw(p.planned_kw) }, { h: 'Commissioned', num: true, f: (p) => fmtKw(p.commissioned_kw) }, { h: 'Occupied', num: true, f: (p) => fmtKw(p.occupied_kw) }, { h: 'Racks', num: true, f: (p) => fmtN(p.planned_racks) }], m.byPhase);
    const risks = m.exceptions.filter((e) => e.severity === 'blocking');
    return kp + `<div class="grid cols-2"><div class="card"><h2>Capacity lifecycle</h2>${funnel}</div><div class="card"><h2>IT load forecast vs capacity</h2>${forecast}</div></div>
      <div class="card"><div class="card-head"><h2>Utilisation by data hall</h2></div>${halls}</div>
      <div class="grid cols-2"><div class="card"><h2>Capacity by phase</h2>${phase}</div><div class="card"><div class="card-head"><h2>Capacity risk summary</h2><a href="#/exceptions">All exceptions →</a></div>${exRows(risks.slice(0, 8))}</div></div>`;
  },
  async design() {
    const m = S.st.metrics, s = m.summary;
    const plans = S.st.pending_plans;
    const byDisc = {};
    for (const e of m.exceptions) { byDisc[e.discipline] ||= { blocking: 0, warning: 0 }; byDisc[e.discipline][e.severity]++; }
    const dens = m.zones.map((z) => {
      const rs = S.st.racks.filter((r) => r.zone_id === z.id && r.status !== 'decommissioned');
      const zone = L.zone.get(z.id);
      const maxKw = Math.max(0, ...rs.map((r) => n(r.planned_kw)));
      return { ...z, design: n(zone.design_density_kw), max: maxKw, var: zone.design_density_kw ? ((z.avg_density_kw - zone.design_density_kw) / zone.design_density_kw) * 100 : null, hall: L.hall.get(z.hall_id)?.code };
    });
    return `<div class="kpis">${kpi('Blocking exceptions', fmtN(s.blocking), 'prevent baseline approval')}${kpi('Warnings', fmtN(s.warnings))}${kpi('Baseline', S.st.baseline ? `v${S.st.baseline.version}` : '—', S.st.baseline ? (S.st.baseline.in_sync ? 'Working plan in sync' : `${S.st.baseline.changes} change(s) pending`) : 'not approved')}${kpi('Awaiting review', fmtN(plans.length), plans.map((p) => `v${p.version}`).join(', '))}${kpi('High-density racks', fmtN(S.st.racks.filter((r) => n(r.planned_kw) > n(L.hall.get(r.hall_id)?.standard_density_kw)).length), 'above hall standard density')}</div>
      <div class="grid cols-2"><div class="card"><h2>Rack density variance by zone</h2>${table([{ h: 'Zone', f: (z) => `${esc(z.hall)} / <strong>${esc(z.code)}</strong>` }, { h: 'Cooling', f: (z) => esc(label(z.cooling_method)) }, { h: 'Design kW/rack', num: true, f: (z) => fmtN(z.design, 1) }, { h: 'Avg planned', num: true, f: (z) => fmtN(z.avg_density_kw, 1) }, { h: 'Max planned', num: true, f: (z) => fmtN(z.max, 1) }, { h: 'Variance', num: true, f: (z) => (z.var === null ? '—' : `${z.var > 0.05 ? '▲ ' : ''}${fmtN(z.var, 1)}%`) }], dens)}</div>
      <div class="card"><h2>Exceptions by discipline</h2>${table([{ h: 'Discipline', f: (r) => esc(label(r.k)) }, { h: 'Blocking', num: true, f: (r) => (r.blocking ? `<span class="sev blocking">⛔ ${r.blocking}</span>` : '0') }, { h: 'Warnings', num: true, f: (r) => (r.warning ? `<span class="sev warning">⚠ ${r.warning}</span>` : '0') }], Object.entries(byDisc).map(([k, v]) => ({ k, ...v })), { emptyMsg: 'No open exceptions' })}
      <h3 style="margin-top:16px">Change requests awaiting review</h3>${plans.length ? `<ul>${plans.map((p) => `<li><a href="#/plans/${p.id}">v${p.version} — ${esc(p.title)}</a></li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</div></div>
      <div class="card"><div class="card-head"><h2>Power, cooling &amp; cabling breaches</h2><a href="#/plans">Baseline vs current →</a></div>${exRows(m.exceptions.filter((e) => ['electrical', 'mechanical', 'ict', 'design', 'space'].includes(e.discipline)))}</div>`;
  },
  async electrical() {
    const m = S.st.metrics;
    const ups = m.power.filter((a) => a.type === 'UPS'), gens = m.power.filter((a) => a.type === 'GENERATOR');
    const worstUps = Math.max(0, ...ups.map((u) => n(u.util_pct)));
    const ab = table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Required', f: (h) => esc(h.power_redundancy) }, { h: 'A-feed connected', num: true, f: (h) => fmtKw(h.feed_a_kw) }, { h: 'B-feed connected', num: true, f: (h) => fmtKw(h.feed_b_kw) }, { h: 'Balance', f: (h) => { const t = h.feed_a_kw + h.feed_b_kw; return t ? `${fmtN((h.feed_a_kw / t) * 100)} / ${fmtN((h.feed_b_kw / t) * 100)}` : '—'; } }, { h: 'Racks without dual feed', num: true, f: (h) => fmtN(S.st.racks.filter((r) => r.hall_id === h.id && (!r.feed_a_id || !r.feed_b_id)).length) }], m.halls);
    return `<div class="kpis">${kpi('Peak UPS utilisation', fmtPct(worstUps), 'failover load / usable')}${kpi('Generator load', gens.length ? fmtPct(gens[0].util_pct) : '—', gens.length ? `${fmtKw(gens[0].load_kw)} of ${fmtKw(gens[0].usable_kw)}` : '')}${kpi('Distribution breaches', fmtN(m.exceptions.filter((e) => e.rule === 'PWR-ASSET').length), 'PDU / busway / UPS')}${kpi('Redundancy issues', fmtN(m.exceptions.filter((e) => ['PWR-RED', 'PWR-SPOF', 'PWR-AUTONOMY'].includes(e.rule)).length), 'SPOF, redundancy, autonomy')}</div>
      <div class="card"><div class="card-head"><h2>Power chain utilisation</h2><a href="#/power">Manage power assets →</a></div>${powerTree(false)}</div>
      <div class="grid cols-2"><div class="card"><h2>A-feed / B-feed allocation</h2>${ab}</div><div class="card"><h2>Electrical exceptions</h2>${exRows(m.exceptions.filter((e) => e.discipline === 'electrical'))}</div></div>`;
  },
  async mechanical() {
    const m = S.st.metrics;
    const hallT = table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Heat load', num: true, f: (h) => fmtKw(h.heat_kw) }, { h: 'Usable cooling', num: true, f: (h) => fmtKw(h.cooling_kw) }, { h: 'Cooling utilisation', f: (h) => meter(h.cooling_util_pct) }, { h: 'Commissioned cooling', num: true, f: (h) => fmtKw(h.cooling_commissioned_kw) }, { h: 'Required', f: (h) => esc(h.cooling_redundancy) }], m.halls);
    return `<div class="kpis">${kpi('Total heat load', fmtKw(m.summary.heat_kw), `heat factor ${S.st.project.heat_factor}`)}${kpi('Usable cooling', fmtKw(m.summary.cooling_kw), 'after redundancy & derating')}${kpi('High-density zones', fmtN(m.zones.filter((z) => z.avg_density_kw > 15).length), '> 15 kW/rack average')}${kpi('Liquid readiness gaps', fmtN(m.exceptions.filter((e) => e.rule === 'COOL-LIQ').length), 'zones needing approval')}</div>
      <div class="card"><h2>Heat load by data hall</h2>${hallT}</div>
      <div class="card"><div class="card-head"><h2>Zone cooling &amp; containment</h2><a href="#/cooling">Manage cooling →</a></div>${zoneCoolingTable()}</div>
      <div class="card"><h2>Mechanical exceptions</h2>${exRows(m.exceptions.filter((e) => e.discipline === 'mechanical'))}</div>`;
  },
  async operations() {
    const m = S.st.metrics, s = m.summary;
    const t = table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Commissioned racks', num: true, f: (h) => fmtN(h.commissioned_racks) }, { h: 'Handed over', num: true, f: (h) => fmtN(h.handed_over_racks) }, { h: 'Occupied', num: true, f: (h) => fmtN(h.occupied_racks) }, { h: 'Available racks', num: true, f: (h) => fmtN(h.remaining_racks) }, { h: 'Occupied kW', num: true, f: (h) => fmtKw(h.occupied_kw) }, { h: 'Commissioned headroom', num: true, f: (h) => fmtKw(h.commissioned_available_kw) }, { h: 'Occupied vs commissioned', f: (h) => meter(h.commissioned_kw ? (h.occupied_kw / h.commissioned_kw) * 100 : null) }, { h: 'Reserved (idle)', num: true, f: (h) => fmtKw(h.reserved_idle_kw) }, { h: 'Sold', num: true, f: (h) => fmtKw(h.sold_kw) }], m.halls);
    const str = table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Power capacity', num: true, f: (h) => fmtKw(h.power_capacity_kw) }, { h: 'Cooling capacity (IT kW)', num: true, f: (h) => fmtKw(h.cooling_capacity_it_kw) }, { h: 'Space capacity', num: true, f: (h) => fmtKw(h.space_capacity_kw) }, { h: 'Deliverable', num: true, f: (h) => `<strong>${fmtKw(h.deliverable_kw)}</strong>` }, { h: 'Stranded power', num: true, f: (h) => fmtKw(h.stranded.power_kw) }, { h: 'Stranded cooling', num: true, f: (h) => fmtKw(h.stranded.cooling_kw) }, { h: 'Stranded space', num: true, f: (h) => fmtKw(h.stranded.space_kw) }], m.halls);
    const ho = table([{ h: 'Zone', f: (z) => `${esc(L.hall.get(z.hall_id)?.code)} / <strong>${esc(z.code)}</strong>` }, { h: 'Commissioned', num: true, f: (z) => fmtN(z.commissioned_racks) }, { h: 'Handed over', num: true, f: (z) => fmtN(z.handed_over_racks) }, { h: 'Occupied', num: true, f: (z) => fmtN(z.occupied_racks) }, { h: 'Network', f: (z) => (z.network_commissioned ? '<span class="sev ok">✓ Ready</span>' : '<span class="sev warning">⚠ Pending</span>') }, { h: 'Life safety', f: (z) => (z.safety_commissioned ? '<span class="sev ok">✓ Ready</span>' : '<span class="sev warning">⚠ Pending</span>') }], m.zones);
    return `<div class="kpis">${kpi('Occupied racks', fmtN(s.occupied_racks), `${fmtPct(s.occupied_pct)} of commissioned`)}${kpi('Available racks', fmtN(s.remaining_racks), 'commissioned, not occupied')}${kpi('Occupied IT load', fmtKw(s.occupied_kw))}${kpi('Available IT load', fmtKw(s.available_kw), `of ${fmtKw(s.approved_it_kw)} approved`)}${kpi('Reserved idle', fmtKw(s.reserved_idle_kw), `${fmtN(s.reserved_racks)} reserved racks`)}</div>
      <div class="card"><h2>Commissioned vs occupied capacity</h2>${t}</div>
      <div class="grid cols-2"><div class="card"><h2>Stranded capacity</h2><p class="muted" style="margin-top:-6px">Deliverable IT load is the lowest of power, cooling and space capacity; the rest is stranded (FR-027).</p>${str}</div><div class="card"><h2>Handover status</h2>${ho}</div></div>`;
  },
};

function zoneCoolingTable() {
  const m = S.st.metrics;
  const items = ['lc_cdu', 'lc_pipework', 'lc_leak_detection', 'lc_clearance', 'lc_ops_approval'];
  return table([
    { h: 'Zone', f: (z) => `${esc(L.hall.get(z.hall_id)?.code)} / <strong>${esc(z.code)}</strong>` }, { h: 'Method', f: (z) => esc(label(z.cooling_method)) },
    { h: 'Containment', f: (z) => esc(label(L.zone.get(z.id)?.containment)) }, { h: 'Avg kW/rack', num: true, f: (z) => fmtN(z.avg_density_kw, 1) },
    { h: 'Heat', num: true, f: (z) => fmtKw(z.heat_kw) }, { h: 'Cooling allotted', num: true, f: (z) => fmtKw(z.cooling_kw) }, { h: 'Utilisation', f: (z) => meter(z.cooling_util_pct) },
    { h: 'Liquid readiness', f: (z) => { const zone = L.zone.get(z.id); const any = items.some((k) => zone[k]); if (!any && !['dlc', 'immersion', 'hybrid'].includes(zone.cooling_method)) return '<span class="muted">n/a</span>'; return `<span class="checklist">${items.map((k) => `<span class="pill" title="${esc(label(k.replace('lc_', '')))}">${zone[k] ? '✓' : '✗'} ${esc(label(k.replace('lc_', '').replace('_detection', '')))}</span>`).join('')}</span>`; } },
    { h: '', f: (z) => (canField('zones', { roles: ['mechanical'] }) || canWrite('zones') ? btn('edit', 'Edit', `data-entity="zones" data-id="${z.id}"`, 'small') : '') },
  ], m.zones);
}

function powerTree(withActions = true) {
  const st = S.st, kids = new Map();
  for (const a of st.power) { const k = a.parent_id && L.power.has(a.parent_id) ? a.parent_id : 0; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(a); }
  const rows = [];
  const walk = (pid, depth) => { for (const a of kids.get(pid) || []) { rows.push({ ...a, depth }); walk(a.id, depth + 1); } };
  walk(0, 0);
  return table([
    { h: 'Asset', f: (a) => `<span style="padding-left:${a.depth * 16}px">${a.depth ? '└ ' : ''}<strong class="code">${esc(a.code)}</strong></span> <span class="muted">${esc(a.name || '')}</span>` },
    { h: 'Type', f: (a) => esc(a.type) }, { h: 'Hall', f: (a) => esc(L.hall.get(a.hall_id)?.code || 'Site') }, { h: 'Status', f: (a) => pill(a.status) },
    { h: 'Config', f: (a) => `${esc(a.units)} × ${fmtN(a.rating_per_unit)} ${esc(a.rating_unit)} · ${esc(a.redundancy)}` },
    { h: 'Usable', num: true, f: (a) => fmtKw(L.mPower.get(a.id)?.usable_kw) }, { h: 'Failover load', num: true, f: (a) => fmtKw(L.mPower.get(a.id)?.load_kw) },
    { h: 'Utilisation (failover)', f: (a) => meter(L.mPower.get(a.id)?.racks ? L.mPower.get(a.id).util_pct : null) },
    { h: 'Normal', num: true, f: (a) => fmtPct(L.mPower.get(a.id)?.racks ? L.mPower.get(a.id).normal_util_pct : null) },
    { h: 'Racks', num: true, f: (a) => fmtN(L.mPower.get(a.id)?.racks) },
    ...(withActions ? [{ h: '', f: (a) => btn('edit', 'Edit', `data-entity="power_assets" data-id="${a.id}"`, 'small') }] : []),
  ], rows, { emptyMsg: 'No power assets defined yet.' });
}

VIEWS.halls = async ([id]) => {
  if (id) return hallDetail(Number(id));
  const m = S.st.metrics;
  const cards = S.st.halls.map((h) => {
    const x = L.mHall.get(h.id);
    const blk = m.exceptions.filter((e) => e.hall_id === h.id && e.severity === 'blocking').length;
    return `<div class="card"><div class="card-head"><div><h2><a href="#/halls/${h.id}">${esc(h.code)} — ${esc(h.name)}</a></h2><small>${esc(h.building || '')} ${esc(h.floor || '')} · ${esc(label(h.phase))} · ${pill(h.status)}</small></div>${blk ? `<span class="sev blocking">⛔ ${blk} blocking</span>` : '<span class="sev ok">✓ Valid</span>'}</div>
      <dl class="kv"><dt>Approved IT load</dt><dd>${fmtKw(h.approved_it_kw)} · ${fmtN(h.approved_racks)} racks</dd><dt>Planned</dt><dd>${fmtKw(x.planned_kw)} · ${fmtN(x.planned_racks)} racks · ${fmtN(x.avg_density_kw, 1)} kW/rack</dd>
      <dt>Planned vs approved</dt><dd>${meter(x.planned_vs_approved_pct)}</dd><dt>Cooling utilisation</dt><dd>${meter(x.cooling_util_pct)}</dd><dt>Rack occupancy</dt><dd>${meter(x.occupied_pct, `${x.occupied_racks}/${x.commissioned_racks}`)}</dd>
      <dt>Redundancy</dt><dd>Power ${esc(h.power_redundancy)} · Cooling ${esc(h.cooling_redundancy)}</dd></dl></div>`;
  }).join('');
  return pageHead('Data halls', 'Hall, zone and density-tier definitions with planned load, approved capacity and validation status.', canWrite('data_halls') ? btn('new', '+ New data hall', 'data-entity="data_halls"', 'primary') : '') + baselineNotice() + `<div class="grid cols-2">${cards || empty('No data halls yet.')}</div>`;
};

function hallDetail(id) {
  const h = L.hall.get(id); if (!h) return empty('Hall not found');
  const x = L.mHall.get(id), m = S.st.metrics;
  const zones = S.st.zones.filter((z) => z.hall_id === id);
  const tiers = S.st.tiers.filter((t) => t.hall_id === id).sort((a, b) => a.max_kw - b.max_kw);
  const racks = S.st.racks.filter((r) => r.hall_id === id);
  const mode = S.ui.floorMode;
  const maxKw = Math.max(1, ...racks.map((r) => n(r.planned_kw)));
  const color = (r) => (mode === 'status' ? `var(--st-${r.status})` : `var(--seq-${Math.min(6, Math.floor((n(r.planned_kw) / maxKw) * 6.99))})`);
  const zoneBlocks = [...zones, { id: null, code: 'Unassigned' }].map((z) => {
    const zr = racks.filter((r) => (r.zone_id || null) === z.id);
    if (!zr.length && z.id === null) return '';
    const rows = new Map(); for (const r of zr.sort((a, b) => String(a.row).localeCompare(String(b.row)) || a.position - b.position)) { const k = r.row || '—'; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(r); }
    const mz = L.mZone.get(z.id);
    return `<div class="floor-zone"><header><strong>${esc(z.code)} ${esc(z.name || '')}</strong>${mz ? `<span>${fmtN(mz.planned_racks)}/${fmtN(mz.rack_positions)} positions · ${fmtKw(mz.planned_kw)} of ${fmtKw(mz.allocated_it_kw)} · ${esc(label(mz.cooling_method))}</span>` : ''}</header>
      ${[...rows.entries()].map(([row, rs]) => `<div class="floor-row"><span class="row-label">${esc(row)}</span>${rs.map((r) => {
        const fl = L.flags[r.id] || [];
        const tip = `<strong>${esc(r.code)}</strong>${esc(label(r.status))} · ${fmtN(r.planned_kw, 1)} kW planned / ${fmtN(r.max_kw, 1)} max${r.status === 'occupied' ? ` · ${fmtN(r.actual_kw, 1)} kW actual` : ''}<br>${esc(L.tier.get(r.tier_id)?.name || 'No tier')} · A: ${esc(L.power.get(r.feed_a_id)?.code || '—')} B: ${esc(L.power.get(r.feed_b_id)?.code || '—')}${r.tenant ? `<br>${esc(label(r.allocation))}: ${esc(r.tenant)}` : ''}${fl.map((f) => `<br>${f.severity === 'blocking' ? '⛔' : '⚠'} ${esc(f.detail)}`).join('')}`;
        return `<button class="rk ${fl.length ? 'flag' : ''}" style="background:${color(r)}" data-act="edit" data-entity="racks" data-id="${r.id}" data-tip="${esc(tip)}" aria-label="${esc(r.code)}"></button>`;
      }).join('')}</div>`).join('') || '<span class="muted">No racks</span>'}</div>`;
  }).join('');
  const legend = mode === 'status' ? S.meta.rack_status.map((s) => `<span><span class="sw" style="background:var(--st-${s})"></span>${label(s)}</span>`).join('') : `<span>Planned kW: 0</span>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<span class="sw" style="background:var(--seq-${i});margin:0"></span>`).join('')}<span>${fmtN(maxKw)} kW</span>`;
  const zoneT = table([{ h: 'Zone', f: (z) => `<strong>${esc(z.code)}</strong> ${esc(z.name || '')}` }, { h: 'Allocated', num: true, f: (z) => fmtKw(z.allocated_it_kw) }, { h: 'Planned', num: true, f: (z) => fmtKw(L.mZone.get(z.id)?.planned_kw) }, { h: 'Design kW/rack', num: true, f: (z) => fmtN(z.design_density_kw, 1) }, { h: 'Space', f: (z) => meter(L.mZone.get(z.id)?.space_util_pct, `${L.mZone.get(z.id)?.planned_racks}/${z.rack_positions}`) }, { h: 'Cabling', f: (z) => meter(L.mZone.get(z.id)?.cabling_util_pct) }, { h: 'Cooling', f: (z) => meter(L.mZone.get(z.id)?.cooling_util_pct) }, { h: 'Method', f: (z) => esc(label(z.cooling_method)) }, { h: 'Network path', f: (z) => esc(z.network_zone || '—') }, { h: '', f: (z) => btn('edit', 'Edit', `data-entity="zones" data-id="${z.id}"`, 'small') }], zones, { emptyMsg: 'No zones yet.' });
  const tierT = table([{ h: 'Tier', f: (t) => `<strong>${esc(t.name)}</strong>${t.liquid ? ' <span class="pill">💧 liquid</span>' : ''}` }, { h: 'Max kW/rack', num: true, f: (t) => fmtN(t.max_kw, 1) }, { h: 'Supported cooling', f: (t) => esc((t.cooling_methods || []).map(label).join(', ')) }, { h: 'Racks', num: true, f: (t) => fmtN(racks.filter((r) => r.tier_id === t.id).length) }, { h: '', f: (t) => btn('edit', 'Edit', `data-entity="density_tiers" data-id="${t.id}"`, 'small') }], tiers);
  const hEx = m.exceptions.filter((e) => e.hall_id === id);
  return pageHead(`${h.code} — ${h.name}`, `${esc(h.building || '')} ${esc(h.floor || '')} · ${esc(label(h.phase))} · white space ${fmtN(h.white_space_m2)} m² (${fmtN(h.used_space_m2)} m² used) · ${esc(label(h.containment))} containment`,
    `<a class="btn" href="#/halls">← All halls</a>${btn('edit', 'Edit hall & IT load', `data-entity="data_halls" data-id="${id}"`)}${canWrite('racks') ? btn('rack-plan', '+ Generate rack plan', `data-hall="${id}"`, 'primary') + btn('import', '⬆ Import racks (CSV)', `data-hall="${id}"`) : ''}`) + baselineNotice() +
    `<div class="kpis">${kpi('Approved IT load', fmtKw(h.approved_it_kw), `peak ${fmtKw(h.peak_it_kw)} · ${label(h.load_criticality)}`)}${kpi('Planned IT load', fmtKw(x.planned_kw), `${fmtPct(x.planned_vs_approved_pct)} of approved`)}${kpi('Racks', `${fmtN(x.planned_racks)} / ${fmtN(h.approved_racks)}`, 'planned / approved')}${kpi('Standard density', `${fmtN(h.standard_density_kw, 1)} kW`, `avg planned ${fmtN(x.avg_density_kw, 1)} kW/rack`)}${kpi('Cooling', fmtPct(x.cooling_util_pct), `${fmtKw(x.heat_kw)} heat / ${fmtKw(x.cooling_kw)}`)}${kpi('Resilience', `${esc(h.power_redundancy)} / ${esc(h.cooling_redundancy)}`, `UPS ${h.required_ups_autonomy_min} min · Gen ${h.required_gen_runtime_h} h`)}</div>
    <div class="card"><div class="card-head"><h2>Floor layout</h2><div class="actions"><div class="legend">${legend}<span><span class="sw" style="background:none;outline:2px solid var(--critical)"></span>Flagged</span></div><select data-act-change="floor-mode" aria-label="Colour by"><option value="status" ${mode === 'status' ? 'selected' : ''}>Colour by status</option><option value="load" ${mode === 'load' ? 'selected' : ''}>Colour by planned kW</option></select></div></div><div class="floor">${zoneBlocks || empty('No racks planned yet — use “Generate rack plan”.')}</div></div>
    <div class="card"><div class="card-head"><h2>Zones / pods</h2>${canWrite('zones') ? btn('new', '+ Zone', `data-entity="zones" data-hall="${id}"`) : ''}</div>${zoneT}</div>
    <div class="grid cols-2"><div class="card"><div class="card-head"><h2>Density tiers</h2>${canWrite('density_tiers') ? btn('new', '+ Tier', `data-entity="density_tiers" data-hall="${id}"`) : ''}</div>${tierT}</div><div class="card"><h2>Hall exceptions</h2>${exRows(hEx)}</div></div>`;
}

VIEWS.racks = async () => {
  const f = S.ui.rackFilter ||= { hall: '', zone: '', status: '', alloc: '', q: '', flagged: false };
  let rs = S.st.racks;
  if (f.hall) rs = rs.filter((r) => r.hall_id === Number(f.hall));
  if (f.zone) rs = rs.filter((r) => r.zone_id === Number(f.zone));
  if (f.status) rs = rs.filter((r) => r.status === f.status);
  if (f.alloc) rs = rs.filter((r) => r.allocation === f.alloc);
  if (f.flagged) rs = rs.filter((r) => L.flags[r.id]);
  if (f.q) { const q = f.q.toLowerCase(); rs = rs.filter((r) => `${r.code} ${r.tenant || ''} ${r.row}`.toLowerCase().includes(q)); }
  const sel = S.ui.rackSel;
  for (const id of [...sel]) if (!L.rack.has(id)) sel.delete(id);
  const shown = rs.slice(0, 600);
  const opt = (arr, cur) => arr.map(([v, t]) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const filters = `<div class="filters">
    <select data-filter="hall" aria-label="Hall"><option value="">All halls</option>${opt(S.st.halls.map((h) => [h.id, h.code]), f.hall)}</select>
    <select data-filter="zone" aria-label="Zone"><option value="">All zones</option>${opt(S.st.zones.filter((z) => !f.hall || z.hall_id === Number(f.hall)).map((z) => [z.id, z.code]), f.zone)}</select>
    <select data-filter="status" aria-label="Status"><option value="">Any status</option>${opt(S.meta.rack_status.map((s) => [s, label(s)]), f.status)}</select>
    <select data-filter="alloc" aria-label="Allocation"><option value="">Any allocation</option>${opt([['unallocated', 'Unallocated'], ['reserved', 'Reserved'], ['sold', 'Sold']], f.alloc)}</select>
    <input data-filter="q" placeholder="Search rack / tenant / row" value="${esc(f.q)}" aria-label="Search">
    <label class="field check"><input type="checkbox" data-filter="flagged" ${f.flagged ? 'checked' : ''}> Flagged only</label>
    <span class="muted">${fmtN(rs.length)} rack(s)${rs.length > shown.length ? `, showing first ${shown.length}` : ''} · ${fmtKw(rs.reduce((t, r) => t + n(r.planned_kw), 0))} planned</span></div>`;
  const bulk = `<div class="actions" style="margin-bottom:10px"><strong>${sel.size} selected</strong>${btn('bulk-status', 'Update status…', sel.size ? '' : 'disabled')}${btn('bulk-edit', 'Bulk edit…', sel.size && canWrite('racks') ? '' : 'disabled')}${sel.size ? btn('clear-sel', 'Clear') : ''}</div>`;
  const t = table([
    { h: 'Rack', f: (r) => `<button class="link-btn" data-act="edit" data-entity="racks" data-id="${r.id}"><strong class="code">${esc(r.code)}</strong></button>` },
    { h: 'Hall / zone', f: (r) => `${esc(L.hall.get(r.hall_id)?.code)} / ${esc(L.zone.get(r.zone_id)?.code || '—')}` }, { h: 'Row·Pos', f: (r) => `${esc(r.row)}·${esc(r.position)}` },
    { h: 'Function', f: (r) => esc(label(r.rack_type)) }, { h: 'Tier', f: (r) => esc(L.tier.get(r.tier_id)?.name || '—') },
    { h: 'Planned kW', num: true, f: (r) => fmtN(r.planned_kw, 1) }, { h: 'Max kW', num: true, f: (r) => fmtN(r.max_kw, 1) }, { h: 'Actual kW', num: true, f: (r) => (r.status === 'occupied' ? fmtN(r.actual_kw, 1) : '—') },
    { h: 'Feeds A / B', f: (r) => `<span class="code">${esc(L.power.get(r.feed_a_id)?.code || '—')} / ${esc(L.power.get(r.feed_b_id)?.code || '—')}</span>` },
    { h: 'Status', f: (r) => pill(r.status) }, { h: 'Allocation', f: (r) => (r.allocation === 'unallocated' ? '<span class="muted">—</span>' : `${esc(label(r.allocation))}${r.tenant ? `<br><small>${esc(r.tenant)}</small>` : ''}`) },
    { h: 'Validation', f: (r) => { const fl = L.flags[r.id]; return fl ? fl.map((x) => `<div class="sev ${x.severity}" title="${esc(x.detail)}">${x.severity === 'blocking' ? '⛔' : '⚠'} ${esc(x.rule)}</div>`).join('') : '<span class="sev ok">✓</span>'; } },
  ], shown, { select: sel, emptyMsg: 'No racks match the filters.' });
  return pageHead('Racks', 'Rack-level planning, density classification, A/B feed allocation and lifecycle status.', `${canWrite('racks') && S.st.halls.length ? btn('new', '+ Rack', `data-entity="racks" data-hall="${f.hall || S.st.halls[0].id}"`) + btn('rack-plan', '+ Generate rack plan', `data-hall="${f.hall || S.st.halls[0].id}"`) + btn('import', '⬆ Import CSV', `data-hall="${f.hall || S.st.halls[0].id}"`) : ''}${btn('export-racks', '⬇ Export CSV')}`) + baselineNotice() + `<div class="card">${filters}${bulk}${t}</div>`;
};

VIEWS.power = async () => pageHead('Power capacity planning', 'Utility → transformer → switchgear → UPS → PDU / busway → rack. Loads are checked at failover (each feed path carries the full rack load), with diversity applied at UPS and upstream, after redundancy, derating, power factor and safety margin.',
  canWrite('power_assets') ? btn('new', '+ Power asset', 'data-entity="power_assets"', 'primary') : '') + baselineNotice() +
  `<div class="card">${powerTree(true)}</div><div class="card"><h2>Project electrical factors</h2><dl class="kv"><dt>Power factor</dt><dd>${S.st.project.power_factor}</dd><dt>Diversity factor (UPS & upstream)</dt><dd>${S.st.project.diversity_factor}</dd><dt>Safety margin</dt><dd>${S.st.project.safety_margin_pct}%</dd></dl><p class="muted">Edit under Project &amp; phasing (Electrical Engineer / Design Manager).</p></div>`;

VIEWS.cooling = async () => {
  const assets = table([
    { h: 'Asset', f: (c) => `<strong class="code">${esc(c.code)}</strong> <span class="muted">${esc(c.name || '')}</span>` }, { h: 'Type', f: (c) => esc(c.type) }, { h: 'Technology', f: (c) => esc(label(c.technology)) },
    { h: 'Hall', f: (c) => esc(L.hall.get(c.hall_id)?.code) }, { h: 'Serves', f: (c) => esc(c.zone_id ? `Zone ${L.zone.get(c.zone_id)?.code}` : 'Whole hall') }, { h: 'Status', f: (c) => pill(c.status) },
    { h: 'Config', f: (c) => `${c.units} × ${fmtN(c.rating_per_unit_kw)} kW · ${esc(c.redundancy)} · derate ${c.derating}` }, { h: 'Usable', num: true, f: (c) => fmtKw(L.mCooling.get(c.id)?.usable_kw) },
    { h: '', f: (c) => btn('edit', 'Edit', `data-entity="cooling_assets" data-id="${c.id}"`, 'small') },
  ], S.st.cooling, { emptyMsg: 'No cooling assets defined yet.' });
  return pageHead('Cooling capacity planning', `Heat load = IT load × ${S.st.project.heat_factor}. Zone-dedicated units (RDHx, CDU, in-row) cover their zone first; any remaining heat draws on hall-wide units (CRAH/CRAC).`,
    canWrite('cooling_assets') ? btn('new', '+ Cooling asset', 'data-entity="cooling_assets"', 'primary') : '') + baselineNotice() +
    `<div class="card"><h2>Cooling assets</h2>${assets}</div><div class="card"><h2>Zone heat load vs cooling</h2>${zoneCoolingTable()}</div>`;
};

VIEWS.exceptions = async () => {
  const f = S.ui.exFilter ||= { status: 'open', sev: '', disc: '' };
  let rows = await GET(`/api/projects/${S.pid}/exceptions?status=${f.status}`);
  if (f.sev) rows = rows.filter((e) => e.severity === f.sev);
  if (f.disc) rows = rows.filter((e) => e.discipline === f.disc);
  const discs = [...new Set(S.st.metrics.exceptions.map((e) => e.discipline))];
  const filters = `<div class="filters"><select data-exfilter="status"><option value="open" ${f.status === 'open' ? 'selected' : ''}>Open</option><option value="resolved" ${f.status === 'resolved' ? 'selected' : ''}>Resolved</option><option value="all" ${f.status === 'all' ? 'selected' : ''}>All</option></select>
    <select data-exfilter="sev"><option value="">Any severity</option><option value="blocking" ${f.sev === 'blocking' ? 'selected' : ''}>Blocking</option><option value="warning" ${f.sev === 'warning' ? 'selected' : ''}>Warning</option></select>
    <select data-exfilter="disc"><option value="">Any discipline</option>${discs.map((d) => `<option value="${d}" ${f.disc === d ? 'selected' : ''}>${label(d)}</option>`).join('')}</select><span class="muted">${rows.length} exception(s)</span></div>`;
  const t = table([
    { h: 'Severity', f: (e) => sev(e.severity) }, { h: 'Alert', f: (e) => `<span class="code">${esc(e.alert || '—')}</span>` }, { h: 'Rule / ref', f: (e) => `<span class="code">${esc(e.rule)}</span><br><small>${esc(e.ref || '')}</small>` },
    { h: 'Finding', f: (e) => `<strong>${esc(e.title || '')}</strong><br>${esc(e.message)}` }, { h: 'Discipline', f: (e) => esc(label(e.discipline)) }, { h: 'Routed to', f: (e) => esc(e.recipients.map(ROLE).join(', ')) },
    { h: 'Status', f: (e) => `${esc(label(e.status))}<br><small>${fmtDate(e.status === 'resolved' ? e.resolved_at : e.first_seen)}</small>` },
    { h: '', f: (e) => (e.hall_id ? `<a class="btn small" href="#/halls/${e.hall_id}">Open hall</a>` : '') },
  ], rows, { emptyMsg: 'No exceptions match.' });
  return pageHead('Alerts & exceptions', 'Every planning change is re-validated against power, cooling, space, cabling and redundancy rules. Blocking exceptions prevent baseline approval unless formally overridden (FR-057/058).', btn('revalidate', '↻ Re-validate now')) + `<div class="card">${filters}${t}</div>`;
};

function diffList(diff) {
  const nm = { halls: 'Data halls', tiers: 'Density tiers', zones: 'Zones', racks: 'Racks', power: 'Power assets', cooling: 'Cooling assets' };
  const fv = (v) => (Array.isArray(v) ? v.join(', ') : v === null || v === undefined || v === '' ? '∅' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v);
  return Object.entries(nm).map(([k, t]) => {
    const d = diff?.[k]; if (!d || !(d.added.length + d.removed.length + d.changed.length)) return '';
    const items = [
      ...d.added.slice(0, 30).map((x) => `<li><span class="new">+ added</span> ${esc(x.code)}</li>`),
      ...d.removed.slice(0, 30).map((x) => `<li><span class="old">removed</span> ${esc(x.code)}</li>`),
      ...d.changed.slice(0, 40).map((x) => `<li><strong>${esc(x.code)}</strong>: ${Object.entries(x.fields).map(([f, [a, b]]) => `${esc(label(f))} <span class="old">${esc(fv(a))}</span> → <span class="new">${esc(fv(b))}</span>`).join('; ')}</li>`),
    ];
    const more = d.added.length + d.removed.length + d.changed.length - items.length;
    return `<h3>${t}</h3><ul class="diff-list">${items.join('')}${more > 0 ? `<li class="muted">… ${more} more</li>` : ''}</ul>`;
  }).join('') || '<p class="muted">No planning differences.</p>';
}

function impactHtml(imp) {
  if (!imp) return '';
  const pw = table([{ h: 'Power asset', f: (a) => `<strong class="code">${esc(a.code)}</strong> ${esc(a.type)}` }, { h: 'Before', num: true, f: (a) => `${fmtKw(a.before_kw)} (${fmtPct(a.before_pct)})` }, { h: 'After', num: true, f: (a) => `${fmtKw(a.after_kw)}` }, { h: 'Utilisation after', f: (a) => meter(a.after_pct) }], imp.power, { emptyMsg: 'No power assets affected.', cls: 'short' });
  const hl = table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Planned kW', num: true, f: (h) => `${fmtKw(h.planned_kw_before)} → <strong>${fmtKw(h.planned_kw_after)}</strong>` }, { h: 'Racks', num: true, f: (h) => `${h.racks_before} → <strong>${h.racks_after}</strong>` }, { h: 'Cooling utilisation', f: (h) => `${fmtPct(h.cooling_pct_before)} → ${meter(h.cooling_pct_after)}` }], imp.halls, { emptyMsg: 'No hall-level change.' });
  const zn = table([{ h: 'Zone', f: (z) => `<strong>${esc(z.code)}</strong>` }, { h: 'Racks', num: true, f: (z) => `${z.racks_before} → ${z.racks_after}` }, { h: 'Space', f: (z) => meter(z.space_pct_after) }, { h: 'Cabling', f: (z) => meter(z.cabling_pct_after) }, { h: 'Cooling', f: (z) => meter(z.cooling_pct_after) }], imp.zones, { emptyMsg: 'No zone-level change.' });
  return `<div class="kpis">${kpi('IT load change', `${imp.planned_kw_delta > 0 ? '+' : ''}${fmtKw(imp.planned_kw_delta)}`, `${fmtKw(imp.planned_kw_before)} → ${fmtKw(imp.planned_kw_after)}`)}${kpi('Rack count change', `${imp.racks_delta > 0 ? '+' : ''}${imp.racks_delta}`)}${kpi('Cost impact', `${esc(imp.currency)} ${fmtN(imp.cost_delta)}`, 'capacity cost rates')}${kpi('Commissioning rework', fmtN(imp.commissioning_rework_racks), esc(imp.schedule))}${kpi('Blocking exceptions', `${imp.blocking_before} → ${imp.blocking_after}`, `${imp.new_blocking.length} new`)}</div>
    <div class="grid cols-2"><div class="card"><h2>Power impact</h2>${pw}</div><div class="card"><h2>Cooling & space impact</h2>${hl}<div style="height:12px"></div>${zn}</div></div>
    ${imp.new_blocking.length ? `<div class="card"><h2>New blocking findings</h2>${exRows(imp.new_blocking.map((e) => ({ ...e, severity: 'blocking', title: S.meta.rules[e.rule]?.title, recipients: S.meta.rules[e.rule]?.to })))}</div>` : ''}`;
}

VIEWS.plans = async ([id]) => {
  if (id) return planDetail(Number(id));
  const plans = await GET(`/api/projects/${S.pid}/plans`);
  const b = S.st.baseline;
  const canSubmit = can('planner', 'design_manager', 'project_manager', 'electrical', 'mechanical', 'ict');
  let preview = '';
  if (!b || !b.in_sync) {
    const cmp = await GET(`/api/projects/${S.pid}/compare`);
    preview = `<div class="card"><div class="card-head"><h2>${b ? `Working plan vs baseline v${b.version}` : 'Working plan (no baseline yet)'}</h2>${canSubmit && !S.st.pending_plans.length ? btn('submit-plan', b ? 'Submit change request…' : 'Submit baseline for approval…', '', 'primary') : S.st.pending_plans.length ? '<span class="muted">A plan is already awaiting review</span>' : ''}</div>
      <p>Change types: ${cmp.change_types.length ? cmp.change_types.map((t) => `<span class="pill">${esc(label(t))}</span>`).join(' ') : '—'} · Required reviewers: ${cmp.required_roles.map((r) => `<span class="pill">${esc(ROLE(r))}</span>`).join(' ')}</p>
      ${impactHtml(cmp.impact)}<div class="card"><h2>Changes</h2>${diffList(cmp.diff)}</div></div>`;
  }
  const t = table([
    { h: 'Version', f: (p) => `<a href="#/plans/${p.id}"><strong>v${p.version}</strong></a>` }, { h: 'Type', f: (p) => esc(label(p.kind)) }, { h: 'Title', f: (p) => esc(p.title) },
    { h: 'Status', f: (p) => `<span class="pill">${esc(label(p.status))}</span>${p.override_justification ? ' <span class="sev warning" title="Approved with override">⚠ override</span>' : ''}` },
    { h: 'Change types', f: (p) => esc(p.change_types.map(label).join(', ')) }, { h: 'Reviews', f: (p) => p.reviews.map((r) => `<span class="pill" title="${esc(ROLE(r.role))}">${r.decision === 'approved' ? '✓' : r.decision === 'rejected' ? '✗' : '…'} ${esc(ROLE(r.role).split(' ')[0])}</span>`).join(' ') },
    { h: 'Blocking at submit', num: true, f: (p) => fmtN(p.validation.filter((e) => e.severity === 'blocking').length) }, { h: 'Submitted', f: (p) => `${esc(p.submitted_by_name)}<br><small>${fmtDate(p.submitted_at)}</small>` },
  ], plans, { emptyMsg: 'No plans submitted yet.' });
  const head = b ? `<div class="notice ${b.in_sync ? 'ok' : 'warn'}"><span>${b.in_sync ? '✓' : '⚠'} Controlled baseline: <strong>v${b.version}</strong>, approved ${fmtDate(b.decided_at)}. ${b.in_sync ? 'Working plan matches the baseline.' : `${b.changes} planning change(s) since approval.`}</span></div>` : baselineNotice();
  return pageHead('Plans, baselines & change control', 'Approved plans become the controlled baseline. Any later change to IT load, density, rack count, cooling method or redundancy goes through a change request with impact assessment and discipline review (§7.10).') + head + preview + `<div class="card"><h2>Version history</h2>${t}</div>`;
};

async function planDetail(id) {
  const p = await GET(`/api/plans/${id}`);
  const cmp = p.base_plan_id ? await GET(`/api/projects/${S.pid}/compare?from=${p.base_plan_id}&to=${p.id}`) : null;
  const myReview = p.reviews.find((r) => r.role === role() && r.decision === 'pending');
  const blocking = p.validation.filter((e) => e.severity === 'blocking');
  const reviews = table([{ h: 'Reviewer role', f: (r) => esc(ROLE(r.role)) }, { h: 'Decision', f: (r) => (r.decision === 'approved' ? '<span class="sev ok">✓ Approved</span>' : r.decision === 'rejected' ? '<span class="sev blocking">✗ Rejected</span>' : '<span class="muted">Pending</span>') }, { h: 'By', f: (r) => esc(r.user_name || '—') }, { h: 'Comment', f: (r) => esc(r.comment || '') }, { h: 'When', f: (r) => fmtDate(r.at) }], p.reviews);
  const side = cmp ? table([{ h: 'Hall', f: (h) => `<strong>${esc(h.code)}</strong>` }, { h: 'Planned (prev)', num: true, f: (h) => fmtKw(cmp.before.halls.find((x) => x.id === h.id)?.planned_kw) }, { h: 'Planned (proposed)', num: true, f: (h) => fmtKw(h.planned_kw) }, { h: 'Racks (prev → proposed)', num: true, f: (h) => `${cmp.before.halls.find((x) => x.id === h.id)?.planned_racks ?? 0} → ${h.planned_racks}` }, { h: 'Cooling util (prev → proposed)', f: (h) => `${fmtPct(cmp.before.halls.find((x) => x.id === h.id)?.cooling_util_pct)} → ${fmtPct(h.cooling_util_pct)}` }], cmp.after.halls) + `<p class="muted">Project blocking exceptions: ${cmp.before.summary.blocking} → <strong>${cmp.after.summary.blocking}</strong></p>` : '';
  const actions = p.status === 'submitted' && myReview ? btn('review', '✓ Approve', `data-id="${p.id}" data-decision="approve" data-blocking="${blocking.length}"`, 'primary') + btn('review', '✗ Reject', `data-id="${p.id}" data-decision="reject"`, 'danger') : '';
  return pageHead(`Plan v${p.version} — ${p.title}`, `${esc(label(p.kind))} · submitted by ${esc(p.submitted_by_name)} on ${fmtDate(p.submitted_at)} · status <strong>${esc(label(p.status))}</strong>`, `<a class="btn" href="#/plans">← Plans</a>${actions}`) +
    (p.status === 'submitted' && !myReview ? `<div class="notice"><span>Awaiting: ${p.reviews.filter((r) => r.decision === 'pending').map((r) => ROLE(r.role)).join(', ')}. Switch user (top right) to act as a reviewer.</span></div>` : '') +
    (p.override_justification ? `<div class="notice warn"><span>⚠ <strong>Approved with manual override</strong> by ${esc(p.override_by_name)} on ${fmtDate(p.override_at)} (AL-010): ${esc(p.override_justification)}</span></div>` : '') +
    `<div class="grid cols-2"><div class="card"><h2>Submission</h2><dl class="kv"><dt>Justification</dt><dd>${esc(p.justification || '—')}</dd><dt>Change types</dt><dd>${p.change_types.map((t) => `<span class="pill">${esc(label(t))}</span>`).join(' ')}</dd><dt>Base version</dt><dd>${p.base_plan_id ? `<a href="#/plans/${p.base_plan_id}">previous baseline</a>` : 'none (initial baseline)'}</dd><dt>Validation at submit</dt><dd>${blocking.length ? `<span class="sev blocking">⛔ ${blocking.length} blocking</span>` : '<span class="sev ok">✓ passed</span>'} · ${p.validation.length - blocking.length} warning(s)</dd></dl></div><div class="card"><h2>Reviews</h2>${reviews}</div></div>` +
    (cmp ? `<div class="card"><h2>Side-by-side: previous baseline vs proposed</h2>${side}</div>${impactHtml(p.impact)}<div class="card"><h2>Detailed changes</h2>${diffList(p.diff)}</div>` : '') +
    `<div class="card"><h2>Validation findings in this version</h2>${exRows(p.validation)}</div>`;
}

VIEWS.commissioning = async () => {
  const hist = await GET(`/api/projects/${S.pid}/history?limit=200`);
  const assetT = (kind, list) => table([
    { h: 'Asset', f: (a) => `<strong class="code">${esc(a.code)}</strong> <span class="muted">${esc(a.type)}</span>` }, { h: 'Hall', f: (a) => esc(L.hall.get(a.hall_id)?.code || 'Site') }, { h: 'Status', f: (a) => pill(a.status) },
    { h: '', f: (a) => (can('commissioning', kind === 'power' ? 'electrical' : 'mechanical') ? btn('asset-status', 'Update…', `data-kind="${kind}" data-id="${a.id}"`, 'small') : '') },
  ], list, { cls: 'short' });
  const zones = table([
    { h: 'Zone', f: (z) => `${esc(L.hall.get(z.hall_id)?.code)} / <strong>${esc(z.code)}</strong>` },
    ...['planned', 'installed', 'commissioned', 'handed_over', 'occupied'].map((s) => ({ h: label(s), num: true, f: (z) => fmtN(S.st.racks.filter((r) => r.zone_id === z.id && r.status === s).length) })),
    { h: 'Network', f: (z) => `<label class="field check"><input type="checkbox" data-gate="network_commissioned" data-id="${z.id}" ${z.network_commissioned ? 'checked' : ''} ${can('commissioning', 'ict') ? '' : 'disabled'}> ${z.network_commissioned ? 'Ready' : 'Pending'}</label>` },
    { h: 'Life safety', f: (z) => `<label class="field check"><input type="checkbox" data-gate="safety_commissioned" data-id="${z.id}" ${z.safety_commissioned ? 'checked' : ''} ${can('commissioning') ? '' : 'disabled'}> ${z.safety_commissioned ? 'Ready' : 'Pending'}</label>` },
  ], S.st.zones);
  const h = table([{ h: 'When', f: (x) => fmtDate(x.at) }, { h: 'Item', f: (x) => `<span class="code">${esc(x.entity_code)}</span> <small>${esc(label(x.entity_type))}</small>` }, { h: 'Change', f: (x) => `${esc(label(x.from_status))} → <strong>${esc(label(x.to_status))}</strong>` }, { h: 'Milestone', f: (x) => esc(x.milestone || '') }, { h: 'Evidence', f: (x) => `${esc(x.evidence || '')}${x.attachment_id ? ` <button class="link-btn" data-act="attachment" data-id="${x.attachment_id}">📎 ${esc(x.attachment_name)}</button>` : ''}` }, { h: 'By', f: (x) => esc(x.user_name) }, { h: 'Source', f: (x) => esc(x.source) }], hist, { emptyMsg: 'No commissioning updates yet.' });
  return pageHead('Commissioning & handover', 'Capacity is released only when supporting power, cooling, network and life-safety commissioning gates are complete (FR-084/085). Evidence is mandatory for commissioned and handed-over status.',
    can('commissioning', 'operations') ? btn('milestone', 'Record rack milestone…', '', 'primary') : '') +
    `<div class="card"><h2>Rack status & gates by zone</h2>${zones}</div><div class="grid cols-2"><div class="card"><h2>Power assets</h2>${assetT('power', S.st.power)}</div><div class="card"><h2>Cooling assets</h2>${assetT('cooling', S.st.cooling)}</div></div><div class="card"><h2>Status history</h2>${h}</div>`;
};

VIEWS.project = async () => {
  const p = S.st.project, ent = S.meta.entities.projects;
  const groups = new Map(); for (const fd of ent.fields) { const g = fd.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(fd); }
  const kv = [...groups.entries()].map(([g, fds]) => `<div><h3>${esc(g)}</h3><dl class="kv">${fds.map((fd) => `<dt>${esc(fd.label)}</dt><dd>${esc(fd.type === 'select' ? label(p[fd.name]) : fd.type === 'number' ? fmtN(p[fd.name], 2) : p[fd.name] ?? '—')}</dd>`).join('')}</dl></div>`).join('');
  const fc = table([{ h: 'Period', k: 'period' }, { h: 'Hall', f: (f) => esc(L.hall.get(f.hall_id)?.code || 'All') }, { h: 'Forecast', num: true, f: (f) => fmtKw(f.forecast_kw) }, { h: 'Committed', num: true, f: (f) => fmtKw(f.committed_kw) }, { h: 'Notes', k: 'notes' }, { h: '', f: (f) => (canWrite('forecasts') ? btn('edit', 'Edit', `data-entity="forecasts" data-id="${f.id}"`, 'small') : '') }], S.st.forecasts, { emptyMsg: 'No forecast periods.' });
  const s = S.st.metrics.summary;
  return pageHead(`${p.code} — ${p.name}`, `${esc(p.location || '')} · ${esc(p.owner || '')}`, `${btn('edit-project', 'Edit project')}${btn('export-util', '⬇ Utilisation CSV')}${btn('export-racks', '⬇ Racks CSV')}${btn('export-audit', '⬇ Audit CSV')}${isAdmin() ? btn('reset-demo', 'Reset demo data', '', 'danger') : ''}`) +
    `<div class="kpis">${kpi('Day 1 capacity', fmtKw(p.day1_it_kw))}${kpi('Approved (all halls)', fmtKw(s.approved_it_kw), `target ${fmtKw(p.target_it_kw)}`)}${kpi('Reserved', fmtKw(p.reserved_it_kw), 'project reservation')}${kpi('Ultimate build-out', fmtKw(p.ultimate_it_kw))}${kpi('Design PUE', fmtN(p.design_pue, 2), `≈ ${fmtKw(s.planned_kw * n(p.design_pue))} facility load at plan`)}</div>
    <div class="card"><h2>Project master data &amp; engineering factors</h2><div class="grid cols-3">${kv}</div></div>
    <div class="card"><div class="card-head"><h2>Planned load growth (forecast)</h2>${canWrite('forecasts') ? btn('new', '+ Period', 'data-entity="forecasts"') : ''}</div>${fc}</div>`;
};

VIEWS.audit = async () => {
  const f = S.ui.auditFilter ||= { et: '' };
  const rows = await GET(`/api/audit?project_id=${S.pid}&limit=500${f.et ? `&entity_type=${f.et}` : ''}`);
  const short = (s) => { if (!s) return ''; try { const o = JSON.parse(s); const t = Object.entries(o).filter(([k]) => !['created_at', 'updated_at', 'created_by', 'updated_by', 'project_id', 'hall_id'].includes(k)).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', '); return t.length > 220 ? t.slice(0, 220) + '…' : t; } catch { return s; } };
  const t = table([{ h: 'When', f: (a) => fmtDate(a.at) }, { h: 'User', f: (a) => `${esc(a.user_name || 'system')}<br><small>${esc(ROLE(a.user_role))}</small>` }, { h: 'Action', f: (a) => `<span class="pill">${esc(label(a.action))}</span>` }, { h: 'Record', f: (a) => `${esc(label(a.entity_type))} <span class="code">#${esc(a.entity_id ?? '')}</span>` }, { h: 'Previous value', f: (a) => `<small>${esc(short(a.before))}</small>` }, { h: 'New value', f: (a) => `<small>${esc(short(a.after))}</small>` }, { h: 'Reason', f: (a) => esc(a.reason || '') }, { h: 'Source', f: (a) => esc(a.source) }], rows);
  const types = ['', 'projects', 'data_halls', 'zones', 'density_tiers', 'racks', 'power_assets', 'cooling_assets', 'plans', 'forecasts', 'attachments'];
  return pageHead('Audit trail', 'Every create, update, delete, status change, approval, rejection and override — with previous and new values, reason and source system.', btn('export-audit', '⬇ Export CSV')) +
    `<div class="card"><div class="filters"><select data-auditfilter="et">${types.map((x) => `<option value="${x}" ${f.et === x ? 'selected' : ''}>${x ? label(x) : 'All records'}</option>`).join('')}</select><span class="muted">latest ${rows.length} entries</span></div>${t}</div>`;
};

VIEWS.portfolio = async () => {
  const rows = await GET('/api/dashboards/capacity-summary');
  const t = table([{ h: 'Project', f: (p) => `<button class="link-btn" data-act="open-project" data-id="${p.id}"><strong>${esc(p.code)}</strong></button> ${esc(p.name)}` }, { h: 'Stage', f: (p) => esc(label(p.stage)) }, { h: 'Approved', num: true, f: (p) => fmtKw(p.approved_it_kw) }, { h: 'Planned', num: true, f: (p) => fmtKw(p.planned_kw) }, { h: 'Commissioned', num: true, f: (p) => fmtKw(p.commissioned_kw) }, { h: 'Occupied', num: true, f: (p) => fmtKw(p.occupied_kw) }, { h: 'IT utilisation', f: (p) => meter(p.it_util_pct) }, { h: 'Racks', num: true, f: (p) => `${fmtN(p.occupied_racks)} / ${fmtN(p.planned_racks)}` }, { h: 'Blocking', num: true, f: (p) => (p.blocking ? `<span class="sev blocking">⛔ ${p.blocking}</span>` : '<span class="sev ok">✓</span>') }], rows);
  const tot = rows.reduce((a, p) => ({ approved: a.approved + p.approved_it_kw, occ: a.occ + p.occupied_kw, comm: a.comm + p.commissioned_kw }), { approved: 0, occ: 0, comm: 0 });
  return pageHead('Portfolio', 'All projects you have access to.', can('project_manager') ? btn('new-project', '+ New project', '', 'primary') : '') + `<div class="kpis">${kpi('Projects', rows.length)}${kpi('Approved IT load', fmtKw(tot.approved))}${kpi('Commissioned', fmtKw(tot.comm))}${kpi('Occupied', fmtKw(tot.occ))}</div><div class="card">${t}</div>`;
};

VIEWS.admin = async () => {
  if (!isAdmin()) return empty('Administrators only.');
  const t = table([{ h: 'Name', k: 'name' }, { h: 'Email', k: 'email' }, { h: 'Role', f: (u) => `<select data-user-role="${u.id}">${Object.entries(S.meta.roles).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>` }, { h: 'Project access', f: (u) => esc(u.project_ids ? JSON.parse(u.project_ids).map((id) => S.projects.find((p) => p.id === id)?.code || id).join(', ') : 'All projects') }], S.users);
  const matrix = Object.entries(S.meta.entities).map(([k, e]) => `<tr><td>${esc(e.label)}</td><td>${esc((e.createRoles || e.writeRoles).map(ROLE).join(', '))}</td></tr>`).join('');
  return pageHead('Users & roles', 'Role-based access control. In production, identity comes from Microsoft Entra ID single sign-on; here users are selected from the header.', btn('new-user', '+ User', '', 'primary')) + `<div class="grid cols-2"><div class="card">${t}</div><div class="card"><h2>Write permissions</h2><div class="table-wrap"><table class="data"><thead><tr><th>Record</th><th>Can create / edit (field-level rules also apply)</th></tr></thead><tbody>${matrix}<tr><td>Plan approval</td><td>Design Manager (+ discipline reviewers per impact); submitter cannot approve</td></tr><tr><td>Override</td><td>Design Manager, with ≥20-character justification</td></tr><tr><td>Rack commissioning status</td><td>Commissioning Manager; occupancy by Operations Manager</td></tr><tr><td>Read-only</td><td>Executive, Auditor</td></tr></tbody></table></div></div></div>`;
};

// ---------------- actions ----------------
const A = {};
A['toggle-nav'] = () => $('#sidenav').classList.toggle('open');
A['close-modal'] = () => closeModal();
A.edit = (el) => editEntity(el.dataset.entity, Number(el.dataset.id));
A.new = (el) => {
  const ent = el.dataset.entity;
  const preset = ent === 'cooling_assets' && S.st.halls[0] ? { hall_id: S.st.halls[0].id } : {};
  createEntityForm(ent, { hall_id: Number(el.dataset.hall) || undefined }, preset);
};
A.delete = async (el) => {
  const reason = prompt('Reason for deletion (recorded in audit trail):');
  if (reason === null) return;
  try { await api('DELETE', `/api/${SLUG[el.dataset.entity]}/${el.dataset.id}?reason=${encodeURIComponent(reason)}`); closeModal(); toast('Deleted'); await refresh(); } catch (e) { toast(e.message, true); }
};
A['edit-project'] = () => entityForm({ entity: 'projects', title: 'Edit project', values: S.st.project, submit: (d) => api('PUT', `/api/projects/${S.pid}`, d) });
A['new-project'] = () => entityForm({ entity: 'projects', title: 'New data centre project', mode: 'create', submit: async (d) => { const p = await api('POST', '/api/projects', d); S.projects = await GET('/api/projects'); S.pid = p.id; localStorage.setItem('pid', p.id); location.hash = '#/project'; } });
A['open-project'] = async (el) => { S.pid = Number(el.dataset.id); localStorage.setItem('pid', S.pid); location.hash = '#/dashboard'; await refresh(); };
A['export-util'] = () => download(`/api/reports/utilisation?project_id=${S.pid}&format=csv`);
A['export-racks'] = () => download(`/api/reports/racks?project_id=${S.pid}`);
A['export-audit'] = () => download(`/api/audit?project_id=${S.pid}&format=csv&limit=5000`);
A.attachment = (el) => download(`/api/attachments/${el.dataset.id}`);
A.revalidate = async () => { try { const r = await api('POST', `/api/projects/${S.pid}/validate`); toast(`Validated: ${r.summary.blocking} blocking, ${r.summary.warnings} warning(s)`); await refresh(); } catch (e) { toast(e.message, true); } };
A['reset-demo'] = async () => { if (!confirm('Delete all data and reload the demo dataset?')) return; await api('POST', '/api/admin/reset-demo'); S.projects = await GET('/api/projects'); S.pid = S.projects[0]?.id; await refresh(); toast('Demo data reset'); };
A['clear-sel'] = async () => { S.ui.rackSel.clear(); await render(); };
A['sel-all'] = (el) => { for (const cb of $$('[data-sel]')) { cb.checked = el.checked; const id = Number(cb.dataset.sel); el.checked ? S.ui.rackSel.add(id) : S.ui.rackSel.delete(id); } render(); };
A.notifications = async () => {
  const d = $('#drawer');
  if (!d.hidden) { d.hidden = true; return; }
  await loadNotes();
  d.innerHTML = `<header><strong>Notifications · ${esc(ROLE(role()))}</strong><div class="actions"><button class="btn small" data-act="read-all">Mark all read</button><button class="icon-btn" data-act="notifications" aria-label="Close">✕</button></div></header><div class="list">${S.notes.items.map((x) => `<div class="note ${x.is_read ? '' : 'unread'}">${x.alert ? `<span class="code">${esc(x.alert)}</span> ` : ''}${esc(x.message)}<div class="meta"><span>${esc(label(x.kind))}</span><span>${fmtDate(x.created_at)}</span>${x.ref_type === 'plan' ? `<a href="#/plans/${x.ref_id}">Open plan</a>` : x.ref_type === 'exception' ? '<a href="#/exceptions">Exceptions</a>' : ''}</div></div>`).join('') || empty('No notifications for your role.')}</div>`;
  d.hidden = false;
};
A['read-all'] = async () => { await api('POST', '/api/notifications/read', { all: true }); $('#drawer').hidden = true; await loadNotes(); };

A['rack-plan'] = (el) => {
  const hallId = Number(el.dataset.hall);
  const hall = L.hall.get(hallId);
  const zones = S.st.zones.filter((z) => z.hall_id === hallId), tiers = S.st.tiers.filter((t) => t.hall_id === hallId);
  const feeds = S.st.power.filter((a) => ['PDU', 'RPP', 'BUSWAY', 'RACK_PDU', 'UPS'].includes(a.type) && (!a.hall_id || a.hall_id === hallId));
  const o = (arr, f) => arr.map((x) => `<option value="${x.id}">${esc(f(x))}</option>`).join('');
  modal(`Generate rack plan — ${hall.code}`, `<div class="form-grid">
    <label class="field">Zone *<select name="zone_id">${o(zones, (z) => z.code)}</select></label>
    <label class="field">Rows (space separated) *<input name="rows" placeholder="e.g. A09 A10"></label>
    <label class="field">Racks per row *<input name="racks_per_row" type="number" min="1" value="10"></label>
    <label class="field">Density tier<select name="tier_id"><option value="">—</option>${o(tiers, (t) => `${t.name} (≤ ${t.max_kw} kW)`)}</select></label>
    <label class="field">Rack function<select name="rack_type"><option>compute</option><option>network</option><option>storage</option><option>reserved</option></select></label>
    <label class="field">Planned kW / rack<input name="planned_kw" type="number" step="any" min="0" value="${hall.standard_density_kw}"></label>
    <label class="field">Max kW / rack<input name="max_kw" type="number" step="any" min="0" value="${Math.ceil(hall.standard_density_kw * 1.25)}"></label>
    <label class="field">Rack PDU rating / feed (kW)<input name="rack_pdu_kw" type="number" step="any" min="0" value="${Math.ceil(hall.standard_density_kw * 1.4)}"></label>
    <label class="field">A-feed<select name="feed_a_id"><option value="">—</option>${o(feeds, (a) => `${a.code} (${a.type})`)}</select></label>
    <label class="field">B-feed<select name="feed_b_id"><option value="">—</option>${o(feeds, (a) => `${a.code} (${a.type})`)}</select></label></div>
    <p class="muted">Racks are named ${esc(hall.code)}-&lt;row&gt;-&lt;nn&gt;. Validation runs immediately; breaches are routed to the relevant discipline.</p>`, undefined, (d) => {
    $('#mform', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      for (const k of ['zone_id', 'tier_id', 'feed_a_id', 'feed_b_id', 'racks_per_row', 'planned_kw', 'max_kw', 'rack_pdu_kw']) fd[k] = fd[k] === '' ? null : Number(fd[k]);
      try { const r = await api('POST', `/api/data-halls/${hallId}/rack-plan`, fd); closeModal(); toast(`${r.created} racks created`); await refresh(); } catch (err) { toast(err.message, true); }
    });
  });
};

A.import = (el) => {
  const hallId = Number(el.dataset.hall);
  modal(`Import racks into ${L.hall.get(hallId).code}`, `<p>Upload a CSV (save the Excel template as CSV). Columns: <span class="code">code, zone, row, position, rack_type, tier, planned_kw, max_kw, rack_pdu_kw, feed_a, feed_b, allocation, tenant</span>. Existing rack codes are updated; new codes are created. Zone, tier and feeds are matched by code / name.</p>
    <label class="field">Data hall<select name="hall">${S.st.halls.map((h) => `<option value="${h.id}" ${h.id === hallId ? 'selected' : ''}>${esc(h.code)}</option>`).join('')}</select></label>
    <label class="field" style="margin-top:8px">CSV file<input type="file" name="file" accept=".csv,text/csv"></label><div id="import-result"></div>`, `<button type="button" class="btn" data-act="template">⬇ Template</button><span style="flex:1"></span><button type="button" class="btn" data-act="close-modal">Close</button><button class="btn primary" value="ok">Import</button>`, (d) => {
    $('#mform', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = e.target.file.files[0]; if (!file) return toast('Choose a CSV file', true);
      try {
        const r = await api('POST', `/api/data-halls/${e.target.hall.value}/racks/import`, await file.text(), { csv: true });
        $('#import-result').innerHTML = `<div class="notice ${r.errors.length ? 'warn' : 'ok'}" style="margin-top:12px"><span>${r.created} created, ${r.updated} updated, ${r.errors.length} error(s)</span></div>${r.errors.length ? `<ul class="diff-list">${r.errors.slice(0, 50).map((x) => `<li>Line ${x.line} (${esc(x.code)}): ${esc(x.error)}</li>`).join('')}</ul>` : ''}`;
        await refresh();
      } catch (err) { toast(err.message, true); }
    });
  });
};
A.template = () => {
  const csv = 'code,zone,row,position,rack_type,tier,planned_kw,max_kw,rack_pdu_kw,feed_a,feed_b,allocation,tenant\nDH1-A09-01,DH1-A,A09,1,compute,Standard density,8,10,11,PDU-1A1,PDU-1B1,unallocated,\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'rack-import-template.csv'; a.click();
};

function statusModal({ title, ids, intro = '' }) {
  const opts = S.meta.rack_status.map((s) => `<option value="${s}">${label(s)}</option>`).join('');
  modal(title, `${intro}<div class="form-grid"><label class="field">New status<select name="status">${opts}</select></label><label class="field">Milestone<input name="milestone" placeholder="e.g. Level 5 IST"></label><label class="field">Actual kW (for occupied)<input name="actual_kw" type="number" step="any" min="0"></label></div>
    <label class="field" style="margin-top:8px">Evidence reference (required for commissioned / handed over)<input name="evidence" placeholder="Test certificate / report reference"></label>
    <label class="field" style="margin-top:8px">Evidence attachment<input type="file" name="file"></label><div id="status-result"></div>`,
    `<span style="flex:1"></span><button type="button" class="btn" data-act="close-modal">Close</button><button class="btn primary" value="ok">Apply to ${typeof ids === 'function' ? 'selection' : ids.length + ' rack(s)'}</button>`, (d) => {
      $('#mform', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        try {
          const rackIds = typeof ids === 'function' ? ids(f) : ids;
          if (!rackIds.length) return toast('No racks match', true);
          const attachment_id = await uploadFile(f.file.files[0]);
          const r = await api('POST', '/api/commissioning/rack-status', { rack_ids: rackIds, status: f.status.value, milestone: f.milestone.value, evidence: f.evidence.value, actual_kw: f.actual_kw.value, attachment_id });
          $('#status-result').innerHTML = `<div class="notice ${r.blocked.length ? 'warn' : 'ok'}" style="margin-top:12px"><span>${r.updated.length} rack(s) updated · ${r.blocked.length} blocked by gates</span></div>${r.blocked.length ? `<ul class="diff-list">${r.blocked.slice(0, 40).map((b) => `<li><strong>${esc(b.code)}</strong>: ${esc(b.reasons.join('; '))}</li>`).join('')}</ul>` : ''}`;
          S.ui.rackSel.clear();
          await Promise.all([loadProject(), loadNotes()]); renderNav(location.hash.split('/')[1]);
          if (!r.blocked.length) { closeModal(); toast(`${r.updated.length} rack(s) updated`); await render(); }
        } catch (err) { toast(err.message, true); }
      });
    });
}
A['bulk-status'] = () => statusModal({ title: 'Update rack status', ids: [...S.ui.rackSel] });
A.milestone = () => {
  const zoneOpts = S.st.zones.map((z) => `<option value="${z.id}">${esc(L.hall.get(z.hall_id)?.code)} / ${esc(z.code)}</option>`).join('');
  statusModal({
    title: 'Record rack milestone',
    intro: `<div class="form-grid" style="margin-bottom:10px"><label class="field">Zone<select name="zone">${zoneOpts}</select></label><label class="field">Racks currently<select name="from">${S.meta.rack_status.map((s) => `<option value="${s}">${label(s)}</option>`).join('')}</select></label><label class="field">How many (in row / position order)<input name="count" type="number" min="1" value="10"></label></div>`,
    ids: (f) => S.st.racks.filter((r) => r.zone_id === Number(f.zone.value) && r.status === f.from.value).sort((a, b) => String(a.row).localeCompare(String(b.row)) || a.position - b.position).slice(0, Number(f.count.value) || 0).map((r) => r.id),
  });
};
A['bulk-edit'] = () => {
  const ids = [...S.ui.rackSel];
  const hallIds = new Set(ids.map((id) => L.rack.get(id)?.hall_id));
  const hallId = hallIds.size === 1 ? [...hallIds][0] : null;
  const fields = S.meta.entities.racks.fields.filter((f) => ['tier_id', 'rack_type', 'planned_kw', 'max_kw', 'rack_pdu_kw', 'feed_a_id', 'feed_b_id', 'allocation', 'tenant'].includes(f.name) && (hallId || !['tier_id'].includes(f.name)));
  modal(`Bulk edit ${ids.length} rack(s)`, `<p class="muted">Only fields you tick are changed.</p><div class="form-grid">${fields.map((fd) => `<div><label class="field check"><input type="checkbox" data-apply="${fd.name}"> Change ${esc(fd.label.toLowerCase())}</label>${fieldHtml('racks', fd, {}, { hall_id: hallId }, 'create')}</div>`).join('')}</div><label class="field" style="margin-top:8px">Reason for change<input name="_reason" data-type="text"></label>`, undefined, (d) => {
    $('#mform', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const all = readForm(e.target);
      const values = { _reason: all._reason };
      for (const cb of $$('[data-apply]', e.target)) if (cb.checked) values[cb.dataset.apply] = all[cb.dataset.apply];
      if (Object.keys(values).length < 2) return toast('Tick at least one field to change', true);
      try { await api('POST', '/api/racks/bulk-update', { ids, values }); closeModal(); toast(`${ids.length} racks updated`); await refresh(); } catch (err) { toast(err.message, true); }
    });
  });
};

A['asset-status'] = (el) => {
  const kind = el.dataset.kind, id = Number(el.dataset.id);
  const a = (kind === 'power' ? L.power : L.cooling).get(id);
  modal(`Commissioning status — ${a.code}`, `<p>Current: ${pill(a.status)}</p><div class="form-grid"><label class="field">New status<select name="status">${S.meta.asset_status.map((s) => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${label(s)}</option>`).join('')}</select></label><label class="field">Milestone<input name="milestone" placeholder="e.g. Level 4 functional test"></label></div>
    <label class="field" style="margin-top:8px">Evidence reference (required for commissioned and above)<input name="evidence"></label><label class="field" style="margin-top:8px">Evidence attachment<input type="file" name="file"></label>`, undefined, (d) => {
    $('#mform', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        const attachment_id = await uploadFile(f.file.files[0]);
        const r = await api('POST', '/api/commissioning/asset-status', { kind, ids: [id], status: f.status.value, milestone: f.milestone.value, evidence: f.evidence.value, attachment_id });
        if (r.blocked.length) return toast(`Blocked: ${r.blocked[0].reasons.join('; ')}`, true);
        closeModal(); toast('Status updated'); await refresh();
      } catch (err) { toast(err.message, true); }
    });
  });
};

A['submit-plan'] = () => {
  const b = S.st.baseline;
  modal(b ? 'Submit change request' : 'Submit baseline for approval', `<label class="field">Title *<input name="title" value="${b ? '' : 'Initial capacity baseline'}" placeholder="e.g. Zone C GPU density uplift"></label><label class="field" style="margin-top:8px">Justification / description of change<textarea name="justification" rows="4"></textarea></label>
    <p class="muted">The current working plan is snapshotted, validated, and routed to the required reviewers.${S.st.metrics.summary.blocking ? ` It currently has <strong>${S.st.metrics.summary.blocking} blocking exception(s)</strong>; the Design Manager will need to override them to approve.` : ''}</p>`,
    `<span style="flex:1"></span><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn primary" value="ok">Submit</button>`, (d) => {
      $('#mform', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!e.target.title.value.trim()) return toast('Title required', true);
        try { const p = await api('POST', `/api/projects/${S.pid}/plans`, { title: e.target.title.value, justification: e.target.justification.value }); closeModal(); toast(`Plan v${p.version} submitted`); location.hash = `#/plans/${p.id}`; await refresh(); } catch (err) { toast(err.message, true); }
      });
    });
};
A.review = (el) => {
  const approve = el.dataset.decision === 'approve';
  const blocking = Number(el.dataset.blocking || 0);
  const needOverride = approve && blocking > 0 && role() === 'design_manager';
  modal(approve ? 'Approve plan' : 'Reject plan', `${needOverride ? `<div class="notice crit"><span>⛔ This version failed <strong>${blocking}</strong> mandatory infrastructure validation(s). Approval requires a documented override (FR-058). The override is notified to the Design Manager, Project Manager and Auditor (AL-010).</span></div><label class="field">Override justification * (min. 20 characters)<textarea name="override" rows="3"></textarea></label>` : ''}
    <label class="field" style="margin-top:8px">Comment${approve ? '' : ' *'}<textarea name="comment" rows="3"></textarea></label>`,
    `<span style="flex:1"></span><button type="button" class="btn" data-act="close-modal">Cancel</button><button class="btn ${approve ? 'primary' : 'danger'}" value="ok">${approve ? (needOverride ? 'Approve with override' : 'Approve') : 'Reject'}</button>`, (d) => {
      $('#mform', d).addEventListener('submit', async (e) => {
        e.preventDefault();
        try { await api('POST', `/api/plans/${el.dataset.id}/review`, { decision: el.dataset.decision, comment: e.target.comment.value, override_justification: e.target.override?.value }); closeModal(); toast(approve ? 'Approval recorded' : 'Plan rejected'); await refresh(); } catch (err) { toast(err.message, true); }
      });
    });
};
A['new-user'] = () => modal('New user', `<div class="form-grid"><label class="field">Name *<input name="name"></label><label class="field">Email<input name="email"></label><label class="field">Role<select name="role">${Object.entries(S.meta.roles).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label class="field">Project access<select name="projects" multiple>${S.projects.map((p) => `<option value="${p.id}">${esc(p.code)}</option>`).join('')}</select><span class="help">None selected = all projects</span></label></div>`, undefined, (d) => {
  $('#mform', d).addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try { await api('POST', '/api/users', { name: f.name.value, email: f.email.value, role: f.role.value, project_ids: [...f.projects.selectedOptions].map((o) => Number(o.value)) }); S.users = await GET('/api/users'); closeModal(); await render(); } catch (err) { toast(err.message, true); }
  });
});

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && A[el.dataset.act] && !el.disabled) { e.preventDefault(); A[el.dataset.act](el, e); }
  if (e.target.closest('.sidenav a')) $('#sidenav').classList.remove('open');
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.sel) { const id = Number(t.dataset.sel); t.checked ? S.ui.rackSel.add(id) : S.ui.rackSel.delete(id); return render(); }
  if (t.dataset.filter) { const f = S.ui.rackFilter; f[t.dataset.filter] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.filter === 'hall') f.zone = ''; return render(); }
  if (t.dataset.exfilter) { S.ui.exFilter[t.dataset.exfilter] = t.value; return render(); }
  if (t.dataset.auditfilter) { S.ui.auditFilter[t.dataset.auditfilter] = t.value; return render(); }
  if (t.dataset.actChange === 'floor-mode') { S.ui.floorMode = t.value; return render(); }
  if (t.dataset.gate) { try { await api('PUT', `/api/zones/${t.dataset.id}`, { [t.dataset.gate]: t.checked }); toast('Gate updated'); await refresh(); } catch (err) { toast(err.message, true); await render(); } return; }
  if (t.dataset.userRole) { try { await api('PUT', `/api/users/${t.dataset.userRole}`, { role: t.value }); S.users = await GET('/api/users'); toast('Role updated'); renderTop(); } catch (err) { toast(err.message, true); } }
});
document.addEventListener('input', (e) => { if (e.target.dataset.filter === 'q') { clearTimeout(e.target._t); const v = e.target.value; e.target._t = setTimeout(async () => { S.ui.rackFilter.q = v; await render(); const i = $('[data-filter=q]'); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }, 250); } });

$('#project-select').addEventListener('change', async (e) => { S.pid = Number(e.target.value); localStorage.setItem('pid', S.pid); S.ui.rackSel.clear(); S.ui.rackFilter = null; await refresh(); });
$('#user-select').addEventListener('change', async (e) => { S.user = S.users.find((u) => u.id === Number(e.target.value)); localStorage.setItem('uid', S.user.id); $('#drawer').hidden = true; S.projects = await GET('/api/projects'); if (!S.projects.some((p) => p.id === S.pid)) S.pid = S.projects[0]?.id ?? null; await refresh(); toast(`Now acting as ${S.user.name} (${ROLE(S.user.role)})`); });
window.addEventListener('hashchange', () => { hideTip(); render(); window.scrollTo(0, 0); });

(async function boot() {
  try {
    [S.meta, S.users] = await Promise.all([GET('/api/meta'), GET('/api/users')]);
    const uid = Number(localStorage.getItem('uid'));
    S.user = S.users.find((u) => u.id === uid) || S.users.find((u) => u.role === 'design_manager') || S.users[0];
    S.projects = await GET('/api/projects');
    const pid = Number(localStorage.getItem('pid'));
    S.pid = S.projects.find((p) => p.id === pid)?.id ?? S.projects[0]?.id ?? null;
    await refresh();
  } catch (e) { $('#main').innerHTML = `<div class="card">${empty('Failed to start: ' + e.message)}</div>`; }
})();
