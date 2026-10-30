# DisruptionIQ Verified Recovery Desk: Antigravity Prompt Pack

Build with: Antigravity free tier (Gemini 3.8 Flash, Claude Sonnet 4.6, Claude Opus 4.6) + Impeccable, Ponytail, GSD Mission Control, CodeRabbit.
Stack: React + Vite + TypeScript + Tailwind, Node + Express + TypeScript, **local MongoDB (single-node replica set)**, Python FastAPI + OR-Tools solver.

---

## 0. How to use this file

1. Put your blueprint file in the repo as `docs/BLUEPRINT.md` (Step 0 tells the agent to do it; you copy the file in by hand first).
2. Run the steps **in order**. Paste the text inside each `PROMPT` block into Antigravity, with the model shown next to the step.
3. Do not start step N+1 until step N says `STEP N: PASS` in `docs/STATE.md`. Every step ends with tests, so a step that fails shows up immediately.
4. **Account switching (your 8 accounts):** the agent's memory does not survive an account switch, but the files do. Every step reads `docs/STATE.md` and ends by updating it. After switching accounts, paste the RESUME prompt below.
5. **Model fallback:** if Opus 4.6 runs out on an Opus step, use Sonnet 4.6 and add this line to the prompt: "Work in smaller sub-steps, write the tests first, and do not move on until they pass." If Sonnet runs out, Flash can do the "Flash-OK" steps only. Never run a step marked Opus on Flash.

### Model legend

| Tag | Use for |
|---|---|
| **OPUS 4.6** | Hard correctness: reconciler, solver, proof checker, reservations, concurrency, governance, security tests, final audit |
| **SONNET 4.6** | Most backend and frontend feature work |
| **GEMINI 3.8 FLASH** | Scaffolding, boilerplate, simple CRUD, docs, wiring, small UI panels |

### Contradictions resolved (your instruction: this message wins over the .md)

| Blueprint says | This pack does |
|---|---|
| PostgreSQL + Prisma, raw SQL | **MongoDB (Mongoose + native driver), replica set for transactions** |
| SQL CHECK/UNIQUE/atomic UPDATE | Unique indexes, `$jsonSchema`/`$expr` validators, conditional `updateOne` inside a transaction |
| "No UPDATE/DELETE grants" | Separate Mongo users and roles (insert-only role for audit and ledger) |
| Docker Compose primary | `npm run dev` starts everything locally; Docker is optional |
| Free tools | Same, plus your four extensions |

Everything else (scope, tiers, roles, rules, numbers, acceptance tests 1 to 41, demo script) follows the blueprint exactly.

### Honest note about the extensions

I do not know the exact command names in your installed versions of Impeccable, Ponytail, GSD Mission Control and CodeRabbit. Step 0 makes the agent **discover** what each one actually offers and record it in `docs/EXTENSIONS.md`. Every later step then says "use the extension routine" and the agent follows that file. If an extension has no matching command, the agent says so and does the equivalent manually. It never pretends to have run something.

### RESUME prompt (paste after every account switch or new chat)

**Model: same model the interrupted step used**

```text
You are resuming work on DisruptionIQ Verified Recovery Desk. You have no memory of earlier chats, so rebuild context from files:
1. Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md.
2. Run `git status` and `git log --oneline -15`.
3. Run `npm run test` (or the step's test command listed in STATE.md) to see what actually passes.
4. Tell me in 5 lines: the last step marked PASS, the step in progress, what is half-done, and what fails now.
5. Then continue the in-progress step from the exact point it stopped. Do not redo finished work and do not rewrite working files. Follow the Step Close Routine in docs/RULES.md when done.
```

---

## STEP 0: Project brain, rules and extension discovery
**Model: SONNET 4.6**

Creates the rule files every later step reads. Before this step, copy your blueprint into `docs/BLUEPRINT.md` yourself.

```text
ROLE: You are the lead engineer on DisruptionIQ Verified Recovery Desk, a 48-hour-style hackathon MVP that must be FULLY WORKING with real data when finished.

TASK: Create the project brain. Do not write app code yet.

1. Create a new git repo in the workspace root. Confirm docs/BLUEPRINT.md exists (it is the user's final blueprint). If it does not exist, stop and tell me to add it.
2. Create docs/RULES.md containing EXACTLY these standing rules (write them fully, they will be re-read every step):
   - SOURCE OF TRUTH: docs/BLUEPRINT.md. Exceptions the user decided: database is LOCAL MONGODB (not PostgreSQL/Prisma), frontend is React+Vite+TypeScript+Tailwind, backend is Node+Express+TypeScript, solver is Python FastAPI + OR-Tools CP-SAT. Docker is optional.
   - NO PLACEHOLDERS, EVER: no lorem ipsum, no hardcoded demo numbers in UI code, no mock arrays, no "TODO", no "coming soon", no fake API responses, no commented-out stubs, no empty handlers. Every number on screen comes from the database or a deterministic computation over it. Seed data is the ONLY place concrete demo values live, and it lives in the seed script.
   - Every feature ships with: backend logic, API route with backend RBAC, UI wiring (when the UI step arrives), and an automated test.
   - Deterministic code decides stock, deadlines, permissions, risk, reservations, execution. The LLM (Groq, optional) only does voice/text extraction, plan narration and playbook phrasing, always cached by input hash and always with a deterministic fallback. The app must work 100% with GROQ_API_KEY unset.
   - Simulation clock: all "now" values come from a SimClock service (env SIM_NOW or DB setting), never new Date() in business logic, so demos are repeatable.
   - Money is INR, integer rupees. Times are stored in UTC, shown in Asia/Kolkata.
   - Append-only rules: shipment_events, audit_logs, execution_ledger are insert-only (also enforced by Mongo roles, see Step 2).
   - Never weaken M1-M6, S1, S2. Add-ons (A) and micro-features (B) never write stock directly.
   - Never commit secrets. Use .env (gitignored) and .env.example with real variable names and safe example values.
   - STEP CLOSE ROUTINE (mandatory at end of every step):
       a. Run the step's tests plus the full test suite so far; fix failures.
       b. Run `npm run scan:placeholders` (created in Step 1); fix every hit.
       c. Run the CodeRabbit review routine from docs/EXTENSIONS.md on the diff; fix every actionable finding; list what you intentionally ignored and why.
       d. Update GSD Mission Control (mark this step's tasks done, create next step's tasks) per docs/EXTENSIONS.md.
       e. Update docs/STATE.md: set "STEP N: PASS", list files created, commands to run, known issues (must be empty to PASS), and the next step's number.
       f. git commit with message "step N: <title>".
   - If a step cannot be completed in one session, write exactly where you stopped in docs/STATE.md under "IN PROGRESS" so a different model/account can resume.
   - Prefer small files and clear module boundaries: apps/api, apps/web, services/solver, packages/shared, scripts, docs.
3. Create docs/STATE.md with a table of all steps 0 to 30 (titles I give below) all marked NOT STARTED except step 0 IN PROGRESS, plus sections: IN PROGRESS, KNOWN ISSUES, COMMANDS, ENV VARS.
   Step titles: 0 Brain; 1 Scaffold and Mongo replica set; 2 Data model and security roles; 3 Seed data; 4 Auth, RBAC, audit hash chain; 5 Frontend shell and design system; 6 Import pipeline; 7 Reconciler and webhook; 8 Events, voice, text ingestion backend; 9 Impact, risk, bands; 10 Solver service; 11 Plan generation, routes, trade-offs; 12 Proof checker and Decision Contract; 13 Approvals and separation of duties; 14 Reservations, court, ledger, rollback; 15 Guardrails and promise dates; 16 Notifications, detectors, alerts, KPIs; 17 Audit viewer, replay, lineage, provenance; 18 Intelligence panels backend; 19 Ask the Desk and What-If; 20 Delegation, master data, corrections, notices; 21 Stress-test and red-team; 22 UI screens 1 to 4; 23 UI screens 5 and 6; 24 UI screens 7 and 8; 25 Add-on and micro UI panels; 26 Voice and operator phone view; 27 Full acceptance suite; 28 Hardening and review; 29 Demo readiness; 30 Final audit.
4. EXTENSION DISCOVERY. For each of Impeccable, Ponytail, GSD Mission Control and CodeRabbit:
   - Inspect what is actually installed in this Antigravity workspace (skills, slash commands, MCP tools, CLI binaries, config files, extension docs). Read their own docs/help output.
   - Write docs/EXTENSIONS.md with, per extension: what it is in 1 line, the exact commands/skills/tools available, and "Our routine" = exactly when and how we use it in this project:
       * Impeccable: for every frontend step: (1) run its design-brief/context setup once in Step 5 and save the result, (2) use its craft/build-style command for new screens, (3) before closing a UI step run its audit/critique/polish commands and fix findings.
       * GSD Mission Control: one mission per step, with tasks mirroring the step's checklist; update status at step close; use it to track blockers.
       * CodeRabbit: run on the uncommitted diff (CLI or extension) at every Step Close; fix actionable items.
       * Ponytail: determine its purpose from its docs, then define the most useful routine for this project (if it is a workflow/utility helper, use it for the repetitive parts of each step; if its purpose does not fit, say so in the file and skip it).
   - If any extension is missing or a command does not exist, write "NOT AVAILABLE: <reason>, fallback = <manual equivalent>" instead of guessing.
5. Commit: "step 0: project brain".

OUTPUT: show me docs/EXTENSIONS.md and the STATE.md table. Ask me nothing; make reasonable choices.
```

---

## STEP 1: Scaffold, local MongoDB replica set, dev scripts
**Model: GEMINI 3.8 FLASH**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 1, 10 and 11 first.

TASK: Scaffold the monorepo so one command starts everything.

