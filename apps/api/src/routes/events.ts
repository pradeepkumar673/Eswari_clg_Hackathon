/**
 * apps/api/src/routes/events.ts
 *
 * Routes for shipment event conflict management:
 *  - GET  /events/conflicts           — list CONFLICT events (requirePermission: confirm_events)
 *  - POST /events/conflicts/:id/resolve — resolve a conflict (requirePermission: confirm_events)
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { Shipment } from '../models/shipments.js';
import { writeAudit } from '../services/audit.js';
import { domainBus } from '../services/bus.js';
import { withTransaction } from '../db/withTransaction.js';

export const eventsRouter = Router();

/**
 * GET /events/conflicts
 * Returns all shipment events with reconcile_status = 'CONFLICT'.
 */
eventsRouter.get(
  '/conflicts',
  authenticateToken,
  requirePermission('confirm_events'),
  async (req: Request, res: Response): Promise<void> => {
    const conflicts = await ShipmentEvent.find({ reconcile_status: 'CONFLICT' })
      .populate('shipment_id', 'code status resolved_eta review_status')
      .sort({ ingested_at: -1 })
      .lean();

    res.status(200).json({ conflicts });
  },
);

/**
 * POST /events/conflicts/:id/resolve
 * Body: { chosen_event_id: string, reason: string }
 * Resolves a conflict by applying the chosen event's ETA to the shipment.
 */
eventsRouter.post(
  '/conflicts/:id/resolve',
  authenticateToken,
  requirePermission('confirm_events'),
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const { chosen_event_id, reason } = req.body as {
      chosen_event_id?: string;
      reason?: string;
    };

    if (!chosen_event_id || !reason || reason.trim().length === 0) {
      res.status(400).json({ error: 'Bad Request', message: 'chosen_event_id and reason are required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(chosen_event_id)) {
      res.status(400).json({ error: 'Bad Request', message: 'Invalid id or chosen_event_id' });
      return;
    }

    const result = await withTransaction(async (session) => {
      const conflictEvent = await ShipmentEvent.findOne(
        { _id: id, reconcile_status: 'CONFLICT' },
        null,
        { session },
      );
      if (!conflictEvent) {
        return { notFound: true };
      }

      const chosenEvent = await ShipmentEvent.findOne(
        { _id: chosen_event_id },
        null,
        { session },
      );
      if (!chosenEvent) {
        return { chosenNotFound: true };
      }

      const shipment = await Shipment.findOne(
        { _id: conflictEvent.shipment_id },
        null,
        { session },
      );
      if (!shipment) {
        return { shipmentNotFound: true };
      }

      const oldEta = shipment.resolved_eta;

      // Apply the chosen event's ETA
      await Shipment.updateOne(
        { _id: shipment._id },
        {
          $set: {
            resolved_eta: chosenEvent.reported_eta,
            eta_basis_event_id: chosenEvent._id,
            review_status: 'NORMAL',
          },
        },
        { session },
      );

      // Mark the conflict event as APPLIED
      await ShipmentEvent.updateOne(
        { _id: conflictEvent._id },
        { $set: { reconcile_status: 'APPLIED', reconcile_reason: `Manually resolved: ${reason}` } },
        { session },
      );

      await writeAudit(
        {
          actor: req.user!._id,
          action: 'CONFLICT_RESOLVED',
          entityType: 'SHIPMENT',
          entityId: shipment._id.toString(),
          before: { resolved_eta: oldEta, review_status: shipment.review_status },
          after: { resolved_eta: chosenEvent.reported_eta, review_status: 'NORMAL', chosen_event_id, reason },
          correlationId: `conflict-resolve-${id}`,
          stepType: 'ETA_APPLIED',
        },
        session,
      );

      return { shipment, chosenEvent, oldEta };
    });

    if (!result || 'notFound' in result) {
      res.status(404).json({ error: 'Not Found', message: 'Conflict event not found' });
      return;
    }
    if ('chosenNotFound' in result) {
      res.status(404).json({ error: 'Not Found', message: 'Chosen event not found' });
      return;
    }
    if ('shipmentNotFound' in result) {
      res.status(404).json({ error: 'Not Found', message: 'Associated shipment not found' });
      return;
    }

    const { shipment, chosenEvent } = result as {
      shipment: InstanceType<typeof Shipment>;
      chosenEvent: InstanceType<typeof ShipmentEvent>;
      oldEta: Date | null;
    };

    // Publish event outside transaction
    await domainBus.publish('EVENT_APPLIED', {
      eventId: chosenEvent._id.toString(),
      shipmentId: shipment._id.toString(),
      shipmentCode: shipment.code,
      eventType: chosenEvent.event_type,
      source: chosenEvent.source,
      correlationId: `conflict-resolve-${id}`,
    });

    res.status(200).json({
      status: 'RESOLVED',
      shipment_code: shipment.code,
      resolved_eta: chosenEvent.reported_eta,
      review_status: 'NORMAL',
    });
  },
);
