# DisruptionIQ — Hardening, Demo Readiness, and Full-Repo Review

_Step 17 — Completed 2026-10-30_

---

## Security Hardening Applied

| Control | Detail | Status |
|---------|--------|--------|
| HTTP Security Headers | `helmet` middleware added to Express app: `X-Frame-Options`, `X-XSS-Protection`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy` | ✅ ACTIVE |
| Rate Limiting | `express-rate-limit` 300 req / 15 min per IP; health check exempt | ✅ ACTIVE |
| CORS | Enabled via `cors()` for all origins in demo mode | ✅ ACTIVE |
| JWT Auth | HS256 tokens, 8 h expiry, re-reads user from DB on every request | ✅ ACTIVE |
| RBAC | Role-Permission matrix enforced at route level; `requirePermission()` on every mutation | ✅ ACTIVE |
| Audit Hash Chain | SHA-256 linked chain written for every state mutation; `GET /audit/verify` chain-walks | ✅ ACTIVE |
| Webhook HMAC | Carrier webhook `X-Webhook-Signature` HMAC-SHA256 verified | ✅ ACTIVE |
| Database Invariants | Mongoose validators: `reserved <= on_hand`; `on_hand` direct write blocked | ✅ ACTIVE |
| Optimistic Locking | `withTransaction` with canonical `(warehouse_id, sku_id)` lock order | ✅ ACTIVE |
| No Placeholder Data | `scan:placeholders` scanner passes with 0 violations | ✅ PASS |
| Zero TS Errors | `tsc -b --noEmit` clean | ✅ PASS |
| Route Permissions | `verifyRoutePermissions` self-check: 264 routes, all covered | ✅ 264 ROUTES |
| Red-Team Suite | 15 / 15 adversarial attack vectors blocked at runtime | ✅ 100% |

---

## Full Repository Structure Review

```
disruptioniq/
├── apps/
│   ├── api/                     Express TS backend (Node 20)
│   │   ├── src/
│   │   │   ├── app.ts           Main Express app (helmet, rate-limit, cors, RBAC)
│   │   │   ├── config.ts        Zod-validated environment config
│   │   │   ├── db.ts            Mongoose connect, replica-set check
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts      JWT + RBAC + audit on ACCESS_DENIED
│   │   │   │   └── routeCheck.ts 264-route permission self-check
│   │   │   ├── models/          45+ Mongoose models
│   │   │   ├── routes/          27 route files (264 routes total)
│   │   │   └── services/        Domain services (solver, lineage, audit, AskDesk …)
│   │   └── test/                7 test files (step2–step6, step16 acceptance)
│   └── web/                     Vite React 18 TS frontend
│       └── src/
│           ├── screens/         8 blueprint screens (all complete)
│           ├── ui/              Component library + NetworkMap + VoiceModal
│           └── api/client.ts    Typed API client
├── packages/
│   └── shared/                  Role-permission matrix, shared types
├── services/
│   └── solver/                  FastAPI LP solver (Python)
├── scripts/
│   ├── seed.ts                  Deterministic seed data (Scenario A calibrated)
│   ├── run-scenario-a.ts        End-to-end Scenario A runner
│   ├── run-stress.ts            5-chaos-vector stress suite
│   ├── run-redteam.ts           15-vector red-team runner
│   └── scan-placeholders.mjs   Zero-placeholder enforcer
└── docs/
    ├── STATE.md                 Step status tracker
    └── DESIGN.md                Impeccable UI design brief
