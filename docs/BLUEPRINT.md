# DisruptionIQ Verified Recovery Desk: Final Blueprint

*PS 1: From Delivery Delays to Recovery Plans · 48-hour web MVP · 30 October 2026*

**Assumptions used** (the context fields were blank): 48 hours, a team of four, web app only, free tools, a limited LLM budget (Groq free tier), and a demo that must survive weak Wi-Fi, so it runs locally with Docker Compose. With a smaller team, merge owners C and D in section 15.

**Update:** this version adds the 12 selected add-on features (A1 to A12). They are specified in the sections they touch (7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19 and 20). Every add-on is deterministic code on the same linked data, and none of them changes the core loop or the must-build scope.

**Update 2:** this version also adds 18 micro-features (B1 to B18). They cover the generic control-tower patterns that most teams build (KPI cards, a map, an alert feed, a chatbot, risk bands, late-shipment and stock detectors, a supplier tracker, an approval inbox, a CRUD admin, import charts, recommendation cards, forecasting, what-if simulation, email ingestion, an operator mobile view, provenance and customer notices). Here each one is a thin, deterministic layer over the same linked data, so it strengthens the verified loop instead of diluting it. They are tiered by build cost (section 7a), mapped to the generic patterns they replace (section 7b), and cut before any A add-on (section 15). Section 7a also lists the rules they must follow.

## 1. Final product name

**DisruptionIQ Verified Recovery Desk**

*The AI proposes. The code proves. Humans decide. The ledger remembers.*

## 2. One-line pitch

A verified recovery desk that turns messy, multilingual disruption reports into portfolio-level recovery plans, blocks unsupported AI claims with database evidence, enforces human approval, and records reversible execution.

## 3. Problem in one sentence

Delay news arrives from carriers, suppliers, warehouses and order systems that disagree, so teams cannot quickly tell which customer orders are hurt, how badly, and which recovery is actually feasible.

## 4. Hidden insight in one sentence

Recovery options compete for the same scarce stock, so fixing orders one at a time silently breaks others, and an AI that cannot be checked against real inventory will eventually invent stock.

## 5. Solution in one sentence

We reconcile every event into one trusted shipment state, trace it to orders, solve one constrained allocation across all affected orders, verify every claim in the plan against the database, and only then let a different, authorised human approve a reservation-backed, reversible simulated execution.

## 6. Complete user journey

| # | Actor | What happens | Guarantee |
| --- | --- | --- | --- |
| 1 | Any user | Signs in; the JWT carries the role. The cockpit shows active disruptions, at-risk orders, pending approvals and recovery progress. | Permissions are loaded from the role on every request. |
| 2 | Warehouse Operator, Analyst, carrier | A problem is reported by Tanglish voice, CSV/JSON upload, or the simulated carrier webhook. | Raw input is stored untouched. |
| 3 | AI and operator | The transcript becomes an event card: shipment, warehouse, damaged units, delay, confidence. The operator edits and confirms. | Nothing becomes an event until a human confirms. |
| 4 | Reconciler | The event enters an append-only store. Duplicates are ignored, stale events are kept as history, material conflicts become a review card. | The resolved ETA always has lineage and a stated reason. |
| 5 | Impact engine | Walks shipment → destination warehouse → inventory → dependent orders and opens a disruption. | Deterministic query over linked tables. |
| 6 | Risk engine | Scores each affected order 0–100 with a factor waterfall, evidence links and a best/worst-case range. | The formula is visible policy, not ML. |
| 7 | Analyst | Presses Generate Recovery Plan. Candidates are enumerated from real stock, transfer lanes and supplier capacity; the solver picks one portfolio; the screen shows baseline vs plan and collateral damage. | The LLM never does inventory arithmetic. |
| 8 | Proof checker | Every claim and action is checked against the database. A failed claim blocks submission and shows expected vs actual. | Only VERIFIED plans can proceed. |
| 9 | Analyst, then approvers | Submit places stock reservations and freezes a Decision Contract. Each required role approves, rejects or modifies; any modification re-verifies. | Proposer and modifiers can never approve. |
| 10 | Supply Chain Manager | Confirms execution; simulated stock movements go to the ledger; notifications and an audit entry are written. | Execution only after approval plus explicit confirmation. |
| 11 | Supply Chain Manager | Tracks recovery progress; may roll back through compensating ledger entries. | Rollback restores exact balances or is blocked with a reason. |

### 6a. Where the 12 add-ons plug into the journey

| Journey step | Add-ons that attach | What they add |
| --- | --- | --- |
| 1. Sign in and cockpit | A1, A12, A10 | The bell opens the simulated email/WhatsApp inbox; the radar tile shows single points of failure before anything breaks; fingerprint warnings appear. |
| 2 to 4. Intake and reconcile | A11, A5 | Stress-Test Mode can inject chaos at intake; every reconciler decision becomes a replay step. |
| 5. Impact | A8, A10 | Click any affected order to see its causal lineage; a matching root-cause fingerprint is shown. |
| 6. Risk | A7 | Each affected order gets original promise date, best recoverable date and a proposed committed date. |
| 7. Recovery plan | A2, A3, A6, A7 | Feasible routes feed the solver; the trade-off ledger shows who each fix hurts; the closest past case is shown; promise dates are repaired. |
| 8. Proof checker | A9 | Guardrails are checked next to the claims; routes and promise dates add two claim types. |
| 9. Submit and approve | A4, A9, A1 | Competing plans go to the Allocation Conflict Court; a guardrail breach escalates; notifications fire. |
| 10 and 11. Execute, track, roll back | A1, A5, A6 | Status-change notifications; the replay timeline; closing the disruption stores a playbook case. |

### 6b. Where the 18 micro-features plug into the journey

| Journey step | Micro-features that attach | What they add |
| --- | --- | --- |
| 1. Sign in and cockpit | B1, B2, B3, B4, B16 | KPI cards, a static network map and a deduplicated alert feed on the cockpit; Ask the Desk answers read-only questions; operators get a phone-width view of their own warehouse. |
| 2 to 4. Intake and reconcile | B11, B15, B16, B6, B7 | Import quality report with file-level idempotency; pasted emails and texts become the same confirm-first event card as voice; the late-shipment detector and stock alerts run after every applied event. |
| 5. Impact | B2, B6, B7 | The map highlights the delayed shipment and the warehouse it feeds; the detector and stock alerts open or refresh the disruption through the normal impact path. |
| 6. Risk | B5, B8, B13 | Red, amber and green bands over the same score; a supplier scorecard beside each delay; days of cover and ETA drift shown as labelled projections. |
| 7. Recovery plan | B12, B14 | Each action appears as a recommendation card with its feasibility checklist; the what-if simulator tries a different delay or stock level without touching real data. |
| 8. Proof checker | B4, B12, B18 | Two new claim types (ANSWER\_FACT and NOTICE\_DATE\_MATCHES); a card cannot say Feasible unless its claims pass. |
| 9. Submit and approve | B9, B18 | Delegation and request-changes in the approval inbox; customer notice drafts are prepared from the committed dates. |
| 10 and 11. Execute, track, roll back | B10, B17, B18 | Inventory corrections go through the ledger; every audit and ledger row joins a hash chain; the Manager releases customer notices. |

## 7. Final feature list

| ID | Tier | Feature | Done means |
| --- | --- | --- | --- |
| M1 | Must-build | Linked data and intake | Five linked entities; CSV/JSON import with row-level quarantine and repair; simulated carrier webhook; seeded data. |
| M2 | Must-build | Belief-ETA Reconciler | Idempotency key, stale detection, source-trust conflict rule, resolved ETA with lineage. |
| M3 | Must-build | Impact engine and risk waterfall | Correct affected orders; score with factor breakdown, source-row links and a score range from best/worst ETA. |
| M4 | Must-build | Portfolio Recovery Solver | One constrained allocation across all affected orders; baseline vs plan; collateral-damage panel. |
| M5 | Must-build | Proof-carrying recommendations | Every claim checked against the DB; Decision Contract frozen at submit; failed claim blocks approval. |
| M6 | Must-build | Governed approvals | Backend RBAC; approve, reject, modify; plan versioning; separation of duties. |
| M7 | Must-build | Mandatory plumbing | Audit trail, in-app notifications, cockpit dashboard (disruptions, orders, approvals, recovery progress). |
| S1 | Should-build | Double-Booking Shield | Transactional reservations; two competing approvals cannot oversubscribe stock. |
| S2 | Should-build | Reversible Execution Ledger | Before/after stock per action; rollback by compensating entries. |
| S3 | Should-build | Red-Team Button | One click runs about 12 bypass attempts against the API and shows each blocked and logged. |
| W1 | Wow-feature | Tanglish Voice-to-Event | Mic input, editable transcript, one-click sample transcript, rule-based fallback extractor. |
| W2 | Wow-feature | Challenge Plan | Injects a false stock claim live; the proof checker visibly rejects it. |
| A1 | Add-on | Email/WhatsApp-Style Notification Simulator | Simulated inbox (nothing leaves the machine) with five triggers: new disruption, pending approval, approval decision, escalation, recovery-status change. Each message deep-links to its order, disruption or approval task. |
| A2 | Add-on | Route-Optimization Demo | For affected shipments, shows feasible direct, via-warehouse and expedited options on a lane diagram with lead time, cost and distance. Options feed the solver as candidates; the focus stays on downstream order impact. |
| A3 | Add-on | Recovery Trade-off Ledger | Every plan action lists what it saves and which orders, customers, warehouses or suppliers it hurts, for example “Reallocation saves ORD-A but delays ORD-B and ORD-C by 2 days”. Totals reconcile with the collateral panel. |
| A4 | Add-on | Allocation Conflict Court | When two plans claim the same limited stock, both claims, priorities, deadlines, penalties and consequences are shown side by side, and an explicit winner is required. No stock is double-allocated. |
| A5 | Add-on | Decision Replay Timeline | A scrubbable replay of one disruption: webhook received, duplicate ignored, conflict resolved, risk recalculated, action proposed, modified, approved, simulated. Each step links to its audit row and reason. |
| A6 | Add-on | Recovery Playbook Memory | Closing a disruption stores what was tried, what worked, what failed and why. A new disruption retrieves the closest past case and shows its insight, for example “Last time, splitting the order reduced late orders but increased freight cost.” |
| A7 | Add-on | Promise-Date Repair Engine | For each affected order shows the original promise date, the best recoverable date and the committed date, calculated from stock, inbound shipments, transfer time, supplier lead time and processing time. |
| A8 | Add-on | Event Lineage Graph | Click any affected order to see supplier delay, delayed shipment, warehouse shortage and affected order as a chain. Each edge shows its evidence, timestamp and calculation. |
| A9 | Add-on | Recovery Budget Guardrail | Limits for expedite spend, service-level damage, supplier risk and transfer distance. A plan that exceeds a limit is escalated automatically and cannot proceed on the normal path. |
| A10 | Add-on | Root-Cause Fingerprinting | Groups disruptions by recurring pattern (for example “Supplier X delays after festival demand”) and warns when a similar fingerprint appears, including on a precursor signal. |
| A11 | Add-on | Stress-Test Mode | Judges inject duplicate webhooks, invalid CSV rows, conflicting ETAs, simultaneous supplier failures or sudden inventory corrections; the system stays stable and reports exactly what it quarantined or rejected. |
| A12 | Add-on | Single-Point-of-Failure Radar | Continuously ranks suppliers, warehouses, SKUs and lanes where one failure would hit many orders, and flags them before any disruption happens. |

**Add-on rules:** work on A1 to A12 starts only after the hour-25 checkpoint (Scenario A runs from event to plan). Add-ons are never allowed to weaken M1 to M6, S1 or S2. If time runs short, cut add-ons in the order given in section 15.

### 7a. Micro-feature list (B1 to B18)

Build tiers: **Cheap** is about 1 hour and mostly a read-only view; **Medium** is 2 to 3 hours; **Stretch** is built only if everything else is green.

