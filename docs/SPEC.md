# Data Centre IT Load, Rack Planning and Infrastructure Capacity Management Application  
**Functional and Technical Specification**  
**Version:** 1.0  
**Purpose:** Convert data centre IT load, rack density, rack utilisation, and infrastructure linkage requirements into a complete application specification.

---

## 1. Executive Summary

The proposed application shall provide a centralised platform for planning, validating, approving, tracking, and reporting IT load and rack capacity across data centre projects. The solution shall link business demand, IT load requirements, rack density, power infrastructure, cooling infrastructure, commissioning progress, and handover utilisation into a single controlled system.

The application shall not only capture rack and IT load data, but shall also validate whether the planned rack load is supported by the designed electrical, mechanical, cooling, containment, cable management, and redundancy infrastructure.

The system shall support the full lifecycle from concept planning through design, procurement, construction, commissioning, handover, and operations.

---

## 2. Reference Standards and Design Alignment

The solution should be designed to support data centre planning principles aligned with recognised data centre standards and practices. ANSI/TIA-942 covers data centre physical infrastructure, including site location, architecture, electrical, mechanical, fire safety, telecommunications, security, monitoring, and redundancy.

BICSI 002-2024 covers data centre design and implementation best practices across site planning, electrical systems, standby and backup power, mechanical systems, heat rejection, airflow, liquid cooling, security, fire, DCIM, telecommunications, commissioning, maintenance, and energy efficiency.

ASHRAE’s data centre thermal guidance covers air-cooled equipment, liquid-cooled equipment, facility temperature and humidity measurement, equipment placement, airflow patterns, and equipment heat-load/airflow reporting.

ISO/IEC 30134-2:2026 defines Power Usage Effectiveness as a KPI for measuring data centre energy efficiency and supports standardised energy-performance reporting. EN 50600-1:2026 also introduces classification principles around availability, security, resource efficiency, energy efficiency, KPIs, resilience, documentation, operation, management, and environmental sustainability strategy.

Uptime Institute Tier principles should be considered where the project requires formal availability classification, redundancy, concurrent maintainability, or fault-tolerance alignment.

These standards are reference inputs for the application design. The application itself shall not claim certification unless a formal certification process is separately undertaken.

---

## 3. Application Name

Recommended working name:

**Data Centre Capacity Planning and Infrastructure Validation Platform**

Alternative names:

1. **DC Capacity Control System**
2. **IT Load and Rack Planning Platform**
3. **Data Hall Capacity Management System**
4. **Rack-to-Infrastructure Planning Application**
5. **Data Centre Load Governance Platform**

---

## 4. Business Objectives

The application shall achieve the following business objectives:

1. Capture structured IT load requirements for each project, building, floor, data hall, zone, row, and rack.
2. Define standard and high-density rack configurations.
3. Track installed, commissioned, and occupied rack capacity.
4. Link rack plans to power, cooling, cabling, and infrastructure design parameters.
5. Prevent over-allocation of rack load beyond approved infrastructure capacity.
6. Provide alerts where rack planning changes exceed electrical or mechanical design assumptions.
7. Support phased capacity planning for Day 1, Day 2, future expansion, and ultimate build-out.
8. Provide accurate dashboards for project teams, design managers, commercial teams, operations, and management.
9. Maintain auditability, version control, approval workflows, and design-change history.
10. Integrate with project management, procurement, design, DCIM, BMS, commissioning, and finance systems.

---

## 5. Scope of the Application

### 5.1 In Scope

The system shall cover:

1. Project setup and data centre master data.
2. IT load requirement capture.
3. Data hall definition.
4. Rack density configuration.
5. Rack count planning.
6. Standard-density and high-density zone planning.
7. Power redundancy requirement capture.
8. UPS requirement capture.
9. Generator backup requirement capture.
10. Power distribution linkage.
11. Cooling capacity linkage.
12. Cable management linkage.
13. Rack utilisation tracking.
14. Commissioning and handover milestone updates.
15. Capacity variance tracking.
16. Alerting and exception management.
17. Design change impact assessment.
18. Approval workflows.
19. Dashboards and reports.
20. Integration with other enterprise systems.

### 5.2 Out of Scope for Initial MVP

The following may be deferred to later phases:

