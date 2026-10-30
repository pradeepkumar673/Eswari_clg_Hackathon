/**
 * Step 2 Tests: Data model, indexes, validators, security roles
 *
 * Tests run against a real MongoDB test DB (disruptioniq_test) with the
 * actual replica-set so transactions are supported.
 *
 * Five required tests:
 * 1. Duplicate (source, external_event_id) insert is rejected by the DB.
 * 2. Inventory insert/update violating reserved <= on_hand is rejected.
 * 3. Security roles (app_rw, app_readonly) exist with correct privileges.
 *    NOTE: Runtime enforcement requires --auth, which is unavailable on this
 *    Windows dev environment (MongoDB replSet + keyFile instability). Role
 *    enforcement is verified in Step 21 (red-team) on a Linux environment.
 * 4. Second OPEN alert with same alert_key is rejected;
 *    CLEARED then new OPEN works.
 * 5. A transaction that fails midway leaves no partial writes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { ShipmentEvent } from '../src/models/shipment-events.js';
import { InventoryBalance } from '../src/models/inventory-balances.js';
import { AuditLog } from '../src/models/audit-logs.js';
import { Alert } from '../src/models/alerts.js';
import { ensureIndexes } from '../src/models/index.js';
import { withTransaction } from '../src/db/withTransaction.js';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

const DB_NAME = 'disruptioniq_test';

// ── Test setup ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10000 });

  // 1. Clear data FIRST so index sync has no conflicts
  await ShipmentEvent.deleteMany({});
  await InventoryBalance.deleteMany({});
  await AuditLog.deleteMany({});
  await Alert.deleteMany({});

  // 2. Force-sync all indexes so partial/unique indexes are guaranteed clean
  await ShipmentEvent.syncIndexes();
  await InventoryBalance.syncIndexes();
  await AuditLog.syncIndexes();
  await Alert.syncIndexes();

  // 3. Apply collection validators (inventory_balances reserved <= on_hand)
  await ensureIndexes();
});

afterAll(async () => {
  await ShipmentEvent.deleteMany({});
  await InventoryBalance.deleteMany({});
  await AuditLog.deleteMany({});
  await Alert.deleteMany({});
  await mongoose.disconnect();
});

// ── Test 1: Duplicate (source, external_event_id) ─────────────────────────────

describe('Test 1 — shipment_events unique (source, external_event_id)', () => {
  const fakeShipmentId = new mongoose.Types.ObjectId();
  const baseEvent = {
    shipment_id: fakeShipmentId,
    source: 'CARRIER_API' as const,
    external_event_id: 'EVT-DUPE-001',
    event_type: 'ETA_UPDATE' as const,
    reported_eta: new Date('2026-11-01T10:00:00Z'),
    quantity_affected: null,
    confidence: 0.9,
    raw_payload: { test: true },
    ingested_at: new Date(),
  };

  it('inserts the first event successfully', async () => {
    const doc = await ShipmentEvent.create(baseEvent);
    expect(doc._id).toBeDefined();
  });

  it('rejects a duplicate (source, external_event_id) at the DB level', async () => {
    await expect(ShipmentEvent.create({ ...baseEvent })).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('allows same external_event_id from a different source', async () => {
    const doc = await ShipmentEvent.create({
      ...baseEvent,
      source: 'SUPPLIER_PORTAL' as const,
    });
    expect(doc._id).toBeDefined();
  });

  it('allows a null external_event_id to be inserted multiple times (partial index)', async () => {
    const noExtId = { ...baseEvent, external_event_id: null };
    const a = await ShipmentEvent.create(noExtId);
    const b = await ShipmentEvent.create({ ...noExtId });
    expect(a._id).toBeDefined();
    expect(b._id).toBeDefined();
  });
});

// ── Test 2: inventory_balances collection validator ────────────────────────────

describe('Test 2 — inventory_balances: reserved <= on_hand', () => {
  const whId = new mongoose.Types.ObjectId();
  const skuId = new mongoose.Types.ObjectId();
  const skuId2 = new mongoose.Types.ObjectId();
  const skuId3 = new mongoose.Types.ObjectId();

  it('inserts a valid balance (reserved <= on_hand)', async () => {
    const doc = await InventoryBalance.create({
      warehouse_id: whId,
      sku_id: skuId,
      on_hand: 100,
      reserved: 50,
      updated_at: new Date(),
    });
    expect(doc._id).toBeDefined();
  });

  it('inserts a balance with reserved = 0', async () => {
    const doc = await InventoryBalance.create({
      warehouse_id: whId,
      sku_id: skuId2,
      on_hand: 20,
      reserved: 0,
      updated_at: new Date(),
    });
    expect(doc._id).toBeDefined();
  });

  it('rejects reserved > on_hand via collection validator', async () => {
    // Use native driver to bypass Mongoose min validation so the DB validator fires
    const db = mongoose.connection.db!;
    await expect(
      db.collection('inventory_balances').insertOne({
        warehouse_id: whId,
        sku_id: skuId3,
        on_hand: 10,
        reserved: 15, // violates reserved <= on_hand
        updated_at: new Date(),
      }),
    ).rejects.toThrow(/Document failed validation/i);
  });

  it('rejects an update that pushes reserved above on_hand', async () => {
    const doc = await InventoryBalance.create({
      warehouse_id: new mongoose.Types.ObjectId(),
      sku_id: new mongoose.Types.ObjectId(),
      on_hand: 10,
      reserved: 5,
      updated_at: new Date(),
    });
    const db = mongoose.connection.db!;
    await expect(
      db
        .collection('inventory_balances')
        .updateOne({ _id: doc._id as any }, { $set: { reserved: 11 } }),
    ).rejects.toThrow(/Document failed validation/i);
  });
});

// ── Test 3: Security role configuration ───────────────────────────────────────
//
// Runtime enforcement requires --auth + keyFile which is unstable on Windows
// (MongoDB 8.3 replSet crashes with keyFile due to FTDC issues).
// We verify role CONFIGURATION: users exist, roles exist, privileges are correct.
// Runtime enforcement is covered in Step 21 (red-team) on a Linux environment.

describe('Test 3 — security roles: configuration verification', () => {
  it('app_rw user exists in disruptioniq db with rw_except_appendonly role', async () => {
    const db = mongoose.connection.db!;
    const info = await db.command({
      usersInfo: { user: 'app_rw', db: 'disruptioniq' },
    });
    expect(info.users).toHaveLength(1);
    const roles = info.users[0].roles.map((r: any) => r.role);
    expect(roles).toContain('rw_except_appendonly');
  });

  it('app_readonly user exists in disruptioniq db with readonly_plus_sim role', async () => {
    const db = mongoose.connection.db!;
    const info = await db.command({
      usersInfo: { user: 'app_readonly', db: 'disruptioniq' },
    });
    expect(info.users).toHaveLength(1);
    const roles = info.users[0].roles.map((r: any) => r.role);
    expect(roles).toContain('readonly_plus_sim');
  });

  it('rw_except_appendonly role denies update/remove on audit_logs', async () => {
    const db = mongoose.connection.db!;
    const roleInfo = await db.command({
      rolesInfo: { role: 'rw_except_appendonly', db: 'disruptioniq' },
      showPrivileges: true,
    });
    expect(roleInfo.roles).toHaveLength(1);
    const auditPriv = roleInfo.roles[0].privileges?.find(
      (p: any) => p.resource?.collection === 'audit_logs',
    );
    // audit_logs is append-only: find + insert only, NOT update/remove
    expect(auditPriv?.actions).toContain('find');
    expect(auditPriv?.actions).toContain('insert');
    expect(auditPriv?.actions).not.toContain('update');
    expect(auditPriv?.actions).not.toContain('remove');
  });

  it('readonly_plus_sim role has insert privilege on simulation_runs', async () => {
    const db = mongoose.connection.db!;
    const roleInfo = await db.command({
      rolesInfo: { role: 'readonly_plus_sim', db: 'disruptioniq' },
      showPrivileges: true,
    });
    expect(roleInfo.roles).toHaveLength(1);
    const simPriv = roleInfo.roles[0].privileges?.find(
      (p: any) => p.resource?.collection === 'simulation_runs',
    );
    expect(simPriv?.actions).toContain('insert');
  });

  it('demo_admin user exists with dbOwner role', async () => {
    const db = mongoose.connection.db!;
    const info = await db.command({
      usersInfo: { user: 'demo_admin', db: 'disruptioniq' },
    });
    expect(info.users).toHaveLength(1);
    const roles = info.users[0].roles.map((r: any) => r.role);
    expect(roles).toContain('dbOwner');
  });
});

// ── Test 4: Alert partial unique index ────────────────────────────────────────

describe('Test 4 — alerts: unique OPEN alert per alert_key', () => {
  const alertKey = 'STOCK_LOW:WH-HOS:SKU-101:test4';

  it('inserts the first OPEN alert', async () => {
    const a = await Alert.create({
      alert_key: alertKey,
      type: 'STOCK_LOW',
      severity: 'RED',
      status: 'OPEN',
      title: 'Low stock',
      entity_type: 'inventory_balance',
      entity_id: 'inv-1',
    });
    expect(a._id).toBeDefined();
  });

  it('rejects a second OPEN alert with the same alert_key', async () => {
    await expect(
      Alert.create({
        alert_key: alertKey,
        type: 'STOCK_LOW',
        severity: 'RED',
        status: 'OPEN',
        title: 'Low stock duplicate',
        entity_type: 'inventory_balance',
        entity_id: 'inv-1',
      }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows an ACKNOWLEDGED alert with the same alert_key', async () => {
    const a = await Alert.create({
      alert_key: alertKey,
      type: 'STOCK_LOW',
      severity: 'RED',
      status: 'ACKNOWLEDGED',
      title: 'Low stock ack',
      entity_type: 'inventory_balance',
      entity_id: 'inv-1',
    });
    expect(a._id).toBeDefined();
  });

  it('allows a new OPEN alert after the first is CLEARED', async () => {
    // Clear the original
    await Alert.updateOne({ alert_key: alertKey, status: 'OPEN' }, {
      $set: { status: 'CLEARED', cleared_at: new Date() },
    });

    // Now a fresh OPEN should succeed
    const b = await Alert.create({
      alert_key: alertKey,
      type: 'STOCK_LOW',
      severity: 'AMBER',
      status: 'OPEN',
      title: 'Low stock renewed',
      entity_type: 'inventory_balance',
      entity_id: 'inv-1',
    });
    expect(b._id).toBeDefined();
  });
});

// ── Test 5: Transaction atomicity ────────────────────────────────────────────

describe('Test 5 — withTransaction: failed midway leaves no partial writes', () => {
  it('rolls back all writes when an error is thrown inside the transaction', async () => {
    const uniqueAction = `TX_ROLLBACK_SENTINEL_${Date.now()}`;
    const wh = new mongoose.Types.ObjectId();
    const sku = new mongoose.Types.ObjectId();

    await expect(
      withTransaction(async (session) => {
        // Write 1: insert into audit_logs
        await AuditLog.create(
          [
            {
              actor: null,
              action: uniqueAction,
              correlation_id: 'tx-test',
              seq: 99998,
              prev_hash: '0',
              row_hash: 'hx',
              created_at: new Date(),
            },
          ],
          { session },
        );

        // Write 2: insert into inventory_balances
        await InventoryBalance.create(
          [
            {
              warehouse_id: wh,
              sku_id: sku,
              on_hand: 50,
              reserved: 0,
              updated_at: new Date(),
            },
          ],
          { session },
        );

        // Simulated error — abort mid-transaction
        throw new Error('SIMULATED_FAILURE');
      }),
    ).rejects.toThrow('SIMULATED_FAILURE');

    // Neither document should exist post-rollback
    const auditRow = await AuditLog.findOne({ action: uniqueAction });
    expect(auditRow).toBeNull();

    const invRow = await InventoryBalance.findOne({
      warehouse_id: wh,
      sku_id: sku,
    });
    expect(invRow).toBeNull();
  });

  it('commits both writes when the transaction succeeds', async () => {
    const uniqueAction = `TX_COMMIT_SENTINEL_${Date.now()}`;
    const wh = new mongoose.Types.ObjectId();
    const sku = new mongoose.Types.ObjectId();

    await withTransaction(async (session) => {
      await AuditLog.create(
        [
          {
            actor: null,
            action: uniqueAction,
            correlation_id: 'tx-commit-test',
            seq: 99999,
            prev_hash: '0',
            row_hash: 'hy',
            created_at: new Date(),
          },
        ],
        { session },
      );

      await InventoryBalance.create(
        [
          {
            warehouse_id: wh,
            sku_id: sku,
            on_hand: 30,
            reserved: 10,
            updated_at: new Date(),
          },
        ],
        { session },
      );
    });

    const auditRow = await AuditLog.findOne({ action: uniqueAction });
    expect(auditRow).not.toBeNull();

    const invRow = await InventoryBalance.findOne({ warehouse_id: wh, sku_id: sku });
    expect(invRow).not.toBeNull();
    expect(invRow!.on_hand).toBe(30);
  });
});
