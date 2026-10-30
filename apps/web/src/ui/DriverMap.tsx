/**
 * apps/web/src/ui/DriverMap.tsx
 *
 * Driver map: own live position (real GPS), own trail, chosen destination,
 * and for each assist request the broken truck's position, trail, destination,
 * and the road from this driver to the broken truck. Assist routes are drawn
 * automatically as soon as the request arrives.
 *
 * Road geometry comes from an OSRM-compatible server when VITE_ROUTING_URL is
 * set. Otherwise a dashed straight line is drawn and labelled as such.
 */

import { Fragment, useEffect, useState } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URL =
  (import.meta as any).env?.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ROUTING_URL: string = (import.meta as any).env?.VITE_ROUTING_URL || '';

type LatLng = [number, number];

export interface AssistMapItem {
  assist_id: string;
  broken: {
    lat: number;
    lng: number;
    driver_name: string;
    trail: LatLng[];
    destination: { lat: number; lng: number; name: string } | null;
  };
}

export interface DriverMapProps {
  own: { lat: number; lng: number; accuracy_m: number | null; trail: LatLng[] } | null;
  destination: { lat: number; lng: number; name: string } | null;
  assists: AssistMapItem[];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function markerIcon(color: string, label: string) {
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:30px;height:30px;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35)"></div>
      <div style="margin-top:4px;background:#0f172a;color:#fff;font-size:11px;padding:1px 6px;border-radius:4px;white-space:nowrap">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

async function fetchRoadPath(a: LatLng, b: LatLng, signal: AbortSignal): Promise<{ coords: LatLng[]; road: boolean }> {
  if (ROUTING_URL) {
    try {
      const url = `${ROUTING_URL}/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = await res.json();
        const coords: [number, number][] | undefined = data.routes?.[0]?.geometry?.coordinates;
        if (coords && coords.length > 1) {
          return { coords: coords.map(([lng, lat]) => [lat, lng] as LatLng), road: true };
        }
      }
    } catch {
      // Fall through to straight line
    }
  }
  return { coords: [a, b], road: false };
}

/** A road-following line that falls back to a dashed straight line. */
function RoadLine({ from, to, color }: { from: LatLng; to: LatLng; color: string }) {
  const [coords, setCoords] = useState<LatLng[]>([from, to]);
  const [isRoad, setIsRoad] = useState(false);
  const key = `${from[0]},${from[1]}|${to[0]},${to[1]}`;

  useEffect(() => {
    const ac = new AbortController();
    fetchRoadPath(from, to, ac.signal).then((r) => {
      if (!ac.signal.aborted) {
        setCoords(r.coords);
        setIsRoad(r.road);
      }
    });
    return () => ac.abort();
    // key captures from/to; re-fetch only when the endpoints actually change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <Polyline
      positions={coords}
      pathOptions={{ color, weight: 5, opacity: 0.85, dashArray: isRoad ? undefined : '6,6' }}
    />
  );
}

function Follow({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat != null && lng != null) map.panTo([lat, lng], { animate: true });
  }, [lat, lng, map]);
  return null;
}

export function DriverMap({ own, destination, assists }: DriverMapProps) {
  const center: LatLng = own
    ? [own.lat, own.lng]
    : destination
      ? [destination.lat, destination.lng]
      : [12.95, 78.5];

  return (
    <MapContainer center={center} zoom={11} scrollWheelZoom className="w-full h-full">
      <TileLayer url={TILE_URL} />

      {own && (
        <>
          <CircleMarker
            center={[own.lat, own.lng]}
            radius={Math.min(40, Math.max(6, (own.accuracy_m ?? 20) / 2))}
            pathOptions={{ color: '#4f46e5', weight: 1, fillOpacity: 0.12 }}
          />
          <Marker position={[own.lat, own.lng]} icon={markerIcon('#4f46e5', 'You (GPS)')} />
          {own.trail.length > 1 && (
            <Polyline positions={own.trail} pathOptions={{ color: '#4f46e5', weight: 3, opacity: 0.5 }} />
          )}
        </>
      )}

      {own && destination && (
        <>
          <RoadLine from={[own.lat, own.lng]} to={[destination.lat, destination.lng]} color="#4f46e5" />
          <Marker position={[destination.lat, destination.lng]} icon={markerIcon('#059669', destination.name)} />
        </>
      )}

      {assists.map((a) => (
        <Fragment key={a.assist_id}>
          {a.broken.trail.length > 1 && (
            <Polyline positions={a.broken.trail} pathOptions={{ color: '#e11d48', weight: 3, opacity: 0.6 }} />
          )}
          <Marker
            position={[a.broken.lat, a.broken.lng]}
            icon={markerIcon('#e11d48', `${a.broken.driver_name} (broken down)`)}
          />
          {a.broken.destination && (
            <RoadLine
              from={[a.broken.lat, a.broken.lng]}
              to={[a.broken.destination.lat, a.broken.destination.lng]}
              color="#e11d48"
            />
          )}
          {own && (
            <RoadLine from={[own.lat, own.lng]} to={[a.broken.lat, a.broken.lng]} color="#f59e0b" />
          )}
        </Fragment>
      ))}

      <Follow lat={own?.lat ?? null} lng={own?.lng ?? null} />
    </MapContainer>
  );
}
