/**
 * apps/web/src/screens/DriverScreen.tsx
 *
 * Screen 10: Dedicated Driver Portal & Offline-First Telemetry Console.
 * Features:
 * - Own truck full screen with large, accessible buttons (optimized for phone/tablet).
 * - Next stop hub & road distance in kilometers.
 * - Monotonic ping sequence generator with IndexedDB offline queue (strictly no localStorage).
 * - "N pending sync" badge when offline or queuing.
 * - Automatic background queue flush on online reconnect in batches of 100.
 * - Incident reporting buttons ("BREAKDOWN", "ACCIDENT") with unique idempotency keys.
 * - "Pending approval" card for reroute proposals.
 */

import { useState, useEffect } from 'react';
import {
  Truck,
  AlertTriangle,
  CloudOff,
  CheckCircle2,
  Send,
  Navigation,
  MapPin,
  Clock,
  ShieldAlert,
  Radio,
} from 'lucide-react';
import { getStoredToken, getStoredUser } from '../api/client.js';
import {
  enqueuePing,
  getPendingCount,
  flushQueue,
  QueuedPing,
} from '../services/offlineQueue.js';

export function DriverScreen() {
  const user = getStoredUser();
  const truckId = user?.truck_id || 'SHP-204';
  const driverId = user?.driver_id || 'DRV-1';

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [seqCounter, setSeqCounter] = useState<number>(1);
  const [currentLat, setCurrentLat] = useState<number>(12.7409);
  const [currentLng, setCurrentLng] = useState<number>(77.8253);
  const [speedKmh, setSpeedKmh] = useState<number>(55);
  const [nextStop, setNextStop] = useState<{ name: string; code: string; distance_km: number }>({
    name: 'Hosur Central Hub',
    code: 'WH-HOS',
    distance_km: 24,
  });

  const [activeIncident, setActiveIncident] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<any | null>(null);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Monitor online / offline network state
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      triggerFlush();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial pending count from IndexedDB
    getPendingCount().then(setPendingCount).catch(() => {});

    // Initial truck status
    const token = getStoredToken();
    if (token) {
      fetch('/api/v1/tracking/trucks', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((r) => (r.ok ? r.json() : { trucks: [] }))
        .then((data) => {
          const myTruck = (data.trucks || []).find((t: any) => t.truck_id === truckId);
          if (myTruck) {
            if (myTruck.position) {
              setCurrentLat(myTruck.position.lat);
              setCurrentLng(myTruck.position.lng);
              setSpeedKmh(myTruck.position.speed_kmh);
              setSeqCounter(myTruck.position.seq + 1);
            }
            if (myTruck.destination_warehouse) {
              setNextStop({
                name: myTruck.destination_warehouse.name,
                code: myTruck.destination_warehouse.code,
                distance_km: 24,
              });
            }
            if (myTruck.active_incident) {
              setActiveIncident(myTruck.active_incident.kind);
            }
            if (myTruck.pending_proposal) {
              setPendingProposal(myTruck.pending_proposal);
            }
          }
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [truckId]);

  // Flush IndexedDB queue to server
  const triggerFlush = async () => {
    if (!navigator.onLine || isSyncing) return;
    setIsSyncing(true);

    try {
      const token = getStoredToken();
      await flushQueue(async (batch) => {
        const res = await fetch('/api/v1/driver/pings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ pings: batch }),
        });
        if (!res.ok) throw new Error('Flush failed');
        return await res.json();
      });

      const remaining = await getPendingCount();
      setPendingCount(remaining);
      if (remaining === 0) {
        setStatusMessage('All pings synchronized with control tower');
      }
    } catch {
      // Sync failed, pings remain in IndexedDB
    } finally {
      setIsSyncing(false);
    }
  };

  // Record a driver ping (Offline-First via IndexedDB)
  const handleRecordPing = async () => {
    const nextSeq = seqCounter;
    setSeqCounter((prev) => prev + 1);

    // Slightly advance simulated GPS position along highway
    const newLat = currentLat + 0.002;
    const newLng = currentLng + 0.002;
    setCurrentLat(newLat);
    setCurrentLng(newLng);

    const ping: QueuedPing = {
      seq: nextSeq,
      ts: new Date().toISOString(),
      lat: Math.round(newLat * 10000) / 10000,
      lng: Math.round(newLng * 10000) / 10000,
      speed_kmh: speedKmh,
      truck_id: truckId,
      driver_id: driverId,
    };

    // 1. Always write to IndexedDB first
    await enqueuePing(ping);
    const count = await getPendingCount();
    setPendingCount(count);

    // 2. If online, flush immediately
    if (navigator.onLine) {
      await triggerFlush();
    }
  };

  // Report Breakdown or Accident incident
  const handleReportIncident = async (kind: 'BREAKDOWN' | 'ACCIDENT') => {
    const token = getStoredToken();
    const idempotencyKey = `INC-${driverId}-${Date.now()}`;

    try {
      const res = await fetch('/api/v1/driver/incidents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          kind,
          idempotency_key: idempotencyKey,
          ts: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setActiveIncident(kind);
        if (data.proposal) {
          setPendingProposal(data.proposal);
        }
        setStatusMessage(`Incident ${kind} registered. Proposal awaiting approval.`);
      }
    } catch (e) {
      setStatusMessage('Network error submitting incident.');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex flex-col p-4 md:p-8 max-w-4xl mx-auto space-y-6">
      {/* Top Driver Console Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md">
            <Truck className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Truck {truckId}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                {driverId}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Driver: {user?.display_name || 'Ramesh (Driver 1)'}
            </p>
          </div>
        </div>

        {/* Network & Offline Queue Badge */}
        <div className="flex items-center gap-3">
          {pendingCount > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-bold shadow-sm">
              <CloudOff className="w-4 h-4 text-amber-600" />
              <span>{pendingCount} pending sync</span>
              {isOnline && (
                <button
                  onClick={triggerFlush}
                  disabled={isSyncing}
                  className="ml-1 underline text-amber-900 hover:text-amber-700"
                >
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-xs font-bold shadow-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Telemetry Synchronized</span>
            </div>
          )}

          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold ${
              isOnline ? 'bg-indigo-50 text-indigo-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${isOnline ? 'bg-indigo-600' : 'bg-rose-600'}`}
            ></span>
            <span>{isOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMessage && (
        <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-800 flex items-center justify-between">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage(null)}
            className="text-indigo-500 hover:text-indigo-800 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Next Stop & Navigation Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
            <Navigation className="w-4 h-4 text-indigo-600" />
            <span>Assigned Destination</span>
          </div>
          <div className="text-2xl font-black text-slate-900">{nextStop.name}</div>
          <div className="flex items-center gap-2 mt-2 text-sm text-slate-600 font-medium">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span>Hub Code: {nextStop.code}</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
            <Clock className="w-4 h-4 text-indigo-600" />
            <span>Road Distance & Speed</span>
          </div>
          <div className="text-2xl font-black text-indigo-600">{speedKmh} km/h</div>
          <div className="mt-2 text-xs text-slate-500">
            Coordinates: {currentLat.toFixed(4)}, {currentLng.toFixed(4)} • Seq #{seqCounter}
          </div>
        </div>
      </div>

      {/* Pending Reroute Approval Card */}
      {pendingProposal && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-6 shadow-md">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center text-white shrink-0 shadow">
              <Radio className="w-6 h-6 animate-pulse" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-amber-200 text-amber-900">
                  {pendingProposal.status}
                </span>
                <span className="text-xs text-amber-800 font-semibold">
                  Proposal #{pendingProposal.proposal_id}
                </span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mt-1">
                Reroute Proposed: Redirect to {pendingProposal.nearest_warehouse_id}
              </h3>
              <p className="text-xs text-slate-700 mt-1">
                Road Distance to Alternate Hub: <span className="font-bold">{pendingProposal.road_km} km</span>.
                Awaiting Supply Chain Manager approval. Destination remains unchanged until confirmed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Active Incident Warning */}
      {activeIncident && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-6 shadow-sm flex items-center gap-4">
          <AlertTriangle className="w-8 h-8 text-rose-600 shrink-0" />
          <div>
            <h3 className="text-base font-bold text-rose-900">
              Active Incident Reported: {activeIncident}
            </h3>
            <p className="text-xs text-rose-700 mt-0.5">
              Control room dispatched recovery telemetry. Stay safe with hazard lights engaged.
            </p>
          </div>
        </div>
      )}

      {/* Driver Action Controls */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Driver Actions & Field Telemetry
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Send Ping Button */}
          <button
            onClick={handleRecordPing}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-bold rounded-xl shadow-md transition-transform active:scale-95"
          >
            <Send className="w-5 h-5" />
            <span>Send GPS Ping (Seq #{seqCounter})</span>
          </button>

          {/* Breakdown Button */}
          <button
            onClick={() => handleReportIncident('BREAKDOWN')}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-bold rounded-xl shadow-md transition-transform active:scale-95"
          >
            <AlertTriangle className="w-5 h-5" />
            <span>Report Breakdown</span>
          </button>

          {/* Accident Button */}
          <button
            onClick={() => handleReportIncident('ACCIDENT')}
            className="flex items-center justify-center gap-2 py-4 px-6 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-xl shadow-md transition-transform active:scale-95"
          >
            <ShieldAlert className="w-5 h-5" />
            <span>Report Accident</span>
          </button>
        </div>
      </div>
    </div>
  );
}
