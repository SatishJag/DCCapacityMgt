import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';

let server, base, db, U;
before(async () => {
  db = openDb(':memory:');
  seedDemo(db);
  U = Object.fromEntries(db.prepare('SELECT id, role FROM users').all().map((u) => [u.role, u.id]));
  server = http.createServer(createApp(db, { publicDir: '/nonexistent', uploadDir: '/tmp/dc-cap-test-uploads' }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(role, method, url, body, csv = false) {
  const res = await fetch(base + url, { method, headers: { 'X-User-Id': String(U[role] ?? ''), 'Content-Type': csv ? 'text/csv' : 'application/json' }, body: body === undefined ? undefined : csv ? body : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const rackId = (code) => db.prepare('SELECT id FROM racks WHERE code = ?').get(code).id;

test('authentication and read-only roles', async () => {
  assert.equal((await call(null, 'GET', '/api/projects')).status, 401);
  assert.equal((await call('executive', 'GET', '/api/projects')).status, 200);
  assert.equal((await call('auditor', 'PUT', `/api/racks/${rackId('DH1-B03-01')}`, { planned_kw: 9 })).status, 403);
});

test('field-level permissions', async () => {
  const r = await call('operations', 'PUT', `/api/racks/${rackId('DH1-B03-01')}`, { planned_kw: 9 });
  assert.equal(r.status, 403);
  assert.match(r.body.error, /Planned kW/);
  assert.equal((await call('operations', 'PUT', `/api/racks/${rackId('DH1-B03-01')}`, { tenant: 'X', allocation: 'reserved' })).status, 200);
});

test('seeded demo has an approved baseline with override and live exceptions', async () => {
  const st = (await call('design_manager', 'GET', '/api/projects/1/state')).body;
  assert.equal(st.baseline.version, 1);
  assert.equal(st.baseline.in_sync, false);
  assert.ok(st.metrics.summary.blocking >= 6);
  const ex = (await call('design_manager', 'GET', '/api/projects/1/exceptions')).body;
  assert.ok(ex.some((e) => e.rule === 'LOAD-HALL' && e.alert === 'AL-001'));
  const notes = (await call('design_manager', 'GET', '/api/notifications')).body;
  assert.ok(notes.items.some((n) => n.alert === 'AL-010'));
});

test('change request: routing, segregation, override gate, approval to baseline', async () => {
  const sub = await call('planner', 'POST', '/api/projects/1/plans', { title: 'Zone C uplift' });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const plan = sub.body;
  assert.equal(plan.kind, 'change_request');
  assert.deepEqual(plan.required_roles.sort(), ['commercial', 'design_manager', 'electrical', 'mechanical']);
  assert.equal(plan.impact.planned_kw_delta, 30);
  assert.equal((await call('planner', 'POST', '/api/projects/1/plans', { title: 'dup' })).status, 409);
  assert.equal((await call('planner', 'POST', `/api/plans/${plan.id}/review`, { decision: 'approve' })).status, 403);
  const blocked = await call('design_manager', 'POST', `/api/plans/${plan.id}/review`, { decision: 'approve' });
  assert.equal(blocked.status, 422);
  for (const r of ['electrical', 'mechanical', 'commercial']) assert.equal((await call(r, 'POST', `/api/plans/${plan.id}/review`, { decision: 'approve', comment: 'ok' })).status, 200);
  const ok = await call('design_manager', 'POST', `/api/plans/${plan.id}/review`, { decision: 'approve', override_justification: 'Accepted temporarily pending liquid retrofit (CR-22).' });
  assert.equal(ok.body.status, 'approved');
  const st = (await call('design_manager', 'GET', '/api/projects/1/state')).body;
  assert.equal(st.baseline.version, plan.version);
  assert.equal(st.baseline.in_sync, true);
  assert.equal((await call('planner', 'POST', '/api/projects/1/plans', { title: 'nothing' })).status, 400);
});

test('stale plans cannot be approved', async () => {
  await call('planner', 'PUT', `/api/racks/${rackId('DH1-B06-10')}`, { planned_kw: 7 });
  const plan = (await call('planner', 'POST', '/api/projects/1/plans', { title: 'B06 tweak' })).body;
  await call('planner', 'PUT', `/api/racks/${rackId('DH1-B06-10')}`, { planned_kw: 6 });
  const r = await call('design_manager', 'POST', `/api/plans/${plan.id}/review`, { decision: 'approve', override_justification: 'x'.repeat(30) });
  assert.equal(r.status, 409);
  assert.equal((await call('design_manager', 'POST', `/api/plans/${plan.id}/review`, { decision: 'reject', comment: 'stale' })).body.status, 'rejected');
});

test('commissioning gates: evidence, upstream power, network/safety, occupancy', async () => {
  const b = rackId('DH1-B01-01'), a = rackId('DH1-A07-05');
  assert.equal((await call('commissioning', 'POST', '/api/commissioning/rack-status', { rack_ids: [a], status: 'commissioned' })).status, 400);
  let r = (await call('commissioning', 'POST', '/api/commissioning/rack-status', { rack_ids: [a, b], status: 'commissioned', evidence: 'CX-1' })).body;
  assert.deepEqual(r.updated.map((x) => x.code), ['DH1-A07-05']);
  assert.match(r.blocked[0].reasons.join(), /PDU-1A2 is installed/);
  r = (await call('operations', 'POST', '/api/commissioning/rack-status', { rack_ids: [a], status: 'occupied', actual_kw: 5 })).body;
  assert.match(r.blocked[0].reasons.join(), /next step is handed_over/);
  assert.equal((await call('operations', 'POST', '/api/commissioning/rack-status', { rack_ids: [a], status: 'installed' })).status, 403);
  const noEvidence = await call('commissioning', 'POST', '/api/commissioning/asset-status', { kind: 'power', ids: [db.prepare("SELECT id FROM power_assets WHERE code='PDU-1A2'").get().id], status: 'commissioned' });
  assert.equal(noEvidence.status, 400);
  assert.match(noEvidence.body.error, /evidence/i);
  const hist = (await call('auditor', 'GET', '/api/projects/1/history')).body;
  assert.ok(hist.some((h) => h.entity_code === 'DH1-A07-05' && h.to_status === 'commissioned' && h.evidence === 'CX-1'));
});

test('rack plan generation, CSV import and exports', async () => {
  const gen = await call('planner', 'POST', '/api/data-halls/2/rack-plan', { zone_id: db.prepare("SELECT id FROM zones WHERE code='DH2-N1'").get().id, rows: 'N02', racks_per_row: 2, planned_kw: 5, max_kw: 8 });
  assert.equal(gen.body.created, 2);
  const csv = 'code,zone,row,position,tier,planned_kw,max_kw,feed_a,feed_b\nDH2-N02-01,DH2-N1,N02,1,Standard density,6,8,PDU-2A3,PDU-2B3\nDH2-N09-01,NOPE,N09,1,,5,8,,\n';
  const imp = (await call('planner', 'POST', '/api/data-halls/2/racks/import', csv, true)).body;
  assert.equal(imp.updated, 1);
  assert.equal(imp.errors.length, 1);
  assert.match(imp.errors[0].error, /unknown zone/);
  const res = await fetch(`${base}/api/reports/utilisation?project_id=1&format=csv`, { headers: { 'X-User-Id': String(U.executive) } });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(await res.text(), /^level,hall,zone,planned_racks/);
  const audit = (await call('auditor', 'GET', '/api/audit?project_id=1&limit=50')).body;
  assert.ok(audit.some((a) => a.action === 'import' && a.source === 'excel-import'));
});
