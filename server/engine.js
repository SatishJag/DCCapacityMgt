// Capacity Engine + Validation Engine (spec §8). Pure functions over a project
// "state" object: { project, halls, tiers, zones, racks, power, cooling }.
// Works identically on live data and on plan snapshots.

import { PLANNING_FIELDS, STATE_COLLECTIONS } from './schema.js';

export const RACK_FLOW = ['planned', 'installed', 'commissioned', 'handed_over', 'occupied'];
export const ASSET_FLOW = ['planned', 'installed', 'pre_commissioned', 'commissioned', 'integrated_tested', 'operational'];
export const rIdx = (s) => RACK_FLOW.indexOf(s); // decommissioned => -1
export const aIdx = (s) => ASSET_FLOW.indexOf(s);
export const assetCommissioned = (a) => aIdx(a?.status) >= aIdx('commissioned');

const RANK = { N: 0, 'N+1': 1, 'N+2': 2, DR: 2, BR: 2, '2N': 3, '2N+1': 4 };
const DUAL_PATH = new Set(['2N', '2N+1', 'DR', 'BR']);
const UPSTREAM = new Set(['UTILITY', 'TRANSFORMER', 'SWITCHGEAR', 'GENERATOR', 'UPS']);
const DISTRIBUTION = new Set(['PDU', 'RPP', 'BUSWAY', 'RACK_PDU']);

const n = (v, d = 0) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const sum = (arr, fn) => arr.reduce((t, x) => t + n(fn(x)), 0);
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
const fmt = (v) => `${Math.round(n(v)).toLocaleString('en-GB')} kW`;

/** Units available to carry load after redundant units are set aside. */
export function effectiveUnits(units, redundancy) {
  const u = Math.max(0, n(units, 1));
  switch (redundancy) {
    case 'N+1': case 'DR': case 'BR': return Math.max(0, u - 1);
    case 'N+2': return Math.max(0, u - 2);
    case '2N': return u / 2;
    case '2N+1': return Math.max(0, (u - 1) / 2);
    default: return u;
  }
}

export function powerUsableKw(a, p) {
  const pf = a.rating_unit === 'kVA' ? n(p.power_factor, 0.9) : 1;
  return n(a.rating_per_unit) * pf * effectiveUnits(a.units, a.redundancy) * n(a.derating, 1) *
    (n(a.max_load_pct, 100) / 100) * (1 - n(p.safety_margin_pct) / 100);
}

export function coolingUsableKw(c, p) {
  return n(c.rating_per_unit_kw) * effectiveUnits(c.units, c.redundancy) * n(c.derating, 1) * (1 - n(p.safety_margin_pct) / 100);
}

