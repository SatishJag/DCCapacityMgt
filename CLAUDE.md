# CLAUDE.md — DC Capacity Planning & Infrastructure Validation Platform

Handoff notes for any AI agent or developer continuing this codebase. Read this first.

## What this is

An MVP of the **"Data Centre Capacity Planning and Infrastructure Validation Platform"** described in the
functional/technical specification v1.0 (the original spec was pasted into the first chat session; if a copy is
placed at `docs/SPEC.md`, treat it as the source of truth for requirements). The app captures IT load, rack density
and rack plans, **validates them against power, cooling, space, cabling and redundancy design capacity**, runs
approval/change-control workflows, gates capacity release through commissioning, and reports utilisation.

It implements spec **MVP Phase 1 in full** plus several Phase 2 items (A/B feed validation, commissioning gates,
change-impact workflow, CSV import/export). Integrations, SSO and live telemetry are **not** built (see "Not done").

## Run it

Requires **Node.js ≥ 22.5** (uses the built-in `node:sqlite`). **Zero npm dependencies** — no `npm install` needed.

```bash
npm start            # http://localhost:3000 (PORT env to change). Seeds demo data on first run.
npm test             # node:test — engine rules + API workflow tests (17 tests, all passing)
npm run seed         # wipe data/dc-capacity.db and reseed the demo
```

- DB file: `data/dc-capacity.db` (git-ignored). Uploads: `data/uploads/`. `DATA_DIR` env overrides the folder.
- `NO_DEMO=1 npm start` on an empty DB seeds users only.
- **No migrations.** The schema is generated from `server/schema.js` with `CREATE TABLE IF NOT EXISTS`. After
  changing fields, delete the DB (`npm run seed`) or add a migration mechanism.
- There is no login: the header "Signed in as" picker sets the `X-User-Id` header (stored in localStorage).
  Switch users to act as different roles (e.g. Planner submits, Design Manager approves).

## Layout

```
server/
  schema.js   Single source of truth: entities, fields, types, options, defaults, field-level write roles,
              form groups. Drives SQL DDL, API whitelists/permissions AND the UI forms (via GET /api/meta).
              Also: ROLES, PLANNING_FIELDS (fields that count as a design change after baseline).
  engine.js   Pure Capacity + Validation engine (spec §8). compute(state) -> metrics + exceptions + rack_flags.
              diffStates / assessImpact / planningHash for change control. No I/O — runs on live data or snapshots.
  db.js       node:sqlite open, row decode/encode, loadState(projectId), audit(), notify(), syncExceptions().
  app.js      HTTP router + all API handlers + workflows (CRUD, rack plan generator, CSV import, plan submit/review,
              commissioning gates, attachments, reports). Exports workflow functions used by seed.js and tests.
  seed.js     Demo users (one per role) + demo projects (see "Demo data").
  index.js    Entry point: opens DB, seeds if empty, starts server.
public/
  index.html  Shell. app.css: design tokens (light/dark), layout. app.js: vanilla-JS SPA, hash routing, no build.
test/
  engine.test.js  Rule-level tests on hand-built states.   api.test.js  End-to-end API workflow tests (in-memory DB).
```

## Architecture & key design decisions

- **State object**: `{ project, halls, tiers, zones, racks, power, cooling }` (see `STATE_COLLECTIONS`). Everything
  in the engine takes this shape, which is why plans can store a JSON snapshot and be re-validated/diffed later.
- **After every write**, `syncExceptions(db, projectId)` recomputes the whole project and reconciles the persistent
  `exceptions` table (new → open + notify recipient roles; gone → resolved; reappeared → reopened + notify).
  Fine for thousands of racks; if it gets slow, make it incremental per hall.
- **Rack-level findings are aggregated per zone** (one exception per rule per zone, listing rack codes) to avoid
  alert floods. Per-rack detail is returned separately as `metrics.rack_flags` (used by the floor map / rack table).
