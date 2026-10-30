/**
 * apps/web/src/utils/normalize.ts
 *
 * Normalization helpers for API responses and warehouse identifiers.
 */

/** Accepts a raw array or an object wrapping the array; always returns an array. */
export function pickArray(res: any, ...keys: string[]): any[] {
  if (Array.isArray(res)) return res;
  for (const k of keys) {
    if (Array.isArray(res?.[k])) return res[k];
  }
  return [];
}

const WH_CODES = ['WH-HOS', 'WH-CHN', 'WH-BLR'];

/** Operators' warehouse_id is a Mongo ObjectId; zones/CCTV use the code (WH-BLR). */
export function resolveWarehouseCode(user: any): string {
  const raw = user?.warehouse_id;
  if (typeof raw === 'string' && WH_CODES.includes(raw)) return raw;

  const uname = String(user?.username || '').toLowerCase();
  if (uname.includes('blr')) return 'WH-BLR';
  if (uname.includes('chn')) return 'WH-CHN';
  if (uname.includes('hos')) return 'WH-HOS';
  return 'WH-HOS';
}