// Rule catalogue: rule -> alert mapping (spec §7.11), discipline, recipients, severity.
export const RULES = {
  'LOAD-PROJECT': { alert: 'AL-001', ref: 'FR-018', discipline: 'design', severity: 'blocking', to: ['design_manager', 'project_manager'], title: 'Hall IT load exceeds project approved IT load' },
  'LOAD-HALL': { alert: 'AL-001', ref: '8.1', discipline: 'design', severity: 'blocking', to: ['design_manager', 'electrical'], title: 'Planned IT load exceeds approved data hall IT load' },
  'LOAD-ZONE': { alert: 'AL-001', ref: 'FR-009', discipline: 'design', severity: 'warning', to: ['design_manager', 'planner'], title: 'Zone planned load exceeds zone allocation' },
  'RACKS-PROJECT': { alert: 'AL-004', ref: 'FR-024', discipline: 'space', severity: 'warning', to: ['planner', 'design_manager'], title: 'Rack count exceeds project target' },
  'RACKS-HALL': { alert: 'AL-004', ref: 'FR-023', discipline: 'space', severity: 'blocking', to: ['planner', 'design_manager'], title: 'Rack count exceeds approved hall layout' },
  'SPACE-ZONE': { alert: 'AL-004', ref: 'FR-034', discipline: 'space', severity: 'blocking', to: ['planner', 'design_manager'], title: 'Racks exceed zone rack positions' },
  'SPACE-AREA': { alert: null, ref: 'FR-033', discipline: 'space', severity: 'warning', to: ['planner'], title: 'Used white space exceeds available white space' },
  'DENS-TIER': { alert: 'AL-002', ref: 'FR-035', discipline: 'design', severity: 'blocking', to: ['design_manager', 'mechanical'], title: 'Rack load exceeds its density tier' },
  'DENS-NOTIER': { alert: 'AL-002', ref: 'FR-025', discipline: 'design', severity: 'blocking', to: ['design_manager', 'mechanical'], title: 'Rack load exceeds every density tier defined for the hall' },
  'RACK-MAX': { alert: 'AL-002', ref: '9.3', discipline: 'design', severity: 'blocking', to: ['design_manager', 'electrical'], title: 'Planned load exceeds rack maximum kW' },
  'COOL-METHOD': { alert: 'AL-003', ref: 'FR-077', discipline: 'mechanical', severity: 'blocking', to: ['mechanical', 'design_manager'], title: 'Rack density not supported by zone cooling methodology' },
  'COOL-LIQ': { alert: 'AL-003', ref: 'FR-078 / 8.4.4', discipline: 'mechanical', severity: 'blocking', to: ['mechanical', 'design_manager'], title: 'Liquid-cooled racks without full liquid-cooling readiness' },
  'COOL-ZONE': { alert: null, ref: 'FR-074', discipline: 'mechanical', severity: 'blocking', to: ['mechanical', 'design_manager'], title: 'Zone heat load exceeds available cooling' },
  'COOL-HALL': { alert: null, ref: 'FR-074', discipline: 'mechanical', severity: 'blocking', to: ['mechanical', 'design_manager'], title: 'Hall heat load exceeds available cooling' },
  'COOL-COMM': { alert: 'AL-007', ref: '7.11', discipline: 'mechanical', severity: 'blocking', to: ['commissioning', 'mechanical'], title: 'Commissioned racks exceed commissioned cooling capacity' },
  'COOL-RED': { alert: null, ref: 'FR-075 / 8.4.5', discipline: 'mechanical', severity: 'blocking', to: ['mechanical'], title: 'Cooling redundancy below hall requirement' },
  'PWR-ASSET': { alert: 'AL-005', ref: 'FR-067 / 8.3', discipline: 'electrical', severity: 'blocking', to: ['electrical', 'design_manager'], title: 'Connected load exceeds power asset capacity' },
  'PWR-RACKPDU': { alert: 'AL-005', ref: '8.3.3', discipline: 'electrical', severity: 'blocking', to: ['electrical'], title: 'Rack load exceeds rack PDU rating' },
  'PWR-NOFEED': { alert: null, ref: 'FR-052', discipline: 'electrical', severity: 'warning', to: ['electrical', 'planner'], title: 'Rack has no A-feed allocated' },
  'PWR-SPOF': { alert: null, ref: 'FR-069', discipline: 'electrical', severity: 'blocking', to: ['electrical', 'design_manager'], title: 'Single point of failure against required redundancy' },
  'PWR-RED': { alert: null, ref: 'FR-062 / 8.3.7', discipline: 'electrical', severity: 'blocking', to: ['electrical'], title: 'Power asset redundancy below hall requirement' },
  'PWR-AUTONOMY': { alert: null, ref: 'FR-013 / FR-014', discipline: 'electrical', severity: 'blocking', to: ['electrical'], title: 'UPS / generator autonomy below requirement' },
  'CAB-ZONE': { alert: null, ref: 'FR-051', discipline: 'ict', severity: 'blocking', to: ['ict', 'design_manager'], title: 'Racks exceed cabling pathway capacity' },
  'OPS-OVER': { alert: 'AL-006', ref: '7.11', discipline: 'operations', severity: 'blocking', to: ['operations'], title: 'Occupied IT load exceeds commissioned capacity' },
  'OPS-RACK': { alert: 'AL-006', ref: '9.3', discipline: 'operations', severity: 'warning', to: ['operations'], title: 'Actual rack load exceeds rack maximum' },
  'COMM-GATE': { alert: null, ref: 'FR-084', discipline: 'commissioning', severity: 'blocking', to: ['commissioning', 'electrical'], title: 'Racks released on uncommissioned power infrastructure' },
  'RES-IDLE': { alert: 'AL-008', ref: 'FR-027', discipline: 'commercial', severity: 'warning', to: ['project_manager', 'commercial'], title: 'Idle reserved capacity is stranding commissioned capacity' },
  'STRANDED': { alert: 'AL-008', ref: 'FR-027', discipline: 'design', severity: 'warning', to: ['project_manager', 'design_manager'], title: 'Stranded capacity between power, cooling and space' },
};

function aggregate(racks) {
  const active = racks.filter((r) => r.status !== 'decommissioned');
  const at = (s) => active.filter((r) => rIdx(r.status) >= rIdx(s));
  const occ = active.filter((r) => r.status === 'occupied');
  const reservedIdle = active.filter((r) => r.allocation === 'reserved' && r.status !== 'occupied');
  const a = {
    planned_racks: active.length,
    installed_racks: at('installed').length,
    commissioned_racks: at('commissioned').length,
    handed_over_racks: at('handed_over').length,
    occupied_racks: occ.length,
    reserved_racks: active.filter((r) => r.allocation === 'reserved').length,
    sold_racks: active.filter((r) => r.allocation === 'sold').length,
    planned_kw: sum(active, (r) => r.planned_kw),
    installed_kw: sum(at('installed'), (r) => r.planned_kw),
    commissioned_kw: sum(at('commissioned'), (r) => r.planned_kw),
    handed_over_kw: sum(at('handed_over'), (r) => r.planned_kw),
    occupied_kw: sum(occ, (r) => r.actual_kw),
    reserved_kw: sum(active.filter((r) => r.allocation === 'reserved'), (r) => r.planned_kw),
    reserved_idle_kw: sum(reservedIdle, (r) => r.planned_kw),
    sold_kw: sum(active.filter((r) => r.allocation === 'sold'), (r) => r.planned_kw),
  };
  a.avg_density_kw = a.planned_racks ? a.planned_kw / a.planned_racks : 0;
  a.installed_pct = r1(pct(a.installed_racks, a.planned_racks));
  a.commissioned_pct = r1(pct(a.commissioned_racks, a.planned_racks));
  a.occupied_pct = r1(pct(a.occupied_racks, a.commissioned_racks)); // 8.2: occupied / commissioned
  a.remaining_racks = a.commissioned_racks - a.occupied_racks;
  return a;
}