1. Real-time live telemetry from sensors.
2. Automatic CFD simulation.
3. Automated BIM model generation.
4. AI-based rack placement optimisation.
5. Full DCIM replacement.
6. Automated procurement ordering.
7. Automated energy trading or carbon reporting.

However, the application architecture should be designed so these capabilities can be added later.

---

## 6. User Roles

The application shall support role-based access control.

| Role | Main Responsibilities |
|---|---|
| System Administrator | Configure users, permissions, master data, integrations, and workflow rules. |
| Project Manager | Create projects, monitor progress, approve project-level submissions. |
| Design Manager | Validate rack/load planning against infrastructure design assumptions. |
| Electrical Engineer | Define and validate UPS, generator, PDU, busway, switchgear, breaker, and redundancy capacity. |
| Mechanical Engineer | Define and validate cooling capacity, cooling methodology, containment, airflow, CDU, CRAH/CRAC, and chilled-water assumptions. |
| ICT / Network Engineer | Define network, structured cabling, pathways, MMR/MDF/IDF, and cable-management constraints. |
| Data Centre Planner | Enter IT load, rack density, rack count, and hall planning information. |
| Commissioning Manager | Update installed and commissioned rack/infrastructure status at commissioning milestones. |
| Operations Manager | Update occupied racks, operational IT load, and handover utilisation. |
| Commercial / Cost Manager | Review capacity changes with commercial impact. |
| Executive / Management User | View dashboards, KPIs, capacity trends, and risk reports. |
| Auditor | View historical records, approvals, changes, and evidence without editing rights. |

---

## 7. Functional Modules

## 7.1 Project and Site Master Module

The system shall allow authorised users to create and maintain the data centre project structure.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-001 | The system shall allow creation of a data centre project with project name, code, location, owner, phase, capacity target, and status. |
| FR-002 | The system shall support hierarchy definition: campus, site, building, floor, data hall, pod, zone, row, and rack. |
| FR-003 | The system shall capture planned total IT load in kW and MW. |
| FR-004 | The system shall capture project design stage, such as concept, schematic design, detailed design, construction, commissioning, handover, and operations. |
| FR-005 | The system shall maintain project baseline versions for each approved capacity plan. |
| FR-006 | The system shall allow definition of Day 1 capacity, phased capacity, reserved capacity, and ultimate build-out capacity. |

---

## 7.2 IT Load Requirements Capture Module

The system shall provide a structured form to capture IT load requirements.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-007 | The system shall capture total IT load in kW and MW. |
| FR-008 | The system shall capture IT load per data hall. |
| FR-009 | The system shall capture IT load per zone within each data hall. |
| FR-010 | The system shall capture IT load per rack, including average kW/rack and maximum kW/rack. |
| FR-011 | The system shall capture peak, committed, reserved, and forecast IT load. |
| FR-012 | The system shall capture power redundancy requirements per load type, such as N, N+1, 2N, 2N+1, distributed redundant, or block redundant. |
| FR-013 | The system shall capture UPS type, UPS topology, UPS rating, UPS autonomy, and UPS load allocation. |
| FR-014 | The system shall capture generator backup requirement, including generator rating, runtime requirement, fuel autonomy, and generator redundancy. |
| FR-015 | The system shall capture load criticality classification, such as critical IT load, non-critical IT load, network load, security load, monitoring load, and facility-support load. |
| FR-016 | The system shall capture planned load growth by month, quarter, year, and project phase. |
| FR-017 | The system shall support upload of IT load schedules from Excel templates. |
| FR-018 | The system shall validate that total data hall IT load does not exceed project-level approved IT load unless a change request is raised. |

---

## 7.3 Rack Density Definition Module

The system shall allow users to define rack density configurations for each data hall.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-019 | The system shall capture standard rack density in kW/rack for each data hall. |
| FR-020 | The system shall capture high-density zone specifications. |
| FR-021 | The system shall capture ultra-high-density or AI/GPU rack specifications where applicable. |
| FR-022 | The system shall capture cooling methodology per density tier, such as air cooling, rear-door heat exchanger, in-row cooling, direct-to-chip liquid cooling, immersion cooling, or hybrid cooling. |
| FR-023 | The system shall capture total rack count per data hall. |
| FR-024 | The system shall capture total rack count for the full project. |
| FR-025 | The system shall classify racks by density tier, for example: low density, standard density, high density, and liquid-cooled high density. |
| FR-026 | The system shall define rack physical attributes, including rack size, U height, width, depth, weight rating, power feed type, and network/cabling allowance. |
| FR-027 | The system shall identify stranded capacity where power, cooling, or space capacity is available but cannot be practically used due to infrastructure limitations. |
| FR-028 | The system shall allow density assumptions to be version-controlled and approved. |