| ID | Tier | Micro-feature | Done means |
| --- | --- | --- | --- |
| B1 | Cheap | KPI Strip | Cockpit cards for shipments in transit, delayed shipments, items below threshold, open orders, at-risk orders and penalty exposure. Each number is one SQL count; clicking a card opens the filtered list with the same count. |
| B2 | Medium | Network Map | A static SVG map (no map tiles, works offline) of warehouses, suppliers and transfer lanes using seeded coordinates. Delayed shipments and the warehouses they feed are highlighted; clicking a node lists the orders behind it. |
| B3 | Cheap | Control-Tower Alert Feed | One feed of LATE\_SHIPMENT, BELOW\_THRESHOLD, PROJECTED\_SHORTAGE, CONFLICT, GUARDRAIL and SPOF alerts with a severity. One alert per distinct condition, never repeated; each deep-links to its screen. Three Recharts charts: penalty exposure by order, open disruptions by type, import quality. |
| B4 | Medium | Ask the Desk | A read-only question box with chips such as “Which orders are affected?” and “Summarise today’s disruptions”. Fixed intents map to parameterised queries; every number in an answer is checked as an ANSWER\_FACT claim; any request to change something is refused and logged. |
| B5 | Cheap | Risk Bands | A red, amber or green chip over the existing 0 to 100 score (defaults 70 and 40, Manager-configurable). The chip always opens the factor waterfall and evidence, and a band never appears without its score range. A heat grid shows orders by factor. |
| B6 | Cheap | Late-Shipment Detector | Compares promised\_eta with the reconciled ETA (or with the clock when nothing has arrived). Beyond the grace period (default 60 minutes) it raises one alert and opens or refreshes one disruption through the normal impact path. |
| B7 | Cheap | Stock-Shortage Alerts | BELOW\_THRESHOLD when free stock falls under a per-warehouse, per-SKU minimum, and PROJECTED\_SHORTAGE when stock plus reconciled inbound cannot cover the orders due inside the horizon. |
| B8 | Cheap | Supplier Delay Scorecard | On-time rate, average delay hours and open delayed shipments per supplier, recomputed from shipments and events fed by CSV, webhook, voice or text. Display only: it never changes the seeded supplier risk score. |
| B9 | Medium | Approval Inbox: Delegate and Request Changes | On top of approve, reject and modify: delegate to another user of the same role for a time window, or return the plan with a comment (the version increments and earlier approvals become invalid). Separation of duties applies to every delegate. |
| B10 | Medium | Master Data Admin | Create, edit and deactivate suppliers, warehouses, SKUs, lanes, supplier capacity and orders with Zod validation. No hard deletes; stock quantities change only through audited inventory corrections. |
| B11 | Cheap | Import Quality Report | After each import: counts of valid, repaired, quarantined, duplicate and conflicting rows, a chart of error reasons, a file hash so the same file is not loaded twice, and natural-key handling for duplicate and conflicting rows. |
| B12 | Cheap | Recommendation Cards | Every plan action shown as a card (reallocate, expedite, alternative supplier, split) with cost, benefit, a trade-off link and a feasibility checklist (stock, lead time, capacity, deadline). A card shows Feasible only if its claims pass. |
| B13 | Medium | Cover and Drift Projection | Days of cover per warehouse and SKU, and an ETA drift hint after three or more ETA revisions. Deterministic arithmetic, labelled projection, never an input to risk or the solver. No ML model. |
| B14 | Medium | What-If Simulator | Sliders for delay hours, damaged units, lane lead time, supplier capacity and a stock correction. Runs the real impact logic and solver on an in-memory copy and shows affected orders, baseline vs plan, approvals needed and guardrail results, marked SIMULATION. Changes no real rows and cannot be submitted. |
| B15 | Medium | Email and Text Ingestion | Paste an email, SMS or portal message. A rule-based extractor (optional Groq) proposes the same confirm-first event card as voice. Confirmed events go through the reconciler, so a message that disagrees with the carrier creates a CONFLICT card and does not silently win. |
| B16 | Stretch | Operator Phone View | A responsive layout for the Warehouse Operator (own warehouse only): field report, confirm card, inbound shipments and notifications. Reports drafted without a connection wait in a browser queue and submit when it returns. Not a native app and no PWA install. |
| B17 | Medium | Tamper-Evident Provenance Chain | Each audit and ledger row stores prev\_hash and row\_hash (SHA-256). A Verify chain button recomputes the chain and names the first broken row. Provenance without blockchain: no tokens, no consensus. |
| B18 | Stretch | Customer Notice Drafts | For each affected order a customer-facing message is drafted from the approved committed date (split orders show both dates). Staff only: the Manager releases it to the simulated outbox after approval. No customer portal and no customer login. |

**Micro-feature rules:**

- Work on B1 to B18 starts only after the hour-25 checkpoint, and a Medium or Stretch item starts only after the core piece or A add-on it sits on is done.
- Every B item is either read-only over core data or writes only through a governed path that already exists (events, inventory corrections, approvals, audit). No B item writes stock directly.
- B13 and B14 never feed the risk score, the solver or any plan. B8 never changes a supplier risk score.
- Honest labels are part of the feature: projection, simulation, draft, simulated outbox.
- B items are cut before any A add-on, and never weaken M1 to M6, S1 or S2.

### 7b. Coverage map: generic patterns and where they live here

| Generic pattern | Where it lives | Why ours is different |
| --- | --- | --- |
| Logistics dashboard with KPI cards | B1 on the cockpit (M7) | Every card is a count over the linked tables and opens its list. |
| Map of warehouses, suppliers, routes and delayed shipments | B2 | Offline SVG; clicking a node shows the orders behind it. |
| AI control tower with alerts and charts | B3 | Alerts are deduplicated by condition and deep-link to the decision screen. |
| LLM chatbot for affected orders and disruption summaries | B4 | Read-only; every number is proven against the database. |
| Red, amber and green risk dashboard | B5 on M3 | The band always opens the factor waterfall and evidence. |
| Late-shipment detector (promised vs actual) | B6 | Uses the reconciled ETA, not one raw source, and feeds the impact engine. |
| Stock-shortage alert below a threshold | B7 | Adds a projected shortage against real orders, not only a threshold. |
| Supplier-delay tracker fed by CSV or webhook | B8 | Fed by the same reconciled events as everything else. |
| Email or WhatsApp-style notification simulator | A1 (already built in), extended by B9 and B18 | Two new triggers: delegation received and customer notice released. |
| Approval inbox with approve and reject | M6, extended by B9 | Adds modify, delegate and request changes, all under separation of duties. |
| CRUD admin for suppliers, warehouses, inventory and orders | B10 | Stock changes only through audited corrections; no hard deletes. |
| CSV upload plus charts | M1, extended by B11 | Validation, duplicate handling, conflict handling and a quality report. |
| Recommendation cards (reallocate, expedite, alternative supplier, split) | B12 | A card cannot claim feasibility without passing its checks. |
| Forecasting module | B13 | Deterministic cover and drift arithmetic, labelled as projection, no ML. |
| Route-optimisation demo | A2 (already built in) | Small seeded-lane options that feed the solver. |
| Digital twin or what-if slider | B14 | Runs the real solver and ends in concrete orders and approvers, never in a state change. |
| Document or email ingestion | B15 | Extracted claims go through the reconciler, so conflicts are caught. |
| Mobile app for warehouse operators | B16 | Role-scoped responsive view with a draft queue; confirm-first. |
| Blockchain or provenance feature | B17 | A hash chain tied to the actual audit and ledger tables, with a working Verify button. |
| Customer-facing delay-notification portal | B18 | Internal drafts released by a Manager; the product stays an operations tool. |

## 8. Exact MVP scope

**Seed data:** 3 warehouses (WH-HOS Hosur, WH-CHN Chennai, WH-BLR Bengaluru), 4 suppliers, 10 SKUs, 18 shipments, 20 orders, 5 users (one per role, plus a second Manager and a second Procurement Approver so B9 delegation can be shown). The schema supports more; the demo stays small and controlled.

**Scenario A, Hosur damage and delay (the main demo):**

| Item | Value |
| --- | --- |
| Stock | WH-HOS holds 20 units of SKU-101 |
| Inbound | SHP-204 from SUP-1: 170 units, ETA tomorrow 10:00 |
| Field report | 70 units damaged, 2 hours late: 100 usable units, ETA 12:00 |
| ORD-1042 | 80 units, due tomorrow 14:00, ₹500 per unit short, priority 5 |
| ORD-1047 | 60 units, due tomorrow 18:00, ₹300 per unit short, priority 3 |
| ORD-1051 | 50 units, due in 48 hours, ₹200 per unit short, priority 2 |
| Demand vs supply | 190 needed, 120 available, 70 short |
| Transfer option | WH-CHN: 15 free units, 5 h lane, ₹35 per unit |
| Transfer option | WH-BLR: 10 free units, 3 h lane, ₹50 per unit |
| Alternative supplier | SUP-2: qualified, 40 units, 36 h lead, ₹120 per unit |
| Expected result | Baseline penalty ₹16,000. Plan cost ₹5,825 plus residual penalty ₹1,000 = ₹6,825. Saving ₹9,175 (57%). ORD-1051 becomes a split order: 45 on time, 5 backordered. |

These figures are seeded so the solver gives a clear result. Always show what the engine computes, and confirm it against a brute-force check in a unit test.

**Scenario B, event storm:** webhook EVT-2001 for SHP-310 arrives 5 times; an older EVT-1999 ETA arrives afterwards; the carrier ETA (16:00) and the supplier-portal ETA (01:00 next day) differ by 9 hours against a 4-hour tolerance, which raises a conflict card.

**Add-on seed data:**

| Item | Value |
| --- | --- |
| Historical cases | 12 resolved past disruptions (marked SEEDED) used by A6 and A10. Closest to Scenario A: a past SUP-1 damage-and-delay case at WH-HOS during a festival-peak window, where splitting the order cut late orders but raised freight cost. |
| Fingerprints | F1 “SUP-1 delays in festival-peak windows” (4 cases); F2 “WH-CHN shortages follow inbound delays” (3 cases); F3 “Carrier scan gaps on the CHN to HOS lane” (3 cases). |
| Guardrail defaults | Expedite and alternative-sourcing spend at most ₹6,000; residual penalty at most ₹2,500 and no order with more than 20% of its units backordered; supplier risk score at most 50 (SUP-2 is seeded at 35); transfer distance at most 400 km. Seeded so Scenarios A and B pass; the demo tightens one limit live. |
| Route options | Direct lanes from the seeded transfer table, plus one via-warehouse path and one expedited option for SHP-204, each with lead time, cost and distance. |
| Processing time | 2 hours per warehouse (configurable), used by the Promise-Date Repair Engine. |
| Single-point-of-failure seed | SUP-1 as the only qualified source of SKU-101 into WH-HOS, which feeds the three Scenario A orders. |
| Allocation conflict seed | A second plan, seeded in the Admin reset, that also wants WH-BLR’s 10 free units of SKU-101. |

**Micro-feature seed data:**

| Item | Value |
| --- | --- |
| Promised and actual times | Every shipment gets promised\_eta. SHP-204 is promised tomorrow 10:00; after the field report its resolved ETA is 12:00, so it is 120 minutes late against the 60-minute grace. At least three of the 18 seeded shipments per supplier are DELIVERED with an actual\_arrival\_at so scorecards are defined; SUP-1 is seeded below 70% on time and SUP-2 above 90%. |
| Stock thresholds | SKU-101 at WH-HOS minimum 30 (free stock 20); SKU-205 at WH-CHN minimum 15 (stock 10); every other warehouse and SKU pair sits above its minimum. Horizon 72 hours. |
| Risk bands | RED at 70 and above, AMBER 40 to 69, GREEN below 40. |
| Ask the Desk | Five seeded intents (affected orders, today’s disruptions, items below threshold, supplier delays, pending approvals) plus one write-intent question (“approve the plan”) used to prove refusal. |
| Sample messages | Three for B15: a supplier email giving SHP-310 an ETA of 01:00 tomorrow (conflicts with the carrier’s 16:00, which is the Scenario B conflict), an exact duplicate of that email, and an SMS naming an unknown shipment SHP-999. |
| Delegation users | A second Manager and a second Procurement Approver. |
| Map coordinates | Each warehouse and supplier gets map\_x and map\_y between 0 and 1000. |
| Customer notice templates | Two: ON\_TIME\_RECOVERY and SPLIT\_ORDER, with placeholders for order code, committed date and backordered units. |
| Tamper seed | The Admin demo reset includes a Tamper one audit row action that edits a row with a direct SQL update outside the application role. |