- **Power check is worst-case failover**: each feed path (A and B) must carry the full rack load. "Normal" load
  (50/50 split for dual-corded racks) is also reported. Diversity factor applies to UPS and upstream only.
  Usable = rating × (PF if kVA) × effective units (after N+1/2N/…) × derating × max_load% × (1 − safety margin).
  Asset `load_factor` (e.g. 1.3) adds mechanical/facility load on transformers, switchgear, generators.
- **Generators** carry the racks downstream of the assets listed in `standby_for` (empty = whole site).
- **Cooling**: heat = IT kW × `project.heat_factor` (rule 8.4.1). Zone-dedicated units (RDHx/CDU/in-row) cover
  their zone first; overflow draws on hall-wide units (zone_id null). Zone "cooling allotted" = dedicated +
  pro-rata share of the hall pool. Commissioned cooling (AL-007) uses only assets ≥ commissioned.
- **Density tiers** are per hall (default 3 created with each hall: Standard ≤10, High ≤40, Liquid ≤150).
  The *effective* tier is the higher of the rack's declared tier and the tier its planned kW requires; the zone's
  cooling method must be in that tier's supported methods, and liquid tiers require the 5-item liquid readiness
  checklist on the zone (CDU, pipework, leak detection, maintenance clearance, operational approval).
- **Stranded capacity** per hall = each of power (approved kW), cooling (cooling ÷ heat factor) and space
  (Σ zone positions × zone design density) minus the lowest of the three (the deliverable load).
- **Spec interpretation**: "IT Load Utilisation % = occupied / available approved IT load" is implemented as
  occupied ÷ approved. Occupied rack % = occupied ÷ commissioned (as spec 8.2 says).
- **Change control**: the first approved plan is the *baseline*. Afterwards the live working data can be edited
  freely, but the app shows "N changes since baseline" everywhere; submitting creates a `change_request` with diff,
  impact (power/cooling/space/cabling/cost/commissioning rework) and auto-routed reviewers:
  Design Manager always; Electrical if load/power changed; Mechanical if heat/cooling/density changed; ICT if
  layout/rack count/cabling changed; Commercial if cost ≠ 0, rack count changed or |ΔkW| ≥ threshold (AL-009);
  Project Manager if installed/commissioned racks are affected. All required reviews must approve.
- **Approval guards**: submitter cannot review own plan (segregation); only one open plan per project;
  approval is refused (409) if the working plan changed since submission (planning hash mismatch) — reject and
  resubmit; Design Manager approval with blocking exceptions requires an override justification ≥ 20 chars
  (FR-057/058), which is audited and notifies DM, PM, Auditor (AL-010).
- **Commissioning gates** (`updateRackStatus`): status moves one step at a time
  planned → installed → commissioned → handed_over → occupied (plus vacate occupied→handed_over, decommission,
  revert installed→planned). Evidence (text or attachment) required for commissioned/handed_over. Commissioned
  requires every asset on the A/B power chain to be ≥ commissioned and enough commissioned cooling (hypothetical
  recompute). Handed over/occupied also need zone network + life-safety gates. Occupied needs actual kW ≤ max kW.
  Blocked racks are returned with reasons; the rest of the batch proceeds. Assets: commissioned+ needs evidence
  and a commissioned upstream parent.
- **RBAC**: table-level `writeRoles`/`createRoles` plus field-level `roles` in schema.js. Admin can edit anything
  but **cannot approve plans** (no reviewer role). Executive & Auditor are read-only (enforced in the request
  handler). Users may be restricted to projects via `users.project_ids` (JSON array; null = all).
- **Audit**: every create/update/delete/status/import/upload/submit/review/override writes `audit_log` with
  before/after (changed fields only for updates), reason (`_reason` in request body), and source
  (`ui`, `rack-plan`, `excel-import`, `bulk`, `seed`, `system`). Status changes also go to `status_history`.

## Rule catalogue (engine.js `RULES`)

