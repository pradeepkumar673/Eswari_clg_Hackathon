# DisruptionIQ Verified Recovery Desk — Project State

_Last updated: 2026-10-30 by Step 2 (Data Model & Security Roles)_

---

## Step Status Table

| Step | Title | Status |
|------|-------|--------|
| 0 | Brain | **STEP 0: PASS** |
| 1 | Scaffold and Mongo replica set | **STEP 1: PASS** |
| 2 | Data model and security roles | **STEP 2: PASS** |
| 3 | Seed data | NOT STARTED |
| 4 | Auth, RBAC, audit hash chain | NOT STARTED |
| 5 | Frontend shell and design system | NOT STARTED |
| 6 | Import pipeline | NOT STARTED |
| 7 | Reconciler and webhook | NOT STARTED |
| 8 | Events, voice, text ingestion backend | NOT STARTED |
| 9 | Impact, risk, bands | NOT STARTED |
| 10 | Solver service | NOT STARTED |
| 11 | Plan generation, routes, trade-offs | NOT STARTED |
| 12 | Proof checker and Decision Contract | NOT STARTED |
| 13 | Approvals and separation of duties | NOT STARTED |
| 14 | Reservations, court, ledger, rollback | NOT STARTED |
| 15 | Guardrails and promise dates | NOT STARTED |
| 16 | Notifications, detectors, alerts, KPIs | NOT STARTED |
| 17 | Audit viewer, replay, lineage, provenance | NOT STARTED |
| 18 | Intelligence panels backend | NOT STARTED |
| 19 | Ask the Desk and What-If | NOT STARTED |
| 20 | Delegation, master data, corrections, notices | NOT STARTED |
| 21 | Stress-test and red-team | NOT STARTED |
| 22 | UI screens 1 to 4 | NOT STARTED |
| 23 | UI screens 5 and 6 | NOT STARTED |
| 24 | UI screens 7 and 8 | NOT STARTED |
| 25 | Add-on and micro UI panels | NOT STARTED |
| 26 | Voice and operator phone view | NOT STARTED |
| 27 | Full acceptance suite | NOT STARTED |
| 28 | Hardening and review | NOT STARTED |
| 29 | Demo readiness | NOT STARTED |
| 30 | Final audit | NOT STARTED |

---

## COMPLETED STEPS

### Step 0 — Brain (PASS)
- Architecture blueprint, PRD, and operational invariants established.

### Step 1 — Scaffold and Mongo replica set (PASS)
- Monorepo configured with Turborepo, Vite React TS frontend, Express TS backend, FastAPI solver, shared packages, Vitest + Pytest.

### Step 2 — Data model, indexes, validators, security roles (PASS)
- **Mongoose Models**: 45+ models across `apps/api/src/models/` (users, suppliers, warehouses, skus, supplier-skus, transfer-lanes, shipments, shipment-lines, inventory-balances, orders, order-lines, source-trust, shipment-events, field-reports, import-batches, import-rows, disruptions, order-risk-snapshots, llm-cache, recovery-plans, plan-actions, plan-claims, stock-reservations, approvals, execution-ledger, audit-logs, notifications, route-options, plan-tradeoffs, allocation-conflicts, allocation-claims, order-promise-dates, lineage-edges, historical-cases, fingerprints, disruption-fingerprints, guardrail-policies, guardrail-checks, spof-snapshots, stress-runs, alerts, stock-thresholds, risk-policies, supplier-scorecards, approval-delegations, simulation-runs, customer-notices, settings).
- **Zod Schemas**: Full schemas exported from `packages/shared/src/schemas/` (`core.ts`, `events.ts`, `recovery.ts`) and re-exported from `packages/shared/src/index.ts`.
- **Database Constraints & Validators**:
  - `inventory_balances`: strict collection validator `$expr: { $and: [ { $gte: ['$reserved', 0] }, { $gte: ['$on_hand', 0] }, { $lte: ['$reserved', '$on_hand'] } ] }`.
  - `shipment_events`: unique compound index `{ source: 1, external_event_id: 1 }` with partial filter `{ external_event_id: { $type: 'string' } }`.
  - `alerts`: partial unique index `{ alert_key: 1 }` with filter `{ status: 'OPEN' }`.
  - `import_batches`: unique index `{ batch_number: 1 }`.
  - Hash-chain fields (`prev_hash`, `row_hash`, `seq`) on `audit_logs` and `execution_ledger`.
