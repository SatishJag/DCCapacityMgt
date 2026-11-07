// Single source of truth for planning entities: drives the SQLite schema,
// API field whitelists, field-level write permissions, and UI forms (/api/meta).

export const ROLES = {
  admin: 'System Administrator',
  project_manager: 'Project Manager',
  design_manager: 'Design Manager',
  electrical: 'Electrical Engineer',
  mechanical: 'Mechanical Engineer',
  ict: 'ICT / Network Engineer',
  planner: 'Data Centre Planner',
  commissioning: 'Commissioning Manager',
  operations: 'Operations Manager',
  commercial: 'Commercial / Cost Manager',
  executive: 'Executive / Management',
  auditor: 'Auditor',
};

export const READ_ONLY_ROLES = ['executive', 'auditor'];

export const REDUNDANCY = ['N', 'N+1', 'N+2', '2N', '2N+1', 'DR', 'BR'];
export const RACK_STATUS = ['planned', 'installed', 'commissioned', 'handed_over', 'occupied', 'decommissioned'];
export const ASSET_STATUS = ['planned', 'installed', 'pre_commissioned', 'commissioned', 'integrated_tested', 'operational'];
export const POWER_TYPES = ['UTILITY', 'TRANSFORMER', 'SWITCHGEAR', 'GENERATOR', 'UPS', 'PDU', 'RPP', 'BUSWAY', 'RACK_PDU'];
export const COOLING_TYPES = ['CRAH', 'CRAC', 'IN_ROW', 'RDHX', 'CDU', 'CHILLER', 'DRY_COOLER', 'IMMERSION_TANK'];
export const COOLING_METHODS = ['air', 'in_row', 'rdhx', 'dlc', 'immersion', 'hybrid'];

const PLAN = ['planner', 'design_manager'];
const f = (name, label, type, opts = {}) => ({ name, label, type, ...opts });

