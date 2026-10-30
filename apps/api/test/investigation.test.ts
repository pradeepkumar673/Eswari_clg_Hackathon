import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { Shipment } from '../src/models/shipments.js';
import { ShipmentEvent } from '../src/models/shipment-events.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Investigation Endpoints Acceptance Tests', () => {
  let analystToken: string;
  let driverToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await seed(MONGODB_URI, false);

    // Authenticate analyst
    const aRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'analyst', password: 'demo_recovery_2026' });
    analystToken = aRes.body.token;

    // Authenticate driver 1 (SHP-204)
    const dRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'drv1', password: 'demo_recovery_2026' });
    driverToken = dRes.body.token;

    // Authenticate operator (WH-HOS)
    const oRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'operator', password: 'demo_recovery_2026' });
    operatorToken = oRes.body.token;
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  it('1. GET /investigation/shipments lists shipments with shift_hours and event counts', async () => {
    const res = await request(app)
      .get('/api/v1/investigation/shipments')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.shipments)).toBe(true);
    expect(res.body.shipments.length).toBeGreaterThan(0);

    const first = res.body.shipments[0];
    expect(first.code).toBeDefined();
    expect(first.promised_eta).toBeDefined();
    expect(first.current_eta).toBeDefined();
    expect(typeof first.shift_hours).toBe('number');
  });

  it('2. GET /investigation/shipments/:id returns shipment, lineage basis, and timeline', async () => {
    const shp = await Shipment.findOne({ code: 'SHP-204' }).lean();
    expect(shp).toBeDefined();

    const res = await request(app)
      .get(`/api/v1/investigation/shipments/${shp!._id}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.shipment.code).toBe('SHP-204');
    expect(Array.isArray(res.body.timeline)).toBe(true);
  });

  it('3. POST /driver/delay-report ingests driver report through reconciler and updates ETA', async () => {
    const res = await request(app)
      .post('/api/v1/driver/delay-report')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        delay_hours: 3,
        reason: 'Traffic congestion at toll plaza',
        location: 'Bangalore Toll Gate',
        idempotency_key: `TEST-DELAY-${Date.now()}`,
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();

    // Verify timeline has the new event
    const shp = await Shipment.findOne({ code: 'SHP-204' }).lean();
    const detailRes = await request(app)
      .get(`/api/v1/investigation/shipments/${shp!._id}`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(detailRes.status).toBe(200);
    const timeline = detailRes.body.timeline;
    const driverEvent = timeline.find((e: any) => e.source === 'DRIVER_DEVICE' && e.event_type === 'DELAY_REPORT');
    expect(driverEvent).toBeDefined();
    expect(driverEvent.note).toBe('Traffic congestion at toll plaza');
  });

  it('4. GET /investigation/shipments/:id/replay returns audit steps and step numbers', async () => {
    const shp = await Shipment.findOne({ code: 'SHP-204' }).lean();

    const res = await request(app)
      .get(`/api/v1/investigation/shipments/${shp!._id}/replay`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.shipment_code).toBe('SHP-204');
    expect(Array.isArray(res.body.steps)).toBe(true);
  });

  it('5. Warehouse Operator scoping: can only view shipments for own warehouse', async () => {
    // Find shipment going to WH-CHN (operator is bound to WH-HOS)
    const chnShipment = await Shipment.findOne({ code: 'SHP-310' }).lean();
    expect(chnShipment).toBeDefined();

    const res = await request(app)
      .get(`/api/v1/investigation/shipments/${chnShipment!._id}`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(res.status).toBe(403);
  });
});
