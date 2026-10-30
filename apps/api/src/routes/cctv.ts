/**
 * apps/api/src/routes/cctv.ts
 *
 * CCTV video ingestion, synthesis, damage detection, linking, and hotspot analytics.
 * Enforces warehouse scoping for Warehouse_Operator on ingest and view.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { CctvClip } from '../models/cctv-clips.js';
import { CctvEvent } from '../models/cctv-events.js';
import { EvidenceItem } from '../models/evidence-items.js';
import { SupplierClaim } from '../models/supplier-claims.js';
import { Shipment } from '../models/shipments.js';
import { Warehouse } from '../models/warehouses.js';
import { Sku } from '../models/skus.js';
import { reconcile } from '../services/reconciler.js';
import { writeLedgerEntry } from '../services/audit.js';
import { config } from '../config.js';

export const cctvRouter = Router();

async function matchesOperatorWarehouse(user: any, warehouseCodeOrId: string): Promise<boolean> {
  if (user.role !== 'Warehouse_Operator' || !user.warehouse_id) {
    return true;
  }
  const userWhStr = user.warehouse_id.toString();
  if (userWhStr === warehouseCodeOrId) return true;
  const whDoc = await Warehouse.findById(user.warehouse_id).lean();
  return whDoc ? whDoc.code === warehouseCodeOrId : false;
}

// Python helpers with FastAPI primary and CLI fallback
async function callVisionSynthesize(spec: Record<string, any>): Promise<any> {
  try {
    const res = await fetch(`${config.VISION_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(spec),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fall back to direct Python invocation
  }

  // CLI fallback
  const pyCode = `
import sys; sys.path.insert(0, '.')
import json
from services.vision.synthesizer import synthesize_clip
spec = json.loads(sys.argv[1])
out = synthesize_clip(spec)
print(json.dumps(out))
`;
  const stdout = execFileSync('python', ['-c', pyCode, JSON.stringify(spec)], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: '.' },
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

async function callVisionAnalyze(payload: {
  clip_path: string;
  parcel_to_shipment_map?: Record<string, string>;
  warehouse_id?: string;
  camera_id?: string;
  evidence_dir?: string;
  model_weights_path?: string;
}): Promise<any> {
  try {
    const res = await fetch(`${config.VISION_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Fall back to direct Python invocation
  }

  // CLI fallback
  const pyCode = `
import sys; sys.path.insert(0, '.')
import json
from services.vision.analyzer import analyze_clip
p = json.loads(sys.argv[1])
out = analyze_clip(
    clip_path=p.get('clip_path'),
    parcel_to_shipment_map=p.get('parcel_to_shipment_map'),
    warehouse_id=p.get('warehouse_id', 'WH-HOS'),
    camera_id=p.get('camera_id', 'CAM-01'),
    evidence_dir=p.get('evidence_dir'),
    model_weights_path=p.get('model_weights_path')
)
print(json.dumps(out))
`;
  const stdout = execFileSync('python', ['-c', pyCode, JSON.stringify(payload)], {
    encoding: 'utf-8',
    cwd: process.cwd(),
    env: { ...process.env, PYTHONPATH: '.' },
    maxBuffer: 50 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

// ---------------------------------------------------------------------------
// POST /cctv/clips/synthesize — Synthesize clip and save metadata
// ---------------------------------------------------------------------------
cctvRouter.post(
  '/clips/synthesize',
  authenticateToken,
  requirePermission('cctv.ingest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const warehouseId = req.body.warehouse_id || 'WH-HOS';

      // Warehouse scoping for operators
      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const isMatch = await matchesOperatorWarehouse(user, warehouseId);
        if (!isMatch) {
          res.status(403).json({ error: 'Forbidden', message: 'Cannot synthesize clip for another warehouse' });
          return;
        }
      }

      const spec = {
        warehouse_id: warehouseId,
        camera_id: req.body.camera_id || 'CAM-01',
        fps: req.body.fps || 15,
        seconds: req.body.seconds || 4,
        parcel_count: req.body.parcel_count || 2,
        injected_events: req.body.injected_events || [],
        seed: req.body.seed !== undefined ? req.body.seed : 42,
        clip_id: req.body.clip_id,
      };

      const synthRes = await callVisionSynthesize(spec);

      const clip = await CctvClip.findOneAndUpdate(
        { clip_id: synthRes.clip_id },
        {
          $set: {
            clip_id: synthRes.clip_id,
            warehouse_id: spec.warehouse_id,
            camera_id: spec.camera_id,
            synthetic_spec: spec,
            sha256: synthRes.sha256,
            frame_count: synthRes.frame_count,
            fps: synthRes.fps,
            created_at: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      res.status(201).json({
        clip,
        synth_result: synthRes,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /cctv/clips/:id/analyze — Analyze clip, record events & apply damage rules
// ---------------------------------------------------------------------------
cctvRouter.post(
  '/clips/:id/analyze',
  authenticateToken,
  requirePermission('cctv.ingest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const clipId = req.params.id;

      const clip = await CctvClip.findOne({ clip_id: clipId });
      if (!clip) {
        res.status(404).json({ error: 'Not Found', message: `CCTV clip ${clipId} not found` });
        return;
      }

      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const isMatch = await matchesOperatorWarehouse(user, clip.warehouse_id);
        if (!isMatch) {
          res.status(403).json({ error: 'Forbidden', message: 'Cannot analyze clip from another warehouse' });
          return;
        }
      }

      // Resolve video path: synthetic clips are placed under .data/cctv/clips/
      const expectedPath = path.resolve('.data', 'cctv', 'clips', `${clip.clip_id}.mp4`);
      let clipPath = expectedPath;
      if (!fs.existsSync(clipPath)) {
        // Fallback: check body or search
        clipPath = req.body.clip_path || expectedPath;
      }

      const evidenceDir = path.resolve(config.CCTV_EVIDENCE_DIR);
      fs.mkdirSync(evidenceDir, { recursive: true });

      const modelWeightsPath = path.resolve('services', 'vision', 'models', 'best.pt');

      const analysis = await callVisionAnalyze({
        clip_path: clipPath,
        parcel_to_shipment_map: req.body.parcel_to_shipment_map || {},
        warehouse_id: clip.warehouse_id,
        camera_id: clip.camera_id,
        evidence_dir: evidenceDir,
        model_weights_path: modelWeightsPath,
      });

      const eventsCreated: any[] = [];
      const claimsCreated: any[] = [];

      // Find warehouse and default sku documents for ledger operations
      const warehouseDoc = await Warehouse.findOne({ code: clip.warehouse_id }).lean();
      const skuDoc = await Sku.findOne({}).lean();

      for (const ev of analysis.events || []) {
        // Save evidence item if provided
        if (ev.evidence_path && ev.evidence_sha256) {
          await EvidenceItem.findOneAndUpdate(
            { evidence_id: ev.event_id },
            {
              $setOnInsert: {
                evidence_id: ev.event_id,
                kind: 'FRAME_SNAPSHOT',
                path: ev.evidence_path,
                sha256: ev.evidence_sha256,
                created_at: new Date(),
              },
            },
            { upsert: true, new: true },
          );
        }

        const band = ev.band;
        const unitsDamaged = ev.units_damaged || (band === 'SEVERE' ? 20 : band === 'MAJOR' ? 10 : 0);

        // Upsert CCTV event
        const cctvEvt = await CctvEvent.findOneAndUpdate(
          { clip_id: clip.clip_id, track_id: ev.track_id },
          {
            $set: {
              event_id: ev.event_id,
              clip_id: clip.clip_id,
              track_id: ev.track_id,
              shipment_id: ev.shipment_id || null,
              warehouse_id: clip.warehouse_id,
              camera_id: clip.camera_id,
              band,
              damage_score: ev.damage_score,
              components: ev.components,
              units_damaged: unitsDamaged,
              frame_start: ev.frame_start,
              frame_end: ev.frame_end,
              evidence_ids: [ev.event_id],
              status: 'DETECTED',
            },
          },
          { upsert: true, new: true },
        );
        eventsCreated.push(cctvEvt);

        // Apply Damage-to-Delay rules
        if (band === 'NONE') {
          // Do nothing
          continue;
        }

        if (band === 'MINOR') {
          // Accept, store note, no delay
          continue;
        }

        if (band === 'MAJOR' || band === 'SEVERE') {
          const delayHours = band === 'SEVERE' ? 48 : 24;

          let shipmentDoc: any = null;
          if (ev.shipment_id) {
            shipmentDoc = await Shipment.findOne({ code: ev.shipment_id });
          }

          if (shipmentDoc) {
            const currentEta = shipmentDoc.resolved_eta || shipmentDoc.current_eta || shipmentDoc.promised_eta || new Date();
            const newEta = new Date(new Date(currentEta).getTime() + delayHours * 3600 * 1000);

            // Reconcile event through Step 7 Reconciler
            await reconcile({
              source: 'CCTV',
              external_event_id: ev.event_id,
              event_type: 'DAMAGE_REPORT',
              shipment_code: shipmentDoc.code,
              reported_eta: newEta,
              quantity_affected: unitsDamaged,
              raw_payload: {
                clip_id: clip.clip_id,
                track_id: ev.track_id,
                damage_score: ev.damage_score,
                band,
                components: ev.components,
              },
              correlation_id: `CCTV-CORR-${ev.event_id}`,
            });
          }

          // Open Supplier Claim in status OPEN
          const supplierId = shipmentDoc?.supplier_id || 'SUP-1';
          const claimId = `CLM-${ev.event_id}`;

          const claim = await SupplierClaim.findOneAndUpdate(
            { cctv_event_id: ev.event_id },
            {
              $setOnInsert: {
                claim_id: claimId,
                supplier_id: supplierId,
                shipment_id: ev.shipment_id || (shipmentDoc?.code ?? 'UNKNOWN'),
                cctv_event_id: ev.event_id,
                band,
                units: unitsDamaged > 0 ? unitsDamaged : 10,
                delay_hours: delayHours,
                status: 'OPEN',
                supplier_response: null,
                decided_by: null,
                linked_by: null,
                evidence_ids: [ev.event_id],
                version: 1,
                created_at: new Date(),
              },
            },
            { upsert: true, new: true },
          );
          claimsCreated.push(claim);

          // For SEVERE: Quarantine units through the ledger service without direct on_hand mutation
          if (band === 'SEVERE') {
            await writeLedgerEntry({
              stepType: 'QUARANTINE',
              warehouseId: warehouseDoc?._id || null,
              skuId: skuDoc?._id || null,
              deltaOnHand: 0, // Never edit on_hand directly!
              beforeState: { quarantined_units: 0 },
              afterState: {
                quarantined_units: unitsDamaged > 0 ? unitsDamaged : 20,
                event_id: ev.event_id,
                band: 'SEVERE',
                reason: 'CCTV SEVERE damage detected: quarantine structural crush',
              },
              actor: user._id,
            });
          }
        }
      }

      res.json({
        clip_id: clip.clip_id,
        analysis,
        events: eventsCreated,
        claims: claimsCreated,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /cctv/events — List damage events with filters & warehouse scoping
// ---------------------------------------------------------------------------
cctvRouter.get(
  '/events',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const whDoc = await Warehouse.findById(user.warehouse_id).lean();
        filter.warehouse_id = whDoc ? whDoc.code : user.warehouse_id.toString();
      } else if (req.query.warehouse_id) {
        filter.warehouse_id = req.query.warehouse_id;
      }

      if (req.query.clip_id) filter.clip_id = req.query.clip_id;
      if (req.query.shipment_id) filter.shipment_id = req.query.shipment_id;
      if (req.query.band) filter.band = req.query.band;
      if (req.query.status) filter.status = req.query.status;

      const events = await CctvEvent.find(filter).sort({ created_at: -1 }).lean();
      res.json(events);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /cctv/events/:id/link — Warehouse operator confirms event & binds shipment
// ---------------------------------------------------------------------------
cctvRouter.post(
  '/events/:id/link',
  authenticateToken,
  requirePermission('cctv.ingest'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const eventId = req.params.id;

      const event = await CctvEvent.findOne({ event_id: eventId });
      if (!event) {
        res.status(404).json({ error: 'Not Found', message: `CCTV event ${eventId} not found` });
        return;
      }

      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const isMatch = await matchesOperatorWarehouse(user, event.warehouse_id);
        if (!isMatch) {
          res.status(403).json({ error: 'Forbidden', message: 'Cannot link event from another warehouse' });
          return;
        }
      }

      const shipmentId = req.body.shipment_id || event.shipment_id;
      event.status = 'LINKED';
      if (shipmentId) {
        event.shipment_id = shipmentId;
      }
      event.linked_by = user.username || user._id.toString();
      event.linked_at = new Date();
      await event.save();

      // Propagate linking operator to any associated supplier claim to enforce separation of duties
      await SupplierClaim.updateMany(
        { cctv_event_id: event.event_id },
        {
          $set: {
            linked_by: event.linked_by,
            ...(shipmentId ? { shipment_id: shipmentId } : {}),
          },
        },
      );

      res.json(event);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /cctv/hotspots — Aggregate damage counts by camera, warehouse & band
// ---------------------------------------------------------------------------
cctvRouter.get(
  '/hotspots',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const match: Record<string, any> = {};

      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const whDoc = await Warehouse.findById(user.warehouse_id).lean();
        match.warehouse_id = whDoc ? whDoc.code : user.warehouse_id.toString();
      } else if (req.query.warehouse_id) {
        match.warehouse_id = req.query.warehouse_id;
      }

      const hotspots = await CctvEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              camera_id: '$camera_id',
              warehouse_id: '$warehouse_id',
              band: '$band',
            },
            count: { $sum: 1 },
            total_damage_score: { $sum: '$damage_score' },
            total_units_damaged: { $sum: '$units_damaged' },
          },
        },
        { $sort: { count: -1, total_damage_score: -1 } },
        {
          $project: {
            _id: 0,
            camera_id: '$_id.camera_id',
            warehouse_id: '$_id.warehouse_id',
            band: '$_id.band',
            count: 1,
            total_damage_score: 1,
            total_units_damaged: 1,
          },
        },
      ]);

      res.json(hotspots);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /cctv/clips — List CCTV clips
// ---------------------------------------------------------------------------
cctvRouter.get(
  '/clips',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      if (user.role === 'Warehouse_Operator' && user.warehouse_id) {
        const whDoc = await Warehouse.findById(user.warehouse_id).lean();
        filter.warehouse_id = whDoc ? whDoc.code : user.warehouse_id.toString();
      } else if (req.query.warehouse_id) {
        filter.warehouse_id = req.query.warehouse_id;
      }

      const clips = await CctvClip.find(filter).sort({ created_at: -1 }).lean();
      res.json(clips);
    } catch (e) {
      next(e);
    }
  },
);