function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function compute(state) {
  const p = state.project || {};
  const halls = state.halls || [], zones = state.zones || [], tiers = state.tiers || [];
  const allRacks = state.racks || [], power = state.power || [], cooling = state.cooling || [];
  const racks = allRacks.filter((r) => r.status !== 'decommissioned');
  const heatF = n(p.heat_factor, 1);
  const diversity = n(p.diversity_factor, 1);
  const powerById = new Map(power.map((a) => [a.id, a]));
  const zoneById = new Map(zones.map((z) => [z.id, z]));
  const hallById = new Map(halls.map((h) => [h.id, h]));
  const tiersByHall = groupBy(tiers, (t) => t.hall_id);
  for (const list of tiersByHall.values()) list.sort((a, b) => n(a.max_kw) - n(b.max_kw));
  const tierById = new Map(tiers.map((t) => [t.id, t]));

  const exceptions = [];
  const emit = (rule, entity_type, entity_id, hall_id, message, extraKey = '') => {
    const meta = RULES[rule];
    exceptions.push({
      key: `${rule}:${entity_type}:${entity_id}${extraKey ? ':' + extraKey : ''}`,
      rule, alert: meta.alert, ref: meta.ref, severity: meta.severity, discipline: meta.discipline,
      recipients: meta.to, title: meta.title, entity_type, entity_id, hall_id, message,
    });
  };
  // Rack-level findings are aggregated per zone so thousands of racks do not flood alerts.
  const rackFindings = new Map();
  const rackFlags = {};
  const rackFinding = (rule, rack, detail) => {
    (rackFlags[rack.id] ||= []).push({ rule, severity: RULES[rule].severity, detail: detail || RULES[rule].title });
    const k = `${rule}|${rack.zone_id ? 'zone:' + rack.zone_id : 'hall:' + rack.hall_id}`;
    if (!rackFindings.has(k)) rackFindings.set(k, { rule, rack, items: [] });
    rackFindings.get(k).items.push(detail ? `${rack.code} (${detail})` : rack.code);
  };

  // ---------- Power chain ----------
  const chain = (id) => {
    const out = []; const seen = new Set(); let cur = id;
    while (cur && powerById.has(cur) && !seen.has(cur)) { seen.add(cur); const a = powerById.get(cur); out.push(a); cur = a.parent_id; }
    return out;
  };
  const pw = new Map(power.map((a) => [a.id, { failover: 0, normal: 0, feedA: 0, feedB: 0, commissioned: 0, actual: 0, racks: 0, halls: new Set() }]));
  const rackChains = new Map();
  for (const r of racks) {
    const ca = chain(r.feed_a_id), cb = chain(r.feed_b_id);
    rackChains.set(r.id, { ca, cb });
    const ids = new Set([...ca, ...cb].map((a) => a.id));
    const dual = ca.length > 0 && cb.length > 0;
    for (const id of ids) {
      const acc = pw.get(id);
      const inA = ca.some((a) => a.id === id), inB = cb.some((a) => a.id === id);
      acc.failover += n(r.planned_kw);
      acc.normal += n(r.planned_kw) * (dual && !(inA && inB) ? 0.5 : 1);
      if (inA) acc.feedA += n(r.planned_kw);
      if (inB) acc.feedB += n(r.planned_kw);
      if (rIdx(r.status) >= rIdx('commissioned')) acc.commissioned += n(r.planned_kw);
      if (r.status === 'occupied') acc.actual += n(r.actual_kw);
      acc.racks += 1; acc.halls.add(r.hall_id);
    }
  }
  // Generators carry the racks downstream of the assets they stand by for (empty = all racks).
  for (const g of power.filter((a) => a.type === 'GENERATOR')) {
    const standby = Array.isArray(g.standby_for) ? g.standby_for : [];
    const served = standby.length
      ? racks.filter((r) => { const c = rackChains.get(r.id); return [...c.ca, ...c.cb].some((a) => standby.includes(a.id)); })
      : racks;
    const acc = pw.get(g.id);
    acc.failover = sum(served, (r) => r.planned_kw);
    acc.normal = acc.failover;
    acc.commissioned = sum(served.filter((r) => rIdx(r.status) >= rIdx('commissioned')), (r) => r.planned_kw);
    acc.actual = sum(served.filter((r) => r.status === 'occupied'), (r) => r.actual_kw);
    acc.racks = served.length; served.forEach((r) => acc.halls.add(r.hall_id));
  }

  const powerOut = power.map((a) => {
    const acc = pw.get(a.id);
    const factor = (UPSTREAM.has(a.type) ? diversity : 1) * n(a.load_factor, 1);
    const usable = powerUsableKw(a, p);
    const load = acc.failover * factor;
    const o = {
      id: a.id, code: a.code, name: a.name, type: a.type, hall_id: a.hall_id, parent_id: a.parent_id, status: a.status,
      redundancy: a.redundancy, units: a.units, rated_kw: n(a.rating_per_unit) * n(a.units, 1) * (a.rating_unit === 'kVA' ? n(p.power_factor, 0.9) : 1),
      usable_kw: usable, load_kw: load, normal_kw: acc.normal * factor, feed_a_kw: acc.feedA, feed_b_kw: acc.feedB,
      commissioned_kw: acc.commissioned * factor, actual_kw: acc.actual * factor, racks: acc.racks,
      util_pct: r1(pct(load, usable)), normal_util_pct: r1(pct(acc.normal * factor, usable)), headroom_kw: usable - load,
      halls: [...acc.halls],
    };
    if (acc.racks > 0 && load > usable + 1e-6) {
      const what = DISTRIBUTION.has(a.type) ? 'A/B feed allocation (failover)' : 'Connected critical load';
      emit('PWR-ASSET', 'power_asset', a.id, a.hall_id, `${a.type} ${a.code}: ${what} ${fmt(load)} exceeds usable capacity ${fmt(usable)} after redundancy (${a.redundancy}), derating and operating limit.`);
    }
    return o;
  });

  // Rack-level power + density checks
  for (const r of racks) {
    const hall = hallById.get(r.hall_id) || {};
    const { ca, cb } = rackChains.get(r.id);
    const planned = n(r.planned_kw);
    if (n(r.max_kw) > 0 && planned > n(r.max_kw)) rackFinding('RACK-MAX', r, `${planned} > ${r.max_kw} kW`);
    if (n(r.rack_pdu_kw) > 0 && planned > n(r.rack_pdu_kw)) rackFinding('PWR-RACKPDU', r, `${planned} > ${r.rack_pdu_kw} kW`);
    if (!r.feed_a_id) rackFinding('PWR-NOFEED', r);
    const req = hall.power_redundancy || 'N';
    if (ca.length) {
      if (DUAL_PATH.has(req) && !cb.length) rackFinding('PWR-SPOF', r, 'no B-feed');
      else if (cb.length) {
        const bIds = new Set(cb.map((a) => a.id));
        const common = ca.find((a) => bIds.has(a.id) && a.type !== 'UTILITY');
        if (common && DUAL_PATH.has(req)) rackFinding('PWR-SPOF', r, `A and B share ${common.code}`);
      }
    }
    if (rIdx(r.status) >= rIdx('commissioned')) {
      const notReady = [...ca, ...cb].filter((a) => !assetCommissioned(a));
      if (notReady.length) rackFinding('COMM-GATE', r, [...new Set(notReady.map((a) => a.code))].join('/'));
    }
    if (r.status === 'occupied' && n(r.max_kw) > 0 && n(r.actual_kw) > n(r.max_kw)) rackFinding('OPS-RACK', r, `${r.actual_kw} > ${r.max_kw} kW`);

    // Density tier & cooling methodology
    const hallTiers = tiersByHall.get(r.hall_id) || [];
    if (hallTiers.length) {
      const declared = tierById.get(r.tier_id);
      const required = hallTiers.find((t) => planned <= n(t.max_kw));
      if (!required) rackFinding('DENS-NOTIER', r, `${planned} kW`);
      else if (declared && planned > n(declared.max_kw)) rackFinding('DENS-TIER', r, `${planned} kW > ${declared.name} ${declared.max_kw} kW`);
      const eff = [declared, required].filter(Boolean).sort((a, b) => n(b.max_kw) - n(a.max_kw))[0];
      const zone = zoneById.get(r.zone_id);
      if (eff && zone) {
        const methods = Array.isArray(eff.cooling_methods) ? eff.cooling_methods : [];
        if (methods.length && !methods.includes(zone.cooling_method)) rackFinding('COOL-METHOD', r, `${eff.name} needs ${methods.join('/')}, zone is ${zone.cooling_method}`);
        if (eff.liquid) {
          const missing = ['lc_cdu', 'lc_pipework', 'lc_leak_detection', 'lc_clearance', 'lc_ops_approval'].filter((k) => !zone[k]);
          if (missing.length) rackFinding('COOL-LIQ', r, missing.map((m) => m.replace('lc_', '').replace('_', ' ')).join(', '));
        }
      }
    }
  }
  for (const { rule, rack, items } of rackFindings.values()) {
    const zone = zoneById.get(rack.zone_id);
    const where = zone ? `zone ${zone.code}` : `hall ${hallById.get(rack.hall_id)?.code || ''}`;
    const shown = items.slice(0, 6).join(', ') + (items.length > 6 ? ` … +${items.length - 6} more` : '');
    emit(rule, zone ? 'zone' : 'data_hall', zone ? zone.id : rack.hall_id, rack.hall_id, `${items.length} rack(s) in ${where}: ${shown}`);
  }

  // Redundancy & autonomy per hall for UPS / generators serving its racks
  for (const h of halls) {
    const req = h.power_redundancy || 'N';
    const serving = powerOut.filter((o) => o.halls.includes(h.id));
    for (const o of serving) {
      const a = powerById.get(o.id);
      if (a.type === 'UPS') {
        const minRank = req === '2N+1' ? 1 : DUAL_PATH.has(req) ? 0 : RANK[req];
        if ((RANK[a.redundancy] ?? 0) < minRank) emit('PWR-RED', 'power_asset', a.id, h.id, `UPS ${a.code} is ${a.redundancy}; hall ${h.code} requires ${req}.`, `h${h.id}`);
        if (n(h.required_ups_autonomy_min) > 0 && n(a.autonomy_min) < n(h.required_ups_autonomy_min)) emit('PWR-AUTONOMY', 'power_asset', a.id, h.id, `UPS ${a.code} autonomy ${n(a.autonomy_min)} min < required ${h.required_ups_autonomy_min} min for hall ${h.code}.`, `h${h.id}`);
      }
      if (a.type === 'GENERATOR') {
        const minRank = Math.min(RANK[req] ?? 0, 1);
        if ((RANK[a.redundancy] ?? 0) < minRank) emit('PWR-RED', 'power_asset', a.id, h.id, `Generator ${a.code} is ${a.redundancy}; hall ${h.code} (${req}) needs at least N+1 standby.`, `h${h.id}`);
        if (n(h.required_gen_runtime_h) > 0 && n(a.fuel_autonomy_h) < n(h.required_gen_runtime_h)) emit('PWR-AUTONOMY', 'power_asset', a.id, h.id, `Generator ${a.code} fuel autonomy ${n(a.fuel_autonomy_h)} h < required ${h.required_gen_runtime_h} h for hall ${h.code}.`, `h${h.id}`);
      }
    }
  }

  // ---------- Cooling ----------
  const zoneOut = [], hallOut = [];
  const rackByHall = groupBy(racks, (r) => r.hall_id);
  const rackByZone = groupBy(racks, (r) => r.zone_id);
  for (const h of halls) {
    const hRacks = rackByHall.get(h.id) || [];
    const hZones = zones.filter((z) => z.hall_id === h.id);
    const hCool = cooling.filter((c) => c.hall_id === h.id);
    const pool = hCool.filter((c) => !c.zone_id);
    const capPool = sum(pool, (c) => coolingUsableKw(c, p));
    const capPoolComm = sum(pool.filter(assetCommissioned), (c) => coolingUsableKw(c, p));
    for (const c of hCool) {
      if ((RANK[c.redundancy] ?? 0) < (RANK[h.cooling_redundancy] ?? 0)) emit('COOL-RED', 'cooling_asset', c.id, h.id, `${c.type} ${c.code} is ${c.redundancy}; hall ${h.code} requires ${h.cooling_redundancy}.`);
    }
    const zStats = hZones.map((z) => {
      const zr = rackByZone.get(z.id) || [];
      const ded = hCool.filter((c) => c.zone_id === z.id);
      const heat = sum(zr, (r) => r.planned_kw) * heatF;
      const heatComm = sum(zr.filter((r) => rIdx(r.status) >= rIdx('commissioned')), (r) => r.planned_kw) * heatF;
      const capDed = sum(ded, (c) => coolingUsableKw(c, p));
      const capDedComm = sum(ded.filter(assetCommissioned), (c) => coolingUsableKw(c, p));
      return { z, zr, heat, heatComm, capDed, capDedComm, overflow: Math.max(0, heat - capDed), overflowComm: Math.max(0, heatComm - capDedComm) };
    });
    const zoneless = hRacks.filter((r) => !r.zone_id || !zoneById.has(r.zone_id));
    const overflow = sum(zStats, (s) => s.overflow) + sum(zoneless, (r) => r.planned_kw) * heatF;
    const overflowComm = sum(zStats, (s) => s.overflowComm) + sum(zoneless.filter((r) => rIdx(r.status) >= rIdx('commissioned')), (r) => r.planned_kw) * heatF;
    if (capPool <= 0) {
      for (const s of zStats) if (s.overflow > 1e-6) emit('COOL-ZONE', 'zone', s.z.id, h.id, `Zone ${s.z.code} heat ${fmt(s.heat)} exceeds dedicated cooling ${fmt(s.capDed)} and the hall has no shared cooling.`);
    } else if (overflow > capPool + 1e-6) {
      emit('COOL-HALL', 'data_hall', h.id, h.id, `Hall ${h.code}: heat load not covered by zone-dedicated cooling ${fmt(overflow)} exceeds shared cooling ${fmt(capPool)}.`);
    }
    if (overflowComm > capPoolComm + 1e-6) {
      emit('COOL-COMM', 'data_hall', h.id, h.id, `Hall ${h.code}: commissioned heat ${fmt(overflowComm)} beyond dedicated units exceeds commissioned shared cooling ${fmt(capPoolComm)}.`);
    }

    // Zone metrics + space / cabling / allocation rules
    for (const s of zStats) {
      const z = s.z;
      const share = overflow > 0 ? capPool * (s.overflow / overflow) : 0;
      const coolCap = s.capDed + share; // dedicated units plus a pro-rata share of hall-wide cooling
      const ag = aggregate(s.zr);
      if (n(z.rack_positions) > 0 && ag.planned_racks > n(z.rack_positions)) emit('SPACE-ZONE', 'zone', z.id, h.id, `Zone ${z.code}: ${ag.planned_racks} racks planned for ${z.rack_positions} positions.`);
      if (n(z.cabling_capacity_racks) > 0 && ag.planned_racks > n(z.cabling_capacity_racks)) emit('CAB-ZONE', 'zone', z.id, h.id, `Zone ${z.code}: ${ag.planned_racks} racks exceed cabling pathway capacity of ${z.cabling_capacity_racks} racks (${z.network_zone || 'network path not set'}).`);
      if (n(z.allocated_it_kw) > 0 && ag.planned_kw > n(z.allocated_it_kw) + 1e-6) emit('LOAD-ZONE', 'zone', z.id, h.id, `Zone ${z.code}: planned ${fmt(ag.planned_kw)} exceeds allocation ${fmt(z.allocated_it_kw)}.`);
      zoneOut.push({
        id: z.id, hall_id: h.id, code: z.code, name: z.name, cooling_method: z.cooling_method, ...ag,
        allocated_it_kw: n(z.allocated_it_kw), rack_positions: n(z.rack_positions), cabling_capacity_racks: n(z.cabling_capacity_racks),
        heat_kw: s.heat, cooling_dedicated_kw: s.capDed, cooling_kw: coolCap, cooling_util_pct: r1(pct(s.heat, coolCap)),
        space_util_pct: r1(pct(ag.planned_racks, n(z.rack_positions))), cabling_util_pct: r1(pct(ag.planned_racks, n(z.cabling_capacity_racks))),
        liquid_ready: ['lc_cdu', 'lc_pipework', 'lc_leak_detection', 'lc_clearance', 'lc_ops_approval'].every((k) => z[k]),
        network_commissioned: !!z.network_commissioned, safety_commissioned: !!z.safety_commissioned,
      });
    }

    // Hall metrics
    const ag = aggregate(hRacks);
    const approved = n(h.approved_it_kw);
    if (approved > 0 && ag.planned_kw > approved + 1e-6) emit('LOAD-HALL', 'data_hall', h.id, h.id, `Hall ${h.code}: planned rack load ${fmt(ag.planned_kw)} exceeds approved ${fmt(approved)} by ${fmt(ag.planned_kw - approved)}.`);
    if (n(h.approved_racks) > 0 && ag.planned_racks > n(h.approved_racks)) emit('RACKS-HALL', 'data_hall', h.id, h.id, `Hall ${h.code}: ${ag.planned_racks} racks exceed approved layout of ${h.approved_racks}.`);
    if (n(h.white_space_m2) > 0 && n(h.used_space_m2) > n(h.white_space_m2)) emit('SPACE-AREA', 'data_hall', h.id, h.id, `Hall ${h.code}: used ${h.used_space_m2} m² > available ${h.white_space_m2} m².`);
    const commissionedAvail = ag.commissioned_kw;
    if (ag.occupied_kw > commissionedAvail + 1e-6) emit('OPS-OVER', 'data_hall', h.id, h.id, `Hall ${h.code}: occupied ${fmt(ag.occupied_kw)} exceeds commissioned capacity ${fmt(commissionedAvail)}.`);
    if (ag.commissioned_kw > 0) {
      const idleReservedComm = sum(hRacks.filter((r) => r.allocation === 'reserved' && rIdx(r.status) >= rIdx('commissioned') && r.status !== 'occupied'), (r) => r.planned_kw);
      if (pct(idleReservedComm, ag.commissioned_kw) > n(p.reserved_alert_pct, 15)) emit('RES-IDLE', 'data_hall', h.id, h.id, `Hall ${h.code}: ${fmt(idleReservedComm)} of commissioned capacity (${r1(pct(idleReservedComm, ag.commissioned_kw))}%) is reserved but unoccupied.`);
    }
    const coolingTotal = capPool + sum(zStats, (s) => s.capDed);
    const powerCap = approved;
    const coolingCapIt = heatF > 0 ? coolingTotal / heatF : 0;
    const spaceCap = sum(hZones, (z) => n(z.rack_positions) * n(z.design_density_kw, n(h.standard_density_kw)));
    const deliverable = Math.min(...[powerCap, coolingCapIt, spaceCap].filter((v) => v > 0), Infinity);
    const stranded = Number.isFinite(deliverable) ? {
      power_kw: Math.max(0, powerCap - deliverable), cooling_kw: Math.max(0, coolingCapIt - deliverable), space_kw: Math.max(0, spaceCap - deliverable),
    } : { power_kw: 0, cooling_kw: 0, space_kw: 0 };
    if (powerCap > 0 && stranded.power_kw > powerCap * n(p.stranded_alert_pct, 10) / 100) {
      const limiter = deliverable === coolingCapIt ? 'cooling' : 'space';
      emit('STRANDED', 'data_hall', h.id, h.id, `Hall ${h.code}: ${fmt(stranded.power_kw)} of approved power cannot be used — limited by ${limiter} (deliverable ${fmt(deliverable)}).`);
    }
    const ups = powerOut.filter((o) => o.type === 'UPS' && o.halls.includes(h.id));
    hallOut.push({
      id: h.id, code: h.code, name: h.name, phase: h.phase, status: h.status, ...ag,
      approved_it_kw: approved, approved_racks: n(h.approved_racks), standard_density_kw: n(h.standard_density_kw),
      available_kw: approved - ag.occupied_kw, it_util_pct: r1(pct(ag.occupied_kw, approved)),
      planned_vs_approved_pct: r1(pct(ag.planned_kw, approved)),
      commissioned_available_kw: ag.commissioned_kw - ag.occupied_kw,
      heat_kw: ag.planned_kw * heatF, cooling_kw: coolingTotal, cooling_util_pct: r1(pct(ag.planned_kw * heatF, coolingTotal)),
      cooling_commissioned_kw: capPoolComm + sum(zStats, (s) => s.capDedComm),
      white_space_m2: n(h.white_space_m2), used_space_m2: n(h.used_space_m2),
      rack_positions: sum(hZones, (z) => z.rack_positions),
      power_capacity_kw: powerCap, cooling_capacity_it_kw: coolingCapIt, space_capacity_kw: spaceCap,
      deliverable_kw: Number.isFinite(deliverable) ? deliverable : 0, stranded,
      feed_a_kw: sum(hRacks.filter((r) => r.feed_a_id), (r) => r.planned_kw), feed_b_kw: sum(hRacks.filter((r) => r.feed_b_id), (r) => r.planned_kw),
      ups_usable_kw: ups.length ? Math.min(...ups.map((u) => u.usable_kw)) : 0,
      power_redundancy: h.power_redundancy, cooling_redundancy: h.cooling_redundancy,
    });
  }

  // Project-level rules
  const approvedSum = sum(halls, (h) => h.approved_it_kw);
  if (n(p.target_it_kw) > 0 && approvedSum > n(p.target_it_kw) + 1e-6) emit('LOAD-PROJECT', 'project', p.id, null, `Sum of approved hall IT load ${fmt(approvedSum)} exceeds project approved IT load ${fmt(p.target_it_kw)}. Raise a change request.`);
  if (n(p.target_racks) > 0 && racks.length > n(p.target_racks)) emit('RACKS-PROJECT', 'project', p.id, null, `${racks.length} racks planned against project target ${p.target_racks}.`);

  const coolingOut = cooling.map((c) => ({ id: c.id, code: c.code, type: c.type, hall_id: c.hall_id, zone_id: c.zone_id, status: c.status, redundancy: c.redundancy, units: c.units, technology: c.technology, usable_kw: coolingUsableKw(c, p), rated_kw: n(c.rating_per_unit_kw) * n(c.units, 1) }));

  const projAg = aggregate(allRacks);
  const rows = [...groupBy(racks, (r) => `${r.hall_id}|${r.row || '—'}`).entries()].map(([k, rs]) => ({ hall_id: Number(k.split('|')[0]), row: k.split('|')[1], zone_id: rs[0].zone_id, ...aggregate(rs) }));
  const byType = [...groupBy(racks, (r) => r.rack_type || 'compute').entries()].map(([k, rs]) => ({ key: k, ...aggregate(rs) }));
  const byTier = [...groupBy(racks, (r) => tierById.get(r.tier_id)?.name || 'Unclassified').entries()].map(([k, rs]) => ({ key: k, ...aggregate(rs) }));
  const byPhase = [...groupBy(halls, (h) => h.phase || 'day1').entries()].map(([k, hs]) => {
    const ids = new Set(hs.map((h) => h.id));
    return { key: k, approved_it_kw: sum(hs, (h) => h.approved_it_kw), ...aggregate(racks.filter((r) => ids.has(r.hall_id))) };
  });

  const summary = {
    ...projAg,
    target_it_kw: n(p.target_it_kw), target_racks: n(p.target_racks), day1_it_kw: n(p.day1_it_kw), ultimate_it_kw: n(p.ultimate_it_kw),
    approved_it_kw: approvedSum, available_kw: approvedSum - projAg.occupied_kw, it_util_pct: r1(pct(projAg.occupied_kw, approvedSum)),
    commissioned_available_kw: projAg.commissioned_kw - projAg.occupied_kw,
    heat_kw: projAg.planned_kw * heatF, cooling_kw: sum(coolingOut, (c) => c.usable_kw),
    blocking: exceptions.filter((e) => e.severity === 'blocking').length, warnings: exceptions.filter((e) => e.severity === 'warning').length,
  };
  return { summary, halls: hallOut, zones: zoneOut, rows, byType, byTier, byPhase, power: powerOut, cooling: coolingOut, exceptions, rack_flags: rackFlags };
}

