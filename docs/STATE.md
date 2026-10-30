# DisruptionIQ Verified Recovery Desk — Project State

_Last updated: 2026-10-30 by Step 17 (Hardening & Demo Readiness)_

---

## Step Status Table

| Step | Title | Status |
|------|-------|--------|
| 0 | Brain | **STEP 0: PASS** |
| 1 | Scaffold and Mongo replica set | **STEP 1: PASS** |
| 2 | Data model and security roles | **STEP 2: PASS** |
| 3 | Seed data | **STEP 3: PASS** |
| 4 | Auth, RBAC, audit hash chain | **STEP 4: PASS** |
| 5 | Import pipeline and Belief-ETA reconciler | **STEP 5: PASS** |
| 6 | Voice and text ingestion, impact engine and risk bands | **STEP 6: PASS** |
| 7 | Solver service and recovery plan generation | **STEP 7: PASS** |
| 8 | Proof checker, Decision Contract and governed approvals | **STEP 8: PASS** |
| 9 | Reservations, conflict court, ledger, rollback, guardrails and promise dates | **STEP 9: PASS** |
| 10 | Notifications, detectors, alerts, KPIs, SPOF radar, replay, lineage and provenance | **STEP 10: PASS** |
| 11 | Playbook, fingerprints, scorecards, cover and drift, delegation, master data and customer notices | **STEP 11: PASS** |
| 12 | Ask the Desk, What-If, stress test and red-team (backend complete) | **STEP 12: PASS (BACKEND COMPLETE)** |
| 13 | Frontend shell, design system and screens 1 to 4 | **STEP 13: PASS** |
| 14 | Screens 5 and 6, notification drawer, Ask drawer, network map and add-on panels | **STEP 14: PASS** |
| 15 | Screens 7 and 8, voice in the browser and operator phone view | **STEP 15: PASS** |
| 16 | Full acceptance suite | **STEP 16: PASS** |
| 17 | Hardening, full-repo review and demo readiness | **STEP 17: PASS** |
| 18 | Final audit | NOT STARTED |

---

## OLD TO NEW STEP MAP

old 6 and 7 are new 5; old 8 and 9 are new 6; old 10 and 11 are new 7; old 12 and 13 are new 8; old 14 and 15 are new 9; old 16 and 17 are new 10; old 18 and 20 are new 11; old 19 and 21 are new 12; old 5 and 22 are new 13; old 23 and 25 are new 14; old 24 and 26 are new 15; old 27 is new 16; old 28 and 29 are new 17; old 30 is new 18.

---

## COMPLETED STEPS

### Step 0 — Brain (PASS)
- Architecture blueprint, PRD, and operational invariants established.

### Step 1 — Scaffold and Mongo replica set (PASS)
- Monorepo configured with Turborepo, Vite React TS frontend, Express TS backend, FastAPI solver, shared packages, Vitest + Pytest.

### Step 2 — Data model, indexes, validators, security roles (PASS)
- **Mongoose Models**: 45+ models across `apps/api/src/models/` for all blueprint collections.
- **Database Constraints & Validators**: Strict `inventory_balances` validator (`reserved <= on_hand`), partial unique indexes on `shipment_events` and `alerts`.
- **Transactions & Concurrency**: `withTransaction.ts` helper with transient retry handling and canonical `(warehouse_id, sku_id)` lock order.
- **Security Roles**: `scripts/db-security.mjs` creating `app_rw`, `app_readonly`, and `demo_admin`.
- **Tests**: 19 automated tests in `apps/api/test/step2-data-model.test.ts`.

