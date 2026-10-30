/**
 * apps/api/src/routes/disruptions.ts
 *
 * Routes for disruptions, impact analysis, risk policies, and evidence retrieval (M3, B5).
 *  - GET  /disruptions
 *  - GET  /disruptions/:id
 *  - GET  /disruptions/:id/impact
 *  - GET  /disruptions/:id/risks
 *  - GET  /disruptions/:id/heatgrid
 *  - GET  /risk/policy
 *  - PUT  /risk/policy
 *  - GET  /evidence/:type/:id
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Disruption } from '../models/disruptions.js';
import { OrderRiskSnapshot } from '../models/order-risk-snapshots.js';
import { RiskPolicy } from '../models/risk-policies.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { FieldReport } from '../models/field-reports.js';
import { AuditLog } from '../models/audit-logs.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { getBandForScore } from '../services/impactEngine.js';

export const disruptionsRouter = Router();

// GET /disruptions
disruptionsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (_req: Request, res: Response): Promise<void> => {
    const disruptions = await Disruption.find({})
      .populate('shipment_id', 'code status carrier_name current_eta resolved_eta total_units usable_quantity')
      .sort({ detected_at: -1 })
      .lean();

    res.status(200).json({ disruptions });
  },
);

// GET /disruptions/:id
disruptionsRouter.get(
  '/:id',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid disruption ID' });
      return;
    }

    const disruption = await Disruption.findById(id)
      .populate('shipment_id')
      .populate('created_by_event_id')
      .lean();

    if (!disruption) {
      res.status(404).json({ error: 'Not Found', message: 'Disruption not found' });
      return;
    }

    res.status(200).json({ disruption });
  },
);

// GET /disruptions/:id/impact
disruptionsRouter.get(
  '/:id/impact',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid disruption ID' });
      return;
    }

    const snapshots = await OrderRiskSnapshot.find({ disruption_id: id })
      .populate('order_id', 'code customer_name priority due_at status penalty_per_unit_short')
      .lean();

    res.status(200).json({
      disruption_id: id,
      affected_orders: snapshots.map((s) => ({
        snapshot_id: s._id,
        order: s.order_id,
        risk_score: s.risk_score,
        band: s.band,
      })),
    });
  },
);

// GET /disruptions/:id/risks — dynamically re-bands based on current risk_policies
disruptionsRouter.get(
  '/:id/risks',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid disruption ID' });
      return;
    }

    const snapshots = await OrderRiskSnapshot.find({ disruption_id: id })
      .populate('order_id', 'code customer_name priority due_at')
      .lean();

    // Re-evaluate band dynamically so policy changes take effect immediately
    const formatted = await Promise.all(
      snapshots.map(async (s) => {
        const liveBand = await getBandForScore(s.risk_score);
        return {
          ...s,
          band: liveBand,
          score_range: [s.best_case_score, s.worst_case_score],
          waterfall: {
            urgency: s.urgency,
            shortage: s.supply_gap,
            delay: s.delay_factor,
            priority: s.penalty_factor,
          },
        };
      }),
    );

    res.status(200).json({ risks: formatted });
  },
);

// GET /disruptions/:id/heatgrid
disruptionsRouter.get(
  '/:id/heatgrid',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid disruption ID' });
      return;
    }

    const snapshots = await OrderRiskSnapshot.find({ disruption_id: id })
      .populate('order_id', 'code customer_name priority')
      .lean();

    const heatgrid = await Promise.all(
      snapshots.map(async (s) => ({
        order_code: (s.order_id as any)?.code,
        urgency: s.urgency,
        shortage: s.supply_gap,
        delay: s.delay_factor,
        priority: s.penalty_factor,
        risk_score: s.risk_score,
        band: await getBandForScore(s.risk_score),
      })),
    );

    res.status(200).json({ heatgrid });
  },
);

// Risk Policy router (mounted under /risk/policy)
export const riskPolicyRouter = Router();

// GET /risk/policy
riskPolicyRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (_req: Request, res: Response): Promise<void> => {
    const policies = await RiskPolicy.find({}).sort({ min_score: -1 }).lean();
    res.status(200).json({ policies });
  },
);

// PUT /risk/policy
riskPolicyRouter.put(
  '/',
  authenticateToken,
  requirePermission('set_risk_and_thresholds'),
  async (req: Request, res: Response): Promise<void> => {
    const { policies } = req.body as {
      policies?: Array<{ band: 'RED' | 'AMBER' | 'GREEN'; min_score: number; max_score: number }>;
    };

    if (!policies || !Array.isArray(policies)) {
      res.status(400).json({ error: 'Bad Request', message: 'policies array is required' });
      return;
    }

    for (const p of policies) {
      await RiskPolicy.findOneAndUpdate(
        { band: p.band },
        { $set: { min_score: p.min_score, max_score: p.max_score } },
        { upsert: true, new: true },
      );
    }

    const updated = await RiskPolicy.find({}).sort({ min_score: -1 }).lean();
    res.status(200).json({ message: 'Risk policies updated', policies: updated });
  },
);

// Evidence Router (mounted under /evidence)
export const evidenceRouter = Router();

// GET /evidence/:type/:id
evidenceRouter.get(
  '/:type/:id',
  authenticateToken,
  requirePermission('view_disruptions'),
  async (req: Request, res: Response): Promise<void> => {
    const { type, id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid ID' });
      return;
    }

    let doc: any = null;
    const cleanType = type.toLowerCase().replace(/[-_]/g, '');

    switch (cleanType) {
      case 'order':
      case 'orders':
        doc = await Order.findById(id).lean();
        break;
      case 'orderline':
      case 'orderlines':
        doc = await OrderLine.findById(id).lean();
        break;
      case 'shipment':
      case 'shipments':
        doc = await Shipment.findById(id).lean();
        break;
      case 'shipmentline':
      case 'shipmentlines':
        doc = await ShipmentLine.findById(id).lean();
        break;
      case 'shipmentevent':
      case 'shipmentevents':
      case 'event':
      case 'events':
        doc = await ShipmentEvent.findById(id).lean();
        break;
      case 'inventory':
      case 'inventorybalance':
      case 'inventorybalances':
        doc = await InventoryBalance.findById(id).lean();
        break;
      case 'fieldreport':
      case 'fieldreports':
        doc = await FieldReport.findById(id).lean();
        break;
      case 'audit':
      case 'auditlog':
      case 'auditlogs':
        doc = await AuditLog.findById(id).lean();
        break;
      default:
        res.status(400).json({ error: 'Bad Request', message: `Unknown evidence type: ${type}` });
        return;
    }

    if (!doc) {
      res.status(404).json({ error: 'Not Found', message: `Evidence document not found for type: ${type}` });
      return;
    }

    res.status(200).json({
      type,
      id,
      document: doc,
    });
  },
);


// ---------------------------------------------------------------------------
// GET /disruptions/:id/routes — feasible direct / via / expedited route options (A2)
// ---------------------------------------------------------------------------
disruptionsRouter.get(
  '/:id/routes',
  authenticateToken,
  requirePermission('manage_plans'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid disruption id' } });
        return;
      }

      const disruption = await Disruption.findById(id).lean();
      if (!disruption) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Disruption not found' } });
        return;
      }

      const shipment = await Shipment.findById(disruption.shipment_id).lean();
      if (!shipment) {
        res.status(404).json({ error: { code: 'NO_SHIPMENT', message: 'No shipment linked' } });
        return;
      }

      const destWarehouseId = (shipment as any).warehouse_id;
      const Warehouse = mongoose.model('Warehouse');

      // All active inbound direct lanes
      const directLanes = await TransferLane.find({
        to_warehouse_id: destWarehouseId,
        is_active: true,
      })
        .populate('from_warehouse_id', 'code name')
        .populate('to_warehouse_id', 'code name')
        .lean();

      const routes: any[] = [];

      for (const lane of directLanes) {
        const from = lane.from_warehouse_id as any;
        const to = lane.to_warehouse_id as any;
        routes.push({
          type: 'DIRECT',
          donor_warehouse: from?.code ?? 'UNKNOWN',
          destination_warehouse: to?.code ?? 'UNKNOWN',
          transit_hours: lane.transit_hours,
          cost_per_unit: lane.cost_per_unit,
          distance_km: lane.distance_km,
          feasibility_status: 'ROUTE_FEASIBLE',
          hops: [
            { from: from?.code, to: to?.code, mode: 'ROAD', hours: lane.transit_hours, cost_per_unit: lane.cost_per_unit },
          ],
        });
      }

      // One-hop via routes
      const outboundLanes = await TransferLane.find({
        to_warehouse_id: { $ne: destWarehouseId },
        is_active: true,
      })
        .populate('from_warehouse_id', 'code name')
        .populate('to_warehouse_id', 'code name')
        .lean();

      for (const leg1 of outboundLanes) {
        const viaWarehouseId = (leg1.to_warehouse_id as any)._id ?? leg1.to_warehouse_id;
        const leg2 = await TransferLane.findOne({
          from_warehouse_id: viaWarehouseId,
          to_warehouse_id: destWarehouseId,
          is_active: true,
        })
          .populate('to_warehouse_id', 'code name')
          .lean();

        if (!leg2) continue;

        const from = leg1.from_warehouse_id as any;
        const via = leg1.to_warehouse_id as any;
        const to = leg2.to_warehouse_id as any;
        const totalHours = leg1.transit_hours + leg2.transit_hours + 2; // 2h processing
        const totalCost = leg1.cost_per_unit + leg2.cost_per_unit;

        routes.push({
          type: 'VIA',
          donor_warehouse: from?.code ?? 'UNKNOWN',
          via_warehouse: via?.code ?? 'UNKNOWN',
          destination_warehouse: to?.code ?? 'UNKNOWN',
          transit_hours: totalHours,
          cost_per_unit: totalCost,
          distance_km: (leg1.distance_km ?? 0) + ((leg2 as any).distance_km ?? 0),
          feasibility_status: 'ROUTE_FEASIBLE',
          hops: [
            { from: from?.code, to: via?.code, mode: 'ROAD', hours: leg1.transit_hours, cost_per_unit: leg1.cost_per_unit },
            { from: via?.code, to: to?.code, mode: 'ROAD', hours: leg2.transit_hours, cost_per_unit: (leg2 as any).cost_per_unit },
          ],
        });
      }

      res.json({ disruption_id: id, routes });
    } catch (e) {
      next(e);
    }
  },
);
