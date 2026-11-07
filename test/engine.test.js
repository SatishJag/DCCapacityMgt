import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute, effectiveUnits, powerUsableKw, coolingUsableKw, diffStates, assessImpact, planningHash } from '../server/engine.js';

const project = { id: 1, target_it_kw: 100, target_racks: 10, power_factor: 0.9, diversity_factor: 1, safety_margin_pct: 0, heat_factor: 1, reserved_alert_pct: 15, stranded_alert_pct: 10 };
const tiers = [
  { id: 1, hall_id: 1, name: 'Standard', max_kw: 10, cooling_methods: ['air', 'rdhx'], liquid: false },
  { id: 2, hall_id: 1, name: 'High', max_kw: 40, cooling_methods: ['rdhx', 'dlc'], liquid: false },
  { id: 3, hall_id: 1, name: 'Liquid', max_kw: 150, cooling_methods: ['dlc'], liquid: true },
];
function base() {
  return {
    project: { ...project },
    halls: [{ id: 1, code: 'H1', approved_it_kw: 40, approved_racks: 4, standard_density_kw: 10, power_redundancy: '2N', cooling_redundancy: 'N+1', required_ups_autonomy_min: 5, required_gen_runtime_h: 0 }],
    tiers: structuredClone(tiers),
    zones: [{ id: 1, hall_id: 1, code: 'Z1', allocated_it_kw: 40, design_density_kw: 10, rack_positions: 4, cooling_method: 'air', cabling_capacity_racks: 4, network_commissioned: true, safety_commissioned: true }],
    power: [
      { id: 1, code: 'UPS-A', type: 'UPS', parent_id: null, rating_per_unit: 50, rating_unit: 'kW', units: 1, redundancy: 'N', derating: 1, max_load_pct: 100, load_factor: 1, autonomy_min: 10, status: 'commissioned' },
      { id: 2, code: 'UPS-B', type: 'UPS', parent_id: null, rating_per_unit: 50, rating_unit: 'kW', units: 1, redundancy: 'N', derating: 1, max_load_pct: 100, load_factor: 1, autonomy_min: 10, status: 'commissioned' },
      { id: 3, code: 'PDU-A', type: 'PDU', parent_id: 1, rating_per_unit: 45, rating_unit: 'kW', units: 1, redundancy: 'N', derating: 1, max_load_pct: 100, status: 'commissioned' },
      { id: 4, code: 'PDU-B', type: 'PDU', parent_id: 2, rating_per_unit: 45, rating_unit: 'kW', units: 1, redundancy: 'N', derating: 1, max_load_pct: 100, status: 'commissioned' },
    ],
    cooling: [{ id: 1, code: 'CRAH', type: 'CRAH', hall_id: 1, zone_id: null, rating_per_unit_kw: 25, units: 3, redundancy: 'N+1', derating: 1, status: 'commissioned' }],
    racks: [1, 2, 3, 4].map((i) => ({ id: i, hall_id: 1, zone_id: 1, code: `R${i}`, row: 'A', position: i, tier_id: 1, planned_kw: 10, max_kw: 10, rack_pdu_kw: 11, feed_a_id: 3, feed_b_id: 4, status: 'planned', allocation: 'unallocated', actual_kw: 0 })),
  };
}
const rules = (m) => m.exceptions.map((e) => e.rule).sort();

test('redundancy-adjusted usable capacity', () => {
  assert.equal(effectiveUnits(5, 'N+1'), 4);
  assert.equal(effectiveUnits(4, '2N'), 2);
  assert.equal(effectiveUnits(5, '2N+1'), 2);
  assert.equal(powerUsableKw({ rating_per_unit: 500, rating_unit: 'kVA', units: 5, redundancy: 'N+1', derating: 0.95, max_load_pct: 90 }, { power_factor: 0.8, safety_margin_pct: 0 }), 500 * 0.8 * 4 * 0.95 * 0.9);
  assert.equal(coolingUsableKw({ rating_per_unit_kw: 100, units: 3, redundancy: 'N+1', derating: 0.9 }, { safety_margin_pct: 10 }), 100 * 2 * 0.9 * 0.9);
});

test('a plan within design limits produces no exceptions and correct §8 metrics', () => {
  const s = base();
  s.racks[0].status = 'occupied'; s.racks[0].actual_kw = 6;
  s.racks[1].status = 'commissioned';
  const m = compute(s);
  assert.deepEqual(rules(m), []);
  const h = m.halls[0];
  assert.equal(h.planned_kw, 40);
  assert.equal(h.avg_density_kw, 10);
  assert.equal(h.commissioned_racks, 2);
  assert.equal(h.occupied_pct, 50); // occupied / commissioned
  assert.equal(h.commissioned_pct, 50); // commissioned / planned
  assert.equal(h.available_kw, 34); // approved - occupied
  assert.equal(h.it_util_pct, 15);
  assert.equal(h.remaining_racks, 1);
  const pduA = m.power.find((p) => p.code === 'PDU-A');
  assert.equal(pduA.load_kw, 40); // failover: full load on each feed
  assert.equal(pduA.normal_kw, 20); // normal: half on each feed
});