---

## 7.4 Data Hall and Zone Planning Module

The system shall support data hall planning at a granular level.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-029 | The system shall define data hall name, number, floor, area, capacity, rack count, design density, and operating status. |
| FR-030 | The system shall define zones within each data hall. |
| FR-031 | The system shall define rack rows and rack positions. |
| FR-032 | The system shall define cold aisle, hot aisle, containment type, and airflow direction. |
| FR-033 | The system shall capture available white space area and used white space area. |
| FR-034 | The system shall calculate rack capacity per data hall, zone, and row. |
| FR-035 | The system shall compare planned rack load against design rack density. |
| FR-036 | The system shall support reservation of rack positions for future clients, future IT deployment, or internal systems. |

---

## 7.5 Rack Utilisation Tracking Module

The system shall track rack utilisation throughout commissioning, handover, and operations.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-037 | The system shall track total racks planned. |
| FR-038 | The system shall track total racks installed. |
| FR-039 | The system shall track total racks commissioned. |
| FR-040 | The system shall track total racks handed over. |
| FR-041 | The system shall track total racks occupied. |
| FR-042 | The system shall calculate utilisation percentage by data hall. |
| FR-043 | The system shall calculate utilisation percentage by zone, row, and rack type. |
| FR-044 | The system shall compare occupied IT load in kW against available IT load in kW. |
| FR-045 | The system shall update rack utilisation at each commissioning and handover milestone. |
| FR-046 | The system shall maintain a history of utilisation changes by date, user, milestone, and source system. |
| FR-047 | The system shall distinguish between installed capacity, commissioned capacity, handed-over capacity, sold capacity, reserved capacity, and occupied capacity. |
| FR-048 | The system shall calculate remaining available capacity by rack count, kW, cooling, and space. |

---

## 7.6 Rack Planning to Infrastructure Linkage Module

The system shall link rack planning data to infrastructure design parameters.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-049 | The system shall link rack count, rack density, and rack IT load to electrical design capacity. |
| FR-050 | The system shall link rack count, rack density, and rack IT load to cooling design capacity. |
| FR-051 | The system shall link rack count and row layout to cable management capacity. |
| FR-052 | The system shall link rack locations to power paths, including UPS, switchgear, PDU, RPP, busway, rack PDU, and A/B feeds. |
| FR-053 | The system shall link rack locations to cooling infrastructure, including CRAH/CRAC units, chilled-water loops, CDUs, in-row coolers, containment zones, or liquid-cooling loops. |
| FR-054 | The system shall link rack locations to network/cabling infrastructure, including MMR, MDF, IDF, fibre pathways, copper pathways, cable trays, and overhead/underfloor routing. |
| FR-055 | Where rack planning changes exceed infrastructure design parameters, the system shall generate an alert to the Design Manager. |
| FR-056 | The system shall generate discipline-specific alerts to Electrical, Mechanical, ICT, Commercial, and Project Management teams. |
| FR-057 | The system shall prevent final approval of a rack plan where mandatory infrastructure validation has failed. |
| FR-058 | The system shall allow authorised override only with justification, approval, and audit trail. |

---

## 7.7 Power Capacity Planning Module

The application should include a dedicated power planning module because IT load cannot be managed properly without power-chain validation.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-059 | The system shall capture utility power capacity. |
| FR-060 | The system shall capture transformer capacity. |
| FR-061 | The system shall capture MV/LV switchgear capacity. |
| FR-062 | The system shall capture UPS capacity, redundancy, load factor, and available headroom. |
| FR-063 | The system shall capture battery autonomy and runtime assumptions. |
| FR-064 | The system shall capture generator capacity, redundancy, fuel autonomy, and load support mapping. |
| FR-065 | The system shall capture PDU, RPP, busway, tap-off box, rack PDU, and breaker capacity. |
| FR-066 | The system shall capture A-feed and B-feed allocation per rack. |
| FR-067 | The system shall calculate whether the connected rack load exceeds allowable circuit, PDU, busway, UPS, or generator capacity. |
| FR-068 | The system shall support derating factors, diversity factors, power factor, and safety margin configuration. |
| FR-069 | The system shall flag single points of failure where redundancy assumptions are not met. |

