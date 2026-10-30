/**
 * scripts/seed.ts  —  DisruptionIQ demo seed CLI
 *
 * Populates the database with all Scenario A, Scenario B, add-on and
 * micro-feature data as specified in docs/BLUEPRINT.md section 8.
 *
 * Usage:
 *   npm run db:seed
 *   DEMO_PASSWORD=secret npm run db:seed
 */

import 'dotenv/config';
import { seed } from '../apps/api/src/services/seedData.js';

export { seed };

const isMainModule = process.argv[1]?.includes('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isMainModule) {
  seed()
    .then(() => {
      console.log('[seed] Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[seed] Error:', err);
      process.exit(1);
    });
}
