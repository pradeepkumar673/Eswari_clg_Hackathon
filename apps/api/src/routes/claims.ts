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
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { SupplierClaim } from '../models/supplier-claims.js';
import { CctvEvent } from '../models/cctv-events.js';

export const claimsRouter = Router();

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
      res.json(claims);
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