export const ENTITIES = {
  projects: {
    label: 'Project',
    writeRoles: ['project_manager', 'design_manager'],
    createRoles: ['project_manager'],
    fields: [
      f('code', 'Project code', 'text', { required: true, group: 'Project' }),
      f('name', 'Project name', 'text', { required: true, group: 'Project' }),
      f('campus', 'Campus / site', 'text', { group: 'Project' }),
      f('location', 'Location (country, city)', 'text', { group: 'Project' }),
      f('owner', 'Client / owner', 'text', { group: 'Project' }),
      f('stage', 'Design stage', 'select', { options: ['concept', 'schematic_design', 'detailed_design', 'construction', 'commissioning', 'handover', 'operations'], default: 'concept', group: 'Project' }),
      f('status', 'Status', 'select', { options: ['draft', 'submitted', 'approved', 'active', 'closed'], default: 'draft', group: 'Project' }),
      f('design_standard', 'Design standard / guideline', 'text', { default: 'Internal guideline aligned to TIA-942 / BICSI 002 (not certified)', group: 'Project' }),
      f('target_it_kw', 'Target IT load (kW)', 'number', { default: 0, group: 'Capacity' }),
      f('target_racks', 'Target rack count', 'int', { default: 0, group: 'Capacity' }),
      f('day1_it_kw', 'Day 1 IT load (kW)', 'number', { default: 0, group: 'Capacity' }),
      f('reserved_it_kw', 'Reserved IT load (kW)', 'number', { default: 0, group: 'Capacity' }),
      f('ultimate_it_kw', 'Ultimate build-out IT load (kW)', 'number', { default: 0, group: 'Capacity' }),
      f('power_factor', 'Power factor (kVA→kW)', 'number', { default: 0.9, group: 'Engineering factors', roles: ['electrical', 'design_manager'] }),
      f('diversity_factor', 'Diversity factor (UPS & upstream)', 'number', { default: 1, group: 'Engineering factors', roles: ['electrical', 'design_manager'] }),
      f('safety_margin_pct', 'Safety margin (%)', 'number', { default: 0, group: 'Engineering factors', roles: ['electrical', 'mechanical', 'design_manager'] }),
      f('heat_factor', 'Heat load per kW IT', 'number', { default: 1, group: 'Engineering factors', roles: ['mechanical', 'design_manager'], help: 'Rule 8.4.1: heat = IT load × factor (1.0 unless a conversion model is configured)' }),
      f('design_pue', 'Design PUE (reporting)', 'number', { default: 1.3, group: 'Engineering factors' }),
      f('reserved_alert_pct', 'Idle reserved capacity alert (%)', 'number', { default: 15, group: 'Thresholds' }),
      f('stranded_alert_pct', 'Stranded capacity alert (%)', 'number', { default: 10, group: 'Thresholds' }),
      f('commercial_threshold_kw', 'Commercial review threshold (kW change)', 'number', { default: 50, group: 'Thresholds', roles: ['commercial', 'project_manager'] }),
      f('currency', 'Currency', 'text', { default: 'GBP', group: 'Commercial', roles: ['commercial', 'project_manager'] }),
      f('cost_per_kw', 'Cost per kW of IT capacity', 'number', { default: 0, group: 'Commercial', roles: ['commercial'] }),
      f('cost_per_rack', 'Cost per rack position', 'number', { default: 0, group: 'Commercial', roles: ['commercial'] }),
    ],
  },
  data_halls: {
    label: 'Data hall',
    parent: 'projects',
    writeRoles: PLAN,
    fields: [
      f('code', 'Hall code', 'text', { required: true, group: 'Hall' }),
      f('name', 'Hall name', 'text', { required: true, group: 'Hall' }),
      f('building', 'Building', 'text', { group: 'Hall' }),
      f('floor', 'Floor / level', 'text', { group: 'Hall' }),
      f('phase', 'Delivery phase', 'select', { options: ['day1', 'phase2', 'phase3', 'future', 'ultimate'], default: 'day1', group: 'Hall' }),
      f('status', 'Hall status', 'select', { options: ['planned', 'under_construction', 'commissioned', 'operational'], default: 'planned', group: 'Hall', roles: ['planner', 'design_manager', 'commissioning', 'operations'] }),
      f('white_space_m2', 'White space area (m²)', 'number', { default: 0, group: 'Space' }),
      f('used_space_m2', 'Used white space (m²)', 'number', { default: 0, group: 'Space', roles: ['planner', 'design_manager', 'operations'] }),
      f('approved_racks', 'Approved rack count', 'int', { default: 0, group: 'Space' }),
      f('approved_it_kw', 'Approved IT load (kW)', 'number', { default: 0, group: 'IT load' }),
      f('peak_it_kw', 'Peak IT load (kW)', 'number', { default: 0, group: 'IT load' }),
      f('standard_density_kw', 'Standard design density (kW/rack)', 'number', { default: 8, group: 'IT load' }),
      f('load_criticality', 'Load criticality', 'select', { options: ['critical_it', 'non_critical_it', 'network', 'security', 'monitoring', 'facility_support'], default: 'critical_it', group: 'IT load' }),
      f('power_redundancy', 'Required power redundancy', 'select', { options: REDUNDANCY, default: '2N', group: 'Resilience', roles: ['planner', 'design_manager', 'electrical'] }),
      f('ups_topology', 'UPS type / topology', 'text', { group: 'Resilience', roles: ['planner', 'design_manager', 'electrical'] }),
      f('required_ups_autonomy_min', 'Required UPS autonomy (min)', 'number', { default: 5, group: 'Resilience', roles: ['planner', 'design_manager', 'electrical'] }),
      f('required_gen_runtime_h', 'Required generator fuel autonomy (h)', 'number', { default: 24, group: 'Resilience', roles: ['planner', 'design_manager', 'electrical'] }),
      f('cooling_redundancy', 'Required cooling redundancy', 'select', { options: REDUNDANCY, default: 'N+1', group: 'Resilience', roles: ['planner', 'design_manager', 'mechanical'] }),
      f('containment', 'Containment type', 'select', { options: ['none', 'cold_aisle', 'hot_aisle', 'chimney', 'mixed'], default: 'hot_aisle', group: 'Resilience', roles: ['planner', 'design_manager', 'mechanical'] }),
    ],
  },
  density_tiers: {
    label: 'Density tier',
    parent: 'data_halls',
    writeRoles: ['planner', 'design_manager', 'mechanical'],
    fields: [
      f('name', 'Tier name', 'text', { required: true }),
      f('max_kw', 'Maximum kW / rack', 'number', { required: true, default: 10 }),
      f('cooling_methods', 'Supported cooling methods', 'multiselect', { options: COOLING_METHODS, default: ['air'] }),
      f('liquid', 'Liquid-cooled tier', 'bool', { default: false, help: 'Racks in this tier need the liquid-cooling readiness checklist (rule 8.4.4)' }),
      f('description', 'Description', 'text'),
    ],
  },
  zones: {
    label: 'Zone / pod',
    parent: 'data_halls',
    writeRoles: PLAN,
    fields: [
      f('code', 'Zone code', 'text', { required: true, group: 'Zone' }),
      f('name', 'Zone name', 'text', { group: 'Zone' }),
      f('allocated_it_kw', 'Allocated IT load (kW)', 'number', { default: 0, group: 'Zone' }),
      f('design_density_kw', 'Design density (kW/rack)', 'number', { default: 8, group: 'Zone' }),
      f('rack_positions', 'Rack positions (space)', 'int', { default: 0, group: 'Zone' }),
      f('cooling_method', 'Cooling methodology', 'select', { options: COOLING_METHODS, default: 'air', group: 'Cooling', roles: [...PLAN, 'mechanical'] }),
      f('containment', 'Containment', 'select', { options: ['none', 'cold_aisle', 'hot_aisle', 'chimney'], default: 'hot_aisle', group: 'Cooling', roles: [...PLAN, 'mechanical'] }),
      f('airflow', 'Airflow / aisle arrangement', 'text', { group: 'Cooling', roles: [...PLAN, 'mechanical'] }),
      f('lc_cdu', 'Liquid: CDU provided', 'bool', { default: false, group: 'Liquid-cooling readiness', roles: ['mechanical'] }),
      f('lc_pipework', 'Liquid: secondary pipework', 'bool', { default: false, group: 'Liquid-cooling readiness', roles: ['mechanical'] }),
      f('lc_leak_detection', 'Liquid: leak detection', 'bool', { default: false, group: 'Liquid-cooling readiness', roles: ['mechanical'] }),
      f('lc_clearance', 'Liquid: maintenance clearance', 'bool', { default: false, group: 'Liquid-cooling readiness', roles: ['mechanical'] }),
      f('lc_ops_approval', 'Liquid: operational approval', 'bool', { default: false, group: 'Liquid-cooling readiness', roles: ['mechanical', 'operations'] }),
      f('cabling_capacity_racks', 'Cabling pathway capacity (racks)', 'int', { default: 0, group: 'Network & cabling', roles: ['ict', 'design_manager'] }),
      f('network_zone', 'Network path (MMR / MDF / IDF)', 'text', { group: 'Network & cabling', roles: ['ict', 'design_manager'] }),
      f('pathway', 'Cable routing', 'select', { options: ['overhead', 'underfloor', 'mixed'], default: 'overhead', group: 'Network & cabling', roles: ['ict', 'design_manager'] }),
      f('network_commissioned', 'Network commissioned', 'bool', { default: false, group: 'Commissioning gates', roles: ['commissioning', 'ict'] }),
      f('safety_commissioned', 'Fire / life-safety commissioned', 'bool', { default: false, group: 'Commissioning gates', roles: ['commissioning'] }),
    ],
  },
  power_assets: {
    label: 'Power asset',
    parent: 'projects',
    writeRoles: ['electrical'],
    fields: [
      f('code', 'Asset code', 'text', { required: true }),
      f('name', 'Description', 'text'),
      f('type', 'Asset type', 'select', { options: POWER_TYPES, default: 'UPS', required: true }),
      f('hall_id', 'Serves data hall', 'ref', { ref: 'data_halls', nullable: true, onDelete: 'SET NULL' }),
      f('parent_id', 'Upstream asset (power path)', 'ref', { ref: 'power_assets', nullable: true, onDelete: 'SET NULL' }),
      f('rating_per_unit', 'Rating per unit', 'number', { default: 0, required: true }),
      f('rating_unit', 'Rating unit', 'select', { options: ['kW', 'kVA'], default: 'kW' }),
      f('units', 'Number of units / modules', 'int', { default: 1 }),
      f('redundancy', 'Redundancy', 'select', { options: REDUNDANCY, default: 'N' }),
      f('derating', 'Derating factor (0–1)', 'number', { default: 1 }),
      f('max_load_pct', 'Max operating load (%)', 'number', { default: 100 }),
      f('load_factor', 'Facility load multiplier', 'number', { default: 1, help: 'e.g. 1.3 when the asset also carries mechanical load' }),
      f('autonomy_min', 'Battery autonomy (min)', 'number', { default: 0 }),
      f('fuel_autonomy_h', 'Fuel autonomy (h)', 'number', { default: 0 }),
      f('standby_for', 'Generator standby for (assets)', 'multiref', { ref: 'power_assets', default: [], help: 'Empty = whole-site critical load' }),
      f('status', 'Status', 'select', { options: ASSET_STATUS, default: 'planned', readOnly: true }),
    ],
  },
  cooling_assets: {
    label: 'Cooling asset',
    parent: 'projects',
    writeRoles: ['mechanical'],
    fields: [
      f('code', 'Asset code', 'text', { required: true }),
      f('name', 'Description', 'text'),
      f('type', 'Asset type', 'select', { options: COOLING_TYPES, default: 'CRAH', required: true }),
      f('technology', 'Cooling technology', 'select', { options: [...COOLING_METHODS, 'chilled_water', 'dx'], default: 'air' }),
      f('hall_id', 'Data hall', 'ref', { ref: 'data_halls', required: true, onDelete: 'CASCADE' }),
      f('zone_id', 'Dedicated zone (blank = whole hall)', 'ref', { ref: 'zones', nullable: true, onDelete: 'SET NULL' }),
      f('rating_per_unit_kw', 'Cooling per unit (kW)', 'number', { default: 0, required: true }),
      f('units', 'Number of units', 'int', { default: 1 }),
      f('redundancy', 'Redundancy', 'select', { options: REDUNDANCY, default: 'N+1' }),
      f('derating', 'Derating factor (0–1)', 'number', { default: 1 }),
      f('status', 'Status', 'select', { options: ASSET_STATUS, default: 'planned', readOnly: true }),
    ],
  },
  racks: {
    label: 'Rack',
    parent: 'data_halls',
    writeRoles: PLAN,
    fields: [
      f('code', 'Rack ID', 'text', { required: true, group: 'Location' }),
      f('zone_id', 'Zone', 'ref', { ref: 'zones', nullable: true, onDelete: 'SET NULL', group: 'Location' }),
      f('row', 'Row', 'text', { group: 'Location' }),
      f('position', 'Position', 'int', { default: 0, group: 'Location' }),
      f('rack_type', 'Rack function', 'select', { options: ['compute', 'network', 'storage', 'reserved'], default: 'compute', group: 'Density' }),
      f('tier_id', 'Density tier', 'ref', { ref: 'density_tiers', nullable: true, onDelete: 'SET NULL', group: 'Density' }),
      f('planned_kw', 'Planned kW', 'number', { default: 0, group: 'Density' }),
      f('max_kw', 'Max allowable kW', 'number', { default: 0, group: 'Density' }),
      f('rack_pdu_kw', 'Rack PDU rating per feed (kW)', 'number', { default: 0, group: 'Power', roles: [...PLAN, 'electrical'] }),
      f('feed_a_id', 'A-feed source', 'ref', { ref: 'power_assets', nullable: true, onDelete: 'SET NULL', group: 'Power', roles: [...PLAN, 'electrical'] }),
      f('feed_b_id', 'B-feed source', 'ref', { ref: 'power_assets', nullable: true, onDelete: 'SET NULL', group: 'Power', roles: [...PLAN, 'electrical'] }),
      f('actual_kw', 'Actual occupied kW', 'number', { default: 0, group: 'Operations', roles: ['operations'] }),
      f('allocation', 'Allocation', 'select', { options: ['unallocated', 'reserved', 'sold'], default: 'unallocated', group: 'Operations', roles: [...PLAN, 'operations', 'commercial'] }),
      f('tenant', 'Tenant / customer', 'text', { group: 'Operations', roles: [...PLAN, 'operations', 'commercial'] }),
      f('u_height', 'U height', 'int', { default: 48, group: 'Physical' }),
      f('width_mm', 'Width (mm)', 'int', { default: 600, group: 'Physical' }),
      f('depth_mm', 'Depth (mm)', 'int', { default: 1200, group: 'Physical' }),
      f('weight_kg', 'Weight rating (kg)', 'number', { default: 1500, group: 'Physical' }),
      f('feed_type', 'Power feed type', 'text', { default: '3ph 32A', group: 'Physical' }),
      f('status', 'Status', 'select', { options: RACK_STATUS, default: 'planned', readOnly: true, group: 'Location' }),
      f('notes', 'Notes', 'text', { group: 'Physical' }),
    ],
  },
  forecasts: {
    label: 'Load forecast',
    parent: 'projects',
    writeRoles: ['planner', 'project_manager', 'commercial'],
    fields: [
      f('period', 'Period (e.g. 2027-Q1)', 'text', { required: true }),
      f('hall_id', 'Data hall (optional)', 'ref', { ref: 'data_halls', nullable: true, onDelete: 'CASCADE' }),
      f('forecast_kw', 'Forecast IT load (kW)', 'number', { default: 0 }),
      f('committed_kw', 'Committed IT load (kW)', 'number', { default: 0 }),
      f('notes', 'Notes', 'text'),
    ],
  },
};

