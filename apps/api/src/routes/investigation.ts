/**
 * apps/api/src/routes/investigation.ts
 *
 * Real data for the Disruption Investigation screen.
 *  GET  /investigation/shipments              shipments with live ETA shift and event counts
 *  GET  /investigation/shipments/:id          one shipment: ETA, lineage basis, full event timeline
 *  GET  /investigation/shipments/:id/replay   audit trail rebuilt step by step, with ETA at each step
 *  POST /driver/delay-report                  driver reports how late they are; goes through the reconciler
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { Warehouse } from '../models/warehouses.js';
import { Supplier } from '../models/suppliers.js';
import { AuditLog } from '../models/audit-logs.js';
import { reconcile } from '../services/reconciler.js';
import { simClock } from '../services/simClock.js';

export const investigationRouter = Router();

const HOUR_MS = 3_600_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Hours the shipment is late against the promise, using the best-known ETA. */
function shiftHours(shipment: any): number {
  const eta = shipment.resolved_eta ?? shipment.current_eta;
  return round1((new Date(eta).getTime() - new Date(shipment.promised_eta).getTime()) / HOUR_MS);
}

async function findShipment(idOrCode: string): Promise<any | null> {
  const query = mongoose.Types.ObjectId.isValid(idOrCode) ? { _id: idOrCode } : { code: idOrCode };
  return Shipment.findOne(query).lean();
}

/** Warehouse operators only see shipments going to their own warehouse. */
function canSee(req: Request, shipment: any): boolean {
  const u = req.user!;
  if (u.role === 'Warehouse_Operator' && u.warehouse_id) {
    return String(shipment.warehouse_id) === String(u.warehouse_id);
  }
  return true;
}