### Step 3 — Seed data (all scenarios, add-ons, micro-features) (PASS)
- **Deterministic Seed**: `apps/api/src/services/seedData.ts` and `scripts/seed.ts` populating:
  - 3 warehouses (`WH-HOS`, `WH-CHN`, `WH-BLR`) with coordinates and 2h processing time
  - 4 suppliers (`SUP-1` to `SUP-4`) with risk scores (`SUP-2` = 35) and map coordinates
  - 10 SKUs (`SKU-101` through `SKU-615`) with weights, costs, categories
  - 10 SupplierSKUs including `SUP-1` as single point of failure on `SKU-101` into `WH-HOS` and `SUP-2` as qualified alternative (40 units, 36h lead, ₹1,120/unit)
  - 6 transfer lanes with realistic distances and transit times (`CHN↔HOS`, `BLR↔HOS`, `BLR↔CHN`)
  - 18 shipments with promised ETAs, including `SHP-204` (170 units to `WH-HOS`) and `SHP-310` (60 units `SKU-205` to `WH-CHN`). Delivered shipments calibrated so `SUP-1` on-time rate < 70% and `SUP-2` > 90%.
  - 20 orders: Scenario A (`ORD-1042`, `ORD-1047`, `ORD-1051`) demanding exactly 190 units against 120 available supply (20 free stock + 100 usable from `SHP-204`); Scenario B (`ORD-2001`, `ORD-2002`); plus 15 unaffected open/fulfilled orders.
  - 14 inventory balances: `WH-HOS` free 20 of `SKU-101` (below threshold 30); `WH-CHN` free 15 `SKU-101` and 10 `SKU-205` (below threshold 15); `WH-BLR` free 10 `SKU-101` and 30 `SKU-205`.
  - 7 seeded demo users with bcrypt-hashed passwords (Analyst, Manager, Manager2, Warehouse Operator at `WH-HOS`, Procurement Approver, Procurement Approver 2, Administrator).
  - 5 source trust tiers (`FIELD_REPORT` 3, `CARRIER_API` 2, `SUPPLIER_PORTAL` 1, `CSV` 1, `EMAIL_TEXT` 1; tolerance 240 min).
  - 3 risk policies (`RED` >= 70, `AMBER` 40-69, `GREEN` < 40).
  - 5 stock thresholds (`SKU-101@WH-HOS` min 30, `SKU-205@WH-CHN` min 15; horizon 72h).
  - 5 guardrail policies (`EXPEDITE_SPEND` ₹6,000, `SERVICE_DAMAGE_RESIDUAL` ₹2,500, `SERVICE_DAMAGE_BACKORDER_PCT` 20%, `SUPPLIER_RISK` 50, `TRANSFER_DISTANCE` 400 km).
  - 3 disruption fingerprints (`F1`, `F2`, `F3`) and 12 resolved historical cases marked `SEEDED`.
- **Services & Fixtures**:
  - `apps/api/src/services/simClock.ts`: simulation clock service reading `SIM_NOW` env or `settings` DB collection.
  - `apps/api/src/services/demoReset.ts`: reset service for `POST /admin/demo/reset`.
  - `scripts/reset.ts`: CLI demo reset command (`npm run db:reset`).
  - `apps/api/src/fixtures/sampleMessages.ts`: sample messages for Scenario B email/SMS conflict and Tanglish voice transcript.
- **Tests**:
  - 28 automated tests in `apps/api/test/step3-seed.test.ts` verifying idempotency, blueprint counts, stock arithmetic, and supplier on-time ratings.
  - Monorepo full suite: 50 Vitest tests + 1 Pytest test passing cleanly.

### Step 4 — Auth, RBAC, audit service with hash chain (PASS)
- **Role & Capability Matrix**: `packages/shared/src/permissions.ts` defining 31 granular permissions across all 5 roles (`Supply_Chain_Analyst`, `Supply_Chain_Manager`, `Warehouse_Operator`, `Procurement_Approver`, `Administrator`), with warehouse-scoped authorization for Warehouse Operators.
- **Authentication Routes**:
  - `POST /auth/login`: bcrypt verification + signed JWT with role claim.
  - `GET /auth/me`: returns authenticated user profile and derived permission list.
  - `POST /auth/demo-switch`: fast role-switching across all seeded demo users when `DEMO_MODE=true`.
  - Webhook Auth: `POST /webhooks/carrier/:source` with constant-time HMAC-SHA256 signature verification.
- **Audit Service with Serialized Hash Chain**:
  - `apps/api/src/services/audit.ts` maintaining gapless `seq`, `prev_hash`, `row_hash = SHA-256(prev_hash + canonicalJSON(row))` serialized via `ChainState` document update inside MongoDB transactions with exponential jittered backoff.
  - `writeAudit()` and `writeLedgerEntry()` recording operations to append-only collections.
  - `verifyChain(collection)`: scans in `seq` order, recomputes hashes, returns `{ ok, checked, firstBrokenRowId }`.
  - Endpoints: `GET /audit/verify`, `GET /audit` (with filtering and pagination), `POST /admin/demo/tamper` (admin mutation bypassing hashing for demo verification).
- **Security Middlewares & Guardrails**:
  - `apps/api/src/middleware/auth.ts`: `authenticateToken`, `requirePermission`, warehouse scoping checks, and automated `ACCESS_DENIED` audit logging.
  - `apps/api/src/middleware/routeCheck.ts`: `verifyRoutePermissions(app)` boot check ensuring zero untracked non-public routes.
- **Tests**:
  - 47 automated tests in `apps/api/test/step4-auth-rbac-audit.test.ts`.
  - Monorepo full suite: 97 Vitest tests + 1 Pytest test passing cleanly.