---

## 7.8 Cooling Capacity Planning Module

The application should include a cooling validation module because rack density directly drives cooling demand.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-070 | The system shall capture cooling capacity by data hall, zone, and cooling system. |
| FR-071 | The system shall capture cooling technology, such as air cooling, chilled water, DX, in-row cooling, rear-door heat exchanger, direct-to-chip liquid cooling, or immersion cooling. |
| FR-072 | The system shall capture CRAH/CRAC capacity, CDU capacity, chilled-water capacity, and heat rejection capacity where applicable. |
| FR-073 | The system shall calculate heat load based on IT load. |
| FR-074 | The system shall compare rack heat load against available cooling capacity. |
| FR-075 | The system shall capture cooling redundancy, such as N, N+1, 2N, or distributed redundant. |
| FR-076 | The system shall capture containment type and airflow assumptions. |
| FR-077 | The system shall flag cooling capacity breach when rack density exceeds the supported cooling methodology. |
| FR-078 | The system shall flag high-density racks that require liquid-cooling or enhanced cooling approval. |
| FR-079 | The system shall support future integration with CFD or digital twin tools. |

---

## 7.9 Commissioning and Handover Module

The system shall manage rack and infrastructure status through commissioning and handover.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-080 | The system shall capture commissioning milestones by project, data hall, zone, row, rack, and infrastructure asset. |
| FR-081 | The system shall track planned, installed, pre-commissioned, commissioned, integrated-tested, handed-over, and operational status. |
| FR-082 | The system shall allow commissioning teams to update rack status. |
| FR-083 | The system shall require evidence attachment for commissioning completion. |
| FR-084 | The system shall update available capacity only after required commissioning gates are completed. |
| FR-085 | The system shall block operational occupancy if required power, cooling, network, or safety commissioning is incomplete. |
| FR-086 | The system shall maintain a full audit trail of commissioning updates. |

---

## 7.10 Change Control and Design Impact Module

The system shall manage changes to IT load, rack density, rack count, and infrastructure assumptions.

### Functional Requirements

| ID | Requirement |
|---|---|
| FR-087 | The system shall create a change request when IT load, rack density, rack count, cooling method, or redundancy requirement changes after baseline approval. |
| FR-088 | The system shall calculate impact on power capacity. |
| FR-089 | The system shall calculate impact on cooling capacity. |
| FR-090 | The system shall calculate impact on cable management and pathway capacity. |
| FR-091 | The system shall calculate impact on space planning. |
| FR-092 | The system shall calculate impact on cost, procurement, commissioning, and delivery dates where data is available. |
| FR-093 | The system shall route change requests to required discipline reviewers. |
| FR-094 | The system shall maintain version history between original baseline and revised plan. |
| FR-095 | The system shall provide side-by-side comparison of previous and proposed capacity plans. |

---

## 7.11 Alerts and Exception Management Module

The system shall generate alerts when capacity, utilisation, or design thresholds are breached.

### Alert Examples

| Alert ID | Trigger | Recipient |
|---|---|---|
| AL-001 | Planned IT load exceeds approved data hall IT load. | Design Manager, Electrical Engineer |
| AL-002 | Rack density exceeds standard design density. | Design Manager, Mechanical Engineer |
| AL-003 | High-density zone requires different cooling methodology. | Mechanical Engineer |
| AL-004 | Rack count exceeds approved layout. | Data Centre Planner, Design Manager |
| AL-005 | A/B feed allocation exceeds PDU or busway capacity. | Electrical Engineer |
| AL-006 | Occupied IT load exceeds commissioned capacity. | Operations Manager |
| AL-007 | Commissioned racks exceed available cooling capacity. | Commissioning Manager, Mechanical Engineer |
| AL-008 | Reserved capacity creates stranded power or cooling capacity. | Project Manager |
| AL-009 | Rack change requires commercial review. | Commercial Manager |
| AL-010 | Manual override submitted. | Design Manager, Project Manager, Auditor |

---

## 8. Key Calculations and Business Rules

### 8.1 IT Load Calculations