1. Layout: apps/api (Express+TS), apps/web (React+Vite+TS+Tailwind), services/solver (FastAPI), packages/shared (Zod schemas + TS types shared by api and web), scripts, docs.
2. Root package.json with npm workspaces and scripts:
   - dev: starts api, web and solver together (use concurrently; solver via python -m uvicorn inside its venv)
   - build, test (vitest for api and shared, pytest for solver), lint, typecheck
   - db:start (starts local mongod as a SINGLE-NODE REPLICA SET named rs0 on port 27017 with a data dir in ./.data/mongo, and runs rs.initiate if needed), db:seed, db:reset
   - scan:placeholders (a Node script scripts/scan-placeholders.mjs that fails if it finds: lorem, TODO, FIXME, "placeholder", "mock", "dummy", "coming soon", "not implemented", "fake", or hardcoded INR amounts like ₹ followed by digits inside apps/web/src (seed files and tests are allowed). Print file:line for each hit.)
3. Mongo: explain in docs/COMMANDS.md how to install/start local MongoDB on Windows/macOS/Linux, why a replica set is required (multi-document transactions for reservations), and write the db:start script robustly (idempotent, checks if already running). Connection string comes from MONGODB_URI (default mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0).
4. apps/api: Express app with a /api/v1/health route that reports mongo connection AND whether transactions are available (run a tiny test transaction), config module reading .env with Zod validation (MONGODB_URI, JWT_SECRET, WEBHOOK_SECRET, SOLVER_URL, GROQ_API_KEY optional, SIM_NOW optional, DEMO_MODE), pino logging, error-handling middleware that returns {error:{code,message,details}}.
5. apps/web: Vite React TS, Tailwind configured, TanStack Query, React Router, a placeholder-free home route that calls /health and shows the real result. Install shadcn/ui basics, Recharts, React Flow (only install now).
6. services/solver: FastAPI app with GET /health and a requirements.txt including ortools. Create the venv instructions in COMMANDS.md.
7. .env.example with every variable, .gitignore, README with the exact run sequence, ESLint+Prettier shared config, vitest configured with a separate test database name disruptioniq_test.
8. Add one real test per workspace (health endpoints) so the test pipeline is proven.

Verify by actually running: db:start, dev, then curl the three health endpoints and paste the outputs. Follow the Step Close Routine.
```

---

## STEP 2: Data model, indexes, validators, security roles
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 11, 12 and 13.

TASK: Implement the COMPLETE data model in MongoDB. Translate every table in blueprint section 11 (core, events, recovery, add-on A tables, micro-feature B tables, and every "Changes to existing tables" line) into Mongoose models in apps/api/src/models, with matching Zod schemas in packages/shared.

Rules for the translation:
- One collection per table, snake_case collection names kept as in the blueprint. Use ObjectId references. Keep human codes (SHP-204, ORD-1042, SKU-101, WH-HOS, SUP-1) as unique indexed fields.
- Enforce the blueprint's constraints in the database, not only in code:
  * unique (source, external_event_id) on shipment_events (idempotency)
  * unique (warehouse_id, sku_id) on inventory_balances, with a collection $jsonSchema/$expr validator guaranteeing reserved >= 0 and reserved <= on_hand
  * unique open alert per alert_key (partial unique index where status = OPEN)
  * unique import_batches.file_hash for committed batches
  * unique natural keys where the blueprint demands them
  * partial unique index so one approval row exists per (plan_id, plan_version, required_role)
- Concurrency helpers in apps/api/src/db: withTransaction(fn) helper using client sessions with retry on TransientTransactionError, and a documented rule to always lock/update inventory rows in (warehouse_id, sku_id) sorted order.
- Security roles (scripts/db-security.mjs, run by db:start): create three Mongo users with different privileges:
  * app_rw: read/write on all collections EXCEPT only insert+find on audit_logs, execution_ledger and shipment_events
  * app_readonly: find only (used by what-if in Step 19) plus insert on simulation_runs only
  * demo_admin: dbOwner (used ONLY by the Admin Tamper action and the reset script)
  The api uses app_rw by default; add MONGODB_URI_READONLY and MONGODB_URI_ADMIN to the env schema.
- Add a hash-chain-ready field set (prev_hash, row_hash) to audit_logs and execution_ledger now, and a sequence field `seq` (monotonic) so chain order is unambiguous.
- Export a `ensureIndexes()` that runs at api start and in tests.

TESTS (vitest, real MongoDB, test db): 
1. duplicate (source, external_event_id) insert is rejected by the DB
2. inventory insert/update violating reserved <= on_hand is rejected by the validator
3. app_rw cannot update or delete an audit_logs document (permission error), app_readonly cannot insert into inventory_balances
4. second OPEN alert with same alert_key is rejected; CLEARED then new OPEN works
5. a transaction that fails midway leaves no partial writes (write a real two-collection transaction test)

Follow the Step Close Routine. In STATE.md list every collection with its indexes.
```

---

## STEP 3: Seed data (all scenarios, add-ons, micro-features)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md section 8 (all of it: Scenario A, Scenario B, add-on seed data, micro-feature seed data).

TASK: Write scripts/seed.ts (db:seed) and the demo reset service (apps/api/src/services/demoReset.ts) that re-creates the full demo state deterministically. The seed is the ONLY place concrete demo values live.

Seed everything in the blueprint exactly:
- 3 warehouses (WH-HOS Hosur, WH-CHN Chennai, WH-BLR Bengaluru) with map_x/map_y 0..1000 and processing_hours 2
- 4 suppliers (SUP-1..SUP-4) with risk_score (SUP-2 = 35) and map coordinates; 10 SKUs including SKU-101 and SKU-205
- supplier_skus (SUP-2 qualified for SKU-101: 40 units, 36 h lead, ₹120/unit; SUP-1 only qualified source of SKU-101 into WH-HOS), transfer_lanes with distance_km (CHN to HOS 5 h, ₹35/unit; BLR to HOS 3 h, ₹50/unit; BLR to CHN 4 h, ₹40/unit and others so lanes are realistic), route_options (direct, one via-warehouse path and one expedited option for SHP-204)
- inventory: WH-HOS SKU-101 on_hand 20; WH-CHN free 15 of SKU-101 and 10 on-hand SKU-205; WH-BLR free 10 SKU-101 and 30 free SKU-205; every other (warehouse, SKU) pair above its minimum threshold
- 18 shipments with promised_eta, SHP-204 (170 units SUP-1 to WH-HOS, ETA tomorrow 10:00) and SHP-310 (60 units SKU-205 to WH-CHN, carrier ETA 16:00 today); at least 3 DELIVERED shipments per supplier with actual_arrival_at; SUP-1 below 70% on time, SUP-2 above 90%
- 20 orders including ORD-1042/1047/1051 (Scenario A quantities, due times, penalties, priorities) and ORD-2001/2002 (Scenario B), the rest realistic open orders that must NOT be affected by either scenario
- 5+2 users: Analyst, Manager, second Manager, Warehouse Operator (WH-HOS), Procurement Approver, second Procurement Approver, Administrator. Known demo password via env DEMO_PASSWORD, bcrypt-hashed.
- source_trust (field report 3, carrier 2, supplier portal 1, CSV 1, EMAIL_TEXT 1; tolerance 240 min), risk_policies (RED >=70, AMBER 40-69, GREEN <40), stock_thresholds (SKU-101@WH-HOS min 30; SKU-205@WH-CHN min 15; horizon 72 h), guardrail_policies (EXPEDITE_SPEND 6000, SERVICE_DAMAGE residual 2500 and 20% backorder, SUPPLIER_RISK 50, TRANSFER_DISTANCE 400 km), customer notice templates ON_TIME_RECOVERY and SPLIT_ORDER (store as a templates collection or config), 12 historical_cases (marked SEEDED, closest to Scenario A as described), fingerprints F1/F2/F3 with their counts.
- The seeded competing plan for Allocation Conflict Court: seeded in the reset, wants WH-BLR's 10 free units of SKU-101.
- Sample messages for text ingestion (3 messages as described) stored as demo fixtures in a fixtures file served ONLY to the "Use sample" buttons.
- Simulation clock: SIM_NOW default fixed so "tomorrow 10:00" etc. are computed relative to it; store the clock in a settings collection with a SimClock service (apps/api/src/services/simClock.ts) and an admin endpoint to set it.

IMPORTANT: Seed must be realistic enough that detectors, radar and scorecards produce their blueprint-specified results from computation, not from hardcoding. Do not insert alerts, disruptions, risk snapshots, plans, promise dates or SPOF snapshots; those must be produced by the engines in later steps.

TESTS: seed twice gives identical state (idempotent via reset); counts match blueprint (3, 4, 10, 18, 20, 7 users); the free-stock arithmetic of Scenario A is exactly 190 needed vs 120 supply when SHP-204 usable is 100; SUP-1 on-time rate < 70% and SUP-2 > 90% computed with a plain script.

