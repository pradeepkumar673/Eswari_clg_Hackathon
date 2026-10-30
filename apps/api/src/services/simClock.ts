/**
 * apps/api/src/services/simClock.ts
 *
 * Simulation clock service. All "now" values in business logic come from here.
 * Never use new Date() in business logic — call simClock.now() instead.
 *
 * Priority (highest first):
 *  1. SIM_NOW env variable (set at process start; overrides everything)
 *  2. settings collection key 'sim_now' (admin-configurable at runtime)
 *  3. Real wall-clock time (fallback for production)
 */

import mongoose from 'mongoose';
import { Setting } from '../models/settings.js';

let _cachedSimNow: Date | null = null;
let _cacheExpiry = 0;
const CACHE_TTL_MS = 5_000; // re-read from DB at most every 5 seconds

export const simClock = {
  /**
   * Returns the current simulated time.
   * - In tests: caller can set SIM_NOW env or call simClock.set()
   * - In demo: admin calls POST /admin/sim-clock to set the settings doc
   */
  async now(): Promise<Date> {
    // Env variable wins (fastest, set at startup)
    if (process.env.SIM_NOW) {
      return new Date(process.env.SIM_NOW);
    }

    // DB cache with TTL
    const wallNow = Date.now();
    if (_cachedSimNow && wallNow < _cacheExpiry) {
      return _cachedSimNow;
    }

    try {
      if (mongoose.connection.readyState === 1) {
        const setting = await Setting.findOne({ key: 'sim_now' }).lean();
        if (setting?.value) {
          _cachedSimNow = new Date(setting.value as string);
          _cacheExpiry = wallNow + CACHE_TTL_MS;
          return _cachedSimNow;
        }
      }
    } catch {
      // If DB is unavailable, fall through to wall clock
    }

    // Fallback: real wall-clock
    return new Date();
  },

  /**
   * Override the sim clock in-process (useful in test setup).
   * Pass null to revert to DB/env/wall-clock.
   */
  set(date: Date | null): void {
    if (date === null) {
      _cachedSimNow = null;
      _cacheExpiry = 0;
    } else {
      _cachedSimNow = date;
      _cacheExpiry = Date.now() + 24 * 3_600_000; // 24h
    }
  },

  /** Invalidate the DB cache (call after admin updates the settings doc) */
  invalidateCache(): void {
    _cachedSimNow = null;
    _cacheExpiry = 0;
  },
};

