/**
 * apps/api/src/routes/overview.ts
 *
 * Recovery progress and cockpit overview data (Step 9 Part A #5).
 * GET /overview
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Disruption } from '../models/disruptions.js';
import { RecoveryPlan } from '../models/recovery-plans.js';
import { Order } from '../models/orders.js';

export const overviewRouter = Router();

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------
overviewRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const disruptions = await Disruption.find({}).sort({ detected_at: -1 }).lean();

      const progress = await Promise.all(
        disruptions.map(async (d) => {
          const plans = await RecoveryPlan.find({ disruption_id: d._id }).lean();
          const approvedCount = plans.filter((p) => p.status === 'APPROVED').length;
          const executedCount = plans.filter((p) => p.status === 'EXECUTED').length;
          const rolledBackCount = plans.filter((p) => p.status === 'ROLLED_BACK').length;

          // Orders recovered under executed plans
          const executedPlanIds = plans.filter((p) => p.status === 'EXECUTED').map((p) => p._id);
          const recoveredOrders = await Order.countDocuments({
            recovery_plan_id: { $in: executedPlanIds },
            status: { $in: ['FULFILLED', 'RECOVERING'] },
          });

          return {
            disruption_id: d._id,
            disruption_type: d.disruption_type,
            severity: d.severity,
            status: d.status,
            total_plans: plans.length,
            approved_count: approvedCount,
            executed_count: executedCount,
            rolled_back_count: rolledBackCount,
            orders_recovered: recoveredOrders,
          };
        }),
      );

      res.status(200).json({
        total_disruptions: disruptions.length,
        disruptions: progress,
      });
    } catch (e) {
      next(e);
    }
  },
);

