/**
 * apps/web/src/screens/TrackingScreen.tsx
 *
 * Screen 9: Leaflet Live Map & Vehicle Telemetry Radar.
 * Features:
 * - Real-time WebSocket connection to /ws on topic 'tracking'.
 * - Exponential backoff reconnection (1s -> 2s -> 4s -> ... -> 30s).
 * - "Live feed paused" indicator when disconnected; never shows stale data as live.
 * - MAP_TILE_URL fallback: plain SVG/CSS grid when unset (no tile requests, zero 404s).
 * - Trucks from WebSocket + initial API /tracking/trucks fetch.
 * - Warehouses, suppliers, and transfer lane polylines.
 * - STRAIGHT_LINE_ESTIMATE dashed markers with "Estimate, off road network".
 * - Click truck to open telemetry drawer: position, speed, last ping time, destination, active incident, proposal status.
 */

import { useState, useEffect, useRef } from 'react';
import { MapContainer, Polyline, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import {
  Navigation,
  Truck,
  AlertTriangle,
  Clock,
  X,
  Radio,
} from 'lucide-react';
import { getStoredToken } from '../api/client.js';

const MAP_TILE_URL = (import.meta as any).env?.VITE_MAP_TILE_URL || '';

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
  destination_warehouse?: {
    id: string;
    code: string;
    name: string;
    lat: number;
    lng: number;
  } | null;
  active_incident?: {
    incident_id: string;
    kind: string;
    ts: string;
  } | null;
  pending_proposal?: {
    proposal_id: string;
    nearest_warehouse_id: string;
    road_km: number;
    status: string;
  } | null;
}

