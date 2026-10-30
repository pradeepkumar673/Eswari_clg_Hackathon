/**
 * apps/api/src/routes/claims.ts
 *
 * Supplier claims adjudication and supplier responses.
 *
 * RBAC & Scoping:
 * - SUPPLIER: read-only on own claims (claim.read.own), can respond to own claim (claim.respond). 403 on other suppliers' claims.
 * - Warehouse Operator: sees none (403 on /claims).
 * - Procurement Approver: sees all claims, adjudicates (claim.decide).
 * - Separation of duties: The operator who linked the CCTV event cannot accept the resulting claim (403).
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { SupplierClaim } from '../models/supplier-claims.js';
import { CctvEvent } from '../models/cctv-events.js';
import { Supplier } from '../models/suppliers.js';
import { Shipment } from '../models/shipments.js';

export const claimsRouter = Router();

async function enrichClaims(claims: any[]): Promise<any[]> {
  if (!claims.length) return [];

  const supplierKeys = Array.from(new Set(claims.map((c) => c.supplier_id).filter(Boolean)));
  const shipmentKeys = Array.from(new Set(claims.map((c) => c.shipment_id).filter(Boolean)));

  const supObjectIds = supplierKeys.filter((k) => mongoose.Types.ObjectId.isValid(k));
  const supCodes = supplierKeys.filter((k) => !mongoose.Types.ObjectId.isValid(k));

  const suppliers = await Supplier.find({
    $or: [
      ...(supObjectIds.length ? [{ _id: { $in: supObjectIds } }] : []),
      ...(supCodes.length ? [{ code: { $in: supCodes } }] : []),
    ],
  }).lean();

  const supplierMap = new Map<string, { name: string; code: string }>();
  for (const s of suppliers) {
    supplierMap.set(s._id.toString(), { name: s.name, code: s.code });
    supplierMap.set(s.code, { name: s.name, code: s.code });
  }

  const shpObjectIds = shipmentKeys.filter((k) => mongoose.Types.ObjectId.isValid(k));
  const shpCodes = shipmentKeys.filter((k) => !mongoose.Types.ObjectId.isValid(k));

  const shipments = await Shipment.find({
    $or: [
      ...(shpObjectIds.length ? [{ _id: { $in: shpObjectIds } }] : []),
      ...(shpCodes.length ? [{ code: { $in: shpCodes } }] : []),
    ],
  }).lean();

  const shipmentMap = new Map<string, string>();
  for (const sh of shipments) {
    shipmentMap.set(sh._id.toString(), sh.code);
    shipmentMap.set(sh.code, sh.code);
  }

  return claims.map((c) => {
    const supInfo = c.supplier_id ? supplierMap.get(c.supplier_id.toString()) : null;
    const shpCode = c.shipment_id ? shipmentMap.get(c.shipment_id.toString()) : null;
    return {
      ...c,
      supplier_name: supInfo ? `${supInfo.name} (${supInfo.code})` : c.supplier_id,
      supplier_code: supInfo ? supInfo.code : c.supplier_id,
      shipment_code: shpCode || c.shipment_id,
    };
  });
}

// ---------------------------------------------------------------------------
// GET /claims — List claims (Supplier sees only own, Operator sees none, Approver sees all)
// ---------------------------------------------------------------------------
claimsRouter.get(
  '/',
  authenticateToken,
  requireAnyPermission(['claim.read.own', 'claim.decide']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const filter: Record<string, any> = {};

      if (user.role.toUpperCase() === 'SUPPLIER') {
        const querySup = req.query.supplier_id as string | undefined;
        if (querySup && user.supplier_id && querySup !== user.supplier_id) {
          res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot read another supplier claims' });
          return;
        }
        filter.supplier_id = user.supplier_id;
      } else if (req.query.supplier_id) {
        filter.supplier_id = req.query.supplier_id;
      }

      if (req.query.status) {
        filter.status = req.query.status;
      }

      const claims = await SupplierClaim.find(filter).sort({ created_at: -1 }).lean();
      const enriched = await enrichClaims(claims);
      res.json(enriched);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /claims/:id — Get claim by ID (Supplier-scoped)
// ---------------------------------------------------------------------------
claimsRouter.get(
  '/:id',
  authenticateToken,
  requireAnyPermission(['claim.read.own', 'claim.decide']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claimId = req.params.id;

      const claim = await SupplierClaim.findOne({
        $or: [{ claim_id: claimId }, { _id: claimId.match(/^[0-9a-fA-F]{24}$/) ? claimId : null }],
      }).lean();

      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: `Claim ${claimId} not found` });
        return;
      }

      if (user.role.toUpperCase() === 'SUPPLIER' && claim.supplier_id !== user.supplier_id) {
        res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot read another supplier claim' });
        return;
      }

      const [enriched] = await enrichClaims([claim]);
      res.json(enriched);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /claims/:id/decide — Procurement Approver decides (ACCEPT, PARTIAL, REJECT)
// ---------------------------------------------------------------------------
claimsRouter.post(
  '/:id/decide',
  authenticateToken,
  requirePermission('claim.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claimId = req.params.id;
      const { decision, notes } = req.body || {};

      if (!decision || !['ACCEPT', 'PARTIAL', 'REJECT'].includes(decision)) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Decision must be ACCEPT, PARTIAL, or REJECT',
        });
        return;
      }

      if (!notes || typeof notes !== 'string' || notes.trim().length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Mandatory decision note is required',
        });
        return;
      }

      const claim = await SupplierClaim.findOne({
        $or: [{ claim_id: claimId }, { _id: claimId.match(/^[0-9a-fA-F]{24}$/) ? claimId : null }],
      });

      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: `Claim ${claimId} not found` });
        return;
      }

      const currentUserId = user._id?.toString();
      const currentUsername = user.username;

      // Separation of duties check:
      if (claim.linked_by && (claim.linked_by === currentUserId || claim.linked_by === currentUsername)) {
        res.status(403).json({
          error: 'Forbidden',
          code: 'SEPARATION_OF_DUTIES_VIOLATION',
          message: 'Cannot approve a claim you created.',
        });
        return;
      }

      if (claim.cctv_event_id) {
        const cctvEvt = await CctvEvent.findOne({ event_id: claim.cctv_event_id }).lean();
        if (
          cctvEvt &&
          cctvEvt.linked_by &&
          (cctvEvt.linked_by === currentUserId || cctvEvt.linked_by === currentUsername)
        ) {
          res.status(403).json({
            error: 'Forbidden',
            code: 'SEPARATION_OF_DUTIES_VIOLATION',
            message: 'Cannot approve a claim you created.',
          });
          return;
        }
      }

      if (decision === 'ACCEPT') {
        claim.status = 'ACCEPTED';
        claim.rejection_reason = null;
      } else if (decision === 'PARTIAL') {
        claim.status = 'ACCEPTED';
        claim.rejection_reason = `PARTIAL: ${notes.trim()}`;
      } else {
        claim.status = 'REJECTED';
        claim.rejection_reason = notes.trim();
      }

      claim.decided_by = user.username || user._id.toString();
      claim.version += 1;
      await claim.save();

      res.json(claim);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /claims/:id/accept — Procurement Approver accepts claim (Separation of duties enforced)
// ---------------------------------------------------------------------------
claimsRouter.post(
  '/:id/accept',
  authenticateToken,
  requirePermission('claim.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claimId = req.params.id;

      const claim = await SupplierClaim.findOne({
        $or: [{ claim_id: claimId }, { _id: claimId.match(/^[0-9a-fA-F]{24}$/) ? claimId : null }],
      });

      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: `Claim ${claimId} not found` });
        return;
      }

      const currentUserId = user._id?.toString();
      const currentUsername = user.username;

      // Separation of duties check:
      // The operator who linked the CCTV event cannot accept the resulting claim
      if (claim.linked_by && (claim.linked_by === currentUserId || claim.linked_by === currentUsername)) {
        res.status(403).json({
          error: 'Forbidden',
          code: 'SEPARATION_OF_DUTIES_VIOLATION',
          message: 'Operator who linked the CCTV event cannot accept the resulting claim',
        });
        return;
      }

      if (claim.cctv_event_id) {
        const cctvEvt = await CctvEvent.findOne({ event_id: claim.cctv_event_id }).lean();
        if (cctvEvt && cctvEvt.linked_by && (cctvEvt.linked_by === currentUserId || cctvEvt.linked_by === currentUsername)) {
          res.status(403).json({
            error: 'Forbidden',
            code: 'SEPARATION_OF_DUTIES_VIOLATION',
            message: 'Operator who linked the CCTV event cannot accept the resulting claim',
          });
          return;
        }
      }

      claim.status = 'ACCEPTED';
      claim.decided_by = user.username || user._id.toString();
      claim.version += 1;
      await claim.save();

      res.json(claim);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /claims/:id/reject — Moves claim to REJECTED with mandatory reason
// ---------------------------------------------------------------------------
claimsRouter.post(
  '/:id/reject',
  authenticateToken,
  requirePermission('claim.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claimId = req.params.id;
      const { reason } = req.body || {};

      if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
        res.status(400).json({ error: 'Bad Request', message: 'Rejection reason is required' });
        return;
      }

      const claim = await SupplierClaim.findOne({
        $or: [{ claim_id: claimId }, { _id: claimId.match(/^[0-9a-fA-F]{24}$/) ? claimId : null }],
      });

      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: `Claim ${claimId} not found` });
        return;
      }

      claim.status = 'REJECTED';
      claim.rejection_reason = reason.trim();
      claim.decided_by = user.username || user._id.toString();
      claim.version += 1;
      await claim.save();

      res.json(claim);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /claims/:id/respond — Supplier adds text response to own claim
// ---------------------------------------------------------------------------
claimsRouter.post(
  '/:id/respond',
  authenticateToken,
  requirePermission('claim.respond'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claimId = req.params.id;

      const claim = await SupplierClaim.findOne({
        $or: [{ claim_id: claimId }, { _id: claimId.match(/^[0-9a-fA-F]{24}$/) ? claimId : null }],
      });

      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: `Claim ${claimId} not found` });
        return;
      }

      if (user.role.toUpperCase() === 'SUPPLIER' && claim.supplier_id !== user.supplier_id) {
        res.status(403).json({
          error: 'Forbidden',
          code: 'SUPPLIER_ISOLATION',
          message: 'Supplier cannot respond to another supplier claim',
        });
        return;
      }

      claim.supplier_response = req.body.response || req.body.text || '';
      claim.status = 'RESPONDED';
      claim.version += 1;
      await claim.save();

      res.json(claim);
    } catch (e) {
      next(e);
    }
  },
);