**Definition of done (acceptance tests):**

1. The same webhook sent 5 times produces exactly one state change.
2. An older ETA arriving late is stored as STALE and changes nothing.
3. Two sources disagreeing beyond tolerance create a CONFLICT card and no state change until resolved.
4. A CSV with 10 bad rows loads the good rows and quarantines the bad ones with reasons.
5. Impact lists exactly ORD-1042, ORD-1047 and ORD-1051 for Scenario A.
6. The solver result matches a brute-force search on the seeded instance.
7. A false claim blocks plan submission.
8. Analyst self-approval returns 403; Administrator approval returns 403.
9. Two concurrent approvals of competing plans: one succeeds, the other gets 409 with a conflict card; a 50-run loop never oversubscribes stock.
10. Execute then rollback restores exact stock balances, and every step is in the audit log.
11. The voice path completes offline using the sample transcript.

**Add-on acceptance tests:**

12. Scenario A fires all five notification types exactly once each, and every notification opens a valid order, disruption or approval screen.
13. For the Scenario A plan the trade-off ledger lists every harmed order, warehouse and supplier, and its totals equal the collateral panel (WH-CHN free stock 15 to 0; ORD-1051 split 45 and 5).
14. Two plans claiming the same stock open exactly one court case; no plan can be submitted or executed until a Manager picks a winner; the losing plan is BLOCKED; stock is never double-allocated.
15. The replay for Scenario A shows every step in order, each linked to an audit row, and scrubbing to a step shows the state as it was then.
16. Scenario A retrieves the seeded closest case and shows its insight text with a similarity score.
17. Every affected order shows original, best recoverable and committed dates; a committed date earlier than the best recoverable date fails the PROMISE\_DATE\_ACHIEVABLE claim.
18. Every lineage edge has an evidence ID, a timestamp and a calculation string; an edge with no evidence cannot be rendered.
19. Tightening one guardrail so the Scenario B plan breaches it adds the missing approver role and sends an ESCALATION notification; the plan cannot execute until that approval exists.
20. When a SUP-1 delay opens in a festival-peak window, fingerprint F1 is shown as a match; a precursor event for F2 raises a pre-warning before any order is hurt.
21. A full Stress-Test run (all five injectors) ends with zero unhandled errors, no state corruption, and a report that counts what was ignored, quarantined, held for review or rejected.
22. The radar flags SUP-1 into WH-HOS for SKU-101 before the Scenario A disruption is opened, and re-ranks after execution.
23. Every route shown has a lead time and cost that match the lane tables, and a route that misses an order’s deadline is not offered to the solver.

**Micro-feature acceptance tests:**

24. Each KPI card equals the matching direct SQL count for Scenario A, and clicking a card opens a list with the same count.
25. The network map shows all 3 warehouses, 4 suppliers and every transfer lane; after the field report SHP-204 and WH-HOS are highlighted, and clicking WH-HOS lists exactly ORD-1042, ORD-1047 and ORD-1051.
26. Scenario A produces exactly one alert per distinct condition (LATE\_SHIPMENT for SHP-204, PROJECTED\_SHORTAGE for SKU-101 at WH-HOS); the duplicate storm adds none; every alert opens a valid screen.
27. Ask the Desk: “Which orders are affected?” returns exactly the three Scenario A orders; every number is backed by a passing ANSWER\_FACT claim; with the LLM disabled the facts are identical; the write-intent question is refused, logged and changes no state.
28. Each order’s band matches the policy thresholds; changing a threshold re-bands immediately; every band chip opens its waterfall and evidence.
29. After the field report SHP-204 is flagged LATE by 120 minutes; a shipment inside the grace period is not flagged; running the detector twice leaves one open disruption and one alert.
30. SKU-101 at WH-HOS raises BELOW\_THRESHOLD (free 20 against minimum 30) and PROJECTED\_SHORTAGE (190 needed against 120 supply); adding stock above the threshold clears the alert on the next recompute.
31. Supplier scorecard values equal a direct recomputation from shipments; a webhook or CSV row that changes an ETA updates the scorecard on the next recompute; SUP-1 shows below 70% on time.
32. A Manager delegates to the second Manager: the delegate can approve and the delegator cannot approve that plan; delegating to the plan’s creator or modifier, to a different role, or to the Administrator is refused; Request changes increments the version and voids earlier approvals; both actions appear in the audit trail and fire notifications.
33. Master data: an Analyst create or edit returns 403; an Administrator creates a supplier and deactivates (never deletes) it; editing on\_hand directly is rejected; an inventory correction writes a ledger entry and an audit row; a change that touches stock reserved by an open plan returns 409.
34. Re-uploading an identical file is a no-op (FILE\_ALREADY\_IMPORTED); two rows with the same natural key and the same values give one APPLIED and one DUPLICATE; the same key with different values gives a CONFLICT row for review and applies neither; the quality report counts add up to the total rows.
35. Every Scenario A action appears as a card; a card with any failed claim shows BLOCKED and never Feasible; card costs and benefits add up to the plan objective.
36. Days of cover equals free stock divided by average daily demand from open orders, with the formula shown; the drift hint appears only after three ETA revisions; risk scores and solver output are identical with B13 on or off.
37. Setting the what-if sliders to 70 damaged units and 2 hours of delay reproduces Scenario A (baseline ₹16,000, plan ₹6,825); a before-and-after row count of inventory, reservations, ledger, approvals and notifications is identical; a SIMULATION result cannot be submitted.
38. The three sample messages give one CONFLICT card (the email against the carrier), one DUPLICATE and one REJECTED (SHP-999); nothing becomes an event until a human confirms; raw text is stored untouched; the rule-based extractor works with the LLM disabled.
39. At 390 px width a Warehouse Operator can submit a field report for their own warehouse and sees only that warehouse’s data; a draft saved offline submits on reconnect and still needs confirmation; another warehouse returns 403.
40. Verify chain passes on a clean database; after the Tamper seed edits one audit row, verification fails and names that row; the ledger chain behaves the same way.
41. No customer notice can be released before its plan is APPROVED; a released notice carries the approved committed date and its NOTICE\_DATE\_MATCHES claim passes; an Analyst release returns 403; no public or customer-facing route exists.

## 9. Features to explicitly exclude

- Real carrier, supplier, payment or shipping integrations; real email, SMS or WhatsApp (the simulated inbox in A1 is in scope).
- Chatbot as the main interface (only the read-only Ask the Desk panel, B4, is in scope), live maps with truck pins or map tiles (only the static SVG network map, B2, is in scope), full-scale route optimisation (only the small seeded-lane Route-Optimization Demo, A2, is in scope), ML demand forecasting (only the deterministic projection in B13), blockchain (only the plain hash chain in B17, with no tokens, consensus or distributed nodes).
- Native mobile app and offline PWA (only the responsive Operator Phone View with a draft queue, B16, is in scope), challan photo OCR, contract-clause mining, e-way bill checks, carrier credibility models, scan-silence detection (A10 only labels scan-gap patterns found in seeded history; it does not detect them live).
- Shift-aware escalation, Git-style plan branching, custom-trained ML models (A6 and A10 are rule-based and say so), multi-tenant infrastructure.
- Polished animations and extra charts before the event-to-recovery chain works.
- A customer-facing portal or any customer login (only the internal, Manager-released notice drafts in B18 are in scope).

Name these as future work. Do not half-build them.

## 10. Best tech stack for our team

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React + Vite + TypeScript, Tailwind, shadcn/ui, TanStack Query, Recharts | Fast to build; familiar. |
| API | Node.js + Express + TypeScript, Zod validation | Same pattern as your earlier JWT and role-based backends. |
| Database | PostgreSQL with Prisma, using raw SQL for reservations | Atomic conditional updates and constraints; MongoDB would make the reservation guarantees harder. |
| Optimisation | Python FastAPI service with OR-Tools CP-SAT | Small integer program; solves instantly on the seed. |
| Graphs and diagrams | React Flow for the lineage graph; plain SVG for the route diagram and radar; no map tiles | Works offline and has no API key or Wi-Fi dependency. |
| LLM | Groq free tier with JSON-schema output behind a provider wrapper | Fast and cheap for extraction and explanation; swappable. |
| Speech | Browser Web Speech API (ta-IN and en-IN) | Free; needs internet in Chrome, so the sample transcript is mandatory. |
| Auth | JWT with bcrypt, role claims, a demo-only role switcher | Lets you swap seeded users live while the backend still enforces every rule. |
| Run and deploy | Docker Compose (web, api, solver, db); optional Render | Local-first demo, no Wi-Fi dependency. |

**Budget rules for limited LLM credits:** the LLM is used in only three places (voice extraction, plan explanation with structured claims, optional candidate suggestions). Cache every response by input hash. Every LLM path has a deterministic fallback. Inventory, deadlines, permissions, risk, reservations and execution are plain code. All 12 add-ons are deterministic code too; the only optional LLM use is phrasing a playbook insight (A6), cached and with a template fallback.

The B-series adds no new technology. B4 and B15 use optional, cached Groq calls with deterministic fallbacks; B1, B3 and B11 charts use Recharts; B2 is plain SVG; B17 uses Node crypto; B14 runs the existing solver service on an in-memory copy under a read-only database role.

## 11. Database schema (PostgreSQL)

**Core supply-chain entities**

| Table | Key columns | Purpose |
| --- | --- | --- |
| users | id, name, email, password\_hash, role, warehouse\_id | Identities and roles; operators scoped to a warehouse. |
| suppliers | id, code, name, status | Supplier master. |
| warehouses | id, code, name, city | Warehouse master. |
| skus | id, sku\_code, name, unit | Product master. |
| supplier\_skus | supplier\_id, sku\_id, unit\_cost, lead\_hours, capacity, qualified\_until | Alternative sourcing and qualification. |
| transfer\_lanes | from\_wh, to\_wh, lead\_hours, unit\_cost | Inter-warehouse transfer options. |
| shipments | id, code, supplier\_id, dest\_warehouse\_id, status, resolved\_eta, eta\_basis\_event\_id | Resolved shipment state. |
| shipment\_lines | shipment\_id, sku\_id, quantity, damaged\_quantity | Goods carried. |
| inventory\_balances | warehouse\_id, sku\_id, on\_hand, reserved, version | Stock; unique per warehouse and SKU. |
| orders | id, code, customer\_ref, fulfil\_warehouse\_id, due\_at, priority, penalty\_per\_unit | Customer commitments. |
| order\_lines | order\_id, sku\_id, quantity | Required goods. |

**Events and intelligence**

| Table | Key columns | Purpose |
| --- | --- | --- |
| source\_trust | source, priority, tolerance\_minutes | Configurable trust order and conflict tolerance. |
| shipment\_events | id, shipment\_id, source, external\_event\_id, event\_time, received\_at, payload, state, reason | Append-only; state is APPLIED, DUPLICATE, STALE, CONFLICT or REJECTED. |
| field\_reports | id, transcript, language, extracted\_json, confidence, status, event\_id, created\_by | Voice reports linked to the event they created. |
| import\_batches, import\_rows | batch\_id, row\_number, raw\_data, errors, status | VALID, QUARANTINED, REPAIRED or DISCARDED rows. |
| disruptions | id, type, shipment\_id, status, detected\_at, trigger\_event\_id | LATE\_SHIPMENT, SUPPLIER\_DELAY or STOCK\_SHORTAGE. |
| order\_risk\_snapshots | id, disruption\_id, order\_id, score, score\_low, score\_high, factors, evidence\_ids | Explainable risk at a point in time. |
| llm\_cache | input\_hash, output, created\_at | Cached model responses. |