// Custom DivIcons for Leaflet
const createTruckIcon = (isEstimate: boolean) => {
  return L.divIcon({
    className: 'custom-truck-marker',
    html: `
      <div class="relative flex items-center justify-center">
        <div class="w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110 ${
          isEstimate
            ? 'bg-amber-100 border-2 border-dashed border-amber-600 text-amber-700 animate-pulse'
            : 'bg-indigo-600 border-2 border-white text-white'
        }">
          <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zm-1.5 9c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
          </svg>
        </div>
        ${
          isEstimate
            ? '<span class="absolute -bottom-5 whitespace-nowrap bg-amber-600 text-[10px] text-white px-1.5 py-0.5 rounded shadow">Estimate, off road network</span>'
            : ''
        }
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const createNodeIcon = (label: string, isWh: boolean) => {
  return L.divIcon({
    className: 'custom-node-marker',
    html: `
      <div class="flex items-center gap-1 px-2 py-1 rounded shadow-md border text-xs font-semibold ${
        isWh
          ? 'bg-emerald-600 border-emerald-700 text-white'
          : 'bg-blue-600 border-blue-700 text-white'
      }">
        <span class="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
        <span>${label}</span>
      </div>
    `,
    iconSize: [80, 24],
    iconAnchor: [40, 12],
  });
};

export function TrackingScreen() {
  const [trucks, setTrucks] = useState<Map<string, TruckTelemetry>>(new Map());
  const [selectedTruck, setSelectedTruck] = useState<TruckTelemetry | null>(null);
  const [lanes, setLanes] = useState<any[]>([]);
  const [nodes, setNodes] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [reconnectCountdown, setReconnectCountdown] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const backoffRef = useRef<number>(1);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch initial master data
  useEffect(() => {
    const token = getStoredToken();
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

    // Load initial trucks
    fetch('/api/v1/tracking/trucks', { headers })
      .then((res) => (res.ok ? res.json() : { trucks: [] }))
      .then((data) => {
        const map = new Map<string, TruckTelemetry>();
        for (const t of data.trucks || []) {
          map.set(t.truck_id, t);
        }
        setTrucks(map);
        if (data.trucks && data.trucks.length > 0) {
          setLastUpdate(new Date().toLocaleTimeString());
        }
      })
      .catch(() => {});

    // Load route nodes & lanes
    fetch('/api/v1/warehouses', { headers })
      .then((res) => (res.ok ? res.json() : []))
      .then((whs) => {
        fetch('/api/v1/suppliers', { headers })
          .then((res) => (res.ok ? res.json() : []))
          .then((sups) => {
            const allNodes = [
              ...(whs || []).map((w: any) => ({ ...w, isWh: true })),
              ...(sups || []).map((s: any) => ({ ...s, isWh: false })),
            ];
            setNodes(allNodes);

            // Fetch transfer lanes
            fetch('/api/v1/transfer-lanes', { headers })
              .then((res) => (res.ok ? res.json() : []))
              .then((laneData) => {
                setLanes(laneData || []);
              })
              .catch(() => {});
          });
      })
      .catch(() => {});
  }, []);

  // WebSocket live feed connection with exponential backoff (1, 2, 4, ... 30s)
  useEffect(() => {
    let unmounted = false;

    function connectWs() {
      if (unmounted) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setReconnectCountdown(null);
        backoffRef.current = 1; // Reset backoff on successful connect

        const token = getStoredToken();
        if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'auth_ok') {
            ws.send(JSON.stringify({ type: 'subscribe', topic: 'tracking' }));
          }

          if (msg.type === 'event' && msg.topic === 'tracking') {
            const data = msg.data;
            if (data && data.type === 'TRUCK_POSITION') {
              setTrucks((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(data.truck_id) || {
                  truck_id: data.truck_id,
                  driver_id: data.driver_id,
                  position: null,
                };
                const newPos = {
                  lat: data.lat,
                  lng: data.lng,
                  speed_kmh: data.speed_kmh,
                  lane_id: data.lane_id,
                  km_on_lane: data.km_on_lane,
                  method: data.lane_id ? ('ROAD_GRAPH' as const) : ('STRAIGHT_LINE_ESTIMATE' as const),
                  ts: data.ts,
                  seq: data.seq,
                };
                const newTruck: TruckTelemetry = {
                  ...existing,
                  position: newPos,
                };
                updated.set(data.truck_id, newTruck);
                return updated;
              });
              setLastUpdate(new Date().toLocaleTimeString());
            }

            if (data && data.type === 'REROUTE_EXECUTED') {
              setTrucks((prev) => {
                const updated = new Map(prev);
                const existing = updated.get(data.truck_id);
                if (existing) {
                  updated.set(data.truck_id, {
                    ...existing,
                    pending_proposal: undefined,
                  });
                }
                return updated;
              });
            }
          }
        } catch {}
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

      ws.onerror = () => {
        ws.close();
      };
    }

    connectWs();

    return () => {
      unmounted = true;
      if (socketRef.current) socketRef.current.close();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Compute lane polyline coordinates
  const lanePolylines = lanes
    .map((lane) => {
      const from = nodes.find((n) => n._id === lane.from_warehouse_id);
      const to = nodes.find((n) => n._id === lane.to_warehouse_id);
      if (from?.lat && from?.lng && to?.lat && to?.lng) {
        return {
          id: lane._id,
          coords: [
            [from.lat, from.lng] as [number, number],
            [to.lat, to.lng] as [number, number],
          ],
          distance_km: lane.distance_km,
        };
      }
      return null;
    })
    .filter(Boolean);

  const trucksList = Array.from(trucks.values());

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] flex flex-col bg-slate-100">
      {/* Top Telemetry Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <Navigation className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">Live Driver Telemetry Radar</h1>
            <p className="text-xs text-slate-500">
              Active Fleet: {trucksList.length} trucks | Corridor Network: Hosur, Chennai, Bengaluru
            </p>
          </div>
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-4">
          {isConnected ? (
            <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
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

      {/* Main Map Container */}
      <div className="relative flex-1 w-full h-full">
        <MapContainer
          center={[12.95, 78.5]}
          zoom={8}
          scrollWheelZoom={true}
          className="w-full h-full"
          style={{
            backgroundColor: '#f8fafc',
            backgroundImage: MAP_TILE_URL
              ? 'none'
              : 'radial-gradient(#cbd5e1 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        >
          {/* Tile Layer: ONLY if MAP_TILE_URL is set; otherwise plain background grid */}
          {MAP_TILE_URL && <TileLayer url={MAP_TILE_URL} />}

          {/* Lane Polylines */}
          {lanePolylines.map((l) => (
            <Polyline
              key={l!.id}
              positions={l!.coords}
              color="#6366f1"
              weight={3}
              opacity={0.7}
              dashArray="4, 4"
            />
          ))}

          {/* Warehouse & Supplier Nodes */}
          {nodes.map((node) => {
            if (!node.lat || !node.lng) return null;
            return (
              <Marker
                key={node._id}
                position={[node.lat, node.lng]}
                icon={createNodeIcon(node.code, node.isWh)}
              >
                <Popup>
                  <div className="p-2 text-xs">
                    <div className="font-bold text-slate-900">{node.name}</div>
                    <div className="text-slate-500">{node.code}</div>
                    <div className="mt-1 text-slate-600">
                      Coordinates: {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                    </div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Live Trucks */}
          {trucksList.map((truck) => {
            if (!truck.position?.lat || !truck.position?.lng) return null;
            const isEstimate = truck.position.method === 'STRAIGHT_LINE_ESTIMATE';

            return (
              <Marker
                key={truck.truck_id}
                position={[truck.position.lat, truck.position.lng]}
                icon={createTruckIcon(isEstimate)}
                eventHandlers={{
                  click: () => setSelectedTruck(truck),
                }}
              >
                <Popup>
                  <div className="p-2 text-xs">
                    <div className="font-bold text-slate-900">Truck {truck.truck_id}</div>
                    <div className="text-slate-500">Driver: {truck.driver_id}</div>
                    <div className="mt-1 font-mono text-indigo-600">
                      Speed: {truck.position.speed_kmh} km/h
                    </div>
                    {isEstimate && (
                      <div className="mt-1 text-amber-600 font-medium">
                        ⚠️ Estimate, off road network
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Selected Truck Detail Drawer */}
        {selectedTruck && (
          <div className="absolute top-4 right-4 w-96 bg-white border border-slate-200 rounded-xl shadow-xl z-[1000] p-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Truck className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900">Truck {selectedTruck.truck_id}</h3>
              </div>
              <button
                onClick={() => setSelectedTruck(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Driver ID:</span>
                <span className="font-semibold text-slate-800">{selectedTruck.driver_id}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Current Speed:</span>
                <span className="font-semibold text-slate-800">
                  {selectedTruck.position?.speed_kmh ?? 0} km/h
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Telemetry Method:</span>
                <span
                  className={`font-semibold ${
                    selectedTruck.position?.method === 'STRAIGHT_LINE_ESTIMATE'
                      ? 'text-amber-600'
                      : 'text-emerald-600'
                  }`}
                >
                  {selectedTruck.position?.method || 'N/A'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Coordinates:</span>
                <span className="font-mono text-slate-800">
                  {selectedTruck.position?.lat.toFixed(4)}, {selectedTruck.position?.lng.toFixed(4)}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Last Ping Time:</span>
                <span className="font-mono text-slate-600">
                  {selectedTruck.position?.ts
                    ? new Date(selectedTruck.position.ts).toLocaleTimeString()
                    : 'N/A'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Assigned Destination:</span>
                <span className="font-semibold text-slate-900">
                  {selectedTruck.destination_warehouse?.name || 'In-transit'} (
                  {selectedTruck.destination_warehouse?.code || 'WH'})
                </span>
              </div>

              {/* Active Incident */}
              {selectedTruck.active_incident && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center gap-1.5 text-red-700 font-bold">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Active Incident: {selectedTruck.active_incident.kind}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-red-600">
                    Reported at {new Date(selectedTruck.active_incident.ts).toLocaleTimeString()}
                  </div>
                </div>
              )}

              {/* Pending Proposal */}
              {selectedTruck.pending_proposal && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-1.5 text-amber-800 font-bold">
                    <Radio className="w-4 h-4 text-amber-600" />
                    <span>Reroute Proposal Pending</span>
                  </div>
                  <div className="mt-1 text-slate-700">
                    Recommended Hub:{' '}
                    <span className="font-bold">
                      {selectedTruck.pending_proposal.nearest_warehouse_id}
                    </span>{' '}
                    ({selectedTruck.pending_proposal.road_km} km)
                  </div>
                  <div className="mt-1 text-[11px] text-amber-700">
                    Awaiting Supply Chain Manager approval
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
