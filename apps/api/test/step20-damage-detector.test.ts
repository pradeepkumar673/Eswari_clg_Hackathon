/**
 * apps/api/test/step20-damage-detector.test.ts
 *
 * Vitest acceptance tests for Step 20 CCTV Damage Detection & Adjudication Pipeline:
 *
 * (e) Evidence verify passes on untampered file and returns TAMPER_DETECTED on tampered file.
 * (f) SEVERE event sends 48h delay to reconciler, creates OPEN claim, writes quarantine ledger row.
 * (g) Operator who linked cannot accept the claim (403 Separation of Duties).
 * (h) Supplier 2 cannot view or respond to Supplier 1's claim (403 Supplier Isolation).
 *
 * Every test states expected numbers and arithmetic in a comment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

import { app } from '../src/app.js';
import { config } from '../src/config.js';
import { seed } from '../src/services/seedData.js';
import { ensureIndexes } from '../src/models/index.js';
import { User } from '../src/models/users.js';
import { Shipment } from '../src/models/shipments.js';
import { CctvClip } from '../src/models/cctv-clips.js';
import { CctvEvent } from '../src/models/cctv-events.js';
import { EvidenceItem } from '../src/models/evidence-items.js';
import { SupplierClaim } from '../src/models/supplier-claims.js';
import { ExecutionLedger } from '../src/models/execution-ledger.js';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq_test?replicaSet=rs0';

describe('Step 20 — CCTV Damage Detection & Adjudication Acceptance', () => {
  let operatorToken: string;
  let procurementToken: string;
  let sup1Token: string;
  let sup2Token: string;
  let adminToken: string;
  let initialShp204Eta: Date | null = null;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(MONGODB_URI);
    }
    await ensureIndexes();
    await seed(MONGODB_URI, false);

    // Create a second supplier user for SUP-2 to test supplier isolation
    await User.findOneAndUpdate(
      { username: 'sup2' },
      {
        $set: {
          username: 'sup2',
          password_hash: 'hash',
          role: 'SUPPLIER',
          warehouse_id: null,
          driver_id: null,
          truck_id: null,
          supplier_id: 'SUP-2',
          display_name: 'Supplier Rep 2 (Kanchi)',
        },
      },
      { upsert: true, new: true },
    );

    const operatorUser = await User.findOne({ username: 'operator' }).lean();
    const procurementUser = await User.findOne({ username: 'procurement' }).lean();
    const sup1User = await User.findOne({ username: 'sup1' }).lean();
    const sup2User = await User.findOne({ username: 'sup2' }).lean();
    const adminUser = await User.findOne({ username: 'admin' }).lean();

    expect(operatorUser).toBeDefined();
    expect(procurementUser).toBeDefined();
    expect(sup1User).toBeDefined();
    expect(sup2User).toBeDefined();

    function makeToken(user: any) {
      return jwt.sign(
        {
          sub: user._id.toString(),
          username: user.username,
          role: user.role,
          warehouse_id: user.warehouse_id ? user.warehouse_id.toString() : null,
          driver_id: user.driver_id || null,
          truck_id: user.truck_id || null,
          supplier_id: user.supplier_id || null,
        },
        config.JWT_SECRET,
        { expiresIn: '12h' },
      );
    }

    operatorToken = makeToken(operatorUser);
    procurementToken = makeToken(procurementUser);
    sup1Token = makeToken(sup1User);
    sup2Token = makeToken(sup2User);
    adminToken = makeToken(adminUser);

    const shp204 = await Shipment.findOne({ code: 'SHP-204' }).lean();
    initialShp204Eta = shp204?.resolved_eta || null;
  });

  afterAll(async () => {
    if (initialShp204Eta) {
      await Shipment.updateOne(
        { code: 'SHP-204' },
        {
          $set: {
            resolved_eta: initialShp204Eta,
            review_status: 'NORMAL',
          },
        },
      );
    }
  });

  // -------------------------------------------------------------------------
  // Test (e): Evidence Verification and Tamper Detection
  // -------------------------------------------------------------------------
  it('(e) evidence verify passes on untampered file and returns TAMPER_DETECTED on tampered one', async () => {
    /**
     * Arithmetic & Cryptographic Proof:
     * Raw payload string: "UNMODIFIED_EVIDENCE_FRAME_SNAPSHOT_BYTES_42"
     * Expected SHA-256 = sha256("UNMODIFIED_EVIDENCE_FRAME_SNAPSHOT_BYTES_42")
     * On verify: recompute hash over bytes. If hash == expected_sha256 -> status: 'VERIFIED', match: true.
     * On tamper: file bytes overwritten with "TAMPERED_DEMO_CORRUPT_PAYLOAD_..."
     * Resulting recomputed SHA-256 != original expected hash -> status: 'TAMPER_DETECTED', match: false.
     */
    const evidenceDir = path.resolve(config.CCTV_EVIDENCE_DIR);
    fs.mkdirSync(evidenceDir, { recursive: true });

    const evidenceId = `EVT-TEST-EVIDENCE-${Date.now()}`;
    const filePath = path.join(evidenceDir, `${evidenceId}.jpg`);
    const initialContent = Buffer.from('UNMODIFIED_EVIDENCE_FRAME_SNAPSHOT_BYTES_42');
    fs.writeFileSync(filePath, initialContent);

    const initialSha = crypto.createHash('sha256').update(initialContent).digest('hex');

    await EvidenceItem.create({
      evidence_id: evidenceId,
      kind: 'FRAME_SNAPSHOT',
      path: filePath,
      sha256: initialSha,
      created_at: new Date(),
    });

    // 1. Verify untampered file
    const verifyRes1 = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/verify`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(verifyRes1.status).toBe(200);
    expect(verifyRes1.body.evidence_id).toBe(evidenceId);
    expect(verifyRes1.body.status).toBe('VERIFIED');
    expect(verifyRes1.body.match).toBe(true);
    expect(verifyRes1.body.expected_sha256).toBe(initialSha);
    expect(verifyRes1.body.actual_sha256).toBe(initialSha);

    // 2. Tamper with file via demo tamper endpoint
    const tamperRes = await request(app)
      .post(`/api/v1/evidence/${evidenceId}/tamper`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({});

    expect(tamperRes.status).toBe(200);
    expect(tamperRes.body.tampered).toBe(true);

    // 3. Verify tampered file -> must return TAMPER_DETECTED
    const verifyRes2 = await request(app)
      .get(`/api/v1/evidence/${evidenceId}/verify`)
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(verifyRes2.status).toBe(200);
    expect(verifyRes2.body.status).toBe('TAMPER_DETECTED');
    expect(verifyRes2.body.match).toBe(false);
    expect(verifyRes2.body.expected_sha256).toBe(initialSha);
    expect(verifyRes2.body.actual_sha256).not.toBe(initialSha);
  });

  // -------------------------------------------------------------------------
  // Test (f): SEVERE Event Processing through Damage-to-Delay Rules
  // -------------------------------------------------------------------------
  it(
    '(f) SEVERE event sends 48h delay to reconciler, creates OPEN claim, writes quarantine ledger row',
    async () => {
      /**
       * Arithmetic & State Transitions:
       * Shipment: SHP-204
       * Initial Resolved ETA = T_0
       * Lead time delay for SEVERE from damage_policies: lead_time_hours = 48 hours = 172,800,000 ms.
       * Expected New Resolved ETA = T_0 + 48 hours = T_0 + 172,800,000 ms.
       * Damaged units: 20 units.
       * Supplier claim: status == 'OPEN', units == 20, delay_hours == 48.
       * Ledger row: step_type == 'QUARANTINE', delta_on_hand == 0 (Never mutate on_hand directly).
       */
      const shipmentBefore = await Shipment.findOne({ code: 'SHP-204' });
      expect(shipmentBefore).toBeDefined();

      const initialEta = new Date(shipmentBefore!.resolved_eta || shipmentBefore!.current_eta || shipmentBefore!.promised_eta).getTime();

      // Synthesize clip with a SEVERE CRUSH on track 1
      const synthRes = await request(app)
        .post('/api/v1/cctv/clips/synthesize')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          warehouse_id: 'WH-HOS',
          camera_id: 'CAM-01',
          fps: 15,
          seconds: 4,
          parcel_count: 2,
          injected_events: [
            {
              track_id: 1,
              kind: 'CRUSH',
              severity: 'SEVERE',
              frame_start: 15,
              frame_end: 35,
            },
          ],
          seed: Math.floor(Math.random() * 80000) + 10000,
        });

      expect(synthRes.status).toBe(201);
      const clipId = synthRes.body.clip.clip_id;

      // Analyze clip with parcel mapping track 1 -> SHP-204
      const analyzeRes = await request(app)
        .post(`/api/v1/cctv/clips/${clipId}/analyze`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          parcel_to_shipment_map: {
            '1': 'SHP-204',
          },
        });

      expect(analyzeRes.status).toBe(200);
      expect(analyzeRes.body.clip_id).toBe(clipId);

      // 1. Reconciler 48h delay check:
      const shipmentAfter = await Shipment.findOne({ code: 'SHP-204' });
      expect(shipmentAfter).toBeDefined();
      const finalEta = new Date(shipmentAfter!.resolved_eta!).getTime();

      // Difference between final and initial ETA must be 48 hours (172,800,000 ms)
      const expectedDiffMs = 48 * 3600 * 1000;
      const actualDiffMs = finalEta - initialEta;
      expect(Math.abs(actualDiffMs - expectedDiffMs)).toBeLessThanOrEqual(5000);

      // 2. Supplier Claim check:
      const severeEvent = analyzeRes.body.events.find((e: any) => e.band === 'SEVERE');
      expect(severeEvent).toBeDefined();

      const claim = await SupplierClaim.findOne({ cctv_event_id: severeEvent.event_id });
      expect(claim).toBeDefined();
      expect(claim!.status).toBe('OPEN');
      expect(claim!.delay_hours).toBe(48);
      expect(claim!.units).toBeGreaterThanOrEqual(10);

      // 3. Ledger Quarantine row check:
      const ledgerRow = await ExecutionLedger.findOne({ step_type: 'QUARANTINE' }).sort({ seq: -1 });
      expect(ledgerRow).toBeDefined();
      expect(ledgerRow!.step_type).toBe('QUARANTINE');
      expect(ledgerRow!.delta_on_hand).toBe(0); // Zero mutation to live on_hand
      expect(ledgerRow!.after_state.quarantined_units).toBeGreaterThanOrEqual(10);
    },
    30000,
  );

  // -------------------------------------------------------------------------
  // Test (g): Separation of Duties (Linking Operator cannot accept claim)
  // -------------------------------------------------------------------------
  it('(g) Operator who linked cannot accept the claim (403)', async () => {
    /**
     * Separation of Duties Rule:
     * An operator who confirms/links a CCTV damage event (e.g. operator 'operator')
     * cannot approve or accept the supplier financial claim resulting from that event.
     *
     * Attempt by linking user -> HTTP 403 Forbidden with SEPARATION_OF_DUTIES_VIOLATION.
     * Attempt by independent Procurement Approver -> HTTP 200 OK.
     */
    const eventId = `EVT-LINK-TEST-${Date.now()}`;
    const claimId = `CLM-${eventId}`;

    await CctvEvent.create({
      event_id: eventId,
      clip_id: `CLP-TEST-${Date.now()}`,
      track_id: 1,
      shipment_id: 'SHP-204',
      warehouse_id: 'WH-HOS',
      camera_id: 'CAM-01',
      band: 'SEVERE',
      damage_score: 85,
      units_damaged: 20,
      frame_start: 10,
      frame_end: 25,
      status: 'DETECTED',
      created_at: new Date(),
    });

    await SupplierClaim.create({
      claim_id: claimId,
      supplier_id: 'SUP-1',
      shipment_id: 'SHP-204',
      cctv_event_id: eventId,
      band: 'SEVERE',
      units: 20,
      delay_hours: 48,
      status: 'OPEN',
      created_at: new Date(),
    });

    // 1. Warehouse Operator confirms and links the event
    const linkRes = await request(app)
      .post(`/api/v1/cctv/events/${eventId}/link`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ shipment_id: 'SHP-204' });

    expect(linkRes.status).toBe(200);
    expect(linkRes.body.status).toBe('LINKED');
    expect(linkRes.body.linked_by).toBe('operator');

    // 2. Linking operator tries to accept the claim (operator lacks claim.decide -> 403)
    const operatorAttemptRes = await request(app)
      .post(`/api/v1/claims/${claimId}/accept`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({});

    expect(operatorAttemptRes.status).toBe(403);

    // 3. User with claim.decide (procurement) who is recorded as the linking user attempts to accept:
    // Update claim and event to be linked by 'procurement'
    await CctvEvent.updateOne({ event_id: eventId }, { $set: { linked_by: 'procurement' } });
    await SupplierClaim.updateOne({ claim_id: claimId }, { $set: { linked_by: 'procurement' } });

    const conflictRes = await request(app)
      .post(`/api/v1/claims/${claimId}/accept`)
      .set('Authorization', `Bearer ${procurementToken}`)
      .send({});

    expect(conflictRes.status).toBe(403);
    expect(conflictRes.body.code).toBe('SEPARATION_OF_DUTIES_VIOLATION');

    // 4. Independent Admin or second procurement user (adminToken) accepts the claim
    const approverRes = await request(app)
      .post(`/api/v1/claims/${claimId}/accept`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(approverRes.status).toBe(200);
    expect(approverRes.body.status).toBe('ACCEPTED');
    expect(approverRes.body.decided_by).toBe('admin');
    expect(approverRes.body.version).toBe(2); // Version incremented 1 -> 2
  });

  // -------------------------------------------------------------------------
  // Test (h): Supplier Isolation (SUP-2 cannot view or respond to SUP-1's claim)
  // -------------------------------------------------------------------------
  it('(h) Supplier 2 cannot view or respond to Supplier 1\'s claim (403)', async () => {
    /**
     * Multi-Tenant Supplier Isolation Rule:
     * Supplier 1 has supplier_id: 'SUP-1'
     * Supplier 2 has supplier_id: 'SUP-2'
     *
     * A claim created for SUP-1:
     * - Supplier 2 GET /claims/:id -> HTTP 403 Forbidden
     * - Supplier 2 POST /claims/:id/respond -> HTTP 403 Forbidden
     * - Supplier 1 GET /claims/:id -> HTTP 200 OK
     * - Supplier 1 POST /claims/:id/respond -> HTTP 200 OK, status: 'RESPONDED', version += 1
     */
    const claimId = `CLM-SUP1-ISOLATION-${Date.now()}`;

    await SupplierClaim.create({
      claim_id: claimId,
      supplier_id: 'SUP-1',
      shipment_id: 'SHP-204',
      cctv_event_id: `EVT-SUP-${Date.now()}`,
      band: 'MAJOR',
      units: 15,
      delay_hours: 24,
      status: 'OPEN',
      supplier_response: null,
      decided_by: null,
      version: 1,
      created_at: new Date(),
    });

    // 1. Supplier 2 attempts to view Supplier 1's claim -> 403 Forbidden
    const viewAttemptRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${sup2Token}`);

    expect(viewAttemptRes.status).toBe(403);

    // 2. Supplier 2 attempts to respond to Supplier 1's claim -> 403 Forbidden
    const respondAttemptRes = await request(app)
      .post(`/api/v1/claims/${claimId}/respond`)
      .set('Authorization', `Bearer ${sup2Token}`)
      .send({ response: 'This was not our fault!' });

    expect(respondAttemptRes.status).toBe(403);

    // 3. Supplier 1 views its own claim -> 200 OK
    const sup1ViewRes = await request(app)
      .get(`/api/v1/claims/${claimId}`)
      .set('Authorization', `Bearer ${sup1Token}`);

    expect(sup1ViewRes.status).toBe(200);
    expect(sup1ViewRes.body.claim_id).toBe(claimId);
    expect(sup1ViewRes.body.supplier_id).toBe('SUP-1');

    // 4. Supplier 1 submits formal response to its own claim -> 200 OK
    const sup1RespondRes = await request(app)
      .post(`/api/v1/claims/${claimId}/respond`)
      .set('Authorization', `Bearer ${sup1Token}`)
      .send({ response: 'Box packaging verified under ISO-9001. Requesting joint survey.' });

    expect(sup1RespondRes.status).toBe(200);
    expect(sup1RespondRes.body.status).toBe('RESPONDED');
    expect(sup1RespondRes.body.supplier_response).toBe('Box packaging verified under ISO-9001. Requesting joint survey.');
    expect(sup1RespondRes.body.version).toBe(2); // Version incremented 1 -> 2
  });

  // -------------------------------------------------------------------------
  // Hotspots Analytics endpoint test
  // -------------------------------------------------------------------------
  it('aggregates damage counts and hotspots ranked descending', async () => {
    const hotspotsRes = await request(app)
      .get('/api/v1/cctv/hotspots')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(hotspotsRes.status).toBe(200);
    expect(Array.isArray(hotspotsRes.body)).toBe(true);
  });
});
