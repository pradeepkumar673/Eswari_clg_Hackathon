/**
 * apps/web/src/screens/InvestigationScreen.tsx
 *
 * Disruption Investigation on real shipment data.
 *  - Shipment list ranked by real ETA shift, filterable by warehouse
 *  - Belief-ETA card: promised vs best-known ETA, and the event that set it
 *  - Live event timeline: updates over WebSocket and by a 15s poll fallback
 *  - Conflict resolution (Accept / Reject) against the real endpoint
 *  - Decision replay built from the audit log
 *  - Supplier scorecard, shown only when real data exists
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getStoredToken, getStoredUser } from '../api/client.js';

const fmt = (d: string | Date | null | undefined) =>
  d
    ? new Date(d).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

const hrs = (h: number) => `${h > 0 ? '+' : ''}${h} h`;

/** Risk band derived from the real shift. Thresholds are a display choice; adjust to your policy. */
function riskFor(shift: number): { label: string; cls: string } {
  if (shift >= 4) return { label: 'HIGH', cls: 'bg-rose-100 text-rose-800 border-rose-300' };
  if (shift >= 2) return { label: 'MEDIUM', cls: 'bg-amber-100 text-amber-800 border-amber-300' };
  if (shift > 0) return { label: 'LOW', cls: 'bg-sky-100 text-sky-800 border-sky-300' };
  return { label: 'ON TRACK', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
}

const STATUS_CLS: Record<string, string> = {
  APPLIED: 'bg-emerald-100 text-emerald-800',
  DUPLICATE: 'bg-slate-200 text-slate-700',
  STALE: 'bg-slate-200 text-slate-700',
  CONFLICT: 'bg-rose-100 text-rose-800',
  REJECTED: 'bg-rose-100 text-rose-800',
  PENDING: 'bg-amber-100 text-amber-800',
};

export function InvestigationScreen() {
  const [shipments, setShipments] = useState<any[]>([]);
  const [warehouse, setWarehouse] = useState<string>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [tab, setTab] = useState<'timeline' | 'replay'>('timeline');
  const [scrub, setScrub] = useState<number>(0);
  const [scorecards, setScorecards] = useState<any[]>([]);
  const [live, setLive] = useState<boolean>(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedId;

  const fetchDetail = useCallback(async (id: string) => {
    const [d, r] = await Promise.all([
      api.investigation.getShipment(id),
      api.investigation.getReplay(id).catch(() => ({ steps: [] })),
    ]);
    setDetail(d);
    const s = r.steps || [];
    setSteps(s);
    return s;
  }, []);

  const refreshAll = useCallback(async () => {
    try {
      const list = await api.investigation.listShipments();
      const rows = list.shipments || [];
      setShipments(rows);

      const id = selectedRef.current ?? rows[0]?._id ?? null;
      if (id) {
        setSelectedId(id);
        await fetchDetail(id);
      }

      const sc: any = await api.investigation.getScorecard().catch(() => []);
      setScorecards(Array.isArray(sc) ? sc : sc?.scorecards || []);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not load investigation data');
    } finally {
      setLoading(false);
    }
  }, [fetchDetail]);

  const selectShipment = async (id: string) => {
    setSelectedId(id);
    setTab('timeline');
    const s = await fetchDetail(id);
    setScrub(Math.max(0, s.length - 1));
  };

  // Initial load, plus a 15s poll so the page stays correct even if the socket drops
  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 15000);
    return () => clearInterval(t);
  }, [refreshAll]);

  // Live updates over WebSocket
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    // Small delay: a report inside an open transaction may not be committed yet when the push arrives
    const scheduleRefresh = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => refreshAll(), 400);
    };

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => ws?.send(JSON.stringify({ type: 'auth', token }));

      ws.onmessage = (e) => {
        let m: any;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'auth_ok') {
          ws?.send(JSON.stringify({ type: 'subscribe', topic: 'shipments' }));
        }
        if (m.type === 'subscribed') setLive(true);
        if (m.type === 'event' && m.topic === 'shipments' && m.data?.type === 'SHIPMENT_EVENT') {
          setBanner(
            `New ${m.data.source} report for ${m.data.shipment_code}: ${m.data.status}${
              m.data.reason ? ` (${m.data.reason})` : ''
            }`,
          );
          scheduleRefresh();
        }
      };

      ws.onclose = () => {
        setLive(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (debounce) clearTimeout(debounce);
      ws?.close();
    };
  }, [refreshAll]);

  const resolveConflict = async (conflictEventId: string, accept: boolean) => {
    const basisId = detail?.shipment?.eta_basis_event_id;
    const chosen = accept ? conflictEventId : basisId;
    if (!chosen) {
      setBanner('Cannot reject: there is no current basis event to keep.');
      return;
    }
    const who = getStoredUser()?.username ?? 'analyst';
    try {
      await api.investigation.resolveConflict(conflictEventId, {
        chosen_event_id: chosen,
        reason: `Reviewed by ${who}: ${accept ? 'accepted' : 'rejected'} the conflicting report`,
      });
      setBanner(`Conflict resolved: ${accept ? 'new report accepted' : 'kept current ETA'}.`);
      await refreshAll();
    } catch (e: any) {
      setBanner(`Resolution failed: ${e.message}`);
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const s = detail?.shipment;
  const shift = s?.shift_hours ?? 0;
  const risk = riskFor(shift);
  const timeline: any[] = detail?.timeline || [];
  const lineage = detail?.lineage;
  const warehouses = Array.from(new Set(shipments.map((x) => x.warehouse?.code).filter(Boolean))) as string[];
  const visible = warehouse === 'ALL' ? shipments : shipments.filter((x) => x.warehouse?.code === warehouse);

  if (loading && shipments.length === 0) {
    return <div className="p-6 text-sm text-slate-500">Loading investigation data…</div>;
  }

  return (
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Disruption Investigation</h1>
          <p className="text-xs text-slate-500">Live ETA reconciliation, event timeline, and decision replay</p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`text-[11px] font-semibold px-2 py-1 rounded-full border ${
              live ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}
          >
            {live ? '● Live' : '● Polling every 15s'}
          </span>
          <select
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs"
          >
            <option value="ALL">All warehouses</option>
            {warehouses.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      {banner && (
        <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-900 flex justify-between">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="font-bold">
            ✕
          </button>
        </div>
      )}
      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: shipment list */}
        <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm space-y-2 lg:max-h-[80vh] overflow-y-auto">
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100">
            Shipments ({visible.length})
          </h2>
          {visible.length === 0 && <p className="text-xs text-slate-500">No shipments in this scope.</p>}
          {visible.map((x) => {
            const r = riskFor(x.shift_hours);
            return (
              <button
                key={x._id}
                onClick={() => selectShipment(x._id)}
                className={`w-full text-left p-3 rounded-lg border transition ${
                  selectedId === x._id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{x.code}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {x.warehouse?.code ?? '—'} · {x.supplier_name ?? 'Unknown supplier'}
                </div>
                <div className="flex justify-between text-[11px] mt-1">
                  <span className={x.shift_hours > 0 ? 'text-rose-700 font-semibold' : 'text-slate-600'}>
                    {hrs(x.shift_hours)}
                  </span>
                  <span className="text-slate-500">
                    {x.events} events{x.conflicts > 0 ? ` · ${x.conflicts} conflict` : ''}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right: detail */}
        <div className="lg:col-span-2 space-y-6">
          {!s ? (
            <div className="p-8 rounded-xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
              Select a shipment to investigate.
            </div>
          ) : (
            <>
              {/* Belief-ETA card */}
              <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Belief-ETA · {s.code}
                  </span>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${risk.cls}`}>{risk.label}</span>
                </div>

                <div className="flex flex-wrap gap-8 pt-1">
                  <div>
                    <span className="text-xs text-slate-500 block">Best-known ETA</span>
                    <span className="text-sm font-bold text-amber-700">{fmt(s.resolved_eta ?? s.current_eta)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Promised ETA</span>
                    <span className="text-sm font-mono text-slate-700">{fmt(s.promised_eta)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Shift vs promise</span>
                    <span className={`text-sm font-mono font-bold ${shift > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {hrs(shift)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Warehouse</span>
                    <span className="text-sm">{s.warehouse ? `${s.warehouse.code} · ${s.warehouse.name}` : '—'}</span>
                  </div>
                </div>

                <p className="text-xs text-slate-600 pt-1">
                  <strong className="text-slate-800">Lineage basis: </strong>
                  {lineage
                    ? `${lineage.event_type} from ${lineage.source} at ${fmt(lineage.event_time)} set the ETA to ${fmt(
                        lineage.reported_eta,
                      )}. ${lineage.reason ?? ''}`
                    : 'No accepted ETA report yet. Showing the planned ETA.'}
                </p>
                {s.review_status === 'UNDER_REVIEW' && (
                  <p className="text-xs font-semibold text-rose-700">
                    Under review: conflicting trusted reports need a decision (see timeline).
                  </p>
                )}
              </div>

              {/* Timeline / Replay */}
              <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  {(['timeline', 'replay'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-md ${
                        tab === t ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {t === 'timeline' ? `Event timeline (${timeline.length})` : `Decision replay (${steps.length})`}
                    </button>
                  ))}
                </div>

                {tab === 'timeline' ? (
                  timeline.length === 0 ? (
                    <div className="p-6 text-center text-sm text-slate-500 border border-dashed border-slate-300 rounded-lg">
                      No events for this shipment yet. Driver delay reports and carrier updates appear here live.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {timeline.map((evt) => (
                        <div
                          key={evt._id}
                          className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-start justify-between gap-3 text-xs"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`px-2 py-0.5 rounded-full font-bold ${
                                  STATUS_CLS[evt.reconcile_status] ?? STATUS_CLS.PENDING
                                }`}
                              >
                                {evt.reconcile_status}
                              </span>
                              <span className="font-semibold">{evt.event_type}</span>
                              <span className="font-mono text-slate-500">{evt.source}</span>
                              {evt.delay_hours != null && (
                                <span className="text-rose-700 font-semibold">+{evt.delay_hours} h reported</span>
                              )}
                            </div>
                            {evt.note && <p className="text-slate-700">{evt.note}</p>}
                            {evt.location && <p className="text-slate-500">Location: {evt.location}</p>}
                            <p className="text-slate-500">
                              Received {fmt(evt.ingested_at)}
                              {evt.reported_eta ? ` · reported ETA ${fmt(evt.reported_eta)}` : ''}
                            </p>
                            {evt.reconcile_reason && <p className="text-slate-500 italic">{evt.reconcile_reason}</p>}
                          </div>

                          {evt.reconcile_status === 'CONFLICT' && (
                            <div className="shrink-0 flex gap-1.5">
                              <button
                                onClick={() => resolveConflict(evt._id, true)}
                                className="px-2.5 py-1 rounded-md bg-emerald-600 text-white font-semibold"
                              >
                                Accept
                              </button>
                              <button
                                onClick={() => resolveConflict(evt._id, false)}
                                className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                ) : steps.length === 0 ? (
                  <div className="text-xs text-slate-500">No audit steps recorded for this shipment yet.</div>
                ) : (
                  <div className="space-y-4">
                    <input
                      type="range"
                      min={0}
                      max={steps.length - 1}
                      value={Math.min(scrub, steps.length - 1)}
                      onChange={(e) => setScrub(parseInt(e.target.value, 10))}
                      className="w-full accent-indigo-600"
                    />
                    <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
                      <div className="flex justify-between">
                        <span className="font-semibold text-indigo-700">
                          Step {steps[Math.min(scrub, steps.length - 1)].step_number} of {steps.length} ·{' '}
                          {steps[Math.min(scrub, steps.length - 1)].action}
                        </span>
                        <span className="text-slate-500">
                          {fmt(steps[Math.min(scrub, steps.length - 1)].timestamp)}
                        </span>
                      </div>
                      <p>{steps[Math.min(scrub, steps.length - 1)].description}</p>
                      <div className="font-mono text-[11px] p-2 bg-white border border-slate-200 rounded">
                        ETA at this step:{' '}
                        <strong>
                          {fmt(steps[Math.min(scrub, steps.length - 1)].resolved_eta_at_step)}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Supplier scorecard: only real data */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-sm space-y-3">
            <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider pb-2 border-b border-slate-100">
              Supplier performance
            </h3>
            {scorecards.length === 0 ? (
              <div className="text-xs text-slate-500">No scored suppliers yet. A scorecard needs completed shipments.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {scorecards.slice(0, 3).map((sc: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                    <div className="font-semibold">{sc.supplier_name ?? sc.name ?? sc.supplier_code ?? 'Supplier'}</div>
                    <div className="text-slate-600">
                      On-time: {sc.on_time_rate != null ? `${Math.round(sc.on_time_rate * 100)}%` : '—'}
                    </div>
                    <div className="text-slate-500">
                      {sc.total_shipments ?? 0} shipments · avg delay +{sc.avg_delay_hours ?? 0} h
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
