/**
 * scripts/seed-investigation.ts
 *
 * Feeds real shipment events into the Disruption Investigation screen.
 * Every event goes through the real reconciler (the same path as carrier
 * webhooks, field-report confirmation and the driver app), so the Belief-ETA,
 * audit trail, conflict detection and live WebSocket pushes are genuine.
 *
 * Safe to re-run: external_event_ids are stable, so repeats come back as DUPLICATE.
 *
 * Run:  npx tsx scripts/seed-investigation.ts
 */
import mongoose from 'mongoose';
import { connectDB } from '../apps/api/src/db.js';
import { ensureIndexes } from '../apps/api/src/models/index.js';
import { Shipment } from '../apps/api/src/models/shipments.js';
import { reconcile, type IncomingEvent } from '../apps/api/src/services/reconciler.js';
import { simClock } from '../apps/api/src/services/simClock.js';

const HOUR = 3_600_000;

interface Plan {
  code: string;
  source: IncomingEvent['source'];
  event_type: 'ETA_UPDATE' | 'DELAY_REPORT';
  /** Reported ETA = promised ETA + this many hours. */
  hours_after_promise: number;
  tag: string;
  reason: string;
  location?: string;
}

// Mirrors the figures on the current screen (SHP-205 +20h, SHP-203 +16h, etc.)
// and adds one deliberate disagreement on SHP-202 so Accept/Reject appears.
const PLAN: Plan[] = [
  { code: 'SHP-205', source: 'CARRIER_API', event_type: 'ETA_UPDATE', hours_after_promise: 20, tag: 'carrier-1', reason: 'Carrier re-planned after port queue' },
  { code: 'SHP-203', source: 'CARRIER_API', event_type: 'ETA_UPDATE', hours_after_promise: 16, tag: 'carrier-1', reason: 'Vehicle breakdown reported by carrier' },
  { code: 'SHP-202', source: 'FIELD_REPORT', event_type: 'ETA_UPDATE', hours_after_promise: 12, tag: 'field-1', reason: 'Site staff estimate from gate log' },
  { code: 'SHP-202', source: 'SUPPLIER_PORTAL', event_type: 'ETA_UPDATE', hours_after_promise: 3, tag: 'supplier-1', reason: 'Supplier says dispatch was on time' },
  { code: 'SHP-312', source: 'CARRIER_API', event_type: 'ETA_UPDATE', hours_after_promise: 2, tag: 'carrier-1', reason: 'Minor traffic delay' },
  { code: 'SHP-204', source: 'DRIVER_DEVICE', event_type: 'DELAY_REPORT', hours_after_promise: 2, tag: 'driver-1', reason: 'Stopped at toll plaza', location: 'NH44 toll plaza' },
];

async function main() {
  await connectDB();
  await ensureIndexes();
  const now = await simClock.now();

  for (const p of PLAN) {
    const shipment: any = await Shipment.findOne({ code: p.code }).lean();
    if (!shipment) {
      console.log(`[seed-investigation] skip ${p.code}: not in database (run db:seed first)`);
      continue;
    }

    const reportedEta = new Date(new Date(shipment.promised_eta).getTime() + p.hours_after_promise * HOUR);

    const result = await reconcile({
      source: p.source,
      external_event_id: `SEED-${p.code}-${p.tag}-${p.source}`,
      event_type: p.event_type,
      shipment_code: p.code,
      reported_eta: reportedEta,
      event_time: now,
      raw_payload: {
        reason: p.reason,
        delay_hours: p.hours_after_promise,
        location: p.location ?? null,
        seeded: true,
      },
      correlation_id: `seed-investigation-${p.code}-${p.source}`,
    });

    console.log(
      `[seed-investigation] ${p.code} ${p.source} ${p.event_type} -> ${result.status}: ${result.reason}`,
    );
  }

  await mongoose.disconnect();
  console.log('[seed-investigation] Done. Open /investigation to see the results.');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('[seed-investigation] Error:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

