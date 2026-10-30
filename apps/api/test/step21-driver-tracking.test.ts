/**
 * apps/api/test/step21-driver-tracking.test.ts
 *
 * Vitest Acceptance Suite for Step 21 — Live Driver Tracking, Graph Dijkstra,
 * Incident Proposals, Manager Approval & Geofencing.
 *
 * Test Requirements:
 * 1. Nearest warehouse equals hand-computed Dijkstra values:
 *    truck on lane BLR to CHN, 100 km from BLR -> WH-BLR 100km, WH-HOS 140km, WH-CHN 250km.
 *    Expected nearest: WH-BLR, 100 km.
 * 2. OFF_NETWORK gives STRAIGHT_LINE_ESTIMATE and no proposal.
 * 3. Ten pings sent shuffled and then resent: exactly ten stored in seq order, duplicates reported.
 * 4. Driver posting for another truck: 403. Driver socket never receives another truck's frame.
 * 5. Incident creates one PENDING proposal and does not change the destination.
 * 6. Reporter approving their own proposal: 403. Administrator: 403. Operator: 403.
 * 7. Manager approval: EXECUTED_SIMULATED, destination changed, one ledger entry, inventory_balances unchanged (deep-equal).
 * 8. Moved truck: proposal STALE, approval 409.
 * 9. Ten pings inside the radius: exactly one ARRIVED_GEOFENCE.
 * 10. Five parallel incidents with the same idempotency_key: exactly one proposal.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
import { TransferLane } from '../src/models/transfer-lanes.js';
import { DriverPing } from '../src/models/driver-pings.js';
import { DriverIncident } from '../src/models/driver-incidents.js';
import { RerouteProposal } from '../src/models/reroute-proposals.js';
import { ExecutionLedger } from '../src/models/execution-ledger.js';
import { InventoryBalance } from '../src/models/inventory-balances.js';
import { Shipment } from '../src/models/shipments.js';
import { ShipmentEvent } from '../src/models/shipment-events.js';
import { findNearestWarehouse } from '../src/services/nearestWarehouse.js';
import {
  initWebSocketServer,
  closeWebSocketServer,
  broadcastToTopic,
} from '../src/services/websocket.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Step 21 — Live Driver Tracking, Dijkstra Graph & Governed Reroutes', () => {
  let server: http.Server;
  let wsPort: number;

  let drv1Token: string;
  let drv2Token: string;
  let managerToken: string;
  let adminToken: string;
  let operatorHosToken: string;
  let operatorBlrToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    // Start ephemeral HTTP server with WebSocket support for tests
    server = http.createServer(app);
    initWebSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as AddressInfo;
        wsPort = addr.port;
        resolve();
      });
    });

    // Seeded Users
    const drv1 = await User.findOne({ username: 'drv1' });
    const drv2 = await User.findOne({ username: 'drv2' });
    const manager = await User.findOne({ username: 'manager' });
    const admin = await User.findOne({ username: 'admin' });
    const opHos = await User.findOne({ username: 'operator' });

    drv1Token = jwt.sign(
      { sub: drv1!._id, username: drv1!.username, role: drv1!.role, driver_id: drv1!.driver_id, truck_id: drv1!.truck_id },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
    drv2Token = jwt.sign(
      { sub: drv2!._id, username: drv2!.username, role: drv2!.role, driver_id: drv2!.driver_id, truck_id: drv2!.truck_id },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
    managerToken = jwt.sign(
      { sub: manager!._id, username: manager!.username, role: manager!.role },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
    adminToken = jwt.sign(
      { sub: admin!._id, username: admin!.username, role: admin!.role },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
    operatorHosToken = jwt.sign(
      { sub: opHos!._id, username: opHos!.username, role: opHos!.role, warehouse_id: opHos!.warehouse_id },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    await closeWebSocketServer();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // ---------------------------------------------------------------------------
  // 1. Hand-computed Dijkstra Test
  // ---------------------------------------------------------------------------
  it('1. Nearest warehouse equals hand-computed values (truck on lane BLR to CHN, 100 km from BLR)', async () => {
    /**
     * Hand-computed proof:
     * Nodes: WH-BLR, WH-CHN, WH-HOS
     * Lanes:
     *   BLR <-> HOS = 40 km
     *   CHN <-> HOS = 300 km
     *   BLR <-> CHN = 350 km
     * Truck position: on lane BLR->CHN, 100 km from BLR.
     * Distance to BLR end = 100 km
     * Distance to CHN end = 350 - 100 = 250 km
     * Paths from truck to warehouses:
     *   WH-BLR: 100 km (direct to BLR node)
     *   WH-HOS: 100 km + 40 km (via BLR) = 140 km
     *   WH-CHN: 250 km (direct to CHN node)
     * Expected nearest: WH-BLR with road_km = 100.
     */
    const blr = await Warehouse.findOne({ code: 'WH-BLR' });
    const chn = await Warehouse.findOne({ code: 'WH-CHN' });
    const hos = await Warehouse.findOne({ code: 'WH-HOS' });
    expect(blr).toBeDefined();
    expect(chn).toBeDefined();
    expect(hos).toBeDefined();

    const lane = await TransferLane.findOne({
      from_warehouse_id: blr!._id,
      to_warehouse_id: chn!._id,
    });
    expect(lane).toBeDefined();

    const result = await findNearestWarehouse({
      lane_id: lane!._id.toString(),
      km_on_lane: 100,
    });

    expect(result.method).toBe('ROAD_GRAPH');
    expect(result.nearest_warehouse_code).toBe('WH-BLR');
    expect(result.road_km).toBe(100);
    expect(result.distances['WH-BLR']).toBe(100);
    expect(result.distances['WH-HOS']).toBe(140);
    expect(result.distances['WH-CHN']).toBe(250);
  });

  // ---------------------------------------------------------------------------
  // 2. OFF_NETWORK Straight-Line Estimate
  // ---------------------------------------------------------------------------
  it('2. OFF_NETWORK gives STRAIGHT_LINE_ESTIMATE and no route proposal', async () => {
    /**
     * Truck far off the highway network:
     * Lat: 12.0000, Lng: 79.0000 (Tiruvannamalai area, > 50km from any lane)
     * Result must use method: 'STRAIGHT_LINE_ESTIMATE'
     * path must be empty (no road route proposed)
     */
    const result = await findNearestWarehouse({
      lat: 12.0,
      lng: 79.0,
      lane_id: null,
      km_on_lane: null,
    });

    expect(result.method).toBe('STRAIGHT_LINE_ESTIMATE');
    expect(result.nearest_warehouse_code).toBeDefined();
    expect(result.road_km).toBeGreaterThan(0);
    expect(result.path).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // 3. Shuffled Pings & Resend Deduping
  // ---------------------------------------------------------------------------
  it('3. Ten pings sent shuffled and then resent: exactly ten stored in seq order', async () => {
    // Clear any test pings for DRV-1
    await DriverPing.deleteMany({ driver_id: 'DRV-1' });

    // Generate 10 pings with seq 1..10 near WH-HOS
    const pings = Array.from({ length: 10 }, (_, i) => ({
      seq: i + 1,
      ts: new Date(Date.now() + i * 1000).toISOString(),
      lat: 12.7409 + i * 0.001,
      lng: 77.8253 + i * 0.001,
      speed_kmh: 55,
    }));

    // Shuffle pings
    const shuffled = [...pings].sort(() => Math.random() - 0.5);

    // Send shuffled batch
    const postRes1 = await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({ pings: shuffled });

    expect(postRes1.status).toBe(200);
    expect(postRes1.body.accepted).toBe(10);
    expect(postRes1.body.duplicates).toBe(0);

    // Resend the exact same pings: must report duplicates and not error
    const postRes2 = await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({ pings });

    expect(postRes2.status).toBe(200);
    expect(postRes2.body.accepted).toBe(0);
    expect(postRes2.body.duplicates).toBe(10);

    // Query Mongo: exactly 10 stored, strictly ascending by seq
    const storedPings = await DriverPing.find({ driver_id: 'DRV-1' }).sort({ seq: 1 }).lean();
    expect(storedPings).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(storedPings[i].seq).toBe(i + 1);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. Driver Scoping & WebSocket Isolation
  // ---------------------------------------------------------------------------
  it('4. Driver posting for another truck returns 403; driver socket never receives another truck frame', async () => {
    // DRV-1 attempts to submit ping for truck SHP-310 (DRV-2's truck)
    const badPingRes = await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        truck_id: 'SHP-310',
        pings: [{ seq: 999, ts: new Date().toISOString(), lat: 13.0, lng: 80.0, speed_kmh: 40 }],
      });

    expect(badPingRes.status).toBe(403);

    // WebSocket Test: Connect DRV-1 socket, broadcast SHP-310 position, verify DRV-1 does not receive it
    const wsUrl = `ws://127.0.0.1:${wsPort}/ws`;
    const client = new WebSocket(wsUrl);

    const receivedMessages: any[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on('open', () => {
        client.send(JSON.stringify({ type: 'auth', token: drv1Token }));
      });

      client.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        receivedMessages.push(msg);
        if (msg.type === 'auth_ok') {
          client.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));
        }
        if (msg.type === 'subscribed') {
          resolve();
        }
      });
      client.on('error', reject);
    });

    // Broadcast frame for SHP-310 (DRV-2's truck)
    await broadcastToTopic('tracking', {
      type: 'TRUCK_POSITION',
      driver_id: 'DRV-2',
      truck_id: 'SHP-310',
      lat: 13.0827,
      lng: 80.2707,
      speed_kmh: 45,
    });

    // Small delay to ensure no packet arrives
    await new Promise((r) => setTimeout(r, 200));

    const leakedMessage = receivedMessages.find(
      (m) => m.type === 'event' && m.data?.truck_id === 'SHP-310',
    );
    expect(leakedMessage).toBeUndefined();

    client.close();
  });

  // ---------------------------------------------------------------------------
  // 5. Incident Reporting & Pending Proposal
  // ---------------------------------------------------------------------------
  it('5. Incident creates one PENDING proposal and does not change the destination', async () => {
    const shipmentBefore = await Shipment.findOne({ code: 'SHP-204' }).lean();
    const initialDest = shipmentBefore!.warehouse_id.toString();

    // Ensure truck has at least one latest ping near Hosur
    await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        pings: [{ seq: 100, ts: new Date().toISOString(), lat: 12.75, lng: 77.83, speed_kmh: 0 }],
      });

    const idempotencyKey = `INCIDENT-TEST-${Date.now()}`;
    const incidentRes = await request(app)
      .post('/api/v1/driver/incidents')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        kind: 'BREAKDOWN',
        idempotency_key: idempotencyKey,
        ts: new Date().toISOString(),
      });

    expect(incidentRes.status).toBe(201);
    expect(incidentRes.body.incident).toBeDefined();
    expect(incidentRes.body.proposal).toBeDefined();
    expect(incidentRes.body.proposal.status).toBe('PENDING');

    // Verify destination was NOT modified
    const shipmentAfter = await Shipment.findOne({ code: 'SHP-204' }).lean();
    expect(shipmentAfter!.warehouse_id.toString()).toBe(initialDest);
  });

  // ---------------------------------------------------------------------------
  // 6. Separation of Duties on Reroute Approval
  // ---------------------------------------------------------------------------
  it('6. Reporter approving own proposal returns 403; Admin returns 403; Operator returns 403', async () => {
    // Create a fresh proposal for testing approvals
    const proposal = await RerouteProposal.create({
      proposal_id: `PROP-${Date.now()}`,
      truck_id: 'SHP-204',
      from_position: { seq: 100, lat: 12.75, lng: 77.83, lane_id: 'LANE-1', km_on_lane: 20 },
      nearest_warehouse_id: 'WH-HOS',
      road_km: 15,
      method: 'ROAD_GRAPH',
      status: 'PENDING',
      proposed_by: 'drv1',
      reason: 'BREAKDOWN',
      created_at: new Date(),
    });

    // 1. Reporter (drv1) attempts to approve
    const reporterRes = await request(app)
      .post(`/api/v1/reroutes/${proposal.proposal_id}/approve`)
      .set('Authorization', `Bearer ${drv1Token}`);
    expect(reporterRes.status).toBe(403);

    // 2. Administrator attempts to approve (only Supply Chain Manager can approve)
    const adminRes = await request(app)
      .post(`/api/v1/reroutes/${proposal.proposal_id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminRes.status).toBe(403);

    // 3. Warehouse Operator attempts to approve
    const opRes = await request(app)
      .post(`/api/v1/reroutes/${proposal.proposal_id}/approve`)
      .set('Authorization', `Bearer ${operatorHosToken}`);
    expect(opRes.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // 7. Manager Approval & Zero Inventory Change
  // ---------------------------------------------------------------------------
  it('7. Manager approval: EXECUTED_SIMULATED, destination changed, ledger entry, inventory_balances unchanged', async () => {
    const balancesBefore = await InventoryBalance.find({}).lean();

    // Create proposal to reroute SHP-204 to WH-BLR
    const blr = await Warehouse.findOne({ code: 'WH-BLR' });
    const proposal = await RerouteProposal.create({
      proposal_id: `PROP-APPR-${Date.now()}`,
      truck_id: 'SHP-204',
      from_position: { seq: 100, lat: 12.75, lng: 77.83, lane_id: 'LANE-1', km_on_lane: 20 },
      nearest_warehouse_id: 'WH-BLR',
      road_km: 35,
      method: 'ROAD_GRAPH',
      status: 'PENDING',
      proposed_by: 'system',
      reason: 'ACCIDENT',
      created_at: new Date(),
    });

    const approveRes = await request(app)
      .post(`/api/v1/reroutes/${proposal.proposal_id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.proposal.status).toBe('EXECUTED_SIMULATED');

    // Verify shipment destination changed to WH-BLR
    const shipmentAfter = await Shipment.findOne({ code: 'SHP-204' });
    expect(shipmentAfter!.warehouse_id.toString()).toBe(blr!._id.toString());

    // Verify execution_ledger entry
    const ledgerEntry = await ExecutionLedger.findOne({ step_type: 'REROUTE_SIMULATED' }).sort({ seq: -1 });
    expect(ledgerEntry).toBeDefined();
    expect(ledgerEntry!.before_state.destination).toBeDefined();
    expect(ledgerEntry!.after_state.destination).toBe(blr!._id.toString());

    // Verify inventory balances remain untouched (deep equal)
    const balancesAfter = await InventoryBalance.find({}).lean();
    expect(balancesAfter.map((b) => ({ id: b._id.toString(), on_hand: b.on_hand })))
      .toEqual(balancesBefore.map((b) => ({ id: b._id.toString(), on_hand: b.on_hand })));
  });

  // ---------------------------------------------------------------------------
  // 8. Moved Truck Makes Proposal STALE (409)
  // ---------------------------------------------------------------------------
  it('8. Moved truck: proposal becomes STALE, approval returns 409', async () => {
    // Create proposal at seq 100
    const proposal = await RerouteProposal.create({
      proposal_id: `PROP-MOVE-${Date.now()}`,
      truck_id: 'SHP-204',
      from_position: { seq: 100, lat: 12.75, lng: 77.83, lane_id: 'LANE-1', km_on_lane: 20 },
      nearest_warehouse_id: 'WH-HOS',
      road_km: 15,
      method: 'ROAD_GRAPH',
      status: 'PENDING',
      proposed_by: 'system',
      reason: 'BREAKDOWN',
      created_at: new Date(),
    });

    // Driver moves! Post ping seq 105
    await request(app)
      .post('/api/v1/driver/pings')
      .set('Authorization', `Bearer ${drv1Token}`)
      .send({
        pings: [{ seq: 105, ts: new Date().toISOString(), lat: 12.80, lng: 77.85, speed_kmh: 50 }],
      });

    // Manager attempts to approve outdated proposal
    const approveRes = await request(app)
      .post(`/api/v1/reroutes/${proposal.proposal_id}/approve`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(approveRes.status).toBe(409);
    expect(approveRes.body.status).toBe('STALE');

    // Confirm proposal in DB is marked STALE
    const updatedProp = await RerouteProposal.findOne({ proposal_id: proposal.proposal_id });
    expect(updatedProp!.status).toBe('STALE');
  });

  // ---------------------------------------------------------------------------
  // 9. Geofence Arrival Event
  // ---------------------------------------------------------------------------
  it('9. Ten pings inside the geofence radius: exactly one ARRIVED_GEOFENCE event', async () => {
    const shipment = await Shipment.findOne({ code: 'SHP-204' }).populate('warehouse_id');
    const wh = shipment!.warehouse_id as any;

    // Send 10 pings strictly inside WH-HOS coordinates (within 50 meters)
    const insidePings = Array.from({ length: 10 }, (_, i) => ({
      seq: 200 + i,
      ts: new Date(Date.now() + i * 1000).toISOString(),
      lat: wh.lat + 0.0001 * i, // ~11 meters per 0.0001 deg
      lng: wh.lng + 0.0001 * i,
      speed_kmh: 10,
    }));

    for (const p of insidePings) {
      const res = await request(app)
        .post('/api/v1/driver/pings')
        .set('Authorization', `Bearer ${drv1Token}`)
        .send({ pings: [p] });
      expect(res.status).toBe(200);
    }

    // Exactly one ARRIVED_GEOFENCE event written for SHP-204
    const arrivedEvents = await ShipmentEvent.find({
      shipment_id: shipment!._id,
      event_type: 'ARRIVED_GEOFENCE',
    });

    expect(arrivedEvents).toHaveLength(1);
    expect(arrivedEvents[0].event_type).toBe('ARRIVED_GEOFENCE');
  });

  // ---------------------------------------------------------------------------
  // 10. Idempotent Incidents
  // ---------------------------------------------------------------------------
  it('10. Five parallel incidents with the same idempotency_key create exactly one proposal', async () => {
    const idempotencyKey = `CONCURRENT-KEY-${Date.now()}`;

    const requests = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/v1/driver/incidents')
        .set('Authorization', `Bearer ${drv1Token}`)
        .send({
          kind: 'ACCIDENT',
          idempotency_key: idempotencyKey,
          ts: new Date().toISOString(),
        }),
    );

    const responses = await Promise.all(requests);

    // All return success (either 201 or 200/201 idempotent)
    for (const res of responses) {
      expect([200, 201]).toContain(res.status);
    }

    // Exactly one DriverIncident document
    const incidents = await DriverIncident.find({ idempotency_key: idempotencyKey });
    expect(incidents).toHaveLength(1);

    // Exactly one proposal created for this incident
    const proposals = await RerouteProposal.find({ reason: { $regex: idempotencyKey } });
    expect(proposals).toHaveLength(1);
  });
});
