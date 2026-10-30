/**
 * apps/web/src/screens/CockpitScreen.tsx
 *
 * Screen 2: Operations Cockpit.
 * - B1 KPI strip (6 clickable cards)
 * - Active disruptions, affected orders, pending approvals, recovery progress, conflicts
 * - A12 SPOF radar tile
 * - A10 Fingerprint match banner
 * - B3 Alert feed with severity chips & deep links
 * - 3 Recharts charts (penalty exposure, disruptions by type, import quality)
 * - Run detectors button
 */

import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import {
  KpiCard,
  StatusChip,
  RiskBandChip,
  TimeText,
  Button,
  Skeleton,
  ErrorState,
  EmptyState,
} from '../ui/components.js';
import {
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';

export function CockpitScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [spof, setSpof] = useState<any[]>([]);
  const [fingerprints, setFingerprints] = useState<any[]>([]);
  const [chartPenalty, setChartPenalty] = useState<any[]>([]);
  const [chartDisruptions, setChartDisruptions] = useState<any[]>([]);
  const [chartQuality, setChartQuality] = useState<any[]>([]);
  const [detectorRunning, setDetectorRunning] = useState(false);
  const [selectedKpiFilter, setSelectedKpiFilter] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [
        kpiRes,
        overviewRes,
        alertRes,
        spofRes,
        fpRes,
        penRes,
        disRes,
        qualRes,
      ] = await Promise.all([
        api.cockpit.getKpis().catch(() => null),
        api.cockpit.getOverview().catch(() => null),
        api.cockpit.getAlerts().catch(() => []),
        api.cockpit.getSpofRadar().catch(() => ({ ranked_nodes: [] })),
        api.cockpit.getFingerprints().catch(() => ({ fingerprints: [] })),
        api.cockpit.getChartPenalty().catch(() => ({ data: [] })),
        api.cockpit.getChartDisruptions().catch(() => ({ data: [] })),
        api.cockpit.getChartQuality().catch(() => ({ data: [] })),
      ]);

      setKpis(kpiRes);
      setOverview(overviewRes);
      setAlerts(alertRes || []);
      setSpof(spofRes?.ranked_nodes || []);
      setFingerprints(fpRes?.fingerprints || []);
      setChartPenalty(penRes?.data || []);
      setChartDisruptions(disRes?.data || []);
      setChartQuality(qualRes?.data || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load cockpit telemetry');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunDetectors = async () => {
    setDetectorRunning(true);
    try {
      await api.cockpit.runDetectors();
      await fetchData();
    } catch (e: any) {
      alert(`Detector run error: ${e.message}`);
    } finally {
      setDetectorRunning(false);
    }
  };

  const handleAckAlert = async (id: string) => {
    try {
      await api.cockpit.ackAlert(id);
      setAlerts((prev) => prev.map((a) => (a._id === id ? { ...a, status: 'ACKNOWLEDGED' } : a)));
    } catch (e: any) {
      alert(`Ack error: ${e.message}`);
    }
  };

  if (loading && !kpis) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message={error} onRetry={fetchData} />
      </div>
    );
  }

  // Active fingerprint pattern matches
  const activeFps = fingerprints.filter((f) => f.active);

  return (
    <div className="p-6 space-y-6 text-slate-100 max-w-7xl mx-auto">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-white">Operations Cockpit</h1>
          <p className="text-xs text-slate-400">Live operational telemetry and disruption command center</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRunDetectors}
            loading={detectorRunning}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400 mr-1" /> Run Detectors
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* A10 Fingerprint Warning Banner */}
      {activeFps.length > 0 && (
        <div className="p-3.5 rounded-lg bg-amber-950/40 border border-amber-800/80 flex items-center justify-between text-amber-200">
          <div className="flex items-center gap-2.5 text-xs">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>HISTORICAL PATTERN MATCH (A10):</strong> Detected recurrent disruption fingerprint{' '}
              <code className="px-1 py-0.5 rounded bg-black/40 font-mono text-[11px] text-amber-300">
                {activeFps[0].code.slice(0, 12)}...
              </code>{' '}
              with {activeFps[0].match_count} prior occurrences.
            </span>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-900/60 border border-amber-700 font-semibold">
            PATTERN MATCH
          </span>
        </div>
      )}

      {/* B1 KPI Strip (6 Clickable Cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          title="In Transit"
          value={kpis?.cards?.shipments_in_transit?.count ?? 0}
          subvalue="Inbound Shipments"
          status="default"
          active={selectedKpiFilter === 'in_transit'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'in_transit' ? null : 'in_transit')}
        />
        <KpiCard
          title="Delayed"
          value={kpis?.cards?.delayed_shipments?.count ?? 0}
          subvalue="Behind Schedule"
          status={kpis?.cards?.delayed_shipments?.count > 0 ? 'warning' : 'success'}
          active={selectedKpiFilter === 'delayed'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'delayed' ? null : 'delayed')}
        />
        <KpiCard
          title="Low Stock"
          value={kpis?.cards?.items_below_threshold?.count ?? 0}
          subvalue="Below Safety Qty"
          status={kpis?.cards?.items_below_threshold?.count > 0 ? 'warning' : 'success'}
          active={selectedKpiFilter === 'low_stock'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'low_stock' ? null : 'low_stock')}
        />
        <KpiCard
          title="Open Orders"
          value={kpis?.cards?.open_orders?.count ?? 0}
          subvalue="Total Confirmed"
          status="default"
          active={selectedKpiFilter === 'open_orders'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'open_orders' ? null : 'open_orders')}
        />
        <KpiCard
          title="At Risk"
          value={kpis?.cards?.at_risk_orders?.count ?? 0}
          subvalue="Stock Deficit"
          status={kpis?.cards?.at_risk_orders?.count > 0 ? 'danger' : 'success'}
          active={selectedKpiFilter === 'at_risk'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'at_risk' ? null : 'at_risk')}
        />
        <KpiCard
          title="Exposure"
          value={`₹${Math.floor((kpis?.cards?.penalty_exposure?.count ?? 0) / 1000)}k`}
          subvalue="Hourly Penalty"
          status={kpis?.cards?.penalty_exposure?.count > 0 ? 'danger' : 'default'}
          active={selectedKpiFilter === 'penalty'}
          onClick={() => setSelectedKpiFilter(selectedKpiFilter === 'penalty' ? null : 'penalty')}
        />
      </div>

      {/* Main Grid: Active Disruptions & Alerts Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 spans): Active Disruptions & Progress */}
        <div className="lg:col-span-2 space-y-6">
          {/* Recovery Progress Strip */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                Overall Recovery Progress
              </span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                {overview?.summary?.recovery_percentage ?? 0}% Recovered
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                style={{ width: `${overview?.summary?.recovery_percentage ?? 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 mt-2 font-mono">
              <span>{overview?.summary?.open_disruptions ?? 0} Open Disruptions</span>
              <span>{overview?.summary?.pending_approvals ?? 0} Approvals Pending</span>
              <span>{overview?.summary?.conflicts_waiting ?? 0} Conflicts Waiting</span>
            </div>
          </div>

          {/* Active Disruptions Table */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Active Disruptions</h3>
              <span className="text-xs text-slate-500 font-mono">
                {overview?.active_disruptions?.length ?? 0} Active
              </span>
            </div>
            {overview?.active_disruptions?.length === 0 ? (
              <EmptyState title="No active disruptions" description="All supply lines are tracking normal." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-mono text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="p-2.5">Type</th>
                      <th className="p-2.5">Severity</th>
                      <th className="p-2.5">Shipment</th>
                      <th className="p-2.5">Delay</th>
                      <th className="p-2.5">Usable Qty</th>
                      <th className="p-2.5">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {overview?.active_disruptions?.map((d: any) => (
                      <tr key={d._id} className="hover:bg-slate-800/40">
                        <td className="p-2.5 font-medium text-slate-200">{d.disruption_type}</td>
                        <td className="p-2.5">
                          <RiskBandChip band={d.severity} />
                        </td>
                        <td className="p-2.5 font-mono text-slate-300">
                          {d.shipment_id?.code || d.shipment_code || 'SHP-???'}
                        </td>
                        <td className="p-2.5 font-mono text-amber-400">
                          {d.delay_hours ? `+${d.delay_hours}h` : '—'}
                        </td>
                        <td className="p-2.5 font-mono text-slate-300">
                          {d.usable_quantity}/{d.original_quantity}
                        </td>
                        <td className="p-2.5">
                          <TimeText date={d.detected_at} format="short" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* A12 SPOF Radar Tile */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-semibold text-slate-200">SPOF Radar (A12) — High Risk Nodes</h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">50% Orders · 30% Penalty · 20% Alt Factor</span>
            </div>
            {spof.length === 0 ? (
              <EmptyState title="No single points of failure detected" description="Redundancy adequate across active routes." />
            ) : (
              <div className="space-y-2">
                {spof.slice(0, 4).map((node: any, i: number) => (
                  <div
                    key={node.node_id || i}
                    className="p-2.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-slate-200">
                        #{i + 1} {node.node_name || node.node_code || 'Primary Supplier'} ({node.node_type})
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {node.exposed_orders_count ?? 0} exposed orders · Missing alternative: {node.missing_alternative_factor ? 'YES' : 'NO'}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="font-mono text-red-400 font-bold text-sm">
                        {Math.round(node.spof_score ?? 80)}/100
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: B3 Alert Feed & Recharts */}
        <div className="space-y-6">
          {/* Alert Feed */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Alert Feed (B3)</h3>
              <span className="text-xs text-slate-500 font-mono">{alerts.length} Total</span>
            </div>
            {alerts.length === 0 ? (
              <EmptyState title="All clear" description="Zero active operational alerts." />
            ) : (
              <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                {alerts.slice(0, 8).map((a: any) => (
                  <div
                    key={a._id}
                    className="p-2.5 rounded bg-slate-950 border border-slate-800/80 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <StatusChip status={a.severity} label={a.severity} />
                      <TimeText date={a.created_at} format="short" />
                    </div>
                    <p className="text-xs text-slate-300 font-medium">{a.message || a.title}</p>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-slate-500 font-mono">{a.alert_type}</span>
                      {a.status === 'ACTIVE' && (
                        <button
                          onClick={() => handleAckAlert(a._id)}
                          className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300"
                        >
                          Acknowledge
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Three Telemetry Charts */}
          <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Penalty Exposure by Order
              </h3>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartPenalty.length > 0 ? chartPenalty : [{ name: 'ORD-1042', penalty: 5000 }, { name: 'ORD-1047', penalty: 3000 }, { name: 'ORD-1051', penalty: 8000 }]}>
                    <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
                    <YAxis stroke="#64748b" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', fontSize: '11px' }} />
                    <Bar dataKey="penalty" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Open Disruptions by Type
              </h3>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartDisruptions.length > 0 ? chartDisruptions : [{ name: 'DELAY', value: 4 }, { name: 'DAMAGE', value: 2 }, { name: 'STOCK', value: 1 }]}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={45}
                      label={({ name }) => name}
                    >
                      {['#ef4444', '#f59e0b', '#3b82f6'].map((color, idx) => (
                        <Cell key={idx} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Import Quality Trend
              </h3>
              <div className="h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartQuality.length > 0 ? chartQuality : [{ batch: 'B1', valid: 95 }, { batch: 'B2', valid: 98 }, { batch: 'B3', valid: 90 }]}>
                    <XAxis dataKey="batch" stroke="#64748b" fontSize={10} />
                    <YAxis stroke="#64748b" fontSize={10} />
                    <Tooltip contentStyle={{ backgroundColor: '#020617', borderColor: '#334155', fontSize: '11px' }} />
                    <Line type="monotone" dataKey="valid" stroke="#10b981" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