| Calculation | Formula |
|---|---|
| Total Project IT Load | Sum of all data hall IT loads |
| Data Hall IT Load | Sum of all zone IT loads within the data hall |
| Zone IT Load | Sum of all rack planned IT loads in the zone |
| Average Rack Density | Total planned IT load / total planned racks |
| Occupied IT Load | Sum of actual occupied rack IT loads |
| Available IT Load | Approved IT load capacity minus occupied IT load |
| IT Load Utilisation % | Occupied IT load / available approved IT load × 100 |

### 8.2 Rack Utilisation Calculations

| Calculation | Formula |
|---|---|
| Installed Rack % | Installed racks / planned racks × 100 |
| Commissioned Rack % | Commissioned racks / planned racks × 100 |
| Occupied Rack % | Occupied racks / commissioned racks × 100 |
| Data Hall Rack Utilisation % | Occupied racks in data hall / commissioned racks in data hall × 100 |
| Remaining Rack Capacity | Commissioned racks minus occupied racks |

### 8.3 Power Validation Rules

1. Planned IT load shall not exceed approved UPS-supported IT load.
2. A-feed and B-feed load shall be checked independently.
3. Rack load shall not exceed rack PDU rating.
4. Rack group load shall not exceed busway or PDU capacity.
5. PDU load shall not exceed upstream UPS allocation.
6. UPS load shall not exceed allowable operating threshold after redundancy and derating.
7. Generator capacity shall support required critical load under the approved redundancy model.
8. Any breach shall trigger a capacity exception.

### 8.4 Cooling Validation Rules

1. Rack heat load shall be assumed to correspond to rack IT electrical load unless a specific conversion model is configured.
2. Planned zone heat load shall not exceed available cooling capacity for that zone.
3. High-density racks shall require approved cooling methodology.
4. Liquid-cooled racks shall require CDU, pipework, leak detection, maintenance clearance, and operational approval.
5. Cooling redundancy shall be validated against the required design class.
6. Cooling capacity breach shall block approval unless formally overridden.

### 8.5 Change Control Rules

1. Any change after baseline approval shall create a new version.
2. Any change affecting power, cooling, cabling, space, cost, or commissioning shall require impact assessment.
3. Any increase beyond approved design capacity shall require Design Manager approval.
4. Any change affecting budget shall require Commercial or Finance review.
5. Any manual override shall require justification and audit capture.

---

## 9. Data Model

The application shall include the following core entities.

### 9.1 Project

| Field | Description |
|---|---|
| Project ID | Unique project identifier |
| Project Name | Data centre project name |
| Location | Country, city, site |
| Client / Owner | Project owner |
| Project Stage | Concept, design, construction, commissioning, handover, operations |
| Target IT Load | Total planned IT load |
| Target Rack Count | Total planned rack count |
| Design Standard | Applicable design standard or internal guideline |
| Status | Draft, submitted, approved, active, closed |

### 9.2 Data Hall

| Field | Description |
|---|---|
| Data Hall ID | Unique data hall identifier |
| Project ID | Linked project |
| Hall Name / Number | Data hall name |
| Floor | Floor or building level |
| White Space Area | Usable IT space |
| Planned IT Load | Approved IT load |
| Planned Rack Count | Approved rack count |
| Cooling Method | Air, liquid, hybrid |
| Redundancy Model | N, N+1, 2N, etc. |
| Status | Planned, under construction, commissioned, operational |

### 9.3 Rack

| Field | Description |
|---|---|
| Rack ID | Unique rack identifier |
| Data Hall ID | Linked data hall |
| Zone / Row / Position | Physical location |
| Rack Type | Standard, high-density, liquid-cooled, network, storage, reserved |
| Planned kW | Planned IT load |
| Max kW | Maximum allowable IT load |
| Actual kW | Actual occupied IT load |
| Rack Status | Planned, installed, commissioned, occupied, decommissioned |
| A Feed Source | Electrical source A |
| B Feed Source | Electrical source B |
| Cooling Zone | Linked cooling zone |
| Network Zone | Linked cabling/network zone |

### 9.4 Power Asset

| Field | Description |
|---|---|
| Asset ID | UPS, generator, switchgear, PDU, RPP, busway, rack PDU |
| Asset Type | Power asset category |
| Rated Capacity | Rated capacity |
| Usable Capacity | Capacity after derating |
| Redundancy | N, N+1, 2N, etc. |
| Supported Load | Linked IT load |
| Status | Planned, installed, commissioned, operational |

### 9.5 Cooling Asset