Follow the Step Close Routine.
```

---

## STEP 4: Auth, RBAC, audit service with hash chain
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 12 (role permissions, separation of duties) and 11 (audit constraints, B17 hash chain).

TASK: Build authentication, authorization and the audit/provenance core. Everything later depends on this.

1. POST /auth/login (bcrypt + JWT with role claim), GET /auth/me returning role and the full permission list derived from the blueprint role matrix (implement the matrix ONCE as data in packages/shared/src/permissions.ts: capability -> roles, with warehouse scoping flags for Warehouse Operator). Middleware requirePermission('capability'), warehouse-scoping helper (operator may only touch own warehouse; other warehouse returns 403). Permissions are re-read from the user record on every request (a changed role takes effect immediately).
2. Demo role switcher support: POST /auth/demo-switch (only when DEMO_MODE=true) returns a JWT for a seeded user. The backend still enforces everything.
3. Webhook auth: signed shared secret (HMAC of body with WEBHOOK_SECRET, constant-time compare), 401 on bad signature.
4. Audit service apps/api/src/services/audit.ts: writeAudit({actor, action, entityType, entityId, before, after, correlationId, stepType}) inserts into audit_logs with seq, prev_hash and row_hash = SHA-256(prev_hash + canonical JSON of the row), written inside the caller's transaction under an advisory-lock equivalent (use a dedicated chain_state document updated with findOneAndUpdate inside the transaction so chain order is serialized). Same mechanism exported for execution_ledger (writeLedgerEntry).
5. verifyChain(collection) that scans in seq order, recomputes every hash and returns {ok, checked, firstBrokenRowId}. Endpoint GET /audit/verify (Analyst, Manager, Procurement, Admin) and GET /audit with filters (actor, action, entity, correlation_id, date range, pagination).
6. POST /admin/demo/tamper (Admin, DEMO_MODE only): uses MONGODB_URI_ADMIN to directly update one audit row outside the app role; afterwards verifyChain must name that row.
7. Every denied access (401/403) is itself audited (action ACCESS_DENIED) without leaking secrets.
8. The generic rule: no route exists without requirePermission. Add a startup self-check that enumerates all registered routes and fails the boot if any non-public route lacks a permission tag.

TESTS: login for all 7 users; wrong password 401; each capability row of the role matrix tested for at least one allowed and one denied role through real HTTP (supertest); Administrator cannot approve (403 once approvals exist; for now assert the permission matrix); operator on another warehouse 403; webhook bad signature 401; audit chain verifies on a clean DB, tamper breaks it and names the row; two concurrent audit writes keep a gapless seq and valid chain (run 50 concurrent writes).

Follow the Step Close Routine.
```

---

## STEP 5: Frontend shell and design system (Impeccable)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 14 (screens and design notes) and 7b.

TASK: Build the real application shell. This is the first IMPECCABLE step: follow the Impeccable routine in docs/EXTENSIONS.md.

1. Run Impeccable's design-context/brief setup for this product: a calm, high-trust operations "control tower" for supply-chain analysts; dense but readable; desktop-first; status communicated with text AND colour; INR formatting (en-IN, ₹); Asia/Kolkata times; dark and light themes; no generic AI-dashboard look. Save the resulting design brief to docs/DESIGN.md and follow it.
2. Create a design system in apps/web/src/ui: tokens (CSS variables via Tailwind), typography, spacing, Button, Input, Select, Dialog, Drawer, Tabs, Table, Badge/StatusChip, RiskBandChip, MoneyText, TimeText, EmptyState, ErrorState, Skeleton, Toast, ConfirmDialog, KpiCard, ProofChip. Every component handles loading, empty, error and success states.
3. App shell: header with role badge, the demo role switcher (calls /auth/demo-switch, only visible when /auth/me says DEMO_MODE), notification bell (drawer wired in Step 25), Ask the Desk button (drawer wired in Step 25), SimClock display, and a left nav with exactly the eight screens from the blueprint: 1 Sign-in, 2 Operations cockpit, 3 Intake and quarantine, 4 Disruption investigation, 5 Impact and risk, 6 Recovery workbench, 7 Approvals and execution, 8 Audit and security. No other screens.
4. Real auth flow: login page (uses the seeded users via the real API), token storage, protected routes, permission-aware navigation (hide what the role cannot use, but never rely on hiding), a typed API client in apps/web/src/api generated from packages/shared Zod schemas, TanStack Query hooks, global 401/403/409 handling with the toast patterns used in the demo ("Self-approval not allowed" style messages come from the server's message field).
5. Each screen route renders a REAL page shell with its title, its purpose line from blueprint section 14 and a data-driven body: for screens whose backend does not exist yet, render the real EmptyState "Available after step N" component driven by the feature flag list from GET /auth/me capabilities; it must not contain fake data.
6. Run Impeccable's audit/critique/polish commands on the shell and fix findings (contrast, focus states, spacing, responsiveness down to 390 px width for the shell).

TESTS: Vitest + Testing Library: login flow against a mocked network layer ONLY inside tests (not app code); role-based nav; 403 toast. Playwright smoke test optional now.

Follow the Step Close Routine.
```

---

## STEP 6: Import pipeline (M1, B11, A11 groundwork)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M1, B11), 8 (acceptance tests 4 and 34), 11 (import_batches/import_rows), 12, 13 (stages 1 and 3).

TASK: Build CSV/JSON import with row-level quarantine and repair, plus the import quality report.

1. POST /imports (Analyst, Admin): multipart upload of CSV or JSON for these entity types: shipments, orders, inventory, supplier_skus, transfer_lanes. Store the raw file and raw rows untouched. Compute SHA-256 file_hash; if the same file was already COMMITTED respond FILE_ALREADY_IMPORTED (no-op).
2. Row validation with Zod per entity plus foreign-key checks (supplier, warehouse, SKU codes exist). Bad rows go to import_rows as QUARANTINED with machine-readable error reasons and a nearest-valid-code suggestion (edit distance against valid codes). Row states: VALID, REPAIRED, QUARANTINED, DISCARDED, DUPLICATE, CONFLICT.
3. Natural-key handling (B11): two rows with the same natural key and the same values give one APPLIED and one DUPLICATE; same key with different values gives a CONFLICT row for human review and applies neither.
4. GET /imports/:id/quarantine, PATCH /imports/rows/:rowId (repair or discard, revalidates, audited), POST /imports/:id/commit (loads VALID and REPAIRED rows transactionally; quarantined rows are never loaded; commit is idempotent), GET /imports/:id/report (counts of valid/repaired/quarantined/duplicate/conflict, error-reason histogram, total adds up, file hash).
5. Inventory imports must not set on_hand directly on existing balances: an import of inventory creates audited INVENTORY_CORRECTION entries through the ledger service (create apps/api/src/services/inventoryCorrection.ts now; B10 in Step 20 reuses it).
6. After a commit, call a domain event bus (apps/api/src/services/bus.ts, in-process, awaited inside the request) so later steps (detectors, SPOF radar, KPIs) can subscribe; emit IMPORT_COMMITTED.
7. Provide fixtures in apps/api/test/fixtures: a shipments CSV with exactly 10 bad rows among valid ones (unknown shipment code, negative quantity, bad date, missing supplier, wrong type, etc.), a duplicate-key file, a conflict-key file.

TESTS: acceptance tests 4 and 34 literally (10 bad rows: good rows load, bad rows quarantined with reasons; re-upload identical file is a no-op; duplicate and conflict handling; report counts add up to total rows); Analyst and Admin allowed, Manager 403; raw rows unchanged after repair.

Follow the Step Close Routine.
```

---

## STEP 7: Belief-ETA Reconciler and carrier webhook (M2)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M2), 8 (Scenario B, tests 1 to 3), 12, 13 (Reconciler rules, trust order).

TASK: Build the event store and reconciler. This is correctness-critical: write the tests FIRST.

1. POST /webhooks/carrier/:source (HMAC-signed): store the raw body untouched, normalise, then run reconcile(event) inside ONE transaction.
2. reconcile(): implement the blueprint rules table exactly, evaluated in this order:
   a. unknown shipment reference: REJECTED (quarantined with reason)
   b. same (source, external_event_id): DUPLICATE, no state change (rely on the DB unique index and catch the duplicate-key error; never check-then-insert)
   c. event_time older than the event behind the current resolved ETA from an equal or higher trust source: STALE (kept as history, changes nothing)
   d. two trusted sources differ by more than that source pair's tolerance (default 240 min): CONFLICT (hold; shipment status shows UNDER_REVIEW; no ETA change)
   e. sources agree within tolerance: APPLIED using the higher-trust value, record the agreement in reason
   f. newer trusted event: APPLIED, set resolved_eta and eta_basis_event_id, write reason with lineage, then publish bus events ETA_CHANGED and EVENT_APPLIED
   Every decision writes an audit row with correlation_id and step_type (WEBHOOK_RECEIVED, DUPLICATE_IGNORED, STALE_KEPT, CONFLICT_RAISED, ETA_APPLIED, etc.) for the replay in Step 17.
3. Event types: ETA_UPDATE, DAMAGE_REPORT (reduces usable quantity via shipment_lines.damaged_quantity), DELAY_REPORT, INVENTORY_CORRECTION (handled through the Step 6 ledger service).
4. Conflict endpoints: GET /events/conflicts (Analyst, Manager), POST /events/conflicts/:id/resolve (choose authoritative event, requires a reason, audited, applies the chosen ETA, then publishes EVENT_APPLIED). Shipment cannot silently change while a conflict is open.
5. Scenario B generator service (used by "Send duplicate storm" and later by stress tests): sends EVT-2001 for SHP-310 five times, then an older EVT-1999 afterwards, plus the supplier-portal ETA that differs by 9 hours; returns the summary counts {sent, applied, duplicates, stale, conflicts} computed from real results.
6. Concurrency: 5 identical webhooks sent in parallel produce exactly one state change.

TESTS: acceptance tests 1, 2, 3 verbatim; the 5-parallel-webhooks race (run 50 times); conflict resolution applies exactly the chosen event; resolved ETA always has eta_basis_event_id and a reason; RBAC on all endpoints; bad signature 401.

Follow the Step Close Routine.
```

---

## STEP 8: Field reports, voice parse, text ingestion (backend)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (W1, B15), 8 (tests 11, 38), 13 (stage 2, B15), 12.

TASK: Build the confirm-first intake path for voice transcripts and pasted email/SMS text.

1. Provider wrapper apps/api/src/llm/provider.ts: Groq via fetch with JSON-schema output when GROQ_API_KEY is set; every call cached in llm_cache by input hash; throws a typed LLMUnavailable otherwise. The app never fails if the LLM is absent.
2. Rule-based extractor (the REAL fallback, must work alone): parse shipment code (SHP-\d+), warehouse mentions (English and Tanglish: "Hosur", "warehouse-la", Tamil transliterations of Chennai/Bengaluru), damaged quantity (number before box/boxes/units/pieces), delay phrases in Tanglish ("rendu mani neram late" = 2 hours, "oru mani neram" = 1, "moonu" = 3, also digits like "2 hours" and "mani neram" patterns), event type, and a confidence computed from how many fields matched. Include a Tanglish number-word table (onnu, rendu, moonu, naalu, anju, aaru, ezhu, ettu, onbadhu, pathu and larger via digits).
3. POST /voice/parse (Analyst, Operator own warehouse) and POST /ingest/text (Analyst, Operator own warehouse): body {transcript|text, language, channel: VOICE|EMAIL_TEXT|SMS_TEXT}. Store the raw text untouched in field_reports with status DRAFT, run extractor (LLM first if available then Zod + DB reference checks, else rules), return the event card {shipment, warehouse, event type, damaged, delay_hours, confidence} plus Tamil labels for the card fields.
4. Nothing becomes an event until a human confirms: POST /events (Analyst, Operator, Manager) takes a confirmed card (possibly edited), links field_report.event_id, and passes it through the Step 7 reconciler with source FIELD_REPORT (trust 3) or EMAIL_TEXT (trust 1). Operators cannot confirm for another warehouse (403).
5. Messages that disagree with the carrier create a CONFLICT card via the reconciler; unknown shipment (SHP-999) is REJECTED; an exact duplicate message is DUPLICATE.
6. GET /fixtures/sample-transcripts (the 'Use sample transcript' content for SHP-204: "SHP-204 Hosur warehouse-la 70 box damage, lorry rendu mani neram late", plus the 3 B15 sample messages) read from the Step 3 fixtures.

TESTS: acceptance tests 11 and 38; extractor unit tests with at least 20 Tanglish/English variants asserting exact extracted fields; Scenario A transcript yields SHP-204, WH-HOS, 70 damaged, 2 hours, then confirm moves the resolved ETA from 10:00 to 12:00 and usable quantity to 100; works with GROQ_API_KEY unset; Operator for another warehouse 403; raw text stored untouched.

Follow the Step Close Routine.
```

---

## STEP 9: Impact engine, risk waterfall, risk bands (M3, B5)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M3, B5), 8 (tests 5, 28), 13 (stage 5, 6, risk formula, B5), 12.

TASK: Build the deterministic impact engine and explainable risk scoring.

1. Subscribe to EVENT_APPLIED / ETA_CHANGED on the bus. Impact engine walks shipment -> destination warehouse -> inventory -> dependent open orders (orders at that fulfil warehouse for SKUs on the shipment lines) and opens or refreshes ONE disruption per shipment (type LATE_SHIPMENT/SUPPLIER_DELAY/STOCK_SHORTAGE as appropriate, with calendar_tag such as FESTIVAL_PEAK derived from the SimClock and a configurable calendar table, correlation id for replay). Only orders genuinely short or delayed are affected: for Scenario A exactly ORD-1042, ORD-1047, ORD-1051.
2. GET /disruptions, /disruptions/:id, /disruptions/:id/impact, /disruptions/:id/risks.
3. Risk formula from the blueprint exactly: Risk = 100 x (0.35 U + 0.30 S + 0.20 D + 0.15 P) with the stated definitions of U, S, D, P; compute best-case and worst-case ETA scores to give a score range; store factor values AND the source-row evidence ids (inventory row, order row, shipment row, event rows) in order_risk_snapshots. Recompute on every relevant event.
4. Risk bands (B5): risk_policies thresholds, GET/PUT /risk/policy (Manager, Admin), band derived at read time so changing a threshold re-bands immediately; a band is never returned without its score range and a pointer to its waterfall.
5. Evidence endpoint GET /evidence/:type/:id returning the actual source document for the evidence drawer.
6. Heat-grid data endpoint (orders by factor).

TESTS: acceptance tests 5 and 28; hand-calculated risk scores for the three Scenario A orders asserted to the exact computed value (calculate by hand in the test with comments showing the arithmetic); best/worst range brackets the point score; changing the RED threshold re-bands without recompute; every factor has at least one evidence id that resolves; unaffected seeded orders never appear.

Follow the Step Close Routine.
```

---

## STEP 10: Solver service (M4 core)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M4, A2), 8 (Scenario A expected numbers, test 6, 23), 13 (stage 7, 8, Solver specification, A2).

TASK: Build services/solver (Python FastAPI + OR-Tools CP-SAT). Write tests FIRST.

1. POST /solve: input JSON {orders[], sources[] (existing free stock and reconciled inbound arrivals with arrival times), candidates[] (transfer lanes with donor free stock and lead time and unit cost; expedites; qualified alternative supplier capacity with lead time and cost; via-warehouse routes), sim_now, time_limit}. Output {status, actions[], per_order[{on_time_units, backordered_units, delay_hours}], objective, baseline_objective, collateral[], solve_ms}.
2. Model exactly as specified: integer variables units from each candidate/source to each order only when arrival <= due; shortfall per order; constraints for source capacity, donor free stock, supplier qualification valid at arrival, deadline eligibility, integrality; partial fulfilment allowed (split orders); objective minimise sum(penalty_per_unit x shortfall) + action cost with a tiny tie-break for fewer actions. Baseline = same model with only existing sources. 2-second limit. If infeasible return the baseline and a reason.
3. Never claim global optimality: the response field is `scope: "portfolio-level constrained optimisation"`.
4. Independent brute-force solver in Python (tests only) that enumerates all integer allocations on the seeded instance.
5. Instance builders in the Node api in Step 11 will call this; here build golden-instance JSON files under services/solver/tests/golden/ computed from the blueprint numbers: Scenario A and Scenario B.

TESTS (pytest): Scenario A instance: baseline penalty exactly 16000; solver plan = transfer 15 from WH-CHN (cost 525) + transfer 10 from WH-BLR (cost 500) + 40 from SUP-2 (cost 4800) = 5825 plus residual penalty 1000 (5 units of ORD-1051) = 6825, saving 9175; ORD-1051 split 45 on time and 5 backordered. Scenario B: baseline 10000, plan = transfer 25 from WH-BLR for 1000, saving 9000. Solver objective equals brute-force objective on both instances AND on 30 randomly generated small instances (seeded RNG). A route that misses an order's deadline is never used. Supplier not qualified at arrival is never used. Donor free stock never goes negative.
If the real engine output differs from the blueprint expected numbers, do NOT change the tests to match; stop and report the discrepancy with your reasoning.

Add `npm run solver:test` and wire the solver into `npm run dev`. Follow the Step Close Routine.
```

---

## STEP 11: Plan generation, routes (A2), trade-off ledger (A3), collateral
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M4, A2, A3, B12), 8 (tests 13, 23, 35), 11 (recovery_plans, plan_actions, route_options, plan_tradeoffs), 12, 13 (A2, A3, B12).

