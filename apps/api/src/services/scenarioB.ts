/**
 * apps/api/src/services/scenarioB.ts
 *
 * Scenario B generator for the "Send duplicate storm" demo:
 * - Sends EVT-2001 for SHP-310 five times → 1 APPLIED + 4 DUPLICATE
 * - Sends EVT-1999 (older event_time) → STALE
 * - Sends EVT-CONFLICT from SUPPLIER_PORTAL differing by 9 hours → CONFLICT
 *
 * Returns counts from real DB results.
 */

import { reconcile, IncomingEvent, ReconcileResult } from './reconciler.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { withTransaction } from '../db/withTransaction.js';

export interface ScenarioBResult {
  sent: number;
  applied: number;
  duplicates: number;
  stale: number;
  conflicts: number;
}

export async function runScenarioB(shipmentCode: string = 'SHP-310'): Promise<ScenarioBResult> {
  const results: ReconcileResult[] = [];

  // Step 1: Send EVT-2001 five times (should be 1 APPLIED + 4 DUPLICATE)
  const baseEvent: IncomingEvent = {
    source: 'CARRIER_API',
    external_event_id: 'EVT-2001',
    event_type: 'ETA_UPDATE',
    shipment_code: shipmentCode,
    reported_eta: new Date('2026-11-03T06:00:00Z'),
    event_time: new Date('2026-11-01T10:00:00Z'),
    raw_payload: {
      external_event_id: 'EVT-2001',
      shipment_code: shipmentCode,
      event_type: 'ETA_UPDATE',
      reported_eta: '2026-11-03T06:00:00Z',
      event_time: '2026-11-01T10:00:00Z',
    },
    correlation_id: 'scenario-b-dup-storm',
  };

  for (let i = 0; i < 5; i++) {
    const r = await withTransaction((session) => reconcile(baseEvent, session));
    results.push(r);
  }

  // Step 2: Send EVT-1999 with older event_time → STALE
  const staleEvent: IncomingEvent = {
    source: 'CARRIER_API',
    external_event_id: 'EVT-1999',
    event_type: 'ETA_UPDATE',
    shipment_code: shipmentCode,
    reported_eta: new Date('2026-11-02T06:00:00Z'),
    event_time: new Date('2026-10-31T08:00:00Z'), // older than EVT-2001's event_time
    raw_payload: {
      external_event_id: 'EVT-1999',
      shipment_code: shipmentCode,
      event_type: 'ETA_UPDATE',
      reported_eta: '2026-11-02T06:00:00Z',
      event_time: '2026-10-31T08:00:00Z',
    },
    correlation_id: 'scenario-b-stale',
  };
  const staleResult = await withTransaction((session) => reconcile(staleEvent, session));
  results.push(staleResult);

  // Step 3: Send EVT-CONFLICT from SUPPLIER_PORTAL with ETA differing by 9 hours → CONFLICT
  // CARRIER_API applied ETA is 2026-11-03T06:00:00Z
  // SUPPLIER_PORTAL sends 2026-11-03T15:00:00Z (+9h > 4h tolerance)
  const conflictEvent: IncomingEvent = {
    source: 'SUPPLIER_PORTAL',
    external_event_id: 'EVT-CONFLICT',
    event_type: 'ETA_UPDATE',
    shipment_code: shipmentCode,
    reported_eta: new Date('2026-11-03T15:00:00Z'),
    event_time: new Date('2026-11-01T11:00:00Z'),
    raw_payload: {
      external_event_id: 'EVT-CONFLICT',
      shipment_code: shipmentCode,
      event_type: 'ETA_UPDATE',
      reported_eta: '2026-11-03T15:00:00Z',
      event_time: '2026-11-01T11:00:00Z',
    },
    correlation_id: 'scenario-b-conflict',
  };
  const conflictResult = await withTransaction((session) => reconcile(conflictEvent, session));
  results.push(conflictResult);

  // Count from real DB (authoritative)
  const externalIds = ['EVT-2001', 'EVT-1999', 'EVT-CONFLICT'];
  const dbEvents = await ShipmentEvent.find({
    external_event_id: { $in: externalIds },
    shipment_id: { $exists: true },
  }).lean();

  const dbApplied = dbEvents.filter((e) => e.reconcile_status === 'APPLIED').length;
  const dbStale = dbEvents.filter((e) => e.reconcile_status === 'STALE').length;
  const dbConflict = dbEvents.filter((e) => e.reconcile_status === 'CONFLICT').length;

  // DUPLICATE is detected before DB insert, so count from results array
  const dupCount = results.filter((r) => r.status === 'DUPLICATE').length;

  return {
    sent: results.length,
    applied: dbApplied,
    duplicates: dupCount,
    stale: dbStale,
    conflicts: dbConflict,
  };
}
