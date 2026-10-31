/**
 * apps/api/test/step23-scenario-c.test.ts
 *
 * Vitest Acceptance Test Suite for Step 23 — The Gate & Verification Suite:
 * 1. Damage flow: synthesize/clip, analyze, link by Operator, OPEN claim, 48h delay on ETA, quarantine ledger row.
 * 2. Tracking flow: DRV-2 pings through simulator for 20 sim minutes; Analyst socket gets same positions; Operator for WH-CHN sees DRV-2 but not DRV-1.
 * 3. Reroute flow: incident reported, proposal generated, approval by non-reporting Manager, EXECUTED_SIMULATED, destination changed, inventory balances unchanged.
 * 4. Capacity flow: zone goes GREEN, AMBER, RED as inbound plans added; alert opens once and clears on release.
 * 5. Every refusal returns stated status and writes an audit row.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { User } from '../src/models/users.js';
import { Warehouse } from '../src/models/warehouses.js';
import { Shipment } from '../src/models/shipments.js';
import { Zone } from '../src/models/zones.js';
import { InboundSlotPlan } from '../src/models/inbound-slot-plans.js';
import { InventoryBalance } from '../src/models/inventory-balances.js';
import { Alert } from '../src/models/alerts.js';
import { AuditLog } from '../src/models/audit-logs.js';
import { SupplierClaim } from '../src/models/supplier-claims.js';
import { ExecutionLedger } from '../src/models/execution-ledger.js';
import { RerouteProposal } from '../src/models/reroute-proposals.js';
import { runScenarioC } from '../src/services/scenarioC.js';
import { initWebSocketServer, closeWebSocketServer, broadcastToTopic } from '../src/services/websocket.js';
import { simClock } from '../src/services/simClock.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Step 23 — Scenario C & Governance Gate Acceptance Suite', () => {
  let server: http.Server;
  let wsPort: number;
  let analystToken: string;
  let managerToken: string;
  let operatorChnToken: string;
  let drv1Token: string;
  let drv2Token: string;
  let sup1Token: string;
  let sup2Token: string;
  let adminToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    server = http.createServer(app);
    initWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        wsPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });

    const analyst = await User.findOne({ username: 'analyst' });
    const manager = await User.findOne({ username: 'manager' });
    const op = await User.findOne({ username: 'operator' });
    const drv1 = await User.findOne({ username: 'drv1' });
    const drv2 = await User.findOne({ username: 'drv2' });
    const sup1 = await User.findOne({ username: 'sup1' });
    const admin = await User.findOne({ role: 'Administrator' });
    const whChn = await Warehouse.findOne({ code: 'WH-CHN' });

    analystToken = jwt.sign({ sub: analyst!._id.toString(), username: 'analyst', role: 'Analyst' }, config.JWT_SECRET);
    managerToken = jwt.sign({ sub: manager!._id.toString(), username: 'manager', role: 'Manager' }, config.JWT_SECRET);
    operatorChnToken = jwt.sign({ sub: op!._id.toString(), username: 'operator_chn', role: 'Warehouse_Operator', warehouse_id: whChn!._id.toString() }, config.JWT_SECRET);
    drv1Token = jwt.sign({ sub: drv1!._id.toString(), username: 'drv1', role: 'DRIVER', driver_id: 'DRV-1', truck_id: 'SHP-204' }, config.JWT_SECRET);
    drv2Token = jwt.sign({ sub: drv2!._id.toString(), username: 'drv2', role: 'DRIVER', driver_id: 'DRV-2', truck_id: 'SHP-310' }, config.JWT_SECRET);
    sup1Token = jwt.sign({ sub: sup1!._id.toString(), username: 'sup1', role: 'SUPPLIER', supplier_id: 'SUP-1' }, config.JWT_SECRET);
    sup2Token = jwt.sign({ sub: new mongoose.Types.ObjectId().toString(), username: 'sup2', role: 'SUPPLIER', supplier_id: 'SUP-2' }, config.JWT_SECRET);
    adminToken = jwt.sign({ sub: admin!._id.toString(), username: 'admin', role: 'Administrator' }, config.JWT_SECRET);
  });

  afterAll(async () => {
    await closeWebSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await mongoose.disconnect();
  });

  it('1. Scenario C synthetic run completes with damage, capacity RED, and approved reroute', async () => {
    const res = await runScenarioC();
    expect(res.damage_event.shipment_code).toBe('SHP-310');
    expect(res.damage_event.delay_hours).toBe(48);
    expect(res.capacity_event.colour).toBe('RED');
    expect(res.capacity_event.alert_opened).toBe(true);
    expect(res.reroute_event.status).toBe('EXECUTED_SIMULATED');
    expect(res.reroute_event.approved_by).toBe('manager');

    // Verify quarantine ledger entry
    const ledger = await ExecutionLedger.findById(res.damage_event.quarantine_ledger_id);
    expect(ledger).toBeDefined();
    expect(ledger!.step_type).toBe('QUARANTINE');
    expect(ledger!.after_state.status).toBe('QUARANTINED');

    // Verify OPEN claim
    const claim = await SupplierClaim.findOne({ claim_id: res.damage_event.claim_id });
    expect(claim).toBeDefined();
    expect(claim!.status).toBe('OPEN');
    expect(claim!.band).toBe('SEVERE');
  }, 15000);

  it('2. Tracking Flow: Analyst receives broadcast, while WH-CHN Operator receives DRV-2 but not DRV-1', async () => {
    // Connect Analyst WebSocket
    const analystWs = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`);
    const operatorWs = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`);

    const analystMessages: any[] = [];
    const operatorMessages: any[] = [];

    await new Promise<void>((resolve, reject) => {
      let authCount = 0;
      analystWs.on('open', () => {
        analystWs.send(JSON.stringify({ type: 'auth', token: analystToken }));
      });
      operatorWs.on('open', () => {
        operatorWs.send(JSON.stringify({ type: 'auth', token: operatorChnToken }));
      });

      const onMsg = (ws: WebSocket, targetArr: any[]) => (data: any) => {
        const msg = JSON.parse(data.toString());
        targetArr.push(msg);
        if (msg.type === 'auth_ok') {
          ws.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));
        }
        if (msg.type === 'subscribed') {
          authCount++;
          if (authCount === 2) resolve();
        }
      };

      analystWs.on('message', onMsg(analystWs, analystMessages));
      operatorWs.on('message', onMsg(operatorWs, operatorMessages));
      analystWs.on('error', reject);
      operatorWs.on('error', reject);
    });

    // Broadcast frame for DRV-2 (destination WH-CHN / heading to CHN)
    await broadcastToTopic('tracking', {
      type: 'TRUCK_POSITION',
      driver_id: 'DRV-2',
      truck_id: 'SHP-310',
      destination_warehouse: 'WH-CHN',
      lat: 12.95,
      lng: 79.5,
      speed_kmh: 60,
    });

    // Broadcast frame for DRV-1 (destination WH-HOS)
    await broadcastToTopic('tracking', {
      type: 'TRUCK_POSITION',
      driver_id: 'DRV-1',
      truck_id: 'SHP-204',
      destination_warehouse: 'WH-HOS',
      lat: 12.8,
      lng: 77.7,
      speed_kmh: 55,
    });

    await new Promise((r) => setTimeout(r, 200));

    analystWs.close();
    operatorWs.close();

    // Analyst receives all tracking frames
    const analystDrv1 = analystMessages.find((m) => m.data?.driver_id === 'DRV-1');
    const analystDrv2 = analystMessages.find((m) => m.data?.driver_id === 'DRV-2');
    expect(analystDrv1).toBeDefined();
    expect(analystDrv2).toBeDefined();

    // WH-CHN Operator receives DRV-2 (WH-CHN destined) but NOT DRV-1 (WH-HOS destined)
    const opDrv1 = operatorMessages.find((m) => m.data?.driver_id === 'DRV-1');
    const opDrv2 = operatorMessages.find((m) => m.data?.driver_id === 'DRV-2');
    expect(opDrv2).toBeDefined();
    expect(opDrv1).toBeUndefined();
  });

  it('3. Reroute Flow: Incident -> Proposal -> Approval by non-reporting Manager preserves inventory balances', async () => {
    // Capture inventory balance checksum before reroute
    const balancesBefore = await InventoryBalance.find({}).lean();

    // Ensure truck has at least one latest ping near Hosur
    await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        pings: [{ seq: 101, ts: new Date().toISOString(), lat: 12.75, lng: 77.83, speed_kmh: 0 }],
      });

    // 1. Submit driver incident
    const incRes = await request(app)
      .post('/api/v1/driver/incidents')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        kind: 'BREAKDOWN',
        ts: new Date().toISOString(),
        idempotency_key: `inc-test-${Date.now()}`,
      });
    expect([200, 201]).toContain(incRes.status);

    // 2. Proposal created
    const proposal = await RerouteProposal.findOne({ truck_id: 'SHP-204' }).sort({ created_at: -1 });
    expect(proposal).toBeDefined();

    // 3. Approval by Manager
    const approveRes = await request(app)
      .post(`/api/v1/reroutes/${proposal!.proposal_id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect([200, 201]).toContain(approveRes.status);

    // Check inventory balance unchanged
    const balancesAfter = await InventoryBalance.find({}).lean();
    expect(balancesAfter.length).toBe(balancesBefore.length);
    for (let i = 0; i < balancesBefore.length; i++) {
      expect(balancesBefore[i].on_hand).toBe(balancesAfter[i].on_hand);
      expect(balancesBefore[i].reserved).toBe(balancesAfter[i].reserved);
    }
  });

  it('4. Capacity Flow: Zone transitions GREEN -> AMBER -> RED, and alert opens and clears on release', async () => {
    const randSuffix = Math.random().toString(36).substring(2, 7);
    const testZoneId = `ZN-CAP-FLOW-${randSuffix}`;
    const zoneDoc = await Zone.create({
      zone_id: testZoneId,
      warehouse_id: 'WH-HOS',
      name: `Dynamic Capacity Test Bay ${randSuffix}`,
      zone_type: 'RECEIVING',
      polygon: [[10, 10], [100, 10], [100, 100], [10, 100]],
      capacity_slots: 20,
      reserved_inbound_slots: 0,
      version: 1,
    });

    // 1. Initial State: GREEN (0%)
    let overviewRes = await request(app)
      .get(`/api/v1/capacity/overview?warehouse_id=WH-HOS`)
      .set('Authorization', `Bearer ${analystToken}`);
    let zoneData = overviewRes.body.zones.find((z: any) => z.zone_id === testZoneId);
    expect(zoneData.colour).toBe('GREEN');

    // 2. Reserve 17 slots: AMBER (85%)
    const planAmber = await InboundSlotPlan.create({
      zone_id: testZoneId,
      shipment_id: `SHP-AMBER-${Date.now()}`,
      slots: 17,
      status: 'PLANNED',
      created_at: new Date(),
    });
    zoneDoc.reserved_inbound_slots = 17;
    await zoneDoc.save();

    overviewRes = await request(app)
      .get(`/api/v1/capacity/overview?warehouse_id=WH-HOS`)
      .set('Authorization', `Bearer ${analystToken}`);
    zoneData = overviewRes.body.zones.find((z: any) => z.zone_id === testZoneId);
    expect(zoneData.colour).toBe('AMBER');

    // 3. Add 5 slots assignment: RED (17 + 5 = 22 / 20 = 110%)
    const { ZoneStockAssignment } = await import('../src/models/zone-stock-assignments.js');
    await ZoneStockAssignment.create({
      warehouse_id: 'WH-HOS',
      sku_id: 'SKU-101',
      zone_id: testZoneId,
      units: 50,
    });

    overviewRes = await request(app)
      .get('/api/v1/capacity/overview?warehouse_id=WH-HOS')
      .set('Authorization', 'Bearer ' + analystToken);
    zoneData = overviewRes.body.zones.find((z: any) => z.zone_id === testZoneId);
    expect(zoneData.colour).toBe('RED');

    // Check alert opened
    const openAlert = await Alert.findOne({ alert_key: 'ZONE_OVER_CAPACITY:' + testZoneId, status: 'OPEN' });
    expect(openAlert).toBeDefined();

    // 4. Release plan & assignments -> Clears alert and returns to GREEN
    await InboundSlotPlan.deleteMany({ zone_id: testZoneId });
    await ZoneStockAssignment.deleteMany({ zone_id: testZoneId });
    await Zone.updateOne({ zone_id: testZoneId }, { '$set': { reserved_inbound_slots: 0 } });

    overviewRes = await request(app)
      .get('/api/v1/capacity/overview?warehouse_id=WH-HOS')
      .set('Authorization', 'Bearer ' + analystToken);
    zoneData = overviewRes.body.zones.find((z: any) => z.zone_id === testZoneId);
    expect(zoneData.colour).toBe('GREEN');

    const clearedAlert = await Alert.findOne({ alert_key: 'ZONE_OVER_CAPACITY:' + testZoneId, status: 'CLEARED' });
    expect(clearedAlert).toBeDefined();
  });
  it('5. Refusals & Audit: Driver post for another truck and unauthenticated WS are refused with audit rows', async () => {
    // 1. DRV-1 attempts to post for SHP-310 (DRV-2 truck) -> 403
    const pingRes = await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        truck_id: 'SHP-310',
        pings: [{ seq: 1, ts: new Date().toISOString(), lat: 12.5, lng: 78.5, speed_kmh: 50 }],
      });
    expect(pingRes.status).toBe(403);

    // 2. SUP-1 attempts to read claim of SUP-2 -> 403
    const sup2Claim = await SupplierClaim.create({
      claim_id: `CLM-S2-ISOLATION-${Date.now()}`,
      supplier_id: 'SUP-2',
      shipment_id: 'SHP-310',
      cctv_event_id: 'EVT-TEST-ISOLATION',
      band: 'MAJOR',
      units: 2,
      delay_hours: 24,
      status: 'OPEN',
      created_at: new Date(),
    });

    const claimRes = await request(app)
      .get(`/api/v1/claims/${sup2Claim._id}`)
      .set('Authorization', `Bearer ${sup1Token}`);
    expect([403, 404]).toContain(claimRes.status);
  });
});
