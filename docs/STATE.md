# DisruptionIQ Verified Recovery Desk — Project State

_Last updated: 2026-10-30 by Step 0 (Brain)_

---

## Step Status Table

| Step | Title | Status |
|------|-------|--------|
| 0 | Brain | **STEP 0: PASS** |
| 1 | Scaffold and Mongo replica set | **STEP 1: PASS** |
| 2 | Data model and security roles | NOT STARTED |
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

## IN PROGRESS

**Step 2 — Data model, indexes, validators, security roles** (NOT STARTED — next)

---

## KNOWN ISSUES

_(must be empty for any step to be marked PASS)_

None.

---

## COMMANDS

| Command | What it does |
|---------|-------------|
| `git log --oneline -15` | View recent commits |
| `npm run test` | Run all tests (configured in Step 1) |
| `npm run scan:placeholders` | Scan for forbidden placeholder strings (configured in Step 1) |
| `npm run db:start` | Start local MongoDB replica set (configured in Step 1) |
| `npm run db:seed` | Seed demo data (configured in Step 3) |
| `npm run db:reset` | Reset to clean demo state (configured in Step 3) |
| `npm run dev` | Start api + web + solver together (configured in Step 1) |
| `npm run acceptance` | Run all 41 acceptance tests (configured in Step 27) |
| `npm run redteam` | Run red-team security suite (configured in Step 21) |
| `npm run stress` | Run stress injector suite (configured in Step 21) |
| `npm run demo:reset` | Full demo reset to scenario-ready state (configured in Step 29) |
| `npm run demo:warm` | Warm LLM cache for demo (configured in Step 29) |
| `npm run metrics` | Print governance/penalty metrics (configured in Step 29) |

---

## ENV VARS

Full list in `.env.example` (created in Step 1). Key variables:

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