### Step 5 — Import pipeline and Belief-ETA reconciler (PASS)
- **Part A: Import pipeline (M1, B11)**:
  - `apps/api/src/services/importParser.ts`: CSV and JSON parsers with SHA-256 file_hash idempotency.
  - `apps/api/src/services/importValidation.ts`: Zod schema validation per entity, Levenshtein distance code suggestions, natural-key duplicate vs conflict detection.
  - `apps/api/src/services/importService.ts`: full quarantine lifecycle (create, quarantine, repair/discard, idempotent commit, quality report).
  - `apps/api/src/services/inventoryCorrection.ts`: audited inventory correction ledger service.
  - `apps/api/src/services/bus.ts`: synchronous domain bus for internal events (`IMPORT_COMMITTED`, `ETA_CHANGED`, `EVENT_APPLIED`, etc.).
  - `apps/api/src/routes/imports.ts`: routes for import upload, quarantine inspection, row repair, commit, quality reporting.
- **Part B: Belief-ETA Reconciler and Carrier Webhook (M2)**:
  - `apps/api/src/services/reconciler.ts`: decision tree evaluating unknown shipments (REJECTED), same key duplicate catch (DUPLICATE), staleness relative to current basis (STALE), source disagreement exceeding tolerance (CONFLICT with `review_status: UNDER_REVIEW`), and trusted ETA overrides (APPLIED with `resolved_eta` and `eta_basis_event_id`).
  - `apps/api/src/routes/events.ts`: conflict listing (`GET /events/conflicts`) and resolution (`POST /events/conflicts/:id/resolve`) with full audit and bus emission.
  - `apps/api/src/routes/webhooks.ts`: carrier webhook wired to reconciler with HMAC-SHA256 verification and backwards-compatible response contract.
  - `apps/api/src/services/scenarioB.ts`: duplicate storm generator (5x duplicate + stale + conflict).
- **Tests**:
  - `apps/api/test/step5-import-pipeline.test.ts`: 3 tests passing.
  - `apps/api/test/step5-reconciler.test.ts`: 6 tests passing (duplicate storm, stale event, conflict tolerance, concurrency, conflict resolution API, RBAC & bad HMAC).
  - Monorepo full suite: 106 Vitest tests + 1 Pytest test passing cleanly.

### Step 6 — Voice and text ingestion, impact engine, risk bands (PASS)
- **Part A: Field reports, voice parse, text ingestion (W1, B15)**:
  - `apps/api/src/llm/provider.ts`: Groq LLM wrapper with input-hash caching in `llm_cache` and typed `LLMUnavailable` fallback.
  - `apps/api/src/services/extractor.ts`: deterministic Tanglish/English rule-based extractor (handling 20+ variants, number words onnu..pathu, damage, delay, and Tamil labels).
  - `apps/api/src/routes/ingest.ts`: `POST /voice/parse` and `POST /ingest/text` storing raw text untouched in `field_reports` with status DRAFT; `GET /fixtures/sample-transcripts`.
  - `apps/api/src/routes/events.ts`: `POST /events` confirm flow with warehouse-scoped authorization (403 for operators confirming other warehouses), links `field_report.event_id`, updates usable stock, and passes through reconciler.
- **Part B: Impact engine, risk waterfall, risk bands (M3, B5)**:
  - `apps/api/src/services/impactEngine.ts`: listens to `EVENT_APPLIED` and `ETA_CHANGED` on domain bus, walks shipment -> destination warehouse -> inventory -> dependent open orders, opens/refreshes ONE disruption per shipment, and computes exact risk formula `100 * (0.35*U + 0.30*S + 0.20*D + 0.15*P)` with best/worst range and evidence row IDs.
  - `apps/api/src/routes/disruptions.ts`: `GET /disruptions`, `GET /disruptions/:id`, `GET /disruptions/:id/impact`, `GET /disruptions/:id/risks` (dynamic re-banding), `GET /disruptions/:id/heatgrid`, `GET/PUT /risk/policy`, and `GET /evidence/:type/:id`.
- **Tests**:
  - `apps/api/test/step6-ingestion-impact.test.ts`: 9 automated tests passing:
    - 20+ Tanglish and English extractor variants.
    - Acceptance test 11 (voice path offline with sample transcript).
    - Acceptance test 38 (sample messages: CONFLICT, DUPLICATE, REJECTED).
    - Operator cross-warehouse scoping (403).
    - Acceptance test 5 (Scenario A lists exactly ORD-1042, ORD-1047, ORD-1051).
    - Hand-calculated risk scores asserted to exact blueprint arithmetic (51.67, 55.73, 68.56).
    - Acceptance test 28 (dynamic re-banding on policy threshold change).
    - Evidence drawer resolving real source documents.
    - Heatgrid factor matrix.
  - Monorepo full suite: 115 Vitest tests + 1 Pytest test passing cleanly.

