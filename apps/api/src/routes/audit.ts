/**
 * apps/api/src/routes/audit.ts
 *
 * Audit routes:
 *  - GET /audit/verify: Verify SHA-256 hash chains for audit_logs and execution_ledger
 *  - GET /audit: Filtered query over audit logs
 *  - POST /admin/demo/tamper: Mutate an audit row directly to test tamper detection (DEMO_MODE only)
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { AuditLog } from '../models/audit-logs.js';
import { ExecutionLedger } from '../models/execution-ledger.js';
import { verifyChain } from '../services/audit.js';

export const auditRouter = Router();

/**
 * Verify cryptographic hash chain for both audit_logs and execution_ledger.
 */
auditRouter.get(
  '/verify',
  authenticateToken,
  requirePermission('verify_audit_chain'),
  async (_req: Request, res: Response): Promise<void> => {
    const auditRes = await verifyChain('audit_logs');
    const ledgerRes = await verifyChain('execution_ledger');

    const ok = auditRes.ok && ledgerRes.ok;
    res.json({
      ok,
      audit_logs: auditRes,
      execution_ledger: ledgerRes,
    });
  },
);

/**
 * Query audit trail with filters and pagination.
 */
auditRouter.get(
  '/',
  authenticateToken,
  requirePermission('read_audit'),
  async (req: Request, res: Response): Promise<void> => {
    const {
      actor,
      action,
      entity_type,
      correlation_id,
      from,
      to,
      page = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (actor) {
      if (mongoose.Types.ObjectId.isValid(actor)) {
        filter.actor = new mongoose.Types.ObjectId(actor);
      }
    }
    if (action) filter.action = action;
    if (entity_type) filter.entity_type = entity_type;
    if (correlation_id) filter.correlation_id = correlation_id;

    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.$gte = new Date(from);
      if (to) dateFilter.$lte = new Date(to);
      filter.created_at = dateFilter;
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ seq: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    res.json({
      data,
      total,
      page: pageNum,
      limit: limitNum,
    });
  },
);

export const adminTamperRouter = Router();

/**
 * Admin Tamper endpoint: directly modifies one audit row outside normal hashing.
 * Restricted to Administrator when DEMO_MODE is true.
 */
adminTamperRouter.post(
  '/demo/tamper',
  authenticateToken,
  requirePermission('manage_users_redteam'),
  async (req: Request, res: Response): Promise<void> => {
    if (!config.DEMO_MODE) {
      res.status(403).json({ error: 'Forbidden', message: 'Demo mode is not enabled' });
      return;
    }

    const { row_id, new_action = 'TAMPERED_ACTION', target = 'audit' } = req.body || {};

    if (target === 'ledger' || target === 'execution_ledger') {
      let targetRow;
      if (row_id) {
        targetRow = await ExecutionLedger.findById(row_id);
      } else {
        targetRow = await ExecutionLedger.findOne({}).sort({ seq: -1 });
      }

      if (!targetRow) {
        res.status(404).json({ error: 'Not Found', message: 'No ledger row available to tamper' });
        return;
      }

      const originalType = targetRow.step_type;
      await ExecutionLedger.collection.updateOne(
        { _id: targetRow._id },
        { $set: { step_type: 'TAMPERED_STEP' } },
      );

      res.json({
        ok: true,
        target: 'execution_ledger',
        tampered_row_id: targetRow._id.toString(),
        seq: targetRow.seq,
        original_step_type: originalType,
        new_step_type: 'TAMPERED_STEP',
      });
      return;
    }

    let targetRow;
    if (row_id) {
      targetRow = await AuditLog.findById(row_id);
    } else {
      // Tamper the latest row
      targetRow = await AuditLog.findOne({}).sort({ seq: -1 });
    }

    if (!targetRow) {
      res.status(404).json({ error: 'Not Found', message: 'No audit row available to tamper' });
      return;
    }

    const originalAction = targetRow.action;

    // Use direct native collection update without recalculating row_hash
    await AuditLog.collection.updateOne(
      { _id: targetRow._id },
      { $set: { action: new_action } },
    );

    res.json({
      ok: true,
      tampered_row_id: targetRow._id.toString(),
      seq: targetRow.seq,
      original_action: originalAction,
      new_action,
    });
  },
);

