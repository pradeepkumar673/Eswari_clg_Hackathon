# DisruptionIQ Verified Recovery Desk — Project State

_Last updated: 2026-10-30 by Step 3 (Seed Data & Demo State)_

---

## Step Status Table

| Step | Title | Status |
|------|-------|--------|
| 0 | Brain | **STEP 0: PASS** |
| 1 | Scaffold and Mongo replica set | **STEP 1: PASS** |
| 2 | Data model and security roles | **STEP 2: PASS** |
| 3 | Seed data | **STEP 3: PASS** |
| 4 | Auth, RBAC, audit hash chain | **STEP 4: PASS** |
| 5 | Import pipeline and Belief-ETA reconciler | NOT STARTED |
| 6 | Voice and text ingestion, impact engine and risk bands | NOT STARTED |
| 7 | Solver service and recovery plan generation | NOT STARTED |
| 8 | Proof checker, Decision Contract and governed approvals | NOT STARTED |
| 9 | Reservations, conflict court, ledger, rollback, guardrails and promise dates | NOT STARTED |
| 10 | Notifications, detectors, alerts, KPIs, SPOF radar, replay, lineage and provenance | NOT STARTED |
| 11 | Playbook, fingerprints, scorecards, cover and drift, delegation, master data and customer notices | NOT STARTED |
| 12 | Ask the Desk, What-If, stress test and red-team (backend complete) | NOT STARTED |
| 13 | Frontend shell, design system and screens 1 to 4 | NOT STARTED |
| 14 | Screens 5 and 6, notification drawer, Ask drawer, network map and add-on panels | NOT STARTED |
| 15 | Screens 7 and 8, voice in the browser and operator phone view | NOT STARTED |
| 16 | Full acceptance suite | NOT STARTED |
| 17 | Hardening, full-repo review and demo readiness | NOT STARTED |
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

---

## NEXT STEP

**Step 5 — Import pipeline and Belief-ETA reconciler**
- Target Model: OPUS 4.6
- Deliverables:
  - Part A: Import pipeline (M1, B11) with multipart upload, Zod validation, edit-distance suggestions, quarantine handling, natural key deduplication and conflict detection.
  - Part B: Belief-ETA reconciler and carrier webhook (M2) with multi-source trust tiers, trust-based ETA overrides, and shipment event logging.

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
