/**
 * apps/api/test/step5-reconciler.test.ts
 *
 * Step 5 Part B: Belief-ETA Reconciler and carrier webhook tests.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { ShipmentEvent } from '../src/models/shipment-events.js';
import { Shipment } from '../src/models/shipments.js';
import { reconcile, IncomingEvent } from '../src/services/reconciler.js';
import { withTransaction } from '../src/db/withTransaction.js';
import { config } from '../src/config.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';

// Test shipment code and event ID patterns used exclusively in this suite
const TEST_SHIPMENT_CODE = 'SHP-310';
const TEST_EXT_IDS = [
  'EVT-STEP5B-2001',
  'EVT-STEP5B-1999',
  'EVT-STEP5B-CONFLICT',
  'EVT-STEP5B-PARALLEL',
];

function makeHmacSignature(body: string): string {
  return crypto.createHmac('sha256', config.WEBHOOK_SECRET).update(body).digest('hex');
}

async function cleanupTestEvents(): Promise<void> {
  await ShipmentEvent.deleteMany({ external_event_id: { $in: TEST_EXT_IDS } });
  // Reset the test shipment's reconciler fields
  await Shipment.updateOne(
    { code: TEST_SHIPMENT_CODE },
    { $set: { resolved_eta: null, eta_basis_event_id: null, review_status: null } },
  );
}

let analystToken: string;

describe('Step 5 Part B: Reconciler and Carrier Webhook', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    const analystLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'analyst', password: DEMO_PASSWORD });
    analystToken = analystLogin.body.token;

    await cleanupTestEvents();
  });

  afterAll(async () => {
    await cleanupTestEvents();
    await mongoose.disconnect();
  });

  afterEach(async () => {
    // Reset after each test so tests are independent
    await cleanupTestEvents();
  });

  // --- Test 1: Duplicate storm ---
  it('duplicate storm: same webhook 5 times → 1 APPLIED + 4 DUPLICATE', async () => {
    const baseEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-2001',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T06:00:00Z'),
      event_time: new Date('2026-11-01T10:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-dup-storm',
    };

    const results: any[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await withTransaction((session) => reconcile(baseEvent, session));
      results.push(r);
    }

    const applied = results.filter((s) => s.status === 'APPLIED').length;
    const duplicates = results.filter((s) => s.status === 'DUPLICATE').length;

    expect(applied).toBe(1);
    expect(duplicates).toBe(4);

    // Verify only one event row in DB
    const dbCount = await ShipmentEvent.countDocuments({
      external_event_id: 'EVT-STEP5B-2001',
      source: 'CARRIER_API',
    });
    expect(dbCount).toBe(1);
  });

  // --- Test 2: Stale event ---
  it('stale event: older EVT arriving after newer APPLIED → STALE, no ETA change', async () => {
    // First apply a newer event
    const newerEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-2001',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T06:00:00Z'),
      event_time: new Date('2026-11-01T10:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-stale-setup',
    };
    const newerResult = await withTransaction((session) => reconcile(newerEvent, session));
    expect(newerResult.status).toBe('APPLIED');

    const shipmentAfterNewer = await Shipment.findOne({ code: TEST_SHIPMENT_CODE }).lean();
    const resolvedEtaAfterNewer = shipmentAfterNewer?.resolved_eta;
    expect(resolvedEtaAfterNewer).toBeDefined();

    // Now send an older event
    const staleEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-1999',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-02T06:00:00Z'),
      event_time: new Date('2026-10-31T08:00:00Z'), // older than EVT-STEP5B-2001's event_time
      raw_payload: { source: 'test' },
      correlation_id: 'test-stale',
    };
    const staleResult = await withTransaction((session) => reconcile(staleEvent, session));
    expect(staleResult.status).toBe('STALE');

    // ETA must not change
    const shipmentAfterStale = await Shipment.findOne({ code: TEST_SHIPMENT_CODE }).lean();
    expect(shipmentAfterStale?.resolved_eta?.toISOString()).toBe(resolvedEtaAfterNewer?.toISOString());
  });

  // --- Test 3: Conflict ---
  it('conflict: two sources differ by > tolerance → CONFLICT, review_status=UNDER_REVIEW', async () => {
    // Apply CARRIER_API event first
    const carrierEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-2001',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T06:00:00Z'),
      event_time: new Date('2026-11-01T10:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-conflict-setup',
    };
    const carrierResult = await withTransaction((session) => reconcile(carrierEvent, session));
    expect(carrierResult.status).toBe('APPLIED');

    // SUPPLIER_PORTAL sends ETA 9 hours later (> 4h tolerance)
    const conflictEvent: IncomingEvent = {
      source: 'SUPPLIER_PORTAL',
      external_event_id: 'EVT-STEP5B-CONFLICT',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T15:00:00Z'), // +9h from carrier
      event_time: new Date('2026-11-01T11:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-conflict',
    };
    const conflictResult = await withTransaction((session) => reconcile(conflictEvent, session));
    expect(conflictResult.status).toBe('CONFLICT');

    const shipment = await Shipment.findOne({ code: TEST_SHIPMENT_CODE }).lean();
    expect(shipment?.review_status).toBe('UNDER_REVIEW');
    // ETA should remain unchanged
    expect(shipment?.resolved_eta?.toISOString()).toBe('2026-11-03T06:00:00.000Z');
  });

  // --- Test 4: Concurrency: 5 identical webhooks sent in parallel ---
  it('parallel webhooks: 5 identical in parallel → exactly 1 APPLIED', async () => {
    const parallelEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-PARALLEL',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-04T06:00:00Z'),
      event_time: new Date('2026-11-02T10:00:00Z'),
      raw_payload: { source: 'parallel-test' },
      correlation_id: 'test-parallel',
    };

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        withTransaction((session) => reconcile(parallelEvent, session)),
      ),
    );

    const fulfilled = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<any>).value.status);

    const applied = fulfilled.filter((s) => s === 'APPLIED').length;
    expect(applied).toBe(1);

    const dbCount = await ShipmentEvent.countDocuments({
      external_event_id: 'EVT-STEP5B-PARALLEL',
    });
    expect(dbCount).toBe(1);
  }, 15000);

  // --- Test 5: Conflict resolution via API ---
  it('conflict resolution: POST /events/conflicts/:id/resolve applies chosen ETA and sets review_status=NORMAL', async () => {
    // Setup: Apply a carrier event, then create a conflict
    const carrierEvent: IncomingEvent = {
      source: 'CARRIER_API',
      external_event_id: 'EVT-STEP5B-2001',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T06:00:00Z'),
      event_time: new Date('2026-11-01T10:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-resolve-setup',
    };
    await withTransaction((session) => reconcile(carrierEvent, session));

    const conflictEvent: IncomingEvent = {
      source: 'SUPPLIER_PORTAL',
      external_event_id: 'EVT-STEP5B-CONFLICT',
      event_type: 'ETA_UPDATE',
      shipment_code: TEST_SHIPMENT_CODE,
      reported_eta: new Date('2026-11-03T15:00:00Z'),
      event_time: new Date('2026-11-01T11:00:00Z'),
      raw_payload: { source: 'test' },
      correlation_id: 'test-resolve-conflict',
    };
    const conflictResult = await withTransaction((session) => reconcile(conflictEvent, session));
    expect(conflictResult.status).toBe('CONFLICT');
    const conflictEventId = conflictResult.eventId!;

    // Find the chosen event (carrier)
    const chosenEvent = await ShipmentEvent.findOne({
      external_event_id: 'EVT-STEP5B-2001',
      source: 'CARRIER_API',
    }).lean();
    expect(chosenEvent).toBeTruthy();

    // Resolve via API
    const resolveRes = await request(app)
      .post(`/events/conflicts/${conflictEventId}/resolve`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ chosen_event_id: chosenEvent!._id.toString(), reason: 'Carrier data verified against manifest' });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe('RESOLVED');
    expect(resolveRes.body.review_status).toBe('NORMAL');

    // Verify shipment state
    const shipment = await Shipment.findOne({ code: TEST_SHIPMENT_CODE }).lean();
    expect(shipment?.review_status).toBe('NORMAL');
  });

  // --- Test 6: RBAC and bad HMAC ---
  it('RBAC: Analyst can GET /events/conflicts; bad HMAC on webhook → 401', async () => {
    // Analyst can access conflicts
    const conflictsRes = await request(app)
      .get('/events/conflicts')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(conflictsRes.status).toBe(200);
    expect(Array.isArray(conflictsRes.body.conflicts)).toBe(true);

    // Bad HMAC → 401
    const webhookBody = JSON.stringify({
      external_event_id: 'EVT-BAD-HMAC',
      shipment_code: TEST_SHIPMENT_CODE,
      event_type: 'ETA_UPDATE',
      reported_eta: '2026-11-03T06:00:00Z',
    });
    const badHmacRes = await request(app)
      .post('/webhooks/carrier/CARRIER_API')
      .set('Content-Type', 'application/json')
      .set('x-signature', 'bad-signature-value-that-is-64-chars-padded-0000000000000000000000')
      .send(webhookBody);
    expect(badHmacRes.status).toBe(401);

    // Valid HMAC on webhook → 200 (or any reconcile result)
    const validBody = JSON.stringify({
      external_event_id: 'EVT-STEP5B-2001',
      shipment_code: TEST_SHIPMENT_CODE,
      event_type: 'ETA_UPDATE',
      reported_eta: '2026-11-05T06:00:00Z',
    });
    const validSig = makeHmacSignature(validBody);
    const validRes = await request(app)
      .post('/webhooks/carrier/CARRIER_API')
      .set('Content-Type', 'application/json')
      .set('x-signature', validSig)
      .send(JSON.parse(validBody));
    expect([200, 201]).toContain(validRes.status);
    expect(['APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'REJECTED']).toContain(validRes.body.status);
  });
});
