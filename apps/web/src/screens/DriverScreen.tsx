/**
 * apps/web/src/screens/DriverScreen.tsx
 *
 * Driver portal on the device's real GPS.
 *  - Streams real GPS fixes (no simulated movement).
 *  - Route options from the current fix. Green "Go" opens Google Maps and sends the choice to the manager.
 *  - Breakdown prompt: "Would you proceed to pick up its goods?" Proceed opens Google Maps to the broken truck.
 *  - Live manager decision (approved / rejected) over WebSocket.
 *  - Delay report and incident reporting.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Truck,
  AlertTriangle,
  ShieldAlert,
  CloudOff,
  CheckCircle2,
  Route,
  MapPin,
  Gauge,
  Crosshair,
  X,
  Navigation,
} from 'lucide-react';
import { getStoredToken, getStoredUser } from '../api/client.js';
import { enqueuePing, getPendingCount, flushQueue, QueuedPing } from '../services/offlineQueue.js';
import { startGpsWatch, haversineKm, GpsFix } from '../services/gpsWatcher.js';
import { DriverMap, AssistMapItem } from '../ui/DriverMap.js';
import { DelayReportCard } from '../ui/DelayReportCard.js';
import { openGoogleMaps } from '../lib/navigation.js';

const MIN_MOVE_M = 20;
const MAX_PING_INTERVAL_MS = 15000;
const POOR_ACCURACY_M = 100;

interface RouteOption {
  warehouse_code: string;
  name: string;
  lat: number;
  lng: number;
  road_km: number;
  eta_minutes: number;
  inbound_shipments: number;
  score: number;
  is_current: boolean;
  recommended: boolean;
}

interface AssistRequest {
  assist_id: string;
  incident_id: string;
  reason: 'SAME_DESTINATION' | 'ON_ROUTE';
  distance_km: number;
  eta_minutes: number;
  status: string;
  broken: {
    truck_id: string;
    driver_id: string;
    driver_name: string;
    kind: string;
    lat: number;
    lng: number;
    trail: [number, number][];
    destination: { lat: number; lng: number; name: string } | null;
  };
}

export function DriverScreen() {
  const user = getStoredUser();
  const truckId = user?.truck_id || '';
  const driverId = user?.driver_id || '';

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [ageSec, setAgeSec] = useState<number>(0);

  const [options, setOptions] = useState<RouteOption[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [destination, setDestination] = useState<{ lat: number; lng: number; name: string; code: string } | null>(null);
  const [pendingProposal, setPendingProposal] = useState<any | null>(null);

  const [assists, setAssists] = useState<AssistRequest[]>([]);
  const [activeIncident, setActiveIncident] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const seqRef = useRef<number>(1);
  const lastPingRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const flushingRef = useRef<boolean>(false);

  // ── Offline queue flush (guarded so two flushes never overlap) ────────────
  const flush = useCallback(async () => {
    if (!navigator.onLine || flushingRef.current) return;
    flushingRef.current = true;
    setIsSyncing(true);
    try {
      await flushQueue(async (batch) => {
        const res = await fetch('/api/v1/driver/pings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredToken()}` },
          body: JSON.stringify({ pings: batch }),
        });
        if (!res.ok) throw new Error('Flush failed');
        return res.json();
      });
      setPendingCount(await getPendingCount());
      setLastSentAt(Date.now());
    } catch {
      // Pings stay queued until the next flush
    } finally {
      flushingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // ── Connectivity ──────────────────────────────────────────────────────────
  useEffect(() => {
    const up = () => {
      setIsOnline(true);
      flush();
    };
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    getPendingCount().then(setPendingCount).catch(() => {});
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [flush]);

  // ── Starting state from the server ────────────────────────────────────────
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    fetch('/api/v1/tracking/trucks', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { trucks: [] }))
      .then((data) => {
        const mine = (data.trucks || []).find((t: any) => t.truck_id === truckId);
        if (!mine) return;
        if (mine.position?.seq) seqRef.current = mine.position.seq + 1;
        if (mine.active_incident) setActiveIncident(mine.active_incident.kind);
        if (mine.pending_proposal) setPendingProposal(mine.pending_proposal);
      })
      .catch(() => {});
  }, [truckId]);

  // ── Real GPS stream ───────────────────────────────────────────────────────
  useEffect(() => {
    const stop = startGpsWatch(
      (f) => {
        setGpsError(null);
        setFix(f);

        const last = lastPingRef.current;
        const now = Date.now();
        const movedM = last ? haversineKm(last.lat, last.lng, f.lat, f.lng) * 1000 : Infinity;
        const poorAccuracy = f.accuracy_m != null && f.accuracy_m > POOR_ACCURACY_M;

        if (!poorAccuracy && (!last || movedM >= MIN_MOVE_M || now - last.at >= MAX_PING_INTERVAL_MS)) {
          lastPingRef.current = { lat: f.lat, lng: f.lng, at: now };
          setTrail((t) => [...t.slice(-300), [f.lat, f.lng]]);

          const ping: QueuedPing = {
            seq: seqRef.current++,
            ts: f.ts,
            lat: f.lat,
            lng: f.lng,
            speed_kmh: f.speed_kmh != null ? Math.round(f.speed_kmh) : 0,
            accuracy_m: f.accuracy_m,
            heading: f.heading,
            truck_id: truckId,
            driver_id: driverId,
          };
          enqueuePing(ping)
            .then(() => getPendingCount())
            .then((c) => {
              setPendingCount(c);
              if (navigator.onLine) flush();
            })
            .catch(() => {});
        }
      },
      (msg) => setGpsError(msg),
    );
    return stop;
  }, [truckId, driverId, flush]);

  // Age of the last fix
  useEffect(() => {
    const t = setInterval(() => {
      if (fix) setAgeSec(Math.max(0, Math.round((Date.now() - new Date(fix.ts).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [fix]);

  // ── Route options from the server, based on the latest accepted GPS fix ──
  const loadOptions = useCallback(async () => {
    const token = getStoredToken();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/driver/route-options', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) {
        setOptionsError(data.message || 'Route options unavailable');
        return;
      }
      setOptionsError(null);
      setOptions(data.options);
      const current = data.options.find((o: RouteOption) => o.is_current);
      if (current) {
        setDestination((d) => d ?? { lat: current.lat, lng: current.lng, name: current.name, code: current.warehouse_code });
      }
    } catch {
      setOptionsError('Network error loading route options');
    }
  }, []);

  useEffect(() => {
    loadOptions();
    const t = setInterval(loadOptions, 60000);
    return () => clearInterval(t);
  }, [loadOptions]);

  // ── Assist requests: load, then receive live over WebSocket ───────────────
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    fetch('/api/v1/driver/assist', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { assists: [] }))
      .then((d) => setAssists(d.assists || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'auth_ok') {
          ws?.send(JSON.stringify({ type: 'subscribe', topic: 'driver' }));
          ws?.send(JSON.stringify({ type: 'subscribe', topic: 'warehouses' }));
        }
        if (msg.type !== 'event' || !msg.data) return;
        if (msg.topic === 'warehouses') {
          loadOptions();
          return;
        }
        if (msg.topic !== 'driver') return;

        const d = msg.data;
        if (d.type === 'ASSIST_REQUEST' && d.assist) {
          setAssists((prev) => [d.assist, ...prev.filter((a) => a.assist_id !== d.assist.assist_id)]);
          setStatusMessage(`Breakdown nearby: ${d.assist.broken.driver_name}'s truck needs help.`);
        }
        if (d.type === 'ASSIST_ACCEPTED') {
          setStatusMessage('A nearby driver accepted your assist request.');
        }
        if (d.type === 'REROUTE_DECIDED') {
          setPendingProposal(null);
          if (d.decision === 'APPROVED') {
            if (d.lat != null && d.lng != null) {
              setDestination({ lat: d.lat, lng: d.lng, name: d.warehouse_name ?? d.warehouse_code, code: d.warehouse_code });
            }
            setStatusMessage(`Manager approved: go to ${d.warehouse_name ?? d.warehouse_code}.`);
          } else {
            setStatusMessage(`Manager rejected the route change${d.reason ? `: ${d.reason}` : ''}. Keep to your current destination.`);
          }
          loadOptions();
        }
      };
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, [loadOptions]);

  // ── Actions ───────────────────────────────────────────────────────────────

  /** Green "Go": opens Google Maps now and sends the choice to the manager. */
  const goToWarehouse = async (opt: RouteOption) => {
    // Synchronous: opened before any await so the browser does not block it
    const opened = openGoogleMaps({ lat: opt.lat, lng: opt.lng }, fix ? { lat: fix.lat, lng: fix.lng } : null);
    if (!opened) setStatusMessage('Your browser blocked the map. Allow pop-ups for this site, then press Go again.');

    try {
      const res = await fetch('/api/v1/driver/route-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredToken()}` },
        body: JSON.stringify({ warehouse_code: opt.warehouse_code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.message || 'Could not send your route choice');
        return;
      }
      setPendingProposal(data.proposal);
      setStatusMessage(
        `Google Maps opened for ${opt.name}. The manager has been asked to confirm; the manager's decision is final.`,
      );
    } catch {
      setStatusMessage('Network error sending your route choice');
    }
  };

  /** Breakdown prompt "Proceed": opens Google Maps to the broken truck and accepts the assist. */
  const proceedToBrokenTruck = async (a: AssistRequest) => {
    const opened = openGoogleMaps(
      { lat: a.broken.lat, lng: a.broken.lng },
      fix ? { lat: fix.lat, lng: fix.lng } : null,
    );
    if (!opened) setStatusMessage('Your browser blocked the map. Allow pop-ups for this site, then press Proceed again.');
    await respondAssist(a.assist_id, 'ACCEPTED');
  };

  const respondAssist = async (assistId: string, decision: 'ACCEPTED' | 'DECLINED') => {
    try {
      const res = await fetch(`/api/v1/driver/assist/${assistId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredToken()}` },
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        setAssists((prev) => prev.map((x) => (x.assist_id === assistId ? { ...x, status: decision } : x)));
        if (decision === 'ACCEPTED') setStatusMessage('Assist accepted. Follow Google Maps to the broken truck.');
      } else {
        const data = await res.json().catch(() => ({}));
        setStatusMessage(data.message || 'Could not update the assist request');
      }
    } catch {
      setStatusMessage('Network error');
    }
  };

  const reportIncident = async (kind: 'BREAKDOWN' | 'ACCIDENT') => {
    try {
      const res = await fetch('/api/v1/driver/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getStoredToken()}` },
        body: JSON.stringify({
          kind,
          idempotency_key: `INC-${driverId}-${Date.now()}`,
          ts: new Date().toISOString(),
          gps: fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, ts: fix.ts } : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveIncident(kind);
        if (data.proposal) setPendingProposal(data.proposal);
        setStatusMessage(
          fix
            ? `${kind} reported at your live GPS position. Nearby drivers are being alerted.`
            : `${kind} reported without GPS. Location taken from the last accepted ping.`,
        );
      } else {
        setStatusMessage('Incident was not accepted. Try again.');
      }
    } catch {
      setStatusMessage('Network error reporting incident. Try again.');
    }
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const speedKmh = fix?.speed_kmh != null ? Math.round(fix.speed_kmh) : null;
  const fixPoor = fix?.accuracy_m != null && fix.accuracy_m > POOR_ACCURACY_M;
  const activeAssists = assists.filter((a) => a.status === 'SUGGESTED' || a.status === 'ACCEPTED');

  // Live straight-line distance from this device to each broken truck; nearest is flagged
  const withLiveDistance = activeAssists.map((a) => ({
    a,
    liveKm: fix ? haversineKm(fix.lat, fix.lng, a.broken.lat, a.broken.lng) : null,
  }));
  const nearestId =
    withLiveDistance
      .filter((x) => x.liveKm != null)
      .sort((x, y) => (x.liveKm as number) - (y.liveKm as number))[0]?.a.assist_id ?? null;

  const mapAssists: AssistMapItem[] = activeAssists.map((a) => ({ assist_id: a.assist_id, broken: a.broken }));
  const destRoadKm = destination ? options.find((o) => o.warehouse_code === destination.code)?.road_km : undefined;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md">
            <Truck className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Truck {truckId}</h1>
            <p className="text-sm text-slate-500">Driver: {user?.display_name || driverId}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {gpsError ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold">
              <Crosshair className="w-4 h-4" />
              <span>{gpsError}</span>
            </div>
          ) : fix ? (
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${
                fixPoor ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              <Crosshair className="w-4 h-4" />
              <span>
                GPS ±{fix.accuracy_m != null ? Math.round(fix.accuracy_m) : '?'} m • {ageSec}s ago
                {fixPoor && ' (poor accuracy, not sent)'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 border border-slate-200 text-slate-600 rounded-xl text-xs font-bold">
              <Crosshair className="w-4 h-4 animate-pulse" />
              <span>Waiting for GPS fix…</span>
            </div>
          )}

          {pendingCount > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold">
              <CloudOff className="w-4 h-4 text-amber-600" />
              <span>{pendingCount} pending sync</span>
              {isOnline && (
                <button onClick={flush} disabled={isSyncing} className="ml-1 underline">
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              <span>{lastSentAt ? `Synced ${new Date(lastSentAt).toLocaleTimeString()}` : 'Live telemetry'}</span>
            </div>
          )}
        </div>
      </div>

      {statusMessage && (
        <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-sm text-indigo-800 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-indigo-500 hover:text-indigo-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Live stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">
            <Gauge className="w-4 h-4 text-indigo-600" /> Speed (GPS)
          </div>
          <div className="text-2xl font-black text-indigo-600">{speedKmh != null ? `${speedKmh} km/h` : '—'}</div>
          <div className="text-xs text-slate-500 mt-1">{speedKmh == null ? 'Device not reporting speed yet' : 'Reported by device'}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">
            <MapPin className="w-4 h-4 text-indigo-600" /> Destination
          </div>
          <div className="text-lg font-black text-slate-900">{destination?.name ?? 'Not set'}</div>
          <div className="text-xs text-slate-500 mt-1">
            {destRoadKm != null ? `≈ ${destRoadKm} km by road (estimate)` : 'Choose a warehouse below'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Your position</div>
          <div className="text-sm font-mono text-slate-800">{fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : '—'}</div>
          <div className="text-xs text-slate-500 mt-1">{fix ? `Device time ${new Date(fix.ts).toLocaleTimeString()}` : 'No fix yet'}</div>
        </div>
      </div>

      {/* Map */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="h-[420px] md:h-[500px]">
          <DriverMap
            own={fix ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, trail } : null}
            destination={destination}
            assists={mapAssists}
          />
        </div>
        <div className="px-4 py-2 text-xs text-slate-500 border-t border-slate-200">
          Blue: your truck (live GPS). Green: destination. Red: broken-down truck and its route. Amber: your road to the broken truck.
        </div>
      </div>

      {/* Breakdown prompt */}
      {withLiveDistance.map(({ a, liveKm }) => (
        <div key={a.assist_id} className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-8 h-8 text-rose-600 shrink-0" />
            <div className="flex-1 space-y-2">
              <h3 className="text-base font-bold text-rose-900">
                Vehicle {a.broken.truck_id} has broken down at this location
                {a.assist_id === nearestId && (
                  <span className="ml-2 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 align-middle">
                    NEAREST TO YOU
                  </span>
                )}
              </h3>
              <p className="text-sm text-rose-900">
                {a.broken.driver_name}&apos;s truck ({a.broken.kind.toLowerCase()}).{' '}
                {liveKm != null
                  ? `${liveKm.toFixed(1)} km from you in a straight line, about ${a.distance_km} km by road.`
                  : `About ${a.distance_km} km by road.`}{' '}
                {a.reason === 'SAME_DESTINATION'
                  ? 'You are heading to the same warehouse.'
                  : 'It is on your route, so you will pass it.'}
              </p>
              <p className="text-sm font-bold text-rose-900">Would you proceed to pick up its goods?</p>

              {a.status === 'SUGGESTED' ? (
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    onClick={() => proceedToBrokenTruck(a)}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center gap-2"
                  >
                    <Navigation className="w-4 h-4" /> Proceed (open Google Maps)
                  </button>
                  <button
                    onClick={() => respondAssist(a.assist_id, 'DECLINED')}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-sm"
                  >
                    Not now
                  </button>
                </div>
              ) : (
                <p className="text-sm font-bold text-emerald-700">Accepted. Follow Google Maps to the broken truck.</p>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Route choice */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Route className="w-4 h-4 text-indigo-600" /> Choose warehouse (from live GPS)
        </h2>
        {optionsError && <p className="text-sm text-rose-700">{optionsError}</p>}
        {pendingProposal && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
            Waiting for the manager&apos;s decision • {pendingProposal.status} • Proposal #{pendingProposal.proposal_id}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {options.map((o) => (
            <div
              key={o.warehouse_code}
              className={`p-4 rounded-xl border-2 ${
                destination?.code === o.warehouse_code ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900">{o.name}</span>
                {o.recommended && (
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    RECOMMENDED
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-600 mt-1">
                ≈ {o.road_km} km • ≈ {o.eta_minutes} min • {o.inbound_shipments} inbound shipments
              </div>

              {o.is_current ? (
                <div className="text-[11px] text-indigo-700 font-bold mt-2">Current assignment</div>
              ) : (
                <button
                  onClick={() => goToWarehouse(o)}
                  className="mt-3 w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2"
                >
                  <Navigation className="w-4 h-4" /> Go to {o.name}
                </button>
              )}
            </div>
          ))}
          {options.length === 0 && !optionsError && (
            <p className="text-sm text-slate-500 md:col-span-3">Warehouse options appear once GPS has a fix.</p>
          )}
        </div>
      </div>

      <DelayReportCard truckId={truckId} />

      {/* Incidents */}
      {activeIncident && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 flex items-center gap-3">
          <ShieldAlert className="w-6 h-6 text-rose-600" />
          <div className="text-sm font-bold text-rose-900">Active incident: {activeIncident}. Hazard lights on. Stay safe.</div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-3">Report at my live location</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => reportIncident('BREAKDOWN')}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-bold rounded-xl shadow-md transition-transform"
          >
            <AlertTriangle className="w-5 h-5" />
            <span>Report Breakdown</span>
          </button>
          <button
            onClick={() => reportIncident('ACCIDENT')}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold rounded-xl shadow-md transition-transform"
          >
            <ShieldAlert className="w-5 h-5" />
            <span>Report Accident</span>
          </button>
        </div>
      </div>
    </div>
  );
}
