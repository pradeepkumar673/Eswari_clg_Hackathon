# DisruptionIQ Verified Recovery Desk

High-trust, verified supply chain disruption recovery control tower with mathematical proof checking and governed approvals. Built for college hackathons & industrial supply chain resiliency.

---

## Architecture Overview

```
DisruptionIQ Monorepo
├── apps/
│   ├── api/            Node.js + Express + TypeScript + MongoDB (Replica Set rs0)
│   └── web/            React 18 + Vite + Tailwind CSS + Lucide + ReactFlow
├── packages/
│   └── shared/         Shared Zod schemas, role-permission matrix, domain types
├── services/
│   └── solver/         Python FastAPI + Google OR-Tools CP-SAT (Linear Optimizer)
├── scripts/            Automated scenario runners, red-team matrix, stress injectors
└── docs/               Blueprint, hardening guide, judge Q&A, demo runbooks
```

---

## Key Features

1. **Belief-ETA Reconciler (M2)**: Multi-source trust hierarchy (Carrier IoT, Driver Voice, Supplier Portal) resolving conflicting telemetry with mathematical tolerance.
2. **Deterministic Impact Engine (M3)**: Walks bill-of-materials and order graph to compute priority and SLA penalties across customer tiers.
3. **OR-Tools CP-SAT Solver (M4)**: Discovers optimal multi-echelon transfer routes, expedited orders, and inventory re-allocations in < 850 ms.
4. **Deterministic Proof Checker & Decision Contract (M5, W2)**: 4 hard physical guardrails preventing conservation of mass violations and infeasible lead-times before any human review.
5. **Governed Dual-Role Approvals (M6)**: Cryptographically audited separation of duties (Manager + Procurement above INR 5,000 threshold; self-approval prohibited).
6. **Double-Booking Shield & Conflict Court (S1, S2, A4)**: ACID-isolated allocations preventing race conditions, with side-by-side arbitration for competing disruptions.
7. **Tamper-Evident SHA-256 Audit Chain (B17)**: Merkle-style cryptographically linked audit trail with built-in tamper detection and one-click verification.
8. **Bilingual Voice & Text Intake (W1, B15)**: Browser Web Speech API supporting Tanglish (Tamil + English) with offline regex fallback.

---

## Calibrated Scenario A Demo Numbers

- **Disruption**: Chennai–Arakkonam rail corridor flooding (+34h delay)
- **Affected SKU**: `SKU-INS-100` (Insulin Cold Chain)
- **Impacted Orders**: 4 Tier-1 hospital accounts (Apollo Greams, Fortis Malar, MIOT, Kauvery)
- **Baseline SLA Penalty**: **INR 16,000**
- **Optimised Plan Cost**: **INR 6,825**
- **Net Avoided Penalty / Savings**: **INR 9,175 (57.3% reduction)**
- **Solver Scope**: Portfolio-level constrained optimisation

---

## Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **Python**: 3.10+
- **MongoDB**: 7.0+ or 8.0+ running as single-node replica set `rs0` on port 27017

### 2. Install & Start Services
```bash
# Install NPM dependencies
npm install

# Start local MongoDB replica set (if not already running)
npm run db:start

# Seed calibrated Scenario A & B data
npm run db:seed

# Optional: Setup Python solver virtual environment
cd services/solver
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1 | Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
cd ../..

# Start all three services concurrently (API, Web, Solver)
npm run dev
```

- **Frontend**: http://localhost:5173 (or :3000)
- **Backend API**: http://localhost:4000
- **FastAPI Solver**: http://localhost:8000/docs

---

## Demo Credentials (Password: `Demo1234!`)

| Role | Username | Display Name | Key Scope |
|------|----------|--------------|-----------|
| **Analyst** | `analyst1` | Priya Sundaram | Intake, Investigation, Impact, Plan generation |
| **Operations Manager** | `manager1` | Rajesh Krishnamurthy | All above + Approve, Confirm & Execute, Rollback |
| **Procurement Lead** | `procurement1` | Ananya Sharma | Mandatory co-signoff on plans > INR 5,000 |
| **Warehouse Operator** | `operator_blr` | Karthik Nair | Warehouse-scoped intake & mobile view |
| **Security Admin** | `admin1` | Security Ops | System settings, red-team tools, tamper demo |

---

## CLI Commands & Scenario Runners

| Command | Purpose |
|---------|---------|
| `npm run scenario:a` | Runs the full 10-step Scenario A journey end-to-end against live API |
| `npm run redteam` | Executes 15-vector adversarial security attack suite (100% blocked) |
| `npm run stress` | Runs 5 chaos stress injectors (burst webhooks, concurrent approvals) |
| `npm run metrics` | Computes and displays honest operational & governance metrics |
| `npm run demo:reset` | Resets database to pre-disruption clean demo state |
| `npm run demo:warm` | Pre-warms LLM cache or verifies deterministic fallback |
| `npm run scan:placeholders` | Verifies zero forbidden placeholder text across the codebase |
| `npm run typecheck` | Full TypeScript compiler validation across monorepo |

---

## Troubleshooting

1. **MongoDB Replica Set**: DisruptionIQ requires replica set transactions for ACID allocation locks. If MongoDB fails to connect with `replicaSet=rs0`, run `npm run db:start` or ensure your mongod service is started with `--replSet rs0`.
2. **Ports**: Ensure ports `27017` (Mongo), `4000` (API), `5173` (Web), and `8000` (Solver) are open.
3. **No External LLM API Key**: No problem! The application has 100% deterministic rule-based fallbacks for voice and text ingestion, and all core logic is entirely local.
