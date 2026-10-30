/**
 * apps/api/test/step4-auth-rbac-audit.test.ts
 *
 * Step 4 Acceptance Tests:
 * 1. Login for all 7 users
 * 2. Wrong password returns 401
 * 3. Each capability row of the role matrix tested for at least one allowed and one denied role via HTTP
 * 4. Administrator cannot approve (403 / permission matrix)
 * 5. Warehouse Operator restricted to assigned warehouse (403 on other warehouse)
 * 6. Webhook authentication: HMAC signature check (401 on bad/missing signature, 200 on valid)
 * 7. Audit chain verifies on clean database
 * 8. Admin tamper breaks chain and names the tampered row
 * 9. 50 concurrent audit writes preserve gapless sequence and valid hash chain
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { ensureIndexes } from '../src/models/index.js';
import { seed } from '../src/services/seedData.js';
import { User } from '../src/models/users.js';
import { Warehouse } from '../src/models/warehouses.js';
import { AuditLog } from '../src/models/audit-logs.js';
import { ExecutionLedger } from '../src/models/execution-ledger.js';
import { ChainState } from '../src/models/chain-state.js';
import {
  writeAudit,
  verifyChain,
  initChainState,
  GENESIS_HASH,
} from '../src/services/audit.js';
import {
  ALL_ROLES,
  Capability,
  ROLE_PERMISSIONS,
  Role,
  hasPermission,
} from '@disruptioniq/shared';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@1234';

// Store generated tokens for all 7 roles
const userTokens: Record<string, string> = {};
const roleTokens: Partial<Record<Role, string>> = {};

let whHosId = '';
let whChnId = '';

beforeAll(async () => {
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await ensureIndexes();
  await seed(MONGODB_URI, false);

  // Clean audit and ledger collections and reset chain state so tests start with a clean genesis chain
  await AuditLog.deleteMany({});
  await ExecutionLedger.deleteMany({});
  await ChainState.deleteMany({});
  await initChainState();

  const whHos = await Warehouse.findOne({ code: 'WH-HOS' }).lean();
  const whChn = await Warehouse.findOne({ code: 'WH-CHN' }).lean();
  whHosId = whHos!._id.toString();
  whChnId = whChn!._id.toString();

  // Obtain tokens for all users (including new DRIVER and SUPPLIER roles)
  const usernames = [
    'analyst',
    'manager',
    'manager2',
    'operator',
    'procurement',
    'procurement2',
    'admin',
    'drv1',
    'sup1',
  ];

  for (const username of usernames) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: DEMO_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();

    userTokens[username] = res.body.token;
    roleTokens[res.body.user.role as Role] = res.body.token;
  }
}, 30_000);

afterAll(async () => {
  await mongoose.disconnect();
});

// ── Test 1 & 2: Authentication ────────────────────────────────────────────────

describe('Test 1 & 2 — Authentication (Login, Me, Demo-Switch, Bad Password)', () => {
  const allUsers = [
    { username: 'analyst', role: 'Analyst' },
    { username: 'manager', role: 'Manager' },
    { username: 'manager2', role: 'Manager' },
    { username: 'operator', role: 'Warehouse_Operator' },
    { username: 'procurement', role: 'Procurement_Approver' },
    { username: 'procurement2', role: 'Procurement_Approver' },
    { username: 'admin', role: 'Administrator' },
    { username: 'drv1', role: 'DRIVER' },
    { username: 'drv2', role: 'DRIVER' },
    { username: 'sup1', role: 'SUPPLIER' },
  ];

  it('authenticates all seeded users successfully', async () => {
    for (const u of allUsers) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: u.username, password: DEMO_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe(u.username);
      expect(res.body.user.role).toBe(u.role);
      expect(Array.isArray(res.body.user.permissions)).toBe(true);
      expect(res.body.user.permissions.length).toBeGreaterThan(0);
    }
  });

  it('rejects invalid password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'analyst', password: 'WrongPassword999!' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('rejects non-existent username with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nonexistent_user', password: DEMO_PASSWORD });

    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns current user profile and live permissions', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${userTokens['analyst']}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('analyst');
    expect(res.body.role).toBe('Analyst');
    expect(res.body.permissions).toContain('import_csv_json');
    expect(res.body.permissions).toContain('manage_plans');
  });

  it('POST /auth/demo-switch switches identity in DEMO_MODE', async () => {
    const res = await request(app)
      .post('/api/v1/auth/demo-switch')
      .send({ role: 'Manager' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('Manager');
  });
});

// ── Test 3: Matrix RBAC Verification via Real HTTP ────────────────────────────

describe('Test 3 — Role-Permission Matrix HTTP Verification', () => {
  const capabilities = Object.keys(ROLE_PERMISSIONS) as Capability[];

  for (const cap of capabilities) {
    const def = ROLE_PERMISSIONS[cap];
    const allowedRole = def.roles[0];
    const deniedRole = ALL_ROLES.find((r) => !def.roles.includes(r));

    it(`capability '${cap}': allows '${allowedRole}' (200) and denies '${deniedRole}' (403)`, async () => {
      // 1. Allowed role -> 200
      const allowedToken = roleTokens[allowedRole];
      expect(allowedToken, `Token for ${allowedRole} must exist`).toBeDefined();

      const resAllowed = await request(app)
        .get(`/api/v1/test/perms/${cap}`)
        .set('Authorization', `Bearer ${allowedToken}`);

      expect(resAllowed.status).toBe(200);
      expect(resAllowed.body.ok).toBe(true);
      expect(resAllowed.body.capability).toBe(cap);

      // 2. Denied role -> 403 (if any role is denied)
      if (deniedRole) {
        const deniedToken = roleTokens[deniedRole];
        expect(deniedToken, `Token for ${deniedRole} must exist`).toBeDefined();

        const resDenied = await request(app)
          .get(`/api/v1/test/perms/${cap}`)
          .set('Authorization', `Bearer ${deniedToken}`);

        expect(resDenied.status).toBe(403);
        expect(resDenied.body.error).toBe('Forbidden');
      }
    });
  }
});

// ── Test 4: Administrator Cannot Approve ──────────────────────────────────────

describe('Test 4 — Administrator separation of duties', () => {
  it('Administrator has neither reallocate/split nor expedite/alt_supplier approval capability', () => {
    expect(hasPermission('Administrator', 'approve_reallocate_split')).toBe(false);
    expect(hasPermission('Administrator', 'approve_expedite_alt_supplier')).toBe(false);
  });

  it('HTTP request with Administrator token to approve_reallocate_split returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/test/perms/approve_reallocate_split')
      .set('Authorization', `Bearer ${userTokens['admin']}`);

    expect(res.status).toBe(403);
  });

  it('HTTP request with Administrator token to approve_expedite_alt_supplier returns 403', async () => {
    const res = await request(app)
      .get('/api/v1/test/perms/approve_expedite_alt_supplier')
      .set('Authorization', `Bearer ${userTokens['admin']}`);

    expect(res.status).toBe(403);
  });
});

// ── Test 5: Warehouse Operator Scope ──────────────────────────────────────────

describe('Test 5 — Warehouse Operator Scoping', () => {
  it('allows Operator to access own assigned warehouse (WH-HOS)', async () => {
    const res = await request(app)
      .post(`/api/v1/test/perms/scoped/${whHosId}`)
      .set('Authorization', `Bearer ${userTokens['operator']}`)
      .send({ warehouse_id: whHosId });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('denies Operator accessing another warehouse (WH-CHN) with 403', async () => {
    const res = await request(app)
      .post(`/api/v1/test/perms/scoped/${whChnId}`)
      .set('Authorization', `Bearer ${userTokens['operator']}`)
      .send({ warehouse_id: whChnId });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(res.body.message).toMatch(/restricted to their assigned warehouse/i);
  });
});

// ── Test 6: Webhook HMAC Authentication ───────────────────────────────────────

describe('Test 6 — Carrier Webhook HMAC Authentication', () => {
  const payload = JSON.stringify({
    shipment_code: 'SHP-204',
    event_type: 'ETA_UPDATE',
    reported_eta: '2026-11-02T12:00:00Z',
  });

  it('rejects webhook request without signature (401)', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/carrier/CARRIER_API')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('rejects webhook request with invalid signature (401)', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/carrier/CARRIER_API')
      .set('Content-Type', 'application/json')
      .set('x-signature', '0'.repeat(64))
      .send(payload);

    expect(res.status).toBe(401);
  });

  it('accepts webhook request with valid HMAC-SHA256 signature (200)', async () => {
    const validSignature = crypto
      .createHmac('sha256', config.WEBHOOK_SECRET)
      .update(payload)
      .digest('hex');

    const res = await request(app)
      .post('/api/v1/webhooks/carrier/CARRIER_API')
      .set('Content-Type', 'application/json')
      .set('x-signature', validSignature)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ACCEPTED');
  });
});

// ── Test 7 & 8: Cryptographic Hash Chain and Tamper Detection ─────────────────

describe('Test 7 & 8 — Cryptographic Hash Chain & Tamper Detection', () => {
  it('audit chain verifies on a clean database', async () => {
    const res = await request(app)
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${userTokens['admin']}`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.audit_logs.ok).toBe(true);
  });

  it('POST /admin/demo/tamper breaks the chain and verify names the tampered row', async () => {
    // 1. Create a fresh known audit log row
    const testRow = await writeAudit({
      actor: null,
      action: 'ACTION_TO_BE_TAMPERED',
      correlationId: 'tamper-test',
      entityType: 'TEST',
    });

    // Verify chain is intact right after write
    const preVerify = await verifyChain('audit_logs');
    expect(preVerify.ok).toBe(true);

    // 2. Tamper the row via admin tamper endpoint
    const tamperRes = await request(app)
      .post('/api/v1/admin/demo/tamper')
      .set('Authorization', `Bearer ${userTokens['admin']}`)
      .send({ row_id: testRow._id.toString(), new_action: 'CORRUPTED_BY_ATTACKER' });

    expect(tamperRes.status).toBe(200);
    expect(tamperRes.body.ok).toBe(true);
    expect(tamperRes.body.tampered_row_id).toBe(testRow._id.toString());

    // 3. GET /audit/verify should now fail and identify this row
    const verifyRes = await request(app)
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${userTokens['admin']}`);

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.ok).toBe(false);
    expect(verifyRes.body.audit_logs.ok).toBe(false);
    expect(verifyRes.body.audit_logs.firstBrokenRowId).toBe(testRow._id.toString());
  });
});

// ── Test 9: 50 Concurrent Audit Writes ────────────────────────────────────────

describe('Test 9 — 50 Concurrent Audit Writes (Gapless Sequence & Chain Integrity)', () => {
  it('50 concurrent audit writes maintain gapless seq and valid chain', async () => {
    // Reset audit collection and chain state for clean sequence verification
    await AuditLog.deleteMany({});
    await ChainState.updateOne(
      { name: 'audit_logs' },
      { $set: { last_seq: 0, last_hash: GENESIS_HASH } },
      { upsert: true },
    );

    const count = 50;
    const writePromises = Array.from({ length: count }, (_, i) =>
      writeAudit({
        actor: null,
        action: `CONCURRENT_ACTION_${i + 1}`,
        correlationId: 'concurrency-stress-test',
        entityType: 'STRESS',
        entityId: String(i + 1),
      }),
    );

    // Run all 50 writes concurrently
    const results = await Promise.all(writePromises);
    expect(results).toHaveLength(count);

    // 1. Verify verifyChain reports ok=true and checked=50
    const check = await verifyChain('audit_logs');
    expect(check.ok).toBe(true);
    expect(check.checked).toBe(count);

    // 2. Verify all 50 seq numbers are strictly 1..50 without gaps or duplicates
    const allRows = await AuditLog.find({ correlation_id: 'concurrency-stress-test' })
      .sort({ seq: 1 })
      .lean();

    expect(allRows).toHaveLength(count);
    const sequences = allRows.map((r) => r.seq);
    const expectedSequences = Array.from({ length: count }, (_, i) => i + 1);

    expect(sequences).toEqual(expectedSequences);
  });
});