// ---------- Version comparison & change impact (§7.10) ----------

const norm = (v) => (Array.isArray(v) ? JSON.stringify([...v].sort()) : v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function planningHash(state) {
  const parts = [];
  for (const [key, table] of Object.entries(STATE_COLLECTIONS)) {
    const fields = PLANNING_FIELDS[table];
    const rows = [...(state[key] || [])].sort((a, b) => a.id - b.id).map((r) => [r.id, ...fields.map((f) => norm(r[f]))]);
    parts.push(key, JSON.stringify(rows));
  }
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export function diffStates(base, next) {
  const out = {};
  for (const [key, table] of Object.entries(STATE_COLLECTIONS)) {
    const fields = PLANNING_FIELDS[table];
    const a = new Map((base?.[key] || []).map((r) => [r.id, r]));
    const b = new Map((next?.[key] || []).map((r) => [r.id, r]));
    const added = [], removed = [], changed = [];
    for (const [id, r] of b) {
      if (!a.has(id)) { added.push({ id, code: r.code || r.name }); continue; }
      const o = a.get(id); const ch = {};
      for (const f of fields) if (norm(o[f]) !== norm(r[f])) ch[f] = [o[f] ?? null, r[f] ?? null];
      if (Object.keys(ch).length) changed.push({ id, code: r.code || r.name, fields: ch });
    }
    for (const [id, r] of a) if (!b.has(id)) removed.push({ id, code: r.code || r.name });
    out[key] = { added, removed, changed };
  }
  out.total = Object.values(out).reduce((t, d) => t + d.added.length + d.removed.length + d.changed.length, 0);
  return out;
}

export function assessImpact(base, next) {
  const p = next.project || {};
  const ma = compute(base), mb = compute(next);
  const diff = diffStates(base, next);
  const dKw = mb.summary.planned_kw - ma.summary.planned_kw;
  const dRacks = mb.summary.planned_racks - ma.summary.planned_racks;
  const pa = new Map(ma.power.map((x) => [x.id, x]));
  const powerImpact = mb.power.map((x) => ({ id: x.id, code: x.code, type: x.type, before_kw: pa.get(x.id)?.load_kw ?? 0, after_kw: x.load_kw, usable_before_kw: pa.get(x.id)?.usable_kw ?? 0, usable_kw: x.usable_kw, before_pct: pa.get(x.id)?.util_pct ?? null, after_pct: x.util_pct }))
    .filter((x) => Math.abs(x.after_kw - x.before_kw) > 1e-6 || Math.abs(x.usable_kw - x.usable_before_kw) > 1e-6);
  const ha = new Map(ma.halls.map((x) => [x.id, x]));
  const hallImpact = mb.halls.map((h) => {
    const o = ha.get(h.id) || {};
    return { id: h.id, code: h.code, planned_kw_before: o.planned_kw ?? 0, planned_kw_after: h.planned_kw, racks_before: o.planned_racks ?? 0, racks_after: h.planned_racks, heat_before: o.heat_kw ?? 0, heat_after: h.heat_kw, cooling_before: o.cooling_kw ?? 0, cooling_after: h.cooling_kw, cooling_pct_before: o.cooling_util_pct ?? null, cooling_pct_after: h.cooling_util_pct };
  }).filter((h) => h.planned_kw_before !== h.planned_kw_after || h.racks_before !== h.racks_after || h.cooling_before !== h.cooling_after);
  const za = new Map(ma.zones.map((z) => [z.id, z]));
  const zoneImpact = mb.zones.map((z) => ({ id: z.id, code: z.code, racks_before: za.get(z.id)?.planned_racks ?? 0, racks_after: z.planned_racks, space_pct_after: z.space_util_pct, cabling_pct_before: za.get(z.id)?.cabling_util_pct ?? null, cabling_pct_after: z.cabling_util_pct, cooling_pct_before: za.get(z.id)?.cooling_util_pct ?? null, cooling_pct_after: z.cooling_util_pct }))
    .filter((z) => z.racks_before !== z.racks_after || z.cooling_pct_before !== z.cooling_pct_after);
  const rackA = new Map((base.racks || []).map((r) => [r.id, r]));
  const touchedBuilt = [...diff.racks.changed, ...diff.racks.removed].filter((c) => rIdx(rackA.get(c.id)?.status) >= rIdx('installed')).length;
  const costDelta = dKw * n(p.cost_per_kw) + dRacks * n(p.cost_per_rack);
  const keysA = new Set(ma.exceptions.filter((e) => e.severity === 'blocking').map((e) => e.key));
  const newBlocking = mb.exceptions.filter((e) => e.severity === 'blocking' && !keysA.has(e.key));

  const types = new Set();
  const anyField = (key, flist) => diff[key].changed.some((c) => flist.some((f) => f in c.fields));
  if (dKw !== 0 || anyField('halls', ['approved_it_kw']) || anyField('zones', ['allocated_it_kw']) || anyField('racks', ['planned_kw', 'max_kw'])) types.add('load');
  if (dRacks !== 0 || diff.racks.added.length || diff.racks.removed.length || anyField('halls', ['approved_racks'])) types.add('rack');
  if (diff.cooling.added.length || diff.cooling.removed.length || diff.cooling.changed.length || anyField('zones', ['cooling_method', 'containment', 'lc_cdu', 'lc_pipework', 'lc_leak_detection', 'lc_clearance', 'lc_ops_approval']) || diff.tiers.changed.length || diff.tiers.added.length) types.add('cooling');
  if (diff.power.added.length || diff.power.removed.length || diff.power.changed.length || anyField('racks', ['feed_a_id', 'feed_b_id', 'rack_pdu_kw'])) types.add('power');
  if (anyField('zones', ['cabling_capacity_racks'])) types.add('cabling');
  if (anyField('halls', ['power_redundancy', 'cooling_redundancy']) || anyField('power', ['redundancy']) || anyField('cooling', ['redundancy'])) types.add('redundancy');
  if (anyField('racks', ['zone_id', 'row', 'position']) || anyField('zones', ['rack_positions']) || diff.zones.added.length || diff.zones.removed.length) types.add('layout');
  if (anyField('racks', ['tier_id']) || anyField('halls', ['standard_density_kw']) || anyField('zones', ['design_density_kw'])) types.add('density');

  const roles = new Set(['design_manager']);
  if (types.has('power') || types.has('load') || anyField('halls', ['power_redundancy']) || powerImpact.length) roles.add('electrical');
  if (types.has('cooling') || types.has('density') || hallImpact.some((h) => h.heat_before !== h.heat_after) || anyField('halls', ['cooling_redundancy'])) roles.add('mechanical');
  if (types.has('cabling') || types.has('layout') || dRacks !== 0) roles.add('ict');
  const commercial = costDelta !== 0 || Math.abs(dKw) >= n(p.commercial_threshold_kw, 50) || dRacks !== 0;
  if (commercial) roles.add('commercial');
  if (touchedBuilt > 0) roles.add('project_manager');

  return {
    diff,
    change_types: [...types],
    required_roles: [...roles],
    commercial_review: commercial,
    impact: {
      planned_kw_delta: dKw, racks_delta: dRacks,
      planned_kw_before: ma.summary.planned_kw, planned_kw_after: mb.summary.planned_kw,
      cost_delta: costDelta, currency: p.currency || 'GBP',
      commissioning_rework_racks: touchedBuilt,
      schedule: touchedBuilt > 0 ? `${touchedBuilt} installed/commissioned rack(s) affected — re-test and re-commissioning required.` : 'No built racks affected.',
      power: powerImpact, halls: hallImpact, zones: zoneImpact,
      blocking_before: ma.summary.blocking, blocking_after: mb.summary.blocking,
      new_blocking: newBlocking.map((e) => ({ rule: e.rule, alert: e.alert, message: e.message })),
    },
  };
}