TASK: Connect the api to the solver and produce persisted recovery plans.

1. Candidate enumerator (apps/api/src/services/candidates.ts): from real data only: transfer lanes with donor free stock (free = on_hand - reserved - stock held by other open plans), one-hop via-warehouse paths from route_options/transfer_lanes (lead = sum of lane hours + handling hours, cost = sum of unit costs, distance), expedite options, qualified alternative suppliers with capacity, partial coverage. Drop any route that misses an order's deadline BEFORE the solver sees it. Optional LLM candidate suggestions are untrusted and must pass the proof checker (Step 12) first; leave a clearly typed hook but the default is the enumerator alone.
2. POST /disruptions/:id/recovery-plans (Analyst, Manager): build the instance from live DB state, call the solver (SOLVER_URL), persist recovery_plans (DRAFT, version 1, objective_value, baseline_value, scope label) and plan_actions (REALLOCATE, EXPEDITE, ALT_SUPPLIER, SPLIT) with route_id, arrival_at, cost. If the solver is down return 503 with a clear message; do NOT fall back to fake output.
3. GET /plans/:id returning plan, baseline vs plan, per-order outcome, collateral panel (donor free stock before/after, orders still short), and the savings % computed from stored values.
4. GET /disruptions/:id/routes (A2): feasible direct/via/expedited options with lead time, cost, distance and a ROUTE_FEASIBLE precheck result.
5. Trade-off ledger (A3): for every action compare each order, donor warehouse and supplier before and after the plan; each loss becomes a plan_tradeoffs row with evidence ids, e.g. "Reallocation saves ORD-1042 but takes WH-CHN free stock 15 to 0". GET /plans/:id/tradeoffs. Totals must reconcile with the collateral panel.
6. Recommendation cards (B12): GET /plans/:id/cards with cost, benefit, trade-off link and a feasibility checklist (stock, lead time, capacity, deadline). A card says Feasible only if its claims pass (claims arrive in Step 12; until then return status PENDING_VERIFICATION, never Feasible). Card costs and benefits add up to the plan objective.
7. PATCH /plans/:id (Analyst, Manager): modify actions (and committed dates later); version increments; status back to DRAFT; re-verify required. Audit every change with before/after.

TESTS: Scenario A through the REAL api and REAL solver service: baseline 16000, plan cost 5825 + residual 1000 = 6825, saving 9175 (57%), ORD-1051 split 45/5, collateral WH-CHN free stock 15 to 0; Scenario B 10000 to 1000; tests 13, 23 and the cards sum test; solver down returns 503; plan generation twice is deterministic.

