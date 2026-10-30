# DisruptionIQ Verified Recovery Desk — Extensions

_Authoritative Extension Integration Guide — Updated 2026-10-30_

---

## 1. Impeccable (Installed & Active)

**Location:** `.agent/skills/impeccable/`  
**CLI Engine:** `.agent/skills/impeccable/scripts/bin/windows-x64/impeccable.exe`  
**Capabilities:**
- `impeccable detect [file-or-dir-or-url...]`: Scans for UI anti-patterns, design quality issues, and visual regressions.
- Antigravity Skill integration: Full skill suite with reference guides for audit, polish, clarify, distill, layout, and contrast.

**Our Step Routine:**
1. **Design-Brief Setup (Step 13):** Run Impeccable init/brief routine and create `docs/DESIGN.md`.
2. **Frontend Build (Steps 5, 22–26):** Execute UI design against the established design brief.
3. **Impeccable Audit Pass:** Run `& ".agent/skills/impeccable/scripts/bin/windows-x64/impeccable.exe" detect apps/web` before closing every UI step and fix all findings.

---

## 2. CodeRabbit (Installed & Active via npx)

**CLI:** `npx coderabbit review`  
**Capabilities:**
- Reviews working uncommitted diffs for security, race conditions, error handling gaps, and typing.
- Generates structured findings for agent triage (`--agent`).

**Our Step Routine:**
- At every Step Close Routine: execute `npx coderabbit review` on the working changes, resolve actionable items, and log any intentional exclusions in the commit message.

---

## 3. GSD Mission Control (Active)

**Role:** Systematic milestone tracking, sub-task execution control, and blocker management.
**Routine:** Every step establishes a checklist in `docs/STATE.md`, tracks sub-tasks, ensures `KNOWN ISSUES` is clean, and marks `STEP N: PASS` upon verification.

---

## 4. StitchMCP (Installed & Active)

**Role:** Design system generation and UI screen scaffolding MCP server.
**Routine:** Used for generating and refining UI layouts in Steps 22–26, connecting them directly to live API data.
