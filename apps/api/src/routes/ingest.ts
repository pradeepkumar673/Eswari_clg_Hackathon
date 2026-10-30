/**
 * apps/api/src/routes/ingest.ts
 *
 * Ingestion routes for voice transcripts, emails, SMS texts (W1, B15).
 *  - POST /voice/parse              — Submit voice transcript, return draft event card (submit_field_report)
 *  - POST /ingest/text              — Submit pasted email/SMS, return draft event card (ingest_text)
 *  - GET  /fixtures/sample-transcripts — Returns sample voice & B15 messages for demo
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { extractEventCard, TAMIL_LABELS } from '../services/extractor.js';
import { FieldReport } from '../models/field-reports.js';
import { Shipment } from '../models/shipments.js';
import { Warehouse } from '../models/warehouses.js';
import { SAMPLE_MESSAGES, SAMPLE_VOICE_TRANSCRIPT } from '../fixtures/sampleMessages.js';
import { simClock } from '../services/simClock.js';

export const voiceRouter = Router();
export const textIngestRouter = Router();
export const fixturesRouter = Router();

// GET /fixtures/sample-transcripts — returns fixtures for demo buttons
fixturesRouter.get('/sample-transcripts', (_req: Request, res: Response) => {
  res.json({
    voice_sample: SAMPLE_VOICE_TRANSCRIPT,
    text_samples: SAMPLE_MESSAGES,
  });
});

/**
 * Helper to enforce warehouse operator scoping:
 * If user is Warehouse_Operator, verify target warehouse matches their assigned warehouse.
 */
async function verifyOperatorWarehouse(
  user: any,
  warehouseCodeOrId: string | mongoose.Types.ObjectId | undefined | null,
): Promise<{ allowed: boolean; warehouseId?: mongoose.Types.ObjectId }> {
  if (user.role !== 'Warehouse_Operator') {
    return { allowed: true };
  }

  if (!user.warehouse_id) {
    return { allowed: false };
  }

  if (!warehouseCodeOrId) {
    return { allowed: true, warehouseId: user.warehouse_id };
  }

  // If warehouseCodeOrId is a code like WH-HOS, look it up
  let targetId = warehouseCodeOrId;
  if (typeof warehouseCodeOrId === 'string' && warehouseCodeOrId.startsWith('WH-')) {
    const wh = await Warehouse.findOne({ code: warehouseCodeOrId }).lean();
    if (!wh) return { allowed: false };
    targetId = wh._id;
  }

  const isMatch = String(user.warehouse_id) === String(targetId);
  return { allowed: isMatch, warehouseId: user.warehouse_id };
}

// POST /voice/parse
voiceRouter.post(
  '/parse',
  authenticateToken,
  requirePermission('submit_field_report'),
  async (req: Request, res: Response): Promise<void> => {
    const { transcript, language, channel = 'VOICE' } = req.body as {
      transcript?: string;
      language?: string;
      channel?: 'VOICE';
    };

    if (!transcript || transcript.trim() === '') {
      res.status(400).json({ error: 'Bad Request', message: 'Transcript is required' });
      return;
    }

    const card = await extractEventCard(transcript);

    // Operator warehouse scoping check
    if (card.warehouse_code) {
      const scopeCheck = await verifyOperatorWarehouse(req.user, card.warehouse_code);
      if (!scopeCheck.allowed) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Warehouse Operator cannot submit reports for another warehouse',
        });
        return;
      }
    }

    const now = await simClock.now();
    let shipmentId: mongoose.Types.ObjectId | null = null;
    if (card.shipment_code) {
      const s = await Shipment.findOne({ code: card.shipment_code }).lean();
      if (s) shipmentId = s._id;
    }

    // Store raw text untouched in field_reports with status DRAFT
    const report = await FieldReport.create({
      shipment_id: shipmentId,
      reporter_user_id: req.user!._id,
      channel,
      raw_text: transcript,
      extracted_data: {
        shipment_code: card.shipment_code,
        warehouse_code: card.warehouse_code,
        event_type: card.event_type,
        damaged_units: card.damaged_units,
        delay_hours: card.delay_hours,
        confidence: card.confidence,
      },
      llm_used: card.llm_used,
      status: 'DRAFT',
      created_at: now,
    });

    res.status(200).json({
      report_id: report._id.toString(),
      card: {
        ...card,
        field_report_id: report._id.toString(),
      },
      tamil_labels: TAMIL_LABELS,
    });
  },
);

// POST /ingest/text
textIngestRouter.post(
  '/text',
  authenticateToken,
  requirePermission('ingest_text'),
  async (req: Request, res: Response): Promise<void> => {
    const { text, channel = 'EMAIL_TEXT' } = req.body as {
      text?: string;
      channel?: 'EMAIL_TEXT' | 'SMS_TEXT';
    };

    if (!text || text.trim() === '') {
      res.status(400).json({ error: 'Bad Request', message: 'Text content is required' });
      return;
    }

    const card = await extractEventCard(text);

    // Operator warehouse scoping check
    if (card.warehouse_code) {
      const scopeCheck = await verifyOperatorWarehouse(req.user, card.warehouse_code);
      if (!scopeCheck.allowed) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Warehouse Operator cannot ingest messages for another warehouse',
        });
        return;
      }
    }

    const now = await simClock.now();
    let shipmentId: mongoose.Types.ObjectId | null = null;
    if (card.shipment_code) {
      const s = await Shipment.findOne({ code: card.shipment_code }).lean();
      if (s) shipmentId = s._id;
    }

    // Store raw text untouched in field_reports with status DRAFT
    const report = await FieldReport.create({
      shipment_id: shipmentId,
      reporter_user_id: req.user!._id,
      channel,
      raw_text: text,
      extracted_data: {
        shipment_code: card.shipment_code,
        warehouse_code: card.warehouse_code,
        event_type: card.event_type,
        damaged_units: card.damaged_units,
        delay_hours: card.delay_hours,
        confidence: card.confidence,
      },
      llm_used: card.llm_used,
      status: 'DRAFT',
      created_at: now,
    });

    res.status(200).json({
      report_id: report._id.toString(),
      card: {
        ...card,
        field_report_id: report._id.toString(),
      },
      tamil_labels: TAMIL_LABELS,
    });
  },
);