**Recovery and governance**

| Table | Key columns | Purpose |
| --- | --- | --- |
| recovery\_plans | id, disruption\_id, version, status, created\_by, last\_modified\_by, objective\_value, baseline\_value, contract\_hash | DRAFT, VERIFIED, BLOCKED, PENDING\_APPROVAL, APPROVED, REJECTED, EXECUTED, ROLLED\_BACK. |
| plan\_actions | id, plan\_id, action\_type, sku\_id, quantity, source\_ref, dest\_warehouse\_id, order\_id, arrival\_at, cost | REALLOCATE, EXPEDITE, ALT\_SUPPLIER, SPLIT. |
| plan\_claims | id, plan\_id, claim\_type, payload, origin, status, expected, actual, evidence\_ids | Claims from SYSTEM, LLM or CHALLENGE, each checked. |
| stock\_reservations | id, plan\_id, warehouse\_id, sku\_id, quantity, expires\_at, status | HELD, COMMITTED or RELEASED. |
| approvals | id, plan\_id, plan\_version, required\_role, approver\_id, decision, comment, contract\_hash, decided\_at | One row per required role. |
| execution\_ledger | id, plan\_id, action\_id, warehouse\_id, sku\_id, delta\_on\_hand, before\_state, after\_state, entry\_type, reverses\_entry\_id | EXECUTE and COMPENSATE entries. |
| audit\_logs | id, actor\_id, actor\_role, action, entity\_type, entity\_id, before\_data, after\_data, created\_at | Append-only audit trail. |
| notifications | id, user\_id, type, payload, read\_at | In-app notifications. |

**Add-on tables (A1 to A12)**

| Table | Key columns | Purpose |
| --- | --- | --- |
| route\_options | id, from\_wh, to\_wh, via\_wh, mode, lead\_hours, unit\_cost, distance\_km, max\_units | A2: direct, via-warehouse and expedited options. |
| plan\_tradeoffs | id, plan\_id, action\_id, helps\_order\_id, harmed\_entity\_type, harmed\_entity\_id, harm\_type, harm\_value, evidence\_ids | A3: one row per “saves X, hurts Y”. |
| allocation\_conflicts | id, warehouse\_id, sku\_id, contested\_qty, status, winner\_plan\_id, resolved\_by, resolution\_reason, resolved\_at | A4: OPEN or RESOLVED court cases. |
| allocation\_claims | id, conflict\_id, plan\_id, order\_id, quantity, priority, due\_at, penalty\_per\_unit, consequence | A4: each side’s claim and its consequence if it loses. |
| order\_promise\_dates | id, order\_id, disruption\_id, plan\_id, original\_promise\_at, best\_recoverable\_at, committed\_at, basis, evidence\_ids | A7: three dates per order, with the calculation inputs in basis. |
| lineage\_edges | id, disruption\_id, from\_node\_type, from\_node\_id, to\_node\_type, to\_node\_id, relation, evidence\_ids, observed\_at, calculation | A8: causal edges with proof. |
| historical\_cases | id, disruption\_type, supplier\_id, warehouse\_id, sku\_id, calendar\_tag, shortage\_ratio, actions\_tried, outcome, what\_worked, what\_failed, why, freight\_cost, late\_orders, source | A6 and A10: SEEDED or LIVE cases; a LIVE row is written when a Manager closes a disruption. |
| fingerprints | id, key, label, pattern, precursor, occurrence\_count, first\_seen, last\_seen | A10: recurring patterns. |
| disruption\_fingerprints | disruption\_id, fingerprint\_id, match\_score, kind | A10: kind is MATCH or PRE\_WARNING. |
| guardrail\_policies | id, metric, limit\_value, unit, escalate\_to, active | A9: EXPEDITE\_SPEND, SERVICE\_DAMAGE, SUPPLIER\_RISK, TRANSFER\_DISTANCE. |
| guardrail\_checks | id, plan\_id, plan\_version, policy\_id, plan\_value, limit\_value, result, escalation\_approval\_id | A9: PASS or BREACH per policy per plan version. |
| spof\_snapshots | id, computed\_at, node\_type, node\_id, orders\_exposed, penalty\_exposure, has\_alternative, score, rank | A12: ranked dependencies over time. |
| stress\_runs | id, injector, params, started\_by, result, created\_at | A11: what was injected and what the system did. |

**Micro-feature tables (B1 to B18)**

| Table | Key columns | Purpose |
| --- | --- | --- |
| alerts | id, alert\_key, kind, severity, entity\_type, entity\_id, status, first\_seen, last\_seen, payload | B3, B6, B7: one row per distinct condition; status is OPEN, ACKED or CLEARED. |
| stock\_thresholds | id, warehouse\_id, sku\_id, min\_level, horizon\_hours | B7: per-warehouse, per-SKU minimum and projection horizon. |
| risk\_policies | id, band, min\_score, max\_score | B5: RED, AMBER and GREEN cut-offs. |
| supplier\_scorecards | id, supplier\_id, computed\_at, shipments\_closed, on\_time\_rate, avg\_delay\_hours, open\_delayed | B8: recomputed snapshots. |
| approval\_delegations | id, delegator\_id, delegate\_id, role, plan\_id, valid\_from, valid\_to, revoked\_at | B9: time-boxed, same-role, optionally limited to one plan. |
| simulation\_runs | id, created\_by, params, result, created\_at | B14: what-if inputs and outputs; no foreign keys to reservations, ledger or inventory. |
| customer\_notices | id, plan\_id, order\_id, channel, template\_key, body, committed\_at, status, released\_by, released\_at | B18: status is DRAFT or RELEASED. |

B4 questions and refusals are written to audit\_logs; B13 values are computed on demand, so neither needs a table.

**Changes to existing tables**

- notifications: add channel (IN\_APP, EMAIL\_SIM, WHATSAPP\_SIM), link\_type, link\_id and template\_key, so every message deep-links to its entity (A1).
- transfer\_lanes: add distance\_km. suppliers: add risk\_score (0 to 100). warehouses: add processing\_hours (A2, A7, A9).
- shipment\_events: add event type INVENTORY\_CORRECTION, applied through an insert-only ledger entry (A11).
- disruptions: add calendar\_tag (for example FESTIVAL\_PEAK) and closed\_at (A6, A10).
- plan\_actions: add route\_id. recovery\_plans: add guardrail\_status (CLEAR, ESCALATED) (A2, A9).
- approvals: add is\_escalation and justification (A9).
- audit\_logs: add correlation\_id (the disruption) and step\_type, so the replay is one ordered query (A5).
- shipments: add promised\_eta and actual\_arrival\_at (B6, B8).
- warehouses and suppliers: add map\_x and map\_y (B2).
- field\_reports: add channel (VOICE, EMAIL\_TEXT or SMS\_TEXT) so pasted messages reuse the voice flow (B15). source\_trust: add an EMAIL\_TEXT row with priority 1.
- import\_batches: add file\_hash. import\_rows: add natural\_key and the row states DUPLICATE and CONFLICT (B11).
- audit\_logs and execution\_ledger: add prev\_hash and row\_hash (B17).
- approvals: add the decision value CHANGES\_REQUESTED and acted\_as\_delegate\_of (B9).

**Constraints that matter more than table count**

- Unique (source, external\_event\_id) on shipment\_events gives idempotency.
- Unique (warehouse\_id, sku\_id) on inventory\_balances, with CHECK (reserved >= 0 AND reserved <= on\_hand).
- Reservation is one atomic conditional update inside a transaction: UPDATE inventory\_balances SET reserved = reserved + qty, version = version + 1 WHERE warehouse\_id = w AND sku\_id = s AND on\_hand - reserved >= qty. Zero rows updated means conflict. Lock rows in (warehouse\_id, sku\_id) order to avoid deadlocks.
- Approvals require approver\_id to differ from created\_by and last\_modified\_by, and contract\_hash must match the plan’s current hash.
- Raw events are never overwritten; resolved state lives on shipments.
- Ledger and audit tables are insert-only (no UPDATE or DELETE grants).
- Rollback is allowed only if the plan is EXECUTED and reversing it would not push any balance below zero or below later reservations.
- At most one plan may hold a contested unit of stock; a court case (A4) stays OPEN until winner\_plan\_id is set, and a plan with an OPEN case cannot be submitted or executed.
- Every lineage edge must carry at least one evidence ID and a calculation; promise-date rows must store their basis.
- A plan version needs a guardrail\_checks row for every active policy before it can be submitted.
- Inventory corrections are insert-only ledger entries; any plan whose claims they break is re-verified and set to BLOCKED if a claim fails.
- Only one OPEN alert may exist per alert\_key, so repeated detector runs never repeat an alert (B3, B6, B7).
- What-if runs use a read-only database role and write only to simulation\_runs; a SIMULATION result has no plan ID and cannot be submitted (B14).
- row\_hash = SHA-256 of prev\_hash plus the canonical row content, written inside the same transaction under an advisory lock so the chain stays ordered (B17).
- A delegate must hold the same role, must not be the plan’s creator or any modifier, can never be the Administrator, and the delegator loses approval rights on that plan while the delegation is active (B9).
- No hard deletes on master data; on\_hand changes only through inventory corrections; a file hash can be committed only once (B10, B11).
- A customer notice can be RELEASED only when its plan is APPROVED or EXECUTED and its committed\_at equals the promise-date row (B18).

## 12. API endpoints

All routes live under `/api/v1`. Every route checks the role in the backend.

**Role permissions (the statement leaves these undefined, so this is our interpretation):**

| Capability | Analyst | Manager | Warehouse Operator | Procurement Approver | Administrator |
| --- | --- | --- | --- | --- | --- |
| Import CSV/JSON | Yes | – | – | – | Yes |
| Submit field report | Yes | – | Yes (own warehouse) | – | – |
| Confirm events, resolve conflicts | Yes | Yes | Own reports | – | – |
| View disruptions and risks | Yes | Yes | Warehouse-scoped | Yes | Yes |
| Generate, modify, submit plans | Yes | Yes | – | – | – |
| Approve REALLOCATE and SPLIT | – | Yes | – | – | – |
| Approve EXPEDITE and ALT\_SUPPLIER | – | – | – | Yes | – |
| Confirm execution | – | Yes | – | – | – |
| Roll back | – | Yes | – | – | – |
| Manage users, run red-team | – | – | – | – | Yes |
| Read audit trail | Yes | Yes | – | Yes | Yes |
| Resolve an allocation conflict (A4) | – | Yes | – | – | – |
| Close a disruption and store its playbook case (A6) | – | Yes | – | – | – |
| Set guardrail limits (A9) | – | Yes | – | – | Yes |
| Clear a guardrail escalation (A9) | – | Yes (when escalated to Manager) | – | Yes (when escalated to Procurement) | – |
| View replay, lineage, fingerprints, playbook, radar (A5, A8, A6, A10, A12) | Yes | Yes | – | Yes | Yes |
| Run Stress-Test Mode (A11) | – | – | – | – | Yes (demo mode) |
| View KPI strip, network map, alerts, risk bands and projections (B1, B2, B3, B5, B13) | Yes | Yes | Warehouse-scoped | Yes | Yes |
| Ask the Desk (B4, read-only) | Yes | Yes | Warehouse-scoped | Yes | Yes |
| Acknowledge alerts, run detectors (B3, B6, B7) | Yes | Yes | – | – | – |
| View supplier scorecards (B8) | Yes | Yes | – | Yes | Yes |
| Delegate approval, request changes (B9) | – | Yes | – | Yes | – |
| Master data CRUD (B10) | – | – | – | – | Yes |
| Inventory correction (B10) | – | Yes | – | – | Yes |
| Set risk bands and stock thresholds (B5, B7) | – | Yes | – | – | Yes |
| View import quality report (B11) | Yes | – | – | – | Yes |
| Run what-if (B14) | Yes | Yes | – | – | – |
| Paste email or text (B15) | Yes | – | Yes (own warehouse) | – | – |
| Verify audit chain (B17) | Yes | Yes | – | Yes | Yes |
| Generate customer notice drafts (B18) | Yes | Yes | – | – | – |
| Release customer notices (B18) | – | Yes | – | – | – |