Follow the Step Close Routine.
```

---

## STEP 12: Proof checker, Challenge Plan, Decision Contract (M5, W2)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M5, W2), 8 (tests 7, 17, 18), 11 (plan_claims), 13 (stage 9, 10, claim types table, Decision Contract), 12.

TASK: Build the proof-carrying recommendation engine. This is the heart of the pitch: "The AI proposes. The code proves."

1. Claim generator: every plan action automatically produces its mandatory claims (AVAILABLE_STOCK, SUPPLIER_CAPACITY, SUPPLIER_QUALIFIED, LANE_LEAD_TIME, DEADLINE_MET, ORDER_DEMAND, SHIPMENT_ETA, RESERVATION_AVAILABLE, ROUTE_FEASIBLE, PROMISE_DATE_ACHIEVABLE) with origin SYSTEM. Implement ANSWER_FACT and NOTICE_DATE_MATCHES checkers now as well (used in Steps 19 and 20).
2. Proof checker: each claim is verified by a pure function against the live database, returning status PASS/FAIL, expected, actual and evidence ids (the row ids). Any FAIL sets the plan to BLOCKED and Submit is refused (409 with the failing claims). All PASS gives VERIFIED.
3. LLM narrative (stage 9): the LLM (when available, cached) writes a short narrative plus structured claims; template narrative from plan fields when unavailable. LLM claims have origin LLM and are checked on top of system claims.
4. POST /plans/:id/verify (Analyst, Manager) and POST /plans/:id/challenge (Analyst, DEMO_MODE only): injects a deliberately false claim with origin CHALLENGE, e.g. "WH-BLR has 40 units of SKU-101 available" (actual 10): the checker must visibly FAIL it with expected 40 / actual 10 and BLOCK the plan; regenerating or removing the challenge claim returns to VERIFIED. Challenge claims can never reach an approval.
5. Decision Contract builder: plan ID and version, hash (SHA-256 of canonical actions), required approver roles (REALLOCATE and SPLIT need Manager; EXPEDITE and ALT_SUPPLIER need Procurement Approver), verification status, reservation ids and expiry (filled at submit in Step 14), rollback eligibility, expected impact, guardrail results and committed promise dates (filled in Step 15), escalation approvals. contract_hash is recomputed whenever any input changes.
6. Promise-date claim: PROMISE_DATE_ACHIEVABLE fails if committed date < best recoverable date (full engine arrives Step 15; implement the checker against order_promise_dates now and unit-test it with inserted rows).

TESTS: acceptance test 7 (false claim blocks submission), a table-driven test with at least 3 failing and 3 passing cases per claim type, claim failures when stock is changed under the plan by an inventory correction (re-verify then BLOCKED), challenge claim cannot be approved, contract hash changes when an action changes, LLM absent still gives a full VERIFIED plan.

Follow the Step Close Routine.
```

---

## STEP 13: Governed approvals, separation of duties, versioning (M6)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (M6), 8 (tests 8, 19), 11 (approvals constraints), 12 (role matrix, separation of duties), 13 (Decision Contract).

TASK: Build approvals. Implement submit as a state machine and keep reservations for Step 14 behind a clean interface (reserveStock/releaseStock with an in-memory-free signature) so Step 14 plugs in.

1. Plan state machine: DRAFT -> VERIFIED/BLOCKED -> PENDING_APPROVAL -> APPROVED/REJECTED -> EXECUTED -> ROLLED_BACK. Illegal transitions return 409. Each transition audited.
2. POST /plans/:id/submit (Analyst, Manager): requires VERIFIED, all active guardrail checks present (Step 15 supplies them; until then require zero active policies or fail clearly), freezes the Decision Contract and computes required roles from action types, creates one approval row per required role with contract_hash.
3. POST /plans/:id/approve and /reject (Manager, Procurement): approves for the CALLER'S role only; reject needs a reason. Rules enforced in the backend and the DB: approver is not created_by and not any modifier; each required role needs a distinct approver; Administrator can never approve (403); an approval is valid only if its contract_hash equals the plan's current hash; any modification (PATCH) invalidates earlier approvals, re-verifies, and returns the plan to DRAFT with a new version.
4. Executor cannot be the creator (used in Step 14).
5. Every refusal returns a clear message string that the UI shows (e.g. "Self-approval not allowed").
6. GET /approvals/queue returning pending items for the caller's role with required-role chips, escalation flag, delegation chip placeholders ONLY as real fields that are null until Step 20.
7. Emit bus events PLAN_SUBMITTED, APPROVAL_DECIDED for the notification step.

TESTS: acceptance test 8 (Analyst self-approval 403; Administrator approval 403); a plan with a REALLOCATE and an EXPEDITE action requires both roles and cannot become APPROVED with two Managers; modifier cannot approve; stale-hash approval rejected; modification after one approval voids it; every denied attempt is in the audit log; RBAC matrix tests for every endpoint in this step.

Follow the Step Close Routine.
```

---

## STEP 14: Reservations, Double-Booking Shield, Conflict Court, Execution Ledger, Rollback (S1, S2, A4)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (S1, S2, A4), 8 (tests 9, 10, 14), 11 (stock_reservations, execution_ledger, allocation_conflicts, allocation_claims, constraints about reservations, rollback and courts), 13 (A4).

TASK: Implement the hardest governance mechanics on MongoDB transactions. Write tests first, including concurrency tests.

1. reserveStock(plan) inside ONE transaction: for every needed (warehouse, sku) sorted by (warehouse_id, sku_id), run a conditional updateOne with filter {warehouse_id, sku_id, $expr: {$gte: [{$subtract: ["$on_hand","$reserved"]}, qty]}} and update {$inc:{reserved: qty, version: 1}}. matchedCount 0 means conflict: abort the transaction and return 409 with a conflict card (what was needed, what is free, who holds the rest). Create stock_reservations HELD with expires_at; a reaper job (and an endpoint-triggered sweep) releases expired holds.
2. Allocation Conflict Court (A4): at submit, if the reservation would oversubscribe stock claimed by another plan that is PENDING_APPROVAL/APPROVED, create exactly ONE allocation_conflicts case with both allocation_claims (plan, order, quantity, priority, due_at, penalty_per_unit, consequence if it loses). A plan with an OPEN case cannot be submitted or executed. GET /conflicts/allocation(/:id), POST /conflicts/allocation/:id/resolve (Manager only; requires winner_plan_id and a reason): the winner proceeds, the loser becomes BLOCKED with a message to regenerate, reservations of the loser are released, audited.
3. POST /plans/:id/execute (Manager): requires APPROVED from all required roles, valid contract hash, executor != creator, explicit confirmation flag in the body (and the guardrail breach acknowledgement when ESCALATED, Step 15). In one transaction: convert HELD reservations to COMMITTED, write execution_ledger EXECUTE entries with before/after state and delta_on_hand per action (simulated stock movements: donor warehouse on_hand decreases, destination increases, supplier/expedite arrivals are recorded as scheduled inbound), update plan to EXECUTED, audit, emit PLAN_EXECUTED. Ledger rows join the hash chain via writeLedgerEntry.
4. POST /plans/:id/rollback (Manager): allowed only if EXECUTED and reversing would not push any balance below zero or below later reservations; creates COMPENSATE ledger entries with reverses_entry_id and restores exact balances; otherwise 409 with the reason. Plan becomes ROLLED_BACK; reservations released.
5. Recovery progress data: GET /overview returns recovery progress per disruption (APPROVED/EXECUTED/ROLLED_BACK counts, orders recovered) computed from real records.

TESTS: acceptance tests 9, 10 and 14: two concurrent approvals/submits of competing plans (use Promise.all with real HTTP): exactly one succeeds and the other gets 409; a 50-run loop never oversubscribes stock (assert reserved <= on_hand and sum of COMMITTED+HELD = reserved after every run); execute then rollback restores exact balances for every touched balance (deep-equal before/after); rollback blocked with reason when a later reservation depends on the stock; court case exactly one, no submit/execute until resolved, loser BLOCKED; double-execute is refused; expired reservation release; ledger chain verifies after execute and rollback.

Follow the Step Close Routine.
```

---

## STEP 15: Budget guardrails (A9) and Promise-Date Repair (A7)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (A7, A9), 8 (tests 17, 19), 11 (guardrail_policies, guardrail_checks, order_promise_dates, approvals changes), 12, 13 (A7, A9 specs).

TASK: Implement both engines as deterministic code wired into the plan lifecycle.

1. Promise-Date Repair Engine (A7): for each affected order: original = due time; best recoverable = earliest time the FULL quantity can be on hand = latest of the sources needed (free stock now, reconciled inbound ETA, transfer arrival, supplier lead time) + fulfilment warehouse processing hours; committed defaults to best recoverable and can be edited only to a LATER date via PATCH /plans/:id; split orders show one date for the on-time part and one for the backordered part; store the full `basis` (every input used) and evidence ids. GET /plans/:id/promise-dates (also returned inside the order impact view as best recoverable). Committed dates are part of the Decision Contract.
2. Guardrails (A9): four policies checked on EVERY plan version: expedite+alternative-sourcing spend, service-level damage (residual penalty and share backordered per order), supplier risk score, transfer distance. Write a guardrail_checks row per active policy per plan version (PASS/BREACH with plan value and limit). Submit is blocked unless every active policy has a check for the current version. On BREACH: if the plan needs only one approver role, add the missing role (so it needs both Manager and Procurement); if both are already required mark the plan ESCALATED (guardrail_status): each approval then needs a written justification and the Manager's execute confirmation must acknowledge the breach; emit ESCALATION; the Administrator can never clear an escalation. GET /guardrails, PUT /guardrails/:id (Manager, Admin; audited), GET /plans/:id/guardrails, and clearing an escalation endpoint per the role matrix.
3. Update the Step 13 submit/approve/execute code to use these (required roles, justification requirement, breach acknowledgement) and the Step 12 contract builder to include them.
4. Re-run guardrails and promise dates automatically after any PATCH.

TESTS: acceptance tests 17 and 19 (tightening one limit so the Scenario B plan breaches adds the missing approver role, sends ESCALATION, plan cannot execute until that approval exists); committed date earlier than best recoverable fails PROMISE_DATE_ACHIEVABLE; Scenario A promise dates hand-calculated in the test; defaults let Scenario A and B pass; Administrator cannot clear escalation; split order shows two dates.

