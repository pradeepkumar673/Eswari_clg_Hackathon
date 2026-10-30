/**
 * apps/web/src/screens/ManagerWorkspace.tsx
 * Supply Chain Manager decision hub: live reroute decisions, the plan queue, capacity for every warehouse, and open breakdowns.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Truck, FileText, Warehouse as WarehouseIcon, Navigation, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../api/client.js';
import { useWarehouses } from '../hooks/useWarehouses.js';
import { useIncidents } from '../hooks/useIncidents.js';
import { useLiveRefresh } from '../hooks/useLiveRefresh.js';
import { googleMapsDirectionsUrl } from '../lib/navigation.js';
import { pickArray } from '../utils/normalize.js';

interface Props {
  onOpenCapacity: () => void;
  onOpenApprovals: () => void;
}

export function ManagerWorkspace({ onOpenCapacity, onOpenApprovals }: Props) {
  const { warehouses } = useWarehouses();
  const { incidents } = useIncidents();

  const activeCodes = warehouses.filter((w) => w.is_active).map((w) => w.code);
  const codesKey = activeCodes.join(',');
  const codesRef = useRef<string[]>([]);
  codesRef.current = activeCodes;

  const [reroutes, setReroutes] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [rollups, setRollups] = useState<Record<string, any>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    const [rr, q, overviews] = await Promise.all([
      api.tracking.getReroutes('PENDING').catch(() => []),
      api.approvals.getQueue().then((res) => pickArray(res, 'queue')).catch(() => []),
      Promise.all(
        codesRef.current.map((code) =>
          api.capacity
            .getOverview(code)
            .then((o: any) => [code, o] as const)
            .catch(() => [code, null] as const),
        ),
      ),
    ]);
    setReroutes(rr);
    setQueue(q);
    setRollups(Object.fromEntries(overviews));
  }, []);

  // Reload when the set of warehouses changes, and on every live event
  useEffect(() => {
    refreshAll();
  }, [codesKey, refreshAll]);
  useLiveRefresh(['alerts', 'zones', 'incidents', 'warehouses'], refreshAll);

  const decide = async (proposalId: string, approve: boolean) => {
    const reason = (reasons[proposalId] || '').trim();
    if (!approve && !reason) {
      setMessage('Enter a reason before rejecting.');
      return;
    }
    setBusyId(proposalId);
    setMessage(null);
    try {
      if (approve) await api.tracking.approveReroute(proposalId, 'Approved by Supply Chain Manager');
      else await api.tracking.rejectReroute(proposalId, reason);
      setMessage(approve ? 'Route approved. The driver has been told.' : 'Route rejected. The driver has been told why.');
      await refreshAll();
    } catch (e: any) {
      setMessage(e.message || 'Decision failed');
    } finally {
      setBusyId(null);
    }
  };

  const totals = Object.values(rollups).reduce(
    (acc: any, o: any) => {
      if (!o) return acc;
      acc.capacity += o.total_capacity_slots || 0;
      acc.occupied += o.total_occupied_slots || 0;
      acc.inbound += o.total_reserved_inbound_slots || 0;
      return acc;
    },
    { capacity: 0, occupied: 0, inbound: 0 },
  );

  const card = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-6 flex flex-col';

  return (
    <div className="space-y-6">
      {message && (
        <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-900">{message}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Reroute decisions */}
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <Truck className="w-5 h-5 text-indigo-600" /> Truck Reroute Proposals
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
              {reroutes.length} Pending
            </span>
          </div>

          {reroutes.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No driver reroute proposals awaiting decision.</p>
          ) : (
            <div className="space-y-3">
              {reroutes.map((p) => {
                const wh = warehouses.find((w) => w.code === p.nearest_warehouse_id);
                const mapUrl =
                  wh?.lat != null && wh?.lng != null && p.from_position?.lat != null && p.from_position?.lng != null
                    ? googleMapsDirectionsUrl(
                        { lat: wh.lat, lng: wh.lng },
                        { lat: p.from_position.lat, lng: p.from_position.lng },
                      )
                    : null;
                return (
                  <div key={p.proposal_id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="font-bold text-slate-900">{p.truck_id}</span>
                      <span className="text-slate-600">{p.road_km} km</span>
                    </div>
                    <div className="text-xs text-slate-600">
                      To {wh?.name ?? p.nearest_warehouse_id} • {p.reason}
                    </div>
                    {mapUrl && (
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
                      >
                        <Navigation className="w-3.5 h-3.5" /> View route on Google Maps
                      </a>
                    )}
                    <div className="flex gap-2">
                      <button
                        disabled={busyId === p.proposal_id}
                        onClick={() => decide(p.proposal_id, true)}
                        className="flex-1 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={reasons[p.proposal_id] || ''}
                        onChange={(e) => setReasons((r) => ({ ...r, [p.proposal_id]: e.target.value }))}
                        placeholder="Reason to reject"
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-xs"
                      />
                      <button
                        disabled={busyId === p.proposal_id}
                        onClick={() => decide(p.proposal_id, false)}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-1"
                      >
                        <XCircle className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Plan queue */}
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <FileText className="w-5 h-5 text-indigo-600" /> Recovery Plan Queue
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
              {queue.length} Awaiting
            </span>
          </div>

          {queue.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">All recovery plans approved or executed.</p>
          ) : (
            <div className="space-y-2">
              {queue.slice(0, 5).map((item: any, i: number) => (
                <div key={item._id ?? item.plan_id ?? i} className="border border-slate-200 rounded-lg p-2 text-xs">
                  <div className="font-semibold text-slate-900">{item.title ?? item.plan_id ?? item._id}</div>
                  <div className="text-slate-500">{item.status ?? 'Awaiting decision'}</div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={onOpenApprovals}
            className="mt-auto pt-4 w-full py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
          >
            Open Approvals Center
          </button>
        </div>

        {/* Capacity for every warehouse */}
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-bold text-slate-900">
              <WarehouseIcon className="w-5 h-5 text-indigo-600" /> Zone Capacity Rollup
            </div>
            <span className="text-xs font-mono text-slate-500">{activeCodes.length} warehouses</span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500">Occupied</div>
              <div className="text-lg font-bold">{totals.occupied}</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500">Planned inbound</div>
              <div className="text-lg font-bold text-amber-700">{totals.inbound}</div>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-[11px] text-slate-500">Capacity</div>
              <div className="text-lg font-bold">{totals.capacity}</div>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            {activeCodes.map((code) => {
              const o = rollups[code];
              const name = warehouses.find((w) => w.code === code)?.name ?? code;
              return (
                <div key={code} className="flex items-center justify-between border border-slate-200 rounded-lg p-2">
                  <span className="font-semibold text-slate-900">
                    {code} <span className="font-normal text-slate-500">{name}</span>
                  </span>
                  <span className="text-slate-600">
                    {o
                      ? `${o.total_occupied_slots}/${o.total_capacity_slots} • ${o.overall_utilization_pct}%${
                          o.red_zones?.length ? ` • ${o.red_zones.length} red` : ''
                        }`
                      : 'No zones yet'}
                  </span>
                </div>
              );
            })}
          </div>

          <button
            onClick={onOpenCapacity}
            className="mt-auto pt-4 w-full py-2 rounded-lg border border-slate-300 text-sm font-semibold hover:bg-slate-50"
          >
            Open Capacity Mapper
          </button>
        </div>
      </div>

      {/* Open breakdowns */}
      <div className={card}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-bold text-slate-900">Open breakdowns and accidents</div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700">{incidents.length} open</span>
        </div>
        {incidents.length === 0 ? (
          <p className="text-sm text-slate-500">No open incidents right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {incidents.map((i) => (
              <div key={i.incident_id} className="border border-rose-200 rounded-lg p-3 text-xs">
                <div className="font-bold text-slate-900">
                  {i.driver_name ?? i.driver_id} • {i.truck_id}
                </div>
                <div className="text-slate-600">
                  {i.kind} • {new Date(i.ts).toLocaleTimeString()}
                </div>
                <div className="font-mono text-slate-500">
                  {i.lat != null && i.lng != null ? `${i.lat.toFixed(5)}, ${i.lng.toFixed(5)}` : 'Position not sent'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

