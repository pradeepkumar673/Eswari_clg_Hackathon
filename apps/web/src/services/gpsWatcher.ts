/**
 * apps/web/src/services/gpsWatcher.ts
 *
 * Streams real device GPS fixes. No simulated movement anywhere.
 * Requires a secure context (HTTPS or localhost) for navigator.geolocation.
 */

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_kmh: number | null; // from device when available (m/s * 3.6)
  heading: number | null;
  ts: string; // ISO time from the device
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Starts watching the device position. Returns a stop function.
 * onError receives a human-readable message; the caller decides what to show.
 */
export function startGpsWatch(
  onFix: (fix: GpsFix) => void,
  onError: (message: string) => void,
): () => void {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
    onError('This device does not provide GPS location.');
    return () => {};
  }

  if (window.isSecureContext === false) {
    onError('Location needs a secure connection (HTTPS). Open the portal over HTTPS.');
    return () => {};
  }

  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      onFix({
        lat: c.latitude,
        lng: c.longitude,
        accuracy_m: c.accuracy ?? null,
        speed_kmh: c.speed != null && c.speed >= 0 ? c.speed * 3.6 : null,
        heading: c.heading ?? null,
        ts: new Date(pos.timestamp).toISOString(),
      });
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        onError('Location permission denied. Allow location for this site to send real GPS.');
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        onError('GPS signal unavailable. Move to an open area or check device location settings.');
      } else {
        onError('GPS timed out. Retrying.');
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );

  return () => navigator.geolocation.clearWatch(watchId);
}
