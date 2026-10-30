/**
 * apps/web/src/ui/WarehouseSiteMap.tsx
 *
 * Real-world warehouse site map.
 * - Satellite / street tiles (Leaflet)
 * - Manager/Admin click the building corners (geoman) -> polygon -> Save
 * - Footprint is stored on the warehouse as [[lat, lng], ...]
 */
import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, LayersControl, Polygon, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { api } from '../api/client.js';

type LatLngTuple = [number, number];

/** Approximate polygon area in square metres (fine for building-sized shapes). */
function areaM2(pts: LatLngTuple[]): number {
  if (pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map(([la, ln]) => [ln * mLng, la * 111132]);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[(i + 1) % xy.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Geoman toolbar: draw tools when there is no footprint yet, edit/move tools once there is. */
function GeomanToolbar({
  hasShape,
  onCreated,
}: {
  hasShape: boolean;
  onCreated: (pts: LatLngTuple[]) => void;
}) {
  const map = useMap();
  const cbRef = useRef(onCreated);
  cbRef.current = onCreated;

  useEffect(() => {
    const pm = (map as any).pm;
    if (!pm) return;
    pm.setGlobalOptions({ allowSelfIntersection: false, snappable: false });

    const handleCreate = (e: any) => {
      const ring: L.LatLng[] = e.layer.getLatLngs()[0];
      map.removeLayer(e.layer); // re-rendered from React state instead
      cbRef.current(
        ring.map((ll) => [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))] as LatLngTuple),
      );
    };
    map.on('pm:create', handleCreate);
    return () => {
      map.off('pm:create', handleCreate);
      pm.removeControls();
    };
  }, [map]);

  useEffect(() => {
    const pm = (map as any).pm;
    if (!pm) return;
    pm.removeControls();
    pm.addControls({
      position: 'topleft',
      drawPolygon: !hasShape,
      drawRectangle: !hasShape,
      editMode: hasShape,
      dragMode: hasShape,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });
  }, [map, hasShape]);

  return null;
}

/** Zoom to the footprint (or the warehouse point) once, on first render. */
function FitOnce({ shape, center }: { shape: LatLngTuple[] | null; center: LatLngTuple | null }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    if (shape && shape.length >= 3) {
      map.fitBounds(L.latLngBounds(shape), { padding: [40, 40], maxZoom: 19 });
      done.current = true;
    } else if (center) {
      map.setView(center, 17);
      done.current = true;
    }
  }, [map, shape, center]);
  return null;
}

