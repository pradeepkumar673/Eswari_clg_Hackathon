/**
 * apps/api/src/services/scenarioC.ts
 *
 * Scenario C (Demo Day Synthetic Flow):
 * 1. SEVERE crush event on a parcel of SHP-310 at WH-CHN:
 *    - Creates an OPEN supplier claim.
 *    - Reconciler applies a 48-hour delay to SHP-310 ETA.
 *    - Writes a quarantine ledger row in execution_ledger.
 * 2. Inbound planning triggers over-capacity at WH-CHN:
 *    - Zone ZN-CHN-REC (capacity: 30 slots) receives an inbound plan of 35 slots.
 *    - Zone goes RED (>100% utilisation), generating a ZONE_OVER_CAPACITY alert.
 * 3. Driver incident & governed reroute:
 *    - DRV-2 reports a BREAKDOWN between BLR and CHN on lane BLR-CHN.
 *    - Dijkstra identifies the nearest warehouse (WH-BLR / WH-CHN).
 *    - A RerouteProposal is generated.
 *    - A non-reporting Manager approves the proposal -> EXECUTED_SIMULATED.
 *    - Destination updated without modifying inventory balances.
 */

import mongoose from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { makeDamageFrame } from './pngFrame.js';
import { Shipment } from '../models/shipments.js';
import { User } from '../models/users.js';
import { Zone } from '../models/zones.js';
import { InboundSlotPlan } from '../models/inbound-slot-plans.js';
import { CctvClip } from '../models/cctv-clips.js';
import { CctvEvent } from '../models/cctv-events.js';
import { EvidenceItem } from '../models/evidence-items.js';
import { SupplierClaim } from '../models/supplier-claims.js';
import { ExecutionLedger } from '../models/execution-ledger.js';
import { DriverIncident } from '../models/driver-incidents.js';
import { RerouteProposal } from '../models/reroute-proposals.js';
import { reconcile } from './reconciler.js';
import { syncZoneOverCapacityAlert } from './capacityService.js';
import { simClock } from './simClock.js';
import { writeAudit, writeLedgerEntry } from './audit.js';

export interface ScenarioCResult {
  damage_event: {
    clip_id: string;
    event_id: string;
    claim_id: string;
    shipment_code: string;
    previous_eta: Date;
    new_eta: Date;
    delay_hours: number;
    quarantine_ledger_id: string;
  };
  capacity_event: {
    warehouse_id: string;
    zone_id: string;
    plan_id: string;
    capacity_slots: number;
    reserved_slots: number;
    utilisation_pct: number;
    colour: string;
    alert_opened: boolean;
  };
  reroute_event: {
    driver_id: string;
    incident_id: string;
    proposal_id: string;
    nearest_warehouse_id: string;
    status: string;
    approved_by: string;
  };
}

