/**
 * scripts/run-scenario-c.ts
 *
 * CLI for running Scenario C (Demo Day Synthetic Flow).
 * Usage: npm run scenario:c
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../apps/api/src/db.js';
import { User } from '../apps/api/src/models/users.js';
import { runScenarioC } from '../apps/api/src/services/scenarioC.js';

async function main() {
  console.log('[scenario:c] Connecting to MongoDB...');
  await connectDB();

  console.log('[scenario:c] Executing Scenario C synthetic flow...');
  const res = await runScenarioC();

  console.log('\n--- SCENARIO C EXECUTION SUMMARY ---');
  console.log('1. DAMAGE DETECTION & CLAIM:');
  console.log(`   Shipment: ${res.damage_event.shipment_code}`);
  console.log(`   Claim ID: ${res.damage_event.claim_id}`);
  console.log(`   Delay: +${res.damage_event.delay_hours}h (New ETA: ${res.damage_event.new_eta.toISOString()})`);
  console.log(`   Quarantine Ledger ID: ${res.damage_event.quarantine_ledger_id}`);

  console.log('\n2. CAPACITY & OVER-CAPACITY ALERT:');
  console.log(`   Warehouse: ${res.capacity_event.warehouse_id} (Zone: ${res.capacity_event.zone_id})`);
  console.log(`   Utilisation: ${res.capacity_event.utilisation_pct}% -> Colour: ${res.capacity_event.colour}`);
  console.log(`   Alert Opened: ${res.capacity_event.alert_opened}`);

  console.log('\n3. DRIVER BREAKDOWN & GOVERNED REROUTE:');
  console.log(`   Driver: ${res.reroute_event.driver_id}`);
  console.log(`   Incident: ${res.reroute_event.incident_id}`);
  console.log(`   Proposal: ${res.reroute_event.proposal_id} -> Rerouted to ${res.reroute_event.nearest_warehouse_id}`);
  console.log(`   Status: ${res.reroute_event.status} (Approved by ${res.reroute_event.approved_by})`);

  await mongoose.disconnect();
  console.log('\n[scenario:c] SUCCESS: Scenario C executed cleanly and state verified.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[scenario:c] Unexpected error:', err);
  process.exit(1);
});
