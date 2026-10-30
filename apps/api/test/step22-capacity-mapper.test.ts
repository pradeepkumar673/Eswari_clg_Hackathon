/**
 * apps/api/test/step22-capacity-mapper.test.ts
 *
 * Vitest Acceptance Suite for Step 22 — Warehouse Zone Capacity Mapper,
 * Deterministic Occupancy, Inbound Slot Reservations, Alert Governance & RBAC.
 *
 * Test Specifications:
 * 1. Colour boundaries with capacity 100 and occupied 70:
 *    - adding 9 slots gives GREEN at 79% (projected 79 of 100)
 *    - adding 10 gives AMBER at 80% (projected 80 of 100)
 *    - adding 30 gives AMBER at 100% (projected 100 of 100)
 *    - adding 31 gives RED at 101% (projected 101 of 100, over capacity by 1)
 * 2. Two SKUs with 5 units each and units_per_slot 10 use 2 slots, not 1.
 * 3. Assignment above on_hand returns 409; on_hand and reserved are unchanged after assignments.
 * 4. Five free slots with two parallel inbound plans of 5 each: exactly one 201 and one 409.
 * 5. Alert ZONE_OVER_CAPACITY opens once, a repeat recompute adds no duplicate, releasing the plan clears it.
 * 6. Operator cannot PATCH zones (403); Procurement cannot see capacity (403).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { User } from '../src/models/users.js';
import { Warehouse } from '../src/models/warehouses.js';
import { Sku } from '../src/models/skus.js';
import { Zone } from '../src/models/zones.js';
import { ZoneStockAssignment } from '../src/models/zone-stock-assignments.js';
import { InboundSlotPlan } from '../src/models/inbound-slot-plans.js';
import { InventoryBalance } from '../src/models/inventory-balances.js';
import { Alert } from '../src/models/alerts.js';
import { computeZoneOccupancy, getZoneColour } from '../src/services/capacityService.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Step 22 — Capacity Mapper, Inbound Planning & Zone Governance Acceptance', () => {
  let managerToken: string;
  let adminToken: string;
  let operatorHosToken: string;
  let procurementToken: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await ensureIndexes();
    await seed(MONGODB_URI, false);
    await ZoneStockAssignment.deleteMany({});
    await InboundSlotPlan.deleteMany({});

    const manager = await User.findOne({ username: 'manager' });
    const admin = await User.findOne({ username: 'admin' });
    const operator = await User.findOne({ username: 'operator' });
    const procurement = await User.findOne({ username: 'procurement' });

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
      { sub: operator!._id, username: operator!.username, role: operator!.role, warehouse_id: operator!.warehouse_id },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
    procurementToken = jwt.sign(
      { sub: procurement!._id, username: procurement!.username, role: procurement!.role },
      config.JWT_SECRET,
      { expiresIn: '1h' },
    );
  });

  // ---------------------------------------------------------------------------
  // 1. Colour Boundaries Test
  // ---------------------------------------------------------------------------
  it('1. Colour boundaries with capacity 100 and occupied 70: +9 GREEN (79), +10 AMBER (80), +30 AMBER (100), +31 RED (101)', () => {
    const capacity = 100;
    const occupied = 70;

    // +9 slots: 79/100 = 79% -> GREEN
    const res79 = getZoneColour(capacity, occupied, 9);
    expect(res79.colour).toBe('GREEN');
    expect(res79.projected_slots).toBe(79);
    expect(res79.utilization_pct).toBe(79);
    expect(res79.explanation).toContain('Projected 79 of 100 slots');

    // +10 slots: 80/100 = 80% -> AMBER
    const res80 = getZoneColour(capacity, occupied, 10);
    expect(res80.colour).toBe('AMBER');
    expect(res80.projected_slots).toBe(80);
    expect(res80.utilization_pct).toBe(80);

    // +30 slots: 100/100 = 100% -> AMBER
    const res100 = getZoneColour(capacity, occupied, 30);
    expect(res100.colour).toBe('AMBER');
    expect(res100.projected_slots).toBe(100);
    expect(res100.utilization_pct).toBe(100);

    // +31 slots: 101/100 = 101% -> RED (over capacity by 1)
    const res101 = getZoneColour(capacity, occupied, 31);
    expect(res101.colour).toBe('RED');
    expect(res101.projected_slots).toBe(101);
    expect(res101.utilization_pct).toBe(101);
    expect(res101.explanation).toBe('Projected 101 of 100 slots, over capacity by 1.');
  });

  // ---------------------------------------------------------------------------
  // 2. Ceil Calculation for Discrete Slots
  // ---------------------------------------------------------------------------
  it('2. Two SKUs with 5 units each and units_per_slot 10 use 2 slots, not 1', async () => {
    // Math: ceil(5 / 10) + ceil(5 / 10) = 1 + 1 = 2 slots
    const sku1 = await Sku.findOne({ code: 'SKU-101' });
    const sku2 = await Sku.findOne({ code: 'SKU-205' });
    expect(sku1!.units_per_slot).toBe(10);
    expect(sku2!.units_per_slot).toBe(10);

    const testZoneId = `ZN-CEIL-${Date.now()}`;
    await Zone.create({
      zone_id: testZoneId,
      warehouse_id: 'WH-HOS',
      name: `Ceil Test Zone ${Date.now()}`,
      zone_type: 'STORAGE',
      polygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
      capacity_slots: 50,
      reserved_inbound_slots: 0,
    });

    await ZoneStockAssignment.create([
      { warehouse_id: 'WH-HOS', sku_id: sku1!.code, zone_id: testZoneId, units: 5 },
      { warehouse_id: 'WH-HOS', sku_id: sku2!.code, zone_id: testZoneId, units: 5 },
    ]);

    const occupancy = await computeZoneOccupancy(testZoneId);
    expect(occupancy.occupied_slots).toBe(2);
  });

  // ---------------------------------------------------------------------------
  // 3. Assignment Exceeding On-Hand Returns 409 & Zero Direct Mutation
  // ---------------------------------------------------------------------------
  it('3. Assignment above on_hand returns 409; on_hand and reserved are unchanged after assignments', async () => {
    const hos = await Warehouse.findOne({ code: 'WH-HOS' });
    const sku = await Sku.findOne({ code: 'SKU-101' });
    const balanceBefore = await InventoryBalance.findOne({
      warehouse_id: hos!._id,
      sku_id: sku!._id,
    });
    expect(balanceBefore).toBeDefined();

    const onHand = balanceBefore!.on_hand;
    const reserved = balanceBefore!.reserved;

    // Attempt assignment of onHand + 50 units (exceeds on_hand)
    const assignRes = await request(app)
      .post('/api/v1/zones/ZN-HOS-STR/assignments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        sku_id: sku!.code,
        units: onHand + 50,
      });

    expect(assignRes.status).toBe(409);
    expect(assignRes.body.error).toBe('Conflict');

    // Valid assignment within on_hand
    const validAssignRes = await request(app)
      .post('/api/v1/zones/ZN-HOS-STR/assignments')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        sku_id: sku!.code,
        units: Math.floor(onHand / 2),
      });

    expect(validAssignRes.status).toBe(200);

    // Verify on_hand and reserved on InventoryBalance are UNCHANGED
    const balanceAfter = await InventoryBalance.findOne({
      warehouse_id: hos!._id,
      sku_id: sku!._id,
    });

    expect(balanceAfter!.on_hand).toBe(onHand);
    expect(balanceAfter!.reserved).toBe(reserved);
  });

  // ---------------------------------------------------------------------------
  // 4. Parallel Inbound Plan Atomicity (1 Accepted, 1 Rejected)
  // ---------------------------------------------------------------------------
  it('4. Five free slots with two parallel inbound plans of 5 each: exactly one 201 and one 409', async () => {
    const testZoneId = `ZN-RACE-${Date.now()}`;
    await Zone.create({
      zone_id: testZoneId,
      warehouse_id: 'WH-HOS',
      name: `Race Zone ${Date.now()}`,
      zone_type: 'RECEIVING',
      polygon: [[10, 10], [50, 10], [50, 50], [10, 50]],
      capacity_slots: 10,
      reserved_inbound_slots: 5, // 5 slots remaining free (10 - 5 = 5)
    });

    // Fire two parallel inbound plan requests for 5 slots each
    const req1 = request(app)
      .post('/api/v1/capacity/inbound-plans')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        shipment_id: `SHP-TEST-RACE-A-${Date.now()}`,
        zone_id: testZoneId,
        slots: 5,
      });

    const req2 = request(app)
      .post('/api/v1/capacity/inbound-plans')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        shipment_id: `SHP-TEST-RACE-B-${Date.now()}`,
        zone_id: testZoneId,
        slots: 5,
      });

    const [res1, res2] = await Promise.all([req1, req2]);
    const statuses = [res1.status, res2.status].sort();

    // Exactly one 201 Created and one 409 Conflict
    expect(statuses).toEqual([201, 409]);

    const updatedZone = await Zone.findOne({ zone_id: testZoneId });
    expect(updatedZone!.reserved_inbound_slots).toBe(10);
  });

  // ---------------------------------------------------------------------------
  // 5. Alert Lifecycle: Opens Once, No Duplicate, Releasing Plan Clears Alert
  // ---------------------------------------------------------------------------
  it('5. Alert ZONE_OVER_CAPACITY opens once, repeat recompute adds no duplicate, releasing plan clears it', async () => {
    const testZoneId = `ZN-ALERT-${Date.now()}`;
    await Zone.create({
      zone_id: testZoneId,
      warehouse_id: 'WH-HOS',
      name: `Alert Lifecycle Zone ${Date.now()}`,
      zone_type: 'STORAGE',
      polygon: [[0, 0], [200, 0], [200, 200], [0, 200]],
      capacity_slots: 10,
      reserved_inbound_slots: 0,
    });

    // 70 units of SKU-101 (units_per_slot=10) = 7 occupied slots
    const sku = await Sku.findOne({ code: 'SKU-101' });
    await ZoneStockAssignment.create({
      warehouse_id: 'WH-HOS',
      sku_id: sku!.code,
      zone_id: testZoneId,
      units: 70,
    });

    const shipmentId = `SHP-ALERT-${Date.now()}`;

    // Over capacity: 7 occupied + 5 inbound = 12 > 10 slots (RED) with plan_over_capacity=true by Manager
    const planRes = await request(app)
      .post('/api/v1/capacity/inbound-plans')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({
        shipment_id: shipmentId,
        zone_id: testZoneId,
        slots: 5,
        plan_over_capacity: true,
      });

    expect(planRes.status).toBe(201);
    const planId = planRes.body.plan._id;

    // Verify exactly one active alert created for this zone
    const alerts1 = await Alert.find({
      type: 'ZONE_OVER_CAPACITY',
      entity_id: testZoneId,
      status: 'OPEN',
    });
    expect(alerts1).toHaveLength(1);

    // Repeat recompute: ensure no duplicate alert is opened
    await request(app)
      .get(`/api/v1/zones/${testZoneId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    const alerts2 = await Alert.find({
      type: 'ZONE_OVER_CAPACITY',
      entity_id: testZoneId,
      status: 'OPEN',
    });
    expect(alerts2).toHaveLength(1);

    // Release plan (DELETE /capacity/inbound-plans/:id)
    const releaseRes = await request(app)
      .delete(`/api/v1/capacity/inbound-plans/${planId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(releaseRes.status).toBe(200);

    // Alert must now be resolved / cleared
    const alerts3 = await Alert.find({
      type: 'ZONE_OVER_CAPACITY',
      entity_id: testZoneId,
      status: 'OPEN',
    });
    expect(alerts3).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 6. Security Scoping & RBAC (Operator 403 on PATCH, Procurement 403 on view)
  // ---------------------------------------------------------------------------
  it('6. Operator cannot PATCH zones (403); Procurement cannot see capacity (403)', async () => {
    // 1. Warehouse Operator attempts to PATCH zone
    const patchRes = await request(app)
      .patch('/api/v1/zones/ZN-HOS-STR')
      .set('Authorization', `Bearer ${operatorHosToken}`)
      .send({ capacity_slots: 999 });

    expect(patchRes.status).toBe(403);

    // 2. Procurement Approver attempts to view capacity overview
    const capacityRes = await request(app)
      .get('/api/v1/capacity/overview?warehouse_id=WH-HOS')
      .set('Authorization', `Bearer ${procurementToken}`);

    expect(capacityRes.status).toBe(403);
  });

  // ---------------------------------------------------------------------------
  // 7. Zone Deactivation with Stock / Plans Returns 409
  // ---------------------------------------------------------------------------
  it('7. Zone deactivation with stock returns 409 with active counts', async () => {
    const testZoneId = `ZN-DEACT-${Date.now()}`;
    await Zone.create({
      zone_id: testZoneId,
      warehouse_id: 'WH-HOS',
      name: `Deactivate Zone ${Date.now()}`,
      zone_type: 'STORAGE',
      polygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
      capacity_slots: 50,
      reserved_inbound_slots: 0,
    });

    const sku = await Sku.findOne({ code: 'SKU-101' });
    await ZoneStockAssignment.create({
      warehouse_id: 'WH-HOS',
      sku_id: sku!.code,
      zone_id: testZoneId,
      units: 20,
    });

    const delRes = await request(app)
      .delete(`/api/v1/zones/${testZoneId}`)
      .set('Authorization', `Bearer ${managerToken}`);

    expect(delRes.status).toBe(409);
    expect(delRes.body.error).toBe('Conflict');
    expect(delRes.body.assignments_count).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 8. Non-Manager gets 403 on plan_over_capacity
  // ---------------------------------------------------------------------------
  it('8. Non-manager gets 403 on POST /capacity/inbound-plans with plan_over_capacity: true', async () => {
    const res = await request(app)
      .post('/api/v1/capacity/inbound-plans')
      .set('Authorization', `Bearer ${operatorHosToken}`)
      .send({
        shipment_id: `SHP-OVER-${Date.now()}`,
        zone_id: 'ZN-HOS-STR',
        slots: 999,
        plan_over_capacity: true,
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
