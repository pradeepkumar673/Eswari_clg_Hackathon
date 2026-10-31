/**
 * apps/api/src/routes/plans.ts
 *
 * Step 7 & Step 8 — Recovery plan endpoints:
 *
 *   POST   /disruptions/:id/recovery-plans  (Analyst, Manager)
 *   GET    /plans/:id
 *   GET    /plans/:id/tradeoffs
 *   GET    /plans/:id/cards
 *   PATCH  /plans/:id                       (Analyst, Manager)
 *   POST   /plans/:id/verify                (Analyst, Manager)
 *   POST   /plans/:id/challenge             (Analyst, DEMO_MODE)
 *   DELETE /plans/:id/challenge             (Analyst, DEMO_MODE)
 *   POST   /plans/:id/submit                (Analyst, Manager)
 *   POST   /plans/:id/approve               (Manager, Procurement_Approver)
 *   POST   /plans/:id/reject                (Manager, Procurement_Approver)
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose, { ClientSession } from 'mongoose';
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Sku } from '../models/skus.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction } from '../models/plan-actions.js';
import { PlanTradeoff } from '../models/plan-tradeoffs.js';
import { PlanClaim } from '../models/plan-claims.js';
import { Approval } from '../models/approvals.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { enumerateCandidates, OrderDeadline } from '../services/candidates.js';
import {
  verifyPlan,
  injectChallenge,
  clearChallengeClaims,
  deriveRequiredApproverRoles,
  computeContractHash,
} from '../services/proofChecker.js';
import { reserveStock, releaseStock, commitStock } from '../services/reservations.js';
import { runGuardrailChecks } from '../services/guardrails.js';
import { computePromiseDatesForPlan } from '../services/promiseDates.js';
import { GuardrailCheck } from '../models/guardrail-checks.js';
import { ExecutionLedger } from '../models/execution-ledger.js';
import { ApprovalDelegation } from '../models/approval-delegations.js';
import { SimulationRun } from '../models/simulation-runs.js';
import { writeAudit, writeLedgerEntry } from '../services/audit.js';
import { withTransaction } from '../db/withTransaction.js';
import { simClock } from '../services/simClock.js';
import { publish } from '../services/bus.js';
import { config } from '../config.js';

export const plansRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(res: Response, status: number, code: string, message: string, details?: any): void {
  res.status(status).json({ error: { code, message, details: details || null } });
}

function isObjectId(s: string): boolean {
  return mongoose.Types.ObjectId.isValid(s);
}

// ---------------------------------------------------------------------------
// POST /disruptions/:id/recovery-plans
// ---------------------------------------------------------------------------
plansRouter.post(
  '/disruptions/:id/recovery-plans',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid disruption id'); return; }

      const disruption = await Disruption.findById(id);
      if (!disruption) { err(res, 404, 'NOT_FOUND', 'Disruption not found'); return; }

      const now = await simClock.now();

      // Load shipment
      const shipment = await Shipment.findById(disruption.shipment_id).lean();
      if (!shipment) { err(res, 422, 'NO_SHIPMENT', 'Disruption has no linked shipment'); return; }

      const destWarehouseId = (shipment as any).warehouse_id;

      // Load SKUs from shipment lines
      const shipmentLines = await ShipmentLine.find({ shipment_id: shipment._id }).lean();
      if (shipmentLines.length === 0) {
        err(res, 422, 'NO_SHIPMENT_LINES', 'Shipment has no lines'); return;
      }

      const skuId = (shipmentLines[0] as any).sku_id;
      const sku = await Sku.findById(skuId).lean();
      if (!sku) { err(res, 422, 'NO_SKU', 'SKU not found'); return; }

      const Warehouse = mongoose.model('Warehouse');
      const destWh = await Warehouse.findById(destWarehouseId).lean();
      if (!destWh) { err(res, 422, 'NO_WAREHOUSE', 'Destination warehouse not found'); return; }

      const openOrders = await Order.find({
        warehouse_id: destWarehouseId,
        status: { $in: ['OPEN', 'RECOVERING'] },
      }).lean();

      if (openOrders.length === 0) {
        err(res, 422, 'NO_ORDERS', 'No open orders affected by this disruption'); return;
      }

      const affectedOrders: typeof openOrders = [];
      for (const order of openOrders) {
        const line = await OrderLine.findOne({ order_id: order._id, sku_id: skuId }).lean();
        if (line) affectedOrders.push(order);
      }

      if (affectedOrders.length === 0) {
        err(res, 422, 'NO_AFFECTED_ORDERS', 'No open orders have lines for the disrupted SKU'); return;
      }

      const orderDeadlines: OrderDeadline[] = affectedOrders.map((o) => ({
        sku_id: skuId.toString(),
        sku_code: (sku as any).code,
        fulfil_warehouse_id: destWarehouseId.toString(),
        fulfil_warehouse_code: (destWh as any).code,
        due_hours_from_now: Math.max(0, (o.due_at.getTime() - now.getTime()) / 3_600_000),
      }));

      const candidates = await enumerateCandidates(orderDeadlines);

      const srcBalance = await InventoryBalance.findOne({
        warehouse_id: destWarehouseId,
        sku_id: skuId,
      }).lean();
      const freeStock = srcBalance
        ? Math.max(0, (srcBalance as any).on_hand - (srcBalance as any).reserved)
        : 0;

      const sources = freeStock > 0
        ? [{
            type: 'FREE_STOCK' as const,
            warehouse: (destWh as any).code,
            sku: (sku as any).code,
            free_units: freeStock,
            arrival_hours: 0,
          }]
        : [];

      const solverPayload = {
        orders: affectedOrders.map((o) => ({
          code: o.code,
          sku: (sku as any).code,
          quantity: o.total_units,
          due_hours_from_now: Math.max(0, (o.due_at.getTime() - now.getTime()) / 3_600_000),
          fulfil_warehouse: (destWh as any).code,
          penalty_per_unit: o.penalty_per_hour,
        })),
        sources,
        candidates,
        sim_now: now.toISOString(),
        time_limit: 2,
      };

      const solverUrl = config.SOLVER_URL;
      let solverResult: any;
      try {
        const solverRes = await fetch(`${solverUrl}/solve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(solverPayload),
          signal: AbortSignal.timeout(10_000),
        });
        if (!solverRes.ok) {
          const body = await solverRes.text().catch(() => '');
          err(res, 503, 'SOLVER_ERROR', `Solver returned ${solverRes.status}: ${body}`); return;
        }
        solverResult = await solverRes.json();
      } catch {
        err(res, 503, 'SOLVER_UNAVAILABLE', 'Solver service is unavailable'); return;
      }

      const existingCount = await RecoveryPlan.countDocuments({ disruption_id: disruption._id });
      const version = existingCount + 1;

      const actionTypes: string[] = (solverResult.actions || []).map((a: any) => a.type as string);
      let strategy: 'REALLOCATE' | 'EXPEDITE' | 'SPLIT' | 'BACKORDER' | 'HYBRID' = 'HYBRID';
      if (actionTypes.length === 0) strategy = 'BACKORDER';
      else if (actionTypes.every((t) => t === 'TRANSFER' || t === 'VIA')) strategy = 'REALLOCATE';
      else if (actionTypes.every((t) => t === 'ALT_SUPPLIER' || t === 'EXPEDITE')) strategy = 'EXPEDITE';

      const objectiveValue: number = solverResult.objective ?? 0;
      const baselineValue: number = solverResult.baseline_objective ?? 0;
      const saving = baselineValue - objectiveValue;

      const planData: any = {
        disruption_id: disruption._id,
        version,
        status: 'DRAFT',
        strategy,
        total_cost: objectiveValue,
        residual_risk: Math.min(
          100,
          Math.round(
            ((solverResult.collateral?.length ?? 0) / Math.max(1, affectedOrders.length)) * 100,
          ),
        ),
        narrative: `v${version} — ${solverResult.scope}. Baseline ₹${baselineValue}, plan ₹${objectiveValue}, saving ₹${saving}.`,
        created_by: req.user!._id,
        created_at: now,
        approved_at: null,
      };

      const plan = new RecoveryPlan(planData);
      (plan as any).objective_value = objectiveValue;
      (plan as any).baseline_value = baselineValue;
      (plan as any).scope = solverResult.scope ?? 'portfolio-level constrained optimisation';
      (plan as any).per_order = solverResult.per_order ?? [];
      (plan as any).collateral = solverResult.collateral ?? [];
      await plan.save();

      const actionDocs = (solverResult.actions || []).map((a: any, idx: number) => {
        const actionTypeMap: Record<string, 'RESERVE' | 'TRANSFER' | 'EXPEDITE' | 'BACKORDER' | 'SPLIT'> = {
          TRANSFER: 'TRANSFER',
          ALT_SUPPLIER: 'RESERVE',
          EXPEDITE: 'EXPEDITE',
          VIA: 'TRANSFER',
        };
        return {
          plan_id: plan._id,
          seq: idx + 1,
          action_type: actionTypeMap[a.type] ?? 'TRANSFER',
          from_warehouse_id: null,
          to_warehouse_id: destWarehouseId,
          sku_id: skuId,
          quantity: a.units,
          cost: a.total_cost,
          duration_hours: a.lead_hours,
          status: 'PENDING',
        };
      });

      if (actionDocs.length > 0) {
        await PlanAction.insertMany(actionDocs);
      }

      const tradeoffDocs = (solverResult.per_order || []).map((po: any) => ({
        plan_id: plan._id,
        axis: `order:${po.code}`,
        value: po.backordered_units,
        unit: 'units_backordered',
      }));
      if (tradeoffDocs.length > 0) {
        await PlanTradeoff.insertMany(tradeoffDocs);
      }

      await writeAudit({
        action: 'RECOVERY_PLAN_CREATED',
        actor: req.user!._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { disruption_id: id, version, strategy, objective: objectiveValue },
      });

      res.status(201).json({
        plan_id: plan._id,
        version,
        status: 'DRAFT',
        strategy,
        objective: objectiveValue,
        baseline_objective: baselineValue,
        saving,
        saving_pct: baselineValue > 0 ? Math.round((saving / baselineValue) * 100) : 0,
        actions: solverResult.actions,
        per_order: solverResult.per_order,
        collateral: solverResult.collateral,
        scope: solverResult.scope,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /disruptions/:id/recovery-plans/latest
// Newest plan for a disruption, or plan_id: null if none has been generated.
// ---------------------------------------------------------------------------
plansRouter.get(
  '/disruptions/:id/recovery-plans/latest',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid disruption id'); return; }

      const plan: any = await RecoveryPlan.findOne({ disruption_id: id })
        .sort({ version: -1 })
        .select('_id version status')
        .lean();

      res.status(200).json({
        plan_id: plan ? String(plan._id) : null,
        version: plan?.version ?? null,
        status: plan?.status ?? null,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /plans/:id
// ---------------------------------------------------------------------------
plansRouter.get(
  '/plans/:id',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const plan = await RecoveryPlan.findById(id).lean();
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const actions = await PlanAction.find({ plan_id: plan._id }).sort({ seq: 1 }).lean();
      const tradeoffs = await PlanTradeoff.find({ plan_id: plan._id }).lean();
      const claims = await PlanClaim.find({ plan_id: plan._id, plan_version: plan.version }).lean();

      const p = plan as any;
      const objVal: number = p.objective_value ?? plan.total_cost ?? 0;
      const baseVal: number = p.baseline_value ?? 0;
      const saving = baseVal - objVal;

      res.json({
        plan: {
          _id: plan._id,
          disruption_id: plan.disruption_id,
          version: plan.version,
          status: plan.status,
          strategy: plan.strategy,
          objective: objVal,
          baseline_objective: baseVal,
          saving,
          saving_pct: baseVal > 0 ? Math.round((saving / baseVal) * 100) : 0,
          scope: p.scope ?? 'portfolio-level constrained optimisation',
          contract_hash: plan.contract_hash,
          decision_contract: plan.decision_contract,
          narrative: plan.narrative,
          created_at: plan.created_at,
          approved_at: plan.approved_at,
          submitted_at: plan.submitted_at,
        },
        actions,
        per_order: p.per_order ?? [],
        collateral: p.collateral ?? [],
        tradeoffs,
        claims,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /plans/:id/tradeoffs
// ---------------------------------------------------------------------------
plansRouter.get(
  '/plans/:id/tradeoffs',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const plan = await RecoveryPlan.findById(id).lean();
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const tradeoffs = await PlanTradeoff.find({ plan_id: plan._id }).lean();

      res.json({ plan_id: id, tradeoffs });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /plans/:id/cards (Step 8 upgrade: FEASIBLE vs BLOCKED vs PENDING)
// ---------------------------------------------------------------------------
plansRouter.get(
  '/plans/:id/cards',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const plan = await RecoveryPlan.findById(id).lean();
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const actions = await PlanAction.find({ plan_id: plan._id }).sort({ seq: 1 }).lean();
      const claims = await PlanClaim.find({ plan_id: plan._id, plan_version: plan.version }).lean();

      const p = plan as any;
      const objVal: number = p.objective_value ?? plan.total_cost ?? 0;
      const baseVal: number = p.baseline_value ?? 0;
      const saving = baseVal - objVal;
      const actionCostTotal = actions.reduce((s, a) => s + a.cost, 0);

      const cards = actions.map((a) => {
        // Find claims associated with this action
        const actionClaims = claims.filter(
          (c) => c.action_id && c.action_id.toString() === a._id.toString(),
        );

        let feasibilityStatus: 'FEASIBLE' | 'BLOCKED' | 'PENDING_VERIFICATION' = 'PENDING_VERIFICATION';
        let failingClaim: any = null;

        if (plan.status === 'DRAFT') {
          feasibilityStatus = 'PENDING_VERIFICATION';
        } else if (plan.status === 'VERIFIED' || plan.status === 'APPROVED' || plan.status === 'PENDING_APPROVAL') {
          feasibilityStatus = 'FEASIBLE';
        } else if (plan.status === 'BLOCKED') {
          const failed = actionClaims.find((c) => c.status === 'FAIL') || claims.find((c) => c.status === 'FAIL');
          if (failed) {
            feasibilityStatus = 'BLOCKED';
            failingClaim = {
              claim_type: failed.claim_type,
              expected: failed.expected,
              actual: failed.actual,
              origin: failed.origin,
            };
          } else {
            feasibilityStatus = 'FEASIBLE';
          }
        }

        const checklist = [
          {
            check: 'Donor stock confirmed',
            passed: actionClaims.find((c) => c.claim_type === 'AVAILABLE_STOCK')?.status === 'PASS',
          },
          {
            check: 'Transit lane active',
            passed: actionClaims.find((c) => c.claim_type === 'ROUTE_FEASIBLE')?.status === 'PASS',
          },
          {
            check: 'Supplier capacity verified',
            passed: actionClaims.find((c) => c.claim_type === 'SUPPLIER_CAPACITY')?.status === 'PASS',
          },
        ];

        return {
          card_id: `${id}-card-${a.seq}`,
          seq: a.seq,
          action_type: a.action_type,
          quantity: a.quantity,
          cost: a.cost,
          benefit: actionCostTotal > 0 ? Math.round((a.cost / actionCostTotal) * saving) : 0,
          feasibility_status: feasibilityStatus,
          failing_claim: failingClaim,
          feasibility_checklist: checklist,
          tradeoff_link: `/plans/${id}/tradeoffs`,
          duration_hours: a.duration_hours,
        };
      });

      const cardCostTotal = cards.reduce((s, c) => s + c.cost, 0);

      res.json({
        plan_id: id,
        plan_status: plan.status,
        scope: p.scope ?? 'portfolio-level constrained optimisation',
        cost_total: cardCostTotal,
        benefit_total: saving,
        cards,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/verify (Proof Checker execution)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/verify',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      // Check if id belongs to a simulation run
      const isSim = await SimulationRun.findById(id);
      if (isSim) {
        err(res, 409, 'CANNOT_SUBMIT_SIMULATION', 'Cannot submit a simulation run as an operational recovery plan');
        return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const result = await verifyPlan(plan._id);

      await writeAudit({
        action: 'RECOVERY_PLAN_VERIFIED',
        actor: req.user!._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: {
          status: result.status,
          claimsCount: result.claims.length,
          failingCount: result.failing_claims.length,
          contract_hash: result.contract_hash,
        },
      });

      res.status(200).json({
        plan_id: plan._id,
        version: plan.version,
        status: result.status,
        claims: result.claims,
        contract_hash: result.contract_hash,
        decision_contract: result.decision_contract,
        failing_claims: result.failing_claims,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/challenge (Analyst, DEMO_MODE)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/challenge',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      if (!config.DEMO_MODE) {
        err(res, 403, 'DEMO_MODE_REQUIRED', 'Challenge plan is only available in DEMO_MODE'); return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const text = req.body.claim_text || 'WH-BLR has 40 units of SKU-101 available';
      const expected = req.body.expected !== undefined ? req.body.expected : 40;
      const actual = req.body.actual !== undefined ? req.body.actual : 10;

      const challengeClaim = await injectChallenge(plan._id, text, expected, actual);
      const verifyRes = await verifyPlan(plan._id);

      await writeAudit({
        action: 'PLAN_CHALLENGE_INJECTED',
        actor: req.user!._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { challenge_claim_id: challengeClaim._id.toString(), expected, actual },
      });

      res.status(200).json({
        plan_id: plan._id,
        status: 'BLOCKED',
        challenge_claim: challengeClaim,
        failing_claims: verifyRes.failing_claims,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /plans/:id/challenge (Analyst, DEMO_MODE)
// ---------------------------------------------------------------------------
plansRouter.delete(
  '/plans/:id/challenge',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      // Check if id belongs to a simulation run
      const isSim = await SimulationRun.findById(id);
      if (isSim) {
        err(res, 409, 'CANNOT_SUBMIT_SIMULATION', 'Cannot submit a simulation run as an operational recovery plan');
        return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      await clearChallengeClaims(plan._id);
      const verifyRes = await verifyPlan(plan._id);

      res.status(200).json({
        plan_id: plan._id,
        status: verifyRes.status,
        cleared: true,
        failing_claims: verifyRes.failing_claims,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/submit (Analyst, Manager)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/submit',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      // Check if id belongs to a simulation run
      const isSim = await SimulationRun.findById(id);
      if (isSim) {
        err(res, 409, 'CANNOT_SUBMIT_SIMULATION', 'Cannot submit a simulation run as an operational recovery plan');
        return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      // Must be VERIFIED
      if (plan.status !== 'VERIFIED') {
        const verifyRes = await verifyPlan(plan._id);
        if (verifyRes.status !== 'VERIFIED') {
          err(
            res,
            409,
            'PLAN_NOT_VERIFIED',
            'Plan must be VERIFIED before submission',
            verifyRes.failing_claims,
          );
          return;
        }
      }

      // Check challenge claims: challenge claims can NEVER reach approval
      const challengeCount = await PlanClaim.countDocuments({
        plan_id: plan._id,
        plan_version: plan.version,
        origin: 'CHALLENGE',
      });
      if (challengeCount > 0) {
        err(res, 409, 'CHALLENGE_CLAIM_PRESENT', 'Challenge claims must be removed before submitting plan');
        return;
      }

      // Guardrails and Promise Dates computation
      const guardrailRes = await runGuardrailChecks(plan._id, plan.version);
      const promiseDates = await computePromiseDatesForPlan(plan._id);

      // Reserve stock
      const reserveRes = await reserveStock(plan._id);
      if (!reserveRes.success) {
        err(res, 409, 'STOCK_RESERVATION_CONFLICT', reserveRes.conflictReason || 'Failed to reserve stock', reserveRes.conflictCard);
        return;
      }

      const now = await simClock.now();
      const actions = await PlanAction.find({ plan_id: plan._id });
      let requiredRoles = deriveRequiredApproverRoles(actions);

      // If guardrails added missing roles, incorporate them
      for (const addedRole of guardrailRes.addedRoles) {
        if (!requiredRoles.includes(addedRole)) {
          requiredRoles.push(addedRole);
        }
      }

      const contractHash = plan.contract_hash || computeContractHash(actions);

      // Freeze Decision Contract
      plan.status = 'PENDING_APPROVAL';
      plan.submitted_by = req.user!._id;
      plan.submitted_at = now;
      if (plan.decision_contract) {
        plan.decision_contract.reservation_ids = reserveRes.reservationIds;
        plan.decision_contract.guardrail_results = guardrailRes.checks;
        plan.decision_contract.committed_promise_dates = promiseDates.map((p) => ({
          order_code: p.order_code,
          promised_at: p.current_promise,
        }));
        plan.decision_contract.escalation_approvals_required = guardrailRes.escalated;
        plan.decision_contract.required_approver_roles = requiredRoles;
      }
      await plan.save();

      // Create one approval row per required role with contract_hash
      for (const role of requiredRoles) {
        await Approval.findOneAndUpdate(
          { plan_id: plan._id, plan_version: plan.version, required_role: role },
          {
            $set: {
              contract_hash: contractHash,
              status: 'PENDING',
              decided_by: null,
              decided_at: null,
              comment: null,
              delegated_from: null,
            },
          },
          { upsert: true, new: true },
        );
      }

      await writeAudit({
        action: 'PLAN_SUBMITTED',
        actor: req.user!._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: {
          version: plan.version,
          required_roles: requiredRoles,
          contract_hash: contractHash,
          reservation_ids: reserveRes.reservationIds,
        },
      });

      await publish('PLAN_SUBMITTED', {
        planId: plan._id.toString(),
        submittedBy: req.user!._id.toString(),
        contractHash,
      });

      res.status(200).json({
        plan_id: plan._id,
        version: plan.version,
        status: 'PENDING_APPROVAL',
        required_roles: requiredRoles,
        contract_hash: contractHash,
        reservation_ids: reserveRes.reservationIds,
        message: 'Plan submitted successfully. Awaiting required approvals.',
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/approve (Manager, Procurement_Approver)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/approve',
  authenticateToken,
  requireAnyPermission(['approve_reallocate_split', 'approve_expedite_alt_supplier']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const user = req.user!;

      // 1. Administrator can NEVER approve
      if (user.role === 'Administrator') {
        err(res, 403, 'FORBIDDEN', 'Administrator cannot approve recovery plans'); return;
      }

      // 2. Allowed approval roles: Manager or Procurement_Approver
      if (user.role !== 'Manager' && user.role !== 'Procurement_Approver') {
        err(res, 403, 'FORBIDDEN', `Role ${user.role} is not authorized to approve recovery plans`); return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      if (plan.status !== 'PENDING_APPROVAL') {
        err(res, 409, 'INVALID_STATE', `Plan status is ${plan.status}, must be PENDING_APPROVAL`); return;
      }

      // 3. Separation of duties: creator, submitter, and modifiers cannot approve
      const isCreator = plan.created_by.equals(user._id);
      const isSubmitter = plan.submitted_by && plan.submitted_by.equals(user._id);
      const isModifier = plan.modifier_ids && plan.modifier_ids.some((m) => m.equals(user._id));

      if (isCreator || isSubmitter || isModifier) {
        err(res, 403, 'SELF_APPROVAL_FORBIDDEN', 'Self-approval not allowed'); return;
      }

      // 4. Distinct approver check: cannot approve more than one role on same plan/version
      const alreadyApprovedByCaller = await Approval.findOne({
        plan_id: plan._id,
        plan_version: plan.version,
        decided_by: user._id,
        status: 'APPROVED',
      });
      if (alreadyApprovedByCaller) {
        err(res, 403, 'DISTINCT_APPROVER_REQUIRED', 'Each required role needs a distinct approver'); return;
      }

      const now = await simClock.now();

      // 4b. Delegator rights check: while active delegation exists, delegator loses rights
      const activeDelegationOut = await ApprovalDelegation.findOne({
        delegator_id: user._id,
        is_active: true,
        valid_from: { $lte: now },
        valid_until: { $gte: now },
        $or: [{ plan_id: plan._id }, { plan_id: null }],
      });
      if (activeDelegationOut) {
        err(res, 403, 'DELEGATION_ACTIVE', 'Delegator has active delegation in force and cannot approve this plan');
        return;
      }

      // 4c. Check if caller is acting as a delegate
      const activeDelegationIn = await ApprovalDelegation.findOne({
        delegate_id: user._id,
        is_active: true,
        valid_from: { $lte: now },
        valid_until: { $gte: now },
        $or: [{ plan_id: plan._id }, { plan_id: null }],
      });

      const allowedApprovalRoles: string[] = [user.role];
      if (activeDelegationIn && activeDelegationIn.role) {
        allowedApprovalRoles.push(activeDelegationIn.role);
      }

      // 5. Find pending approval row for caller's role or delegated role
      const approval = await Approval.findOne({
        plan_id: plan._id,
        plan_version: plan.version,
        required_role: { $in: allowedApprovalRoles } as any,
        status: 'PENDING',
      });
      if (!approval) {
        err(res, 400, 'NO_PENDING_APPROVAL', `No pending approval found for role ${user.role}`); return;
      }

      // 6. Stale contract hash check
      if (approval.contract_hash !== plan.contract_hash) {
        err(res, 409, 'STALE_CONTRACT_HASH', 'Approval contract hash does not match current plan hash'); return;
      }

      approval.status = 'APPROVED';
      approval.decided_by = user._id;
      approval.decided_at = now;
      approval.comment = req.body.comment || null;
      if (activeDelegationIn) {
        approval.delegated_from = activeDelegationIn.delegator_id;
        if (plan.decision_contract) {
          plan.decision_contract.delegations_in_force = plan.decision_contract.delegations_in_force || [];
          plan.decision_contract.delegations_in_force.push({
            delegator: activeDelegationIn.delegator_id,
            delegate: user._id,
            role: approval.required_role,
          });
          plan.markModified('decision_contract');
        }
      }
      await approval.save();

      // 7. Check if all approvals for this version are now approved
      const pendingCount = await Approval.countDocuments({
        plan_id: plan._id,
        plan_version: plan.version,
        status: 'PENDING',
      });

      let planFullyApproved = false;
      if (pendingCount === 0) {
        plan.status = 'APPROVED';
        plan.approved_at = now;
        await plan.save();
        planFullyApproved = true;

        await publish('PLAN_APPROVED', {
          planId: plan._id.toString(),
          approvedBy: user._id.toString(),
          role: user.role,
        });
      }

      await writeAudit({
        action: 'APPROVAL_DECIDED',
        actor: user._id,
        entityType: 'Approval',
        entityId: approval._id.toString(),
        after: {
          decision: 'APPROVED',
          plan_id: plan._id.toString(),
          role: user.role,
          plan_status: plan.status,
        },
      });

      await publish('APPROVAL_DECIDED', {
        planId: plan._id.toString(),
        approvalId: approval._id.toString(),
        decision: 'APPROVED',
        decidedBy: user._id.toString(),
        role: user.role,
      });

      res.status(200).json({
        plan_id: plan._id,
        plan_status: plan.status,
        approval_id: approval._id,
        approved_role: user.role,
        plan_fully_approved: planFullyApproved,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/reject (Manager, Procurement_Approver)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/reject',
  authenticateToken,
  requireAnyPermission(['approve_reallocate_split', 'approve_expedite_alt_supplier']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const user = req.user!;

      if (user.role === 'Administrator') {
        err(res, 403, 'FORBIDDEN', 'Administrator cannot approve or reject recovery plans'); return;
      }

      if (user.role !== 'Manager' && user.role !== 'Procurement_Approver') {
        err(res, 403, 'FORBIDDEN', `Role ${user.role} is not authorized to reject recovery plans`); return;
      }

      // Rejection reason is required
      const reason = req.body.reason;
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        err(res, 400, 'REASON_REQUIRED', 'Rejection reason is required'); return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const isCreator = plan.created_by.equals(user._id);
      const isSubmitter = plan.submitted_by && plan.submitted_by.equals(user._id);
      const isModifier = plan.modifier_ids && plan.modifier_ids.some((m) => m.equals(user._id));

      if (isCreator || isSubmitter || isModifier) {
        err(res, 403, 'SELF_APPROVAL_FORBIDDEN', 'Self-approval / self-rejection not allowed'); return;
      }

      const approval = await Approval.findOne({
        plan_id: plan._id,
        plan_version: plan.version,
        required_role: user.role,
        status: 'PENDING',
      });

      const now = await simClock.now();

      if (approval) {
        approval.status = 'REJECTED';
        approval.decided_by = user._id;
        approval.decided_at = now;
        approval.comment = reason;
        await approval.save();
      }

      plan.status = 'REJECTED';
      await plan.save();

      // Release any HELD reservations
      await releaseStock(plan._id);

      await writeAudit({
        action: 'APPROVAL_DECIDED',
        actor: user._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { decision: 'REJECTED', reason, role: user.role },
      });

      await publish('APPROVAL_DECIDED', {
        planId: plan._id.toString(),
        approvalId: approval ? approval._id.toString() : plan._id.toString(),
        decision: 'REJECTED',
        decidedBy: user._id.toString(),
        role: user.role,
      });

      res.status(200).json({
        plan_id: plan._id,
        plan_status: 'REJECTED',
        reason,
        message: 'Plan rejected and reservations released.',
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/request-changes (Manager, Procurement_Approver) — Step 11, B9
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/request-changes',
  authenticateToken,
  requirePermission('manage_delegations'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const user = req.user!;
      if (!['Manager', 'Procurement_Approver'].includes(user.role)) {
        err(res, 403, 'FORBIDDEN', `Role ${user.role} is not authorized to request changes`); return;
      }

      const comment = req.body.comment;
      if (!comment || typeof comment !== 'string' || !comment.trim()) {
        err(res, 400, 'COMMENT_REQUIRED', 'Comment is required when requesting changes'); return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const now = await simClock.now();

      // Void earlier approvals for this plan version
      await Approval.updateMany(
        { plan_id: plan._id, plan_version: plan.version },
        { $set: { status: 'REJECTED', comment: `Changes requested: ${comment}`, decided_at: now } },
      );

      // Increment plan version and reset to DRAFT
      const oldVersion = plan.version;
      plan.version += 1;
      plan.status = 'DRAFT';
      if (!plan.modifier_ids) plan.modifier_ids = [];
      if (!plan.modifier_ids.some((m) => m.equals(user._id))) {
        plan.modifier_ids.push(user._id);
      }
      await plan.save();

      // Release any held reservations since plan is back to draft
      await releaseStock(plan._id);

      await writeAudit({
        action: 'PLAN_CHANGES_REQUESTED',
        actor: user._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        before: { version: oldVersion, status: 'PENDING_APPROVAL' },
        after: { version: plan.version, status: 'DRAFT', comment, decision: 'CHANGES_REQUESTED' },
      });

      await publish('CHANGES_REQUESTED', {
        planId: plan._id.toString(),
        requestedBy: user._id.toString(),
        role: user.role,
        comment,
        newVersion: plan.version,
      });

      res.status(200).json({
        plan_id: plan._id,
        version: plan.version,
        status: plan.status,
        decision: 'CHANGES_REQUESTED',
        comment,
        message: 'Changes requested. Earlier approvals invalidated and plan version incremented.',
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /plans/:id — modify, increment version, status -> DRAFT
// ---------------------------------------------------------------------------
plansRouter.patch(
  '/plans/:id',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      // Check if id belongs to a simulation run
      const isSim = await SimulationRun.findById(id);
      if (isSim) {
        err(res, 409, 'CANNOT_SUBMIT_SIMULATION', 'Cannot submit a simulation run as an operational recovery plan');
        return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      if (!['DRAFT', 'VERIFIED', 'BLOCKED', 'PENDING_APPROVAL'].includes(plan.status)) {
        err(res, 409, 'IMMUTABLE', `Plan in status ${plan.status} cannot be edited`); return;
      }

      const now = await simClock.now();
      const { narrative, strategy } = req.body as { narrative?: string; strategy?: string };

      const VALID_STRATEGIES = ['REALLOCATE', 'EXPEDITE', 'SPLIT', 'BACKORDER', 'HYBRID'];
      if (strategy && !VALID_STRATEGIES.includes(strategy)) {
        err(res, 400, 'BAD_STRATEGY', 'Invalid strategy value'); return;
      }

      // Record modifier
      if (!plan.modifier_ids) plan.modifier_ids = [];
      if (!plan.modifier_ids.some((m) => m.equals(req.user!._id))) {
        plan.modifier_ids.push(req.user!._id);
      }

      // Increment version, reset approvals and hash
      plan.version = plan.version + 1;
      plan.status = 'DRAFT';
      plan.contract_hash = null;
      plan.decision_contract = null;
      if (narrative) plan.narrative = narrative;
      if (strategy) plan.strategy = strategy as typeof plan.strategy;

      await plan.save();

      // Release any stock reservations from earlier version
      await releaseStock(plan._id);

      // Re-run guardrails and promise dates automatically after any PATCH
      await runGuardrailChecks(plan._id, plan.version);
      await computePromiseDatesForPlan(plan._id);

      await writeAudit({
        action: 'RECOVERY_PLAN_MODIFIED',
        actor: req.user!._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { new_version: plan.version, narrative, strategy, modified_at: now },
      });

      res.json({
        plan_id: plan._id,
        version: plan.version,
        status: plan.status,
        message: 'Plan updated. Re-verification required.',
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/execute (Manager only, M6, S1)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/execute',
  authenticateToken,
  requirePermission('confirm_execution'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const user = req.user!;
      if (user.role !== 'Manager') {
        err(res, 403, 'FORBIDDEN', 'Only Supply Chain Manager can execute recovery plans'); return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      if (plan.status !== 'APPROVED') {
        err(res, 409, 'INVALID_STATE', `Plan must be APPROVED to execute, current status: ${plan.status}`);
        return;
      }

      const actions = await PlanAction.find({ plan_id: plan._id });
      const currentHash = computeContractHash(actions);
      if (plan.contract_hash !== currentHash) {
        err(res, 409, 'STALE_CONTRACT_HASH', 'Plan actions do not match approved contract hash'); return;
      }

      // Separation of duties: executor cannot be creator or submitter
      if (plan.created_by.equals(user._id) || (plan.submitted_by && plan.submitted_by.equals(user._id))) {
        err(res, 403, 'SELF_EXECUTION_FORBIDDEN', 'Executor cannot be the creator or submitter of the plan');
        return;
      }

      // Explicit confirmation flag required
      if (!req.body.confirmed) {
        err(res, 400, 'CONFIRMATION_REQUIRED', 'Explicit confirmation flag `confirmed: true` required in body');
        return;
      }

      // If plan is ESCALATED, guardrail breach acknowledgement is required
      const isEscalated = plan.decision_contract?.escalation_approvals_required || (plan as any).guardrail_status === 'ESCALATED';
      if (isEscalated && !req.body.guardrail_acknowledgement && !req.body.acknowledge_breach) {
        err(res, 400, 'BREACH_ACKNOWLEDGEMENT_REQUIRED', 'Plan is ESCALATED: manager must explicitly acknowledge guardrail breach (`guardrail_acknowledgement: true`)');
        return;
      }

      const now = await simClock.now();

      await withTransaction(async (session: ClientSession) => {
        for (const act of actions) {
          if (act.action_type === 'TRANSFER' && act.from_warehouse_id) {
            // Deduct donor stock
            const donorBal = await InventoryBalance.findOne({
              warehouse_id: act.from_warehouse_id,
              sku_id: act.sku_id,
            }).session(session);

            if (donorBal) {
              const beforeDonor = { on_hand: donorBal.on_hand, reserved: donorBal.reserved };
              donorBal.on_hand -= act.quantity;
              donorBal.reserved = Math.max(0, donorBal.reserved - act.quantity);
              donorBal.updated_at = now;
              await donorBal.save({ session });
              const afterDonor = { on_hand: donorBal.on_hand, reserved: donorBal.reserved };

              await writeLedgerEntry(
                {
                  planId: plan._id,
                  actionId: act._id,
                  stepType: 'TRANSFER_COMPLETE',
                  warehouseId: act.from_warehouse_id,
                  skuId: act.sku_id,
                  deltaOnHand: -act.quantity,
                  beforeState: beforeDonor,
                  afterState: afterDonor,
                  actor: user._id,
                },
                session,
              );
            }

            // Increase destination stock
            const destBal = await InventoryBalance.findOne({
              warehouse_id: act.to_warehouse_id,
              sku_id: act.sku_id,
            }).session(session);

            if (destBal) {
              const beforeDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };
              destBal.on_hand += act.quantity;
              destBal.updated_at = now;
              await destBal.save({ session });
              const afterDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };

              await writeLedgerEntry(
                {
                  planId: plan._id,
                  actionId: act._id,
                  stepType: 'TRANSFER_COMPLETE',
                  warehouseId: act.to_warehouse_id,
                  skuId: act.sku_id,
                  deltaOnHand: act.quantity,
                  beforeState: beforeDest,
                  afterState: afterDest,
                  actor: user._id,
                },
                session,
              );
            }
          } else if (act.action_type === 'RESERVE' || act.action_type === 'EXPEDITE') {
            // Inbound arrival recorded as inbound supply into destination warehouse
            const destBal = await InventoryBalance.findOne({
              warehouse_id: act.to_warehouse_id,
              sku_id: act.sku_id,
            }).session(session);

            if (destBal) {
              const beforeDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };
              destBal.on_hand += act.quantity;
              destBal.updated_at = now;
              await destBal.save({ session });
              const afterDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };

              await writeLedgerEntry(
                {
                  planId: plan._id,
                  actionId: act._id,
                  stepType: 'RESERVE',
                  warehouseId: act.to_warehouse_id,
                  skuId: act.sku_id,
                  deltaOnHand: act.quantity,
                  beforeState: beforeDest,
                  afterState: afterDest,
                  actor: user._id,
                },
                session,
              );
            }
          }

          act.status = 'COMPLETED';
          await act.save({ session });
        }

        // Commit held reservations
        await commitStock(plan._id, session);

        // Update orders
        await Order.updateMany(
          { warehouse_id: actions[0]?.to_warehouse_id },
          { $set: { recovery_plan_id: plan._id, status: 'RECOVERING' } },
          { session },
        );

        plan.status = 'EXECUTED';
        (plan as any).executed_at = now;
        (plan as any).executed_by = user._id;
        await plan.save({ session });
      });

      await writeAudit({
        action: 'PLAN_EXECUTED',
        actor: user._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { version: plan.version, executed_at: now },
      });

      await publish('PLAN_EXECUTED', {
        planId: plan._id.toString(),
        executedBy: user._id.toString(),
      });

      res.status(200).json({
        plan_id: plan._id,
        status: 'EXECUTED',
        executed_at: now,
        message: 'Recovery plan executed successfully. Stock movements committed to ledger.',
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /plans/:id/rollback (Manager only, S1)
// ---------------------------------------------------------------------------
plansRouter.post(
  '/plans/:id/rollback',
  authenticateToken,
  requirePermission('rollback'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const user = req.user!;
      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      if (plan.status !== 'EXECUTED') {
        err(res, 409, 'INVALID_STATE', `Only EXECUTED plans may be rolled back, current status: ${plan.status}`);
        return;
      }

      const actions = await PlanAction.find({ plan_id: plan._id });
      const now = await simClock.now();

      await withTransaction(async (session: ClientSession) => {
        // Feasibility check: Reversing must not push balance below zero or below reserved
        for (const act of actions) {
          const destBal = await InventoryBalance.findOne({
            warehouse_id: act.to_warehouse_id,
            sku_id: act.sku_id,
          }).session(session);

          if (!destBal || (destBal.on_hand - act.quantity) < 0) {
            throw new Error(
              `Cannot rollback: destination warehouse balance would drop below zero for SKU ${act.sku_id}`,
            );
          }
        }

        // Reversal execution
        for (const act of actions) {
          if (act.action_type === 'TRANSFER' && act.from_warehouse_id) {
            // Restore donor stock
            const donorBal = await InventoryBalance.findOne({
              warehouse_id: act.from_warehouse_id,
              sku_id: act.sku_id,
            }).session(session);

            if (donorBal) {
              const beforeDonor = { on_hand: donorBal.on_hand, reserved: donorBal.reserved };
              donorBal.on_hand += act.quantity;
              donorBal.updated_at = now;
              await donorBal.save({ session });
              const afterDonor = { on_hand: donorBal.on_hand, reserved: donorBal.reserved };

              await writeLedgerEntry(
                {
                  planId: plan._id,
                  actionId: act._id,
                  stepType: 'COMPENSATE',
                  warehouseId: act.from_warehouse_id,
                  skuId: act.sku_id,
                  deltaOnHand: act.quantity,
                  beforeState: beforeDonor,
                  afterState: afterDonor,
                  actor: user._id,
                },
                session,
              );
            }

            // Deduct destination stock
            const destBal = await InventoryBalance.findOne({
              warehouse_id: act.to_warehouse_id,
              sku_id: act.sku_id,
            }).session(session);

            if (destBal) {
              const beforeDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };
              destBal.on_hand -= act.quantity;
              destBal.updated_at = now;
              await destBal.save({ session });
              const afterDest = { on_hand: destBal.on_hand, reserved: destBal.reserved };

              await writeLedgerEntry(
                {
                  planId: plan._id,
                  actionId: act._id,
                  stepType: 'COMPENSATE',
                  warehouseId: act.to_warehouse_id,
                  skuId: act.sku_id,
                  deltaOnHand: -act.quantity,
                  beforeState: beforeDest,
                  afterState: afterDest,
                  actor: user._id,
                },
                session,
              );
            }
          }

          act.status = 'ROLLED_BACK';
          await act.save({ session });
        }

        plan.status = 'ROLLED_BACK';
        await plan.save({ session });
      });

      await releaseStock(plan._id);

      await writeAudit({
        action: 'PLAN_ROLLED_BACK',
        actor: user._id,
        entityType: 'RecoveryPlan',
        entityId: plan._id.toString(),
        after: { status: 'ROLLED_BACK', rolled_back_at: now },
      });

      res.status(200).json({
        plan_id: plan._id,
        status: 'ROLLED_BACK',
        message: 'Recovery plan rolled back successfully. Balances restored and compensatory ledger entries written.',
      });
    } catch (e: any) {
      if (e.message && e.message.includes('Cannot rollback')) {
        err(res, 409, 'ROLLBACK_INFEASIBLE', e.message); return;
      }
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /plans/:id/promise-dates (Promise-Date Repair Engine A7)
// ---------------------------------------------------------------------------
plansRouter.get(
  '/plans/:id/promise-dates',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const dates = await computePromiseDatesForPlan(id);
      res.status(200).json({ plan_id: id, promise_dates: dates });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /plans/:id/guardrails (Budget Guardrails A9)
// ---------------------------------------------------------------------------
plansRouter.get(
  '/plans/:id/guardrails',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!isObjectId(id)) { err(res, 400, 'BAD_ID', 'Invalid plan id'); return; }

      const plan = await RecoveryPlan.findById(id).lean();
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      const checks = await GuardrailCheck.find({
        plan_id: plan._id,
        plan_version: plan.version,
      })
        .populate('policy_id')
        .lean();

      res.status(200).json({ plan_id: id, version: plan.version, checks });
    } catch (e) {
      next(e);
    }
  },
);