### Step 7 — Solver service and recovery plan generation (PASS)
- **Part A: Solver service (Python FastAPI + OR-Tools CP-SAT)**:
  - `services/solver/main.py`: CP-SAT model with `POST /solve`, integer units assigned per candidate->order (only if arrival <= due), shortfall per order, minimizes `sum(penalty*shortfall) + action_cost`. Returns `status`, `actions`, `per_order`, `objective`, `baseline_objective`, `collateral`, `solve_ms`, and `scope: "portfolio-level constrained optimisation"`.
  - Golden instances: Scenario A (`services/solver/tests/golden/scenario_a.json`) and Scenario B (`services/solver/tests/golden/scenario_b.json`).
  - Brute-force verifier and tests: 12 tests in `services/solver/tests/test_solver.py` all passing.
- **Part B: Node.js API candidate enumerator and recovery plans**:
  - `apps/api/src/services/candidates.ts`: Candidate enumerator evaluating transfer lanes, donor free stock, one-hop via routes, qualified alt suppliers with capacity, and filtering out routes missing deadlines.
  - `apps/api/src/routes/plans.ts`:
    - `POST /disruptions/:id/recovery-plans` (Analyst, Manager): calls solver, persists `recovery_plans` + `plan_actions` + `plan_tradeoffs`, returns 503 if solver down (no fake data fallback).
    - `GET /plans/:id`: plan details with baseline vs plan objective, savings %, per-order breakdown, and collateral.
    - `GET /plans/:id/tradeoffs`: trade-off ledger per order before/after.
    - `GET /plans/:id/cards`: recommendation cards with `PENDING_VERIFICATION` status (until Step 8 proof checker).
    - `PATCH /plans/:id`: modifies plan, increments version, transitions status to `DRAFT`, audits changes.
  - `apps/api/src/routes/disruptions.ts`: `GET /disruptions/:id/routes` returning direct and via feasible routes.

### Step 8 — Proof checker, Decision Contract and governed approvals (PASS)
- **Part A: Proof-carrying recommendations & Decision Contract (M5, W2)**:
  - `apps/api/src/services/proofChecker.ts`:
    - Mandatory claim generator (`AVAILABLE_STOCK`, `SUPPLIER_CAPACITY`, `SUPPLIER_QUALIFIED`, `LANE_LEAD_TIME`, `DEADLINE_MET`, `ORDER_DEMAND`, `SHIPMENT_ETA`, `RESERVATION_AVAILABLE`, `ROUTE_FEASIBLE`, `PROMISE_DATE_ACHIEVABLE`) with origin SYSTEM.
    - Pure fact verification functions: `checkAnswerFact()` and `checkNoticeDateMatches()`.
    - Verification engine evaluating each claim against live DB state (`PASS`/`FAIL`, expected, actual, evidence row IDs). Any FAIL sets plan status to `BLOCKED`; all PASS sets status to `VERIFIED`.
    - Decision Contract builder computing canonical SHA-256 action hash, required approver roles (`Manager` for transfer/split, `Procurement_Approver` for expedite/reserve), rollback eligibility, impact, and reservations.
    - Injected challenge claims (`POST /plans/:id/challenge`) visibly failing with expected vs actual, blocking approval until cleared.
  - `apps/api/src/services/reservations.ts`: Clean database-backed `reserveStock()` and `releaseStock()` interface operating on `StockReservation` and `InventoryBalance`.
- **Part B: Governed approvals, separation of duties, state machine (M6)**:
  - `apps/api/src/routes/plans.ts`:
    - `POST /plans/:id/verify`: executes proof checker, builds decision contract and canonical hash.
    - `POST /plans/:id/challenge` & `DELETE /plans/:id/challenge`: demo challenge mode.
    - `POST /plans/:id/submit`: enforces `VERIFIED` state, creates stock reservations, creates distinct approval rows per required role with frozen `contract_hash`, transitions status to `PENDING_APPROVAL`.
    - `POST /plans/:id/approve`: enforces role authority (`Manager`, `Procurement_Approver`), blocks `Administrator`, enforces separation of duties (creator, submitter, and modifiers cannot self-approve), enforces distinct approver per role, verifies contract hash freshness. Updates status to `APPROVED` when all roles approve.
    - `POST /plans/:id/reject`: requires reason, releases reservations, sets status to `REJECTED`.
    - Upgraded `GET /plans/:id/cards`: cards show `FEASIBLE` only when claims PASS; `BLOCKED` with failing claim info if failed.
    - Upgraded `PATCH /plans/:id`: resets plan status to `DRAFT`, invalidates contract hash, records modifier ID, increments version.
  - `apps/api/src/routes/approvals.ts`: `GET /approvals/queue` returning pending approval items for caller's role.
  - Domain bus events: `PLAN_SUBMITTED`, `APPROVAL_DECIDED`, `PLAN_APPROVED`.

