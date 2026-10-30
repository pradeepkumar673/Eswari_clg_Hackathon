/**
 * apps/api/src/routes/claims.ts
 *
 * Supplier claims routes.
 * Enforces supplier-scoping:
 * - SUPPLIER: read-only on own claims, can add text response. 403 on other suppliers' claims.
 * - Procurement / Manager / Admin: full claim adjudication (claim.decide).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { SupplierClaim } from '../models/supplier-claims.js';

export const claimsRouter = Router();

// GET /claims
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

      const claims = await SupplierClaim.find(filter).sort({ created_at: -1 }).lean();
      res.json(claims);
    } catch (e) {
      next(e);
    }
  },
);

// GET /claims/:claimId
claimsRouter.get(
  '/:claimId',
  authenticateToken,
  requireAnyPermission(['claim.read.own', 'claim.decide']),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claim = await SupplierClaim.findOne({ claim_id: req.params.claimId }).lean();
      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: 'Claim not found' });
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

// POST /claims/:claimId/respond
claimsRouter.post(
  '/:claimId/respond',
  authenticateToken,
  requirePermission('claim.respond'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const claim = await SupplierClaim.findOne({ claim_id: req.params.claimId });
      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: 'Claim not found' });
        return;
      }

      if (user.role.toUpperCase() === 'SUPPLIER' && claim.supplier_id !== user.supplier_id) {
        res.status(403).json({ error: 'Forbidden', message: 'Supplier cannot respond to another supplier claim' });
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

// POST /claims/:claimId/decide
claimsRouter.post(
  '/:claimId/decide',
  authenticateToken,
  requirePermission('claim.decide'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { status } = req.body;
      const claim = await SupplierClaim.findOne({ claim_id: req.params.claimId });
      if (!claim) {
        res.status(404).json({ error: 'Not Found', message: 'Claim not found' });
        return;
      }

      claim.status = status;
      claim.decided_by = req.user!.username;
      claim.version += 1;
      await claim.save();

      res.json(claim);
    } catch (e) {
      next(e);
    }
  },
);