Follow the Step Close Routine.
```

---

## STEP 16: Notifications (A1), detectors (B6, B7), alerts (B3), KPIs (B1), SPOF radar (A12)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (A1, A12, B1, B3, B6, B7), 8 (tests 12, 22, 24, 26, 29, 30), 11 (alerts, stock_thresholds, notifications changes, spof_snapshots), 12, 13 (A1, A12, B1, B3, B6, B7).

TASK: Build the control-tower backend that subscribes to the bus.

1. Notifications (A1): templates and fan-out on five triggers: new disruption, pending approval, approval decision, escalation, recovery-status change (plus delegation received and customer notice released, wired in Step 20). Write one notification per affected user per channel (IN_APP, EMAIL_SIM, WHATSAPP_SIM) with channel, link_type, link_id, template_key; nothing leaves the machine. GET /notifications, GET /notifications/outbox?channel=, PATCH read. Every message deep-link must resolve to a real order, disruption or approval screen id. Exactly once per trigger (use a unique key on trigger+entity+user+channel).
2. Late-Shipment Detector (B6): LATE when reconciled ETA > promised_eta + grace (default 60 min, configurable) or clock past promised+grace with no arrival; upsert alert key (LATE_SHIPMENT, shipment); open or refresh exactly one disruption through the normal impact path; runs after every APPLIED event and via POST /detectors/run (Analyst, Manager); idempotent.
3. Stock alerts (B7): BELOW_THRESHOLD (on_hand - reserved < min_level) and PROJECTED_SHORTAGE (within horizon: free stock + reconciled inbound - quantity on orders due inside the horizon < 0), alert key (kind, warehouse, SKU); a cleared condition marks the alert CLEARED on next recompute.
4. Alert feed (B3): GET /alerts (kinds LATE_SHIPMENT, BELOW_THRESHOLD, PROJECTED_SHORTAGE, CONFLICT, GUARDRAIL, SPOF with severity), POST /alerts/:id/ack; chart data endpoints for penalty exposure by order, open disruptions by type, import quality.
5. KPI strip (B1): GET /overview/kpis with six cards (shipments in transit, delayed shipments, items below threshold, open orders, at-risk orders, penalty exposure) each ONE count query plus the filtered list the card opens (same count).
6. SPOF radar (A12): for every supplier, warehouse, SKU and lane compute SPOF = 100 x (0.50 share of open orders depending on it + 0.30 share of open penalty exposure + 0.20 if no qualified alternative with free stock exists), store spof_snapshots with rank, recompute after every import, event and execution; GET /risk/spof with the orders behind each score and the missing alternative; raise SPOF alerts for top-ranked.

TESTS: acceptance tests 12, 22, 24, 26, 29, 30 verbatim (Scenario A: one LATE_SHIPMENT for SHP-204 flagged 120 minutes late, one PROJECTED_SHORTAGE for SKU-101 at WH-HOS 190 needed vs 120 supply, BELOW_THRESHOLD 20 vs 30; duplicate storm adds none; detector run twice leaves one disruption and one alert; shipment inside grace not flagged; radar flags SUP-1 into WH-HOS for SKU-101 BEFORE the disruption and re-ranks after execution; KPI counts equal direct counts); notifications fire exactly once each.

Follow the Step Close Routine.
```

---

## STEP 17: Audit viewer API, Decision Replay (A5), Lineage (A8), provenance polish (B17)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (A5, A8, B17), 8 (tests 15, 18, 40), 11 (lineage_edges, audit changes), 13 (A5, A8, B17).

TASK:
1. Replay (A5): GET /disruptions/:id/replay?upTo=<step>: an ordered query of audit_logs and shipment_events by correlation_id producing steps (webhook received, duplicate ignored, stale kept, conflict raised/resolved, ETA applied, risk recalculated, action proposed, modified, approved, executed/rolled back). Each step links to its audit row and carries the reason. With upTo, return the state AS IT WAS at that step (resolved ETA, risk scores, plan status) reconstructed from the audit before/after data, not from current tables. Make sure every earlier step (Steps 7 to 16) writes audit rows with correlation_id and step_type; add any missing ones and test them.
2. Lineage (A8): GET /orders/:id/lineage?disruption=: chain supplier delay -> delayed shipment -> destination warehouse shortage -> affected order, built from the impact walk and stored in lineage_edges; every edge has evidence ids, observed_at and a calculation string (e.g. "free 20 + usable inbound 100 = 120 < demand 190"). An edge without evidence cannot be created or returned.
3. Provenance (B17): verify the Step 4 chain endpoints work for audit_logs AND execution_ledger (the endpoint accepts ?target=audit|ledger or checks both); implement the tamper demo for both tables.

TESTS: acceptance tests 15, 18 and 40: replay for Scenario A shows every step in order, each linked to a real audit row; scrubbing to step N returns the state as it was then (assert resolved ETA before and after the field report); lineage edges all have evidence+timestamp+calculation, an edge with no evidence is rejected at write time; chain passes clean, tamper breaks and names the first broken row for both tables.

Follow the Step Close Routine.
```

---

## STEP 18: Playbook memory (A6), fingerprints (A10), supplier scorecards (B8), cover/drift (B13)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (A6, A10, B8, B13), 8 (tests 16, 20, 31, 36), 11 (historical_cases, fingerprints, disruption_fingerprints, supplier_scorecards), 12, 13 (A6, A10, B8, B13 specs).

TASK: Four deterministic, rule-based modules. Label them rule-based in API responses (`method: "rule-based"`).
1. A6: similarity = 0.35 same disruption type + 0.25 same supplier or warehouse + 0.20 same SKU + 0.20 (1 - |shortage ratio difference|); GET /disruptions/:id/playbook returns the closest cases with similarity score and insight text (template from stored fields; optional cached LLM phrasing). POST /disruptions/:id/close (Manager): requires the disruption's plan EXECUTED or explicitly no-action; writes a LIVE historical_cases row with what was tried, what worked, what failed, why, freight cost, late orders (computed from real execution data).
2. A10: fingerprint key = (disruption type, root-cause entity, trigger tag or precursor event); active at 3+ matching cases; a new disruption that matches gets MATCH; a precursor event (F2 precursor) raises PRE_WARNING before any order is hurt; GET /fingerprints, /disruptions/:id/fingerprints. A10 only labels patterns from history; it does not detect scan gaps live.
3. B8: supplier scorecard: on-time rate = delivered shipments with actual_arrival_at <= promised_eta + grace over delivered shipments; average delay hours; open delayed shipments; recomputed on every relevant event and import; hidden (returned as null with reason) when fewer than 3 closed shipments; display only, never changes suppliers.risk_score. GET /suppliers/scorecards.
4. B13: GET /projections/cover: days of cover = free stock / (units due in next 7 days / 7), formula string included; GET /shipments/:id/eta-drift: hint only after 3+ APPLIED revisions that all moved later, average shift per revision; labelled projection; verify via a test that risk scores and solver output are byte-identical with B13 code disabled.

TESTS: acceptance tests 16, 20, 31 and 36: Scenario A retrieves the seeded closest case with its insight and similarity; a SUP-1 delay in a festival-peak window shows F1 MATCH; a precursor event for F2 raises PRE_WARNING before orders are hurt; scorecard values equal an independent recomputation and update after a webhook that changes an ETA; SUP-1 < 70%; closing a disruption writes a LIVE case.

Follow the Step Close Routine.
```

---

## STEP 19: Ask the Desk (B4) and What-If Simulator (B14)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (B4, B14), 8 (tests 27, 37), 11 (simulation_runs, constraints), 12, 13 (B4, B14, claim types).

TASK:
1. Ask the Desk (B4): POST /ask (any authenticated role, read-only, warehouse-scoped for operators). Rule-based intent matcher mapping to FIXED parameterised queries: affected orders, today's disruptions, items below threshold, supplier delays, pending approvals (plus a chips endpoint listing them). Template answer built from the result rows; optional cached LLM rephrase that sees ONLY the rows; every number, order and shipment named in the final answer is extracted and checked as an ANSWER_FACT claim against the query rows; if any check fails the template answer is returned instead. Write intents ("approve the plan", "cancel", "delete", "change stock", etc.) are refused with a clear message and logged in audit_logs; state unchanged. Return {answer, rows, claims[], proof_summary}.
2. What-If (B14): POST /whatif/run (Analyst, Manager), GET /whatif/:id. Overrides: delay hours, damaged units, lane lead hours, supplier capacity, stock correction. Load the affected rows into memory through the READ-ONLY Mongo connection, apply overrides, run the same impact walk, risk formula, solver (via the solver service), and guardrail evaluation, return affected orders, baseline vs plan, approvals needed and guardrail results marked SIMULATION. Only simulation_runs is written (using the readonly-with-insert user). A SIMULATION result has no plan id and cannot be submitted (POST /plans/:id/submit with a simulation id returns 404/409). "Open as real disruption" pre-fills an event card (returns a draft card for POST /events, creates nothing).
3. Refactor the impact/risk/solver instance builders so real and simulated runs share the SAME code path with a data-source abstraction (db adapter vs in-memory adapter). No duplicate logic.

TESTS: acceptance tests 27 and 37: "Which orders are affected?" returns exactly ORD-1042, ORD-1047, ORD-1051 with every number backed by a passing ANSWER_FACT claim and identical facts with LLM disabled; the write intent is refused, logged, no state change; what-if with 70 damaged units and 2 hours delay reproduces baseline 16000 and plan 6825; row counts before/after of inventory_balances, stock_reservations, execution_ledger, approvals, notifications are identical; the what-if db connection cannot write to anything except simulation_runs (assert driver permission error).