| Field | Description |
|---|---|
| Asset ID | CRAH, CRAC, CDU, chiller, in-row cooler, RDHx |
| Asset Type | Cooling asset category |
| Rated Cooling Capacity | Cooling capacity |
| Usable Cooling Capacity | Capacity after derating |
| Cooling Zone | Linked data hall or zone |
| Redundancy | N, N+1, 2N, etc. |
| Status | Planned, installed, commissioned, operational |

### 9.6 Change Request

| Field | Description |
|---|---|
| Change ID | Unique change identifier |
| Change Type | Load, rack, cooling, power, cabling, redundancy, layout |
| Previous Value | Current baseline value |
| Proposed Value | New requested value |
| Impact Summary | Power, cooling, cost, schedule, commissioning impact |
| Reviewer | Required approver |
| Approval Status | Draft, submitted, approved, rejected |
| Audit Trail | User, date, comments, attachments |

---

## 10. Workflows

## 10.1 New Project Setup Workflow

1. Project Manager creates the project.
2. Data Centre Planner defines site, building, floor, and data hall structure.
3. Planner enters target IT load and rack count.
4. Electrical Engineer enters power infrastructure assumptions.
5. Mechanical Engineer enters cooling infrastructure assumptions.
6. ICT Engineer enters network and cabling assumptions.
7. System validates rack plan against infrastructure capacity.
8. Exceptions are routed to the Design Manager.
9. Design Manager approves baseline capacity plan.
10. Approved plan becomes the controlled baseline.

---

## 10.2 IT Load Planning Workflow

1. User creates IT load requirement.
2. User allocates load by data hall, zone, and rack type.
3. User defines average and maximum rack density.
4. User selects redundancy requirement.
5. User selects UPS and generator requirement.
6. System validates load against approved infrastructure.
7. System identifies power, cooling, and cabling constraints.
8. User revises plan or submits exception.
9. Design Manager approves or rejects.

---

## 10.3 Rack Density Change Workflow

1. User submits proposed rack density change.
2. System compares proposed density with approved standard density.
3. System checks cooling methodology.
4. System checks power feed and PDU/busway capacity.
5. System checks containment and cable pathway capacity.
6. System generates impact assessment.
7. Discipline engineers review.
8. Design Manager approves.
9. System creates new approved baseline version.

---

## 10.4 Commissioning Update Workflow

1. Commissioning Manager updates installed racks.
2. System records installation status.
3. Commissioning Manager updates commissioned racks.
4. System validates supporting power and cooling commissioning status.
5. If supporting infrastructure is incomplete, system blocks capacity release.
6. If complete, system releases commissioned capacity.
7. Operations Manager updates occupied racks after handover.
8. Dashboards update utilisation and available capacity.

---

## 11. Reports and Dashboards

The application shall provide the following dashboards.

### 11.1 Executive Dashboard

1. Total planned IT load.
2. Total commissioned IT load.
3. Total occupied IT load.
4. Total available IT load.
5. Total planned racks.
6. Total commissioned racks.
7. Total occupied racks.
8. Utilisation by project, building, data hall, and phase.
9. Capacity risk summary.
10. Open design exceptions.

### 11.2 Design Manager Dashboard

1. Rack density variance.
2. Power capacity breaches.
3. Cooling capacity breaches.
4. Cabling/pathway constraints.
5. High-density rack approvals.
6. Change requests awaiting review.
7. Baseline vs current plan comparison.

### 11.3 Electrical Dashboard

1. UPS load utilisation.
2. Generator load utilisation.
3. PDU/RPP/busway utilisation.
4. A-feed/B-feed balance.
5. Breaker capacity exceptions.
6. Redundancy compliance.

### 11.4 Mechanical Dashboard

1. Cooling capacity utilisation.
2. Heat load by data hall.
3. High-density cooling zones.
4. Cooling redundancy compliance.
5. Containment status.
6. Liquid-cooling readiness.

### 11.5 Operations Dashboard

1. Occupied racks.
2. Available racks.
3. Occupied IT load.
4. Available IT load.
5. Commissioned vs occupied capacity.
6. Handover status.
7. Stranded capacity.

---

## 12. Integration Requirements

The application should integrate with the following systems where available.

