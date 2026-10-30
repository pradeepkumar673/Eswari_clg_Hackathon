/**
 * apps/web/src/screens/TrackingScreen.tsx
 * Live Driver Map: live trucks, warehouses, lanes, and live breakdown and accident markers.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, Polyline, Marker, Popup, TileLayer, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, Clock, X, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { getStoredToken, getStoredUser } from '../api/client.js';
import { useWarehouses } from '../hooks/useWarehouses.js';
import { useIncidents, IncidentRecord } from '../hooks/useIncidents.js';

const MAP_TILE_URL =
  (import.meta as any).env?.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface TruckTelemetry {
  truck_id: string;
  driver_id: string;
  driver_name?: string;
  position: {
    lat: number;
    lng: number;
    speed_kmh: number;
    lane_id: string | null;
    km_on_lane: number | null;
    method: 'ROAD_GRAPH' | 'STRAIGHT_LINE_ESTIMATE';
    ts: string;
    seq: number;
  } | null;
  destination_warehouse?: { id: string; code: string; name: string; lat: number; lng: number } | null;
  active_incident?: { incident_id: string; kind: string; ts: string } | null;
  pending_proposal?: { proposal_id: string; nearest_warehouse_id: string; road_km: number; status: string } | null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const truckIcon = (isEstimate: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="width:30px;height:30px;border-radius:9999px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35);border:2px ${isEstimate ? 'dashed #b45309' : 'solid #fff'};background:${isEstimate ? '#fef3c7' : '#4f46e5'};color:${isEstimate ? '#b45309' : '#fff'};font-size:14px">🚚</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

const nodeIcon = (label: string, isWh: boolean) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;color:#fff;background:${isWh ? '#059669' : '#2563eb'};box-shadow:0 1px 4px rgba(0,0,0,.3);white-space:nowrap">${escapeHtml(label)}</div>`,
    iconSize: [80, 22],
    iconAnchor: [40, 11],
  });

const incidentIcon = (label: string) =>
  L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      <div style="width:26px;height:26px;border-radius:9999px;background:#e11d48;border:3px solid #fff;box-shadow:0 0 0 6px rgba(225,29,72,.25)"></div>
      <div style="margin-top:4px;background:#9f1239;color:#fff;font-size:11px;font-weight:700;padding:1px 6px;border-radius:4px;white-space:nowrap">${escapeHtml(label)}</div>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

function canClear(incident: IncidentRecord): boolean {
  const u = getStoredUser();
  if (!u) return false;
  if (u.role === 'Manager' || u.role === 'Administrator') return true;
  return u.role?.toUpperCase() === 'DRIVER' && u.driver_id === incident.driver_id;
}

export function TrackingScreen() {
  const { warehouses } = useWarehouses();
  const { incidents, live: incidentsLive, clear } = useIncidents();

  const [trucks, setTrucks] = useState<Map<string, TruckTelemetry>>(new Map());
  const [selectedTruck, setSelectedTruck] = useState<TruckTelemetry | null>(null);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [lanes, setLanes] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef<number>(1);

  // Initial trucks, suppliers and lanes
  useEffect(() => {
    const token = getStoredToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    fetch('/api/v1/tracking/trucks', { headers })
      .then((r) => (r.ok ? r.json() : { trucks: [] }))
      .then((data) => {
        const map = new Map<string, TruckTelemetry>();
        for (const t of data.trucks || []) map.set(t.truck_id, t);
        setTrucks(map);
        if (data.trucks?.length) setLastUpdate(new Date().toLocaleTimeString());
      })
      .catch(() => {});

    fetch('/api/v1/suppliers', { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((s) => setSuppliers(s || []))
      .catch(() => {});

    fetch('/api/v1/transfer-lanes', { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((l) => setLanes(l || []))
      .catch(() => {});
  }, []);

  // Live truck positions over the tracking topic, with exponential backoff reconnect
  useEffect(() => {
    let unmounted = false;

    function connectWs() {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setReconnectCountdown(null);
        backoffRef.current = 1;
        const token = getStoredToken();
        if (token) ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'auth_ok') ws.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));

          if (msg.type === 'event' && msg.topic === 'tracking') {
            const data = msg.data;
            if (data?.type === 'TRUCK_POSITION') {
              setTrucks((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(data.truck_id) || { truck_id: data.truck_id, driver_id: data.driver_id, position: null };
                updated.set(data.truck_id, {
                  ...existing,
                  position: {
                    lat: data.lat,
                    lng: data.lng,
                    speed_kmh: data.speed_kmh,
                    lane_id: data.lane_id,
                    km_on_lane: data.km_on_lane,
                    method: data.lane_id ? 'ROAD_GRAPH' : 'STRAIGHT_LINE_ESTIMATE',
                    ts: data.ts,
                    seq: data.seq,
                  },
                });
                return updated;
              });
              setLastUpdate(new Date().toLocaleTimeString());
            }
            if (data?.type === 'REROUTE_EXECUTED') {
              setTrucks((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(data.truck_id);
                if (existing) updated.set(data.truck_id, { ...existing, pending_proposal: undefined });
                return updated;
              });
            }
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (unmounted) return;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(30, backoffRef.current * 2);
        setReconnectCountdown(delay);
        let remaining = delay;
        const countdownTimer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(countdownTimer);
            connectWs();
          } else {
            setReconnectCountdown(remaining);
          }
        }, 1000);
      };

      ws.onerror = () => ws.close();
    }

    connectWs();
    return () => {
      unmounted = true;
      socketRef.current?.close();
    };
  }, []);

  const nodes = useMemo(
    () => [
      ...warehouses.map((w) => ({ ...w, isWh: true })),
      ...suppliers.map((s) => ({ ...s, isWh: false })),
    ],
    [warehouses, suppliers],
  );

  const lanePolylines = lanes
    .map((lane) => {
      const from = nodes.find((n: any) => n._id === lane.from_warehouse_id);
      const to = nodes.find((n: any) => n._id === lane.to_warehouse_id);
      if (from?.lat && from?.lng && to?.lat && to?.lng) {
        return {
          id: lane._id,
          coords: [[from.lat, from.lng], [to.lat, to.lng]] as [number, number][],
        };
      }
      return null;
    })
    .filter(Boolean) as { id: string; coords: [number, number][] }[];

  const trucksList = Array.from(trucks.values());
  const mappedIncidents = incidents.filter((i) => i.lat != null && i.lng != null);

  const handleClear = async (incidentId: string) => {
    setClearError(null);
    try {
      await clear(incidentId);
    } catch (e: any) {
      setClearError(e.message || 'Could not clear the incident');
    }
  };

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex flex-col bg-slate-100">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Live Driver Telemetry Radar</h1>
            <p className="text-xs text-slate-500">
              Active fleet: {trucksList.length} trucks • Open breakdowns: {incidents.length} • Warehouses: {warehouses.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-medium border ${
              incidentsLive ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}
          >
            {incidentsLive ? 'Incident feed live' : 'Incident feed reconnecting'}
          </span>
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live feed active</span>
              {lastUpdate && <span className="text-emerald-500 font-mono">({lastUpdate})</span>}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium rounded-full">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <span>
                Live feed paused {lastUpdate ? `(last: ${lastUpdate})` : ''}
                {reconnectCountdown !== null && ` • Reconnecting in ${reconnectCountdown}s`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Breakdown panel */}
      {incidents.length > 0 && (
        <div className="absolute top-20 left-4 z-[900] w-80 bg-white border-2 border-rose-200 rounded-xl shadow-xl max-h-[60vh] overflow-y-auto">
          <div className="px-4 py-3 border-b border-rose-100 flex items-center gap-2 text-rose-800 font-bold text-sm">
            <AlertTriangle className="w-4 h-4" /> Breakdowns and accidents ({incidents.length})
          </div>
          {clearError && <div className="px-4 py-2 text-xs text-rose-700 bg-rose-50">{clearError}</div>}
          <div className="divide-y divide-slate-100">
            {incidents.map((i) => (
              <div key={i.incident_id} className="px-4 py-3 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">
                    {i.driver_name ?? i.driver_id} • {i.truck_id}
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">{i.kind}</span>
                </div>
                <div className="text-slate-600">
                  {new Date(i.ts).toLocaleTimeString()}
                  {i.destination_code ? ` • heading to ${i.destination_code}` : ''}
                </div>
                <div className="font-mono text-slate-500">
                  {i.lat != null && i.lng != null ? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}` : 'Position not sent'}
                </div>
                {canClear(i) && (
                  <button
                    onClick={() => handleClear(i.incident_id)}
                    className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> Mark cleared
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Map */}
      <div className="relative flex-1 w-full h-full">
        <MapContainer
          center={[12.95, 78.5]}
          zoom={8}
          scrollWheelZoom
          className="w-full h-full"
          style={{ backgroundColor: '#f8fafc' }}
        >
          <TileLayer url={MAP_TILE_URL} />

          {lanePolylines.map((l) => (
            <Polyline key={l.id} positions={l.coords} color="#6366f1" weight={3} opacity={0.7} dashArray="4, 4" />
          ))}

          {nodes.map((node: any) => {
            if (!node.lat || !node.lng) return null;
            return (
              <Marker key={node._id} position={[node.lat, node.lng]} icon={nodeIcon(node.code, node.isWh)}>
                <Popup>
                  <div className="p-2 text-xs">
                    <div className="font-bold text-slate-900">{node.name}</div>
                    <div className="text-slate-500">{node.code}</div>
                    <div className="mt-1 text-slate-600">
                      {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {trucksList.map((truck) => {
            if (!truck.position?.lat || !truck.position?.lng) return null;
            const isEstimate = truck.position.method === 'STRAIGHT_LINE_ESTIMATE';
            const broken = !!truck.active_incident;
            return (
              <span key={truck.truck_id}>
                {broken && (
                  <CircleMarker
                    center={[truck.position.lat, truck.position.lng]}
                    radius={18}
                    pathOptions={{ color: '#e11d48', weight: 2, fillOpacity: 0.12 }}
                  />
                )}
                <Marker
                  position={[truck.position.lat, truck.position.lng]}
                  icon={truckIcon(isEstimate)}
                  eventHandlers={{ click: () => setSelectedTruck(truck) }}
                >
                  <Popup>
                    <div className="p-2 text-xs">
                      <div className="font-bold text-slate-900">Truck {truck.truck_id}</div>
                      <div className="text-slate-500">{truck.driver_name ?? truck.driver_id}</div>
                      <div className="mt-1 font-mono text-indigo-600">Speed: {truck.position.speed_kmh} km/h</div>
                      {broken && <div className="mt-1 font-bold text-rose-700">Breakdown reported</div>}
                    </div>
                  </Popup>
                </Marker>
              </span>
            );
          })}

          {/* Live breakdowns and accidents: red markers, with the driver's name */}
          {mappedIncidents.map((i) => (
            <Marker
              key={`inc-${i.incident_id}`}
              position={[i.lat as number, i.lng as number]}
              icon={incidentIcon(`${i.kind === 'ACCIDENT' ? 'ACCIDENT' : 'BREAKDOWN'} • ${i.driver_name ?? i.driver_id}`)}
              zIndexOffset={1000}
            >
              <Popup>
                <div className="p-2 text-xs space-y-1 min-w-[200px]">
                  <div className="font-bold text-rose-800">
                    {i.kind === 'ACCIDENT' ? 'Accident' : 'Breakdown'} • {i.truck_id}
                  </div>
                  <div className="text-slate-900">Driver: {i.driver_name ?? i.driver_id}</div>
                  <div className="text-slate-600">Reported {new Date(i.ts).toLocaleString('en-IN')}</div>
                  <div className="font-mono text-slate-600">
                    {(i.lat as number).toFixed(5)}, {(i.lng as number).toFixed(5)}
                    {i.accuracy_m != null ? ` (±${Math.round(i.accuracy_m)} m)` : ''}
                  </div>
                  {i.destination_code && <div className="text-slate-600">Heading to {i.destination_code}</div>}
                  {canClear(i) && (
                    <button
                      onClick={() => handleClear(i.incident_id)}
                      className="mt-1 w-full px-2 py-1 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                    >
                      Mark cleared
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Truck drawer */}
        {selectedTruck && (
          <div className="absolute top-4 right-4 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-[1000] p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-900">Truck {selectedTruck.truck_id}</h3>
              <button onClick={() => setSelectedTruck(null)} className="p-1 rounded-md text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-slate-500">Driver</span><span className="font-semibold">{selectedTruck.driver_name ?? selectedTruck.driver_id}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Speed</span><span className="font-semibold">{selectedTruck.position?.speed_kmh ?? 0} km/h</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Destination</span><span className="font-semibold">{selectedTruck.destination_warehouse?.name ?? 'In transit'}</span></div>
              {selectedTruck.active_incident && (
                <div className="mt-2 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 font-bold flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> {selectedTruck.active_incident.kind} reported
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