### Step 9 — Reservations, conflict court, ledger, rollback, guardrails and promise dates (PASS)
- **Milestone Reached**: Event to approved, executed, and rolled-back plan works through the API with zero double-booking.
- **Part A: Double-booking shield, Allocation Conflict Court, Execution Ledger & Rollback (S1, S2, A4)**:
  - `apps/api/src/services/reservations.ts`:
    - Double-Booking Shield (S1): deterministic `(warehouse_id, sku_id)` sort, atomic conditional `updateOne` inside MongoDB replica set transaction checking `$gte: [ { $subtract: ['$on_hand', '$reserved'] }, qty ]`. On conflict returns 409 conflict card.
    - Allocation Conflict Court (A4): creates single `allocation_conflicts` case with competing `allocation_claims` if stock is oversubscribed by competing plans.
    - Reaper function `reapExpiredReservations()` to sweep expired holds.
  - `apps/api/src/routes/conflicts.ts`:
    - `GET /conflicts/allocation` & `GET /conflicts/allocation/:id`: lists open/resolved allocation cases with claims.
    - `POST /conflicts/allocation/:id/resolve`: Manager ruling. Winner proceeds, loser marked `BLOCKED`, loser's stock released, fully audited.
  - `apps/api/src/routes/plans.ts`:
    - `POST /plans/:id/execute` (Manager only): enforces `APPROVED` state, contract hash freshness, separation of duties (`executor != creator` and `executor != submitter`), confirmation flag, and guardrail breach acknowledgement if ESCALATED. Executes simulated movements (donor decremented, destination incremented), writes `execution_ledger` rows joined to hash chain via `writeLedgerEntry`, commits reservations to CONSUMED, sets status to `EXECUTED`.
    - `POST /plans/:id/rollback` (Manager only): checks reversal feasibility, restores exact balances, writes `COMPENSATE` entries into ledger, sets status to `ROLLED_BACK`.
  - `apps/api/src/routes/overview.ts`: `GET /overview` computing real recovery progress per disruption (`APPROVED`, `EXECUTED`, `ROLLED_BACK` counts, orders recovered).
- **Part B: Promise-Date Repair Engine (A7) and Budget Guardrails (A9)**:
  - `apps/api/src/services/promiseDates.ts`:
    - Computes original due date, best recoverable date (latest of transit/supplier lead times + 2h processing), committed promise date, basis string, and evidence IDs.
    - `GET /plans/:id/promise-dates`: returns repaired promise dates.
  - `apps/api/src/services/guardrails.ts`:
    - Checks 4 policies on every plan version: `EXPEDITE_SPEND` (₹6,000), `SERVICE_DAMAGE_RESIDUAL` (₹2,500), `SUPPLIER_RISK` (50), `TRANSFER_DISTANCE` (400 km).
    - Upserts `guardrail_checks` rows. On breach adds missing approver role, or marks plan `ESCALATED` if both roles already required.
  - `apps/api/src/routes/guardrails.ts`:
    - `GET /guardrails`: lists policies.
    - `PUT /guardrails/:id`: updates threshold value (Manager, Administrator), audited.
    - `POST /guardrails/:id/clear-escalation`: clears escalation (Manager, Procurement_Approver; Administrator blocked), audited.
    - `GET /plans/:id/guardrails`: returns check rows for plan version.
  - Auto-triggering: Re-runs guardrails and promise dates automatically on any `submit` and `PATCH`.

