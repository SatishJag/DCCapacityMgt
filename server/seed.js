// Demo data: one Day-1 air/RDHx hall partly commissioned and occupied, one Phase-2
// liquid-cooled AI hall, an approved baseline (with a documented override), and a
// post-baseline density change that the validation engine flags.
import { createEntity, updateEntity, createHall, rackPlan, submitPlan, reviewPlan, updateRackStatus, updateAssetStatus } from './app.js';
import { syncExceptions, tx } from './db.js';

const USERS = [
  ['Morgan Hale', 'admin'], ['Priya Nair', 'project_manager'], ['Daniel Okafor', 'design_manager'], ['Elena Rossi', 'electrical'],
  ['Tom Becker', 'mechanical'], ['Aisha Khan', 'ict'], ['Liam Walsh', 'planner'], ['Sofia Marin', 'commissioning'],
  ['Ken Watanabe', 'operations'], ['Grace Lin', 'commercial'], ['Robert Adeyemi', 'executive'], ['Hannah Schmidt', 'auditor'],
];

export function seedUsers(db) {
  if (db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  const st = db.prepare('INSERT INTO users (name, email, role) VALUES (?,?,?)');
  for (const [name, role] of USERS) st.run(name, `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, role);
}

export function seedDemo(db) {
  seedUsers(db);
  const u = Object.fromEntries(db.prepare('SELECT * FROM users').all().map((x) => [x.role, x]));
  const admin = u.admin;
  const id = (table, code, col = 'code') => db.prepare(`SELECT id FROM ${table} WHERE ${col} = ?`).get(code)?.id;

  tx(db, () => {
    const p = createEntity(db, u.project_manager, 'projects', {
      code: 'LON-DC1', name: 'London Campus — Building 1', campus: 'Park Royal Campus', location: 'United Kingdom, London', owner: 'Example Digital Infrastructure Ltd',
      stage: 'commissioning', status: 'active', target_it_kw: 4000, target_racks: 200, day1_it_kw: 1600, reserved_it_kw: 400, ultimate_it_kw: 6000,
      power_factor: 0.8, diversity_factor: 0.9, safety_margin_pct: 5, heat_factor: 1, design_pue: 1.3, reserved_alert_pct: 15, stranded_alert_pct: 10,
      commercial_threshold_kw: 50, currency: 'GBP', cost_per_kw: 9500, cost_per_rack: 4200,
    }, {}, 'seed');
    const P = { project_id: p.id };

    const dh1 = createHall(db, u.planner, p.id, { code: 'DH1', name: 'Data Hall 1', building: 'B1', floor: 'L1', phase: 'day1', status: 'commissioned', white_space_m2: 1200, used_space_m2: 640, approved_racks: 160, approved_it_kw: 1600, peak_it_kw: 1700, standard_density_kw: 8, power_redundancy: '2N', ups_topology: 'Modular double-conversion', required_ups_autonomy_min: 5, required_gen_runtime_h: 24, cooling_redundancy: 'N+1', containment: 'hot_aisle' });
    const dh2 = createHall(db, u.planner, p.id, { code: 'DH2', name: 'Data Hall 2 — AI', building: 'B1', floor: 'L2', phase: 'phase2', status: 'under_construction', white_space_m2: 900, approved_racks: 40, approved_it_kw: 2400, peak_it_kw: 2400, standard_density_kw: 80, power_redundancy: '2N', ups_topology: 'Modular double-conversion', required_ups_autonomy_min: 5, required_gen_runtime_h: 24, cooling_redundancy: 'N+1', containment: 'hot_aisle' });
    const tier = (hall, name) => db.prepare('SELECT id FROM density_tiers WHERE hall_id = ? AND name = ?').get(hall.id, name).id;

    const Z = (hall, b) => createEntity(db, u.planner, 'zones', b, { project_id: p.id, hall_id: hall.id }, 'seed');
    const zA = Z(dh1, { code: 'DH1-A', name: 'Zone A — standard', allocated_it_kw: 640, design_density_kw: 8, rack_positions: 84, cooling_method: 'air', containment: 'hot_aisle', airflow: 'Front-to-back, hot aisle contained', cabling_capacity_racks: 84, network_zone: 'MMR-1 → MDF-1 → IDF-1A', pathway: 'overhead' });
    const zB = Z(dh1, { code: 'DH1-B', name: 'Zone B — standard', allocated_it_kw: 480, design_density_kw: 8, rack_positions: 64, cooling_method: 'air', containment: 'hot_aisle', airflow: 'Front-to-back, hot aisle contained', cabling_capacity_racks: 64, network_zone: 'MMR-1 → MDF-1 → IDF-1B', pathway: 'overhead' });
    const zC = Z(dh1, { code: 'DH1-C', name: 'Zone C — high density', allocated_it_kw: 480, design_density_kw: 30, rack_positions: 18, cooling_method: 'rdhx', containment: 'hot_aisle', airflow: 'Rear-door heat exchangers', cabling_capacity_racks: 16, network_zone: 'MMR-1 → MDF-1 → IDF-1C', pathway: 'overhead' });
    const zL = Z(dh2, { code: 'DH2-L1', name: 'Liquid pod L1', allocated_it_kw: 1920, design_density_kw: 80, rack_positions: 30, cooling_method: 'dlc', containment: 'hot_aisle', airflow: 'Residual heat to CRAH', cabling_capacity_racks: 30, network_zone: 'MMR-2 → MDF-2 → IDF-2L', pathway: 'overhead', lc_cdu: true, lc_pipework: true, lc_leak_detection: true, lc_clearance: true, lc_ops_approval: false });
    const zN = Z(dh2, { code: 'DH2-N1', name: 'Network row', allocated_it_kw: 40, design_density_kw: 5, rack_positions: 10, cooling_method: 'air', containment: 'cold_aisle', cabling_capacity_racks: 10, network_zone: 'MDF-2', pathway: 'overhead' });

    const PA = (b) => createEntity(db, u.electrical, 'power_assets', b, P, 'seed');
    const util = PA({ code: 'UTIL-1', name: '33 kV utility intake', type: 'UTILITY', rating_per_unit: 15000, rating_unit: 'kVA', units: 1, redundancy: 'N', load_factor: 1.3 });
    const txA = PA({ code: 'TX-1', name: 'Transformer A', type: 'TRANSFORMER', parent_id: util.id, rating_per_unit: 6500, rating_unit: 'kVA', units: 1, max_load_pct: 90, load_factor: 1.3 });
    const txB = PA({ code: 'TX-2', name: 'Transformer B', type: 'TRANSFORMER', parent_id: util.id, rating_per_unit: 6500, rating_unit: 'kVA', units: 1, max_load_pct: 90, load_factor: 1.3 });
    const lvA = PA({ code: 'LV-A', name: 'LV switchboard A', type: 'SWITCHGEAR', parent_id: txA.id, rating_per_unit: 6000, rating_unit: 'kW', units: 1, max_load_pct: 90, load_factor: 1.3 });
    const lvB = PA({ code: 'LV-B', name: 'LV switchboard B', type: 'SWITCHGEAR', parent_id: txB.id, rating_per_unit: 6000, rating_unit: 'kW', units: 1, max_load_pct: 90, load_factor: 1.3 });
    PA({ code: 'GEN-PLANT', name: 'Standby generator plant', type: 'GENERATOR', rating_per_unit: 2000, rating_unit: 'kVA', units: 6, redundancy: 'N+1', max_load_pct: 90, load_factor: 1.3, fuel_autonomy_h: 48 });
    const ups1A = PA({ code: 'UPS-1A', name: 'DH1 UPS system A', type: 'UPS', hall_id: dh1.id, parent_id: lvA.id, rating_per_unit: 500, units: 5, redundancy: 'N+1', max_load_pct: 90, autonomy_min: 7 });
    const ups1B = PA({ code: 'UPS-1B', name: 'DH1 UPS system B', type: 'UPS', hall_id: dh1.id, parent_id: lvB.id, rating_per_unit: 500, units: 5, redundancy: 'N+1', max_load_pct: 90, autonomy_min: 7 });
    const ups2A = PA({ code: 'UPS-2A', name: 'DH2 UPS system A', type: 'UPS', hall_id: dh2.id, parent_id: lvA.id, rating_per_unit: 500, units: 6, redundancy: 'N+1', max_load_pct: 90, autonomy_min: 6 });
    const ups2B = PA({ code: 'UPS-2B', name: 'DH2 UPS system B', type: 'UPS', hall_id: dh2.id, parent_id: lvB.id, rating_per_unit: 500, units: 6, redundancy: 'N+1', max_load_pct: 90, autonomy_min: 6 });
    const dist = (code, name, type, hall, parent, kw) => PA({ code, name, type, hall_id: hall.id, parent_id: parent.id, rating_per_unit: kw, units: 1, max_load_pct: 90 });
    const pdu1A1 = dist('PDU-1A1', 'Zone A PDU (A)', 'PDU', dh1, ups1A, 800), pdu1B1 = dist('PDU-1B1', 'Zone A PDU (B)', 'PDU', dh1, ups1B, 800);
    const pdu1A2 = dist('PDU-1A2', 'Zone B PDU (A)', 'PDU', dh1, ups1A, 600), pdu1B2 = dist('PDU-1B2', 'Zone B PDU (B)', 'PDU', dh1, ups1B, 600);
    const bw1A3 = dist('BW-1A3', 'Zone C busway (A)', 'BUSWAY', dh1, ups1A, 600), bw1B3 = dist('BW-1B3', 'Zone C busway (B)', 'BUSWAY', dh1, ups1B, 600);
    const bw2A1 = dist('BW-2A1', 'L01–L02 busway (A)', 'BUSWAY', dh2, ups2A, 1600), bw2B1 = dist('BW-2B1', 'L01–L02 busway (B)', 'BUSWAY', dh2, ups2B, 1600);
    const bw2A2 = dist('BW-2A2', 'L03 busway (A)', 'BUSWAY', dh2, ups2A, 1000), bw2B2 = dist('BW-2B2', 'L03 busway (B)', 'BUSWAY', dh2, ups2B, 1000);
    const pdu2A3 = dist('PDU-2A3', 'Network row PDU (A)', 'PDU', dh2, ups2A, 100), pdu2B3 = dist('PDU-2B3', 'Network row PDU (B)', 'PDU', dh2, ups2B, 100);

    const CA = (b) => createEntity(db, u.mechanical, 'cooling_assets', b, P, 'seed');
    CA({ code: 'CRAH-1', name: 'DH1 perimeter CRAH group', type: 'CRAH', technology: 'chilled_water', hall_id: dh1.id, rating_per_unit_kw: 200, units: 8, redundancy: 'N+1', derating: 0.95 });
    CA({ code: 'RDHX-1C', name: 'Zone C rear-door HX', type: 'RDHX', technology: 'rdhx', hall_id: dh1.id, zone_id: zC.id, rating_per_unit_kw: 35, units: 17, redundancy: 'N+1' });
    CA({ code: 'CDU-2L', name: 'Pod L1 CDUs', type: 'CDU', technology: 'dlc', hall_id: dh2.id, zone_id: zL.id, rating_per_unit_kw: 400, units: 6, redundancy: 'N+1', derating: 0.95 });
    CA({ code: 'CRAH-2', name: 'DH2 residual-heat CRAH', type: 'CRAH', technology: 'chilled_water', hall_id: dh2.id, rating_per_unit_kw: 150, units: 4, redundancy: 'N+1' });

    const plan = (hall, zone, rows, per, b) => rackPlan(db, u.planner, hall, { zone_id: zone.id, rows, racks_per_row: per, ...b });
    plan(dh1, zA, 'A01 A02 A03 A04 A05 A06 A07 A08', 10, { tier_id: tier(dh1, 'Standard density'), planned_kw: 8, max_kw: 10, rack_pdu_kw: 11, feed_a_id: pdu1A1.id, feed_b_id: pdu1B1.id });
    plan(dh1, zB, 'B01 B02 B03 B04 B05 B06', 10, { tier_id: tier(dh1, 'Standard density'), planned_kw: 8, max_kw: 10, rack_pdu_kw: 11, feed_a_id: pdu1A2.id, feed_b_id: pdu1B2.id });
    plan(dh1, zC, 'C01 C02', 8, { tier_id: tier(dh1, 'High density'), planned_kw: 30, max_kw: 40, rack_pdu_kw: 36, feed_a_id: bw1A3.id, feed_b_id: bw1B3.id });
    const liquid = tier(dh2, 'Liquid-cooled high density');
    plan(dh2, zL, 'L01 L02', 8, { tier_id: liquid, planned_kw: 80, max_kw: 100, rack_pdu_kw: 100, feed_a_id: bw2A1.id, feed_b_id: bw2B1.id, allocation: 'reserved', tenant: 'Tenant Gamma (AI)' });
    plan(dh2, zL, 'L03', 8, { tier_id: liquid, planned_kw: 80, max_kw: 100, rack_pdu_kw: 100, feed_a_id: bw2A2.id, feed_b_id: bw2B2.id, allocation: 'reserved', tenant: 'Tenant Gamma (AI)' });
    plan(dh2, zN, 'N01', 8, { tier_id: tier(dh2, 'Standard density'), rack_type: 'network', planned_kw: 5, max_kw: 8, rack_pdu_kw: 11, feed_a_id: pdu2A3.id, feed_b_id: pdu2B3.id });

    for (const [period, f, c] of [['2026-Q3', 300, 240], ['2026-Q4', 480, 400], ['2027-Q1', 800, 640], ['2027-Q2', 1100, 900], ['2027-Q3', 1600, 1200], ['2027-Q4', 2200, 1500], ['2028-Q2', 3000, 1900], ['2028-Q4', 3600, 2100]]) {
      createEntity(db, u.planner, 'forecasts', { period, forecast_kw: f, committed_kw: c }, P, 'seed');
    }

    // Baseline approval (with a documented override for the outstanding liquid-cooling ops approval)
    const base = submitPlan(db, u.planner, p.id, { title: 'Initial capacity baseline', justification: 'Design freeze at detailed design stage (RIBA 4).' });
    reviewPlan(db, u.design_manager, base.id, { decision: 'approve', comment: 'Baseline approved.', override_justification: 'DH2 liquid-cooling operational approval is a Phase 2 handover item; tracked on the DH2 risk register (R-114).' });

    // Commissioning progress
    const ev = 'IST-DH1-001 integrated systems test report';
    const C = u.commissioning;
    for (const code of ['UTIL-1', 'TX-1', 'TX-2', 'LV-A', 'LV-B', 'GEN-PLANT', 'UPS-1A', 'UPS-1B', 'PDU-1A1', 'PDU-1B1']) updateAssetStatus(db, C, { kind: 'power', ids: [id('power_assets', code)], status: 'commissioned', evidence: ev, milestone: 'Level 5 IST' });
    for (const code of ['PDU-1A2', 'PDU-1B2', 'BW-1A3', 'BW-1B3']) updateAssetStatus(db, C, { kind: 'power', ids: [id('power_assets', code)], status: 'installed', milestone: 'Level 2 installation' });
    updateAssetStatus(db, C, { kind: 'cooling', ids: [id('cooling_assets', 'CRAH-1')], status: 'commissioned', evidence: 'MECH-DH1-CX-07 CRAH performance test', milestone: 'Level 4 functional' });
    updateEntity(db, C, 'zones', zA.id, { network_commissioned: true, safety_commissioned: true }, 'seed');
    const rack = (code) => id('racks', code);
    const zoneA = db.prepare('SELECT id, code FROM racks WHERE zone_id = ? ORDER BY row, position').all(zA.id);
    const zoneB = db.prepare('SELECT id FROM racks WHERE zone_id = ? ORDER BY row, position').all(zB.id);
    updateRackStatus(db, C, { rack_ids: zoneA.map((r) => r.id), status: 'installed', milestone: 'Rack installation' });
    updateRackStatus(db, C, { rack_ids: zoneB.slice(0, 20).map((r) => r.id), status: 'installed', milestone: 'Rack installation' });
    updateRackStatus(db, C, { rack_ids: zoneA.slice(0, 60).map((r) => r.id), status: 'commissioned', evidence: 'CX-DH1-A rack power & thermal test', milestone: 'Level 5 IST' });
    updateRackStatus(db, C, { rack_ids: zoneA.slice(0, 40).map((r) => r.id), status: 'handed_over', evidence: 'HO-DH1-A-01 handover certificate', milestone: 'Handover tranche 1' });
    for (const [i, r] of zoneA.slice(0, 30).entries()) {
      updateEntity(db, u.operations, 'racks', r.id, { allocation: 'sold', tenant: 'Tenant Alpha' }, 'seed');
      updateRackStatus(db, u.operations, { rack_ids: [r.id], status: 'occupied', actual_kw: [5.2, 6.1, 6.8, 7.4, 5.9][i % 5], milestone: 'Customer go-live' });
    }
    for (const r of zoneA.slice(30, 40)) updateEntity(db, u.operations, 'racks', r.id, { allocation: 'reserved', tenant: 'Tenant Beta' }, 'seed');

    // Post-baseline design change: two Zone C racks uplifted to 45 kW (GPU refresh)
    for (const code of ['DH1-C01-07', 'DH1-C01-08']) updateEntity(db, u.planner, 'racks', rack(code), { planned_kw: 45, _reason: 'Tenant GPU refresh request' }, 'ui');

    // A second, early-stage project for the portfolio view
    const p2 = createEntity(db, u.project_manager, 'projects', { code: 'MAN-DC2', name: 'Manchester Edge Facility', location: 'United Kingdom, Manchester', owner: 'Example Digital Infrastructure Ltd', stage: 'concept', status: 'draft', target_it_kw: 1200, target_racks: 120, day1_it_kw: 600, ultimate_it_kw: 2400 }, {}, 'seed');
    createHall(db, u.planner, p2.id, { code: 'MH1', name: 'Hall 1', building: 'Main', floor: 'GF', phase: 'day1', white_space_m2: 700, approved_racks: 120, approved_it_kw: 1200, standard_density_kw: 10, power_redundancy: 'N+1', cooling_redundancy: 'N+1' });
    syncExceptions(db, p.id); syncExceptions(db, p2.id);
  });
  return db;
}
