import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app.js';
import { seed } from '../src/services/seedData.js';
import { DriverIncident } from '../src/models/driver-incidents.js';
import { Notification } from '../src/models/notifications.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Live Driver Incidents & Breakdown Alert Acceptance Tests', () => {
  let driverToken: string;
  let driver2Token: string;
  let managerToken: string;
  let analystToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await seed(MONGODB_URI, false);

    // Authenticate driver 1 (DRV-1, SHP-204)
    const d1Res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'drv1', password: 'demo_recovery_2026' });
    driverToken = d1Res.body.token;

    // Authenticate driver 2 (DRV-2, SHP-310)
    const d2Res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'drv2', password: 'demo_recovery_2026' });
    driver2Token = d2Res.body.token;

    // Authenticate manager
    const mRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'manager', password: 'demo_recovery_2026' });
    managerToken = mRes.body.token;

    // Authenticate analyst
    const aRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'analyst', password: 'demo_recovery_2026' });
    analystToken = aRes.body.token;
  });

  afterAll(async () => {
    await DriverIncident.deleteMany({ driver_id: { $in: ['DRV-1', 'DRV-2'] } });
    await mongoose.disconnect();
  });

  let createdIncidentId: string;

  it('1. POST /driver/incidents records live GPS position, driver name, destination, and dispatches manager notifications', async () => {
    const key = `INC-TEST-${Date.now()}`;
    const res = await request(app)
      .post('/api/v1/driver/incidents')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        kind: 'BREAKDOWN',
        idempotency_key: key,
        ts: new Date().toISOString(),
        gps: {
          lat: 12.8394,
          lng: 77.9402,
          accuracy_m: 12,
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.incident).toBeDefined();
    expect(res.body.incident.kind).toBe('BREAKDOWN');
    expect(res.body.incident.status).toBe('REPORTED');
    expect(res.body.incident.lat).toBeCloseTo(12.8394, 3);
    expect(res.body.incident.lng).toBeCloseTo(77.9402, 3);
    expect(res.body.incident.accuracy_m).toBe(12);
    expect(res.body.incident.driver_name).toBeDefined();
    expect(res.body.proposal).toBeDefined();

    createdIncidentId = res.body.incident.incident_id;

    // Check manager notification was created
    const notifs = await Notification.find({
      entity_id: createdIncidentId,
      trigger: 'DRIVER_INCIDENT_REPORTED',
    }).lean();
    expect(notifs.length).toBeGreaterThan(0);
  });

  it('2. GET /incidents/active returns the reported incident with full view', async () => {
    const res = await request(app)
      .get('/api/v1/incidents/active')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.incidents)).toBe(true);

    const found = res.body.incidents.find((i: any) => i.incident_id === createdIncidentId);
    expect(found).toBeDefined();
    expect(found.truck_id).toBe('SHP-204');
    expect(found.driver_id).toBe('DRV-1');
    expect(found.status).toBe('REPORTED');
    expect(found.lat).toBeCloseTo(12.8394, 3);
    expect(found.lng).toBeCloseTo(77.9402, 3);
  });

  it('3. POST /incidents/:id/clear cannot be called by unauthorized driver', async () => {
    // Driver 2 trying to clear Driver 1's incident
    const res = await request(app)
      .post(`/api/v1/incidents/${createdIncidentId}/clear`)
      .set('Authorization', `Bearer ${driver2Token}`);

    expect(res.status).toBe(403);
  });

  it('4. POST /incidents/:id/clear can be called by reporting driver to clear incident', async () => {
    const res = await request(app)
      .post(`/api/v1/incidents/${createdIncidentId}/clear`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.incident_id).toBe(createdIncidentId);

    // Verify incident is now CLEARED in database
    const doc = await DriverIncident.findOne({ incident_id: createdIncidentId }).lean();
    expect(doc?.status).toBe('CLEARED');
    expect(doc?.cleared_by).toBe('drv1');
    expect(doc?.cleared_at).toBeDefined();

    // Verify it is no longer returned in /incidents/active
    const listRes = await request(app)
      .get('/api/v1/incidents/active')
      .set('Authorization', `Bearer ${analystToken}`);
    const active = listRes.body.incidents.find((i: any) => i.incident_id === createdIncidentId);
    expect(active).toBeUndefined();
  });

  it('5. Manager can clear an incident', async () => {
    // Driver 2 reports an incident
    const key = `INC-MGR-${Date.now()}`;
    const reportRes = await request(app)
      .post('/api/v1/driver/incidents')
      .set('Authorization', `Bearer ${driver2Token}`)
      .send({
        kind: 'ACCIDENT',
        idempotency_key: key,
        ts: new Date().toISOString(),
        gps: { lat: 12.9, lng: 77.8 },
      });
    expect(reportRes.status).toBe(201);
    const incId = reportRes.body.incident.incident_id;

    // Manager clears it
    const clearRes = await request(app)
      .post(`/api/v1/incidents/${incId}/clear`)
      .set('Authorization', `Bearer ${managerToken}`);
    expect(clearRes.status).toBe(200);
    expect(clearRes.body.ok).toBe(true);

    const doc = await DriverIncident.findOne({ incident_id: incId }).lean();
    expect(doc?.status).toBe('CLEARED');
    expect(doc?.cleared_by).toBe('manager');
  });
});