**Separation of duties:** an approver can never be the plan’s creator or any modifier; each required role needs a distinct approver; the executor cannot be the creator; the Administrator cannot approve anything. An escalation approval must also come from a distinct approver, and the Administrator can never clear an escalation. A delegate follows the same rules as any approver, and a delegation never lets someone approve a plan they created or modified.

| Method | Endpoint | Roles | Purpose |
| --- | --- | --- | --- |
| POST | /auth/login | Public | Authenticate and return JWT |
| GET | /auth/me | Any | Role and permissions |
| GET | /overview | Any | Cockpit data |
| POST | /imports | Analyst, Admin | Upload CSV or JSON |
| GET | /imports/:id/quarantine | Analyst, Admin | Invalid rows with reasons |
| PATCH | /imports/rows/:rowId | Analyst, Admin | Repair or discard a row |
| POST | /imports/:id/commit | Analyst, Admin | Load valid and repaired rows |
| POST | /webhooks/carrier/:source | Signed shared secret | Simulated carrier event |
| POST | /voice/parse | Analyst, Operator | Transcript to structured event card |
| POST | /events | Analyst, Operator, Manager | Confirm and store event |
| GET | /events/conflicts | Analyst, Manager | Open conflicts |
| POST | /events/conflicts/:id/resolve | Analyst, Manager | Choose authoritative event |
| GET | /disruptions, /disruptions/:id | Any | List and detail |
| GET | /disruptions/:id/impact | Any | Affected shipments, stock, orders |
| GET | /disruptions/:id/risks | Any | Ranked orders with factors |
| POST | /disruptions/:id/recovery-plans | Analyst, Manager | Enumerate candidates and solve |
| GET | /plans/:id | Any | Plan, baseline, collateral, claims |
| PATCH | /plans/:id | Analyst, Manager | Modify; version increments; re-verify |
| POST | /plans/:id/verify | Analyst, Manager | Run proof checker |
| POST | /plans/:id/challenge | Analyst (demo mode) | Inject a false claim |
| POST | /plans/:id/submit | Analyst, Manager | Reserve stock and freeze contract |
| POST | /plans/:id/approve | Manager, Procurement | Approve for the caller’s role |
| POST | /plans/:id/reject | Manager, Procurement | Reject with reason |
| POST | /plans/:id/execute | Manager | Confirm simulated execution |
| POST | /plans/:id/rollback | Manager | Compensating entries |
| GET | /audit | Analyst, Manager, Procurement, Admin | Audit trail |
| GET | /notifications | Any | In-app notifications |
| GET | /notifications/outbox?channel= | Any | Simulated email and WhatsApp messages for the caller (A1) |
| GET | /disruptions/:id/routes | Any | Feasible route options for affected shipments (A2) |
| GET | /plans/:id/tradeoffs | Any | Trade-off ledger for a plan (A3) |
| GET | /conflicts/allocation, /conflicts/allocation/:id | Analyst, Manager | Open and resolved court cases with both claims (A4) |
| POST | /conflicts/allocation/:id/resolve | Manager | Choose the winning plan with a reason (A4) |
| GET | /disruptions/:id/replay?upTo= | Analyst, Manager, Procurement, Admin | Ordered replay steps, optionally up to a step (A5) |
| GET | /disruptions/:id/playbook | Analyst, Manager, Procurement, Admin | Closest past cases with similarity and insight (A6) |
| POST | /disruptions/:id/close | Manager | Close and store a LIVE playbook case (A6) |
| GET | /plans/:id/promise-dates | Any | Original, best recoverable and committed dates per order (A7) |
| GET | /orders/:id/lineage?disruption= | Any | Causal chain with evidence on each edge (A8) |
| GET | /guardrails, PUT /guardrails/:id | Any, Manager and Admin | Read and set limits (A9) |
| GET | /plans/:id/guardrails | Any | Guardrail results and any escalation (A9) |
| GET | /fingerprints, /disruptions/:id/fingerprints | Analyst, Manager, Procurement, Admin | Recurring patterns and matches (A10) |
| POST | /admin/stress/run | Admin (demo mode) | Run selected chaos injectors and return the report (A11) |
| GET | /risk/spof | Analyst, Manager, Procurement, Admin | Ranked single points of failure (A12) |
| GET | /overview/kpis | Any | KPI strip values and filtered lists (B1) |
| GET | /network/map | Any | Nodes, lanes and highlighted shipments (B2) |
| GET, POST | /alerts, /alerts/:id/ack | Any, Analyst and Manager | Alert feed and acknowledge (B3) |
| POST | /detectors/run | Analyst, Manager | Run late-shipment and stock detectors on demand (B6, B7) |
| POST | /ask | Any (read-only) | Question to answer with claims; write intents refused (B4) |
| GET, PUT | /risk/policy | Any, Manager and Admin | Read and set band cut-offs (B5) |
| GET | /suppliers/scorecards | Analyst, Manager, Procurement, Admin | Supplier delay scorecards (B8) |
| POST, DELETE | /approvals/delegations, /approvals/delegations/:id | Manager, Procurement | Create or revoke a delegation (B9) |
| POST | /plans/:id/request-changes | Manager, Procurement | Return a plan with a comment; version increments (B9) |
| GET, POST, PATCH | /admin/master/:entity | Admin | Master data CRUD with soft delete (B10) |
| POST | /inventory/corrections | Manager, Admin | Audited stock correction through the ledger (B10) |
| GET | /imports/:id/report | Analyst, Admin | Import quality report (B11) |
| GET | /plans/:id/cards | Any | Recommendation cards with feasibility checklists (B12) |
| GET | /projections/cover, /shipments/:id/eta-drift | Any | Days of cover and ETA drift hint (B13) |
| POST, GET | /whatif/run, /whatif/:id | Analyst, Manager | Sandbox simulation (B14) |
| POST | /ingest/text | Analyst, Operator (own warehouse) | Message text to a draft event card (B15) |
| GET | /audit/verify | Analyst, Manager, Procurement, Admin | Recompute the hash chain (B17) |
| POST | /admin/demo/tamper | Admin (demo mode) | Edit one audit row outside the app role (B17) |
| POST, GET | /plans/:id/customer-notices, /customer-notices | Analyst, Manager | Generate and list notice drafts (B18) |
| POST | /customer-notices/:id/release | Manager | Release to the simulated outbox (B18) |

| POST | /admin/red-team/run | Admin | Run bypass test suite |
| POST | /admin/demo/reset | Admin (demo mode) | Reseed scenarios A and B |

## 13. AI/ML pipeline

**Rule:** AI is the advisor, code is the judge. Stock, deadlines, permissions, risk, reservations and execution are deterministic. Do not train a model just to claim ML.

| Stage | Method | AI or code | Fallback |
| --- | --- | --- | --- |
| 1. Intake | Store raw CSV, JSON, webhook body or transcript untouched | Code | n/a |
| 2. Voice extraction | Web Speech transcript, editable, then Groq JSON-schema extraction into shipment, warehouse, event type, damaged quantity, delay hours, confidence; Zod and DB reference checks follow | AI plus code | Sample-transcript button; rule-based extractor for shipment code, number before box or units, and the mani neram hour pattern |
| 3. Validation | Zod, foreign-key checks, nearest-valid-ID suggestion for bad rows | Code | Row stays quarantined |
| 4. Reconciliation | Rules table below | Code | n/a |
| 5. Impact | SQL walk from shipment to destination warehouse to inventory to orders | Code | n/a |
| 6. Risk | Formula below | Code | n/a |
| 7. Candidates | Enumerate reallocations (lanes with free stock), expedites, qualified alternative suppliers with capacity, and partial coverage. Optional LLM suggestions are untrusted and must pass the proof checker before the solver sees them | Code, optional AI | Enumerator alone |
| 8. Portfolio solver | OR-Tools CP-SAT, 2-second limit | Code | If infeasible, show baseline and the reason |
| 9. Explanation | LLM writes a short narrative plus structured claims; cached by input hash | AI | Template text from plan fields |
| 10. Proof checker | Every claim and action checked against the database | Code | n/a |
| 11. Approval and execution | RBAC, contract hash, reservations, ledger | Code | n/a |

**Add-on stages (all deterministic code, no model training)**

| Add-on | Method | Fallback |
| --- | --- | --- |
| A1 Notifications | Event hooks on disruption opened, plan submitted, approval decided, guardrail escalation and plan status change write a notification per affected user and channel from a template. | In-app only if a template fails. |
| A2 Routes | The solver service enumerates direct lanes and one-hop via-warehouse paths from transfer\_lanes and route\_options. Lead time is the sum of lane and handling hours, cost is the sum of unit costs, and a route that misses the deadline is dropped. Surviving routes become solver candidates. | Direct lanes only. |
| A3 Trade-off ledger | For every action, compare each order, donor warehouse and supplier before and after the plan; each loss becomes a plan\_tradeoffs row. | n/a |
| A4 Conflict court | On submit, if reservation would oversubscribe stock claimed by another plan, create a case with both claims; the Manager picks a winner; the loser is BLOCKED and told to regenerate. | n/a |
| A5 Replay | Ordered query of audit\_logs and shipment\_events by correlation\_id; the UI re-renders state up to the chosen step. | Static timeline without the scrubber. |
| A6 Playbook | Similarity = 0.35 × same disruption type + 0.25 × same supplier or warehouse + 0.20 × same SKU + 0.20 × (1 − absolute difference in shortage ratio). Show the best case and its insight; optional cached LLM phrasing. | Template insight text built from the stored fields. |
| A7 Promise dates | See the specification below. | n/a |
| A8 Lineage | Built from the impact walk: supplier event, shipment, destination warehouse shortage, order. Each edge stores evidence IDs, the observed time and the calculation. | Table view of the same edges. |
| A9 Guardrails | See the specification below. | n/a |
| A10 Fingerprints | A fingerprint key is (disruption type, root-cause entity, trigger tag such as FESTIVAL\_PEAK or a precursor event). Three or more matching cases make it active; a new disruption that matches shows MATCH, and a precursor event shows PRE\_WARNING. | Label only, no live detection. |
| A11 Stress-Test | Injectors: duplicate webhooks, invalid CSV rows, conflicting ETAs, simultaneous supplier failures, inventory corrections. The run goes through the normal APIs and the report counts applied, ignored, stale, quarantined, held and rejected items. | Run injectors one at a time. |
| A12 Radar | See the formula below. | n/a |

**Promise-Date Repair Engine.** For each affected order: original promise date = the order due time. Best recoverable date = the earliest time at which the full quantity can be on hand, taking the latest of the sources needed to cover it (free stock now, reconciled inbound ETA, transfer arrival, supplier lead time) and adding the fulfilment warehouse processing hours. Committed date = the date proposed in the plan, which defaults to the best recoverable date and may be edited only to a later date. It is part of the Decision Contract and becomes final on approval. Orders that are split show one date for the on-time part and one for the backordered part.

**Recovery Budget Guardrails.** Four policies are checked against every plan version: expedite and alternative-sourcing spend, service-level damage (residual penalty and share of units backordered), supplier risk score, and transfer distance. On a breach the system never proceeds on its own. If the plan needs only one approver role, the missing role is added, so the plan needs both Manager and Procurement Approver. If both roles are already required, the plan is marked ESCALATED: each approval needs a written justification and the Manager’s execution confirmation must acknowledge the breach. An ESCALATION notification is sent either way.

