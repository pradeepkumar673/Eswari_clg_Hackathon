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
import { authenticateToken, requirePermission, requireAnyPermission } from '../middleware/auth.js';
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
import { SupplierClaim } from '../models/supplier-claims.js';
import { Supplier } from '../models/suppliers.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getBandForScore } from '../services/impactEngine.js';
import { getDecisionReplay } from '../services/replay.js';
import { getSimilarCases, closeDisruptionAndSaveCase } from '../services/playbook.js';
import { getDisruptionFingerprints } from '../services/fingerprints.js';
import { EvidenceItem } from '../models/evidence-items.js';
import { CctvEvent } from '../models/cctv-events.js';
import { Warehouse } from '../models/warehouses.js';
import { Sku } from '../models/skus.js';
import { config } from '../config.js';

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

// ── GET /disruptions/:id/impact ─────────────────────────────────────────────
// Real impact for one disruption: ranked orders, summary, and heat-grid.
const IMPACT_HOUR_MS = 3_600_000;
const impactRound1 = (n: number) => Math.round(n * 10) / 10;
const IMPACT_WEIGHTS = { urgency: 35, shortage: 30, delay: 20, priority: 15 } as const;
const BAND_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Display band from the 0-100 score. Thresholds match the screen's labels. */
function scoreToDisplayBand(score: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

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

    const disruption: any = await Disruption.findById(id).lean();
    if (!disruption) {
      res.status(404).json({ error: 'Not Found', message: 'Disruption not found' });
      return;
    }

    const shipment: any = await Shipment.findById(disruption.shipment_id).lean();
    const etaMs = shipment
      ? new Date(shipment.resolved_eta ?? shipment.current_eta).getTime()
      : null;

    const snapshots: any[] = await OrderRiskSnapshot.find({ disruption_id: disruption._id }).lean();
    const orderIds = snapshots.map((s) => s.order_id);

    const [orders, lines, warehouses, skus] = await Promise.all([
      Order.find({ _id: { $in: orderIds } }).lean(),
      OrderLine.find({ order_id: { $in: orderIds } }).lean(),
      Warehouse.find({}).lean(),
      Sku.find({}).lean(),
    ]);

    const orderMap = new Map<string, any>(orders.map((o: any) => [String(o._id), o]));
    const whMap = new Map<string, any>(warehouses.map((w: any) => [String(w._id), w]));
    const skuMap = new Map<string, any>(skus.map((k: any) => [String(k._id), k]));
    const lineByOrder = new Map<string, any>();
    for (const l of lines) {
      if (!lineByOrder.has(String(l.order_id))) lineByOrder.set(String(l.order_id), l);
    }

    const ranked = snapshots
      .map((s) => {
        const o: any = orderMap.get(String(s.order_id));
        const line: any = lineByOrder.get(String(s.order_id));
        const sku: any = line ? skuMap.get(String(line.sku_id)) : null;

        const dueMs = o ? new Date(o.due_at).getTime() : 0;
        // Hours the best-known ETA lands after the order's due date (0 if on time)
        const hoursLate = etaMs !== null ? Math.max(0, impactRound1((etaMs - dueMs) / IMPACT_HOUR_MS)) : 0;
        // Exposure = contract penalty per hour x hours late
        const penalty = o ? Math.round((o.penalty_per_hour || 0) * hoursLate) : 0;
        const score: number = s.risk_score;

        return {
          order_id: String(s.order_id),
          order_code: o?.code ?? String(s.order_id),
          customer_name: o?.customer_name ?? '—',
          priority: o?.priority ?? null,
          sku_code: sku?.code ?? null,
          quantity: line?.quantity ?? 0,
          warehouse_code: whMap.get(String(o?.warehouse_id))?.code ?? null,
          original_due_date: o?.due_at ?? null,
          best_recoverable_date: shipment?.promised_eta ?? null,
          committed_promise_date: null,
          hours_late: hoursLate,
          penalty_exposure: penalty,
          score,
          best_case_score: s.best_case_score,
          worst_case_score: s.worst_case_score,
          risk_band: scoreToDisplayBand(score),
          policy_band: s.band,
          // Points add up to the score: 35*U + 30*S + 20*D + 15*P
          factors: {
            urgency_pts: impactRound1(IMPACT_WEIGHTS.urgency * s.urgency),
            shortage_pts: impactRound1(IMPACT_WEIGHTS.shortage * s.supply_gap),
            delay_pts: impactRound1(IMPACT_WEIGHTS.delay * s.delay_factor),
            priority_pts: impactRound1(IMPACT_WEIGHTS.priority * s.penalty_factor),
          },
        };
      })
      .sort((a, b) => b.score - a.score || b.penalty_exposure - a.penalty_exposure);

    const countBand = (band: string) => ranked.filter((r) => r.risk_band === band).length;

    const cells = new Map<string, any>();
    for (const r of ranked) {
      const key = `${r.warehouse_code}|${r.sku_code}`;
      const cell = cells.get(key) ?? {
        warehouse: r.warehouse_code ?? '—',
        sku: r.sku_code ?? '—',
        impact_count: 0,
        severity: 'LOW',
      };
      cell.impact_count += 1;
      if (BAND_RANK[r.risk_band] > BAND_RANK[cell.severity]) cell.severity = r.risk_band;
      cells.set(key, cell);
    }

    const affectedOrders = snapshots.map((s) => ({
      snapshot_id: s._id,
      order: orderMap.get(String(s.order_id)) || s.order_id,
      risk_score: s.risk_score,
      band: s.band,
    }));

    res.status(200).json({
      disruption_id: id,
      disruption: {
        _id: String(disruption._id),
        disruption_type: disruption.disruption_type,
        severity: disruption.severity,
        status: disruption.status,
        delay_hours: disruption.delay_hours,
        detected_at: disruption.detected_at,
        shipment_code: shipment?.code ?? null,
      },
      summary: {
        total_orders: ranked.length,
        critical_count: countBand('CRITICAL'),
        high_count: countBand('HIGH'),
        total_penalty: ranked.reduce((a, r) => a + r.penalty_exposure, 0),
        avg_delay_hours: ranked.length
          ? impactRound1(ranked.reduce((a, r) => a + r.hours_late, 0) / ranked.length)
          : 0,
      },
      ranked_orders: ranked,
      affected_orders: affectedOrders,
      orders: ranked,
      heatgrid: Array.from(cells.values()),
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

async function supplierOwnsEvidence(user: any, evidenceId: string): Promise<boolean> {
  if (user?.role?.toUpperCase() !== 'SUPPLIER') return true;
  const claim = await SupplierClaim.findOne({ evidence_ids: evidenceId }).lean();
  if (!claim) return false;
  if (claim.supplier_id === user.supplier_id) return true;
  if (user.supplier_id) {
    const isObjectId = mongoose.Types.ObjectId.isValid(user.supplier_id);
    const supDoc = await Supplier.findOne({
      $or: [{ code: user.supplier_id }, ...(isObjectId ? [{ _id: user.supplier_id }] : [])],
    }).lean();
    if (supDoc && (claim.supplier_id === supDoc._id.toString() || claim.supplier_id === supDoc.code)) {
      return true;
    }
  }
  return false;
}

// GET /evidence/:id/file — Stream evidence file to roles with cctv.view (warehouse-scoped) or supplier with claim.read.own
evidenceRouter.get(
  '/:id/file',
  authenticateToken,
  requireAnyPermission(['cctv.view', 'claim.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let item = await EvidenceItem.findOne({ evidence_id: req.params.id }).lean();
      if (!item) {
        // Try looking up via CctvEvent
        const cctvEvt = await CctvEvent.findOne({
          $or: [{ event_id: req.params.id }, { evidence_ids: req.params.id }],
        }).lean();
        if (cctvEvt?.evidence_ids?.length) {
          item = await EvidenceItem.findOne({ evidence_id: { $in: cctvEvt.evidence_ids } }).lean();
        }
      }
      if (!item) {
        // Try looking up via SupplierClaim
        const claim = await SupplierClaim.findOne({
          $or: [{ claim_id: req.params.id }, { cctv_event_id: req.params.id }, { evidence_ids: req.params.id }],
        }).lean();
        if (claim?.evidence_ids?.length) {
          item = await EvidenceItem.findOne({ evidence_id: { $in: claim.evidence_ids } }).lean();
        }
      }

      if (!item) {
        res.status(404).json({ error: 'Not Found', message: `Evidence item ${req.params.id} not found` });
        return;
      }

      if (req.user?.role?.toUpperCase() === 'SUPPLIER') {
        const owns = await supplierOwnsEvidence(req.user, item.evidence_id);
        if (!owns) {
          res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot access evidence from other claims' });
          return;
        }
      } else if (req.user?.role === 'Warehouse_Operator' && req.user.warehouse_id) {
        const cctvEvt = await CctvEvent.findOne({ evidence_ids: item.evidence_id }).lean();
        if (cctvEvt) {
          const userWhStr = req.user.warehouse_id.toString();
          let isMatch = userWhStr === cctvEvt.warehouse_id;
          if (!isMatch) {
            const whDoc = await Warehouse.findById(req.user.warehouse_id).lean();
            if (whDoc && whDoc.code === cctvEvt.warehouse_id) {
              isMatch = true;
            }
          }
          if (!isMatch) {
            res.status(403).json({ error: 'Forbidden', message: 'Warehouse operator cannot access evidence from other warehouses' });
            return;
          }
        }
      }

      let filePath = item.path;
      if (!fs.existsSync(filePath)) {
        // Try relative to CCTV_EVIDENCE_DIR
        const altPath = path.resolve(config.CCTV_EVIDENCE_DIR, path.basename(item.path));
        if (fs.existsSync(altPath)) {
          filePath = altPath;
        } else {
          // Fallback to sample evidence if available
          const samplePath = path.resolve('.data', 'evidence', 'sample_cctv_evidence.jpg');
          if (fs.existsSync(samplePath)) {
            filePath = samplePath;
          } else {
            res.status(404).json({ error: 'Not Found', message: 'Evidence file not found on disk' });
            return;
          }
        }
      }

      const isVideo = filePath.toLowerCase().endsWith('.mp4');
      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (isVideo && range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
        return;
      }

      res.setHeader('Content-Type', isVideo ? 'video/mp4' : (filePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'));
      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(filePath).pipe(res);
    } catch (e) {
      next(e);
    }
  },
);

// GET /evidence/video — Stream the uploaded warehouse CCTV video directly
evidenceRouter.get(
  '/video',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidatePaths = [
        'D:\\Downloads\\073623.mp4\\073623.mp4',
        path.resolve('apps', 'web', 'public', 'cctv', '073623.mp4'),
        path.resolve('apps', 'web', 'public', 'cctv', 'warehouse-cctv.mp4'),
        path.resolve('.data', 'evidence', '073623.mp4'),
        path.resolve('.data', 'cctv', 'clips', '073623.mp4'),
      ];

      const videoPath = candidatePaths.find((p) => fs.existsSync(p));
      if (!videoPath) {
        res.status(404).json({ error: 'Not Found', message: 'Warehouse video 073623.mp4 not found' });
        return;
      }

      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch (e) {
      next(e);
    }
  },
);

// GET /evidence/:id/video — Stream warehouse video for a specific claim/evidence
evidenceRouter.get(
  '/:id/video',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const candidatePaths = [
        path.resolve('.data', 'evidence', `${req.params.id}.mp4`),
        'D:\\Downloads\\073623.mp4\\073623.mp4',
        path.resolve('apps', 'web', 'public', 'cctv', '073623.mp4'),
        path.resolve('.data', 'evidence', '073623.mp4'),
      ];

      const videoPath = candidatePaths.find((p) => fs.existsSync(p));
      if (!videoPath) {
        res.status(404).json({ error: 'Not Found', message: 'Video not found' });
        return;
      }

      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        const file = fs.createReadStream(videoPath, { start, end });
        const head = {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          'Content-Length': fileSize,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        };
        res.writeHead(200, head);
        fs.createReadStream(videoPath).pipe(res);
      }
    } catch (e) {
      next(e);
    }
  },
);

// GET /evidence/:id/meta — Metadata for an evidence item (sha256, exists, kind)
evidenceRouter.get(
  '/:id/meta',
  authenticateToken,
  requireAnyPermission(['cctv.view', 'claim.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const item = await EvidenceItem.findOne({ evidence_id: req.params.id }).lean();
      if (!item) {
        res.status(404).json({ error: 'Not Found', message: `Evidence item ${req.params.id} not found` });
        return;
      }

      if (req.user?.role?.toUpperCase() === 'SUPPLIER') {
        const owns = await supplierOwnsEvidence(req.user, item.evidence_id);
        if (!owns) {
          res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot access evidence from other claims' });
          return;
        }
      }

      res.json({
        evidence_id: item.evidence_id,
        kind: item.kind,
        sha256: item.sha256,
        file_exists: fs.existsSync(item.path),
        created_at: item.created_at,
      });
    } catch (e) {
      next(e);
    }
  },
);

// GET /evidence/:id/verify — Recompute hash of evidence file and detect tampering
evidenceRouter.get(
  '/:id/verify',
  authenticateToken,
  requireAnyPermission(['cctv.view', 'claim.read.own']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const item = await EvidenceItem.findOne({ evidence_id: req.params.id }).lean();
      if (!item) {
        res.status(404).json({ error: 'Not Found', message: `Evidence item ${req.params.id} not found` });
        return;
      }

      if (req.user?.role?.toUpperCase() === 'SUPPLIER') {
        const owns = await supplierOwnsEvidence(req.user, item.evidence_id);
        if (!owns) {
          res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot access evidence from other claims' });
          return;
        }
      }

      if (!fs.existsSync(item.path)) {
        res.status(404).json({ error: 'Not Found', message: 'Evidence file not found on disk' });
        return;
      }

      const fileBuffer = fs.readFileSync(item.path);
      const actualSha = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      if (actualSha === item.sha256) {
        res.json({
          evidence_id: item.evidence_id,
          expected_sha256: item.sha256,
          actual_sha256: actualSha,
          status: 'VERIFIED',
          match: true,
        });
      } else {
        res.json({
          evidence_id: item.evidence_id,
          expected_sha256: item.sha256,
          actual_sha256: actualSha,
          status: 'TAMPER_DETECTED',
          match: false,
        });
      }
    } catch (e) {
      next(e);
    }
  },
);

