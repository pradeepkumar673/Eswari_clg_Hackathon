/**
 * apps/api/src/routes/plans.ts
 *
 * Step 7 — Recovery plan endpoints:
 *
 *   POST /disruptions/:id/recovery-plans  (Analyst, Manager)
 *   GET  /plans/:id
 *   GET  /plans/:id/tradeoffs
 *   GET  /plans/:id/cards
 *   PATCH /plans/:id                      (Analyst, Manager)
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Sku } from '../models/skus.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { PlanAction } from '../models/plan-actions.js';
import { PlanTradeoff } from '../models/plan-tradeoffs.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { enumerateCandidates, OrderDeadline } from '../services/candidates.js';
import { writeAudit } from '../services/audit.js';
import { simClock } from '../services/simClock.js';
import { config } from '../config.js';

export const plansRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
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

      // Use the first SKU (primary disrupted SKU — matches impactEngine pattern)
      const skuId = (shipmentLines[0] as any).sku_id;
      const sku = await Sku.findById(skuId).lean();
      if (!sku) { err(res, 422, 'NO_SKU', 'SKU not found'); return; }

      // Get warehouse code
      const Warehouse = mongoose.model('Warehouse');
      const destWh = await Warehouse.findById(destWarehouseId).lean();
      if (!destWh) { err(res, 422, 'NO_WAREHOUSE', 'Destination warehouse not found'); return; }

      // Load open orders at destination warehouse
      const openOrders = await Order.find({
        warehouse_id: destWarehouseId,
        status: { $in: ['OPEN', 'RECOVERING'] },
      }).lean();

      if (openOrders.length === 0) {
        err(res, 422, 'NO_ORDERS', 'No open orders affected by this disruption'); return;
      }

      // Filter orders that have a line for this SKU
      const affectedOrders: typeof openOrders = [];
      for (const order of openOrders) {
        const line = await OrderLine.findOne({ order_id: order._id, sku_id: skuId }).lean();
        if (line) affectedOrders.push(order);
      }

      if (affectedOrders.length === 0) {
        err(res, 422, 'NO_AFFECTED_ORDERS', 'No open orders have lines for the disrupted SKU'); return;
      }

      // Build OrderDeadline[]
      const orderDeadlines: OrderDeadline[] = affectedOrders.map((o) => ({
        sku_id: skuId.toString(),
        sku_code: (sku as any).code,
        fulfil_warehouse_id: destWarehouseId.toString(),
        fulfil_warehouse_code: (destWh as any).code,
        due_hours_from_now: Math.max(0, (o.due_at.getTime() - now.getTime()) / 3_600_000),
      }));

      // Enumerate candidates
      const candidates = await enumerateCandidates(orderDeadlines);

      // Build sources: free stock at destination warehouse
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

      // Build solver request
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

      // Call solver — 503 if down, NEVER fallback
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

      // Determine plan version
      const existingCount = await RecoveryPlan.countDocuments({ disruption_id: disruption._id });
      const version = existingCount + 1;

      // Determine overall strategy
      const actionTypes: string[] = (solverResult.actions || []).map((a: any) => a.type as string);
      let strategy: 'REALLOCATE' | 'EXPEDITE' | 'SPLIT' | 'BACKORDER' | 'HYBRID' = 'HYBRID';
      if (actionTypes.length === 0) strategy = 'BACKORDER';
      else if (actionTypes.every((t) => t === 'TRANSFER' || t === 'VIA')) strategy = 'REALLOCATE';
      else if (actionTypes.every((t) => t === 'ALT_SUPPLIER' || t === 'EXPEDITE')) strategy = 'EXPEDITE';

      const objectiveValue: number = solverResult.objective ?? 0;
      const baselineValue: number = solverResult.baseline_objective ?? 0;
      const saving = baselineValue - objectiveValue;

      // Persist RecoveryPlan
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
      // Store extra fields as arbitrary document properties
      (plan as any).objective_value = objectiveValue;
      (plan as any).baseline_value = baselineValue;
      (plan as any).scope = solverResult.scope ?? 'portfolio-level constrained optimisation';
      (plan as any).per_order = solverResult.per_order ?? [];
      (plan as any).collateral = solverResult.collateral ?? [];
      await plan.save();

      // Persist PlanAction rows
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

      // Persist PlanTradeoff rows (per-order shortfall before/after)
      const tradeoffDocs = (solverResult.per_order || []).map((po: any) => ({
        plan_id: plan._id,
        axis: `order:${po.code}`,
        value: po.backordered_units,
        unit: 'units_backordered',
      }));
      if (tradeoffDocs.length > 0) {
        await PlanTradeoff.insertMany(tradeoffDocs);
      }

      // Audit
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
          narrative: plan.narrative,
          created_at: plan.created_at,
          approved_at: plan.approved_at,
        },
        actions,
        per_order: p.per_order ?? [],
        collateral: p.collateral ?? [],
        tradeoffs,
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
// GET /plans/:id/cards  — PENDING_VERIFICATION until Step 8 proof checker
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
      const p = plan as any;
      const objVal: number = p.objective_value ?? plan.total_cost ?? 0;
      const baseVal: number = p.baseline_value ?? 0;
      const saving = baseVal - objVal;
      const actionCostTotal = actions.reduce((s, a) => s + a.cost, 0);

      // Build one recommendation card per action
      const cards = actions.map((a) => ({
        card_id: `${id}-card-${a.seq}`,
        seq: a.seq,
        action_type: a.action_type,
        quantity: a.quantity,
        cost: a.cost,
        // Benefit = proportion of saving attributed to this action's cost share
        benefit: actionCostTotal > 0 ? Math.round((a.cost / actionCostTotal) * saving) : 0,
        feasibility_status: 'PENDING_VERIFICATION' as const,
        feasibility_checklist: [
          { check: 'Donor stock confirmed', passed: null },
          { check: 'Transit lane active', passed: null },
          { check: 'Guardrail spend limit', passed: null },
        ],
        tradeoff_link: `/plans/${id}/tradeoffs`,
        duration_hours: a.duration_hours,
      }));

      // Ensure card costs sum to plan objective (action cost portion)
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

      const plan = await RecoveryPlan.findById(id);
      if (!plan) { err(res, 404, 'NOT_FOUND', 'Plan not found'); return; }

      if (!['DRAFT', 'PENDING_APPROVAL'].includes(plan.status)) {
        err(res, 409, 'IMMUTABLE', 'Only DRAFT or PENDING_APPROVAL plans may be edited'); return;
      }

      const now = await simClock.now();
      const { narrative, strategy } = req.body as { narrative?: string; strategy?: string };

      const VALID_STRATEGIES = ['REALLOCATE', 'EXPEDITE', 'SPLIT', 'BACKORDER', 'HYBRID'];
      if (strategy && !VALID_STRATEGIES.includes(strategy)) {
        err(res, 400, 'BAD_STRATEGY', 'Invalid strategy value'); return;
      }

      plan.version = plan.version + 1;
      plan.status = 'DRAFT';
      if (narrative) plan.narrative = narrative;
      if (strategy) plan.strategy = strategy as typeof plan.strategy;

      await plan.save();

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
