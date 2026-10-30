# DisruptionIQ Verified Recovery Desk — Standing Rules

> This file is the authoritative ruleset. Every step reads it on start. Do not modify without updating docs/STATE.md first.

---

## SOURCE OF TRUTH

`docs/BLUEPRINT.md` is the canonical feature specification.

**Exceptions decided by the user (this file wins over the blueprint):**

| Blueprint says | This project does |
|---|---|
| PostgreSQL + Prisma, raw SQL | **Local MongoDB (Mongoose + native driver), single-node replica set `rs0` on port 27017** |
| SQL CHECK/UNIQUE/atomic UPDATE | Unique indexes, `$jsonSchema`/`$expr` validators, conditional `updateOne` inside a transaction |
| "No UPDATE/DELETE grants" | Separate Mongo users and roles (insert-only role for audit and ledger) |
| Docker Compose primary | `npm run dev` starts everything locally; Docker is optional |
| PostgreSQL/Prisma migrations | `ensureIndexes()` run at api start and in tests |

**Stack:**
- Frontend: React + Vite + TypeScript + Tailwind CSS
- Backend: Node.js + Express + TypeScript
- Solver: Python FastAPI + OR-Tools CP-SAT
- Database: Local MongoDB (single-node replica set `rs0`)
- Monorepo: npm workspaces

---

## NO PLACEHOLDERS, EVER

The following are absolutely forbidden in `apps/`, `services/`, `packages/` (seed files and test fixtures are the only exceptions):

- `lorem ipsum` (any form)
- `TODO`, `FIXME`
- The word `placeholder` or `mock` or `dummy`
- `coming soon`, `not implemented`
- `fake` (as a data label)
- Hardcoded INR amounts in UI code (e.g. `₹16000` as a constant — must come from API)
- Empty event handlers
- Commented-out stubs
- Mock arrays replacing real API calls
- Fake API responses

Every number on screen **comes from the database or a deterministic computation over it**. Seed data is the ONLY place concrete demo values live, and it lives in the seed script (`scripts/seed.ts`).

---

## FEATURE COMPLETENESS RULE

Every feature ships with **all four** of the following, or it is not complete:
1. Backend business logic
2. API route with backend RBAC (`requirePermission`)
3. UI wiring (when the UI step for that feature arrives)
4. An automated test

---

## DETERMINISM RULE

Deterministic code decides: stock, deadlines, permissions, risk, reservations, execution.

**LLM (Groq, optional)** is used ONLY for: voice/text extraction narration, plan narration, playbook phrasing. All LLM calls are:
- Cached by input hash in `llm_cache`
- Always accompanied by a deterministic fallback
- The app must work 100% with `GROQ_API_KEY` unset

---

## SIMULATION CLOCK

All `"now"` values come from a `SimClock` service (`apps/api/src/services/simClock.ts`).

- Reads from env `SIM_NOW` or from the `settings` collection
- **Never use `new Date()` in business logic**
- `new Date()` is only allowed in: the SimClock service itself (to seed the default), logging, test setup
- This makes demos repeatable

---

## MONEY AND TIME

- Money: **INR, integer rupees** (no decimals, no foreign currencies)
- Times: stored in **UTC**, displayed in **Asia/Kolkata** (`en-IN` locale, ₹ symbol)

---

## APPEND-ONLY RULE

The following collections are **insert-only** (enforced by both application code and Mongo roles):
- `shipment_events`
- `audit_logs`
- `execution_ledger`

No update or delete is ever issued against these collections by application code. The only write is insert.

---

## GUARDRAIL RULE (M1–M6, S1, S2)

Must-build features (M1–M6) and Should-build features (S1, S2) are **never weakened** by add-ons (A) or micro-features (B).

Add-ons and micro-features **never write stock directly**; they go through the standard inventory correction service.

---

## SECRET MANAGEMENT

- Never commit secrets to git
- `.env` is gitignored
- `.env.example` contains all variable names with safe placeholder values (no real secrets)
- All secrets are read through the config module (Zod-validated at startup)

---

## STEP CLOSE ROUTINE

This routine is **mandatory** at the end of every step before committing:

```
a. Run the step's tests PLUS the full test suite accumulated so far. Fix all failures.
b. Run `npm run scan:placeholders` (created in Step 1). Fix every hit.
c. Run the CodeRabbit review routine from docs/EXTENSIONS.md on the diff; fix every actionable finding; list what you intentionally ignored and why.
d. Update GSD Mission Control (mark this step's tasks done, create next step's tasks) per docs/EXTENSIONS.md.
e. Update docs/STATE.md:
   - Set "STEP N: PASS"
   - List files created/modified
   - List commands to run
   - Known issues (must be EMPTY to PASS)
   - Set the next step's number
f. git commit with message "step N: <title>"
```

---

## RESUME RULE

If a step cannot be completed in one session:
- Write exactly where you stopped in `docs/STATE.md` under `IN PROGRESS`
- Include: last completed sub-task, what is half-done, what command to run next
- A different model or account can resume from `docs/STATE.md`

---

## MODULE BOUNDARIES

Prefer small files and clear module boundaries:

```
apps/api/          — Express backend
apps/web/          — React frontend
services/solver/   — Python FastAPI + OR-Tools
packages/shared/   — Zod schemas + TypeScript types shared by api and web
scripts/           — db scripts, seed, scan-placeholders, stress, redteam
docs/              — All documentation files
```

---

## ROUTE PERMISSION RULE

No API route exists without `requirePermission`. At startup the api runs a **self-check** that enumerates all registered routes and fails the boot if any non-public route lacks a permission tag.

Public routes (no auth required): `POST /auth/login`, `GET /api/v1/health`.