// POST /evidence/:id/tamper — In DEMO_MODE only, corrupt an evidence file to verify tamper detection
evidenceRouter.post(
  '/:id/tamper',
  authenticateToken,
  requirePermission('cctv.view'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!config.DEMO_MODE) {
        res.status(403).json({ error: 'Forbidden', message: 'Tamper helper is only available in DEMO_MODE' });
        return;
      }

      const item = await EvidenceItem.findOne({ evidence_id: req.params.id }).lean();
      if (!item) {
        res.status(404).json({ error: 'Not Found', message: `Evidence item ${req.params.id} not found` });
        return;
      }

      if (!fs.existsSync(item.path)) {
        res.status(404).json({ error: 'Not Found', message: 'Evidence file not found on disk' });
        return;
      }

      // Corrupt file contents
      fs.writeFileSync(item.path, Buffer.from(`TAMPERED_DEMO_CORRUPT_PAYLOAD_${Date.now()}`));

      res.json({
        evidence_id: item.evidence_id,
        tampered: true,
        message: 'Evidence file corrupted successfully for demonstration',
      });
    } catch (e) {
      next(e);
    }
  },
);

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

// ---------------------------------------------------------------------------
// GET /disruptions/:id/playbook — Playbook memory closest cases (Step 11, A6)
// ---------------------------------------------------------------------------
disruptionsRouter.get(
  '/:id/playbook',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await getSimilarCases(id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /disruptions/:id/close — Close disruption and write historical case (Step 11, A6)
// ---------------------------------------------------------------------------
disruptionsRouter.post(
  '/:id/close',
  authenticateToken,
  requirePermission('close_disruption'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const { no_action, reason } = req.body || {};
      const result = await closeDisruptionAndSaveCase(id, req.user!._id, { no_action, reason });
      res.status(200).json(result);
    } catch (e: any) {
      if (e.statusCode) {
        res.status(e.statusCode).json({ error: { code: e.code || 'BAD_REQUEST', message: e.message } });
        return;
      }
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /disruptions/:id/fingerprints — Fingerprints for disruption (Step 11, A10)
// ---------------------------------------------------------------------------
disruptionsRouter.get(
  '/:id/fingerprints',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const result = await getDisruptionFingerprints(id);
      res.status(200).json(result);
    } catch (e) {
      next(e);
    }
  },
);


// ---------------------------------------------------------------------------
// GET /disruptions/:id/replay — Decision Replay (Step 10, A5)
// ---------------------------------------------------------------------------
disruptionsRouter.get(
  '/:id/replay',
  authenticateToken,
  requirePermission('view_intelligence'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      const upTo = req.query.upTo ? parseInt(req.query.upTo as string, 10) : undefined;

      const replay = await getDecisionReplay(id, upTo);
      res.status(200).json(replay);
    } catch (e: any) {
      if (e.message && e.message.includes('not found')) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
        return;
      }
      next(e);
    }
  },
);

