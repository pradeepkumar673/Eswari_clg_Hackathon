# DisruptionIQ — DEMO.md

## Quick Start (< 3 minutes to running demo)

```bash
# 1. Start Mongo replica set (background daemon)
npm run db:start

# 2. Seed Scenario A calibrated data
npm run db:seed

# 3. Start API + Web concurrently
npm run dev

# 4. Open browser
# Frontend : http://localhost:5173
# API      : http://localhost:4000/health
```

## Demo Login Credentials (all password: Demo1234!)

| Role | Username | Display Name | Capabilities |
|------|----------|--------------|-------------|
| Analyst | analyst1 | Priya Sundaram | Intake, Investigation, Impact, Recovery |
| Manager | manager1 | Rajesh Krishnamurthy | All above + Approve, Execute |
| Procurement | procurement1 | Ananya Sharma | Approve plans > INR 5,000 |
| Warehouse Op | operator_blr | Karthik Nair | Warehouse view only |
| Admin | admin1 | Security Ops | Full access + red-team tools |

## Scenario A — Calibrated Numbers (Hackathon Judges)

| Metric | Value |
|--------|-------|
| Disruption | Chennai–Arakkonam rail flooding, +34h delay |
| Affected SKU | SKU-INS-100 (Insulin Cold Chain) |
| Impacted Orders | 4 Tier-1 hospital accounts |
| Baseline SLA Penalty | **INR 16,000** |
| Optimised Plan Cost | **INR 6,825** |
| Net Savings | **INR 9,175 (57% reduction)** |
| Solver Scope | Portfolio-level constrained optimisation |
| Guardrails | 4/4 PASS |
| Claims | 3/3 VERIFIED |
| Audit Chain | SHA-256 linked, tamper-detectable |
| Red-Team Score | 15/15 blocked (100% defense) |

## Automated Scenario Runner

```bash
npm run scenario:a
```

Outputs step-by-step proof of the full journey against live API.

## Red-Team Live Demo

```bash
npm run redteam
```

Shows 15 bypass attempts and confirms all blocked.