test('hall IT load, rack count, space and cabling breaches', () => {
  const s = base();
  s.racks.push({ ...s.racks[0], id: 5, code: 'R5' });
  const m = compute(s);
  assert.ok(rules(m).includes('LOAD-HALL'));
  assert.ok(rules(m).includes('RACKS-HALL'));
  assert.ok(rules(m).includes('SPACE-ZONE'));
  assert.ok(rules(m).includes('CAB-ZONE'));
  assert.ok(rules(m).includes('LOAD-ZONE'));
  assert.equal(m.exceptions.find((e) => e.rule === 'LOAD-HALL').alert, 'AL-001');
});

test('A/B feed allocation exceeding PDU capacity is checked per feed (AL-005)', () => {
  const s = base();
  s.power[2].rating_per_unit = 30; // PDU-A only
  const m = compute(s);
  const ex = m.exceptions.filter((e) => e.rule === 'PWR-ASSET');
  assert.equal(ex.length, 1);
  assert.match(ex[0].message, /PDU-A/);
  assert.equal(ex[0].alert, 'AL-005');
});

test('density above tier requires a supported cooling methodology and liquid readiness', () => {
  const s = base();
  s.racks[0].planned_kw = 45; s.racks[0].max_kw = 50; s.racks[0].rack_pdu_kw = 50;
  s.halls[0].approved_it_kw = 100; s.zones[0].allocated_it_kw = 100; s.project.stranded_alert_pct = 100;
  s.power[2].rating_per_unit = 100; s.power[3].rating_per_unit = 100; s.power[0].rating_per_unit = 100; s.power[1].rating_per_unit = 100;
  s.cooling[0].rating_per_unit_kw = 50;
  const m = compute(s);
  assert.deepEqual(rules(m), ['COOL-LIQ', 'COOL-METHOD', 'DENS-TIER']);
  assert.ok(m.rack_flags[1].length === 3);
  s.zones[0].cooling_method = 'dlc';
  Object.assign(s.zones[0], { lc_cdu: true, lc_pipework: true, lc_leak_detection: true, lc_clearance: true, lc_ops_approval: true });
  s.racks[0].tier_id = 3;
  s.tiers[0].cooling_methods = ['air', 'dlc'];
  assert.deepEqual(rules(compute(s)), []);
});

test('cooling capacity, commissioned cooling (AL-007) and cooling redundancy', () => {
  const s = base();
  s.cooling[0].units = 2; // N+1 of 2 => 25 kW usable vs 40 kW heat
  let m = compute(s);
  assert.ok(rules(m).includes('COOL-ZONE') || rules(m).includes('COOL-HALL'));
  s.cooling[0].units = 3; s.cooling[0].status = 'installed';
  s.racks[0].status = 'commissioned';
  m = compute(s);
  assert.ok(rules(m).includes('COOL-COMM'));
  s.cooling[0].status = 'commissioned'; s.cooling[0].redundancy = 'N'; s.cooling[0].units = 2;
  m = compute(s);
  assert.ok(rules(m).includes('COOL-RED'));
});

test('single points of failure and UPS autonomy against a 2N requirement', () => {
  const s = base();
  s.racks[0].feed_b_id = null;
  s.racks[1].feed_b_id = 3; // A and B on the same PDU
  s.power[0].autonomy_min = 2;
  const m = compute(s);
  const spof = m.exceptions.find((e) => e.rule === 'PWR-SPOF');
  assert.match(spof.message, /2 rack/);
  assert.ok(rules(m).includes('PWR-AUTONOMY'));
});

test('racks released on uncommissioned infrastructure are flagged; occupied above commissioned (AL-006)', () => {
  const s = base();
  s.power[2].status = 'installed';
  s.racks[0].status = 'commissioned';
  assert.ok(rules(compute(s)).includes('COMM-GATE'));
  const t = base();
  t.racks[0].status = 'occupied'; t.racks[0].actual_kw = 12;
  const m = compute(t);
  assert.ok(rules(m).includes('OPS-OVER'));
  assert.ok(rules(m).includes('OPS-RACK'));
});

test('stranded capacity when cooling limits deliverable load', () => {
  const s = base();
  s.halls[0].approved_it_kw = 40;
  s.cooling[0].units = 2; s.cooling[0].redundancy = 'N+1'; s.halls[0].cooling_redundancy = 'N+1';
  const m = compute(s);
  const h = m.halls[0];
  assert.equal(h.deliverable_kw, 25);
  assert.equal(h.stranded.power_kw, 15);
  assert.ok(rules(m).includes('STRANDED'));
});

test('diff, planning hash and change impact routing', () => {
  const a = base(), b = base();
  b.racks[0].planned_kw = 20; b.racks[0].status = 'installed';
  a.racks[0].status = 'installed';
  const d = diffStates(a, b);
  assert.equal(d.total, 1);
  assert.deepEqual(d.racks.changed[0].fields.planned_kw, [10, 20]);
  assert.notEqual(planningHash(a), planningHash(b));
  const c = base(); c.racks[0].status = 'occupied'; c.racks[0].actual_kw = 5;
  assert.equal(planningHash(base()), planningHash(c), 'operational fields do not change the planning hash');
  b.project.cost_per_kw = 1000;
  const imp = assessImpact(a, b);
  assert.equal(imp.impact.planned_kw_delta, 10);
  assert.equal(imp.impact.cost_delta, 10000);
  assert.equal(imp.impact.commissioning_rework_racks, 1);
  assert.ok(imp.change_types.includes('load'));
  for (const r of ['design_manager', 'electrical', 'mechanical', 'commercial', 'project_manager']) assert.ok(imp.required_roles.includes(r), r);
});
