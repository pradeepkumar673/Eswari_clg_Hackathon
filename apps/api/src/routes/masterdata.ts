/**
 * apps/api/src/routes/masterdata.ts
 *
 * Master Data CRUD (Step 11 Part B, B10) & Governed Inventory Corrections.
 *
 * Endpoints:
 *   GET    /admin/master/:entity       (Administrator only)
 *   POST   /admin/master/:entity      (Administrator only)
 *   PATCH  /admin/master/:entity/:id  (Administrator only)
 *   DELETE /admin/master/:entity/:id  (Administrator only - soft deactivates, never hard deletes)
 *   POST   /inventory/corrections     (Manager, Administrator)
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Supplier } from '../models/suppliers.js';
import { Warehouse } from '../models/warehouses.js';
import { Sku } from '../models/skus.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { Order } from '../models/orders.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { verifyPlan } from '../services/proofChecker.js';
import { applyInventoryCorrection } from '../services/inventoryCorrection.js';
import { writeAudit } from '../services/audit.js';
import { publish } from '../services/bus.js';

export const masterDataRouter = Router();

// ---------------------------------------------------------------------------
// Entity mapping and schemas
// ---------------------------------------------------------------------------

const ENTITY_MODELS: Record<string, mongoose.Model<any>> = {
  suppliers: Supplier,
  warehouses: Warehouse,
  skus: Sku,
  lanes: TransferLane,
  supplier_capacity: SupplierSku,
  'supplier-capacity': SupplierSku,
  orders: Order,
};

const SupplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  risk_score: z.number().min(0).max(100).optional().default(0),
  lead_time_hours: z.number().min(0).optional().default(24),
  map_x: z.number().min(0).max(1000).optional().default(100),
  map_y: z.number().min(0).max(1000).optional().default(100),
  on_time_rate: z.number().min(0).max(1).nullable().optional(),
  quality_score: z.number().min(0).max(1).nullable().optional(),
  is_active: z.boolean().optional().default(true),
});

const WarehouseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  map_x: z.number().min(0).max(1000).optional().default(100),
  map_y: z.number().min(0).max(1000).optional().default(100),
  processing_hours: z.number().min(0).optional().default(2),
  is_hub: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
});

const SkuSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  unit_cost: z.number().min(0),
  weight_kg: z.number().min(0).optional().default(1),
  category: z.string().min(1).optional().default('General'),
  is_critical: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
});

const LaneSchema = z.object({
  from_warehouse_id: z.string().min(1),
  to_warehouse_id: z.string().min(1),
  transit_hours: z.number().min(0),
  cost_per_unit: z.number().min(0),
  distance_km: z.number().min(0),
  is_active: z.boolean().optional().default(true),
});

const SupplierCapacitySchema = z.object({
  supplier_id: z.string().min(1),
  sku_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  capacity_per_shipment: z.number().min(0),
  lead_time_hours: z.number().min(0),
  unit_cost: z.number().min(0),
  is_qualified: z.boolean().optional().default(true),
});

const OrderSchema = z.object({
  code: z.string().min(1),
  customer_name: z.string().min(1),
  destination_hub: z.string().min(1),
  priority: z.enum(['CRITICAL', 'HIGH', 'STANDARD']),
  sla_deadline: z.string().or(z.date()),
  penalty_hourly: z.number().min(0),
  status: z.enum(['CONFIRMED', 'FULFILLED', 'CANCELLED', 'BACKORDERED']).optional().default('CONFIRMED'),
});

function getSchemaForEntity(entity: string): z.ZodSchema<any> | null {
  switch (entity) {
    case 'suppliers': return SupplierSchema;
    case 'warehouses': return WarehouseSchema;
    case 'skus': return SkuSchema;
    case 'lanes': return LaneSchema;
    case 'supplier_capacity':
    case 'supplier-capacity': return SupplierCapacitySchema;
    case 'orders': return OrderSchema;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// GET /admin/master/:entity — List master data items
// ---------------------------------------------------------------------------
masterDataRouter.get(
  '/master/:entity',
  authenticateToken,
  requirePermission('master_data_crud'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entity } = req.params;
      const Model = ENTITY_MODELS[entity];
      if (!Model) {
        res.status(404).json({ error: { code: 'UNKNOWN_ENTITY', message: `Master data entity ${entity} not found` } });
        return;
      }

      const includeInactive = req.query.include_inactive === 'true';
      const query: any = {};
      if (!includeInactive && Model.schema.path('is_active')) {
        query.is_active = { $ne: false };
      }

      const items = await Model.find(query).lean();
      res.status(200).json(items);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /admin/master/:entity — Create master data item
// ---------------------------------------------------------------------------
masterDataRouter.post(
  '/master/:entity',
  authenticateToken,
  requirePermission('master_data_crud'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entity } = req.params;

      // Reject direct on_hand edits
      if (req.body && (req.body.on_hand !== undefined || req.body.onHand !== undefined)) {
        res.status(400).json({
          error: {
            code: 'DIRECT_ON_HAND_EDIT_PROHIBITED',
            message: 'Editing on_hand directly is prohibited. Use /inventory/corrections.',
          },
        });
        return;
      }

      const Model = ENTITY_MODELS[entity];
      if (!Model) {
        res.status(404).json({ error: { code: 'UNKNOWN_ENTITY', message: `Master data entity ${entity} not found` } });
        return;
      }

      const schema = getSchemaForEntity(entity);
      if (schema) {
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message, details: parsed.error.issues } });
          return;
        }
      }

      const doc = await Model.create(req.body);

      await writeAudit({
        actor: req.user!._id,
        action: 'MASTER_DATA_CREATED',
        entityType: entity,
        entityId: doc._id.toString(),
        after: doc.toObject ? doc.toObject() : doc,
      });

      res.status(201).json(doc);
    } catch (e: any) {
      if (e.code === 11000) {
        res.status(409).json({ error: { code: 'DUPLICATE_KEY', message: 'Item with unique identifier already exists' } });
        return;
      }
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /admin/master/:entity/:id — Update master data item
// ---------------------------------------------------------------------------
masterDataRouter.patch(
  '/master/:entity/:id',
  authenticateToken,
  requirePermission('master_data_crud'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entity, id } = req.params;

      // Reject direct on_hand edits
      if (req.body && (req.body.on_hand !== undefined || req.body.onHand !== undefined)) {
        res.status(400).json({
          error: {
            code: 'DIRECT_ON_HAND_EDIT_PROHIBITED',
            message: 'Editing on_hand directly is prohibited. Use /inventory/corrections.',
          },
        });
        return;
      }

      const Model = ENTITY_MODELS[entity];
      if (!Model) {
        res.status(404).json({ error: { code: 'UNKNOWN_ENTITY', message: `Master data entity ${entity} not found` } });
        return;
      }

      const before = await Model.findById(id).lean();
      if (!before) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
        return;
      }

      const updated = await Model.findByIdAndUpdate(id, { $set: req.body }, { new: true }).lean();

      await writeAudit({
        actor: req.user!._id,
        action: 'MASTER_DATA_UPDATED',
        entityType: entity,
        entityId: id,
        before,
        after: updated,
      });

      res.status(200).json(updated);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /admin/master/:entity/:id — Soft-delete / deactivate (never hard delete)
// ---------------------------------------------------------------------------
masterDataRouter.delete(
  '/master/:entity/:id',
  authenticateToken,
  requirePermission('master_data_crud'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { entity, id } = req.params;

      const Model = ENTITY_MODELS[entity];
      if (!Model) {
        res.status(404).json({ error: { code: 'UNKNOWN_ENTITY', message: `Master data entity ${entity} not found` } });
        return;
      }

      const doc = await Model.findById(id);
      if (!doc) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Item not found' } });
        return;
      }

      // Soft deactivate
      doc.is_active = false;
      await doc.save();

      await writeAudit({
        actor: req.user!._id,
        action: 'MASTER_DATA_DEACTIVATED',
        entityType: entity,
        entityId: id,
        after: { is_active: false },
      });

      res.status(200).json({ ok: true, deactivated: true, entity, id });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /inventory/corrections (Manager, Administrator) — Step 11 Part B
// ---------------------------------------------------------------------------
masterDataRouter.post(
  '/inventory/corrections',
  authenticateToken,
  requirePermission('inventory_correction'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { warehouse_id, sku_id, new_on_hand, reason } = req.body;

      if (!warehouse_id || !sku_id || new_on_hand === undefined) {
        res.status(400).json({
          error: { code: 'MISSING_FIELDS', message: 'warehouse_id, sku_id, and new_on_hand are required' },
        });
        return;
      }

      if (typeof new_on_hand !== 'number' || new_on_hand < 0) {
        res.status(400).json({
          error: { code: 'INVALID_QUANTITY', message: 'new_on_hand must be a non-negative number' },
        });
        return;
      }

      const warehouseObjectId = new mongoose.Types.ObjectId(warehouse_id);
      const skuObjectId = new mongoose.Types.ObjectId(sku_id);

      const balance = await InventoryBalance.findOne({
        warehouse_id: warehouseObjectId,
        sku_id: skuObjectId,
      });

      // Check if touches stock reserved by an open plan -> return 409
      if (balance && new_on_hand < balance.reserved) {
        res.status(409).json({
          error: {
            code: 'STOCK_RESERVED_BY_OPEN_PLAN',
            message: `Cannot reduce on_hand to ${new_on_hand} because ${balance.reserved} units are reserved by open plans`,
          },
        });
        return;
      }

      // Governed ledger correction
      const result = await applyInventoryCorrection({
        warehouseId: warehouseObjectId,
        skuId: skuObjectId,
        newOnHand: new_on_hand,
        reason: reason || 'Inventory cycle count correction',
        actor: req.user!._id,
      });

      // Re-verify any open plans that might be affected by this SKU/warehouse
      const openPlans = await RecoveryPlan.find({
        status: { $in: ['DRAFT', 'VERIFIED', 'PENDING_APPROVAL'] },
      });

      for (const plan of openPlans) {
        const verifyRes = await verifyPlan(plan._id);
        if (verifyRes.status === 'BLOCKED') {
          plan.status = 'BLOCKED';
          await plan.save();
        }
      }

      // Emit INVENTORY_CORRECTED domain bus event
      await publish('INVENTORY_CORRECTED', {
        warehouseId: warehouse_id,
        skuId: sku_id,
        newOnHand: new_on_hand,
        actor: req.user!._id.toString(),
      });

      res.status(200).json({
        ok: true,
        correction: result,
        message: 'Inventory balance adjusted through governed ledger',
      });
    } catch (e: any) {
      if (e.statusCode) {
        res.status(e.statusCode).json({ error: { code: e.code || 'CORRECTION_FAILED', message: e.message } });
        return;
      }
      next(e);
    }
  },
);
