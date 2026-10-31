/**
 * apps/web/src/screens/ImpactScreen.tsx
 *
 * 3. Impact and Risk Analysis, on real data only.
 *  - Target disruption from GET /disruptions (no demo fallback)
 *  - Ranked orders, summary and heat-grid from GET /disruptions/:id/impact
 *  - Factor waterfall and lineage graph from GET /orders/:id/lineage
 *  - Refreshes every 15 seconds and on the Refresh button
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, MarkerType, type Node, type Edge } from '@xyflow/react';
import { RefreshCw, X } from 'lucide-react';
import { api } from '../api/client.js';
import { NetworkMap } from '../ui/NetworkMap.js';

type Band = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
type Tab = 'ranked' | 'heatgrid' | 'network';

interface Factors {
  urgency_pts: number;
  shortage_pts: number;
  delay_pts: number;
  priority_pts: number;
}

interface RankedOrder {
  order_id: string;
  order_code: string;
  customer_name: string;
  priority: string | null;
  sku_code: string | null;
  quantity: number;
  warehouse_code: string | null;
  original_due_date: string | null;
  best_recoverable_date: string | null;
  committed_promise_date: string | null;
  hours_late: number;
  penalty_exposure: number;
  score: number;
  best_case_score: number;
  worst_case_score: number;
  risk_band: Band;
  policy_band: string;
  factors: Factors;
}

interface HeatCell {
  warehouse: string;
  sku: string;
  impact_count: number;
  severity: Band;
}

interface ImpactPayload {
  disruption: {
    _id: string;
    disruption_type: string;
    severity: string;
    status: string;
    delay_hours: number | null;
    detected_at: string;
    shipment_code: string | null;
  };
  summary: {
    total_orders: number;
    critical_count: number;
    high_count: number;
    total_penalty: number;
    avg_delay_hours: number;
  };
  ranked_orders: RankedOrder[];
  heatgrid: HeatCell[];
}

// Same weights the engine uses: Risk = 100 * (0.35U + 0.30S + 0.20D + 0.15P)
const WEIGHTS: Record<keyof Factors, number> = {
  urgency_pts: 35,
  shortage_pts: 30,
  delay_pts: 20,
  priority_pts: 15,
};

const FACTOR_LABEL: Record<keyof Factors, string> = {
  urgency_pts: 'Urgency: time left before the due date',
  shortage_pts: 'Shortage: share of the order not covered by stock',
  delay_pts: 'Delay: hours late against the slack',
  priority_pts: 'Priority: order priority level',
};

const BAND_CLS: Record<Band, string> = {
  CRITICAL: 'bg-rose-100 text-rose-800 border-rose-300',
  HIGH: 'bg-orange-100 text-orange-800 border-orange-300',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-300',
  LOW: 'bg-emerald-100 text-emerald-800 border-emerald-300',
};

const NODE_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  Supplier: { bg: '#eef2ff', border: '#a5b4fc', text: '#312e81' },
  Shipment: { bg: '#fffbeb', border: '#fde68a', text: '#78350f' },
  Warehouse: { bg: '#ecfdf5', border: '#a7f3d0', text: '#064e3b' },
  Order: { bg: '#fff1f2', border: '#fecdd3', text: '#881337' },
};

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);

const when = (d?: string | null) =>
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

function BandChip({ band }: { band: Band }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${BAND_CLS[band] ?? BAND_CLS.LOW}`}>
      {band}
    </span>
  );
}

/** Turns lineage edges into React Flow nodes and edges. Node ids are "type:id" so they never collide. */
function buildGraph(edgesIn: any[]): { nodes: Node[]; edges: Edge[] } {
  const nodes = new Map<string, Node>();

  const ensure = (type: string, id: string): string => {
    const key = `${type}:${id}`;
    if (!nodes.has(key)) {
      const st = NODE_STYLE[type] ?? { bg: '#ffffff', border: '#cbd5e1', text: '#0f172a' };
      const idx = nodes.size;
      nodes.set(key, {
        id: key,
        position: { x: idx * 240, y: 60 + (idx % 2) * 70 },
        data: { label: `${type}\n${id}` },
        style: {
          background: st.bg,
          color: st.text,
          border: `1.5px solid ${st.border}`,
          borderRadius: 8,
          padding: 10,
          fontSize: 11,
          fontWeight: 600,
          width: 180,
          whiteSpace: 'pre-line',
        },
      });
    }
    return key;
  };

  const edges: Edge[] = edgesIn.map((e, i) => {
    const source = ensure(e.from_type, String(e.from_id));
    const target = ensure(e.to_type, String(e.to_id));
    return {
      id: `e-${i}`,
      source,
      target,
      label: String(e.relation).replace(/_/g, ' '),
      markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
      style: { stroke: '#4f46e5', strokeWidth: 2, cursor: 'pointer' },
      labelStyle: { fill: '#4338ca', fontSize: 10, fontWeight: 700 },
      data: e,
    } as Edge;
  });

  return { nodes: Array.from(nodes.values()), edges };
}

