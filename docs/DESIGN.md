# DisruptionIQ Design System & Brief (Impeccable)

## Product Context & Vision
DisruptionIQ is a high-trust, calm, precision operational "Control Tower" designed for supply-chain operations managers, inventory analysts, and procurement approvers dealing with high-stakes logistics disruptions.

## Key Design Principles
1. **Bright, Crisp, High-Trust Utility**: Information density without visual clutter or dark "AI slab" heaviness. Clean light canvas, crisp white cards, refined borders, and tabular data designed for high daylight readability.
2. **Text + Colour Communication**: Never rely solely on color for status. Every severity or state is explicitly labeled with text and an accessible chip (e.g. `RED` / Critical, `AMBER` / Warning, `GREEN` / Nominal, `APPLIED`, `DUPLICATE`, `STALE`, `CONFLICT`, `REJECTED`).
3. **Locale-Accurate Precision**:
   - Currency: Indian Rupee (`INR`, `en-IN` formatting, e.g. `₹1,25,000`).
   - Time: `Asia/Kolkata` time zone (IST UTC+5:30) with explicit offset indication or relative timestamps.
   - Multilingual affordances: Field reports and confirmation cards support English and Tamil (`தமிழ்`).
4. **Desktop-First with Phone Responsiveness**: Designed primarily for wide control tower desktop screens (1440px+), but completely responsive down to 390px mobile widths for floor operators.
5. **No AI Slab Aesthetic**: Eliminates dark floating slabs, neon glowing boxes, and template card structures. Uses structured operational workspaces with clear hierarchy, authentic data tables, crisp toolbars, and tactile controls.
6. **No Fake Data or AI Hallucinations**: Every metric, number, and status is tied directly to live REST APIs, verifiable audit ledger rows, and mathematical solver outputs.

## Colour Palette & Tokens (Bright Enterprise System)
- **Canvas Background**: Slate 50 (`#f8fafc`).
- **Surface / Card Background**: Pure White (`#ffffff`).
- **Surface Muted / Table Header**: Slate 100/60 (`#f1f5f9`).
- **Borders & Dividers**: Slate 200 (`#e2e8f0`) and Slate 300 (`#cbd5e1`).
- **Text Hierarchy**:
  - Headings & Titles: Slate 900 (`#0f172a`).
  - Body & Data: Slate 700 (`#334155`).
  - Secondary & Metadata: Slate 500 (`#64748b`).
- **Primary Accent**: Indigo 600 (`#4f46e5`) hover Indigo 700 (`#4338ca`).
- **Status & Risk Chips (Accessible Tinted Badges)**:
  - `RED` / Critical / Breach / Rejected: Rose 50 bg (`#fff1f2`), Rose 700 text (`#be123c`), Rose 200 border (`#fecdd3`).
  - `AMBER` / Warning / Held / Stale: Amber 50 bg (`#fffbeb`), Amber 800 text (`#92400e`), Amber 200 border (`#fde68a`).
  - `GREEN` / Nominal / Pass / Applied: Emerald 50 bg (`#ecfdf5`), Emerald 700 text (`#047857`), Emerald 200 border (`#a7f3d0`).
  - `BLUE` / In-Progress / Info: Blue 50 bg (`#eff6ff`), Blue 700 text (`#1d4ed8`), Blue 200 border (`#bfdbfe`).
- **Typography**:
  - UI Stack: Inter / -apple-system / BlinkMacSystemFont / 'Segoe UI' / sans-serif.
  - Codes & Numbers: JetBrains Mono / SFMono-Regular / Menlo / monospace (tabular-nums).

## Eight Authoritative Screens
1. **Sign-in** (`/login`): Clean authentication and demo role switcher on bright white card.
2. **Operations Cockpit** (`/`): KPI strip, active disruptions, affected orders, pending approvals, recovery progress, conflicts, SPOF radar, alert feed, telemetry charts.
3. **Intake & Quarantine** (`/intake`): File upload, quarantine review, error fixing, carrier webhook simulator storm, paste ingestion.
4. **Disruption Investigation** (`/investigation`): Real-time shipment timeline, resolved ETA basis, conflict resolution, supplier scorecard, decision replay scrubber, voice/Tamil field report confirm card.
5. **Impact & Risk** (`/impact`): Order penalty exposure, factor waterfall, score ranges, evidence drawer.
6. **Recovery Workbench** (`/recovery`): Decision Contract, baseline vs plan, trade-off ledger, proof claims checker, submission.
7. **Approvals & Execution** (`/approvals`): Role-governed approval queue, delegations, conflict court, execution ledger trigger, customer notices.
8. **Audit & Security** (`/audit`): Cryptographic hash chain verification, before/after ledger, red-team bypass report, stress test controls.
