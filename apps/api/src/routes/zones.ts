/**
 * apps/api/src/routes/zones.ts
 *
 * Warehouse zone mapping and capacity management routes.
 * Enforces warehouse scoping for Warehouse_Operator on capacity view and zone edit.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Zone } from '../models/zones.js';
import { ZoneStockAssignment } from '../models/zone-stock-assignments.js';

export const zonesRouter = Router();

// GET /zones
zonesRouter.get(
  '/',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: Record<string, any> = {};
      if (req.query.warehouse_id) filter.warehouse_id = req.query.warehouse_id;

      const zones = await Zone.find(filter).lean();
      res.json(zones);
    } catch (e) {
      next(e);
    }
  },
);

// GET /zones/capacity
zonesRouter.get(
  '/capacity',
  authenticateToken,
  requirePermission('capacity.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: Record<string, any> = {};
      if (req.query.warehouse_id) filter.warehouse_id = req.query.warehouse_id;

      const zones = await Zone.find(filter).lean();
      const assignments = await ZoneStockAssignment.find(filter).lean();

      const capacityReport = zones.map((z) => {
        const zoneAssignments = assignments.filter((a) => a.zone_id === z.zone_id);
        const occupiedUnits = zoneAssignments.reduce((acc, curr) => acc + curr.units, 0);
        return {
          zone_id: z.zone_id,
          name: z.name,
          warehouse_id: z.warehouse_id,
          zone_type: z.zone_type,
          capacity_slots: z.capacity_slots,
          reserved_inbound_slots: z.reserved_inbound_slots,
          occupied_units: occupiedUnits,
          utilization_pct: z.capacity_slots > 0 ? Math.round((z.reserved_inbound_slots / z.capacity_slots) * 100) : 0,
        };
      });

      res.json(capacityReport);
    } catch (e) {
      next(e);
    }
  },
);

// POST /zones
zonesRouter.post(
  '/',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { zone_id, warehouse_id, name, zone_type, polygon, capacity_slots, reserved_inbound_slots } = req.body;
      const zone = await Zone.create({
        zone_id,
        warehouse_id,
        name,
        zone_type,
        polygon,
        capacity_slots,
        reserved_inbound_slots: reserved_inbound_slots || 0,
      });
      res.status(201).json(zone);
    } catch (e) {
      next(e);
    }
  },
);

// PATCH /zones/:zoneId
zonesRouter.patch(
  '/:zoneId',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const updateData: Record<string, any> = { ...req.body };
      updateData.$inc = { version: 1 };

      const updated = await Zone.findOneAndUpdate(
        { zone_id: req.params.zoneId },
        updateData,
        { new: true, runValidators: true },
      );
      if (!updated) {
        res.status(404).json({ error: 'Not Found', message: 'Zone not found' });
        return;
      }
      res.json(updated);
    } catch (e) {
      next(e);
    }
  },
);

