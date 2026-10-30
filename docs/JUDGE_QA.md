# DisruptionIQ — Judge Q&A & Architecture Defense

This document prepares the team for technical and operational questions from hackathon judges, enterprise architects, and supply chain executives.

---

### Q1: How do you prevent AI hallucinations in high-stakes supply chain decisions?
**Answer:**
DisruptionIQ employs a **zero-hallucination neuro-symbolic architecture**.
- Generative AI is strictly isolated to the **intake boundary** (transcribing voice and structuring field notes into typed JSON).
- All operational decisions — inventory allocation, transfer routing, cost-penalty optimization, and promise dates — are computed by an **exact Operations Research solver** (Google OR-Tools CP-SAT).
- Before any plan can be viewed or approved, a deterministic **Proof Checker** executes 4 hard mathematical guardrails (conservation of mass, non-negative balances, valid transfer lanes, and lead-time physics).
- If any guardrail fails, the plan is rejected outright before reaching a human operator.

---

### Q2: How do you enforce separation of duties and prevent unauthorized approvals?
**Answer:**
We implement **Governed Multi-Role Approvals** with cryptographic audit trails:
- **Self-Approval Prohibition**: The user who triggers or generates a recovery plan cannot approve it (enforced via server-side HTTP 403 `SELF_APPROVAL_FORBIDDEN`).
- **Dual-Control Threshold**: Any recovery action involving expenditure over **INR 5,000** mandates dual-role sign-off (both Operations Manager and Procurement Lead).
- **Delegation Windows**: Operators cannot share credentials; formal delegation records specify exact time bounds and allowed scopes.
- **Audit Verification**: Every approval, rejection, and modification is permanently recorded in a SHA-256 linked hash chain.

---

### Q3: How do you handle simultaneous race conditions, such as two warehouses claiming the same spare inventory?
**Answer:**
We built the **Double-Booking Shield and Conflict Court**:
- Multi-document ACID transactions in MongoDB execute with a **canonical lock ordering** on `(warehouse_id, sku_id)` to prevent deadlocks.
- The inventory balance schema strictly enforces `reserved <= on_hand` at the database level.
- When two recovery plans compete for the same stock, the first transaction commits atomically; the second immediately receives an **HTTP 409 Conflict**.
- The UI routes conflicting claims to the **Allocation Conflict Court**, comparing customer tier, delivery deadlines, and SLA penalties side-by-side so an authorized manager can pick a winner with an audited rationale.

---

### Q4: What happens if external internet or third-party AI APIs (Groq/OpenAI) fail?
**Answer:**
The system features **100% offline operational continuity**:
- If `GROQ_API_KEY` is unavailable or network is severed, the intake engine immediately falls back to its deterministic Tanglish/English rule-based parser.
- The LP solver runs as a local microservice (`FastAPI + OR-Tools`), requiring zero internet access.
- Warehouse operators on the mobile view have an **IndexedDB offline draft queue** that buffers field notes and syncs upon reconnection.
- Judges can disconnect internet connectivity entirely, and the demo script runs identically.

---

### Q5: How do you guarantee reversibility if an executed recovery route fails midway?
**Answer:**
DisruptionIQ implements an **Audited Rollback Engine**:
- Executing an action writes an atomic before-and-after ledger delta.
- Within an active disruption window, an authorized Manager can invoke **Rollback**.
- The engine verifies whether inventory has physically departed. If eligible, it atomically releases reservations, cancels pending warehouse transfer orders, restores previous promise dates, and logs a `PLAN_ROLLED_BACK` event to the immutable chain.

---

### Bonus Q6: How does the Belief-ETA reconciler prevent bad carrier data from corrupting supply chain forecasts?
**Answer:**
Carrier webhooks and IoT pings are evaluated against a **Trust Hierarchy**:
1. Carrier IoT / Telematics (Trust Level 4)
2. Warehouse Driver Field Reports (Trust Level 3)
3. Supplier EDI / Portal (Trust Level 2)
4. Unverified Scraped Texts (Trust Level 1)

When new telemetry arrives within a 240-minute tolerance of existing signals, the higher-trust ETA is applied. If signals diverge beyond tolerance, an **ETA Conflict** is raised (`UNDER_REVIEW`), preventing automated downstream churn until an analyst reviews both data points.

---

### Bonus Q7: How can auditors verify that database records haven't been tampered with?
**Answer:**
DisruptionIQ maintains an immutable **SHA-256 Merkle-style audit chain**:
- Each audit record incorporates the cryptographic hash of the preceding record: `hash = SHA256(prev_hash + actor + action + payload + timestamp)`.
- The `GET /audit/verify` endpoint walks the entire chain from genesis to head.
- In our live demo, judges can click **Tamper One Row** (simulating an insider database injection); running **Verify Chain** instantly catches the corruption, pinpoints the exact damaged record ID, and provides a **Restore** capability.