// Fields whose change after baseline approval constitutes a design change (FR-087).
// Status / actual / allocation are operational and excluded.
export const PLANNING_FIELDS = {
  data_halls: ['code', 'approved_it_kw', 'approved_racks', 'standard_density_kw', 'power_redundancy', 'cooling_redundancy', 'white_space_m2', 'required_ups_autonomy_min', 'required_gen_runtime_h', 'containment'],
  density_tiers: ['name', 'max_kw', 'cooling_methods', 'liquid'],
  zones: ['code', 'allocated_it_kw', 'design_density_kw', 'rack_positions', 'cooling_method', 'containment', 'cabling_capacity_racks', 'lc_cdu', 'lc_pipework', 'lc_leak_detection', 'lc_clearance', 'lc_ops_approval'],
  racks: ['code', 'zone_id', 'row', 'position', 'tier_id', 'rack_type', 'planned_kw', 'max_kw', 'rack_pdu_kw', 'feed_a_id', 'feed_b_id'],
  power_assets: ['code', 'type', 'parent_id', 'hall_id', 'rating_per_unit', 'rating_unit', 'units', 'redundancy', 'derating', 'max_load_pct', 'load_factor', 'autonomy_min', 'fuel_autonomy_h', 'standby_for'],
  cooling_assets: ['code', 'type', 'hall_id', 'zone_id', 'rating_per_unit_kw', 'units', 'redundancy', 'derating'],
};

