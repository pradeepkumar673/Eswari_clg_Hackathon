/**
 * apps/api/src/services/reconciler.ts
 *
 * Belief-ETA Reconciler: evaluates incoming shipment events against current state.
 *
 * Decision order:
 *  a. Unknown shipment → REJECTED
 *  b. Same (source, external_event_id) → DUPLICATE (catch dup key error 11000)
 *  c. event_time older than basis event from equal/higher trust → STALE
 *  d. Two trusted sources differ by > tolerance → CONFLICT
 *  e. Sources agree within tolerance → APPLIED (higher-trust value wins)
 *  f. Newer trusted event → APPLIED, update resolved_eta + eta_basis_event_id
 */

import mongoose, { ClientSession } from 'mongoose';
import { Shipment } from '../models/shipments.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { SourceTrust } from '../models/source-trust.js';
import { writeAudit } from './audit.js';
import { domainBus } from './bus.js';
import { simClock } from './simClock.js';
import { withTransaction } from '../db/withTransaction.js';

export interface IncomingEvent {
  source: string;            // CARRIER_API | FIELD_REPORT | SUPPLIER_PORTAL | CSV | EMAIL_TEXT
  external_event_id: string; // unique id from the source
  event_type: string;        // ETA_UPDATE | DAMAGE_REPORT | DELAY_REPORT | INVENTORY_CORRECTION
  shipment_code: string;     // e.g. SHP-310
  reported_eta?: Date;       // for ETA_UPDATE / DELAY_REPORT
  event_time?: Date;         // when the event happened at source
  quantity_affected?: number;// for DAMAGE_REPORT
  raw_payload: Record<string, unknown>;
  correlation_id: string;
}

export interface ReconcileResult {
  status: 'APPLIED' | 'DUPLICATE' | 'STALE' | 'CONFLICT' | 'REJECTED';
  eventId?: string;
  reason: string;
  shipment_code: string;
}

const MINUTES = 60_000;

/**
 * Main reconcile function. If session is provided, runs inside caller's transaction.
 * Otherwise wraps in its own transaction.
 */
export async function reconcile(
  event: IncomingEvent,
  session?: ClientSession,
): Promise<ReconcileResult> {
  if (!session) {
    return withTransaction((s) => reconcileInTx(event, s));
  }
  return reconcileInTx(event, session);
}

