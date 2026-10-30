/**
 * apps/api/src/routes/zones.ts
 *
 * Warehouse Zone Capacity Mapper, Stock Assignments, Inbound Slot Plans & Capacity Overview.
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Zone } from '../models/zones.js';
import { ZoneStockAssignment } from '../models/zone-stock-assignments.js';
import { InboundSlotPlan } from '../models/inbound-slot-plans.js';
import { Warehouse } from '../models/warehouses.js';
import { Sku } from '../models/skus.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { writeAudit } from '../services/audit.js';
import { broadcastToTopic } from '../services/websocket.js';
import {
  computeZoneOccupancy,
  getZoneColour,
  validateZonePolygon,
  syncZoneOverCapacityAlert,
} from '../services/capacityService.js';

async function resolveWarehouseCode(raw?: any): Promise<string | undefined> {
  if (!raw) return undefined;
  const str = String(raw);
  if (mongoose.Types.ObjectId.isValid(str)) {
    const wh = await Warehouse.findById(str).lean();
    if (wh?.code) return wh.code;
  }
  return str;
}

export const zonesRouter = Router();

// ── Warehouse site footprints (real-world [lat, lng] polygons) ───────────────
function validateFootprint(points: any): { valid: boolean; error?: string } {
  if (!Array.isArray(points) || points.length < 3) {
    return { valid: false, error: 'Footprint needs at least 3 corner points' };
  }
  if (points.length > 200) {
    return { valid: false, error: 'Footprint cannot have more than 200 points' };
  }
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      return { valid: false, error: 'Each point must be [lat, lng]' };
    }
    if (p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180) {
      return { valid: false, error: `Point [${p[0]}, ${p[1]}] is not a valid lat/lng` };
    }
  }
  return { valid: true };
}

// GET /capacity/footprints
zonesRouter.get(
  '/footprints',
  authenticateToken,
  requirePermission('capacity.view'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const whs = await Warehouse.find({ is_active: { $ne: false } }).lean();
      res.json({
        warehouses: whs.map((w: any) => ({
          code: w.code,
          name: w.name,
          lat: w.lat ?? null,
          lng: w.lng ?? null,
          footprint: w.footprint ?? null,
          footprint_updated_at: w.footprint_updated_at ?? null,
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

// PUT /capacity/footprint/:code  { polygon: [[lat,lng], ...] }
zonesRouter.put(
  '/footprint/:code',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const code = req.params.code;
      const polygon = req.body?.polygon;
      const check = validateFootprint(polygon);
      if (!check.valid) {
        res.status(400).json({ error: 'Bad Request', message: check.error });
        return;
      }

      const before: any = await Warehouse.findOne({ code }).lean();
      if (!before) {
        res.status(404).json({ error: 'Not Found', message: `Warehouse ${code} not found` });
        return;
      }

      await Warehouse.updateOne(
        { code },
        { $set: { footprint: polygon, footprint_updated_at: new Date() } },
      );

      try {
        await writeAudit({
          action: 'WAREHOUSE_FOOTPRINT_SET',
          actor: (req.user as any)?._id || (req.user as any)?.id || (req.user as any)?.sub,
          entityType: 'Warehouse',
          entityId: code,
          before: { footprint: before.footprint ?? null },
          after: { footprint: polygon },
        } as any);
      } catch {
        // audit failure must not block the save
      }

      await broadcastToTopic('zones', { type: 'WAREHOUSE_FOOTPRINT_UPDATED', warehouse_id: code });
      res.json({ ok: true, code, footprint: polygon });
    } catch (e) {
      next(e);
    }
  },
);

// DELETE /capacity/footprint/:code
zonesRouter.delete(
  '/footprint/:code',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const code = req.params.code;
      const r = await Warehouse.updateOne(
        { code },
        { $set: { footprint: null, footprint_updated_at: new Date() } },
      );
      if (r.matchedCount === 0) {
        res.status(404).json({ error: 'Not Found', message: `Warehouse ${code} not found` });
        return;
      }
      await broadcastToTopic('zones', { type: 'WAREHOUSE_FOOTPRINT_UPDATED', warehouse_id: code });
      res.json({ ok: true, code, footprint: null });
    } catch (e) {
      next(e);
    }
  },
);

// ── 1. GET /zones ────────────────────────────────────────────────────────────
zonesRouter.get(
  '/',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: Record<string, any> = { is_active: { $ne: false } };
      if (req.query.warehouse_id) {
        filter.warehouse_id = await resolveWarehouseCode(req.query.warehouse_id);
      }

      const rawZones = await Zone.find(filter).lean();
      const detailedZones = await Promise.all(
        rawZones.map(async (z) => {
          try {
            return await computeZoneOccupancy(z.zone_id);
          } catch {
            return z;
          }
        }),
      );

      res.json(detailedZones);
    } catch (e) {
      next(e);
    }
  },
);

// ── 2. GET /capacity/overview ───────────────────────────────────────────────
zonesRouter.get(
  '/overview',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawWhId = (req.query.warehouse_id as string) || 'WH-HOS';
      const warehouseId = (await resolveWarehouseCode(rawWhId)) || 'WH-HOS';
      const zones = await Zone.find({
        warehouse_id: warehouseId,
        is_active: { $ne: false },
      }).lean();

      const detailedZones = await Promise.all(
        zones.map(async (z) => {
          return await computeZoneOccupancy(z.zone_id);
        }),
      );

      const totalCapacity = detailedZones.reduce((sum, z) => sum + z.capacity_slots, 0);
      const totalOccupied = detailedZones.reduce((sum, z) => sum + z.occupied_slots, 0);
      const totalReserved = detailedZones.reduce((sum, z) => sum + z.reserved_inbound_slots, 0);
      const overallMetrics = getZoneColour(totalCapacity, totalOccupied, totalReserved);

      // RED zones listed first
      const sortedZones = [...detailedZones].sort((a, b) => {
        const order: Record<string, number> = { RED: 0, AMBER: 1, GREEN: 2 };
        return (order[a.colour] ?? 3) - (order[b.colour] ?? 3);
      });
      const redZones = sortedZones.filter((z) => z.colour === 'RED');

      res.json({
        warehouse_id: warehouseId,
        total_capacity_slots: totalCapacity,
        total_occupied_slots: totalOccupied,
        total_reserved_inbound_slots: totalReserved,
        overall_utilization_pct: overallMetrics.utilization_pct,
        overall_colour: overallMetrics.colour,
        overall_explanation: overallMetrics.explanation,
        red_zones: redZones,
        zones: sortedZones,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── 3. GET /zones/:id ────────────────────────────────────────────────────────
zonesRouter.get(
  '/:id',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const zoneId = req.params.id;
      const occupancy = await computeZoneOccupancy(zoneId);
      res.json(occupancy);
    } catch (e) {
      next(e);
    }
  },
);

// ── 3. POST /zones ───────────────────────────────────────────────────────────
zonesRouter.post(
  '/',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const {
        zone_id,
        warehouse_id,
        name,
        zone_type,
        polygon,
        capacity_slots,
        reserved_inbound_slots,
      } = req.body;

      // Validate polygon
      const polyCheck = validateZonePolygon(polygon);
      if (!polyCheck.valid) {
        res.status(400).json({ error: 'Bad Request', message: polyCheck.error });
        return;
      }

      const zone = await Zone.create({
        zone_id,
        warehouse_id,
        name,
        zone_type,
        polygon,
        capacity_slots,
        reserved_inbound_slots: reserved_inbound_slots || 0,
        version: 1,
        is_active: true,
      });

      // Audit creation
      await writeAudit({
        action: 'ZONE_CREATED',
        actor: user._id,
        entityType: 'Zone',
        entityId: zone.zone_id,
        before: null,
        after: zone.toObject(),
      });

      await broadcastToTopic('capacity', { type: 'ZONE_CREATED', zone_id: zone.zone_id, warehouse_id: zone.warehouse_id });
      await broadcastToTopic('zones', { type: 'ZONE_CREATED', zone_id: zone.zone_id, warehouse_id: zone.warehouse_id });

      res.status(201).json(zone);
    } catch (e) {
      next(e);
    }
  },
);

// ── 4. PATCH /zones/:id ──────────────────────────────────────────────────────
zonesRouter.patch(
  '/:id',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const zoneId = req.params.id;

      const zone = await Zone.findOne({ zone_id: zoneId });
      if (!zone) {
        res.status(404).json({ error: 'Not Found', message: `Zone ${zoneId} not found` });
        return;
      }

      const beforeState = zone.toObject();

      // Validate polygon if updated
      if (req.body.polygon) {
        const polyCheck = validateZonePolygon(req.body.polygon);
        if (!polyCheck.valid) {
          res.status(400).json({ error: 'Bad Request', message: polyCheck.error });
          return;
        }
        zone.polygon = req.body.polygon;
      }

      if (req.body.name) zone.name = req.body.name;
      if (req.body.zone_type) zone.zone_type = req.body.zone_type;
      if (req.body.capacity_slots !== undefined) zone.capacity_slots = req.body.capacity_slots;
      if (req.body.reserved_inbound_slots !== undefined) {
        zone.reserved_inbound_slots = req.body.reserved_inbound_slots;
      }

      zone.version = (zone.version || 1) + 1;
      await zone.save();

      const afterState = zone.toObject();

      // Audit update
      await writeAudit({
        action: 'ZONE_UPDATED',
        actor: user._id,
        entityType: 'Zone',
        entityId: zone.zone_id,
        before: beforeState,
        after: afterState,
      });

      const updatedOccupancy = await computeZoneOccupancy(zone.zone_id);
      await broadcastToTopic('capacity', {
        type: 'ZONE_UPDATED',
        zone_id: zone.zone_id,
        warehouse_id: zone.warehouse_id,
        occupancy: updatedOccupancy,
      });
      await broadcastToTopic('zones', {
        type: 'ZONE_UPDATED',
        zone_id: zone.zone_id,
        warehouse_id: zone.warehouse_id,
        occupancy: updatedOccupancy,
      });
      res.json(updatedOccupancy);
    } catch (e) {
      next(e);
    }
  },
);

// ── 5. DELETE /zones/:id (Soft-Delete) ────────────────────────────────────────
zonesRouter.delete(
  '/:id',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const zoneId = req.params.id;

      const zone = await Zone.findOne({ zone_id: zoneId });
      if (!zone) {
        res.status(404).json({ error: 'Not Found', message: `Zone ${zoneId} not found` });
        return;
      }

      // Check active assignments
      const activeAssignments = await ZoneStockAssignment.find({
        zone_id: zoneId,
        units: { $gt: 0 },
      });
      const plannedSlots = await InboundSlotPlan.find({
        zone_id: zoneId,
        status: 'PLANNED',
      });

      if (activeAssignments.length > 0 || plannedSlots.length > 0) {
        res.status(409).json({
          error: 'Conflict',
          message: 'Zone cannot be deactivated with active assignments or planned inbound slots',
          assignments_count: activeAssignments.length,
          planned_slots_count: plannedSlots.length,
        });
        return;
      }

      const beforeState = zone.toObject();
      zone.is_active = false;
      zone.deleted_at = new Date();
      await zone.save();

      await writeAudit({
        action: 'ZONE_DEACTIVATED',
        actor: user._id,
        entityType: 'Zone',
        entityId: zone.zone_id,
        before: beforeState,
        after: zone.toObject(),
      });

      await broadcastToTopic('capacity', {
        type: 'ZONE_DEACTIVATED',
        zone_id: zone.zone_id,
        warehouse_id: zone.warehouse_id,
      });
      await broadcastToTopic('zones', {
        type: 'ZONE_DEACTIVATED',
        zone_id: zone.zone_id,
        warehouse_id: zone.warehouse_id,
      });

      res.json({ success: true, message: `Zone ${zoneId} deactivated` });
    } catch (e) {
      next(e);
    }
  },
);

// ── 6. POST /zones/:id/assignments ───────────────────────────────────────────
zonesRouter.post(
  '/:id/assignments',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const zoneId = req.params.id;
      const { sku_id, units } = req.body;

      if (!sku_id || units === undefined || units < 0 || !Number.isInteger(units)) {
        res.status(400).json({ error: 'Bad Request', message: 'sku_id and non-negative integer units are required' });
        await session.abortTransaction();
        return;
      }

      const zone = await Zone.findOne({ zone_id: zoneId }).session(session);
      if (!zone) {
        res.status(404).json({ error: 'Not Found', message: `Zone ${zoneId} not found` });
        await session.abortTransaction();
        return;
      }

      const warehouse = await Warehouse.findOne({ code: zone.warehouse_id }).session(session);
      const sku = await Sku.findOne({
        $or: [{ code: sku_id }, ...(mongoose.Types.ObjectId.isValid(sku_id) ? [{ _id: sku_id }] : [])],
      }).session(session);

      if (!warehouse || !sku) {
        res.status(404).json({ error: 'Not Found', message: 'Warehouse or SKU master record not found' });
        await session.abortTransaction();
        return;
      }

      // Check on_hand in InventoryBalance
      const balance = await InventoryBalance.findOne({
        warehouse_id: warehouse._id,
        sku_id: sku._id,
      }).session(session);

      const onHand = balance?.on_hand || 0;

      // Sum existing assignments for this SKU in other zones of the warehouse
      const otherAssignments = await ZoneStockAssignment.find({
        warehouse_id: zone.warehouse_id,
        sku_id: sku.code,
        zone_id: { $ne: zoneId },
      }).session(session);

      const totalOther = otherAssignments.reduce((sum, a) => sum + a.units, 0);

      if (totalOther + units > onHand) {
        await session.abortTransaction();
        res.status(409).json({
          error: 'Conflict',
          message: `Assigned units (${totalOther + units}) exceed on-hand stock (${onHand}) for SKU ${sku.code}`,
          on_hand: onHand,
          total_assigned: totalOther,
          requested: units,
        });
        return;
      }

      const assignment = await ZoneStockAssignment.findOneAndUpdate(
        { warehouse_id: zone.warehouse_id, sku_id: sku.code, zone_id: zoneId },
        { $set: { units, created_at: new Date() } },
        { upsert: true, new: true, session },
      );

      await session.commitTransaction();

      // Return updated occupancy
      const occupancy = await computeZoneOccupancy(zoneId);
      await broadcastToTopic('capacity', {
        type: 'STOCK_ASSIGNED',
        zone_id: zoneId,
        warehouse_id: zone.warehouse_id,
        occupancy,
      });
      await broadcastToTopic('zones', {
        type: 'STOCK_ASSIGNED',
        zone_id: zoneId,
        warehouse_id: zone.warehouse_id,
        occupancy,
      });
      res.json({ success: true, assignment, occupancy });
    } catch (e) {
      await session.abortTransaction();
      next(e);
    } finally {
      session.endSession();
    }
  },
);

// ── 7. POST /capacity/check ──────────────────────────────────────────────────
zonesRouter.post(
  '/check',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { shipment_id, zone_id, slots } = req.body;
      if (!zone_id) {
        res.status(400).json({ error: 'Bad Request', message: 'zone_id is required' });
        return;
      }

      let requiredSlots = Number(slots) || 0;
      if (shipment_id && requiredSlots === 0) {
        const shipment = await Shipment.findOne({ code: shipment_id });
        if (shipment) {
          const lines = await ShipmentLine.find({ shipment_id: shipment._id }).populate('sku_id');
          for (const line of lines) {
            const sku = line.sku_id as any;
            const unitsPerSlot = sku?.units_per_slot || 10;
            requiredSlots += Math.ceil(line.quantity / unitsPerSlot);
          }
        }
      }

      const occupancy = await computeZoneOccupancy(zone_id);
      const projectedMetrics = getZoneColour(
        occupancy.capacity_slots,
        occupancy.occupied_slots,
        occupancy.reserved_inbound_slots + requiredSlots,
      );

      res.json({
        would_exceed: projectedMetrics.colour === 'RED',
        current: {
          capacity_slots: occupancy.capacity_slots,
          occupied_slots: occupancy.occupied_slots,
          reserved_inbound_slots: occupancy.reserved_inbound_slots,
          colour: occupancy.colour,
        },
        projected: projectedMetrics,
        colour: projectedMetrics.colour,
        explanation: projectedMetrics.explanation,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ── 8. POST /capacity/inbound-plans ──────────────────────────────────────────
zonesRouter.post(
  '/inbound-plans',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = req.user!;
      const { shipment_id, zone_id, slots, plan_over_capacity } = req.body;

      if (!shipment_id || !zone_id) {
        res.status(400).json({ error: 'Bad Request', message: 'shipment_id and zone_id are required' });
        await session.abortTransaction();
        return;
      }

      // Partial unique index check on PLANNED status
      const existingPlan = await InboundSlotPlan.findOne({
        shipment_id,
        status: 'PLANNED',
      }).session(session);

      if (existingPlan) {
        res.status(409).json({ error: 'Conflict', message: `Shipment ${shipment_id} already has a PLANNED slot plan` });
        await session.abortTransaction();
        return;
      }

      let requiredSlots = Number(slots) || 0;
      if (requiredSlots === 0) {
        const shipment = await Shipment.findOne({ code: shipment_id }).session(session);
        if (shipment) {
          const lines = await ShipmentLine.find({ shipment_id: shipment._id }).populate('sku_id').session(session);
          for (const line of lines) {
            const sku = line.sku_id as any;
            const unitsPerSlot = sku?.units_per_slot || 10;
            requiredSlots += Math.ceil(line.quantity / unitsPerSlot);
          }
        }
      }

      if (requiredSlots <= 0) requiredSlots = 1;

      // Lock and fetch zone
      const zone = await Zone.findOne({ zone_id }).session(session);
      if (!zone) {
        res.status(404).json({ error: 'Not Found', message: `Zone ${zone_id} not found` });
        await session.abortTransaction();
        return;
      }

      // Compute existing occupied slots from assignments
      const assignments = await ZoneStockAssignment.find({ zone_id }).session(session);
      const allSkus = await Sku.find({}).session(session);
      const skuMap = new Map<string, any>();
      for (const s of allSkus) {
        skuMap.set(s.code, s);
        skuMap.set(s._id.toString(), s);
      }

      let occupiedSlots = 0;
      for (const a of assignments) {
        const sku = skuMap.get(a.sku_id);
        const unitsPerSlot = sku?.units_per_slot || 10;
        occupiedSlots += Math.ceil(a.units / unitsPerSlot);
      }

      const totalProjected = occupiedSlots + zone.reserved_inbound_slots + requiredSlots;

      if (plan_over_capacity === true && user.role !== 'Manager') {
        await session.abortTransaction();
        res.status(403).json({
          error: 'Forbidden',
          message: 'Only Managers can plan over capacity',
        });
        return;
      }

      if (totalProjected > zone.capacity_slots) {
        if (user.role === 'Manager' && plan_over_capacity === true) {
          // Governed override by Manager
          await writeAudit(
            {
              action: 'OVER_CAPACITY_INBOUND_PLANNED',
              actor: user._id,
              entityType: 'InboundSlotPlan',
              entityId: shipment_id,
              before: { zone_id, reserved: zone.reserved_inbound_slots, capacity: zone.capacity_slots },
              after: { requested_slots: requiredSlots, total_projected: totalProjected },
            },
            session,
          );
        } else {
          await session.abortTransaction();
          res.status(409).json({
            error: 'Conflict',
            message: `Inbound plan (${totalProjected} slots) exceeds zone capacity (${zone.capacity_slots})`,
            capacity_slots: zone.capacity_slots,
            occupied_slots: occupiedSlots,
            reserved_inbound_slots: zone.reserved_inbound_slots,
            requested_slots: requiredSlots,
            would_total: totalProjected,
          });
          return;
        }
      }

      // Create plan
      const planDocs = await InboundSlotPlan.create(
        [
          {
            shipment_id,
            zone_id,
            slots: requiredSlots,
            status: 'PLANNED',
            created_at: new Date(),
          },
        ],
        { session },
      );

      // Increment reserved_inbound_slots on zone
      await Zone.updateOne(
        { zone_id },
        { $inc: { reserved_inbound_slots: requiredSlots } },
        { session },
      );

      await session.commitTransaction();

      // Trigger occupancy recompute and alert sync
      const occupancy = await computeZoneOccupancy(zone_id);
      await broadcastToTopic('capacity', {
        type: 'INBOUND_PLAN_COMMITTED',
        zone_id,
        warehouse_id: zone.warehouse_id,
        occupancy,
      });
      await broadcastToTopic('zones', {
        type: 'INBOUND_PLAN_COMMITTED',
        zone_id,
        warehouse_id: zone.warehouse_id,
        occupancy,
      });

      res.status(201).json({ success: true, plan: planDocs[0] });
    } catch (e: any) {
      await session.abortTransaction();
      if (
        e.code === 11000 ||
        e.code === 112 ||
        (typeof e.hasErrorLabel === 'function' && e.hasErrorLabel('TransientTransactionError'))
      ) {
        res.status(409).json({
          error: 'Conflict',
          message: 'Inbound plan exceeds zone capacity or concurrent slot reservation conflict',
        });
        return;
      }
      next(e);
    } finally {
      session.endSession();
    }
  },
);

// ── 9. DELETE /capacity/inbound-plans/:id (Release Plan) ─────────────────────
zonesRouter.delete(
  '/inbound-plans/:id',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const plan = await InboundSlotPlan.findById(req.params.id).session(session);
      if (!plan) {
        res.status(404).json({ error: 'Not Found', message: 'Inbound slot plan not found' });
        await session.abortTransaction();
        return;
      }

      if (plan.status === 'PLANNED') {
        plan.status = 'RELEASED';
        await plan.save({ session });

        await Zone.updateOne(
          { zone_id: plan.zone_id },
          { $inc: { reserved_inbound_slots: -plan.slots } },
          { session },
        );
      }

      await session.commitTransaction();

      // Recompute and clear alert if no longer RED
      const occupancy = await computeZoneOccupancy(plan.zone_id);
      await broadcastToTopic('capacity', {
        type: 'INBOUND_PLAN_RELEASED',
        zone_id: plan.zone_id,
        occupancy,
      });
      await broadcastToTopic('zones', {
        type: 'INBOUND_PLAN_RELEASED',
        zone_id: plan.zone_id,
        occupancy,
      });

      res.json({ success: true, released: true });
    } catch (e) {
      await session.abortTransaction();
      next(e);
    } finally {
      session.endSession();
    }
  },
);

// ── 10. GET /capacity/overview ───────────────────────────────────────────────
zonesRouter.get(
  '/overview',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rawWhId = (req.query.warehouse_id as string) || 'WH-HOS';
      const warehouseId = (await resolveWarehouseCode(rawWhId)) || 'WH-HOS';
      const zones = await Zone.find({
        warehouse_id: warehouseId,
        is_active: { $ne: false },
      }).lean();

      const detailedZones = await Promise.all(
        zones.map(async (z) => {
          return await computeZoneOccupancy(z.zone_id);
        }),
      );

      const totalCapacity = detailedZones.reduce((sum, z) => sum + z.capacity_slots, 0);
      const totalOccupied = detailedZones.reduce((sum, z) => sum + z.occupied_slots, 0);
      const totalReserved = detailedZones.reduce((sum, z) => sum + z.reserved_inbound_slots, 0);
      const overallMetrics = getZoneColour(totalCapacity, totalOccupied, totalReserved);

      res.json({
        warehouse_id: warehouseId,
        total_capacity_slots: totalCapacity,
        total_occupied_slots: totalOccupied,
        total_reserved_inbound_slots: totalReserved,
        overall_utilization_pct: overallMetrics.utilization_pct,
        overall_colour: overallMetrics.colour,
        overall_explanation: overallMetrics.explanation,
        zones: detailedZones,
      });
    } catch (e) {
      next(e);
    }
  },
);