export function WarehouseSiteMap({
  warehouseCode,
  canEdit,
}: {
  warehouseCode: string;
  canEdit: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [center, setCenter] = useState<LatLngTuple | null>(null);
  const [saved, setSaved] = useState<LatLngTuple[] | null>(null);
  const [shape, setShape] = useState<LatLngTuple[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rev, setRev] = useState(0); // forces the polygon layer to rebuild after save/discard
  const [map, setMap] = useState<L.Map | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const res: any = await api.capacity.getFootprints();
      const list: any[] = Array.isArray(res) ? res : res?.warehouses ?? [];
      const wh = list.find((w) => w.code === warehouseCode);
      if (!wh) throw new Error(`Warehouse ${warehouseCode} not found`);
      const fp: LatLngTuple[] | null =
        Array.isArray(wh.footprint) && wh.footprint.length >= 3 ? wh.footprint : null;
      setName(wh.name || warehouseCode);
      setCenter(wh.lat != null && wh.lng != null ? [wh.lat, wh.lng] : null);
      setSaved(fp);
      setShape(fp);
      setDirty(false);
      setRev((r) => r + 1);
    } catch (e: any) {
      setError(e.message || 'Failed to load warehouse site');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [warehouseCode]);

  const handleCreated = (pts: LatLngTuple[]) => {
    setShape(pts);
    setDirty(true);
    setRev((r) => r + 1);
  };

  const handleLayerEdited = (e: any) => {
    const ring: L.LatLng[] = e.layer.getLatLngs()[0];
    setShape(ring.map((ll) => [Number(ll.lat.toFixed(7)), Number(ll.lng.toFixed(7))] as LatLngTuple));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      if (shape) await api.capacity.saveFootprint(warehouseCode, shape);
      else await api.capacity.clearFootprint(warehouseCode);
      await load();
    } catch (e: any) {
      alert(`Could not save footprint: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setShape(saved);
    setDirty(false);
    setRev((r) => r + 1);
  };

  const handleRemove = () => {
    if (!window.confirm(`Remove the saved footprint of ${warehouseCode}?`)) return;
    setShape(null);
    setDirty(true);
    setRev((r) => r + 1);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !map) return;
    try {
      setSearching(true);
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      );
      const j = await r.json();
      if (!Array.isArray(j) || j.length === 0) {
        alert('Place not found. Try a more specific address.');
        return;
      }
      map.flyTo([parseFloat(j[0].lat), parseFloat(j[0].lon)], 18);
    } catch {
      alert('Search failed. Check your internet connection.');
    } finally {
      setSearching(false);
    }
  };

  if (loading && !saved && !shape) {
    return (
      <div className="p-8 bg-white rounded-xl border border-slate-200 shadow-sm text-center text-sm text-slate-500">
        Loading site map…
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800">
        {error}{' '}
        <button className="underline font-semibold" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  const startCenter: LatLngTuple = center ?? [20.5937, 78.9629];
  const startZoom = center ? 17 : 5;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-slate-900 text-sm">
            {name} <span className="font-mono text-xs text-slate-500">({warehouseCode})</span> · Site footprint
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {shape
              ? `Footprint: ${shape.length} corners · about ${Math.round(areaM2(shape)).toLocaleString()} m²`
              : 'No footprint saved yet for this warehouse.'}
            {dirty && <span className="ml-2 font-semibold text-amber-600">Unsaved changes</span>}
          </p>
        </div>

        <form onSubmit={handleSearch} className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find address or place…"
            className="border border-slate-300 rounded px-2 py-1.5 text-xs w-56"
          />
          <button
            type="submit"
            disabled={searching}
            className="text-xs px-3 py-1.5 rounded bg-slate-800 text-white font-medium disabled:opacity-50"
          >
            {searching ? '…' : 'Go'}
          </button>
        </form>
      </div>

      {canEdit && !shape && (
        <div className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-lg px-3 py-2">
          <strong>Mark this warehouse:</strong> zoom in on the building (use the search box), pick the
          polygon tool at the top-left of the map, click each corner of the building, then click the first
          point again to close the shape and press <strong>Save footprint</strong>. Use the rectangle tool for
          square buildings.
        </div>
      )}
      {canEdit && shape && (
        <div className="text-xs bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-2">
          To adjust, use the <strong>edit</strong> tool (top-left) and drag the corner points, or the{' '}
          <strong>move</strong> tool to shift the whole building. Then save.
        </div>
      )}
      {!canEdit && (
        <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-3 py-2">
          View only. Switch to the Manager or Administrator role to mark or change a footprint.
        </div>
      )}

      <div className="relative isolate w-full h-[560px] rounded-lg border border-slate-300 overflow-hidden">
        <MapContainer
          ref={setMap as any}
          center={startCenter}
          zoom={startZoom}
          maxZoom={21}
          style={{ width: '100%', height: '100%' }}
        >
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Satellite">
              <TileLayer
                attribution="Tiles &copy; Esri, Maxar, Earthstar Geographics"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={19}
                maxZoom={21}
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Street map">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxNativeZoom={19}
                maxZoom={21}
              />
            </LayersControl.BaseLayer>
          </LayersControl>

          <FitOnce shape={saved} center={center} />
          {canEdit && <GeomanToolbar hasShape={!!shape} onCreated={handleCreated} />}

          {!shape && center && (
            <CircleMarker
              center={center}
              radius={7}
              pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.9 }}
            />
          )}

          {shape && (
            <Polygon
              key={`${warehouseCode}-${rev}`}
              positions={shape}
              pathOptions={{
                color: dirty ? '#f59e0b' : '#4f46e5',
                fillColor: dirty ? '#f59e0b' : '#4f46e5',
                fillOpacity: 0.25,
                weight: 3,
                dashArray: dirty ? '6, 4' : undefined,
              }}
              eventHandlers={{
                'pm:edit': handleLayerEdited,
                'pm:dragend': handleLayerEdited,
              } as any}
            />
          )}
        </MapContainer>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="text-xs px-3.5 py-2 rounded-md bg-indigo-600 text-white font-semibold disabled:opacity-40"
          >
            {saving ? 'Saving…' : shape ? 'Save footprint' : 'Save (remove footprint)'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={!dirty || saving}
            className="text-xs px-3.5 py-2 rounded-md border border-slate-300 text-slate-700 font-medium disabled:opacity-40"
          >
            Discard changes
          </button>
          {shape && (
            <button
              onClick={handleRemove}
              disabled={saving}
              className="text-xs px-3.5 py-2 rounded-md border border-rose-300 text-rose-700 font-medium ml-auto disabled:opacity-40"
            >
              Remove footprint
            </button>
          )}
        </div>
      )}
    </div>
  );
}