export async function runScenarioC(): Promise<ScenarioCResult> {
  const now = await simClock.now();

  // Find relevant actors
  const operatorUser = await User.findOne({ username: 'operator' });
  const managerUser = await User.findOne({ username: 'manager' });
  const procurementUser = await User.findOne({ username: 'procurement' });
  const drv2User = await User.findOne({ username: 'drv2' });

  if (!operatorUser || !managerUser || !procurementUser || !drv2User) {
    throw new Error('Required seeded users not found for Scenario C');
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SEVERE CRUSH ON SHP-310 at WH-CHN
  // ─────────────────────────────────────────────────────────────────────────────
  const shipment = await Shipment.findOne({ code: 'SHP-310' });
  if (!shipment) {
    throw new Error('Shipment SHP-310 not found');
  }
  const previousEta = new Date(shipment.resolved_eta || shipment.current_eta || shipment.promised_eta);

  const clipId = `CLIP-SC-CHN-${Date.now().toString(36)}`;
  const eventId = `EVT-SC-CHN-${Date.now().toString(36)}`;

  // Generate real damage frame PNG and persist evidence file
  const evidenceDir = path.resolve(config.CCTV_EVIDENCE_DIR);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const framePng = makeDamageFrame();
  const framePath = path.join(evidenceDir, `${eventId}.png`);
  fs.writeFileSync(framePath, framePng);
  const frameSha256 = crypto.createHash('sha256').update(framePng).digest('hex');

  // Create clip & event
  const clip = await CctvClip.create({
    clip_id: clipId,
    warehouse_id: 'WH-CHN',
    camera_id: 'CAM-CHN-DOCK-01',
    sha256: frameSha256,
    frame_count: 150,
    fps: 15,
    created_at: now,
  });

  const cctvEvent = await CctvEvent.create({
    event_id: eventId,
    clip_id: clipId,
    track_id: 1,
    shipment_id: shipment._id.toString(),
    warehouse_id: 'WH-CHN',
    camera_id: 'CAM-CHN-DOCK-01',
    band: 'SEVERE',
    damage_score: 94.5,
    units_damaged: 5,
    frame_start: 20,
    frame_end: 70,
    evidence_ids: [eventId],
    status: 'LINKED',
    linked_by: operatorUser._id.toString(),
    linked_at: now,
    created_at: now,
  });

  // Store evidence item
  await EvidenceItem.create({
    evidence_id: eventId,
    kind: 'FRAME_SNAPSHOT',
    path: framePath,
    sha256: frameSha256,
    created_at: now,
  });

  // Reconcile 48-hour delay on SHP-310
  const delayedEta = new Date(previousEta.getTime() + 48 * 3600 * 1000);
  await reconcile({
    source: 'CCTV',
    external_event_id: `CCTV-SEV-${eventId}`,
    event_type: 'DELAY',
    shipment_code: 'SHP-310',
    reported_eta: delayedEta,
    event_time: now,
    raw_payload: {
      clip_id: clipId,
      event_id: eventId,
      damage_band: 'SEVERE',
      delay_hours: 48,
    },
    correlation_id: `scenario-c-cctv-${eventId}`,
  });

  const updatedShipment = await Shipment.findOne({ code: 'SHP-310' });

  // Create OPEN claim
  const claim = await SupplierClaim.create({
    claim_id: `CLM-SC-CHN-${Date.now().toString(36)}`,
    shipment_id: shipment._id.toString(),
    supplier_id: shipment.supplier_id ? shipment.supplier_id.toString() : 'SUP-3',
    cctv_event_id: eventId,
    band: 'SEVERE',
    units: 5,
    delay_hours: 48,
    status: 'OPEN',
    evidence_ids: [eventId],
    linked_by: operatorUser._id.toString(),
    created_at: now,
  });

  // Write quarantine row to execution_ledger with proper hash chaining
  const quarantineLedger = await writeLedgerEntry({
    stepType: 'QUARANTINE',
    actor: operatorUser._id,
    beforeState: { status: 'NORMAL', shipment_code: 'SHP-310' },
    afterState: {
      status: 'QUARANTINED',
      event_id: eventId,
      shipment_code: 'SHP-310',
      warehouse_id: 'WH-CHN',
      damage_band: 'SEVERE',
      quarantine_reason: 'Automatic hold via severe CCTV crush detection',
    },
  });

  await writeAudit({
    actor: operatorUser._id,
    action: 'CCTV_DAMAGE_LINKED',
    entityType: 'CctvEvent',
    entityId: eventId,
    after: {
      damage_band: 'SEVERE',
      claim_id: claim.claim_id,
      shipment_code: 'SHP-310',
    },
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. WH-CHN ZONE GOES RED UPON INBOUND PLAN
  // ─────────────────────────────────────────────────────────────────────────────
  const zoneChn = await Zone.findOne({ zone_id: 'ZN-CHN-REC' });
  if (!zoneChn) {
    throw new Error('Zone ZN-CHN-REC not found in WH-CHN');
  }

  // Zone capacity is 30. Assign 20 slots of stock, then add an inbound plan of 15 slots.
  // occupied (20) + reserved (15) = 35 / 30 = 116.7% (RED > 100%), while reserved (15) <= capacity (30).
  // Create zone stock assignments
  const { ZoneStockAssignment } = await import('../models/zone-stock-assignments.js');
  await ZoneStockAssignment.deleteMany({ zone_id: 'ZN-CHN-REC' });
  await ZoneStockAssignment.create({
    warehouse_id: 'WH-CHN',
    sku_id: 'SKU-205',
    zone_id: 'ZN-CHN-REC',
    units: 200,
  });

  await InboundSlotPlan.deleteMany({ shipment_id: shipment._id.toString() });

  const inboundPlan = await InboundSlotPlan.create({
    zone_id: 'ZN-CHN-REC',
    shipment_id: shipment._id.toString(),
    slots: 15,
    status: 'PLANNED',
    created_at: now,
  });

  await Zone.updateOne({ zone_id: 'ZN-CHN-REC' }, { $inc: { reserved_inbound_slots: 15 } });

  // Sync alert (35 slots projected / 30 slots capacity = RED)
  await syncZoneOverCapacityAlert('ZN-CHN-REC', 'WH-CHN', 'RED', 'Projected 35 of 30 slots, over capacity by 5.');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. DRV-2 BREAKDOWN BETWEEN BLR AND CHN & GOVERNED REROUTE
  // ─────────────────────────────────────────────────────────────────────────────
  const incidentId = `INC-SC-${Date.now().toString(36)}`;
  const proposalId = `RRP-SC-${Date.now().toString(36)}`;

  const incident = await DriverIncident.create({
    incident_id: incidentId,
    driver_id: 'DRV-2',
    truck_id: 'SHP-310',
    kind: 'BREAKDOWN',
    ts: now,
    status: 'REPORTED',
    idempotency_key: `idem-${incidentId}`,
    created_at: now,
  });

  // Road graph proposes nearest warehouse WH-HOS
  const proposal = await RerouteProposal.create({
    proposal_id: proposalId,
    truck_id: 'SHP-310',
    from_position: { lane_id: 'LANE-BLR-CHN', km_on_lane: 150 },
    nearest_warehouse_id: 'WH-HOS',
    road_km: 120,
    path: ['LANE-BLR-CHN', 'LANE-CHN-HOS'],
    method: 'ROAD_GRAPH',
    status: 'PENDING',
    proposed_by: 'system',
    reason: 'Nearest viable service hub with maintenance capacity',
    created_at: now,
  });

  // Manager approves reroute proposal (non-reporting user: manager)
  proposal.status = 'APPROVED';
  proposal.decided_by = managerUser._id.toString();
  await proposal.save();

  // Execute reroute
  proposal.status = 'EXECUTED_SIMULATED';
  await proposal.save();

  // Update shipment destination without touching inventory
  const { Warehouse } = await import('../models/warehouses.js');
  const whHos = await Warehouse.findOne({ code: 'WH-HOS' });
  if (whHos) {
    shipment.warehouse_id = whHos._id;
  }
  await shipment.save();

  await writeAudit({
    actor: managerUser._id,
    action: 'REROUTE_APPROVED',
    entityType: 'RerouteProposal',
    entityId: proposalId,
    after: {
      status: 'EXECUTED_SIMULATED',
      new_destination: 'WH-HOS',
    },
  });

  const occupiedSlots = Math.ceil(200 / 10); // 20
  const reservedSlots = 15;
  const totalProjected = occupiedSlots + reservedSlots; // 35
  const utilisationPct = Math.round((totalProjected / zoneChn.capacity_slots) * 100); // 117%

  return {
    damage_event: {
      clip_id: clipId,
      event_id: eventId,
      claim_id: claim.claim_id,
      shipment_code: 'SHP-310',
      previous_eta: previousEta,
      new_eta: updatedShipment?.resolved_eta || updatedShipment?.current_eta || delayedEta,
      delay_hours: 48,
      quarantine_ledger_id: quarantineLedger._id.toString(),
    },
    capacity_event: {
      warehouse_id: 'WH-CHN',
      zone_id: 'ZN-CHN-REC',
      plan_id: inboundPlan._id.toString(),
      capacity_slots: zoneChn.capacity_slots,
      reserved_slots: reservedSlots,
      utilisation_pct: utilisationPct,
      colour: 'RED',
      alert_opened: true,
    },
    reroute_event: {
      driver_id: 'DRV-2',
      incident_id: incident.incident_id,
      proposal_id: proposal.proposal_id,
      nearest_warehouse_id: 'WH-HOS',
      status: 'EXECUTED_SIMULATED',
      approved_by: managerUser.username,
    },
  };
}