export function ImpactScreen() {
  const [disruptions, setDisruptions] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [impact, setImpact] = useState<ImpactPayload | null>(null);
  const [tab, setTab] = useState<Tab>('ranked');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<RankedOrder | null>(null);
  const [lineage, setLineage] = useState<any>(null);
  const [lineageLoading, setLineageLoading] = useState<boolean>(false);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [edgeInfo, setEdgeInfo] = useState<any>(null);

  // 1. Disruption list. The endpoint returns { disruptions: [...] }.
  const loadDisruptions = useCallback(async () => {
    const res: any = await api.investigation.getDisruptions();
    const rows: any[] = Array.isArray(res) ? res : res?.disruptions ?? [];
    setDisruptions(rows);
    setSelectedId((prev) => {
      if (prev && rows.some((r) => String(r._id ?? r.id) === prev)) return prev;
      return rows[0] ? String(rows[0]._id ?? rows[0].id) : '';
    });
  }, []);

  // 2. Impact for the selected disruption
  const fetchImpact = useCallback(async () => {
    if (!selectedId) {
      setImpact(null);
      return;
    }
    try {
      const data: ImpactPayload = await api.impact.getImpact(selectedId);
      setImpact(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not load impact data');
    }
  }, [selectedId]);

  const refreshAll = useCallback(async () => {
    try {
      await loadDisruptions();
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Could not load disruptions');
    } finally {
      setLoading(false);
    }
  }, [loadDisruptions]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(refreshAll, 15000);
    return () => clearInterval(t);
  }, [refreshAll]);

  useEffect(() => {
    fetchImpact();
    const t = setInterval(fetchImpact, 15000);
    return () => clearInterval(t);
  }, [fetchImpact]);

  // 3. Lineage for the order drawer. Errors show in the drawer, never as fake data.
  const openOrder = async (o: RankedOrder) => {
    setSelected(o);
    setEdgeInfo(null);
    setLineage(null);
    setLineageError(null);
    setLineageLoading(true);
    try {
      setLineage(await api.impact.getLineage(o.order_id, selectedId));
    } catch (e: any) {
      setLineageError(e.message || 'Could not load lineage');
    } finally {
      setLineageLoading(false);
    }
  };

  const graph = useMemo(() => buildGraph(lineage?.edges ?? []), [lineage]);

  const summary = impact?.summary;
  const orders = impact?.ranked_orders ?? [];
  const heat = impact?.heatgrid ?? [];

  if (loading && disruptions.length === 0) {
    return <div className="p-6 text-sm text-slate-500">Loading impact analysis…</div>;
  }

  return (
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold tracking-tight">5. Impact and Risk Analysis</h1>
          <p className="text-xs text-slate-500 mt-1">
            Risk score 0 to 100, factor waterfall, and causal event lineage
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-600">Target disruption:</label>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={disruptions.length === 0}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs min-w-[260px]"
          >
            {disruptions.length === 0 && <option value="">No disruptions yet</option>}
            {disruptions.map((d) => {
              const id = String(d._id ?? d.id);
              return (
                <option key={id} value={id}>
                  {d.disruption_type} · {d.shipment_id?.code ?? id.slice(-6)} · {d.status}
                </option>
              );
            })}
          </select>
          <button
            onClick={() => {
              refreshAll();
              fetchImpact();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs font-semibold hover:bg-slate-50"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800">{error}</div>}

      {disruptions.length === 0 ? (
        <div className="p-8 rounded-xl bg-white border border-dashed border-slate-300 text-center text-sm text-slate-500">
          No disruptions have been recorded yet. A disruption opens when a delay or ETA change is applied to a shipment.
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Kpi label="Affected orders" value={String(summary?.total_orders ?? 0)} sub="open demand lines" />
            <Kpi label="Critical" value={String(summary?.critical_count ?? 0)} sub="score ≥ 80" tone="text-rose-600" />
            <Kpi label="High" value={String(summary?.high_count ?? 0)} sub="score 60 to 79" tone="text-orange-600" />
            <Kpi label="Penalty exposure" value={inr(summary?.total_penalty ?? 0)} sub="penalty per hour × hours late" />
            <Kpi label="Avg hours late" value={`${summary?.avg_delay_hours ?? 0} h`} sub="best-known ETA vs due date" />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-slate-200">
            {(
              [
                ['ranked', 'Ranked orders'],
                ['heatgrid', 'Heat-grid'],
                ['network', 'Network map'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px ${
                  tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'ranked' && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-x-auto">
              {orders.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No open orders are affected by this disruption. An order is affected when it is open at the same
                  warehouse as the delayed shipment and demands one of its SKUs.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 text-left">
                    <tr>
                      <th className="p-3">Order</th>
                      <th className="p-3">Customer</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Due</th>
                      <th className="p-3">Hours late</th>
                      <th className="p-3">Exposure</th>
                      <th className="p-3">Score</th>
                      <th className="p-3">Band</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr
                        key={o.order_id}
                        onClick={() => openOrder(o)}
                        className="border-t border-slate-100 hover:bg-indigo-50 cursor-pointer"
                      >
                        <td className="p-3 font-mono font-semibold">{o.order_code}</td>
                        <td className="p-3">{o.customer_name}</td>
                        <td className="p-3 font-mono">{o.sku_code ?? '—'}</td>
                        <td className="p-3">{when(o.original_due_date)}</td>
                        <td className="p-3 font-mono">{o.hours_late} h</td>
                        <td className="p-3 font-mono">{inr(o.penalty_exposure)}</td>
                        <td className="p-3 font-mono font-bold">{o.score.toFixed(1)}</td>
                        <td className="p-3">
                          <BandChip band={o.risk_band} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'heatgrid' && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm overflow-x-auto">
              {heat.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">Nothing to show yet.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 text-left">
                    <tr>
                      <th className="p-3">Warehouse</th>
                      <th className="p-3">SKU</th>
                      <th className="p-3">Affected orders</th>
                      <th className="p-3">Worst severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {heat.map((c, i) => (
                      <tr key={`${c.warehouse}-${c.sku}-${i}`} className="border-t border-slate-100">
                        <td className="p-3 font-mono font-semibold">{c.warehouse}</td>
                        <td className="p-3 font-mono">{c.sku}</td>
                        <td className="p-3">{c.impact_count}</td>
                        <td className="p-3">
                          <BandChip band={c.severity} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {tab === 'network' && (
            <div className="rounded-xl bg-white border border-slate-200 shadow-sm p-2">
              <NetworkMap />
            </div>
          )}
        </>
      )}

      {/* Drawer: factor waterfall and lineage */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-3xl h-full overflow-y-auto bg-white shadow-2xl p-6 space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold font-mono">{selected.order_code}</h2>
                  <BandChip band={selected.risk_band} />
                </div>
                <p className="text-xs text-slate-500">
                  {selected.customer_name} · {selected.quantity} units of {selected.sku_code ?? '—'} ·{' '}
                  {selected.warehouse_code ?? '—'}
                </p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1 rounded hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <Field label="Original due" value={when(selected.original_due_date)} />
              <Field label="Best recoverable (promised ETA)" value={when(selected.best_recoverable_date)} />
              <Field label="Hours late" value={`${selected.hours_late} h`} />
              <Field label="Penalty exposure" value={inr(selected.penalty_exposure)} />
              <Field
                label="Score range"
                value={`${selected.best_case_score.toFixed(1)} best to ${selected.worst_case_score.toFixed(1)} worst`}
              />
              <Field label="Policy band" value={selected.policy_band} />
            </div>

            {/* Factor waterfall */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Factor waterfall · total {selected.score.toFixed(1)} / 100
              </h3>
              {(Object.keys(WEIGHTS) as Array<keyof Factors>).map((k) => {
                const pts = selected.factors[k];
                const pct = Math.min(100, (pts / WEIGHTS[k]) * 100);
                return (
                  <div key={k} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700">{FACTOR_LABEL[k]}</span>
                      <span className="font-mono font-semibold">
                        +{pts.toFixed(1)} of {WEIGHTS[k]} pts
                      </span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Lineage */}
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">Causal lineage</h3>
              {lineageLoading && <p className="text-xs text-slate-500">Loading lineage…</p>}
              {lineageError && (
                <p className="text-xs text-rose-700">Could not load lineage: {lineageError}</p>
              )}
              {!lineageLoading && !lineageError && graph.nodes.length === 0 && (
                <p className="text-xs text-slate-500">
                  No lineage edges yet. Edges appear once a disruption is linked to this order's warehouse.
                </p>
              )}
              {graph.nodes.length > 0 && (
                <div style={{ height: 300 }} className="rounded-lg border border-slate-200">
                  <ReactFlow
                    nodes={graph.nodes}
                    edges={graph.edges}
                    fitView
                    nodesDraggable={false}
                    onEdgeClick={(_, edge) => setEdgeInfo(edge.data)}
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                </div>
              )}
              {edgeInfo && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                  <div className="font-semibold">{String(edgeInfo.relation).replace(/_/g, ' ')}</div>
                  <div className="font-mono text-slate-700">{edgeInfo.calculation}</div>
                  <div className="text-slate-500">Observed: {when(edgeInfo.observed_at)}</div>
                  <div className="text-slate-500">Evidence: {(edgeInfo.evidence_ids ?? []).join(', ') || '—'}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, tone = 'text-slate-900' }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className={`text-xl font-bold font-mono mt-1 ${tone}`}>{value}</div>
      <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold mt-0.5">{value}</div>
    </div>
  );
}