**Single-Point-of-Failure Radar.** For every supplier, warehouse, SKU and lane, simulate its failure and compute: SPOF score = 100 × (0.50 × share of open orders that depend on it + 0.30 × share of open penalty exposure that depends on it + 0.20 × (1 if no qualified alternative with free stock exists, else 0)). Show the ranked list, the orders behind each score and the missing alternative. It is a visible policy formula, not a prediction, and it is recomputed after every import, event and execution.

**Micro-feature stages (B1 to B18, deterministic unless stated)**

| Micro-feature | Method | Fallback |
| --- | --- | --- |
| B1 KPI Strip | One SQL count per card, recomputed after every import, event and execution. | Cards show a dash and the list still opens. |
| B2 Network Map | SVG from warehouses, suppliers, transfer\_lanes and seeded coordinates; delayed shipments come from open disruptions. | Table of nodes and lanes. |
| B3 Alert feed | Detectors upsert alerts by alert\_key; a cleared condition marks the alert CLEARED. | Plain list without the charts. |
| B4 Ask the Desk | Rule-based intent match (keywords and patterns) to a fixed parameterised query; template answer; optional LLM rephrases only the rows it is given, and each number or entity it names is checked as an ANSWER\_FACT claim. Any write intent is refused. | Template answer; the chip list when no intent matches. |
| B5 Risk bands | A label over the existing score using risk\_policies. | Score without a band. |
| B6 Late-shipment detector | See the specification below. | n/a |
| B7 Stock alerts | See the specification below. | n/a |
| B8 Scorecard | On-time rate = delivered shipments with actual\_arrival\_at at or before promised\_eta plus grace, divided by delivered shipments; average delay hours over delivered shipments. | Hidden when fewer than three closed shipments exist. |
| B9 Delegation | Same-role, time-boxed delegation; Request changes writes CHANGES\_REQUESTED, bumps the version and voids earlier approvals. | n/a |
| B10 Master data | Zod-validated CRUD; soft delete; stock only through corrections. | Read-only tables. |
| B11 Import report | Counts per row state; file hash and natural-key checks run before commit. | Counts only, no chart. |
| B12 Cards | Derived from plan\_actions and plan\_claims; the checklist is the claims already generated for the action. | Table of actions. |
| B13 Projection | See the specification below. | n/a |
| B14 What-if | See the specification below. | Preset scenarios only. |
| B15 Text ingestion | Rule-based extractor first; optional cached Groq extraction; the same Zod and database reference checks as voice; human confirms; the event enters the reconciler as source EMAIL\_TEXT. | Rule-based extractor only. |
| B16 Operator view | Responsive CSS plus a browser draft queue that replays the normal voice and event endpoints on reconnect. | Online-only form. |
| B17 Hash chain | Canonical JSON per row, SHA-256 chained within each table, verified by one ordered scan. | Verify button hidden; tables stay insert-only. |
| B18 Notices | Template plus values from order\_promise\_dates; the claim NOTICE\_DATE\_MATCHES must pass before release. | Draft text only, no release. |

**Late-Shipment Detector (B6).** A shipment is LATE when its reconciled ETA is later than promised\_eta plus the grace period (default 60 minutes), or when the clock is past promised\_eta plus the grace period and no arrival is recorded. The alert key is (LATE\_SHIPMENT, shipment). If a disruption is already open for that shipment it is refreshed, never duplicated. The detector runs after every APPLIED event and on demand.

**Stock-Shortage Alerts (B7).** BELOW\_THRESHOLD: on\_hand minus reserved is lower than min\_level. PROJECTED\_SHORTAGE: within the horizon (default 72 hours), free stock plus reconciled inbound arrivals minus the quantity on orders due inside the horizon at that warehouse is below zero. The alert key is (kind, warehouse, SKU).

**Cover and Drift Projection (B13).** Days of cover = free stock divided by (units due in the next 7 days divided by 7), or no demand when the demand is zero. ETA drift: when a shipment has three or more APPLIED ETA revisions and the last three all moved later, show the average shift per revision as a hint. Both are labelled projection, not prediction, and neither is read by the risk engine, the solver or the proof checker.

**What-If Simulator (B14).** The request carries overrides (delay hours, damaged units, lane lead hours, supplier capacity, stock correction). The API loads the affected rows into memory, applies the overrides, runs the same impact walk, risk formula, solver and guardrail checks, and returns affected orders, baseline vs plan, approvals needed and guardrail results marked SIMULATION. The database connection is read-only; only simulation\_runs is written. Open as real disruption pre-fills an event card that still needs human confirmation.

**Reconciler rules**

| Situation | Rule | Event state |
| --- | --- | --- |
| Same source and external\_event\_id | Ignore, no change | DUPLICATE |
| Older event\_time than the event behind the current ETA from an equal or higher trust source | Keep as history | STALE |
| Two trusted sources differ by more than the tolerance (default 4 hours) | Hold; shipment shows under review; human resolves | CONFLICT |
| Sources agree within tolerance | Apply the higher-trust value, record the agreement | APPLIED |
| Unknown shipment reference | Quarantine | REJECTED |
| Newer trusted event | Apply, then recompute impact and risk | APPLIED |

Default trust order (configurable): warehouse-confirmed field report 3, carrier webhook 2, supplier portal 1, CSV batch 1.

**Risk formula (explainable policy, not a probability)**

- Risk = 100 × (0.35 × U + 0.30 × S + 0.20 × D + 0.15 × P)
- U (urgency) = clamp(1 − slack\_hours / 72, 0, 1); slack is due time minus projected arrival, and U = 1 when slack is negative.
- S (shortage) = max(0, required − available) / required.
- D (delay) = clamp(delay\_hours / (slack\_hours + 24), 0, 1).
- P (priority) = (priority − 1) / 4.
- Compute the score twice, with best-case and worst-case ETA, and show it as a range. Each factor stores the evidence row IDs it used.

**Solver specification**

- Inputs: affected orders (SKU, quantity, due time, fulfilment warehouse, penalty per unit); existing sources (free stock, reconciled inbound arrivals); candidate actions (transfer lanes with free stock, expedites, qualified supplier capacity).
- Variables: integer units taken from each candidate and assigned to each order, allowed only if the arrival time is on or before the due time; shortfall per order.
- Constraints: source capacity, donor free stock, supplier qualification valid at arrival, deadline eligibility, integrality. Partial fulfilment is allowed, which produces split orders.
- Objective: minimise the sum of penalty per unit × shortfall plus action cost, with a small tie-break for fewer actions.
- Baseline: the same model with only existing sources, so the do-nothing comparison is fair.
- Outputs: plan actions, per-order outcome (on-time units, backordered units, delay hours), and collateral damage: donor warehouse free stock after the plan and any order that stays short.
- Label it portfolio-level constrained optimisation. Do not say globally optimised.
- Use a configurable simulation clock so the demo is repeatable.

**Proof checker claim types**

| Claim | Check | Evidence returned |
| --- | --- | --- |
| AVAILABLE\_STOCK | free stock at warehouse at least the claimed quantity | inventory row, expected vs actual |
| SUPPLIER\_CAPACITY | supplier capacity at least the claimed quantity | supplier\_skus row |
| SUPPLIER\_QUALIFIED | qualification valid on the arrival date | supplier\_skus row |
| LANE\_LEAD\_TIME | lane lead time at most the claimed hours | transfer\_lanes row |
| DEADLINE\_MET | arrival time on or before the order due time | order and action rows |
| ORDER\_DEMAND | order line quantity matches | order\_lines row |
| SHIPMENT\_ETA | resolved ETA matches the claim | shipment and event rows |
| RESERVATION\_AVAILABLE | free stock after existing reservations | inventory and reservation rows |
| ROUTE\_FEASIBLE | route lead time and cost match the lane or route rows and arrival meets the deadline | route\_options and transfer\_lanes rows |
| PROMISE\_DATE\_ACHIEVABLE | committed date is not earlier than the best recoverable date | order\_promise\_dates and source rows |
| ANSWER\\_FACT | every number, order and shipment named in an Ask the Desk answer matches a result row of its query (B4) | the query and its rows |
| NOTICE\\_DATE\\_MATCHES | the date in a customer notice equals the approved committed date (B18) | order\\_promise\\_dates row |

Every plan action generates its mandatory claims automatically. LLM narrative claims are checked on top. Any failed claim sets the plan to BLOCKED until it is regenerated or corrected. The Challenge Plan button injects a deliberately false claim to prove this live.

**Decision Contract (frozen at submit):** plan ID and version, hash of all actions, required approver roles, verification status, reservation IDs and expiry, rollback eligibility, expected impact, guardrail results, committed promise dates and any required escalation approvals. Delegations in force are recorded in the contract and on the approval row (B9). An approval is valid only if its contract hash still matches the plan.

## 14. Frontend screens

Build these eight and no more. The Recovery Workbench is the priority screen. The 12 add-ons live as panels, tabs or drawers inside these eight screens (table below); they add no new screens, and neither do the 18 micro-features (second table below).

| Screen | Purpose | Must show |
| --- | --- | --- |
| 1. Sign-in | Role-based login with a demo-only role switcher | Seeded users, role badge in the header |
| 2. Operations cockpit | Required dashboard | Active disruptions, affected orders, pending approvals, recovery progress, conflicts waiting |
| 3. Intake and quarantine | CSV/JSON upload and the carrier simulator | Row-level errors with suggested fixes, accept, edit or discard, a Send duplicate storm button |
| 4. Disruption investigation | See the truth about a shipment | Event timeline with state chips, conflict card, resolved ETA with reason, voice report panel with confirm card |
| 5. Impact and risk | Which orders and why | Ranked orders, factor waterfall, score range, evidence drawer |
| 6. Recovery workbench | Decide | Baseline vs plan, per-order outcome bars, collateral panel, claims list with expected vs actual, Challenge Plan, Decision Contract, Submit |
| 7. Approvals and execution | Govern | Queue, required-role chips, Approve, Reject, Modify, reservation conflict card, Confirm and Execute, Rollback |
| 8. Audit and security | Prove | Filterable audit table, ledger before/after, red-team result grid, notifications |

**Where each add-on appears**

| Add-on | Screen | Form |
| --- | --- | --- |
| A1 Notifications | All screens (header) | Bell opens a drawer styled as a simulated WhatsApp and email inbox; every message is a deep link. |
| A2 Routes | 6. Recovery workbench | Lane diagram panel with selectable routes; the chosen route feeds the plan. |
| A3 Trade-off ledger | 6. Recovery workbench | Table beside the collateral panel: “saves” on the left, “hurts” on the right. |
| A4 Conflict court | 7. Approvals and execution | Side-by-side claims card with Pick winner and a reason box. |
| A5 Decision replay | 4. Disruption investigation (tab) and 8. Audit | Scrubber over the ordered steps; each step opens its audit row. |
| A6 Playbook memory | 6. Recovery workbench | Insight card above the plan showing the closest case and its lesson. |
| A7 Promise dates | 5. Impact and risk, and 6. Recovery workbench | Three date chips per order: original, best recoverable, committed. |
| A8 Lineage graph | 5. Impact and risk | Click an order to open the graph in the evidence drawer. |
| A9 Guardrails | 6. Recovery workbench and 7. Approvals | Strip of four meters with PASS or BREACH; escalation chip in the approval queue. |
| A10 Fingerprints | 2. Cockpit and 4. Disruption investigation | Warning banner with the matching pattern and its history. |
| A11 Stress-Test | 8. Audit and security | Panel of five injector buttons and a result report next to the red-team grid. |
| A12 Radar | 2. Operations cockpit | Ranked tile of the top dependencies with the orders behind each. |

**Where each micro-feature appears**

