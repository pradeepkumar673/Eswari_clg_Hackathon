# DisruptionIQ Design System & Brief (Impeccable)

## Product Context & Vision
DisruptionIQ is a high-trust, calm, precision operational "Control Tower" designed for supply-chain operations managers, inventory analysts, and procurement approvers dealing with high-stakes logistics disruptions.

## Key Design Principles
1. **Calm, Dense, High-Trust Utility**: Information density without visual chaos. Clear typography hierarchy, monospace accents for deterministic identifiers and numbers, muted borders, clean tabular data.
2. **Text + Colour Communication**: Never rely solely on color for status. Every severity or state is explicitly labeled with text and an accessible icon/chip (e.g. `RED` / Critical, `AMBER` / Warning, `GREEN` / Nominal, `APPLIED`, `DUPLICATE`, `STALE`, `CONFLICT`, `REJECTED`).
3. **Locale-Accurate Precision**:
   - Currency: Indian Rupee (`₹`, `en-IN` formatting, e.g. `₹1,25,000`).
   - Time: `Asia/Kolkata` time zone (IST UTC+5:30) with explicit offset indication or relative timestamps.
   - Multilingual affordances: Field reports and confirmation cards support English and Tamil (`தமிழ்`).
4. **Desktop-First with Phone Responsiveness**: Designed primarily for wide control tower desktop screens (1440px+), but completely responsive down to 390px mobile widths for floor operators.
5. **No Fake Data or AI Hallucinations**: Every metric, number, and status is tied directly to live REST APIs, verifiable audit ledger rows, and mathematical solver outputs. Loading, empty, and error states are first-class ciudadanos.

## Colour Palette & Tokens
- **Background**: Slate 950 (`#020617`), Surface Slate 900 (`#0f172a`), Surface Raised Slate 800 (`#1e293b`).
- **Borders**: Slate 800 (`#1e293b`) and Slate 700 (`#334155`).
- **Primary Accent**: Indigo 500 / Blue 500 for focused action and links.
- **Risk Bands**:
  - `RED`: Red 500 text, Red 950/60 bg, Red 800 border.
  - `AMBER`: Amber 400 text, Amber 950/60 bg, Amber 800 border.
  - `GREEN`: Emerald 400 text, Emerald 950/60 bg, Emerald 800 border.
- **Typography**:
  - Headings & UI: Inter / system sans-serif font stack.
  - Codes & Numbers: JetBrains Mono / Fira Code / monospace.

## Eight Authoritative Screens
1. **Sign-in** (`/login`): Clean authentication and demo role switcher.
2. **Operations Cockpit** (`/`): KPI strip, active disruptions, affected orders, pending approvals, recovery progress, conflicts, SPOF radar, alert feed, telemetry charts.
3. **Intake & Quarantine** (`/intake`): File upload, quarantine review, error fixing, carrier webhook simulator storm, paste ingestion.
4. **Disruption Investigation** (`/investigation`): Real-time shipment timeline, resolved ETA basis, conflict resolution, supplier scorecard, decision replay scrubber, voice/Tamil field report confirm card.
5. **Impact & Risk** (`/impact`): Order penalty exposure, factor waterfall, score ranges, evidence drawer.
6. **Recovery Workbench** (`/recovery`): Decision Contract, baseline vs plan, trade-off ledger, proof claims checker, submission.
7. **Approvals & Execution** (`/approvals`): Role-governed approval queue, delegations, conflict court, execution ledger trigger, customer notices.
8. **Audit & Security** (`/audit`): Cryptographic hash chain verification, before/after ledger, red-team bypass report, stress test controls.