| System | Integration Purpose |
|---|---|
| PMWeb or Project Management System | Project milestones, design packages, change control, commissioning milestones. |
| Oracle Fusion / ERP | Budget, procurement, asset, and financial data. |
| BIM / Revit / Digital Twin | Rack layout, spatial model, asset locations, data hall geometry. |
| DCIM | Live rack, power, capacity, and asset utilisation data. |
| BMS / SCADA | Cooling, power, environmental, and equipment status data. |
| CMMS | Maintenance status, asset lifecycle, work orders. |
| Power BI | Management dashboards and reporting. |
| Document Management / SharePoint | Drawings, specifications, approvals, commissioning evidence. |
| Identity Provider | Single sign-on and role-based access control. |

---

## 13. Technical Architecture

### 13.1 Recommended Architecture

The application should be implemented as a modular web-based enterprise platform.

Recommended architecture:

1. **Frontend:** React, Angular, or similar enterprise web framework.
2. **Backend API:** REST or GraphQL API layer.
3. **Application Services:** Capacity planning service, validation service, workflow service, notification service, integration service, reporting service.
4. **Database:** Azure SQL Database, PostgreSQL, or SQL Server.
5. **File Storage:** Azure Blob Storage or SharePoint for attachments and evidence.
6. **Workflow Engine:** Built-in workflow service or integration with Power Automate / Logic Apps.
7. **Rules Engine:** Configurable business rules for capacity, redundancy, power, cooling, and alert thresholds.
8. **Analytics:** Power BI semantic model and dashboards.
9. **Integration Layer:** Azure API Management, Azure Data Factory, Logic Apps, or middleware integration hub.
10. **Authentication:** Microsoft Entra ID / Azure AD.
11. **Hosting:** Azure App Service, AKS, or containerised microservices depending on enterprise scale.

### 13.2 Logical Components

| Component | Description |
|---|---|
| UI Layer | Forms, dashboards, planning screens, approval screens. |
| API Layer | Secure endpoints for application operations. |
| Capacity Engine | Performs load, rack, power, and cooling calculations. |
| Validation Engine | Checks planning data against infrastructure constraints. |
| Workflow Engine | Manages approvals, change requests, and escalations. |
| Notification Engine | Sends email, Teams, or system notifications. |
| Integration Engine | Exchanges data with PMWeb, ERP, BIM, DCIM, BMS, and Power BI. |
| Audit Engine | Records user actions, changes, approvals, and overrides. |
| Reporting Layer | Operational, design, and executive reports. |

---

## 14. API Requirements

Example API endpoints:

| API | Purpose |
|---|---|
| `POST /projects` | Create project |
| `GET /projects/{id}` | Retrieve project details |
| `POST /projects/{id}/data-halls` | Create data hall |
| `POST /data-halls/{id}/it-load` | Submit IT load requirement |
| `POST /data-halls/{id}/rack-plan` | Submit rack plan |
| `POST /rack-plans/{id}/validate` | Validate rack plan against infrastructure |
| `GET /rack-plans/{id}/exceptions` | Retrieve validation exceptions |
| `POST /change-requests` | Create change request |
| `POST /commissioning/rack-status` | Update rack commissioning status |
| `GET /dashboards/capacity-summary` | Retrieve dashboard data |
| `GET /reports/utilisation` | Generate rack utilisation report |

---

## 15. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Availability | The application should support high availability for project and operations users. |
| Performance | Capacity validation should complete within acceptable response times for standard project sizes. |
| Scalability | The system should support multiple projects, data halls, thousands of racks, and phased build-outs. |
| Security | The system shall enforce role-based access control. |
| Auditability | All changes, approvals, rejections, and overrides shall be logged. |
| Data Integrity | System calculations shall be traceable to source records. |
| Usability | Forms shall be structured, searchable, and template-driven. |
| Integration Reliability | Failed integrations shall be logged and retryable. |
| Configurability | Density tiers, alert thresholds, redundancy models, and workflow rules shall be configurable. |
| Reporting | Data shall be available for dashboards and export. |
| Compliance | The system shall support internal governance and design-control requirements. |

---

## 16. Security and Access Control

The system shall include:

1. Single sign-on.
2. Role-based permissions.
3. Project-level access control.
4. Data hall-level access control where required.
5. Read-only auditor access.
6. Approval authority matrix.
7. Segregation between creator, reviewer, and approver.
8. Full audit trail.
9. Attachment access control.
10. Data export restrictions for sensitive project data.

---

## 17. Audit Trail Requirements

The system shall record:

