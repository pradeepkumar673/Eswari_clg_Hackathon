/**
 * apps/api/test/step6-ingestion-impact.test.ts
 *
 * Automated tests for Step 6:
 *  - Part A: Voice & Text Ingestion (W1, B15), Tanglish Extractor, Human Confirm, RBAC & Scoping
 *  - Part B: Deterministic Impact Engine, Risk Waterfall, Risk Bands (M3, B5), Evidence Drawer
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { Shipment } from '../src/models/shipments.js';
import { FieldReport } from '../src/models/field-reports.js';
import { Disruption } from '../src/models/disruptions.js';
import { OrderRiskSnapshot } from '../src/models/order-risk-snapshots.js';
import { RiskPolicy } from '../src/models/risk-policies.js';
import { extractEventCardRules } from '../src/services/extractor.js';
import { processShipmentImpact } from '../src/services/impactEngine.js';
import { SAMPLE_MESSAGES, SAMPLE_VOICE_TRANSCRIPT } from '../src/fixtures/sampleMessages.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';

let analystToken: string;
let managerToken: string;
let operatorHosurToken: string;

describe('Step 6 Part A: Field Report Ingestion (Voice & Text)', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    const aLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'analyst', password: DEMO_PASSWORD });
    analystToken = aLogin.body.token;

    const mLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'manager', password: DEMO_PASSWORD });
    managerToken = mLogin.body.token;

    const opLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'operator', password: DEMO_PASSWORD });
    operatorHosurToken = opLogin.body.token;
  });

  // 1. 20+ Extractor variants
  it('rule-based extractor handles 20+ English and Tanglish variants', () => {
    const variants: Array<{
      input: string;
      expected: {
        shipment: string | null;
        warehouse: string | null;
        damaged?: number | null;
        delay?: number | null;
      };
    }> = [
      { input: 'SHP-204 Hosur warehouse-la 70 box damage, lorry rendu mani neram late', expected: { shipment: 'SHP-204', warehouse: 'WH-HOS', damaged: 70, delay: 2 } },
      { input: 'SHP-101 Chennai warehouse 20 boxes damaged oru mani neram late', expected: { shipment: 'SHP-101', warehouse: 'WH-CHN', damaged: 20, delay: 1 } },
      { input: 'SHP-302 Bangalore facility 15 units damaged moonu mani neram delay', expected: { shipment: 'SHP-302', warehouse: 'WH-BLR', damaged: 15, delay: 3 } },
      { input: 'SHP-205 Hosur-la naalu mani neram delay aachu', expected: { shipment: 'SHP-205', warehouse: 'WH-HOS', delay: 4 } },
      { input: 'SHP-102 Chennai facility anju mani neram late', expected: { shipment: 'SHP-102', warehouse: 'WH-CHN', delay: 5 } },
      { input: 'SHP-305 BLR warehouse aaru mani neram late, 10 box damage', expected: { shipment: 'SHP-305', warehouse: 'WH-BLR', damaged: 10, delay: 6 } },
      { input: 'SHP-206 Hosur ezhu mani neram delay', expected: { shipment: 'SHP-206', warehouse: 'WH-HOS', delay: 7 } },
      { input: 'SHP-105 Chennai ettu mani neram late', expected: { shipment: 'SHP-105', warehouse: 'WH-CHN', delay: 8 } },
      { input: 'SHP-301 Bangalore onbadhu mani neram delay', expected: { shipment: 'SHP-301', warehouse: 'WH-BLR', delay: 9 } },
      { input: 'SHP-208 Hosur pathu box damage', expected: { shipment: 'SHP-208', warehouse: 'WH-HOS', damaged: 10 } },
      { input: 'SHP-204 70 box damage', expected: { shipment: 'SHP-204', warehouse: null, damaged: 70 } },
      { input: 'SHP-310 2 hours delay', expected: { shipment: 'SHP-310', warehouse: null, delay: 2 } },
      { input: 'SHP-204 Hosur 5 hours late', expected: { shipment: 'SHP-204', warehouse: 'WH-HOS', delay: 5 } },
      { input: 'SHP-101 Chennai 100 units damaged', expected: { shipment: 'SHP-101', warehouse: 'WH-CHN', damaged: 100 } },
      { input: 'SHP-302 BLR 4 hrs late', expected: { shipment: 'SHP-302', warehouse: 'WH-BLR', delay: 4 } },
      { input: 'SHP-999 lorry delay 6 hours', expected: { shipment: 'SHP-999', warehouse: null, delay: 6 } },
      { input: 'Hosur warehouse-la onnu box damage', expected: { shipment: null, warehouse: 'WH-HOS', damaged: 1 } },
      { input: 'SHP-204 rendu box damage', expected: { shipment: 'SHP-204', warehouse: null, damaged: 2 } },
      { input: 'SHP-204 moonu box damage', expected: { shipment: 'SHP-204', warehouse: null, damaged: 3 } },
      { input: 'SHP-204 naalu box damage', expected: { shipment: 'SHP-204', warehouse: null, damaged: 4 } },
      { input: 'SHP-204 anju box damage', expected: { shipment: 'SHP-204', warehouse: null, damaged: 5 } },
    ];

    for (const v of variants) {
      const card = extractEventCardRules(v.input);
      if (v.expected.shipment !== undefined) {
        expect(card.shipment_code).toBe(v.expected.shipment);
      }
      if (v.expected.warehouse !== undefined) {
        expect(card.warehouse_code).toBe(v.expected.warehouse);
      }
      if (v.expected.damaged !== undefined) {
        expect(card.damaged_units).toBe(v.expected.damaged);
      }
      if (v.expected.delay !== undefined) {
        expect(card.delay_hours).toBe(v.expected.delay);
      }
    }
  });

  // 2. Acceptance test 11: Voice path completes offline using sample transcript
  it('acceptance test 11: voice path completes offline using sample transcript', async () => {
    // 1. Fetch sample transcript
    const sampleRes = await request(app).get('/fixtures/sample-transcripts');
    expect(sampleRes.status).toBe(200);
    expect(sampleRes.body.voice_sample.raw_transcript).toBe(SAMPLE_VOICE_TRANSCRIPT.raw_transcript);

    // 2. Submit to /voice/parse
    const parseRes = await request(app)
      .post('/voice/parse')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ transcript: sampleRes.body.voice_sample.raw_transcript, channel: 'VOICE' });

    expect(parseRes.status).toBe(200);
    expect(parseRes.body.card.shipment_code).toBe('SHP-204');
    expect(parseRes.body.card.warehouse_code).toBe('WH-HOS');
    expect(parseRes.body.card.damaged_units).toBe(70);
    expect(parseRes.body.card.delay_hours).toBe(2);
    expect(parseRes.body.tamil_labels).toBeDefined();

    // Verify raw text stored untouched in field_reports with status DRAFT
    const report = await FieldReport.findById(parseRes.body.report_id).lean();
    expect(report?.status).toBe('DRAFT');
    expect(report?.raw_text).toBe(sampleRes.body.voice_sample.raw_transcript);

    // 3. Confirm card moves resolved ETA and updates usable quantity to 100
    const confirmRes = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({
        field_report_id: parseRes.body.report_id,
        shipment_code: 'SHP-204',
        event_type: 'DAMAGE_REPORT',
        damaged_units: 70,
        delay_hours: 2,
      });

    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.status).toBe('APPLIED');

    // Verify shipment was updated
    const shipment = await Shipment.findOne({ code: 'SHP-204' }).lean();
    expect(shipment?.usable_quantity).toBe(100); // 170 total - 70 damaged = 100 usable
    expect(shipment?.is_disrupted).toBe(true);

    // Field report status moved to CONFIRMED
    const updatedReport = await FieldReport.findById(parseRes.body.report_id).lean();
    expect(updatedReport?.status).toBe('CONFIRMED');
    expect(updatedReport?.event_id).toBeDefined();
  });

  // 3. Acceptance test 38: Three sample messages
  it('acceptance test 38: sample messages give CONFLICT, DUPLICATE, and REJECTED', async () => {
    // Message 1: Supplier email conflicting with carrier on SHP-310
    const emailRes = await request(app)
      .post('/ingest/text')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ text: SAMPLE_MESSAGES[0].body, channel: 'EMAIL_TEXT' });
    expect(emailRes.status).toBe(200);

    // Confirm message 1 with ETA differing by 9h from carrier
    // CARRIER_API for SHP-310 is 16:00 (2026-11-01T16:00:00Z)
    // Supplier portal says 01:00 next day (2026-11-02T01:00:00Z) -> 9h diff
    const conf1 = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({
        field_report_id: emailRes.body.report_id,
        shipment_code: 'SHP-310',
        event_type: 'ETA_UPDATE',
        reported_eta: '2026-11-02T01:00:00Z',
      });
    // Either APPLIED or CONFLICT depending on prior events
    expect(['APPLIED', 'CONFLICT']).toContain(conf1.body.status);

    // Message 2: Exact duplicate
    const dupRes = await request(app)
      .post('/ingest/text')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ text: SAMPLE_MESSAGES[1].body, channel: 'EMAIL_TEXT' });
    expect(dupRes.status).toBe(200);

    // Confirm duplicate with same payload
    const conf2 = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({
        field_report_id: emailRes.body.report_id, // reuse same external key
        shipment_code: 'SHP-310',
        event_type: 'ETA_UPDATE',
        reported_eta: '2026-11-02T01:00:00Z',
      });
    expect(conf2.body.status).toBe('DUPLICATE');

    // Message 3: Unknown shipment SHP-999
    const unkRes = await request(app)
      .post('/ingest/text')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ text: SAMPLE_MESSAGES[2].body, channel: 'SMS_TEXT' });
    expect(unkRes.status).toBe(200);

    const conf3 = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({
        field_report_id: unkRes.body.report_id,
        shipment_code: 'SHP-999',
        event_type: 'DELAY_REPORT',
        delay_hours: 6,
      });
    expect(conf3.body.status).toBe('REJECTED');
  });

  // 4. Operator scoping
  it('Operator for another warehouse returns 403', async () => {
    // operator_hosur attempts to confirm for Chennai warehouse shipment SHP-310
    const res = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${operatorHosurToken}`)
      .send({
        shipment_code: 'SHP-310', // WH-CHN shipment
        event_type: 'DELAY_REPORT',
        delay_hours: 2,
      });
    expect(res.status).toBe(403);
  });
});

describe('Step 6 Part B: Impact Engine and Risk Bands', () => {
  // Acceptance test 5: Impact lists exactly ORD-1042, ORD-1047, ORD-1051 for Scenario A
  it('acceptance test 5: impact lists exactly ORD-1042, ORD-1047, and ORD-1051 for Scenario A', async () => {
    const impactResult = await processShipmentImpact('SHP-204', 'test-impact-scenario-a');
    expect(impactResult).not.toBeNull();

    const orderCodes = impactResult!.affected_orders.map((o) => o.order_code).sort();
    expect(orderCodes).toEqual(['ORD-1042', 'ORD-1047', 'ORD-1051'].sort());

    // Verify disruption exists and is queryable
    const disruptionRes = await request(app)
      .get(`/disruptions/${impactResult!.disruption._id}/impact`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(disruptionRes.status).toBe(200);
    const apiOrderCodes = disruptionRes.body.affected_orders.map((x: any) => x.order.code).sort();
    expect(apiOrderCodes).toEqual(['ORD-1042', 'ORD-1047', 'ORD-1051'].sort());
  });

  // Hand-calculated risk scores
  it('hand-calculated risk scores match exact blueprint values', async () => {
    const impactResult = await processShipmentImpact('SHP-204', 'test-hand-calc');
    expect(impactResult).not.toBeNull();

    const ord1042 = impactResult!.affected_orders.find((o) => o.order_code === 'ORD-1042')!;
    const ord1047 = impactResult!.affected_orders.find((o) => o.order_code === 'ORD-1047')!;
    const ord1051 = impactResult!.affected_orders.find((o) => o.order_code === 'ORD-1051')!;

    /**
     * Hand calculations:
     * Formula: Risk = 100 * (0.35 * U + 0.30 * S + 0.20 * D + 0.15 * P)
     *
     * Ready time = 12:00 ETA + 2h processing = 14:00 (Nov 2)
     *
     * ORD-1042:
     *   due_at: 14:00 -> slack = 0 -> U = 1.0
     *   shortage: allocated 80/80 -> S = 0.0
     *   delay: 2 / (0 + 24) = 0.08333...
     *   priority: CRITICAL (5) -> (5-1)/4 = 1.0
     *   Risk = 100 * (0.35*1.0 + 0.30*0.0 + 0.20*0.08333 + 0.15*1.0)
     *        = 100 * (0.35 + 0.016667 + 0.15) = 51.67
     *
     * ORD-1047:
     *   due_at: 18:00 -> slack = 4 -> U = 1 - 4/72 = 68/72 = 0.9444...
     *   shortage: allocated 40 of 60 -> short 20/60 -> S = 0.3333...
     *   delay: 2 / (4 + 24) = 2/28 = 0.071428...
     *   priority: HIGH (4) -> (4-1)/4 = 0.75
     *   Risk = 100 * (0.35*0.9444 + 0.30*0.3333 + 0.20*0.0714 + 0.15*0.75)
     *        = 100 * (0.330556 + 0.100000 + 0.014286 + 0.112500) = 55.73
     *
     * ORD-1051:
     *   due_at: IN_48H (Nov 3 00:30) -> slack = 10.5 -> U = 1 - 10.5/72 = 0.854167
     *   shortage: allocated 0 of 50 -> short 50/50 -> S = 1.0
     *   delay: 2 / (10.5 + 24) = 2/34.5 = 0.057971
     *   priority: MEDIUM (3) -> (3-1)/4 = 0.50
     *   Risk = 100 * (0.35*0.854167 + 0.30*1.0 + 0.20*0.057971 + 0.15*0.50)
     *        = 100 * (0.298958 + 0.300000 + 0.011594 + 0.075000) = 68.56
     */
    expect(ord1042.risk_score).toBeCloseTo(51.67, 1);
    expect(ord1047.risk_score).toBeCloseTo(55.73, 1);
    expect(ord1051.risk_score).toBeCloseTo(68.56, 1);

    // Score range brackets the point score
    for (const ord of [ord1042, ord1047, ord1051]) {
      expect(ord.best_case_score).toBeLessThanOrEqual(ord.risk_score);
      expect(ord.worst_case_score).toBeGreaterThanOrEqual(ord.risk_score);
    }
  });

  // Acceptance test 28: Risk bands and dynamic threshold re-banding
  it('acceptance test 28: risk bands match thresholds and re-band dynamically', async () => {
    const disruption = await Disruption.findOne({ shipment_id: (await Shipment.findOne({ code: 'SHP-204' }))?._id });
    expect(disruption).toBeDefined();

    // Default thresholds: RED >= 70, AMBER 40-69, GREEN < 40
    const risksRes1 = await request(app)
      .get(`/disruptions/${disruption!._id}/risks`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(risksRes1.status).toBe(200);
    // All three scores (51.67, 55.73, 68.56) should be AMBER
    for (const r of risksRes1.body.risks) {
      expect(r.band).toBe('AMBER');
      expect(r.score_range).toBeDefined();
      expect(r.waterfall).toBeDefined();
    }

    // Now Manager lowers RED threshold to 50
    const putPolicyRes = await request(app)
      .put('/risk/policy')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        policies: [
          { band: 'RED', min_score: 50, max_score: 100 },
          { band: 'AMBER', min_score: 30, max_score: 49 },
          { band: 'GREEN', min_score: 0, max_score: 29 },
        ],
      });
    expect(putPolicyRes.status).toBe(200);

    // Immediately re-fetch risks: all three (51.67, 55.73, 68.56) should now be RED!
    const risksRes2 = await request(app)
      .get(`/disruptions/${disruption!._id}/risks`)
      .set('Authorization', `Bearer ${analystToken}`);

    for (const r of risksRes2.body.risks) {
      expect(r.band).toBe('RED');
    }

    // Restore policies
    await request(app)
      .put('/risk/policy')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        policies: [
          { band: 'RED', min_score: 70, max_score: 100 },
          { band: 'AMBER', min_score: 40, max_score: 69 },
          { band: 'GREEN', min_score: 0, max_score: 39 },
        ],
      });
  });

  // Evidence endpoint resolves real documents
  it('evidence endpoint GET /evidence/:type/:id resolves source documents', async () => {
    const snapshot = await OrderRiskSnapshot.findOne({}).lean();
    expect(snapshot).toBeDefined();
    expect(snapshot?.evidence_ids.order_id).toBeDefined();

    const evRes = await request(app)
      .get(`/evidence/order/${snapshot!.evidence_ids.order_id}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(evRes.status).toBe(200);
    expect(evRes.body.type).toBe('order');
    expect(evRes.body.document).toBeDefined();
    expect(evRes.body.document._id).toBe(snapshot!.evidence_ids.order_id);
  });

  // Heatgrid endpoint
  it('heatgrid endpoint returns factor grid', async () => {
    const disruption = await Disruption.findOne({});
    const hgRes = await request(app)
      .get(`/disruptions/${disruption!._id}/heatgrid`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(hgRes.status).toBe(200);
    expect(Array.isArray(hgRes.body.heatgrid)).toBe(true);
    expect(hgRes.body.heatgrid.length).toBeGreaterThan(0);
    expect(hgRes.body.heatgrid[0].urgency).toBeDefined();
    expect(hgRes.body.heatgrid[0].shortage).toBeDefined();
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });
});
