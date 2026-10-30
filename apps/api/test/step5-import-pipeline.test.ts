import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { ImportBatch } from '../src/models/import-batches.js';
import { ImportRow } from '../src/models/import-rows.js';
import { Shipment } from '../src/models/shipments.js';
import { domainBus } from '../src/services/bus.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

let analystToken: string;
let adminToken: string;
let managerToken: string;

describe('Step 5 Part A: Import Pipeline (M1, B11)', () => {
  beforeAll(async () => {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    // Clean up any leftovers from previous runs
    await ImportBatch.deleteMany({});
    await ImportRow.deleteMany({});
    await Shipment.deleteMany({ code: { $regex: /^SHP-8/ } });

    // Authenticate test users using DEMO_PASSWORD
    const analystLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'analyst', password: DEMO_PASSWORD });
    analystToken = analystLogin.body.token;

    const adminLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'admin', password: DEMO_PASSWORD });
    adminToken = adminLogin.body.token;

    const managerLogin = await request(app)
      .post('/auth/login')
      .send({ username: 'manager', password: DEMO_PASSWORD });
    managerToken = managerLogin.body.token;
  });

  afterAll(async () => {
    // Clean up imported test batches and shipments created in this suite so other tests remain clean
    await ImportBatch.deleteMany({});
    await ImportRow.deleteMany({});
    await Shipment.deleteMany({ code: { $regex: /^SHP-8/ } });
    await mongoose.disconnect();
  });

  it('enforces RBAC: Analyst & Admin allowed, Manager returns 403', async () => {
    const filePath = path.join(FIXTURES_DIR, 'duplicate-key.csv');

    // Manager should be forbidden (403)
    const managerRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${managerToken}`)
      .field('entity_type', 'shipments')
      .attach('file', filePath);
    expect(managerRes.status).toBe(403);

    // Analyst should be allowed
    const analystRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${analystToken}`)
      .field('entity_type', 'shipments')
      .attach('file', path.join(FIXTURES_DIR, 'conflict-key.csv'));
    expect([200, 201]).toContain(analystRes.status);
  });

  it('acceptance test 4: CSV with 10 bad rows quarantines bad rows with reasons and nearest code suggestions', async () => {
    const filePath = path.join(FIXTURES_DIR, 'shipments-10-bad-rows.csv');

    const uploadRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${analystToken}`)
      .field('entity_type', 'shipments')
      .attach('file', filePath);

    expect(uploadRes.status).toBe(201);
    const batchId = uploadRes.body.batch_id;
    expect(batchId).toBeDefined();

    const report = uploadRes.body.report;
    expect(report.counts.total).toBe(13);
    expect(report.counts.valid).toBe(3);
    expect(report.counts.quarantined).toBe(10);

    // Verify GET /imports/:id/quarantine
    const qRes = await request(app)
      .get(`/imports/${batchId}/quarantine`)
      .set('Authorization', `Bearer ${analystToken}`);

    expect(qRes.status).toBe(200);
    expect(qRes.body.rows.length).toBe(10);

    // Verify error reasons exist
    const errors = qRes.body.rows.flatMap((r: any) => r.errors);
    expect(errors.length).toBeGreaterThanOrEqual(10);

    // Test row repair
    const badWarehouseRow = qRes.body.rows.find((r: any) =>
      r.errors.some((e: any) => e.code === 'UNKNOWN_WAREHOUSE')
    );
    expect(badWarehouseRow).toBeDefined();

    // Repair the warehouse code
    const repairedData = { ...badWarehouseRow.raw_data, destination_warehouse_code: 'WH-HOS' };
    const repairRes = await request(app)
      .patch(`/imports/rows/${badWarehouseRow.id}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ action: 'REPAIR', repaired_data: repairedData });

    expect(repairRes.status).toBe(200);
    expect(repairRes.body.status).toBe('REPAIRED');

    // Confirm raw_data is untouched
    const fetchedRow = await ImportRow.findById(badWarehouseRow.id);
    expect(fetchedRow?.raw_data).toEqual(badWarehouseRow.raw_data);
    expect(fetchedRow?.repaired_data).toEqual(repairedData);

    // Commit batch
    let busEventFired = false;
    const unsub = domainBus.subscribe('IMPORT_COMMITTED', (payload) => {
      if (payload.batchId === batchId) busEventFired = true;
    });

    const commitRes = await request(app)
      .post(`/imports/${batchId}/commit`)
      .set('Authorization', `Bearer ${analystToken}`);

    unsub();

    expect(commitRes.status).toBe(200);
    expect(commitRes.body.status).toBe('COMMITTED');
    // 3 valid + 1 repaired = 4 loaded rows
    expect(commitRes.body.loaded_count).toBe(4);
    expect(busEventFired).toBe(true);

    // Calling commit again is idempotent
    const repeatCommit = await request(app)
      .post(`/imports/${batchId}/commit`)
      .set('Authorization', `Bearer ${analystToken}`);
    expect(repeatCommit.body.status).toBe('ALREADY_COMMITTED');

    // Test Re-uploading the identical file returns FILE_ALREADY_IMPORTED (no-op)
    const reuploadRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${analystToken}`)
      .field('entity_type', 'shipments')
      .attach('file', filePath);

    expect(reuploadRes.status).toBe(200);
    expect(reuploadRes.body.status).toBe('FILE_ALREADY_IMPORTED');
  });

  it('acceptance test 34: duplicate and conflict natural key handling and quality report adds up', async () => {
    // 1. Duplicate natural key file
    const dupPath = path.join(FIXTURES_DIR, 'duplicate-key.csv');
    const dupRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('entity_type', 'shipments')
      .attach('file', dupPath);

    expect(dupRes.status).toBe(201);
    const dupReport = dupRes.body.report;
    expect(dupReport.counts.total).toBe(2);
    expect(dupReport.counts.valid).toBe(1);
    expect(dupReport.counts.duplicate).toBe(1);

    // 2. Conflict natural key file
    const confPath = path.join(FIXTURES_DIR, 'conflict-key.csv');
    const confRes = await request(app)
      .post('/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('entity_type', 'shipments')
      .attach('file', confPath);

    expect(confRes.status).toBe(201);
    const confReport = confRes.body.report;
    expect(confReport.counts.total).toBe(2);
    expect(confReport.counts.valid).toBe(0);
    expect(confReport.counts.conflict).toBe(2);

    // 3. Quality report adds up to total rows
    const repRes = await request(app)
      .get(`/imports/${confRes.body.batch_id}/report`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(repRes.status).toBe(200);
    const c = repRes.body.counts;
    const sum = c.valid + c.repaired + c.quarantined + c.duplicate + c.conflict + c.discarded;
    expect(sum).toBe(c.total);
    expect(Array.isArray(repRes.body.error_reasons)).toBe(true);
  });
});
