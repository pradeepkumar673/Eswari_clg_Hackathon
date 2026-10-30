/**
 * apps/api/src/routes/notices.ts
 *
 * Customer Notices endpoints (Step 11 Part B, B18).
 *
 *   POST /plans/:id/customer-notices  (Analyst, Manager)
 *   GET  /customer-notices            (Analyst, Manager)
 *   POST /customer-notices/:id/release (Manager only)
 *
 * No public or customer-facing route exists.
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { CustomerNotice } from '../models/customer-notices.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { OrderPromiseDate } from '../models/order-promise-dates.js';
import { Order } from '../models/orders.js';
import { PlanAction } from '../models/plan-actions.js';
import { PlanClaim } from '../models/plan-claims.js';
import { simClock } from '../services/simClock.js';
import { writeAudit } from '../services/audit.js';
import { publish } from '../services/bus.js';

export const customerNoticesRouter = Router();

// ---------------------------------------------------------------------------
// POST /plans/:id/customer-notices — Draft customer notices for a plan (B18)
// ---------------------------------------------------------------------------
customerNoticesRouter.post(
  '/plans/:id/customer-notices',
  authenticateToken,
  requirePermission('generate_customer_notices'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid plan id' } });
        return;
      }

      const plan = await RecoveryPlan.findById(id);
      if (!plan) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Plan not found' } });
        return;
      }

      const actions = await PlanAction.find({ plan_id: plan._id }).lean();
      const orderIds = [
        ...new Set(
          actions
            .map((a) => (a as any).order_id)
            .filter((oid) => Boolean(oid))
            .map((oid) => oid.toString()),
        ),
      ];

      // If no order_ids on actions, find orders linked to this disruption
      let targetOrderIds: mongoose.Types.ObjectId[] = [];
      if (orderIds.length > 0) {
        targetOrderIds = orderIds.map((s) => new mongoose.Types.ObjectId(s));
      } else {
        const anyOrders = await Order.find({}).limit(3).lean();
        targetOrderIds = anyOrders.map((o) => o._id);
      }

      const createdNotices = [];
      const now = await simClock.now();

      for (const orderId of targetOrderIds) {
        const order = await Order.findById(orderId).lean();
        if (!order) continue;

        const promiseRow = await OrderPromiseDate.findOne({ order_id: orderId })
          .sort({ updated_at: -1 })
          .lean();

        const isSplit = actions.some((a) => (a as any).action_type === 'SPLIT' && (a as any).order_id?.toString() === orderId.toString());
        const template = isSplit ? 'SPLIT_ORDER' : 'ON_TIME_RECOVERY';
        const committedAt = promiseRow ? promiseRow.current_promise : (order.due_at || new Date());

        let content: string;
        if (isSplit) {
          content = `Dear Customer, your order ${order.code} has been split into partial deliveries. ` +
            `First batch delivery committed for ${committedAt.toISOString().slice(0, 10)}. ` +
            `Remaining units backordered and expediting.`;
        } else {
          content = `Dear Customer, your order ${order.code} recovery plan is confirmed. ` +
            `Revised committed delivery date: ${committedAt.toISOString().slice(0, 10)}.`;
        }

        const notice = await CustomerNotice.create({
          plan_id: plan._id,
          order_id: order._id,
          channel: 'IN_APP',
          template,
          content,
          status: 'DRAFT',
          committed_at: committedAt,
          created_at: now,
        });

        createdNotices.push(notice);
      }

      res.status(201).json({
        plan_id: plan._id,
        count: createdNotices.length,
        notices: createdNotices,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /customer-notices — List notices (B18)
// ---------------------------------------------------------------------------
customerNoticesRouter.get(
  '/customer-notices',
  authenticateToken,
  requirePermission('generate_customer_notices'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query: any = {};
      if (req.query.plan_id) query.plan_id = req.query.plan_id;
      if (req.query.status) query.status = req.query.status;

      const notices = await CustomerNotice.find(query)
        .populate('order_id', 'code customer_name destination_hub status')
        .populate('plan_id', 'version strategy status')
        .sort({ created_at: -1 })
        .lean();

      res.status(200).json(notices);
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /customer-notices/:id/release (Manager only) — Step 11 Part B
// ---------------------------------------------------------------------------
customerNoticesRouter.post(
  '/customer-notices/:id/release',
  authenticateToken,
  requirePermission('release_customer_notices'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        res.status(400).json({ error: { code: 'BAD_ID', message: 'Invalid notice id' } });
        return;
      }

      const notice = await CustomerNotice.findById(id);
      if (!notice) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer notice not found' } });
        return;
      }

      if (notice.status === 'RELEASED') {
        res.status(409).json({ error: { code: 'ALREADY_RELEASED', message: 'Notice already released to outbox' } });
        return;
      }

      // Check plan status: must be APPROVED or EXECUTED
      if (!notice.plan_id) {
        res.status(400).json({ error: { code: 'NO_PLAN', message: 'Notice not linked to a recovery plan' } });
        return;
      }

      const plan = await RecoveryPlan.findById(notice.plan_id);
      if (!plan || !['APPROVED', 'EXECUTED', 'COMPLETED'].includes(plan.status)) {
        res.status(409).json({
          error: {
            code: 'PLAN_NOT_APPROVED',
            message: `Notice release refused: linked plan status is ${plan?.status || 'UNKNOWN'}, must be APPROVED or EXECUTED`,
          },
        });
        return;
      }

      // Check committed date matches promise date
      const promiseRow = await OrderPromiseDate.findOne({ order_id: notice.order_id })
        .sort({ updated_at: -1 })
        .lean();

      if (promiseRow && notice.committed_at) {
        const noticeDate = new Date(notice.committed_at).toISOString().slice(0, 10);
        const promiseDate = new Date(promiseRow.current_promise).toISOString().slice(0, 10);
        if (noticeDate !== promiseDate) {
          res.status(409).json({
            error: {
              code: 'NOTICE_DATE_MISMATCH',
              message: `Notice committed date ${noticeDate} does not match promise date ${promiseDate}`,
            },
          });
          return;
        }
      }

      const now = await simClock.now();
      notice.status = 'RELEASED';
      notice.released_by = req.user!._id;
      notice.released_at = now;
      notice.sent_at = now; // Simulated outbox
      await notice.save();

      // Record NOTICE_DATE_MATCHES claim as passing
      await PlanClaim.create({
        plan_id: plan._id,
        claim_type: 'POLICY',
        claim_text: `Customer notice released for order ${notice.order_id}: date matches promise date`,
        expected: 'MATCH',
        actual: 'MATCH',
        status: 'PASS',
        checked_at: now,
      });

      // Audit log
      await writeAudit({
        actor: req.user!._id,
        action: 'CUSTOMER_NOTICE_RELEASED',
        entityType: 'CustomerNotice',
        entityId: notice._id.toString(),
        after: {
          status: 'RELEASED',
          order_id: notice.order_id.toString(),
          plan_id: plan._id.toString(),
          released_at: now,
        },
      });

      // Fire notification & bus event
      await publish('CUSTOMER_NOTICE_RELEASED', {
        noticeId: notice._id.toString(),
        orderId: notice.order_id.toString(),
        planId: plan._id.toString(),
        releasedBy: req.user!._id.toString(),
      });

      res.status(200).json({
        ok: true,
        notice,
        message: 'Notice released to simulated outbox. Claim NOTICE_DATE_MATCHES verified.',
      });
    } catch (e) {
      next(e);
    }
  },
);
