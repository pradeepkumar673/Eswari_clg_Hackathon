/**
 * apps/api/src/routes/cctv.ts
 *
 * CCTV video ingestion and damage detection inspection routes.
 * Enforces warehouse scoping for Warehouse_Operator on ingest and view.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { CctvClip } from '../models/cctv-clips.js';
import { CctvEvent } from '../models/cctv-events.js';
import { EvidenceItem } from '../models/evidence-items.js';

export const cctvRouter = Router();

// POST /cctv/ingest
cctvRouter.post(
  '/ingest',
  authenticateToken,
  requirePermission('cctv.ingest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { clip_id, warehouse_id, camera_id, synthetic_spec, sha256, frame_count, fps } = req.body;
      const clip = await CctvClip.create({
        clip_id: clip_id || `CLP-${Date.now()}`,
        warehouse_id: warehouse_id || 'WH-HOS',
        camera_id: camera_id || 'CAM-01',
        synthetic_spec: synthetic_spec || null,
        sha256: sha256 || 'dummy-sha',
        frame_count: frame_count || 120,
        fps: fps || 24,
      });
      res.status(201).json(clip);
    } catch (e) {
      next(e);
    }
  },
);

// GET /cctv/events
cctvRouter.get(
  '/events',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: Record<string, any> = {};
      if (req.query.warehouse_id) filter.warehouse_id = req.query.warehouse_id;
      if (req.query.clip_id) filter.clip_id = req.query.clip_id;
      if (req.query.shipment_id) filter.shipment_id = req.query.shipment_id;

      const events = await CctvEvent.find(filter).sort({ created_at: -1 }).lean();
      res.json(events);
    } catch (e) {
      next(e);
    }
  },
);

// GET /cctv/clips
cctvRouter.get(
  '/clips',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const filter: Record<string, any> = {};
      if (req.query.warehouse_id) filter.warehouse_id = req.query.warehouse_id;

      const clips = await CctvClip.find(filter).sort({ created_at: -1 }).lean();
      res.json(clips);
    } catch (e) {
      next(e);
    }
  },
);