async function reconcileInTx(
  event: IncomingEvent,
  session: ClientSession,
): Promise<ReconcileResult> {
  const now = await simClock.now();

  // --- a. Look up shipment ---
  const shipment = await Shipment.findOne(
    { code: event.shipment_code },
    null,
    { session },
  );
  if (!shipment) {
    await writeAudit(
      {
        action: 'WEBHOOK_RECEIVED',
        entityType: 'SHIPMENT_EVENT',
        entityId: event.shipment_code,
        before: null,
        after: { reason: 'Unknown shipment', event },
        correlationId: event.correlation_id,
        stepType: 'WEBHOOK_RECEIVED',
      },
      session,
    );
    return { status: 'REJECTED', reason: `Unknown shipment: ${event.shipment_code}`, shipment_code: event.shipment_code };
  }

  // Load source trust for incoming source
  const sourceTrustDoc = await SourceTrust.findOne({ source: event.source }, null, { session });
  const incomingTrust = sourceTrustDoc?.trust_level ?? 1;
  const toleranceMs = (sourceTrustDoc?.tolerance_minutes ?? 240) * MINUTES;

  // --- b. DUPLICATE detection ---
  // Fast path for sequential duplicates or transaction retries
  const existingEvent = await ShipmentEvent.findOne(
    { source: event.source, external_event_id: event.external_event_id },
    null,
    { session },
  );
  if (existingEvent) {
    await writeAudit(
      {
        action: 'WEBHOOK_RECEIVED',
        entityType: 'SHIPMENT_EVENT',
        entityId: event.shipment_code,
        before: null,
        after: { reason: 'Duplicate event ignored', external_event_id: event.external_event_id, source: event.source },
        correlationId: event.correlation_id,
        stepType: 'DUPLICATE_IGNORED',
      },
      session,
    );
    return { status: 'DUPLICATE', reason: 'Duplicate event (same source + external_event_id)', shipment_code: event.shipment_code };
  }

  // Rely on DB unique index for concurrent races; catch duplicate key error 11000
  let savedEvent: InstanceType<typeof ShipmentEvent> | null = null;
  try {
    const docs = await ShipmentEvent.create(
      [
        {
          shipment_id: shipment._id,
          source: event.source,
          external_event_id: event.external_event_id,
          event_type: event.event_type,
          reported_eta: event.reported_eta ?? null,
          quantity_affected: event.quantity_affected ?? null,
          confidence: trustToConfidence(incomingTrust),
          raw_payload: event.raw_payload,
          ingested_at: now,
          event_time: event.event_time ?? null,
          reconcile_status: null,   // will be updated after decision
          reconcile_reason: null,
        },
      ],
      { session },
    );
    savedEvent = docs[0];
  } catch (err: any) {
    if (err.code === 11000) {
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {
          // ignore
        }
      }
      await writeAudit({
        action: 'WEBHOOK_RECEIVED',
        entityType: 'SHIPMENT_EVENT',
        entityId: event.shipment_code,
        before: null,
        after: { reason: 'Duplicate event ignored', external_event_id: event.external_event_id, source: event.source },
        correlationId: event.correlation_id,
        stepType: 'DUPLICATE_IGNORED',
      });
      return { status: 'DUPLICATE', reason: 'Duplicate event (same source + external_event_id)', shipment_code: event.shipment_code };
    }
    throw err;
  }

  // Helpers to update the saved event's status
  async function markEvent(
    status: 'APPLIED' | 'STALE' | 'CONFLICT' | 'REJECTED',
    reason: string,
  ): Promise<void> {
    await ShipmentEvent.updateOne(
      { _id: savedEvent!._id },
      { $set: { reconcile_status: status, reconcile_reason: reason } },
      { session },
    );
  }

  // ETA-bearing events
  const isEtaEvent = ['ETA_UPDATE', 'DELAY_REPORT', 'DELAY'].includes(event.event_type);

  if (!isEtaEvent || !event.reported_eta) {
    // Non-ETA events: just APPLIED without changing ETA fields
    await markEvent('APPLIED', 'Non-ETA event accepted');
    await writeAudit(
      {
        action: 'EVENT_APPLIED',
        entityType: 'SHIPMENT_EVENT',
        entityId: savedEvent._id.toString(),
        before: null,
        after: { event_type: event.event_type, shipment_code: event.shipment_code },
        correlationId: event.correlation_id,
        stepType: 'ETA_APPLIED',
      },
      session,
    );
    await domainBus.publish('EVENT_APPLIED', {
      eventId: savedEvent._id.toString(),
      shipmentId: shipment._id.toString(),
      shipmentCode: event.shipment_code,
      eventType: event.event_type,
      source: event.source,
      correlationId: event.correlation_id,
    });
    return { status: 'APPLIED', eventId: savedEvent._id.toString(), reason: 'Non-ETA event applied', shipment_code: event.shipment_code };
  }

  // --- c. STALE check ---
  if (event.event_time && shipment.eta_basis_event_id) {
    const basisEvent = await ShipmentEvent.findOne(
      { _id: shipment.eta_basis_event_id },
      null,
      { session },
    );
    if (basisEvent) {
      const basisTrustDoc = await SourceTrust.findOne({ source: basisEvent.source }, null, { session });
      const basisTrust = basisTrustDoc?.trust_level ?? 1;
      if (
        basisTrust >= incomingTrust &&
        basisEvent.event_time &&
        event.event_time < basisEvent.event_time
      ) {
        await markEvent('STALE', 'Event is older than current basis event from equal/higher-trust source');
        await writeAudit(
          {
            action: 'WEBHOOK_RECEIVED',
            entityType: 'SHIPMENT_EVENT',
            entityId: event.shipment_code,
            before: null,
            after: { reason: 'Stale event', event_time: event.event_time, basis_event_time: basisEvent.event_time },
            correlationId: event.correlation_id,
            stepType: 'STALE_KEPT',
          },
          session,
        );
        return { status: 'STALE', eventId: savedEvent._id.toString(), reason: 'Event older than current basis', shipment_code: event.shipment_code };
      }
    }
  }

  // --- d. CONFLICT check: applied event from different source disagrees by > tolerance ---
  if (shipment.resolved_eta && shipment.eta_basis_event_id) {
    const basisEvent = await ShipmentEvent.findOne(
      { _id: shipment.eta_basis_event_id, source: { $ne: event.source } },
      null,
      { session },
    );
    if (basisEvent) {
      const etaDiff = Math.abs(
        new Date(event.reported_eta).getTime() - new Date(shipment.resolved_eta).getTime(),
      );
      if (etaDiff > toleranceMs) {
        await markEvent('CONFLICT', `ETA from ${event.source} differs by ${Math.round(etaDiff / MINUTES)} min (>${Math.round(toleranceMs / MINUTES)} min tolerance) from ${basisEvent.source}`);
        await Shipment.updateOne(
          { _id: shipment._id },
          { $set: { review_status: 'UNDER_REVIEW' } },
          { session },
        );
        await writeAudit(
          {
            action: 'CONFLICT_RAISED',
            entityType: 'SHIPMENT',
            entityId: shipment._id.toString(),
            before: { resolved_eta: shipment.resolved_eta },
            after: { review_status: 'UNDER_REVIEW', incoming_source: event.source, incoming_eta: event.reported_eta },
            correlationId: event.correlation_id,
            stepType: 'CONFLICT_RAISED',
          },
          session,
        );
        return { status: 'CONFLICT', eventId: savedEvent._id.toString(), reason: 'ETA conflict between trusted sources', shipment_code: event.shipment_code };
      }
    }
  }

  // --- e/f. APPLIED: apply new ETA ---
  const oldEta = shipment.resolved_eta;
  await markEvent('APPLIED', `ETA applied from ${event.source} (trust=${incomingTrust})`);
  await Shipment.updateOne(
    { _id: shipment._id },
    {
      $set: {
        resolved_eta: event.reported_eta,
        eta_basis_event_id: savedEvent._id,
        review_status: 'NORMAL',
      },
    },
    { session },
  );
  await writeAudit(
    {
      action: 'ETA_APPLIED',
      entityType: 'SHIPMENT',
      entityId: shipment._id.toString(),
      before: { resolved_eta: oldEta },
      after: { resolved_eta: event.reported_eta, source: event.source },
      correlationId: event.correlation_id,
      stepType: 'ETA_APPLIED',
    },
    session,
  );

  await domainBus.publish('ETA_CHANGED', {
    shipmentId: shipment._id.toString(),
    shipmentCode: event.shipment_code,
    oldEta: oldEta ?? null,
    newEta: event.reported_eta,
    source: event.source,
    reason: `Reconciler applied from ${event.source}`,
    correlationId: event.correlation_id,
  });
  await domainBus.publish('EVENT_APPLIED', {
    eventId: savedEvent._id.toString(),
    shipmentId: shipment._id.toString(),
    shipmentCode: event.shipment_code,
    eventType: event.event_type,
    source: event.source,
    correlationId: event.correlation_id,
  });

  return {
    status: 'APPLIED',
    eventId: savedEvent._id.toString(),
    reason: `ETA updated to ${event.reported_eta.toISOString()} from ${event.source}`,
    shipment_code: event.shipment_code,
  };
}

function trustToConfidence(trustLevel: number): number {
  // Map trust 1-5 to confidence 0.2-1.0
  return Math.min(1, Math.max(0.2, trustLevel / 5));
}
