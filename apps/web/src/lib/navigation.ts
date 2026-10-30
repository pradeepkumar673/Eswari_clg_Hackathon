/**
 * apps/web/src/lib/navigation.ts
 *
 * Opens Google Maps directions. On Android and iOS the link opens the Maps app.
 * On a laptop it opens maps.google.com in a new tab. Google shows the road distance and ETA.
 */

export interface Point {
  lat: number;
  lng: number;
}

export function googleMapsDirectionsUrl(destination: Point, origin?: Point | null): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.lat},${destination.lng}`,
    travelmode: 'driving',
  });
  if (origin) params.set('origin', `${origin.lat},${origin.lng}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * MUST be called synchronously inside a click handler, before any await.
 * Returns false if the browser blocked the pop-up.
 */
export function openGoogleMaps(destination: Point, origin?: Point | null): boolean {
  return window.open(googleMapsDirectionsUrl(destination, origin), '_blank') !== null;
}

