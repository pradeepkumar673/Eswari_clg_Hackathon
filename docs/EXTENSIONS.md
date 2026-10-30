# DisruptionIQ Verified Recovery Desk — Extensions

_Authoritative Extension Integration Guide — Updated 2026-10-30_

---

## Overview

The 4 core project extensions (**CodeRabbit**, **Impeccable**, **GSD Mission Control**, and **Ponytail**) are active in our workspace environment. In accordance with `docs/RULES.md` and the Step Close Routine, they are directly executed and integrated into every step workflow as specified below:

---

## 1. CodeRabbit (Automated Code Review & Diff Audit)

**Role:** High-rigour pre-commit code review engine checking for:
- Security vulnerabilities (injection, auth bypasses, leaked secrets)
- Concurrency & race condition risks (Mongo transaction boundaries, lock order)
- Error handling integrity (no unhandled rejections, typed error responses)
- Strict compliance with append-only rules (`shipment_events`, `audit_logs`, `execution_ledger`)

**Our Routine in Every Step:**
1. At Step Close, run CodeRabbit review on the working diff (`git diff HEAD`).
2. Triage every finding:
   - Actionable findings: Fixed immediately before commit.
   - Non-actionable or intentional deviations: Logged explicitly with reasoning in the commit message trailer (`Review: ...`).

---

## 2. Impeccable (Craft, Design Brief & UI Critique)

**Role:** Production-grade frontend craft and UI audit engine ensuring clean, calm, high-density operations UI.

**Our Routine:**
1. **Design-Brief Setup (Step 5):** Establishes the authoritative design brief in `docs/DESIGN.md` (calm control tower, INR currency formatting `₹`, Asia/Kolkata timestamps, WCAG AA compliance, dark/light theme).
2. **Component Craft (Steps 5, 22–26):** Builds UI components using clean token hierarchies and strict empty/loading/error state patterns.
3. **Impeccable Polish Pass (before closing any UI step):**
   - Color contrast checks (WCAG AA).
   - Visible keyboard navigation focus rings.
   - Layout responsiveness across desktop and mobile (390 px).
   - Zero hardcoded numbers or strings (verified via `scan:placeholders`).

---

## 3. GSD Mission Control (Step Task & Milestone Engine)

**Role:** Systematic milestone tracking, sub-task execution control, and blocker management.

**Our Routine in Every Step:**
1. **Step Inception:** Establish a dedicated mission for the step in `docs/STATE.md` with explicit task checklists mirroring the step prompt.
2. **Active Execution:** Mark sub-tasks done `[x]` as they complete.
3. **Step Close:**
   - Verify that all mission criteria are satisfied.
   - Ensure `KNOWN ISSUES` is completely empty.
   - Update `docs/STATE.md` with `STEP N: PASS` and initialize tasks for Step N+1.

---

## 4. Ponytail (Step Execution Workflow Accelerator)

**Role:** Workflow automation engine handling repetitive step scaffolding, test pipeline chaining, environment checks, and workspace hygiene.

**Our Routine in Every Step:**
1. Automates the transition between steps (validating prerequisite step status).
2. Runs the multi-suite verification pipeline (`npm run test`, `npm run scan:placeholders`, and service health checks).
3. Maintains file integrity and directory structure across step executions.

---

## 5. StitchMCP (UI Layouts & Design Tokens)

**Role:** Integrated design system and screen layout scaffolding MCP server.

**Our Routine:**
- Generates wireframes and component variants for complex dashboard views in Steps 22–26.
- All StitchMCP layouts are immediately wired to live backend API contracts with zero placeholder data.
