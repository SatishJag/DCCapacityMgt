# DC Capacity Control

Data Centre Capacity Planning and Infrastructure Validation Platform (MVP).

Plans IT load, rack density and rack counts per project / data hall / zone / row / rack, validates them against
power-chain, cooling, space, cabling and redundancy capacity, routes exceptions to the right discipline, controls
baselines and change requests with impact assessment, gates capacity release through commissioning and handover,
and reports utilisation with role-based dashboards and a full audit trail.

```bash
npm start   # http://localhost:3000 — Node.js >= 22.5, no dependencies; demo data is seeded on first run
npm test
```

Use the "Signed in as" selector (top right) to act as different roles. See `CLAUDE.md` for architecture,
rules, API and next steps.