// ── GET /investigation/shipments ─────────────────────────────────────────────
investigationRouter.get(
  '/investigation/shipments',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const u = req.user!;
      const filter: Record<string, any> =
        u.role === 'Warehouse_Operator' && u.warehouse_id ? { warehouse_id: u.warehouse_id } : {};

      const shipments: any[] = await Shipment.find(filter).lean();
      const [warehouses, suppliers] = await Promise.all([
        Warehouse.find({}).lean(),
        Supplier.find({}).lean(),
      ]);
      const whMap = new Map<string, any>(warehouses.map((w: any) => [String(w._id), w]));
      const supMap = new Map<string, any>(suppliers.map((s: any) => [String(s._id), s]));

      const stats = await ShipmentEvent.aggregate([
        { $match: { shipment_id: { $in: shipments.map((s) => s._id) } } },
        {
          $group: {
            _id: '$shipment_id',
            events: { $sum: 1 },
            conflicts: { $sum: { $cond: [{ $eq: ['$reconcile_status', 'CONFLICT'] }, 1, 0] } },
            last_event_at: { $max: '$ingested_at' },
          },
        },
      ]);
      const statMap = new Map<string, any>(stats.map((s: any) => [String(s._id), s]));

      const rows = shipments
        .map((s) => {
          const wh = whMap.get(String(s.warehouse_id));
          const sup = supMap.get(String(s.supplier_id));
          const st = statMap.get(String(s._id));
          return {
            _id: String(s._id),
            code: s.code,
            status: s.status,
            warehouse: wh ? { code: wh.code, name: wh.name } : null,
            supplier_name: sup?.name ?? null,
            promised_eta: s.promised_eta,
            current_eta: s.resolved_eta ?? s.current_eta,
            shift_hours: shiftHours(s),
            review_status: s.review_status,
            events: st?.events ?? 0,
            conflicts: st?.conflicts ?? 0,
            last_event_at: st?.last_event_at ?? null,
          };
        })
        .sort((a, b) => b.shift_hours - a.shift_hours || b.events - a.events);

      res.json({ shipments: rows });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /investigation/shipments/:id ─────────────────────────────────────────
investigationRouter.get(
  '/investigation/shipments/:id',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const s: any = await findShipment(req.params.id);
      if (!s) {
        res.status(404).json({ error: 'Not Found', message: 'Shipment not found' });
        return;
      }
      if (!canSee(req, s)) {
        res.status(403).json({ error: 'Forbidden', message: 'Shipment is outside your warehouse' });
        return;
      }

      const [wh, sup, events, basis] = await Promise.all([
        Warehouse.findById(s.warehouse_id).lean(),
        Supplier.findById(s.supplier_id).lean(),
        ShipmentEvent.find({ shipment_id: s._id }).sort({ ingested_at: -1 }).limit(200).lean(),
        s.eta_basis_event_id ? ShipmentEvent.findById(s.eta_basis_event_id).lean() : Promise.resolve(null),
      ]);

      const b: any = basis;

      res.json({
        shipment: {
          _id: String(s._id),
          code: s.code,
          status: s.status,
          promised_eta: s.promised_eta,
          current_eta: s.current_eta,
          resolved_eta: s.resolved_eta,
          shift_hours: shiftHours(s),
          review_status: s.review_status,
          eta_basis_event_id: s.eta_basis_event_id ? String(s.eta_basis_event_id) : null,
          carrier_name: s.carrier_name,
          warehouse: wh ? { code: (wh as any).code, name: (wh as any).name } : null,
          supplier_name: (sup as any)?.name ?? null,
        },
        lineage: b
          ? {
              source: b.source,
              event_type: b.event_type,
              reported_eta: b.reported_eta,
              event_time: b.event_time,
              reason: b.reconcile_reason,
            }
          : null,
        timeline: (events as any[]).map((e) => ({
          _id: String(e._id),
          source: e.source,
          event_type: e.event_type,
          reconcile_status: e.reconcile_status ?? 'PENDING',
          reconcile_reason: e.reconcile_reason,
          reported_eta: e.reported_eta,
          event_time: e.event_time,
          ingested_at: e.ingested_at,
          quantity_affected: e.quantity_affected,
          note: e.raw_payload?.reason ?? e.raw_payload?.notes ?? null,
          delay_hours: e.raw_payload?.delay_hours ?? null,
          location: e.raw_payload?.location ?? null,
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /investigation/shipments/:id/replay ──────────────────────────────────
investigationRouter.get(
  '/investigation/shipments/:id/replay',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const s: any = await findShipment(req.params.id);
      if (!s) {
        res.status(404).json({ error: 'Not Found', message: 'Shipment not found' });
        return;
      }
      if (!canSee(req, s)) {
        res.status(403).json({ error: 'Forbidden', message: 'Shipment is outside your warehouse' });
        return;
      }

      const eventIds = (await ShipmentEvent.find({ shipment_id: s._id }).select('_id').lean()).map((e: any) =>
        String(e._id),
      );

      const logs: any[] = await AuditLog.find({
        $or: [
          { entity_id: { $in: [String(s._id), s.code, ...eventIds] } },
          { entityId: { $in: [String(s._id), s.code, ...eventIds] } },
        ],
      })
        .sort({ _id: 1 })
        .lean();

      let etaAtStep: string | null = null;
      const steps = logs.map((log, i) => {
        if (log.action === 'ETA_APPLIED' && log.after?.resolved_eta) {
          etaAtStep = log.after.resolved_eta;
        }
        return {
          step_number: i + 1,
          action: log.action,
          description: log.after?.reason ?? log.step_type ?? log.stepType ?? log.action,
          timestamp: log._id.getTimestamp().toISOString(),
          resolved_eta_at_step: etaAtStep,
          detail: log.after ?? log.before ?? {},
        };
      });

      res.json({ shipment_code: s.code, total_steps: steps.length, steps });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /driver/delay-report ────────────────────────────────────────────────
// Driver states how late the truck is against the PROMISED arrival.
investigationRouter.post(
  '/driver/delay-report',
  authenticateToken,
  requirePermission('driver.ping'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const truckId = user.truck_id!;
      const hours = Number(req.body.delay_hours);

      if (!Number.isFinite(hours) || hours <= 0 || hours > 48) {
        res.status(400).json({ error: 'Bad Request', message: 'delay_hours must be between 0 and 48' });
        return;
      }

      const shipment: any = await Shipment.findOne({ code: truckId }).lean();
      if (!shipment) {
        res.status(404).json({ error: 'Not Found', message: `No shipment for truck ${truckId}` });
        return;
      }

      const reason = String(req.body.reason || 'Driver reported delay').slice(0, 200);
      const location = req.body.location ? String(req.body.location).slice(0, 200) : null;
      const idem = String(req.body.idempotency_key || `${truckId}-${Date.now()}`).slice(0, 120);
      const now = await simClock.now();

      const reportedEta = new Date(new Date(shipment.promised_eta).getTime() + hours * HOUR_MS);

      const result = await reconcile({
        source: 'DRIVER_DEVICE',
        external_event_id: `DRV-DELAY-${idem}`,
        event_type: 'DELAY_REPORT',
        shipment_code: truckId,
        reported_eta: reportedEta,
        event_time: now,
        raw_payload: {
          delay_hours: hours,
          reason,
          location,
          driver_id: user.driver_id,
          submitted_by: user.username,
        },
        correlation_id: `driver-delay-${idem}`,
      });

      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);

