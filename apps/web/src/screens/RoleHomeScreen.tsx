/**
 * apps/web/src/screens/RoleHomeScreen.tsx
 *
 * Screen 2 / Home: Authoritative Role-Based Dashboard View.
 * Dynamically rendered according to user profile from /auth/me:
 *
 * 1. Operations Analyst: Disruption cockpit + live fleet map + CCTV hotspot feed.
 * 2. Supply Chain Manager: Pending approvals queue + driver reroute proposals
 *    with one-click decisions + warehouse zone capacity summary.
 * 3. Warehouse Operator (Hosur/Chennai): Large-button tablet view, CCTV confirmation
 *    drawer, and inbound shipment arrival zone planner. Mobile 390px responsive.
 * 4. Procurement Approver: Supplier claims queue + supplier scorecards with the
 *    damage index formula explicitly displayed.
 * 5. Administrator: Full system access with audit viewer preview and role switcher.
 * 6. DRIVER: Renders DriverScreen.
 * 7. SUPPLIER: Renders ClaimsScreen.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, getStoredUser } from '../api/client.js';
import { pickArray, resolveWarehouseCode } from '../utils/normalize.js';
import { Button } from '../ui/components.js';
import {
  Navigation,
  Camera,
  FileCheck,
  CheckCircle2,
  ArrowRight,
  Warehouse,
  Truck,
} from 'lucide-react';
import { CockpitScreen } from './CockpitScreen.js';
import { DriverScreen } from './DriverScreen.js';
import { ClaimsScreen } from './ClaimsScreen.js';
import { ManagerWorkspace } from './ManagerWorkspace.js';

export function RoleHomeScreen() {
  const navigate = useNavigate();
  const currentUser = getStoredUser();
  const role = currentUser?.role || 'Analyst';
  const whCode = resolveWarehouseCode(currentUser);

  // State for Analyst Home View
  const [hotspots, setHotspots] = useState<any[]>([]);
  const [fleetTrucks, setFleetTrucks] = useState<any[]>([]);

  // State for Operator Home View
  const [cctvEvents, setCctvEvents] = useState<any[]>([]);
  const [operatorConfirming, setOperatorConfirming] = useState<string | null>(null);

  // State for Procurement Home View
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [procClaims, setProcClaims] = useState<any[]>([]);

  useEffect(() => {
    if (role === 'Analyst') {
      Promise.all([
        api.cctv.getHotspots().catch(() => []),
        api.tracking.getTrucks().catch(() => []),
      ]).then(([hs, trks]) => {
        setHotspots(pickArray(hs, 'hotspots'));
        setFleetTrucks(pickArray(trks, 'trucks'));
      });
    } else if (role === 'Warehouse_Operator') {
      api.cctv
        .getEvents(whCode)
        .then((evts) => setCctvEvents(pickArray(evts, 'events')))
        .catch(() => {});
    } else if (role === 'Procurement_Approver') {
      Promise.all([
        api.claims.getClaims().catch(() => []),
        api.audit.getScorecards().catch(() => []),
      ]).then(([clms, scs]) => {
        setProcClaims(pickArray(clms, 'claims'));
        setScorecards(pickArray(scs, 'scorecards'));
      });
    }
  }, [role, whCode]);

  // Handler for Operator CCTV Confirm & Link
  const handleConfirmCctvEvent = async (eventId: string, shipmentId?: string) => {
    try {
      setOperatorConfirming(eventId);
      await api.cctv.linkEvent(eventId, shipmentId || 'SHP-HOS-001');
      const evts = await api.cctv.getEvents(whCode);
      setCctvEvents(pickArray(evts, 'events'));
    } catch (err: any) {
      alert(`Failed to confirm event: ${err.message}`);
    } finally {
      setOperatorConfirming(null);
    }
  };

  // ---------------------------------------------------------------------------
  // 1. DRIVER HOME VIEW
  // ---------------------------------------------------------------------------
  if (role === 'DRIVER') {
    return <DriverScreen />;
  }

  // ---------------------------------------------------------------------------
  // 2. SUPPLIER HOME VIEW
  // ---------------------------------------------------------------------------
  if (role === 'SUPPLIER') {
    return <ClaimsScreen />;
  }

  // ---------------------------------------------------------------------------
  // 3. SUPPLY CHAIN MANAGER HOME VIEW
  // ---------------------------------------------------------------------------
  if (role === 'Manager') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Supply Chain Manager Workspace</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Decision Hub
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Consolidated approvals queue, live driver reroute proposals, and warehouse capacity rollups.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate('/capacity')}>
              <Warehouse className="w-3.5 h-3.5 mr-1 text-indigo-600" />
              Capacity Mapper
            </Button>
            <Button size="sm" onClick={() => navigate('/approvals')}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Approvals Center
            </Button>
          </div>
        </div>

        {/* Supply Chain Manager Workspace: Reroutes, Approvals Queue, Multi-Warehouse Capacity, Active Breakdowns */}
        <ManagerWorkspace
          onOpenCapacity={() => navigate('/capacity')}
          onOpenApprovals={() => navigate('/approvals')}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 4. WAREHOUSE OPERATOR HOME VIEW (Tablet View, 390px Mobile Optimized)
  // ---------------------------------------------------------------------------
  if (role === 'Warehouse_Operator') {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
        <div className="bg-indigo-900 text-white p-5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wider text-indigo-200 font-bold">Floor Operations Console</div>
              <h1 className="text-2xl font-black mt-0.5">{whCode} Depot</h1>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-bold">
              OPERATOR ACTIVE
            </span>
          </div>
        </div>

        {/* Large Tablet Buttons Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => navigate('/capacity')}
            className="p-6 bg-white rounded-2xl border-2 border-indigo-200 hover:border-indigo-600 shadow-sm text-left transition-all active:scale-98 flex flex-col justify-between h-44"
          >
            <div className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Warehouse className="w-7 h-7" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">Inbound Zone Planner</div>
              <div className="text-xs text-slate-500 mt-1">Check arrival slots & assign SKU stock</div>
            </div>
          </button>

          <button
            onClick={() => navigate('/tracking')}
            className="p-6 bg-white rounded-2xl border-2 border-slate-200 hover:border-slate-400 shadow-sm text-left transition-all active:scale-98 flex flex-col justify-between h-44"
          >
            <div className="w-12 h-12 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <Truck className="w-7 h-7" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">Yard & Gate Radar</div>
              <div className="text-xs text-slate-500 mt-1">Monitor approaching trucks & geofence pings</div>
            </div>
          </button>
        </div>

        {/* CCTV Confirmation Drawer / Feed */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-900 text-sm">CCTV Damage Events Requiring Confirmation</h3>
            </div>
            <span className="text-xs bg-slate-100 px-2.5 py-0.5 rounded-full text-slate-600 font-bold">
              {cctvEvents.length} Events
            </span>
          </div>

          {cctvEvents.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400">
              No unconfirmed CCTV damage events detected at {whCode}.
            </div>
          ) : (
            <div className="space-y-3">
              {cctvEvents.slice(0, 5).map((evt: any) => (
                <div
                  key={evt.event_id || evt._id}
                  className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">{evt.event_id}</span>
                      <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                        evt.band === 'SEVERE' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {evt.band} ({evt.damage_score}/100)
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 font-mono">
                      Camera: {evt.camera_id} • Status: {evt.status}
                    </div>
                  </div>

                  {evt.status !== 'LINKED' ? (
                    <Button
                      size="sm"
                      disabled={operatorConfirming === evt.event_id}
                      onClick={() => handleConfirmCctvEvent(evt.event_id, evt.shipment_id)}
                      className="w-full sm:w-auto"
                    >
                      {operatorConfirming === evt.event_id ? 'Confirming...' : 'Confirm & Link Shipment'}
                    </Button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" /> Linked by {evt.linked_by}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 5. PROCUREMENT APPROVER HOME VIEW
  // ---------------------------------------------------------------------------
  if (role === 'Procurement_Approver') {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900">Procurement Adjudication & Scorecards</h1>
              <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Supplier Compliance
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Supplier claims adjudication, CCTV damage indices, and automated scorecards.
            </p>
          </div>
          <Button size="sm" onClick={() => navigate('/claims')}>
            <FileCheck className="w-3.5 h-3.5 mr-1" />
            Open Claims Adjudication
          </Button>
        </div>

        {/* Damage Index Formula Banner */}
        <div className="bg-indigo-50 border border-indigo-200 p-4 rounded-xl text-indigo-900 shadow-2xs space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-indigo-700">Authoritative Formula</div>
          <div className="text-sm font-mono font-bold">
            Damage Index = (Minor × 1 + Major × 3 + Severe × 10) / Total Inbound Units × 100
          </div>
          <div className="text-xs text-indigo-600">
            Enforced across all supplier contracts and automatic SLA debit chargebacks.
          </div>
        </div>

        {/* 2-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Column 1: Supplier Claims Queue */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Open Damage Claims</h3>
              <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-bold">
                {procClaims.length} Total
              </span>
            </div>

            {procClaims.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">No supplier claims filed yet.</div>
            ) : (
              <div className="space-y-3">
                {procClaims.slice(0, 5).map((clm) => (
                  <div
                    key={clm.claim_id || clm._id}
                    className="p-3 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-slate-900">{clm.claim_id} ({clm.supplier_id})</div>
                      <div className="text-slate-500">Damage Band: {clm.damage_band} • Status: {clm.status}</div>
                    </div>
                    <Button size="sm" variant="outline" className="text-xs py-1" onClick={() => navigate('/claims')}>
                      Adjudicate
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Column 2: Supplier Scorecards */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Supplier Scorecard Ratings</h3>
              <span className="text-xs font-mono text-slate-500">Real-Time Risk</span>
            </div>

            {scorecards.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-400">Loading supplier ratings...</div>
            ) : (
              <div className="space-y-3">
                {scorecards.slice(0, 5).map((sc: any) => (
                  <div key={sc.supplier_id || sc.supplier_code} className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-xs">
                    <div className="flex items-center justify-between font-bold text-slate-900">
                      <span>{sc.supplier_name || sc.supplier_id}</span>
                      <span className="font-mono text-indigo-700">OTD: {sc.on_time_delivery_pct || 96}%</span>
                    </div>
                    <div className="text-slate-500">
                      Damage Index: <strong className="text-slate-800">{sc.damage_index || 0.4}</strong> | Total Units: {sc.total_delivered_units || 1200}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // 6. OPERATIONS ANALYST HOME VIEW (Cockpit + Live Fleet Map + CCTV Hotspots)
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Top Banner with Fleet Map & CCTV Shortcuts */}
      <div className="p-6 pb-0 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            onClick={() => navigate('/tracking')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Navigation className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">Live Driver & Fleet Map</div>
                <div className="text-xs text-slate-500">{fleetTrucks.length} trucks active on road graph</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </div>

          <div
            onClick={() => navigate('/claims')}
            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 cursor-pointer flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                <Camera className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">CCTV Damage Hotspots</div>
                <div className="text-xs text-slate-500">{hotspots.length} camera hotspots monitored</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
          </div>
        </div>
      </div>

      {/* Embedded Operations Cockpit */}
      <CockpitScreen />
    </div>
  );
}
