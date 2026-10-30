/**
 * scripts/reset.ts — demo reset
 * Runs the full seed (upserts are idempotent).
 * Called by `npm run db:reset`.
 */
import 'dotenv/config';
import { seed } from '../apps/api/src/services/seedData.js';

seed()
  .then(() => {
    console.log('[reset] Demo state reset successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[reset] Error:', err);
    process.exit(1);
  });