### Step 10 — Control tower backend and audit replay (PASS)
- **Part A: Notifications, detectors, alerts, KPIs, SPOF radar (A1, B6, B7, B3, B1, A12)**:
  - `apps/api/src/services/notifications.ts` & `apps/api/src/routes/notifications.ts`:
    - Fan-out on 5 triggers (`DISRUPTION_OPENED`, `PLAN_SUBMITTED`, `APPROVAL_DECIDED`, `GUARDRAIL_ESCALATION`, `RECOVERY_STATUS_CHANGED`).
    - Multi-channel delivery (`IN_APP`, `EMAIL_SIM`, `WHATSAPP_SIM`) with deterministic deduplication keys.
    - Endpoints: `GET /notifications`, `GET /notifications/outbox?channel=`, `PATCH /notifications/:id/read`.
  - `apps/api/src/services/detectors.ts` & `apps/api/src/routes/detectors.ts`:
    - Late-Shipment Detector (B6): flags shipments late by > grace (default 60 min) or past arrival without delivery; opens/refreshes disruption through impact pipeline; idempotent.
    - Stock Alerts Engine (B7): detects `BELOW_THRESHOLD` and `PROJECTED_SHORTAGE` inside horizon window. Automatically marks cleared when stock recovers.
    - `POST /detectors/run`: manual detector sweep.
  - `apps/api/src/routes/alerts.ts`:
    - `GET /alerts`: alert feed with severity filters.
    - `POST /alerts/:id/ack`: alert acknowledgement.
    - Chart endpoints: `GET /alerts/chart/penalty-exposure`, `GET /alerts/chart/open-disruptions`, `GET /alerts/chart/import-quality`.
  - `apps/api/src/routes/kpis.ts`:
    - `GET /overview/kpis`: 6 cards (shipments in transit, delayed shipments, items below threshold, open orders, at-risk orders, penalty exposure) returning exact counts and list items.
  - `apps/api/src/services/spofRadar.ts` & `apps/api/src/routes/spof.ts`:
    - SPOF Radar (A12): computes `100 * (0.50 * share_orders + 0.30 * share_penalty + 0.20 * alt_factor)`.
    - Upserts `spof_snapshots` with rank and raises SPOF alerts for top-ranked nodes.
    - `GET /risk/spof`: returns ranked SPOF nodes with exposed orders and missing alternative details.
- **Part B: Decision Replay, Event Lineage, Provenance (A5, A8, B17)**:
  - `apps/api/src/services/replay.ts` & `apps/api/src/routes/disruptions.ts`:
    - `GET /disruptions/:id/replay?upTo=`: chronological timeline of audit and event steps. Reconstructs past state (resolved ETA, risk score, plan status) from audit before/after snapshots at step `upTo`.
  - `apps/api/src/services/lineage.ts` & `apps/api/src/routes/lineage.ts`:
    - `GET /orders/:id/lineage?disruption=`: builds causal chain (Supplier delay -> Shipment delay -> Warehouse shortage -> Order deficit) with mandatory evidence IDs and calculation formulas.
  - `apps/api/src/routes/audit.ts`:
    - `GET /audit/verify`: verifies cryptographic hash chains for both `audit_logs` and `execution_ledger`.
    - `POST /admin/demo/tamper`: supports mutating either `audit_logs` or `execution_ledger` for demo tamper detection.

### Step 11 - Playbook, scorecards, delegation, master data, notices (PASS)
- **Part A: Playbook memory, fingerprints, scorecards, cover & drift (A6, A10, B8, B13)**:
  - `apps/api/src/services/playbook.ts`:
    - Computes similarity: 0.35 disruption type + 0.25 supplier/warehouse + 0.20 SKU overlap + 0.20 shortage ratio proximity.
    - `GET /disruptions/:id/playbook`: returns top-3 closest cases with similarity score and insight text (`method: "rule-based"`).
    - `POST /disruptions/:id/close`: closes disruption, computes freight cost/late orders from execution ledger, writes live historical case & fingerprint, audited.
  - `apps/api/src/services/fingerprints.ts` & `apps/api/src/routes/fingerprints.ts`:
    - Fingerprint code: SHA-256 hash of (type, severity, skus, warehouses). Active at 3+ matching cases.
    - `GET /fingerprints`: lists fingerprints with occurrence and historical match counts (`method: "rule-based"`).
    - `GET /disruptions/:id/fingerprints`: returns matching fingerprints and MATCH label when active.
  - `apps/api/src/services/scorecards.ts` & `apps/api/src/routes/scorecards.ts`:
    - Computes on-time delivery rate (with 2h grace), average delay hours, and open disruptions.
    - Hidden (null rate + reason) when fewer than 3 closed shipments.
    - `GET /suppliers/scorecards`: returns ranked scorecards (`method: "rule-based"`).
  - `apps/api/src/services/coverDrift.ts`, `apps/api/src/routes/projections.ts` & `apps/api/src/routes/shipments.ts`:
    - `GET /projections/cover`: days of cover = free stock / (units due in next 7d / 7) with formula string (`method: "rule-based"`).
    - `GET /shipments/:id/eta-drift`: projection hint after 3+ applied revisions that all moved later, average shift per revision.
