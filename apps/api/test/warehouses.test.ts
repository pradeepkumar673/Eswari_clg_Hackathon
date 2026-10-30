import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { Warehouse } from '../src/models/warehouses.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Warehouse Master Management Acceptance Tests', () => {
  let adminToken: string;
  let managerToken: string;
  let driverToken: string;
  let analystToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await seed(MONGODB_URI, false);

    // Clean up test warehouse if left over
    await Warehouse.deleteMany({ code: { $in: ['WH-KRS', 'WH-TEST1'] } });

    // Authenticate admin
    const adminRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'demo_recovery_2026' });
    adminToken = adminRes.body.token;

    // Authenticate manager
    const mgrRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: 'demo_recovery_2026' });
    managerToken = mgrRes.body.token;

    // Authenticate analyst
    const aRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'analyst', password: 'demo_recovery_2026' });
    analystToken = aRes.body.token;

    // Authenticate driver
    const dRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'drv1', password: 'demo_recovery_2026' });
    driverToken = dRes.body.token;
  });

  afterAll(async () => {
    await Warehouse.deleteMany({ code: { $in: ['WH-KRS', 'WH-TEST1'] } });
    await mongoose.disconnect();
  });

  it('1. GET /warehouses is accessible to all roles including analyst and driver', async () => {
    const resA = await request(app)
      .get('/api/v1/warehouses')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(resA.status).toBe(200);
    expect(Array.isArray(resA.body)).toBe(true);
    expect(resA.body.length).toBeGreaterThanOrEqual(3);

    const resD = await request(app)
      .get('/api/v1/warehouses')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(resD.status).toBe(200);
    expect(Array.isArray(resD.body)).toBe(true);
    const codes = resD.body.map((w: any) => w.code);
    expect(codes).toContain('WH-HOS');
    expect(codes).toContain('WH-CHN');
    expect(codes).toContain('WH-BLR');
  });

  it('2. POST /warehouses validates code pattern and creates new warehouse', async () => {
    // Bad code
    const badRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        code: 'INVALID_CODE',
        name: 'Invalid Warehouse',
        lat: 12.5,
        lng: 78.2,
      });
    expect(badRes.status).toBe(400);

    // Good code WH-KRS
    const goodRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        code: 'WH-KRS',
        name: 'Krishnagiri Hub',
        lat: 12.5186,
        lng: 78.2137,
        processing_hours: 3,
        is_hub: true,
      });
    expect(goodRes.status).toBe(201);
    expect(goodRes.body.code).toBe('WH-KRS');
    expect(goodRes.body.name).toBe('Krishnagiri Hub');
    expect(goodRes.body.is_active).toBe(true);

    // Duplicate conflict
    const dupRes = await request(app)
      .post('/api/v1/warehouses')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        code: 'WH-KRS',
        name: 'Krishnagiri Hub',
        lat: 12.5186,
        lng: 78.2137,
      });
    expect(dupRes.status).toBe(409);
  });

  it('3. PUT /capacity/footprint/:code updates footprint and calculates centroid lat/lng', async () => {
    const polygon = [
      [12.5180, 78.2130],
      [12.5180, 78.2150],
      [12.5200, 78.2150],
      [12.5200, 78.2130],
    ];

    const res = await request(app)
      .put('/api/v1/capacity/footprint/WH-KRS')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ polygon });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const updated = await Warehouse.findOne({ code: 'WH-KRS' }).lean();
    expect(updated).toBeDefined();
    expect(updated?.footprint).toHaveLength(4);
    // Centroid lat: (12.518 + 12.518 + 12.520 + 12.520) / 4 = 12.519
    // Centroid lng: (78.213 + 78.215 + 78.215 + 78.213) / 4 = 78.214
    expect(updated?.lat).toBeCloseTo(12.519, 3);
    expect(updated?.lng).toBeCloseTo(78.214, 3);
  });

  it('4. PATCH /warehouses/:code updates warehouse fields and activation status', async () => {
    const patchRes = await request(app)
      .patch('/api/v1/warehouses/WH-KRS')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        name: 'Krishnagiri Regional Superhub',
        is_active: false,
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.name).toBe('Krishnagiri Regional Superhub');
    expect(patchRes.body.is_active).toBe(false);

    // Inactive warehouse is hidden by default
    const listRes = await request(app)
      .get('/api/v1/warehouses')
      .set('Authorization', `Bearer ${analystToken}`);
    const codes = listRes.body.map((w: any) => w.code);
    expect(codes).not.toContain('WH-KRS');

    // Admin can see inactive warehouses with include_inactive=true
    const adminListRes = await request(app)
      .get('/api/v1/warehouses?include_inactive=true')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminCodes = adminListRes.body.map((w: any) => w.code);
    expect(adminCodes).toContain('WH-KRS');
  });
});

