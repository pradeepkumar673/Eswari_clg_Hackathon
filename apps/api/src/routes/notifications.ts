/**
 * apps/api/src/routes/notifications.ts
 *
 * Notification feed and simulated outbox (Step 10, A1).
 *   GET   /notifications
 *   GET   /notifications/outbox
 *   PATCH /notifications/:id/read
 */

import { Router, Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Notification } from '../models/notifications.js';

export const notificationsRouter = Router();

function err(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// GET /notifications — for current user
// ---------------------------------------------------------------------------
notificationsRouter.get(
  '/',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const items = await Notification.find({
        user_id: user._id,
        channel: 'IN_APP',
      })
        .sort({ created_at: -1 })
        .limit(100)
        .lean();

      res.status(200).json({ notifications: items, unread_count: items.filter((i) => !i.read).length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /notifications/outbox — simulated outbox (EMAIL_SIM / WHATSAPP_SIM)
// ---------------------------------------------------------------------------
notificationsRouter.get(
  '/outbox',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const channel = req.query.channel as string | undefined;
      const query: any = {};
      if (channel) {
        query.channel = channel;
      } else {
        query.channel = { $in: ['EMAIL_SIM', 'WHATSAPP_SIM'] };
      }

      const outbox = await Notification.find(query)
        .populate('user_id', 'username display_name role')
        .sort({ created_at: -1 })
        .limit(100)
        .lean();

      res.status(200).json({ outbox, count: outbox.length });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------------------------------------------------------------------
// PATCH /notifications/:id/read — mark notification read
// ---------------------------------------------------------------------------
notificationsRouter.patch(
  '/:id/read',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params;
      if (!mongoose.Types.ObjectId.isValid(id)) {
        err(res, 400, 'BAD_ID', 'Invalid notification id'); return;
      }

      const notif = await Notification.findById(id);
      if (!notif) { err(res, 404, 'NOT_FOUND', 'Notification not found'); return; }

      notif.read = true;
      await notif.save();

      res.status(200).json({ ok: true, notification_id: notif._id, read: true });
    } catch (e) {
      next(e);
    }
  },
);