- **Part B: Approval delegation, master data, customer notices (B9, B10, B18)**:
  - `apps/api/src/services/delegations.ts` & `apps/api/src/routes/approvals.ts`:
    - `POST /approvals/delegations`: time-boxed same-role delegation, checks delegate is not creator/modifier/admin. Delegator loses approval rights while active.
    - `GET /approvals/delegations`: lists caller's active delegations.
    - `DELETE /approvals/delegations/:id`: revokes delegation, audited.
    - `POST /plans/:id/request-changes`: Manager/Procurement requests changes with comment, voids earlier approvals, increments plan version.
    - `POST /plans/:id/approve`: supports delegate approval, records `delegated_from` and contract delegations in force.
    - `GET /approvals/queue`: populates real `delegation_chip` and includes delegated approval duties.
  - `apps/api/src/routes/masterdata.ts`:
    - Master Data CRUD: `GET/POST/PATCH/DELETE /admin/master/:entity` with Zod validation. Deactivates rather than hard deletes. Rejects direct `on_hand` editing (400).
    - Governed Inventory Corrections: `POST /inventory/corrections` (Manager, Admin). Checks stock reserved by open plans (409), writes ledger correction, re-verifies open plans, and publishes `INVENTORY_CORRECTED`.
  - `apps/api/src/routes/notices.ts`:
    - `POST /plans/:id/customer-notices`: drafts notices from templates `ON_TIME_RECOVERY` and `SPLIT_ORDER`.
    - `GET /customer-notices`: lists customer notices.
    - `POST /customer-notices/:id/release`: Manager only, requires approved/executed plan, verifies `NOTICE_DATE_MATCHES` claim, releases to simulated outbox.
    - No public or customer-facing route exposed.

### Step 12 - Ask the Desk, What-If, stress test, red-team (PASS - BACKEND COMPLETE)
- **Part A: Ask the Desk (B4) and What-If Simulator (B14)**:
  - `apps/api/src/services/askDesk.ts` & `apps/api/src/routes/askDesk.ts`:
    - `POST /ask`: Read-only conversational operations assistant; warehouse-scoped for Warehouse_Operator.
    - Fixed parameterised query intent matcher for: affected orders, today's disruptions, items below threshold, supplier delays, pending approvals.
    - Extracts numbers and codes into verified `ANSWER_FACT` claims.
    - Write intent detection (`approve`, `cancel`, `delete`, `change stock`, etc.): refused with operational notice and audited in `audit_logs` (`UNAUTHORIZED_WRITE_INTENT_REFUSED`), leaving DB state untouched.
    - `GET /ask/chips`: returns suggested query chips.
  - `apps/api/src/services/whatif.ts` & `apps/api/src/routes/whatif.ts`:
    - `POST /whatif/run`: In-memory sandbox simulation with overrides (`delay_hours`, `damaged_units`, `lane_lead_hours`, `supplier_capacity`, `stock_correction`). Runs impact walk, risk formula, solver, and guardrails without modifying live inventory, plans, or ledger.
    - Results marked `SIMULATION` (plan_id: null); persisted only to `simulation_runs`.
    - `POST /plans/:id/submit` with a simulation run ID is rejected with 409 (`CANNOT_SUBMIT_SIMULATION`).
    - `GET /whatif/:id/event-card`: returns pre-filled draft event card for `POST /events` without creating anything.
- **Part B: Stress-Test mode (A11) and Red-Team suite (S3)**:
  - `apps/api/src/services/stressTest.ts` & `apps/api/src/routes/adminOps.ts`:
    - `POST /admin/stress/run` (Admin, DEMO_MODE): Synthetic chaos injectors (`duplicate_webhooks`, `invalid_csv_rows`, `conflicting_etas`, `simultaneous_supplier_failures`, `sudden_inventory_corrections`).
    - Reports counts (`applied`, `ignored`, `stale`, `quarantined`, `held`, `rejected`, `unhandled_errors: 0`) and validates state integrity (`reserved <= on_hand`, hash chain valid, 0 duplicate alerts).
    - `POST /admin/stress/cleanup`: targeted cleanup of stress run records.
  - `apps/api/src/services/redTeam.ts` & `apps/api/src/routes/adminOps.ts`:
    - `POST /admin/red-team/run` (Admin): Executes 15 real bypass attempts against governed API paths (Analyst self-approval, Admin approval, Operator cross-warehouse access, forged JWT, unsigned webhook, replayed webhook, tampered contract hash, approving blocked plan, executing without approval, executing as creator, direct on_hand edit, submitting simulation, rolling back non-executed plan, releasing notice before approval, write intent in Ask the Desk).
    - 15 of 15 verified BLOCKED with audit log record IDs.
  - CLI scripts added to root `package.json`:
    - `npm run stress`: invokes `scripts/run-stress.ts`.
    - `npm run redteam`: invokes `scripts/run-redteam.ts`.