export const STATE_COLLECTIONS = { halls: 'data_halls', tiers: 'density_tiers', zones: 'zones', racks: 'racks', power: 'power_assets', cooling: 'cooling_assets' };

function colType(fd) {
  if (fd.type === 'number') return 'REAL';
  if (fd.type === 'int' || fd.type === 'bool' || fd.type === 'ref') return 'INTEGER';
  return 'TEXT';
}

export function buildSchemaSql() {
  const out = [];
  for (const [table, ent] of Object.entries(ENTITIES)) {
    const cols = ['id INTEGER PRIMARY KEY AUTOINCREMENT'];
    if (table !== 'projects') cols.push('project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE');
    if (ent.parent === 'data_halls') cols.push('hall_id INTEGER NOT NULL REFERENCES data_halls(id) ON DELETE CASCADE');
    for (const fd of ent.fields) {
      if (ent.parent === 'data_halls' && fd.name === 'hall_id') continue;
      let c = `${fd.name} ${colType(fd)}`;
      if (fd.type === 'ref') c += ` REFERENCES ${fd.ref}(id) ON DELETE ${fd.onDelete || 'SET NULL'}`;
      cols.push(c);
    }
    if (table === 'projects') cols.push('baseline_plan_id INTEGER');
    cols.push('created_at TEXT', 'created_by INTEGER', 'updated_at TEXT', 'updated_by INTEGER');
    out.push(`CREATE TABLE IF NOT EXISTS ${table} (\n  ${cols.join(',\n  ')}\n);`);
  }
  out.push(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, role TEXT NOT NULL,
  project_ids TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, title TEXT, justification TEXT,
  change_types TEXT, snapshot TEXT, snapshot_hash TEXT, validation TEXT, diff TEXT, impact TEXT, required_roles TEXT,
  base_plan_id INTEGER, submitted_by INTEGER, submitted_at TEXT, decided_at TEXT,
  override_justification TEXT, override_by INTEGER, override_at TEXT);
CREATE TABLE IF NOT EXISTS plan_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  role TEXT NOT NULL, decision TEXT NOT NULL DEFAULT 'pending', user_id INTEGER, comment TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL, rule TEXT NOT NULL, alert TEXT, severity TEXT NOT NULL, discipline TEXT, recipients TEXT,
  entity_type TEXT, entity_id INTEGER, hall_id INTEGER, message TEXT, status TEXT NOT NULL,
  first_seen TEXT, last_seen TEXT, resolved_at TEXT, UNIQUE(project_id, key));
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, role TEXT NOT NULL, kind TEXT, alert TEXT,
  message TEXT, ref_type TEXT, ref_id INTEGER, created_at TEXT);
CREATE TABLE IF NOT EXISTS notification_reads (notification_id INTEGER, user_id INTEGER, PRIMARY KEY(notification_id, user_id));
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, entity_type TEXT, entity_id INTEGER, entity_code TEXT,
  from_status TEXT, to_status TEXT, milestone TEXT, evidence TEXT, attachment_id INTEGER, source TEXT, user_id INTEGER, at TEXT);
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, name TEXT, content_type TEXT, size INTEGER,
  path TEXT, uploaded_by INTEGER, at TEXT);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER,
  project_id INTEGER, before TEXT, after TEXT, reason TEXT, source TEXT);
CREATE INDEX IF NOT EXISTS ix_racks_hall ON racks(hall_id);
CREATE INDEX IF NOT EXISTS ix_audit_project ON audit_log(project_id, id);
CREATE INDEX IF NOT EXISTS ix_hist_project ON status_history(project_id, id);
CREATE INDEX IF NOT EXISTS ix_exc_project ON exceptions(project_id, status);
`);
  return out.join('\n');
}
