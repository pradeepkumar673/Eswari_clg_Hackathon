/**
 * apps/api/src/services/demoReset.ts
 *
 * Deterministic demo reset service.
 * Wipes and re-seeds the full demo state — called by POST /admin/demo/reset.
 * Delegates all seed logic to the same seed script used by db:seed.
 *
 * After reset the database state is identical to running `npm run db:seed`.
 */

import { seed } from './seedData.js';

export async function runDemoReset(): Promise<{ ok: boolean; message: string }> {
  try {
    await seed(process.env.MONGODB_URI, false);
    return { ok: true, message: 'Demo state reset successfully' };
  } catch (err: any) {
    return { ok: false, message: err.message || String(err) };
  }
}