| Micro-feature | Screen | Form |
| --- | --- | --- |
| B1 KPI Strip | 2. Operations cockpit | Six clickable cards across the top. |
| B2 Network Map | 2. Operations cockpit (tab) and 5. Impact and risk | SVG map; delayed shipment and warehouse highlighted; node click opens a drawer of orders. |
| B3 Alert feed and charts | 2. Operations cockpit | Right-hand feed with severity chips; three small charts below the tiles. |
| B4 Ask the Desk | All screens (header) | Drawer with question chips, the answer, and a proof chip showing the claims checked. |
| B5 Risk bands | 5. Impact and risk | Band chip beside each score; heat grid tab. |
| B6 and B7 detectors | 2. Cockpit and 4. Disruption investigation | Alerts in the feed; a Run detectors button for the demo. |
| B8 Scorecard | 4. Disruption investigation | Supplier card beside the timeline. |
| B9 Delegate and request changes | 7. Approvals and execution | Two extra buttons on each queue row; delegation chip on the approval. |
| B10 Master data | 8. Audit and security (Admin tab) | Entity tabs with simple forms and a Correct stock dialog. |
| B11 Import report | 3. Intake and quarantine | Summary strip and error-reason chart after each import. |
| B12 Recommendation cards | 6. Recovery workbench | Cards above the claims list, each with a checklist. |
| B13 Projection | 5. Impact and risk | Days-of-cover chip and drift hint, labelled projection. |
| B14 What-If Simulator | 6. Recovery workbench (tab) | Sliders on the left, SIMULATION result on the right. |
| B15 Text ingestion | 3. Intake and quarantine and 4. Disruption investigation | Paste box beside the voice panel; same confirm card. |
| B16 Operator view | 4. Disruption investigation at phone width | Responsive layout; drafts queue chip. |
| B17 Provenance chain | 8. Audit and security | Verify chain button and result banner. |
| B18 Customer notices | 7. Approvals and execution | Notice drafts tab with a Manager Release button. |

Design notes: desktop first, INR formatting, status chips with text as well as colour, the voice confirm card also shown in Tamil, and no screens beyond these.

## 15. 48-hour build plan

**Owners:** A frontend and product; B backend and data; C intelligence (voice, reconciler, impact, risk); D optimisation and governance (solver, proof checker, reservations, ledger, security tests).

| Hours | Work | Owner | Exit check |
| --- | --- | --- | --- |
| 0–2 | Freeze scope and data contracts; fix the Scenario A and B numbers; repo and Docker Compose skeleton | All | Empty stack starts with one command |
| 2–6 | Schema, migrations, seed script, auth and role middleware | B (D reviews constraints) | Seed is reproducible; five logins work |
| 2–8 | React shell, routing, role switcher, component kit, API client | A | Screens navigable on mock data |
| 6–12 | CSV/JSON import with quarantine; carrier webhook; Zod | B | Test 4 |
| 8–15 | Event store, reconciler, source trust, conflict resolution | C | Tests 1–3 |
| 8–18 | Solver service: enumerator, CP-SAT model, brute-force test | D | Test 6 |
| 12–18 | Impact engine, risk calculator, evidence IDs | C | Test 5; score range works |
| 15–22 | Wire intake, investigation, impact and risk screens to live data | A | No mock data left on these screens |
| 18–25 | Plan generation API, baseline vs plan, collateral calculation | D with B | **Checkpoint at hour 25: Scenario A runs from event to a plan on screen** |
| 18–24 | Voice: test Web Speech with Tamil early, Groq extraction, fallback, confirm card | C with A | Test 11 |
| 24–31 | Proof checker, claims table, Challenge Plan, Decision Contract | D | Test 7 |
| 25–32 | Recovery workbench UI | A | Screen matches section 14 |
| 28–36 | RBAC enforcement, separation of duties, approvals, plan versioning | B | Test 8 |
| 31–38 | Reservations and concurrency test; execution ledger and rollback | D | Tests 9 and 10 |
| 34–40 | Notifications, audit viewer, cockpit tiles, red-team suite and grid | B and A | 12 of 12 attacks blocked |
| 25–31 | A3 trade-off ledger, A7 promise-date engine, A9 guardrails (backend and checks) | D (A3, A9), C (A7) | Tests 13, 17, 19 |
| 28–35 | A1 notification simulator, A5 replay endpoint, A12 radar | B (A1, A5), C (A12) | Tests 12, 15, 22 |
| 32–38 | A4 conflict court (on top of S1), A11 stress-test runner | D (A4), B (A11) | Tests 14, 21 |
| 34–40 | A8 lineage graph, A2 route demo (data and solver candidates) | C and D with A on the UI | Tests 18, 23 |
| 36–40 | A6 playbook memory and A10 fingerprints, using the seeded history | C | Tests 16, 20 |
| 30–40 | Add-on UI panels from section 14 | A | Every add-on reachable from its screen |
| 34–40 | B Cheap tier: B1, B3, B5, B6, B7, B8, B11, B12 (queries, detectors, cards, small UI) | C (B6, B7, B8), D (B12), B (B11), A (B1, B3, B5 UI) | Tests 24, 26, 28 to 31, 34, 35 |
| 36–40 | B Medium tier, only if the hour-34 check is green: B4, B9, B17 first, then B2, B10, B13, B14, B15 | D (B4, B14), B (B9, B10, B17), C (B13, B15), A (B2 UI) | Tests 25, 27, 32, 33, 36 to 38, 40 |
| 38–40 | B Stretch tier, only if everything above is green: B16 and B18 | A (B16), B (B18) | Tests 39, 41 |

| **40** | **Feature freeze** | All | No new features |
| 40–44 | Run both scenarios end to end; bug fixes only; reset endpoint; warm the LLM cache; record a backup video | All | Clean clone runs the demo |
| **44** | **Code freeze** and tag | All | Release tag created |
| 44–48 | Rehearse the demo five times; prepare Q\&A; backup laptop | All | Demo under 90 seconds |

**Rest:** each person sleeps five to six hours in staggered blocks, never during hours 18–25 or 34–44 for the owner of the critical path.

**Cut order if you fall behind.** Cut the B-series first, in this order: B16, B18, B14, B2, B15, B10, B13, B9, B4, B17, then B8 and B11, and last the cheapest and most visible ones (B1, B3, B5, B6, B7, B12). Then cut add-ons, in this order: A2 route demo, A10 fingerprints, A6 playbook memory, A12 radar, A8 lineage graph, the A5 scrubber (keep a static timeline), the WhatsApp and email styling of A1 (keep in-app messages), then A11. A3, A4, A7 and A9 are the add-ons that strengthen the core governance story, so cut them last. After the add-ons, cut from the bottom of this list: polish and animations, red-team grid UI (keep the test script), notification detail, live microphone (keep the sample transcript and editable text), Challenge Plan UI polish. Never cut M1–M6, S1 or S2.

## 16. 90-second demo script

**Before you start:** run Admin reset; the cockpit shows zero active disruptions; Scenario A is seeded; you are signed in as the Analyst; the LLM cache is warm; microphone permission is granted; the Use sample transcript button is visible.

| Time | Screen and exact action | What you say |
| --- | --- | --- |
| 0–6 s | Operations cockpit. Point to the four tiles at zero. | A shipment goes wrong. The hard part is knowing which customers are hurt and what we can safely do. |
| 6–18 s | Disruption investigation, Field report panel. Click the mic and say: SHP-204 Hosur warehouse-la 70 box damage, lorry rendu mani neram late. If it misfires, click Use sample transcript. The card shows SHP-204, WH-HOS, 70 damaged, 2 hours late, confidence 0.94. | A warehouse operator reports in mixed Tamil and English. AI structures it. Nothing is saved until a human confirms. |
| 18–28 s | Click Confirm; the ETA chip moves from 10:00 to 12:00. Open Intake, click Send duplicate storm. The toast reads 5 sent, 1 applied, 4 duplicates ignored, 1 stale kept, 1 conflict raised. | Duplicates change nothing, stale updates are kept as history, and real conflicts go to a human. |
| 28–38 s | Impact and risk. Show ORD-1042, ORD-1047, ORD-1051 ranked. Click ORD-1047, then the Shortage factor; the evidence drawer opens on the inventory row. | Every point of risk links to a source row, and shows a best-to-worst range. |
| 38–52 s | Recovery workbench. Click Generate Recovery Plan. Show baseline ₹16,000 vs plan ₹6,825, the per-order bars, and the collateral panel (WH-CHN free stock 15 to 0, ORD-1051 split 45 and 5). | One solver allocates scarce stock across all three orders at once, and shows who still gets hurt. |
| 52–62 s | Click Challenge Plan. The claim WH-BLR has 40 units available fails: expected 40, actual 10; Submit is disabled. Click Regenerate; all claims turn green. | The AI cannot invent stock. The database overrules it. |
| 62–78 s | Click Submit. As Analyst click Approve; a 403 toast reads Self-approval not allowed. Switch to Manager, Approve. Switch to Procurement, Approve. Switch to Manager, Confirm and Execute. | Different people, different roles, enforced by the server, not the buttons. |
| 78–90 s | Audit and ledger. Show before and after stock and that Rollback is eligible. Back on the cockpit show recovery progress. | DisruptionIQ does not just recommend a recovery. It proves, governs and records it. |

The numbers above come from the seeded Scenario A; the screen must show what the engine actually computes.

**Backups:** sample transcript button, warm LLM cache, local Docker run, a recorded video of the full flow, and the Admin reset between rehearsals. The add-on beats below are optional and must not be inserted into the 90-second run.

**If a judge wants more:** open two tabs and approve two competing plans at the same time to show the Double-Booking Shield, then click Red-Team Button. For a longer slot or a deep-dive, use the add-on beats below.

**Second required scenario, end to end (Scenario B, about 60 seconds if asked):**

| Item | Value |
| --- | --- |
| Stock | WH-CHN holds 10 units of SKU-205 |
| Inbound | SHP-310: 60 units, carrier ETA 16:00 today |
| Conflict | The supplier portal says 01:00 tomorrow, 9 hours apart, which is over the 4-hour tolerance |
| Resolution | The Manager resolves in favour of the supplier portal; a LATE\_SHIPMENT disruption opens |
| ORD-2001 | 35 units, due 22:00 today, ₹400 per unit short, priority 4 |
| ORD-2002 | 25 units, due 08:00 tomorrow, ₹250 per unit short, priority 2 |
| Option | WH-BLR: 30 free units, 4 h lane, ₹40 per unit |
| Expected result | Baseline penalty ₹10,000 (25 units short on ORD-2001). Plan: transfer 25 units for ₹1,000. Saving ₹9,000 (90%). Approval: Manager only, because it is a REALLOCATE action. |

**Add-on beats (optional, about 2 to 3 extra minutes, or pick two or three):**

| Beat | Screen and exact action | What you say |
| --- | --- | --- |
| Radar (10 s) | Cockpit, Single-Point-of-Failure Radar. Point to SUP-1 into WH-HOS for SKU-101 at the top. | We flagged this dependency before anything broke. |
| Fingerprint and playbook (15 s) | Open the Scenario A disruption. The fingerprint banner shows “SUP-1 delays in festival-peak windows”; the playbook card shows the closest past case and its lesson. | The system recognises the pattern and recalls what worked last time and what it cost. |
| Lineage (15 s) | Impact and risk, click ORD-1047, open the lineage graph, click an edge. | Every link from supplier to order has evidence, a timestamp and a calculation. |
| Promise dates (10 s) | Show the three date chips on ORD-1051. | Not just “late”: the best date we can really achieve and the date we commit. |
| Routes and trade-offs (20 s) | Recovery workbench: switch between route options, then read the trade-off ledger. | Each fix shows who it saves and who it hurts, so the recommendation is honest. |
| Guardrail (15 s) | Switch to Scenario B, tighten the transfer-distance or lead-time limit, regenerate. The meter turns BREACH and the Procurement Approver is added. | Over-limit plans escalate; the AI cannot quietly spend past the limit. |
| Conflict Court (20 s) | Open two tabs and submit the Scenario A plan and the seeded competing plan. The court card shows both claims; as Manager pick a winner. | Two plans cannot take the same stock; a human must choose and give a reason. |
| Replay (15 s) | Audit tab, drag the scrubber from webhook to simulated execution. | Judges can see exactly why each decision happened. |
| Stress-Test (20 s) | Audit and security, click Run all injectors; show the report. | Chaos goes in, and the report says exactly what was ignored, quarantined or rejected. |
| Notifications (10 s) | Click the bell; open a message and follow its link. | The right person is told at the right moment, with a link to the task. |

