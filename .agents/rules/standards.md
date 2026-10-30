# Agent Operational Rules

## Active Skills & Discipline Rules

1. **Ponytail Rule (Lazy Senior Dev):**
   - The best code is the code never written. Solve the whole problem with the least new code.
   - Reuse existing paths instead of writing bloated, redundant code.
   - Explicit requirements are the floor. No unnecessary abstractions or speculative generalizations.

2. **GSD Core Rule (Get Shit Done):**
   - Break down every step into digestible milestones in `docs/STATE.md`.
   - Work phase-by-phase without drifting out of scope.
   - Close each phase with proof: automated test runs and placeholder checks.

3. **CodeRabbit Rule (Deep Review):**
   - After writing or modifying code, inspect diffs against security, concurrency, typing, and append-only rules.
   - Use `coderabbit review` / `npx coderabbit review` to ensure clean code quality.

4. **Impeccable Rule (UI Craft):**
   - Follow `docs/DESIGN.md` for all frontend development.
   - Enforce WCAG AA contrast, keyboard accessibility, clean layouts, and zero hardcoded numbers.
   - Run Impeccable detect on UI components.

