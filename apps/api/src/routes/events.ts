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
import { Warehouse } from '../models/warehouses.js';
import { FieldReport } from '../models/field-reports.js';
import { writeAudit } from '../services/audit.js';
import { domainBus } from '../services/bus.js';
import { withTransaction } from '../db/withTransaction.js';
import { reconcile, IncomingEvent } from '../services/reconciler.js';
import { simClock } from '../services/simClock.js';

export const eventsRouter = Router();

/**
 * POST /events
 * Human confirmation of an event card (possibly edited).
 * Passes event to reconciler with source FIELD_REPORT or EMAIL_TEXT.
 * Enforces warehouse operator scoping (Operator cannot confirm for another warehouse -> 403).
 */
eventsRouter.post(
  '/',
  authenticateToken,
  requirePermission('confirm_events'),
  async (req: Request, res: Response): Promise<void> => {
    const {
      field_report_id,
      shipment_code,
      warehouse_code,
      event_type = 'DAMAGE_REPORT',
      damaged_units,
      delay_hours,
      reported_eta,
    } = req.body as {
      field_report_id?: string;
      shipment_code?: string;
      warehouse_code?: string;
      event_type?: string;
      damaged_units?: number | null;
      delay_hours?: number | null;
      reported_eta?: string;
    };

    if (!shipment_code) {
      res.status(400).json({ error: 'Bad Request', message: 'shipment_code is required' });
      return;
    }

    const shipment = await Shipment.findOne({ code: shipment_code });

    // Warehouse scoping check for Warehouse_Operator
    if (req.user?.role === 'Warehouse_Operator') {
      let targetWhId = shipment?.warehouse_id;
      if (!targetWhId && warehouse_code) {
        const wh = await Warehouse.findOne({ code: warehouse_code }).lean();
        if (wh) targetWhId = wh._id;
      }
      if (targetWhId && String(req.user.warehouse_id) !== String(targetWhId)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Warehouse Operator cannot confirm events for another warehouse',
        });
        return;
      }
    }

    let fieldReport: any = null;
    if (field_report_id && mongoose.Types.ObjectId.isValid(field_report_id)) {
      fieldReport = await FieldReport.findById(field_report_id);
    }

    const source = fieldReport?.channel === 'VOICE' ? 'FIELD_REPORT' : 'EMAIL_TEXT';
    const extId = field_report_id ? `FR-${field_report_id}` : `EVT-CONFIRM-${Date.now()}`;
    const now = await simClock.now();

    // Compute reported ETA
    let finalEta: Date | undefined;
    if (reported_eta) {
      finalEta = new Date(reported_eta);
    } else if (delay_hours && delay_hours > 0 && shipment) {
      const baseEta = shipment.resolved_eta || shipment.current_eta;
      finalEta = new Date(baseEta.getTime() + delay_hours * 3_600_000);
    }

    // If damage reported, adjust shipment usable_quantity and mark disrupted
    if (shipment && damaged_units && damaged_units > 0) {
      const usable = Math.max(0, shipment.total_units - damaged_units);
      await Shipment.updateOne(
        { _id: shipment._id },
        {
          $set: {
            usable_quantity: usable,
            is_disrupted: true,
          },
        },
      );
    }

    const incoming: IncomingEvent = {
      source,
      external_event_id: extId,
      event_type,
      shipment_code,
      reported_eta: finalEta,
      event_time: now,
      quantity_affected: damaged_units ?? undefined,
      raw_payload: req.body as Record<string, unknown>,
      correlation_id: `confirm-${extId}`,
    };

    const reconcileResult = await withTransaction((session) => reconcile(incoming, session));

    if (fieldReport) {
      fieldReport.status = 'CONFIRMED';
      if (reconcileResult.eventId) {
        fieldReport.event_id = new mongoose.Types.ObjectId(reconcileResult.eventId);
      }
      if (shipment) {
        fieldReport.shipment_id = shipment._id;
      }
      await fieldReport.save();
    }

    res.status(200).json({
      status: reconcileResult.status,
      eventId: reconcileResult.eventId,
      reason: reconcileResult.reason,
      shipment_code,
      reconcile: reconcileResult,
    });
  },
);

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
