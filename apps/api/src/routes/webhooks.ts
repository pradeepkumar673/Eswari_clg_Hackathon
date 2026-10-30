/**
 * apps/api/src/routes/webhooks.ts
 *
 * Carrier webhook routes:
 *  - POST /webhooks/carrier/:source: Authenticates using HMAC-SHA256 signature
 */

import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { writeAudit } from '../services/audit.js';

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

  // Signature is valid — log ingestion receipt
  await writeAudit({
    actor: null,
    action: 'WEBHOOK_RECEIVED',
    entityType: 'CARRIER_EVENT',
    entityId: source,
    before: null,
    after: { source, payload: req.body },
    correlationId: 'webhook',
    stepType: 'INTAKE',
  });

  res.status(200).json({ status: 'ACCEPTED', source, received_at: new Date().toISOString() });
});