1. User who created the record.
2. User who modified the record.
3. Previous value and new value.
4. Date and time of change.
5. Reason for change.
6. Approval comments.
7. Rejection comments.
8. Override justification.
9. Attached evidence.
10. Source system of update, where applicable.

---

## 18. Missing Requirements Added

The original requirements covered IT load, rack density, rack utilisation, and infrastructure linkage. The following important requirements have been added because they are necessary for a complete application:

1. Project and site hierarchy.
2. Data hall, zone, row, and rack master data.
3. Phased capacity planning.
4. Day 1 vs future build-out planning.
5. Reserved, sold, commissioned, occupied, and available capacity.
6. Power chain validation.
7. Cooling chain validation.
8. A-feed and B-feed allocation.
9. UPS, generator, PDU, RPP, busway, rack PDU linkage.
10. Cooling methodology validation.
11. High-density and liquid-cooled rack handling.
12. Cable management and pathway capacity.
13. Commissioning and handover workflow.
14. Design change control.
15. Approval workflow.
16. Alert and exception management.
17. Dashboard and reporting requirements.
18. Integration requirements.
19. Audit trail.
20. Security and role-based access control.
21. Baseline and version control.
22. Stranded capacity identification.
23. Commercial and cost impact review.
24. Operations handover control.
25. Future DCIM, BMS, BIM, and digital twin integration.

---

## 19. MVP Recommendation

The MVP should include the minimum features needed to make the application useful quickly.

### MVP Phase 1

1. Project setup.
2. Data hall setup.
3. IT load capture.
4. Rack density definition.
5. Rack count planning.
6. Basic power capacity capture.
7. Basic cooling capacity capture.
8. Rack utilisation tracking.
9. Alerts for capacity breach.
10. Approval workflow.
11. Capacity dashboard.

### Phase 2

1. Detailed power chain mapping.
2. Detailed cooling chain mapping.
3. A/B feed validation.
4. Commissioning milestone integration.
5. PMWeb integration.
6. Power BI dashboard integration.
7. Change impact workflow.
8. Excel upload and export.

### Phase 3

1. DCIM integration.
2. BMS/SCADA integration.
3. BIM/digital twin linkage.
4. Predictive capacity forecasting.
5. AI-assisted rack planning.
6. Energy efficiency and PUE reporting.
7. Automated stranded capacity analysis.

---

## 20. Acceptance Criteria

The solution shall be accepted when the following conditions are met:

1. Users can create a project and define data halls.
2. Users can capture total IT load and IT load by data hall.
3. Users can define rack density by data hall and zone.
4. Users can define standard and high-density rack configurations.
5. Users can capture total planned racks, installed racks, commissioned racks, and occupied racks.
6. The system calculates utilisation by data hall.
7. The system compares occupied IT load against available IT load.
8. The system links rack planning to power and cooling parameters.
9. The system generates alerts when rack planning exceeds infrastructure design capacity.
10. The Design Manager receives and can act on alerts.
11. The system maintains version history.
12. The system supports approvals.
13. The system provides dashboards.
14. The system exports reports.
15. The system maintains audit logs for all changes.

---

## 21. Key Open Design Decisions

The following decisions should be confirmed before detailed design:

1. Will the system be a standalone application or part of an existing PMWeb / DCIM / ERP platform?
2. What is the official project hierarchy: campus, building, floor, hall, pod, zone, row, rack?
3. What redundancy models must be supported?
4. What rack density bands should be used?
5. What is the threshold for high-density rack classification?
6. Will liquid cooling be supported from Day 1?
7. Will the system integrate with live DCIM/BMS data?
8. Should the application support tenant/customer allocation?
9. Should commercial cost impact be mandatory for every capacity change?
10. Who has authority to override infrastructure capacity exceptions?
11. Should the application manage only design capacity or also operational real-time utilisation?
12. What dashboards are required for executive reporting?
13. What systems are the master source for project, asset, procurement, and commissioning data?

---

## 22. Recommended Final Solution Statement

The proposed application shall serve as the controlled system for data centre IT load, rack density, rack utilisation, and infrastructure capacity governance. It shall provide structured data capture, capacity calculations, infrastructure validation, alerts, workflows, dashboards, auditability, and integration capabilities. The platform shall ensure that rack deployment and IT load growth remain aligned with approved power, cooling, cabling, commissioning, and operational capacity throughout the project lifecycle.
