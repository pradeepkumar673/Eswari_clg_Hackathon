/**
 * apps/api/test/step19-foundation.test.ts
 *
 * Vitest acceptance tests for Step 19 Foundation:
 * 1. DRIVER scoping: DRV-1 cannot read DRV-2 positions (403), Driver cannot call approve route (403).
 * 2. SUPPLIER scoping: SUP-1 cannot read SUP-2 claims (403), Procurement cannot read driver positions (403).
 * 3. OPERATOR scoping: Operator for WH-BLR cannot read WH-HOS tracking (403).
 * 4. WebSocket security:
 *    - No auth message closes socket.
 *    - Bad token is refused (socket closed).
 *    - Driver socket receives only its own truck's frames.
 * 5. Immediate role reflection: Changed role on user record takes effect immediately, including on open socket's next subscription.
 * 6. Mongo constraints & validators:
 *    - Zone validator rejects reserved_inbound_slots > capacity_slots.
 *    - Duplicate (driver_id, seq) rejected.
 *    - Partial unique index on inbound_slot_plans prevents two PLANNED plans for one shipment.
 * 7. Model smoke test verification.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { User } from '../src/models/users.js';
import { Warehouse } from '../src/models/warehouses.js';
import { DriverPing } from '../src/models/driver-pings.js';
import { SupplierClaim } from '../src/models/supplier-claims.js';
import { Zone } from '../src/models/zones.js';
import { InboundSlotPlan } from '../src/models/inbound-slot-plans.js';
import {
  initWebSocketServer,
  closeWebSocketServer,
  broadcastToTopic,
} from '../src/services/websocket.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Step 19 — CCTV, Driver Tracking & Capacity Mapping Foundation', () => {
  let server: http.Server;
  let wsPort: number;

  let drv1Token: string;
  let drv2Token: string;
  let sup1Token: string;
  let sup2Token: string;
  let procurementToken: string;
  let operatorBlrToken: string;
  let dynamicUserToken: string;
  let dynamicUserId: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    // Create an extra operator for WH-BLR to test warehouse isolation
    const blrWarehouse = await Warehouse.findOne({ code: 'WH-BLR' }).lean();
    expect(blrWarehouse).toBeDefined();

    await User.findOneAndUpdate(
      { username: 'operator_blr' },
      {
        $set: {
          username: 'operator_blr',
          password_hash: 'hash',
          role: 'Warehouse_Operator',
          warehouse_id: blrWarehouse!._id,
          display_name: 'Bengaluru Operator',
        },
      },
      { upsert: true, new: true },
    );

    // Create SUP-2 supplier user
    await User.findOneAndUpdate(
      { username: 'sup2' },
      {
        $set: {
          username: 'sup2',
          password_hash: 'hash',
          role: 'SUPPLIER',
          supplier_id: 'SUP-2',
          display_name: 'Precision Components Rep',
        },
      },
      { upsert: true, new: true },
    );

    // Create dynamic user for role change test
    const dynamicUser = await User.findOneAndUpdate(
      { username: 'dynamic_user' },
      {
        $set: {
          username: 'dynamic_user',
          password_hash: 'hash',
          role: 'Analyst',
          display_name: 'Dynamic Role User',
        },
      },
      { upsert: true, new: true },
    );
    dynamicUserId = dynamicUser!._id.toString();

    // Seed test claims for SUP-1 and SUP-2
    await SupplierClaim.findOneAndUpdate(
      { claim_id: 'CLM-SUP1-001' },
      {
        $set: {
          claim_id: 'CLM-SUP1-001',
          supplier_id: 'SUP-1',
          shipment_id: 'SHP-204',
          cctv_event_id: 'EVT-CCTV-01',
          band: 'MAJOR',
          units: 20,
          delay_hours: 24,
          status: 'OPEN',
        },
      },
      { upsert: true },
    );

    await SupplierClaim.findOneAndUpdate(
      { claim_id: 'CLM-SUP2-001' },
      {
        $set: {
          claim_id: 'CLM-SUP2-001',
          supplier_id: 'SUP-2',
          shipment_id: 'SHP-310',
          cctv_event_id: 'EVT-CCTV-02',
          band: 'SEVERE',
          units: 15,
          delay_hours: 48,
          status: 'OPEN',
        },
      },
      { upsert: true },
    );

    // Generate tokens
    const drv1User = await User.findOne({ username: 'drv1' }).lean();
    const drv2User = await User.findOne({ username: 'drv2' }).lean();
    const sup1User = await User.findOne({ username: 'sup1' }).lean();
    const sup2User = await User.findOne({ username: 'sup2' }).lean();
    const procUser = await User.findOne({ username: 'procurement' }).lean();
    const opBlrUser = await User.findOne({ username: 'operator_blr' }).lean();

    drv1Token = jwt.sign(
      { sub: drv1User!._id.toString(), username: 'drv1', role: 'DRIVER', driver_id: 'DRV-1', truck_id: 'SHP-204' },
      config.JWT_SECRET,
    );
    drv2Token = jwt.sign(
      { sub: drv2User!._id.toString(), username: 'drv2', role: 'DRIVER', driver_id: 'DRV-2', truck_id: 'SHP-310' },
      config.JWT_SECRET,
    );
    sup1Token = jwt.sign(
      { sub: sup1User!._id.toString(), username: 'sup1', role: 'SUPPLIER', supplier_id: 'SUP-1' },
      config.JWT_SECRET,
    );
    sup2Token = jwt.sign(
      { sub: sup2User!._id.toString(), username: 'sup2', role: 'SUPPLIER', supplier_id: 'SUP-2' },
      config.JWT_SECRET,
    );
    procurementToken = jwt.sign(
      { sub: procUser!._id.toString(), username: 'procurement', role: 'Procurement_Approver' },
      config.JWT_SECRET,
    );
    operatorBlrToken = jwt.sign(
      { sub: opBlrUser!._id.toString(), username: 'operator_blr', role: 'Warehouse_Operator', warehouse_id: blrWarehouse!._id.toString() },
      config.JWT_SECRET,
    );
    dynamicUserToken = jwt.sign(
      { sub: dynamicUserId, username: 'dynamic_user', role: 'Analyst' },
      config.JWT_SECRET,
    );

    // Start HTTP and WebSocket test server on random port
    server = http.createServer(app);
    initWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        wsPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await closeWebSocketServer();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await User.deleteMany({ username: { $in: ['operator_blr', 'sup2', 'dynamic_user'] } });
    await SupplierClaim.deleteMany({ claim_id: { $in: ['CLM-SUP1-001', 'CLM-SUP2-001'] } });
    await InboundSlotPlan.deleteMany({ zone_id: 'ZN-HOS-STR' });
    await mongoose.disconnect();
  });

  // ── 1. DRIVER SCOPING TESTS ────────────────────────────────────────────────
  it('Driver token for DRV-1 cannot read DRV-2 positions (403)', async () => {
    const res = await request(app)
      .get('/api/v1/tracking/drivers/DRV-2/positions')
      .set('Authorization', `Bearer ${drv1Token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('Driver token for DRV-1 cannot call any approve route (403)', async () => {
    const res = await request(app)
      .post('/api/v1/plans/PLN-2026-0042/approve')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({ role: 'Manager', notes: 'Driver trying to approve' });

    expect(res.status).toBe(403);
  });

  // ── 2. SUPPLIER SCOPING TESTS ──────────────────────────────────────────────
  it('Supplier token for SUP-1 cannot read SUP-2 claims (403)', async () => {
    // 1. Direct claim lookup
    const res1 = await request(app)
      .get('/api/v1/claims/CLM-SUP2-001')
      .set('Authorization', `Bearer ${sup1Token}`);

    expect(res1.status).toBe(403);

    // 2. Query filter on other supplier
    const res2 = await request(app)
      .get('/api/v1/claims?supplier_id=SUP-2')
      .set('Authorization', `Bearer ${sup1Token}`);

    expect(res2.status).toBe(403);
  });

  it('Procurement cannot read driver positions (403)', async () => {
    const res = await request(app)
      .get('/api/v1/tracking/positions')
      .set('Authorization', `Bearer ${procurementToken}`);

    expect(res.status).toBe(403);
  });

  // ── 3. OPERATOR SCOPING TESTS ──────────────────────────────────────────────
  it('Operator for WH-BLR cannot read WH-HOS tracking (403)', async () => {
    const res = await request(app)
      .get('/api/v1/tracking/positions?warehouse_id=WH-HOS')
      .set('Authorization', `Bearer ${operatorBlrToken}`);

    expect(res.status).toBe(403);
  });

  // ── 4. WEBSOCKET TESTS ─────────────────────────────────────────────────────
  it('WebSocket: non-auth first message closes the socket with error', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' })); // Invalid first message

    const result = await closePromise;
    expect(result.code).toBe(4002);
  });

  it('WebSocket: bad token is refused and socket is closed', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);

    const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      ws.on('close', (code, reason) => {
        resolve({ code, reason: reason.toString() });
      });
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));
    ws.send(JSON.stringify({ type: 'auth', token: 'bad-tampered-token-123' }));

    const result = await closePromise;
    expect(result.code).toBe(4003);
  });

  it('WebSocket: a driver socket receives only its own truck frames', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);

    const messages: any[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    // 1. Authenticate with DRV-1 token
    ws.send(JSON.stringify({ type: 'auth', token: drv1Token }));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.some((m) => m.type === 'auth_ok')).toBe(true);

    // 2. Subscribe to tracking
    ws.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));
    await new Promise((r) => setTimeout(r, 100));

    expect(messages.some((m) => m.type === 'subscribed' && m.topic === 'tracking')).toBe(true);

    // 3. Broadcast two tracking updates: one for SHP-204 (DRV-1) and one for SHP-310 (DRV-2)
    await broadcastToTopic('tracking', {
      truck_id: 'SHP-204',
      driver_id: 'DRV-1',
      lat: 12.80,
      lng: 77.90,
      speed_kmh: 52,
    });

    await broadcastToTopic('tracking', {
      truck_id: 'SHP-310',
      driver_id: 'DRV-2',
      lat: 13.05,
      lng: 80.20,
      speed_kmh: 48,
    });

    await new Promise((r) => setTimeout(r, 150));

    const events = messages.filter((m) => m.type === 'event' && m.topic === 'tracking');
    expect(events.length).toBe(1);
    expect(events[0].data.truck_id).toBe('SHP-204');
    expect(events[0].data.driver_id).toBe('DRV-1');

    ws.close();
  });

  // ── 5. IMMEDIATE ROLE REFLECTION TEST ──────────────────────────────────────
  it('A changed role on user record takes effect immediately, including on open socket subscription', async () => {
    const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);
    const messages: any[] = [];
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    // Authenticate as dynamicUser (currently Analyst)
    ws.send(JSON.stringify({ type: 'auth', token: dynamicUserToken }));
    await new Promise((r) => setTimeout(r, 100));
    expect(messages.some((m) => m.type === 'auth_ok')).toBe(true);

    // Change role in MongoDB directly to DRIVER
    await User.findByIdAndUpdate(dynamicUserId, { $set: { role: 'DRIVER', driver_id: 'DRV-DYN' } });

    // Next subscription attempt for a topic that DRIVER cannot access (e.g. cctv)
    ws.send(JSON.stringify({ type: 'subscribe', topic: 'cctv' }));
    await new Promise((r) => setTimeout(r, 100));

    // The server live-checked the DB, recognized the new DRIVER role, and rejected the cctv subscription!
    const errorMsg = messages.find((m) => m.type === 'error' && m.topic === 'cctv');
    expect(errorMsg).toBeDefined();
    expect(errorMsg.message).toContain('Forbidden');

    ws.close();
  });

  // ── 6. MONGO CONSTRAINTS & VALIDATORS TESTS ─────────────────────────────────
  it('Mongo validators reject zone reserved_inbound_slots above capacity_slots', async () => {
    let errorCaught: any = null;
    try {
      await Zone.create({
        zone_id: `ZN-TEST-${Date.now()}`,
        warehouse_id: 'WH-HOS',
        name: `Invalid Zone ${Date.now()}`,
        zone_type: 'STORAGE',
        polygon: [[0, 0], [100, 100]],
        capacity_slots: 20,
        reserved_inbound_slots: 35, // Violates reserved <= capacity
      });
    } catch (err: any) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
  });

  it('Mongo unique index rejects duplicate (driver_id, seq) pings', async () => {
    const driverId = `DRV-DUP-${Date.now()}`;
    await DriverPing.create({
      driver_id: driverId,
      truck_id: 'TRK-TEST',
      seq: 1,
      ts: new Date(),
      lat: 12.5,
      lng: 77.5,
      speed_kmh: 40,
    });

    let duplicateErr: any = null;
    try {
      await DriverPing.create({
        driver_id: driverId,
        truck_id: 'TRK-TEST',
        seq: 1, // Same seq for same driver_id
        ts: new Date(),
        lat: 12.6,
        lng: 77.6,
        speed_kmh: 42,
      });
    } catch (err: any) {
      duplicateErr = err;
    }

    expect(duplicateErr).not.toBeNull();
    expect(duplicateErr.code).toBe(11000);
  });

  it('Unique partial index on inbound_slot_plans prevents two PLANNED plans for one shipment', async () => {
    const shipmentId = `SHP-SLOT-${Date.now()}`;

    // First plan with status PLANNED succeeds
    await InboundSlotPlan.create({
      shipment_id: shipmentId,
      zone_id: 'ZN-HOS-REC',
      slots: 10,
      status: 'PLANNED',
    });

    // Second plan for SAME shipment with status PLANNED must fail with duplicate key
    let dupPlanErr: any = null;
    try {
      await InboundSlotPlan.create({
        shipment_id: shipmentId,
        zone_id: 'ZN-HOS-STR',
        slots: 15,
        status: 'PLANNED',
      });
    } catch (err: any) {
      dupPlanErr = err;
    }

    expect(dupPlanErr).not.toBeNull();
    expect(dupPlanErr.code).toBe(11000);

    // Releasing the first plan allows a subsequent PLANNED row
    await InboundSlotPlan.updateOne({ shipment_id: shipmentId, status: 'PLANNED' }, { $set: { status: 'RELEASED' } });

    const newPlan = await InboundSlotPlan.create({
      shipment_id: shipmentId,
      zone_id: 'ZN-HOS-STR',
      slots: 15,
      status: 'PLANNED',
    });

    expect(newPlan._id).toBeDefined();
  });

  // ── 7. MODEL SMOKE TEST VERIFICATION ───────────────────────────────────────
  it('Model smoke test from Step 5 passes with valid detections', () => {
    const fixturePath = path.resolve('services/vision/tests/fixtures/model_smoke.json');
    expect(fs.existsSync(fixturePath)).toBe(true);

    const smoke = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    expect(smoke.model_sha256).toBe('84c9b943672e676f32c97dc36a81aae8766bdd96646e1b5e552de17aebca289c');
    expect(smoke.class_names['0']).toBe('Damaged');
    expect(smoke.class_names['1']).toBe('Normal');
    expect(smoke.detection_count).toBeGreaterThan(0);
    expect(smoke.detections.length).toBe(smoke.detection_count);
    expect(smoke.detections[0].confidence).toBeGreaterThan(0.5);
  });
});