Follow the Step Close Routine.
```

---

## STEP 20: Delegation (B9), master data (B10), corrections, customer notices (B18)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (B9, B10, B18), 8 (tests 32, 33, 41), 11 (approval_delegations, customer_notices, constraints), 12 (role matrix rows for B9, B10, B18; separation-of-duties text), 13 (B9, B10, B18).

TASK:
1. Delegation (B9): POST/DELETE /approvals/delegations(/:id) (Manager, Procurement): same-role, time-boxed (valid_from/valid_to), optionally limited to one plan; delegate must hold the same role, must not be the plan's creator or any modifier, can never be the Administrator; while active the delegator LOSES approval rights on that plan; approvals made by a delegate store acted_as_delegate_of and delegations in force are recorded in the Decision Contract. POST /plans/:id/request-changes (Manager, Procurement): decision CHANGES_REQUESTED with a comment, plan version increments, earlier approvals become invalid. Notifications for DELEGATION_RECEIVED and CHANGES_REQUESTED; audit everything.
2. Master data (B10): GET/POST/PATCH /admin/master/:entity for suppliers, warehouses, SKUs, lanes, supplier capacity, orders (Admin only) with Zod validation; no hard deletes (deactivate flag); editing on_hand directly is rejected (400 with message); POST /inventory/corrections (Manager, Admin) through the ledger service writing an EXECUTE-type correction ledger entry plus audit; a change that touches stock reserved by an open plan returns 409; any plan whose claims a correction breaks is re-verified and BLOCKED if a claim fails (bus event INVENTORY_CORRECTED).
3. Customer notices (B18): POST /plans/:id/customer-notices (Analyst, Manager) drafts from templates ON_TIME_RECOVERY and SPLIT_ORDER using values from order_promise_dates (split orders show both dates and backordered units); GET /customer-notices; POST /customer-notices/:id/release (Manager only) allowed only when the plan is APPROVED or EXECUTED and committed_at equals the promise-date row, with the NOTICE_DATE_MATCHES claim passing; released notices go to the simulated outbox only. No public or customer-facing route exists (add a test that enumerates routes).

TESTS: acceptance tests 32, 33 and 41 verbatim (including: delegator cannot approve while delegation active; delegating to the creator, modifier, different role or Admin refused; request-changes voids approvals; Analyst master-data 403; Admin creates and deactivates a supplier, never deletes; correction touching reserved stock 409; release before approval refused; Analyst release 403).

Follow the Step Close Routine.
```

---

## STEP 21: Stress-test mode (A11) and Red-Team suite (S3)
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 7 (A11, S3), 8 (test 21), 11 (stress_runs), 12, 13 (A11).

TASK:
1. Stress-Test (A11): POST /admin/stress/run (Admin, DEMO_MODE): injectors selectable individually or all: duplicate webhooks, invalid CSV rows, conflicting ETAs, simultaneous supplier failures (several shipments from one supplier delayed in parallel), sudden inventory corrections. Injectors go through the NORMAL public code paths (same endpoints/services as real input), tag injected data, and the run returns a report counting applied, ignored, stale, quarantined, held, rejected items plus unhandled errors (must be 0) and a state-integrity check (reserved <= on_hand everywhere, chain verifies, no duplicate alerts per alert_key, no duplicate open disruptions). Persist in stress_runs. Provide a cleanup that restores the pre-run state (demo reset or targeted rollback).
2. Red-Team (S3): POST /admin/red-team/run (Admin): about 12 real bypass attempts against the live API using real HTTP and real tokens, each recorded as BLOCKED/NOT_BLOCKED with the response and the audit row id proving it was logged. Include at least: Analyst self-approval, Admin approval, Operator other-warehouse access, forged JWT role claim, unsigned webhook, replayed webhook, tampered contract hash approval, approving a BLOCKED plan, executing without approval, executing as creator, direct on_hand edit via master data, submitting a SIMULATION result, rolling back a non-executed plan, releasing a customer notice before approval, and the write-intent in Ask the Desk. The suite must show 12 of 12 blocked.
3. Add a CLI `npm run redteam` and `npm run stress` that call the same services and exit non-zero on any failure.

TESTS: acceptance test 21 (full stress run: zero unhandled errors, no corruption, counts add up to injected items); red-team returns all blocked and all logged; stress followed by Verify chain passes; alert-noise check: zero duplicate open alerts per distinct condition across a stress run.

Follow the Step Close Routine. Mark in STATE.md: BACKEND COMPLETE. Run the ENTIRE backend test suite and paste the totals.
```

---

## STEP 22: UI screens 1 to 4 on live data (Impeccable)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md, docs/DESIGN.md and docs/BLUEPRINT.md section 14 (screens table and add-on/micro tables).

TASK: Build screens 1 to 4 with REAL API data only. Use the Impeccable routine (craft for each screen, then critique/audit/polish before closing).

Screen 1 Sign-in: real login plus the demo role switcher with seeded users and role badges.
Screen 2 Operations cockpit: B1 KPI strip (six clickable cards, each opens the filtered list with the same count), active disruptions, affected orders, pending approvals, recovery progress, conflicts waiting, A12 SPOF radar tile (ranked, orders behind each), A10 fingerprint banner, B3 alert feed with severity chips and deep links, three Recharts charts (penalty exposure by order, open disruptions by type, import quality), a Run detectors button. The B2 network map tab is built in Step 25.
Screen 3 Intake and quarantine: CSV/JSON upload for each entity, row-level error table with suggested fixes, accept/edit/discard, commit, B11 quality report (counts, error-reason chart, file hash, FILE_ALREADY_IMPORTED message), the carrier simulator with "Send duplicate storm" that shows the REAL returned counts, B15 paste box with the sample message buttons.
Screen 4 Disruption investigation: event timeline with state chips (APPLIED/DUPLICATE/STALE/CONFLICT/REJECTED), conflict card with resolve action, resolved ETA with reason and lineage, B8 supplier scorecard, A10 banner, A5 replay tab (the scrubber arrives wired to the real replay endpoint here), voice panel with confirm card shown in English and Tamil (mic wiring in Step 26; the transcript box, editing and Use sample transcript work now).

Rules: no mock data anywhere; loading/empty/error states real; every number formatted INR/Kolkata time; every table paginated or virtualised where lists can grow; keyboard accessible. Remove any leftover EmptyState "Available after step N" for these screens.

TESTS: Playwright end-to-end against the real running stack for: login as each role; the storm button counts; conflict resolution; import of the 10-bad-row fixture shows exactly 10 quarantined rows with reasons.

Follow the Step Close Routine, including Impeccable audit results in the commit notes.
```

---

## STEP 23: UI screens 5 and 6 on live data (Impeccable)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md, docs/DESIGN.md and docs/BLUEPRINT.md section 14.

TASK: Build screens 5 and 6 on REAL data. Use the Impeccable routine. These are the most important screens; polish them most.

Screen 5 Impact and risk: ranked orders with score, B5 band chip (always opens waterfall), score range, factor waterfall, evidence drawer (opens the real source row through GET /evidence), A7 three date chips (original, best recoverable, committed), A8 lineage graph built with React Flow in the drawer (click an edge to see evidence, timestamp, calculation string), B13 days-of-cover chip and drift hint labelled "projection", heat-grid tab. The B2 map section arrives in Step 25.
Screen 6 Recovery workbench: "Generate Recovery Plan" button; baseline vs plan with savings % and INR; per-order outcome bars (on-time vs backordered); collateral panel; A3 trade-off ledger beside it (saves on the left, hurts on the right); A2 lane/route diagram (plain SVG) with selectable routes feeding the plan; A6 playbook insight card above the plan; B12 recommendation cards with feasibility checklists; claims list with expected vs actual and origin chips; Challenge Plan button; Regenerate; A9 four guardrail meters with PASS/BREACH; committed-date editing (later dates only, server validated); Decision Contract view; Submit disabled whenever claims fail or guardrails are missing (and the server enforces it); B14 What-If tab with sliders, SIMULATION banner, and "Open as real disruption" that pre-fills a confirm card.

Rules: every figure comes from API responses; show "scope: portfolio-level constrained optimisation" text; the plan screen must reproduce Scenario A (₹16,000 to ₹6,825) from the live engine, not from code constants.

TESTS: Playwright flow for Scenario A on screens 4 to 6: confirm field report, open impact (exactly 3 orders), generate plan, Challenge Plan fails with expected 40 actual 10 and Submit disabled, Regenerate turns all green; what-if with 70 damaged and 2 hours reproduces the numbers with SIMULATION label and zero DB changes (query counts via an api test helper endpoint available only in test mode).

Follow the Step Close Routine.
```

---

## STEP 24: UI screens 7 and 8 on live data (Impeccable)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md, docs/DESIGN.md and docs/BLUEPRINT.md section 14.

TASK: Build screens 7 and 8 on REAL data. Use the Impeccable routine.

Screen 7 Approvals and execution: queue with required-role chips, escalation chip, delegation chip; Approve, Reject (reason), Modify (opens the plan edit), B9 Delegate (user picker limited to valid same-role users, time window) and Request changes (comment) buttons; justification box when ESCALATED; reservation conflict card on 409; A4 Allocation Conflict Court side-by-side card with claims, priorities, deadlines, penalties, consequences, "Pick winner" with a required reason; Confirm and Execute with an explicit confirmation checkbox (and breach acknowledgement when escalated); Rollback with eligibility shown (and the blocking reason when ineligible); B18 notice drafts tab with Manager Release; close-disruption action (A6) for Managers. Show server error messages verbatim in toasts (e.g. "Self-approval not allowed").
Screen 8 Audit and security: filterable audit table (actor, action, entity, correlation id, date), ledger before/after table, B17 Verify chain button with a pass/fail banner naming the broken row, Tamper one audit row (Admin, DEMO_MODE), red-team result grid (12 attacks with BLOCKED chips and audit links), A11 stress-test panel with five injector buttons and the report, B10 Admin tab with entity tabs, simple forms and the Correct stock dialog, risk-band and threshold settings, guardrail settings, SimClock control and Admin demo reset, notifications list.

TESTS: Playwright end to end: the full approval chain of the demo script (Analyst Approve gives the 403 toast; Manager Approve; Procurement Approve; Manager Confirm and Execute; ledger shows before/after; rollback eligible); two-tab concurrency (two competing plans approved simultaneously gives exactly one 409 with a conflict card); delegation flow; tamper then verify shows the broken row id; red-team grid 12 of 12.

Follow the Step Close Routine.
```

---

## STEP 25: Notification drawer, Ask the Desk drawer, network map (B2), cross-screen add-on panels
**Model: GEMINI 3.8 FLASH** (use SONNET 4.6 if the map SVG logic gets messy)

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md, docs/DESIGN.md and docs/BLUEPRINT.md sections 7 (A1, B2, B4), 8 (tests 12, 25, 27), 14.