### Step 13 - Frontend shell, design system and screens 1 to 4 (PASS)
- **Part A: Shell & Impeccable Design System**:
  - `docs/DESIGN.md`: Impeccable design brief defining calm control tower visual language, INR formatting (`₹`, `en-IN`), Asia/Kolkata timestamps, text + colour status representation, and 8 blueprint screens.
  - `apps/web/src/ui/components.tsx`: Precision UI component system (`Button`, `Input`, `Select`, `StatusChip`, `RiskBandChip`, `MoneyText`, `TimeText`, `KpiCard`, `ProofChip`, `EmptyState`, `ErrorState`, `Skeleton`, `Dialog`, `Drawer`).
  - `apps/web/src/ui/Layout.tsx`: Authoritative application shell featuring live SimClock (Asia/Kolkata IST), user role badge, demo quick-switcher dropdown, communications outbox drawer, Ask the Desk drawer, and the exact 8 blueprint screens.
  - `apps/web/src/api/client.ts`: Typed API client with JWT storage, live user profile hydration, global 401/403/409 error parsing, and demo role switching.
  - Screens 5 to 8 page shells established (`ImpactScreen`, `RecoveryScreen`, `ApprovalsScreen`, `AuditScreen`) with live empty states and zero fake data.
- **Part B: Screens 1 to 4 on Live Data**:
  - `Screen 1 (Sign-in)`: `apps/web/src/screens/SignInScreen.tsx` — Real credentials login plus demo quick-switch tiles for all 5 seeded roles.
  - `Screen 2 (Operations Cockpit)`: `apps/web/src/screens/CockpitScreen.tsx` — B1 KPI strip (6 interactive cards), overall recovery progress bar, active disruptions table, A12 SPOF radar tile, A10 fingerprint match banner, B3 alert feed with acknowledgement, and 3 Recharts telemetry charts.
  - `Screen 3 (Intake and Quarantine)`: `apps/web/src/screens/IntakeScreen.tsx` — CSV/JSON entity uploader, B11 quality report, row-level quarantine triage table with suggested fixes, carrier webhook storm simulator, and B15 text ingestion paste box.
  - `Screen 4 (Disruption Investigation)`: `apps/web/src/screens/InvestigationScreen.tsx` — Belief-ETA reconciler card, event timeline with status chips (`APPLIED`, `DUPLICATE`, `STALE`, `CONFLICT`, `REJECTED`), conflict resolution buttons, B8 supplier scorecard, A5 decision replay scrubber with reconstructed past state, and bilingual voice field report confirmation (English & தமிழ்).

---

## NEXT STEP

**Step 14 — Screens 5 and 6, header drawers, network map, add-on panels (Impeccable)**
- Target Model: SONNET 4.6
- Deliverables:
  - Part A: Screens 5 and 6 (Impact and risk with factor waterfall and lineage drawer; Recovery workbench with baseline vs plan, Decision Contract, and solver tradeoffs).
  - Part B: Network map (B2) and header drawer integration.

---

## KNOWN ISSUES

_(must be empty for any step to be marked PASS)_

None.

---

## COMMANDS

| Command | What it does |
|---------|-------------|
| `git log --oneline -15` | View recent commits |
| `npm run test` | Run all tests (97 Vitest + 1 Pytest) |
| `npm run scan:placeholders` | Scan for forbidden placeholder strings |
| `npm run db:start` | Start local MongoDB replica set |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Reset to clean demo state |
| `npm run dev` | Start api + web + solver together |
| `npm run acceptance` | Run all 41 acceptance tests (configured in Step 16) |
| `npm run redteam` | Run red-team security suite (configured in Step 12) |
| `npm run stress` | Run stress injector suite (configured in Step 12) |
| `npm run demo:reset` | Full demo reset to scenario-ready state (configured in Step 17) |
| `npm run demo:warm` | Warm LLM cache for demo (configured in Step 17) |
| `npm run metrics` | Print governance/penalty metrics (configured in Step 17) |

---

## ENV VARS

Full list in `.env.example`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGODB_URI` | Yes | Default: `mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0` |
| `MONGODB_URI_READONLY` | Yes | For what-if simulator read-only connection |
| `MONGODB_URI_ADMIN` | Yes | For demo tamper action only |
| `JWT_SECRET` | Yes | Min 32 chars |
| `WEBHOOK_SECRET` | Yes | For HMAC carrier webhook auth |
| `SOLVER_URL` | Yes | Default: `http://localhost:8000` |
| `GROQ_API_KEY` | No | LLM optional — app works fully without it |
| `SIM_NOW` | No | Override simulation clock (ISO 8601 UTC) |
| `DEMO_MODE` | No | `true` enables demo role switcher and admin tamper |
| `DEMO_PASSWORD` | Yes | bcrypt-hashed password for seeded demo users |