**Micro-feature beats (optional, pick two or three; never inside the 90-second run):**

| Beat | Screen and exact action | What you say |
| --- | --- | --- |
| KPI strip, map and alerts (15 s) | Cockpit: click the Delayed shipments card, then open the map tab. SHP-204 and WH-HOS are highlighted; point to the one alert for the late shipment. | Every card is a live count, every alert appears once, and every node shows the orders behind it. |
| Ask the Desk (15 s) | Click the chip Which orders are affected?; the three orders appear with a proof chip. Type approve the plan; it is refused. | The assistant answers from the database and cannot act. |
| What-if (20 s) | Recovery workbench, What-If tab: set damaged units to 70 and delay to 2 hours; the ₹16,000 and ₹6,825 figures appear marked SIMULATION; show that no stock or reservation changed. | We can try a scenario safely; it never touches real data. |
| Email ingestion (15 s) | Intake: paste the sample supplier email for SHP-310; confirm the card; a CONFLICT card appears against the carrier ETA. | A message cannot quietly override the carrier; conflicts go to a human. |
| Delegation (15 s) | Approvals: as the Manager, delegate to the second Manager; try to approve as the delegator and get a 403. | Delegation moves the authority; it never removes the separation of duties. |
| Provenance chain (15 s) | Audit: click Verify chain (passes); run Tamper one audit row; verify again and read the broken row ID. | Tampering with history is detectable, with no blockchain needed. |
| Customer notice (10 s) | After approval, open Notice drafts; release one as the Manager; open it in the simulated outbox. | Customers hear the committed date, only after a human approves. |

## 17. Judge pitch (about 3 minutes)

**Hook (15 s).** It is 11 pm. A supplier’s lorry is two hours late and 70 boxes are damaged. Three customers are waiting on that stock. Who gets hurt, what do you do, and how do you know your AI is not guessing?

**Problem (20 s).** Delay news comes from carriers, suppliers, warehouses and order systems that disagree. Teams spend hours working out which orders are hurt and which fix is real. Spotting a late shipment is easy; the consequences are hard.

**Hidden insight (20 s).** Recovery options compete for the same scarce stock. Fix one order and you may break another. And an AI that cannot be checked against real inventory will eventually invent stock.

**Solution (25 s).** DisruptionIQ Verified Recovery Desk reconciles every event into one trusted shipment state, traces it to orders, and solves one allocation across all of them. Every claim in the plan is proven against the database. Only a different, authorised human can approve, and execution is simulated, logged and reversible.

**Add-on line (10 s, optional).** Around that core loop sit twelve supporting features: a failure radar, promise-date repair, a trade-off ledger, an allocation court, budget guardrails, a decision replay, a playbook memory and a stress-test mode. They all run on the same verified data.

**Micro-feature line (10 s, optional).** You will recognise the control-tower surface: KPI cards, a network map, an alert feed, a read-only assistant, a what-if simulator and email ingestion. Here they all read from the same verified data, and none of them can change stock without a human approval.

**Live demo (90 s).** Follow section 16.

**Impact (20 s).** In our seeded scenario the verified plan cuts penalty exposure from ₹16,000 to ₹6,825, a 57% reduction, recovers two of three at-risk orders in full and splits the third. In the second scenario it avoids 90% of exposure. Every injected false claim, duplicate and self-approval was blocked. These are simulation results on synthetic data.

**Future scale (20 s).** Real carrier APIs and ERP connectors, WhatsApp voice notes, an offline warehouse app, e-way bill and contract-clause checks, multi-tier suppliers, and a risk model calibrated on real outcomes. The governance loop stays the same.

**Close.** The AI proposes. The code proves. Humans decide. The ledger remembers.

## 18. Five likely judge questions

**1. Kinaxis, SAP IBP and o9 already do disruption response. What is new here?** They have mature planning and simulation, and we do not claim to out-optimise them. Our difference is one lightweight, governed loop: messy multilingual field intake, reconciled truth, a single portfolio plan, AI claims proven against the database before approval, enforced separation of duties and reversible execution. It is built for operators who cannot buy an enterprise suite.

**2. Is the optimiser a toy, and is the risk score machine learning?** The solver is a small integer program, and we call it portfolio-level constrained optimisation, not global. We test it against brute force on the seeded instance, and the baseline uses the same model so the comparison is fair. The risk score is a transparent, deterministic policy formula, not a prediction, and we show the factors and evidence behind it.

**3. How do you stop the AI from hallucinating stock or supplier capacity?** The AI never writes to the database and never does inventory arithmetic. It outputs structured claims, and code checks each one against the records. Anything unsupported blocks the plan. Press Challenge Plan and you can watch it happen.

**4. What prevents two people approving plans that use the same stock, or approving their own plan?** Reservations are an atomic conditional database update inside a transaction, so two plans cannot hold the same units. Approvals check the contract hash, so a changed plan must be re-verified. Roles, separation of duties and the Administrator’s inability to approve are enforced in the backend, and the Red-Team Button attacks the API directly to prove it.

**5. Is this production-ready, and what if the voice demo fails?** No, and we say so: it uses synthetic data and a simulated carrier, and execution is simulated. Intake, reconciliation, optimisation, approval and execution are separate modules so real integrations can replace the simulators. The voice path has an editable transcript, a sample transcript and a rule-based extractor, and a human confirms before anything is saved.

**Bonus questions on the add-ons**

**6. Is Playbook Memory or Root-Cause Fingerprinting machine learning?** No. Playbook retrieval is a visible weighted similarity score over stored case fields, and a fingerprint is a rule that becomes active after three matching cases. They run on seeded history and say so. We do not claim a trained model.

**7. Is the Route-Optimization Demo a routing engine?** No. It enumerates direct and one-hop options from the seeded lane tables, drops any that miss a deadline, and feeds the rest to the same solver. The route diagram is there to explain order impact, not to replace a transport management system.

**8. Twelve extra features in 48 hours sounds risky. How do you protect the core?** Add-ons start only after the core loop works at hour 25, they reuse the same data and checks, and we have a written cut order. The must-build features and the two safety features, Double-Booking Shield and Reversible Ledger, are never cut.

**9. KPI cards, a map, alerts and a chatbot are what every team builds. Why include them?** Because a judge expects a control-tower surface, and leaving it out would look like a gap. The difference is what sits behind it: every card is a count over the same linked tables, every alert is deduplicated by condition, the assistant is read-only and its numbers are checked against the database, and none of these surfaces can change stock. The decision loop is the product; the surface is its front door.

**10. Can Ask the Desk hallucinate?** Answers come from fixed, parameterised queries. The optional LLM only rephrases the rows it is given, and every number and entity it names is checked as an ANSWER\_FACT claim; if a check fails, the template answer is shown instead. It has no write path, and a request such as approve the plan is refused and logged.

**11. Is the provenance chain a blockchain?** No, and we do not call it one. It is a SHA-256 hash chain over our own audit and ledger tables, so tampering is detectable. There are no tokens, no consensus and no distributed nodes. The Verify chain button shows it working, and a direct database edit breaks it.

**12. Is the what-if simulator a digital twin?** No. It re-runs our own impact logic and solver on an in-memory copy under a read-only database role, and labels the result SIMULATION. It changes nothing and cannot be submitted; a real change still needs an event that a human confirms.

## 19. Three metrics that prove real-world impact

| Metric | How it is measured | Seeded result | Honest label |
| --- | --- | --- | --- |
| Penalty exposure avoided | (baseline penalty − (plan cost + residual penalty)) / baseline penalty, from the solver | Scenario A: 57% (₹9,175 of ₹16,000). Scenario B: 90% (₹9,000 of ₹10,000). | Simulation on synthetic data, not real savings |
| Signal-to-approved-plan time | Timestamps from event received to plan approved. Baseline: a teammate solves Scenario A by hand in a spreadsheet, timed before the demo. | Target: under 3 minutes in the tool; record the manual time yourselves | Do not quote a manual time you have not measured |
| Governance integrity | Red-team suite blocked, duplicate state changes, oversubscribed reservations in the 50-run concurrency loop, false claims caught | Target: 12 of 12 attacks blocked, 0 extra state changes, 0 oversubscriptions, 100% of injected false claims blocked | Measured by the automated tests |

**Supporting add-on measures (optional to quote)**

| Measure | How it is measured | Honest label |
| --- | --- | --- |
| Orders with a repaired promise date | Share of affected orders that get a best recoverable date and a committed date | Simulation on synthetic data |
| Guardrail escalations | Plans that breached a limit and were escalated, against plans that passed | Measured by the automated tests |
| Stress-Test survival | Injected items handled with zero unhandled errors, plus counts of ignored, quarantined, held and rejected items | Measured by the automated tests |
| Single points of failure flagged early | Seeded dependencies flagged before the disruption opened | Seeded scenario, not a real-world detection rate |
| Alert noise | Duplicate open alerts per distinct condition across a Stress-Test run (target 0) | Measured by the automated tests |
| What-if isolation | Rows changed in inventory, reservations, ledger and approvals by what-if runs (target 0) | Measured by the automated tests |
| Provenance integrity | Injected tampering detected by Verify chain (target 100%) | Measured by the automated tests |
| Assistant accuracy | ANSWER\_FACT claims passing on the seeded question set (target 100%), and write intents refused (target 100%) | Measured by the automated tests |

## 20. Why this project will stand out

- **It solves the hard part.** Most teams detect and display. We decide, across competing orders, and show who still gets hurt.
- **The AI is accountable.** Claims are proven or blocked, and Challenge Plan makes that visible in ten seconds.
- **Governance is real.** Backend roles, separation of duties, contract hashes and atomic reservations survive a judge calling the API directly.
- **It handles messy reality.** Duplicates, stale updates, conflicts and bad rows are core features, not afterthoughts.
- **Execution is reversible.** A ledger with compensating entries, not a status flip.
- **Tanglish voice is a memorable entry point,** and it is wrapped in confirmation, an audit link and a fallback, so it is a trustworthy intake feature and not a gimmick.
- **The claims are honest.** We say portfolio-level optimisation, deterministic risk and simulated execution, which is hard for a judge to knock down.
- **Both required scenarios run end to end** on a persistent database with synthetic data.
- **It tells the truth about trade-offs.** The Trade-off Ledger and the Allocation Conflict Court show who each fix hurts and force an explicit winner.
- **It repairs promises, not just flags lateness.** The Promise-Date Repair Engine shows original, best recoverable and committed dates.
- **It shows its reasoning.** The Event Lineage Graph and Decision Replay Timeline let a judge follow every decision step by step.
- **It stays inside its limits.** Budget Guardrails escalate instead of overspending, and Stress-Test Mode proves the system survives chaos.
- **It learns without pretending to be ML.** Playbook Memory, Root-Cause Fingerprinting and the Single-Point-of-Failure Radar use visible rules over real history and live dependencies.
- **It has the full control-tower surface and keeps it honest.** KPI cards, a network map, an alert feed, risk bands and a read-only assistant all read from the same verified data, and every number can be traced.
- **Nothing on the surface can change stock.** Detectors, the assistant, the what-if simulator and the projections are read-only or sandboxed; only the governed loop writes.
- **Messy input is welcome, not trusted.** Pasted emails and texts, duplicate rows and conflicting files all go through the reconciler and a human confirmation.
- **History is tamper-evident.** A hash chain over the audit and ledger tables, with a Verify button that names the broken row, gives provenance without a blockchain.
