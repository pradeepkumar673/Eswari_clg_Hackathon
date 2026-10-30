/**
 * apps/api/src/routes/warehouses.ts
 *
 * Warehouse master list.
 *  GET   /warehouses          every signed-in role (drivers, analysts, operators, managers, admins)
 *  POST  /warehouses          Manager / Administrator: create a warehouse
 *  PATCH /warehouses/:code    Manager / Administrator: rename, move, activate or deactivate
 * Every create or change broadcasts on the 'warehouses' topic so open screens refresh.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Warehouse } from '../models/warehouses.js';
import { writeAudit } from '../services/audit.js';
import { broadcastToTopic } from '../services/websocket.js';

export const warehousesRouter = Router();

const CodeSchema = z
  .string()
  .regex(/^WH-[A-Z0-9]{2,10}$/, 'Code must look like WH-KRS (2 to 10 letters or digits after WH-)');

const CreateSchema = z.object({
  code: CodeSchema,
  name: z.string().trim().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  processing_hours: z.number().min(0).max(72).default(2),
  is_hub: z.boolean().default(false),
  map_x: z.number().min(0).max(1000).optional(),
  map_y: z.number().min(0).max(1000).optional(),
});

const PatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  processing_hours: z.number().min(0).max(72).optional(),
  is_hub: z.boolean().optional(),
  is_active: z.boolean().optional(),
});

function publicView(w: any) {
  return {
    _id: String(w._id),
    code: w.code,
    name: w.name,
    lat: w.lat ?? null,
    lng: w.lng ?? null,
    map_x: w.map_x,
    map_y: w.map_y,
    footprint: w.footprint ?? null,
    footprint_updated_at: w.footprint_updated_at ?? null,
    processing_hours: w.processing_hours,
    is_hub: !!w.is_hub,
    is_active: w.is_active !== false,
    created_at: w.created_at,
  };
}

// ── GET /warehouses ──────────────────────────────────────────────────────────
warehousesRouter.get(
  '/warehouses',
  authenticateToken,
  requirePermission('warehouse.read'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const wantInactive = String(req.query.include_inactive ?? '') === 'true';
      const isAdmin = req.user!.role === 'Administrator';
      const filter = wantInactive && isAdmin ? {} : { is_active: { $ne: false } };
      const list = await Warehouse.find(filter).sort({ code: 1 }).lean();
      res.json(list.map(publicView));
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /warehouses ─────────────────────────────────────────────────────────
warehousesRouter.post(
  '/warehouses',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = CreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Bad Request',
          message: parsed.error.issues[0]?.message ?? 'Invalid warehouse',
          details: parsed.error.issues,
        });
        return;
      }
      const data = parsed.data;

      if (await Warehouse.exists({ code: data.code })) {
        res.status(409).json({ error: 'Conflict', message: `Warehouse ${data.code} already exists` });
        return;
      }

      // Schematic position on the Zone Grid: spread new sites out unless a position is given
      const count = await Warehouse.countDocuments({});
      const doc = await Warehouse.create({
        code: data.code,
        name: data.name,
        lat: data.lat,
        lng: data.lng,
        map_x: data.map_x ?? ((count * 120 + 100) % 900) + 50,
        map_y: data.map_y ?? 500,
        processing_hours: data.processing_hours,
        is_hub: data.is_hub,
        is_active: true,
        created_at: new Date(),
      });

      try {
        await writeAudit({
          action: 'WAREHOUSE_CREATED',
          actor: (req.user as any)?._id || (req.user as any)?.id || (req.user as any)?.sub,
          entityType: 'Warehouse',
          entityId: doc.code,
          before: null,
          after: publicView(doc.toObject()),
        } as any);
      } catch {
        // audit failure must not block the save
      }

      await broadcastToTopic('warehouses', {
        type: 'WAREHOUSE_CHANGED',
        action: 'CREATED',
        code: doc.code,
        warehouse: publicView(doc.toObject()),
      });

      res.status(201).json(publicView(doc.toObject()));
    } catch (err) {
      next(err);
    }
  },
);

// ── PATCH /warehouses/:code ──────────────────────────────────────────────────
warehousesRouter.patch(
  '/warehouses/:code',
  authenticateToken,
  requirePermission('zone.edit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const code = req.params.code;
      const parsed = PatchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Bad Request', message: parsed.error.issues[0]?.message ?? 'Invalid update' });
        return;
      }

      const before: any = await Warehouse.findOne({ code }).lean();
      if (!before) {
        res.status(404).json({ error: 'Not Found', message: `Warehouse ${code} not found` });
        return;
      }

      const updated: any = await Warehouse.findOneAndUpdate(
        { code },
        { $set: parsed.data },
        { new: true },
      ).lean();

      try {
        await writeAudit({
          action: 'WAREHOUSE_UPDATED',
          actor: (req.user as any)?._id || (req.user as any)?.id || (req.user as any)?.sub,
          entityType: 'Warehouse',
          entityId: code,
          before: publicView(before),
          after: publicView(updated),
        } as any);
      } catch {
        // audit failure must not block the save
      }

      await broadcastToTopic('warehouses', {
        type: 'WAREHOUSE_CHANGED',
        action: 'UPDATED',
        code,
        warehouse: publicView(updated),
      });

      res.json(publicView(updated));
    } catch (err) {
      next(err);
    }
  },
);