| Rule | Alert | Severity | Meaning |
|---|---|---|---|
| LOAD-PROJECT | AL-001 | blocking | Σ hall approved IT > project target (FR-018) |
| LOAD-HALL | AL-001 | blocking | Hall planned rack kW > hall approved IT kW |
| LOAD-ZONE | AL-001 | warning | Zone planned kW > zone allocation |
| RACKS-HALL / RACKS-PROJECT | AL-004 | blocking / warning | Rack count > approved layout / project target |
| SPACE-ZONE / SPACE-AREA | AL-004 / — | blocking / warning | Racks > zone positions / used m² > white space |
| DENS-TIER / DENS-NOTIER / RACK-MAX | AL-002 | blocking | Rack kW above declared tier / above all tiers / above rack max |
| COOL-METHOD / COOL-LIQ | AL-003 | blocking | Zone cooling method unsupported for density / liquid readiness incomplete |
| COOL-ZONE / COOL-HALL / COOL-RED | — | blocking | Heat > cooling (zone / hall pool) / cooling redundancy < hall requirement |
| COOL-COMM | AL-007 | blocking | Commissioned heat > commissioned cooling |
| PWR-ASSET | AL-005 | blocking | Failover load > usable capacity of any power asset |
| PWR-RACKPDU | AL-005 | blocking | Rack planned kW > rack PDU rating |
| PWR-SPOF / PWR-RED / PWR-AUTONOMY | — | blocking | Missing/shared A-B path under 2N-type requirement / UPS-gen redundancy / autonomy below requirement |
| PWR-NOFEED | — | warning | Rack without A-feed |
| CAB-ZONE | — | blocking | Racks > cabling pathway capacity |
| COMM-GATE | — | blocking | Commissioned racks on uncommissioned power chain |
| OPS-OVER / OPS-RACK | AL-006 | blocking / warning | Occupied kW > commissioned kW / actual rack kW > max |
| RES-IDLE / STRANDED | AL-008 | warning | Reserved-but-idle commissioned capacity / stranded capacity above threshold |

AL-009 (commercial review) and AL-010 (override) are workflow notifications, not exceptions.

## API (all JSON; header `X-User-Id` required except `/api/meta` and `GET /api/users`)

Spec §14 endpoints exist as named: `POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/data-halls`,
`POST /api/data-halls/:id/it-load`, `POST /api/data-halls/:id/rack-plan`, `POST /api/rack-plans/:id/validate`,
`GET /api/rack-plans/:id/exceptions`, `POST /api/change-requests`, `POST /api/commissioning/rack-status`,
`GET /api/dashboards/capacity-summary`, `GET /api/reports/utilisation` (`&format=csv`). Plus:
`GET /api/projects/:id/state` (everything the UI needs), generic `PUT|DELETE /api/{data-halls|zones|tiers|racks|power-assets|cooling-assets|forecasts}/:id`,
`POST /api/data-halls/:id/{zones|tiers|racks}`, `POST /api/projects/:id/{power-assets|cooling-assets|forecasts}`,
`POST /api/data-halls/:id/racks/import` (text/csv), `POST /api/racks/bulk-update`, `POST /api/projects/:id/validate`,
`GET /api/projects/:id/exceptions?status=open|resolved|all`, `GET|POST /api/projects/:id/plans`, `GET /api/plans/:id`,
`POST /api/plans/:id/review` `{decision, comment, override_justification}`, `GET /api/projects/:id/compare?from=&to=`,
`POST /api/commissioning/asset-status`, `GET /api/projects/:id/history`, `POST|GET /api/attachments[/:id]`,
`GET /api/notifications`, `POST /api/notifications/read`, `GET /api/audit` (`&format=csv`), `GET /api/reports/racks`,
`GET|POST|PUT /api/users`, `POST /api/admin/reset-demo`.

Errors: `{ error }` with 400/401/403/404/409/413/422; 422 on blocked approval includes `blocking: [...]`.

## UI (public/app.js)