- **Transactions & Concurrency**:
  - `apps/api/src/db/withTransaction.ts`: transaction helper with automatic retry on `TransientTransactionError` and `UnknownTransactionCommitResult`.
  - Sorted `(warehouse_id, sku_id)` lock order documented to avoid distributed deadlocks during multi-warehouse reservations.
- **Security Roles Script**:
  - `scripts/db-security.mjs`: creates `rw_except_appendonly` (full CRUD minus update/remove on append-only collections `audit_logs`, `execution_ledger`, `shipment_events`), `readonly_plus_sim` (read-only plus insert on `simulation_runs`), and users `app_rw`, `app_readonly`, `demo_admin`.
- **Tests**:
  - 19 automated tests in `apps/api/test/step2-data-model.test.ts` covering: duplicate event rejection, collection validator enforcement, security role configurations, alert partial unique indexes, and transaction rollback atomicity. All 19 passing.
  - Monorepo full test suite (22 vitest tests + 1 pytest test) passing cleanly.

---

## NEXT STEP

**Step 3 — Seed data (all scenarios, add-ons, micro-features)**
- Target Model: Sonnet 4.6
- Deliverable: Comprehensive seed script (`scripts/seed.ts` or `scripts/db-seed.mjs`) populating realistic Indian supply chain topology (Chennai, Hosur, Sriperumbudur, Bengaluru), orders, SKUs, inventory balances, disruption scenarios, and demo users with bcrypt passwords.

---

## KNOWN ISSUES

_(must be empty for any step to be marked PASS)_

None.

---

## COMMANDS

| Command | What it does |
|---------|-------------|
| `git log --oneline -15` | View recent commits |
| `npm run test` | Run all tests |
| `npm run scan:placeholders` | Scan for forbidden placeholder strings |
| `npm run db:start` | Start local MongoDB replica set |
| `npm run db:seed` | Seed demo data (configured in Step 3) |
| `npm run db:reset` | Reset to clean demo state (configured in Step 3) |
| `npm run dev` | Start api + web + solver together |
| `npm run acceptance` | Run all 41 acceptance tests (configured in Step 27) |
| `npm run redteam` | Run red-team security suite (configured in Step 21) |
| `npm run stress` | Run stress injector suite (configured in Step 21) |
| `npm run demo:reset` | Full demo reset to scenario-ready state (configured in Step 29) |
| `npm run demo:warm` | Warm LLM cache for demo (configured in Step 29) |
| `npm run metrics` | Print governance/penalty metrics (configured in Step 29) |

---

## ENV VARS

Full list in `.env.example`. Key variables:

| Variable | Required | Notes |
|----------|----------|-------|
| `MONGODB_URI` | Yes | Default: `mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0` |
| `MONGODB_URI_READONLY` | Yes (Step 2) | For what-if simulator read-only connection |
| `MONGODB_URI_ADMIN` | Yes (Step 2) | For demo tamper action only |
| `JWT_SECRET` | Yes | Min 32 chars |
| `WEBHOOK_SECRET` | Yes | For HMAC carrier webhook auth |
| `SOLVER_URL` | Yes | Default: `http://localhost:8000` |
| `GROQ_API_KEY` | No | LLM optional — app works fully without it |
| `SIM_NOW` | No | Override simulation clock (ISO 8601 UTC) |
| `DEMO_MODE` | No | `true` enables demo role switcher and admin tamper |
| `DEMO_PASSWORD` | Yes (Step 3) | bcrypt-hashed password for seeded demo users |
