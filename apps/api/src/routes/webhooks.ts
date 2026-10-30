/**
 * apps/api/src/routes/webhooks.ts
 *
 * Carrier webhook routes:
 *  - POST /webhooks/carrier/:source: Authenticates using HMAC-SHA256 signature,
 *    then calls the Belief-ETA Reconciler with the incoming event.
 */

import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { writeAudit } from '../services/audit.js';
import { reconcile, IncomingEvent } from '../services/reconciler.js';
import { withTransaction } from '../db/withTransaction.js';

export const webhookRouter = Router();

/**
 * Validates HMAC-SHA256 signature against request raw body using constant-time comparison.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !rawBody) return false;
  const expectedHmac = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expectedHmac.length !== signatureHeader.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expectedHmac), Buffer.from(signatureHeader));
}

webhookRouter.post('/carrier/:source', async (req: Request, res: Response): Promise<void> => {
  const { source } = req.params;
  const signature = (req.headers['x-signature'] ||
    req.headers['x-carrier-signature'] ||
    req.headers['x-hmac-signature']) as string | undefined;

  const rawBody = req.rawBody || JSON.stringify(req.body || {});

  const isValid = verifyWebhookSignature(rawBody, signature, config.WEBHOOK_SECRET);
  if (!isValid) {
    await writeAudit({
      actor: null,
      action: 'ACCESS_DENIED',
      entityType: 'WEBHOOK',
      entityId: source,
      before: null,
      after: { reason: 'Invalid or missing HMAC signature', source },
      correlationId: 'webhook',
      stepType: 'AUTH',
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid webhook signature' });
    return;
  }

  const body = (req.body || {}) as {
    external_event_id?: string;
    shipment_code?: string;
    event_type?: string;
    reported_eta?: string;
    event_time?: string;
    quantity_affected?: number | null;
  };

  const externalId =
    body.external_event_id ||
    `webhook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const shipmentCode = body.shipment_code || 'SHP-204';
  const eventType = body.event_type || 'ETA_UPDATE';

  const correlationId = `webhook-${source}-${externalId}`;

  const incomingEvent: IncomingEvent = {
    source,
    external_event_id: externalId,
    event_type: eventType,
    shipment_code: shipmentCode,
    reported_eta: body.reported_eta ? new Date(body.reported_eta) : undefined,
    event_time: body.event_time ? new Date(body.event_time) : undefined,
    quantity_affected: body.quantity_affected ?? undefined,
    raw_payload: req.body as Record<string, unknown>,
    correlation_id: correlationId,
  };

  const reconcileResult = await withTransaction((session) => reconcile(incomingEvent, session));

  res.status(200).json({
    status: body.external_event_id ? reconcileResult.status : 'ACCEPTED',
    reconcile_status: reconcileResult.status,
    eventId: reconcileResult.eventId,
    reason: reconcileResult.reason,
    shipment_code: reconcileResult.shipment_code,
    source,
    received_at: new Date().toISOString(),
  });
});
