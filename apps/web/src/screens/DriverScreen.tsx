/**
 * apps/web/src/screens/DriverScreen.tsx
 *
 * Driver portal driven by the device's real GPS.
 *  - Streams every meaningful GPS fix (>= 20 m moved, or 15 s elapsed) to the server
 *    through the IndexedDB offline queue. There is no simulated movement.
 *  - Live map with own position, trail and destination.
 *  - Route options ranked by road distance and inbound demand, computed from the
 *    current GPS fix. Choosing one submits a proposal that a manager approves.
 *  - Breakdown assist: when a nearby driver's truck breaks down on your route or
 *    shares your destination, the broken truck's position and route appear on the
 *    map automatically.
 *  - Incident reports carry the current GPS fix so the server knows where it happened.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Truck,
  AlertTriangle,
  ShieldAlert,
  CloudOff,
  CheckCircle2,
  Radio,
  Route,
  MapPin,
  Gauge,
  Crosshair,
  X,
} from 'lucide-react';
import { getStoredToken, getStoredUser } from '../api/client.js';
import { enqueuePing, getPendingCount, flushQueue, QueuedPing } from '../services/offlineQueue.js';
import { startGpsWatch, haversineKm, GpsFix } from '../services/gpsWatcher.js';
import { DriverMap, AssistMapItem } from '../ui/DriverMap.js';
import { DelayReportCard } from '../ui/DelayReportCard.js';

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

interface AssistRequest extends AssistMapItem {
  incident_id: string;
  reason: 'SAME_DESTINATION' | 'ON_ROUTE';
  distance_km: number;
  eta_minutes: number;
  status: string;
  responder: { truck_id: string; driver_id: string };
  broken: AssistMapItem['broken'] & { kind: string; truck_id: string };
}

export function DriverScreen() {
  const user = getStoredUser();
  const truckId = user?.truck_id || '';
  const driverId = user?.driver_id || '';

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const [fix, setFix] = useState<GpsFix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [trail, setTrail] = useState<[number, number][]>([]);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
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
  const token = getStoredToken();

  const authJson = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  // ── Connectivity ───────────────────────────────────────────────────────────
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
    // flush is stable enough for this single mount; it reads refs and the token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Initial truck state (last sequence number, pending proposal, incident) ─
  useEffect(() => {
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
  }, [token, truckId]);

  // ── Offline queue flush ────────────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;
    setIsSyncing(true);
    try {
      await flushQueue(async (batch) => {
        const res = await fetch('/api/v1/driver/pings', {
          method: 'POST',
          headers: authJson,
          body: JSON.stringify({ pings: batch }),
        });
        if (!res.ok) throw new Error('Flush failed');
        return await res.json();
      });
      const remaining = await getPendingCount();
      setPendingCount(remaining);
      setLastSentAt(Date.now());
    } catch {
      // Pings stay in IndexedDB until the next flush
    } finally {
      setIsSyncing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncing, token]);

  // ── Real GPS stream ────────────────────────────────────────────────────────
  useEffect(() => {
    const stop = startGpsWatch(
      (f) => {
        setGpsError(null);
        setFix(f);

        const last = lastPingRef.current;
        const now = Date.now();
        const movedM = last ? haversineKm(last.lat, last.lng, f.lat, f.lng) * 1000 : Infinity;
        const poorAccuracy = f.accuracy_m != null && f.accuracy_m > POOR_ACCURACY_M;

        // Keep the fix on screen always; only send when it is useful
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
    // flush is intentionally read at call time
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [truckId, driverId]);

  // Age of last fix, shown so the driver knows whether the position is fresh
  useEffect(() => {
    const t = setInterval(() => {
      if (fix) setAgeSec(Math.max(0, Math.round((Date.now() - new Date(fix.ts).getTime()) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [fix]);

  // ── Route options from the server, using the latest real fix ──────────────
  const loadOptions = useCallback(async () => {
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
      if (current && !destination) {
        setDestination({ lat: current.lat, lng: current.lng, name: current.name, code: current.warehouse_code });
      }
    } catch {
      setOptionsError('Network error loading route options');
    }
    // destination is seeded once from the assigned warehouse
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    loadOptions();
    const t = setInterval(loadOptions, 60000);
    return () => clearInterval(t);
  }, [loadOptions]);

  // ── Assist requests: load on mount, then receive live over WebSocket ──────
  useEffect(() => {
    if (!token) return;
    fetch('/api/v1/driver/assist', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { assists: [] }))
      .then((d) => setAssists(d.assists || []))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
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
        if (msg.type === 'auth_ok') ws?.send(JSON.stringify({ type: 'subscribe', topic: 'driver' }));
        if (msg.type === 'event' && msg.topic === 'driver' && msg.data) {
          const d = msg.data;
          if (d.type === 'ASSIST_REQUEST' && d.assist) {
            setAssists((prev) => [d.assist, ...prev.filter((a) => a.assist_id !== d.assist.assist_id)]);
            setStatusMessage(`Breakdown assist: ${d.assist.broken.driver_name} needs help, ${d.assist.distance_km} km away.`);
          }
          if (d.type === 'ASSIST_ACCEPTED') {
            setStatusMessage('A nearby driver accepted your assist request.');
          }
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
  }, [token]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const chooseRoute = async (opt: RouteOption) => {
    try {
      const res = await fetch('/api/v1/driver/route-select', {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ warehouse_code: opt.warehouse_code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMessage(data.message || 'Could not submit route');
        return;
      }
      setDestination({ lat: opt.lat, lng: opt.lng, name: opt.name, code: opt.warehouse_code });
      setPendingProposal(data.proposal);
      setStatusMessage(`Route to ${opt.name} submitted. Waiting for manager approval.`);
    } catch {
      setStatusMessage('Network error submitting route');
    }
  };

  const respondAssist = async (assistId: string, decision: 'ACCEPTED' | 'DECLINED') => {
    try {
      const res = await fetch(`/api/v1/driver/assist/${assistId}/respond`, {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ decision }),
      });
      if (res.ok) {
        setAssists((prev) => prev.map((a) => (a.assist_id === assistId ? { ...a, status: decision } : a)));
        setStatusMessage(decision === 'ACCEPTED' ? 'Assist accepted. Head to the broken truck.' : 'Assist declined.');
      } else {
        const data = await res.json().catch(() => ({}));
        setStatusMessage(data.message || 'Could not update assist');
      }
    } catch {
      setStatusMessage('Network error');
    }
  };

  const reportIncident = async (kind: 'BREAKDOWN' | 'ACCIDENT') => {
    try {
      const res = await fetch('/api/v1/driver/incidents', {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({
          kind,
          idempotency_key: `INC-${driverId}-${Date.now()}`,
          ts: new Date().toISOString(),
          gps: fix
            ? { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, ts: fix.ts }
            : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setActiveIncident(kind);
        if (data.proposal) setPendingProposal(data.proposal);
        setStatusMessage(
          fix
            ? `${kind} reported at your live GPS position. Nearby drivers are being alerted.`
            : `${kind} reported without GPS (no fix yet). Location taken from last ping.`,
        );
      } else {
        setStatusMessage('Incident was not accepted. Try again.');
      }
    } catch {
      setStatusMessage('Network error reporting incident. It will need to be re-sent.');
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const speedKmh = fix?.speed_kmh != null ? Math.round(fix.speed_kmh) : null;
  const fixPoor = fix?.accuracy_m != null && fix.accuracy_m > POOR_ACCURACY_M;
  const activeAssists = assists.filter((a) => a.status === 'SUGGESTED' || a.status === 'ACCEPTED');
  const mapAssists: AssistMapItem[] = activeAssists.map((a) => ({ assist_id: a.assist_id, broken: a.broken }));
  const selectedRoadKm = destination && options.find((o) => o.warehouse_code === destination.code)?.road_km;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md">
            <Truck className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Truck {truckId}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{driverId}</span>
            </div>
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
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border ${fixPoor ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
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
            {selectedRoadKm != null ? `≈ ${selectedRoadKm} km by road (estimate)` : 'Choose a route below'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Your position</div>
          <div className="text-sm font-mono text-slate-800">
            {fix ? `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}` : '—'}
          </div>
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

      {/* Breakdown assist requests */}
      {activeAssists.map((a) => (
        <div key={a.assist_id} className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <AlertTriangle className="w-8 h-8 text-rose-600 shrink-0" />
            <div className="flex-1">
              <h3 className="text-base font-bold text-rose-900">
                {a.broken.driver_name}&apos;s truck {a.broken.truck_id} has a {a.broken.kind.toLowerCase()}
              </h3>
              <p className="text-sm text-rose-800 mt-1">
                {a.reason === 'SAME_DESTINATION'
                  ? 'You are heading to the same warehouse.'
                  : 'It is on your route; you will pass it.'}{' '}
                About {a.distance_km} km away, roughly {a.eta_minutes} min by road. Its position and route are on your map.
              </p>
              {a.status === 'SUGGESTED' ? (
                <div className="flex gap-3 mt-3">
                  <button
                    onClick={() => respondAssist(a.assist_id, 'ACCEPTED')}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm"
                  >
                    Accept and assist
                  </button>
                  <button
                    onClick={() => respondAssist(a.assist_id, 'DECLINED')}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold text-sm"
                  >
                    Decline
                  </button>
                </div>
              ) : (
                <div className="mt-3 text-sm font-bold text-emerald-700">Accepted. Heading to the broken truck.</div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* Route options by demand */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Route className="w-4 h-4 text-indigo-600" /> Choose route (from live GPS)
        </h2>
        {optionsError && <p className="text-sm text-rose-700">{optionsError}</p>}
        {pendingProposal && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900 flex items-center gap-2">
            <Radio className="w-4 h-4 animate-pulse" />
            Pending approval: {pendingProposal.status} • Proposal #{pendingProposal.proposal_id}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {options.map((o) => (
            <button
              key={o.warehouse_code}
              onClick={() => chooseRoute(o)}
              disabled={o.is_current}
              className={`text-left p-4 rounded-xl border-2 transition ${
                destination?.code === o.warehouse_code
                  ? 'border-indigo-600 bg-indigo-50'
                  : 'border-slate-200 hover:border-indigo-300'
              } disabled:opacity-80`}
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
              {o.is_current && <div className="text-[11px] text-indigo-700 font-bold mt-1">Current assignment</div>}
            </button>
          ))}
          {options.length === 0 && !optionsError && (
            <p className="text-sm text-slate-500 md:col-span-3">Route options appear once GPS has a fix.</p>
          )}
        </div>
      </div>

      {/* Driver Delay Report */}
      <DelayReportCard truckId={truckId} />

      {/* Incident actions */}
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