Hash routes: `#/dashboard/{executive|design|electrical|mechanical|operations}`, `#/halls[/:id]` (floor map coloured
by status or kW, flagged racks outlined red), `#/racks` (filters, multi-select, bulk status/edit, generate plan,
CSV import/export), `#/power` (chain tree), `#/cooling`, `#/exceptions`, `#/plans[/:id]` (baseline vs working
plan, impact, side-by-side, review/override), `#/commissioning` (zone gates, asset status, milestone recorder,
history with evidence downloads), `#/project` (master data, factors, forecasts, exports), `#/audit`,
`#/portfolio`, `#/admin`. Forms are generated from `/api/meta` (schema.js); role-restricted fields show locked.
Charts are hand-rolled SVG (`hbars`, `lineChart`) with hover tooltips; colours are CSS tokens with dark mode.

## Demo data (server/seed.js)

12 users, one per role (Design Manager "Daniel Okafor" is the default UI user; Planner "Liam Walsh";
Commissioning "Sofia Marin"; Operations "Ken Watanabe"; etc. — all fictional, `@example.com`).
Project **LON-DC1** (4 MW target): DH1 Day-1 hall (Zone A/B air 8 kW, Zone C RDHx 30 kW, 2N power, partly
commissioned/handed over/occupied) and DH2 Phase-2 AI hall (80 kW DLC pod, liquid ops approval outstanding).
Baseline v1 was approved **with an override** for the DH2 liquid gap. After that, two Zone C racks were uplifted
to 45 kW, producing 6 new blocking exceptions and a pending change for the reviewer flow demo.
Project **MAN-DC2** is an empty concept-stage project for the portfolio view.

## Conventions

- ES modules, no build, no dependencies — keep it that way unless there's a strong reason.
- Add a new field: add it to `ENTITIES` in schema.js (and to `PLANNING_FIELDS` if a change to it should require
  a change request), reseed. The form, API whitelist and permissions follow automatically.
- Add a validation rule: add to `RULES` (alert, severity, recipients, title, spec ref) and `emit(...)` it in
  `compute()`; add an engine test. Recipients are role keys from `ROLES`.
- Keep engine.js pure (no DB access) so snapshots and tests keep working.
- Every mutating API path must `audit(...)` and then `syncExceptions` (route helper `afterWrite`).

## Not done / next steps (from spec phases & open decisions §21)

- **Auth**: no SSO — replace the `X-User-Id` header with Microsoft Entra ID (OIDC) and map groups to roles.
- **Integrations** (spec §12): PMWeb, Oracle Fusion, BIM/Revit, DCIM, BMS/SCADA, CMMS, Power BI, SharePoint — none
  built. The `source` column on audit/status history is ready for integration-originated updates. Suggested: an
  integration service that calls the same workflow functions in app.js.
- **Notifications** are in-app only (per role). Email/Teams delivery not implemented.
- **Excel**: import/export is CSV (save .xlsx as CSV). Native .xlsx would need a dependency.
- **Not modelled yet**: tenant-level capacity contracts, per-row busway tap-off detail, breaker schedules,
  RPP-level circuits, cooling chilled-water loops/heat rejection plant as separate checks, weight/floor loading,
  schedule/cost from ERP, PUE measurement (only design PUE), CFD/digital twin, predictive forecasting.
- **Scale/hosting**: single Node process + SQLite. For enterprise (spec §13) move to PostgreSQL/Azure SQL,
  add migrations, run behind a reverse proxy with TLS, and put attachments in Blob Storage/SharePoint.
- **UI polish candidates**: pagination beyond 600 racks in the rack table, sorting columns, diff labels use raw
  field names (could use schema labels), printable reports.
- Open spec decisions (§21) are still open — e.g. official hierarchy (currently campus/site text → building/floor
  on hall → hall → zone/pod → row → rack), density band thresholds (configurable per hall), override authority
  (currently Design Manager only).

## Environment note

This code was created in a temporary cloud container (Claude Code on the web), not on the user's machine.
It is only durable once committed and pushed to a git remote or downloaded.