```

---

## All 8 Blueprint Screens — Completion Status

| # | Screen | Key Features | Status |
|---|--------|-------------|--------|
| 1 | Sign-in | Seeded role switcher, JWT auth | ✅ |
| 2 | Operations Cockpit | B1 KPIs, A10 active disruption banner, A12 SPOF radar, B3 alerts feed, 3 Recharts charts, B2 Network Map tab | ✅ |
| 3 | Intake & Quarantine | CSV/JSON upload, B11 quality report, quarantine triage, B15 text ingestion | ✅ |
| 4 | Investigation | Resolved ETA, A5 replay scrubber, B8 scorecard, conflict resolution, voice panel (EN + TA) | ✅ |
| 5 | Impact & Risk | Ranked orders, B5 risk band chip, A7 date chips, factor waterfall, A8 lineage graph (ReactFlow), B13 DoC, heat-grid, B2 map tab | ✅ |
| 6 | Recovery Workbench | A6 playbook card, Scenario A solver output (INR 9,175 / 57% savings), A2 SVG route selector, A3 trade-off ledger, B12 action cards, claims table, A9 guardrails, promise date editor, Decision Contract, B14 What-If tab | ✅ |
| 7 | Approvals & Execution | Dual-role queue, role sign-off tracker, A9 execution stepper (4 steps), rollback, delegation CRUD, customer notices | ✅ |
| 8 | Audit & Security | SHA-256 chain table + verify + demo tamper, 15-vector red-team matrix, master data governance, supplier scorecards | ✅ |

---

## Header Drawers — Completion Status

| Drawer | Features | Status |
|--------|---------|--------|
| A1 Notification Bell | Real unread count, IN_APP / EMAIL_SIM / WHATSAPP_SIM channel tabs, live poll every 15 s | ✅ |
| B4 Ask Desk | Prompt chips, write-intent refusal (ANSWER_FACT grounding), VERIFIED fact display | ✅ |

---

## Demo Runbook (Hackathon Day)

### Prerequisites
```bash
# Start MongoDB replica set (one-time)
npm run db:start

# Seed Scenario A data
npm run db:seed

# Start API server
npm run dev:api         # port 4000

# Start frontend
npm run dev:web         # port 5173
```

### Demo Flow (8-Minute Walk-Through)

1. **Sign-in as Analyst (Priya)** — shows IST SimClock, role badge  
2. **Cockpit** — 4 KPI cards, open disruption banner, SPOF radar lights up `SUP-1`  
3. **Intake** — drag-drop CSV, see quarantine rows with quality report  
4. **Investigation** — select disruption, see +34 h ETA resolution, A5 replay scrubber, voice field report panel  
5. **Impact & Risk** — ranked orders with CRITICAL/HIGH bands, click Apollo Hospitals → evidence drawer → lineage graph → click STOCKOUT_INDUCED edge to see calculation proof  
6. **Recovery Workbench** — click "Generate Recovery Plan" (or "Load Scenario A") → see baseline INR 16,000 vs plan INR 6,825 (57% savings) → A2 SVG route selector → click "Challenge Plan (Demo Fault)" to show WH-BLR discrepancy → "Submit blocked" message → click "Clear Challenge" → submit enabled  
7. **Approvals** — switch to Manager role → sign-off → switch to Procurement role → second sign-off → "Execute Plan" → 4-step ledger animation  
8. **Audit** — verify chain (✓ green), click "Tamper Chain (Demo Fault)" → chain breaks red → "Restore Chain" → green again

### Key Demo Talking Points

- **Zero hallucinations**: Ask Desk refuses to write (try "Update inventory to 1000 units")
- **Cryptographic proof**: Every approval creates a SHA-256 block; tamper is instantly detectable
- **57% cost reduction**: LP solver computes optimal dispatch vs INR 16,000 unmitigated exposure
- **Red-team score**: 15/15 attack vectors blocked live (role escalation, negative balance write, retrograde date, race conditions...)
- **India-locale**: All currency in INR (en-IN), all times in Asia/Kolkata IST
- **Run scenario runner**: `npm run scenario:a` for full automated E2E proof

---

## Performance Notes

- Production bundle: ~1 MB JS, ~49 KB CSS (gzip: 290 KB / 8.7 KB)
- Vite build: 8-10 s cold, 2403 modules
- MongoDB: single-node replica set (transactions + change streams)
- All API routes return JSON; no server-side rendering

---

> [!TIP]
> For the demo, keep MongoDB running (`npm run db:start`) and seed once (`npm run db:seed`). Then use the demo role switcher in the header to flip between Analyst → Manager → Procurement without separate login windows.

