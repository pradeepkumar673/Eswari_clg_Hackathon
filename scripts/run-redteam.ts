/**
 * scripts/run-redteam.ts
 *
 * CLI for running DisruptionIQ Red-Team Adversarial Suite (S3).
 * Usage: npm run redteam
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../apps/api/src/db.js';
import { runRedTeamSuite } from '../apps/api/src/services/redTeam.js';
import { User } from '../apps/api/src/models/users.js';

async function main() {
  console.log('[redteam] Connecting to MongoDB...');
  await connectDB();

  let admin = await User.findOne({ role: 'Administrator' });
  const adminId = admin ? admin._id : new mongoose.Types.ObjectId();

  console.log('[redteam] Executing 15 adversarial bypass attempts...');
  const result = await runRedTeamSuite(adminId);

  console.log('\n--- RED TEAM ADVERSARIAL REPORT ---');
  console.log(`Total Attempts: ${result.total_attempts}`);
  console.log(`Blocked: ${result.blocked_count}`);
  console.log(`Failed: ${result.failed_count}`);
  console.log(`All Blocked: ${result.all_blocked}`);

  console.log('\nDetailed Results:');
  for (const a of result.attempts) {
    console.log(`  [#${a.id}] ${a.name} -> ${a.status} (${a.actual_status}) [Audit: ${a.audit_row_id}]`);
  }

  await mongoose.disconnect();

  if (!result.all_blocked) {
    console.error(`\n[redteam] FAILED: ${result.failed_count} bypass attempt(s) were not blocked!`);
    process.exit(1);
  } else {
    console.log(`\n[redteam] SUCCESS: All ${result.total_attempts} bypass attempts were successfully BLOCKED and audited.`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[redteam] Unexpected error:', err);
  process.exit(1);
});