TASK: Wire the header features and the map on REAL data. Use Impeccable for craft and polish.
1. A1 notification drawer: bell with unread count (real), tabs for IN_APP / EMAIL_SIM / WHATSAPP_SIM styled as a simulated inbox (email list and chat bubbles); every message deep-links to its real order, disruption or approval screen; mark read.
2. B4 Ask the Desk drawer on all screens: chips from the API, free text, answer with the proof chip listing the checked ANSWER_FACT claims, refusals shown clearly.
3. B2 network map as plain SVG (no tiles): warehouses, suppliers and transfer lanes from seeded coordinates (map_x, map_y 0..1000), delayed shipments and the warehouse they feed highlighted from open disruptions, node click opens a drawer listing the orders behind it (WH-HOS lists exactly ORD-1042, ORD-1047, ORD-1051 in Scenario A). Put it in the cockpit as a tab and in Impact and risk as a section.
4. Check every add-on panel in the blueprint's "Where each add-on appears" and "Where each micro-feature appears" tables exists on its screen and is reachable; list any gap and fix it.

TESTS: Playwright: a notification link opens a valid screen for each of the 5 trigger types in Scenario A; map highlights after the field report; Ask chip returns the 3 orders; "approve the plan" is refused in the UI.

Follow the Step Close Routine.
```

---

## STEP 26: Voice in the browser and Operator phone view (W1, B16)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md, docs/DESIGN.md and docs/BLUEPRINT.md sections 7 (W1, B16), 8 (tests 11, 39), 14.

TASK:
1. Voice: Web Speech API (ta-IN and en-IN selectable) with a mic button, live editable transcript, "Use sample transcript" button that works with no microphone and no internet, graceful handling of unsupported browsers and denied permission, the confirm card in English and Tamil, and Confirm/Edit/Cancel. Nothing is saved until Confirm.
2. B16 Operator phone view: responsive layout verified at 390 px width for the Warehouse Operator role (own warehouse only): field report form, confirm card, inbound shipments for the operator's warehouse, notifications. Offline draft queue in IndexedDB: reports drafted while offline are stored, a "Drafts" chip shows the count, they submit to the normal endpoints on reconnect and STILL require confirmation. Not a PWA, no install prompt.
3. Server side checks already exist; verify the operator cannot see or request another warehouse's data from the UI or by editing the request.

TESTS: Playwright with mobile viewport 390x844: operator logs in, sees only WH-HOS data, submits the sample transcript, confirms, ETA updates; emulate offline (context.setOffline), save a draft, go online, it submits and awaits confirmation; another warehouse returns 403 (call the API directly in the test).

Follow the Step Close Routine.
```

---

## STEP 27: Full acceptance suite (all 41 tests) and scenario runners
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md section 8 (Definition of done and acceptance tests 1 to 41), section 16 (demo script and Scenario B).

TASK: Prove the whole product. Create tests/acceptance/ with ONE test file per blueprint acceptance test number (acceptance-01.test.ts to acceptance-41.test.ts), each named exactly as the blueprint bullet, running against the real stack (api + solver + local Mongo test DB) through real HTTP. Reuse earlier tests only by importing shared helpers; do not just re-export. Add:
1. tests/acceptance/scenario-a.e2e.ts and scenario-b.e2e.ts: the complete flows from the blueprint (field report to approved and executed plan, then rollback; Scenario B conflict, Manager resolves in favour of supplier portal, LATE_SHIPMENT disruption opens, transfer 25 units for ₹1,000, saving ₹9,000 (90%), Manager-only approval).
2. A `npm run acceptance` command with a summary table (test number, name, PASS/FAIL, ms). Exit non-zero on any failure.
3. Fix real defects the suite reveals in the application code (never weaken a test; if a test and the blueprint disagree, report it instead of editing the expectation).
4. A coverage report; list any untested branch in STATE.md and write the missing tests.

Paste the final summary table. 41 of 41 must pass. Follow the Step Close Routine.
```

---

## STEP 28: Hardening and full-repo review (CodeRabbit, Impeccable)
**Model: SONNET 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/DESIGN.md.

TASK: Whole-repo hardening.
1. CodeRabbit: run the full-repo (or all-branch diff) review routine from docs/EXTENSIONS.md. Fix every actionable finding (security, race conditions, error handling, perf, type safety). Document intentionally ignored findings with reasons in docs/REVIEW.md.
2. Placeholder purge: run npm run scan:placeholders across the WHOLE repo (not only apps/web). Also grep the UI for hardcoded numbers/strings that should come from the API. Fix every hit.
3. Security pass: JWT expiry and secret strength validation, rate limiting on login and webhook, helmet, CORS allowlist, input size limits, Mongo operator-injection protection (sanitise $-keys in bodies), no secrets in logs, DEMO_MODE-only routes truly absent when DEMO_MODE=false (test it).
4. Performance pass: indexes for every list query actually used (explain() the top 10 queries), cockpit endpoint under 300 ms on seed data, solver call under 2.5 s.
5. Impeccable: run its audit on every screen once more; fix accessibility, contrast, focus order and responsive issues; keep desktop-first quality.
6. Dependency audit (npm audit, pip audit) and remove unused dependencies.
7. Error-path UX: kill the solver mid-demo and confirm the UI shows a clear 503 message with retry; kill and restart Mongo and confirm recovery.

TESTS: re-run unit, acceptance and Playwright suites; all green.

Follow the Step Close Routine.
```

---

## STEP 29: Demo readiness (reset, cache warm, rehearsal data, docs)
**Model: GEMINI 3.8 FLASH**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md sections 15 (hours 40 to 48), 16, 17, 18, 19.

TASK:
1. `npm run demo:reset` and the Admin "Reset demo" button reseed Scenarios A and B, the competing plan, SimClock, and clear alerts/plans/approvals so the cockpit shows zero active disruptions. Verify by running it three times in a row.
2. `npm run demo:warm`: if GROQ_API_KEY is set, call the LLM for the demo transcripts, plan narration and playbook insight so llm_cache is warm; if not set, print that the deterministic fallback is active and verify the same text outputs work.
3. docs/DEMO.md: a pre-flight checklist (mongod replica set running, solver healthy, SimClock, mic permission, sample transcript visible), the exact 90-second script with the real on-screen numbers produced by the live engine, the optional add-on and micro-feature beats, the "if a judge wants more" flows (two-tab concurrency, Red-Team), and a backup plan (sample transcript button, recorded video steps, local-only run).
4. docs/JUDGE_QA.md: the five likely questions plus the bonus questions from the blueprint with answers that match what the code really does.
5. docs/METRICS.md and `npm run metrics`: computes the blueprint's three metrics from the real database and test runs (penalty exposure avoided for Scenarios A and B, signal-to-approved-plan time measured from timestamps, governance integrity from red-team and the 50-run concurrency loop) and prints honest labels (simulation on synthetic data).
6. README final: install, env, run, test, demo, troubleshooting (Mongo replica set, Python venv, ports).
7. Time the full demo run with the Playwright script and print the duration; it must be under 90 seconds of UI time.

Follow the Step Close Routine.
```

---

## STEP 30: Final audit: "is it 100% real?"
**Model: OPUS 4.6**

```text
Read docs/RULES.md, docs/STATE.md, docs/EXTENSIONS.md and docs/BLUEPRINT.md completely. You are now an independent auditor, not the author. Be strict and do not trust earlier STATE.md claims; verify by running things.

TASK: Produce docs/FINAL_AUDIT.md.
1. Fresh-clone test: in a temporary directory clone the repo, follow ONLY the README, and get the app running (db:start, install, seed, dev). Record any step that failed or was unclear and fix the README/scripts.
2. Feature-by-feature verification table covering every ID in the blueprint (M1 to M7, S1 to S3, W1, W2, A1 to A12, B1 to B18): for each, the backend file, the API route, the UI location, the test file, and PASS/FAIL after actually exercising it (via acceptance tests and Playwright, plus a manual API call where useful). A row is FAIL if any value on screen is hardcoded, mocked, empty without data cause, or if the feature depends on an LLM key.
3. Run: npm run scan:placeholders, npm run acceptance (41/41), npm run redteam (12/12), npm run stress, Verify chain, Playwright suite, solver tests, typecheck, lint, and paste results.
4. Run the LLM-off check (GROQ_API_KEY unset): every demo flow still works.
5. Run the demo script twice end to end with demo:reset between runs and compare the on-screen numbers to the blueprint expected values (Scenario A ₹16,000 to ₹6,825 saving ₹9,175 57%, Scenario B ₹10,000 to ₹1,000 saving ₹9,000 90%).
6. Fix every FAIL you can fix now. For anything you cannot fix, list it under KNOWN GAPS with the exact reason. Do not mark the project complete while any FAIL remains in a Must-build, Should-build or Wow feature.
7. CodeRabbit final pass; GSD Mission Control: close all missions; STATE.md: "STEP 30: PASS" only if the audit is clean.

Tag the release `v1.0-demo`. Report in 10 lines maximum.
```

---

## Appendix: quick reference

**If a step fails its tests:** paste the failing output into the same model with: "Fix the root cause in the application code. Do not edit tests to make them pass unless the test contradicts docs/BLUEPRINT.md, in which case explain first."

**If you must change the plan mid-way:** ask the agent to update docs/RULES.md and docs/STATE.md first, so every future account sees the change.

**Milestones you can check yourself:**

| After step | What should truly work |
|---|---|
| 8 | Intake, reconciliation, voice and text parsing through the API |
| 14 | Event to approved, executed and rolled-back plan through the API, with no double-booking |
| 21 | Every backend feature, 12/12 red-team, stress test clean |
| 24 | Every screen on live data |
| 27 | 41 of 41 acceptance tests |
| 30 | Audited, fresh-clone verified, demo-ready |
