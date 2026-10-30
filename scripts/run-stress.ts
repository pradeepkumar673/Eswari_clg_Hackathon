/**
 * scripts/run-stress.ts
 *
 * CLI for running DisruptionIQ Stress-Test suite (A11).
 * Usage: npm run stress
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../apps/api/src/db.js';
import { runStressTest } from '../apps/api/src/services/stressTest.js';
import { User } from '../apps/api/src/models/users.js';

async function main() {
  console.log('[stress] Connecting to MongoDB...');
  await connectDB();

  let admin = await User.findOne({ role: 'Administrator' });
  const adminId = admin ? admin._id : new mongoose.Types.ObjectId();

  console.log('[stress] Executing synthetic chaos injectors...');
  const result = await runStressTest({}, adminId);

  console.log('\n--- STRESS TEST REPORT ---');
  console.log(`Passed: ${result.passed}`);
  console.log('Counts:', JSON.stringify(result.counts, null, 2));
  console.log('Integrity Checks:', JSON.stringify(result.integrity_check, null, 2));

  await mongoose.disconnect();

  if (!result.passed) {
    console.error('\n[stress] FAILED: Stress test encountered unhandled errors or integrity violations.');
    process.exit(1);
  } else {
    console.log('\n[stress] SUCCESS: All injectors completed with 0 unhandled errors and full integrity preserved.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[stress] Unexpected error:', err);
  process.exit(1);
});
