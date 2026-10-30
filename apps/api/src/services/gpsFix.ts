/**
 * apps/api/src/services/gpsFix.ts
 *
 * Validates real device GPS fixes before they become DriverPing rows.
 * Speed comes from the device when it reports one; otherwise it is derived
 * from the distance and time between consecutive fixes.
 */

export const MAX_ACCURACY_M = 100;
export const MAX_PLAUSIBLE_KMH = 180;

export interface RawFix {
  seq: number;
  ts: string | Date;
  lat: number;
  lng: number;
  accuracy_m?: number | null;
  speed_kmh?: number | null;
  heading?: number | null;
}

export interface PrevFix {
  ts: Date;
  lat: number;
  lng: number;
}

export type FixVerdict =
  | { ok: true; speed_kmh: number; moved_m: number; speed_source: 'DEVICE' | 'DERIVED' | 'NONE' }
  | { ok: false; reason: 'INVALID_COORDS' | 'LOW_ACCURACY' | 'OUT_OF_ORDER' | 'TELEPORT' };

/** Precise great-circle distance in kilometres (not rounded). */
export function distanceKmPrecise(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function validateFix(fix: RawFix, prev: PrevFix | null): FixVerdict {
  if (
    !Number.isFinite(fix.lat) ||
    !Number.isFinite(fix.lng) ||
    Math.abs(fix.lat) > 90 ||
    Math.abs(fix.lng) > 180
  ) {
    return { ok: false, reason: 'INVALID_COORDS' };
  }

  if (fix.accuracy_m != null && fix.accuracy_m > MAX_ACCURACY_M) {
    return { ok: false, reason: 'LOW_ACCURACY' };
  }

  const deviceSpeed = fix.speed_kmh != null && fix.speed_kmh >= 0 ? fix.speed_kmh : null;

  if (!prev) {
    return {
      ok: true,
      speed_kmh: Math.round(deviceSpeed ?? 0),
      moved_m: 0,
      speed_source: deviceSpeed != null ? 'DEVICE' : 'NONE',
    };
  }

  const dtHours = (new Date(fix.ts).getTime() - prev.ts.getTime()) / 3_600_000;
  if (dtHours < 0) {
    return { ok: false, reason: 'OUT_OF_ORDER' };
  }

  const movedKm = distanceKmPrecise(prev.lat, prev.lng, fix.lat, fix.lng);
  const impliedKmh = dtHours > 0 ? movedKm / dtHours : 0;

  if (impliedKmh > MAX_PLAUSIBLE_KMH) {
    return { ok: false, reason: 'TELEPORT' };
  }

  const speed = deviceSpeed ?? impliedKmh;
  return {
    ok: true,
    speed_kmh: Math.round(speed),
    moved_m: Math.round(movedKm * 1000),
    speed_source: deviceSpeed != null ? 'DEVICE' : 'DERIVED',
  };
}
