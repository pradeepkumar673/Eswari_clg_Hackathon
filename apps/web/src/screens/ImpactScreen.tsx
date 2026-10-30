/**
 * apps/web/src/screens/ImpactScreen.tsx
 *
 * Screen 5: Impact and Risk Analysis (Bright Executive Theme)
 * Purpose: Which orders and why
 * Features:
 * - Ranked orders with score (0-100), B5 risk band chip (opens waterfall), score range
 * - Factor waterfall (delay, quantity, penalty, inventory buffer)
 * - Evidence drawer with A7 date chips (original due, best recoverable, committed promise date)
 * - A8 Lineage graph built with @xyflow/react in drawer/modal (click edge to see evidence, timestamp, calculation string)
 * - B13 days-of-cover chip and drift hint labeled "projection"
 * - Heat-grid tab and B2 Network map tab
 */

import { useState, useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
} from '@xyflow/react';
import {
  Layers,
  Network,
  GitBranch,
  Calendar,
  ChevronRight,
  ShieldAlert,
  Info,
  Clock,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '../api/client.js';
import {
  Button,
  RiskBandChip,
  MoneyText,
  TimeText,
  Drawer,
  Skeleton,
  EmptyState,
} from '../ui/components.js';
import { NetworkMap } from '../ui/NetworkMap.js';

interface RankedOrder {
  order_id: string;
  order_code: string;
  customer_name: string;
  sku_code: string;
  quantity: number;
  original_due_date: string;
  best_recoverable_date: string;
  committed_promise_date?: string;
  delay_hours: number;
  penalty_exposure: number;
  score: number;
  risk_band: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  days_of_cover: number;
  cover_drift_hours: number;
  factors: {
    delay_factor: number;
    quantity_factor: number;
    penalty_factor: number;
    inventory_buffer_offset: number;
  };
}

export function ImpactScreen() {
  const [activeTab, setActiveTab] = useState<'ranked' | 'heatgrid' | 'network'>('ranked');
  const [disruptions, setDisruptions] = useState<any[]>([]);
  const [selectedDisruptionId, setSelectedDisruptionId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [orders, setOrders] = useState<RankedOrder[]>([]);
  const [heatgrid, setHeatgrid] = useState<any[]>([]);
  const [summary, setSummary] = useState<{
    total_orders: number;
    critical_count: number;
    high_count: number;
    total_penalty: number;
    avg_delay_hours: number;
  }>({
    total_orders: 0,
    critical_count: 0,
    high_count: 0,
    total_penalty: 0,
    avg_delay_hours: 0,
  });

  // Drawer state for Order Evidence & Lineage
  const [selectedOrder, setSelectedOrder] = useState<RankedOrder | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [lineageLoading, setLineageLoading] = useState<boolean>(false);
  const [lineageData, setLineageData] = useState<any>(null);
  const [selectedEdgeData, setSelectedEdgeData] = useState<any>(null);

  // Load disruptions on mount
  useEffect(() => {
    async function loadDisruptions() {
      try {
        const list = await api.investigation.getDisruptions();
        if (Array.isArray(list) && list.length > 0) {
          setDisruptions(list);
          setSelectedDisruptionId(list[0]._id || list[0].id);
        }
      } catch {
        // Fallback demo disruption
        const fallback = [{ _id: 'DSR-DEMO-9021', title: 'Chennai Flood Delay', status: 'ACTIVE' }];
        setDisruptions(fallback);
        setSelectedDisruptionId('DSR-DEMO-9021');
      }
    }
    loadDisruptions();
  }, []);

  // Fetch impact data whenever target disruption changes
  const fetchImpactData = async () => {
    if (!selectedDisruptionId) return;
    setLoading(true);
    try {
      const data = await api.impact.getImpact(selectedDisruptionId);
      if (data) {
        setOrders(data.ranked_orders || []);
        setHeatgrid(data.heatgrid || []);
        setSummary({
          total_orders: data.summary?.total_orders ?? 4,
          critical_count: data.summary?.critical_count ?? 2,
          high_count: data.summary?.high_count ?? 2,
          total_penalty: data.summary?.total_penalty ?? 16000,
          avg_delay_hours: data.summary?.avg_delay_hours ?? 34,
        });
      }
    } catch {
      // Fallback calibrated Scenario A data
      setOrders([
        {
          order_id: 'ORD-1042',
          order_code: 'ORD-1042',
          customer_name: 'Apollo Hospitals Chennai',
          sku_code: 'SKU-INS-100',
          quantity: 25,
          original_due_date: '2026-10-30T10:00:00Z',
          best_recoverable_date: '2026-10-31T20:00:00Z',
          committed_promise_date: '2026-10-31T14:00:00Z',
          delay_hours: 34,
          penalty_exposure: 5000,
          score: 88,
          risk_band: 'CRITICAL',
          days_of_cover: 0.8,
          cover_drift_hours: 18,
          factors: {
            delay_factor: 34,
            quantity_factor: 25,
            penalty_factor: 35,
            inventory_buffer_offset: -6,
          },
        },
        {
          order_id: 'ORD-1047',
          order_code: 'ORD-1047',
          customer_name: 'Fortis Malar Hospital',
          sku_code: 'SKU-INS-100',
          quantity: 15,
          original_due_date: '2026-10-30T14:00:00Z',
          best_recoverable_date: '2026-10-31T22:00:00Z',
          delay_hours: 32,
          penalty_exposure: 3000,
          score: 82,
          risk_band: 'CRITICAL',
          days_of_cover: 1.2,
          cover_drift_hours: 14,
          factors: {
            delay_factor: 32,
            quantity_factor: 18,
            penalty_factor: 36,
            inventory_buffer_offset: -4,
          },
        },
        {
          order_id: 'ORD-1051',
          order_code: 'ORD-1051',
          customer_name: 'MIOT International',
          sku_code: 'SKU-INS-100',
          quantity: 20,
          original_due_date: '2026-10-31T08:00:00Z',
          best_recoverable_date: '2026-11-01T12:00:00Z',
          delay_hours: 28,
          penalty_exposure: 4000,
          score: 74,
          risk_band: 'HIGH',
          days_of_cover: 2.1,
          cover_drift_hours: 9,
          factors: {
            delay_factor: 28,
            quantity_factor: 20,
            penalty_factor: 30,
            inventory_buffer_offset: -4,
          },
        },
        {
          order_id: 'ORD-1055',
          order_code: 'ORD-1055',
          customer_name: 'Kauvery Hospital',
          sku_code: 'SKU-INS-100',
          quantity: 10,
          original_due_date: '2026-10-31T12:00:00Z',
          best_recoverable_date: '2026-11-01T16:00:00Z',
          delay_hours: 28,
          penalty_exposure: 4000,
          score: 68,
          risk_band: 'HIGH',
          days_of_cover: 2.6,
          cover_drift_hours: 6,
          factors: {
            delay_factor: 28,
            quantity_factor: 12,
            penalty_factor: 32,
            inventory_buffer_offset: -4,
          },
        },
      ]);
      setSummary({
        total_orders: 4,
        critical_count: 2,
        high_count: 2,
        total_penalty: 16000,
        avg_delay_hours: 30.5,
      });
      setHeatgrid([
        { warehouse: 'WH-MAA-01 (Chennai Central)', sku: 'SKU-INS-100', impact_count: 4, severity: 'CRITICAL', stockout_hrs: 14 },
        { warehouse: 'WH-BLR-02 (Bengaluru Hub)', sku: 'SKU-INS-100', impact_count: 0, severity: 'LOW', stockout_hrs: 72 },
        { warehouse: 'WH-MAA-01 (Chennai Central)', sku: 'SKU-PPE-500', impact_count: 1, severity: 'MEDIUM', stockout_hrs: 36 },
        { warehouse: 'WH-HYD-01 (Hyderabad North)', sku: 'SKU-VAC-200', impact_count: 0, severity: 'LOW', stockout_hrs: 80 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchImpactData();
  }, [selectedDisruptionId]);

  // Handle open drawer & fetch real lineage
  const handleOpenDrawer = async (order: RankedOrder) => {
    setSelectedOrder(order);
    setSelectedEdgeData(null);
    setDrawerOpen(true);
    setLineageLoading(true);

    try {
      const lineage = await api.impact.getLineage(order.order_id, selectedDisruptionId);
      setLineageData(lineage);
    } catch {
      // Fallback synthetic lineage matching Step 10 A8 causal chain
      setLineageData({
        order_id: order.order_id,
        order_code: order.order_code,
        disruption_id: selectedDisruptionId,
        edges: [
          {
            from_type: 'Supplier',
            from_id: 'SUP-CHENNAI-01',
            to_type: 'Shipment',
            to_id: 'SHP-9021',
            relation: 'DISPATCH_DELAYED',
            calculation: 'Actual departure 2026-10-29T18:00 vs Planned 2026-10-28T08:00 (+34h shift)',
            evidence_ids: ['EVD-CARRIER-GPS-88', 'EVD-EDI-214'],
            observed_at: '2026-10-29T18:15:00Z',
          },
          {
            from_type: 'Shipment',
            from_id: 'SHP-9021',
            to_type: 'Warehouse',
            to_id: 'WH-MAA-01',
            relation: 'STOCKOUT_INDUCED',
            calculation: 'Inbound buffer exhausted: OnHand(20) < DemandRate(5/hr) * Delay(34h) = 170 deficit',
            evidence_ids: ['EVD-LEDGER-SNAP-401'],
            observed_at: '2026-10-30T04:00:00Z',
          },
          {
            from_type: 'Warehouse',
            from_id: 'WH-MAA-01',
            to_type: 'Order',
            to_id: order.order_code,
            relation: 'FULFILMENT_BREACH',
            calculation: `Order due ${order.original_due_date.slice(0, 10)} requires qty ${order.quantity}; allocation starved`,
            evidence_ids: ['EVD-SLA-CONTRACT-77'],
            observed_at: '2026-10-30T06:30:00Z',
          },
        ],
      });
    } finally {
      setLineageLoading(false);
    }
  };

  // Convert lineage edges into ReactFlow nodes and edges
  const { flowNodes, flowEdges } = useMemo(() => {
    if (!lineageData || !lineageData.edges || lineageData.edges.length === 0) {
      return { flowNodes: [], flowEdges: [] };
    }

    const rawEdges = lineageData.edges;
    const nodesMap = new Map<string, Node>();
    const edges: Edge[] = [];

    // Distinct entities
    const rawNodes: Array<{ id: string; label: string; type: string }> = [];

    rawEdges.forEach((e: any) => {
      if (!rawNodes.find((n) => n.id === e.from_id)) {
        rawNodes.push({ id: e.from_id, label: `${e.from_type}: ${e.from_id}`, type: e.from_type });
      }
      if (!rawNodes.find((n) => n.id === e.to_id)) {
        rawNodes.push({ id: e.to_id, label: `${e.to_type}: ${e.to_id}`, type: e.to_type });
      }
    });

    rawNodes.forEach((n, idx) => {
      let bg = '#ffffff';
      let border = '#cbd5e1';
      let text = '#0f172a';

      if (n.type === 'Supplier') {
        bg = '#eef2ff';
        border = '#a5b4fc';
        text = '#312e81';
      } else if (n.type === 'Shipment') {
        bg = '#fffbeb';
        border = '#fde68a';
        text = '#78350f';
      } else if (n.type === 'Warehouse') {
        bg = '#ecfdf5';
        border = '#a7f3d0';
        text = '#064e3b';
      } else if (n.type === 'Order') {
        bg = '#fff1f2';
        border = '#fecdd3';
        text = '#881337';
      }

      nodesMap.set(n.id, {
        id: n.id,
        position: { x: idx * 220 + 20, y: 80 + (idx % 2 === 1 ? 50 : 0) },
        data: { label: n.label },
        style: {
          background: bg,
          color: text,
          border: `1.5px solid ${border}`,
          borderRadius: '8px',
          padding: '10px 14px',
          fontSize: '11px',
          fontWeight: '600',
          width: 170,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        },
      });
    });

    rawEdges.forEach((e: any, idx: number) => {
      edges.push({
        id: `e-${idx}`,
        source: e.from_id,
        target: e.to_id,
        label: e.relation.replace('_', ' '),
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#4f46e5' },
        style: { stroke: '#4f46e5', strokeWidth: 2, cursor: 'pointer' },
        labelStyle: { fill: '#4338ca', fontSize: 10, fontWeight: 700 },
        data: e,
      });
    });

    return { flowNodes: Array.from(nodesMap.values()), flowEdges: edges };
  }, [lineageData]);

  return (
    <div className="p-6 space-y-6 text-slate-900 max-w-7xl mx-auto">
      {/* Header & Disruption Selector */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">5. Impact and Risk Analysis</h1>
            <span className="px-2 py-0.5 text-xs font-mono rounded bg-rose-50 text-rose-700 border border-rose-200 font-semibold">
              Live Causal Ranking
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic risk score (0-100), factor waterfall, and causal event lineage
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-600">Target Disruption:</label>
            <select
              className="bg-white border border-slate-300 text-slate-900 text-xs rounded-md px-3 py-1.5 shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={selectedDisruptionId}
              onChange={(e) => setSelectedDisruptionId(e.target.value)}
            >
              {disruptions.length === 0 ? (
                <option value="DSR-DEFAULT">Disruption #9021 (Chennai Express Flooding)</option>
              ) : (
                disruptions.map((d) => (
                  <option key={d._id || d.id} value={d._id || d.id}>
                    {d.title || d.description || `Disruption ${d._id || d.id}`} ({d.status})
                  </option>
                ))
              )}
            </select>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchImpactData}>
            <RefreshCw className="w-3.5 h-3.5 mr-1 text-slate-500" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI & Risk Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block font-medium">Impacted Orders</span>
          <span className="text-xl font-bold font-mono text-slate-900 mt-0.5 block">{summary.total_orders}</span>
          <span className="text-xs text-slate-400">active demand lines</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block font-medium">Critical Breaches</span>
          <span className="text-xl font-bold font-mono text-rose-600 mt-0.5 block">{summary.critical_count}</span>
          <span className="text-xs text-rose-600 font-semibold">score &ge; 80</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block font-medium">High Risk Orders</span>
          <span className="text-xl font-bold font-mono text-amber-600 mt-0.5 block">{summary.high_count}</span>
          <span className="text-xs text-amber-600 font-semibold">score 60 - 79</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block font-medium">Penalty Exposure</span>
          <div className="text-xl font-bold font-mono text-slate-900 mt-0.5">
            <MoneyText amountInr={summary.total_penalty} />
          </div>
          <span className="text-xs text-slate-400">contract SLA breach</span>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs">
          <span className="text-xs text-slate-500 block font-medium">Avg Delivery Shift</span>
          <span className="text-xl font-bold font-mono text-indigo-600 mt-0.5 block">+{summary.avg_delay_hours} hrs</span>
          <span className="text-xs text-slate-400">cumulative drift</span>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex border-b border-slate-200 gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('ranked')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'ranked'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Layers className="w-4 h-4" />
          Ranked Orders & Factor Waterfall
        </button>
        <button
          onClick={() => setActiveTab('heatgrid')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'heatgrid'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <GitBranch className="w-4 h-4" />
          Heat-Grid Risk Matrix
        </button>
        <button
          onClick={() => setActiveTab('network')}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-colors ${
            activeTab === 'network'
              ? 'border-indigo-600 text-indigo-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Network className="w-4 h-4" />
          B2 Network Geography Map
        </button>
      </div>

      {/* Tab 1: Ranked Orders & Factor Waterfall */}
      {activeTab === 'ranked' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Click any order or Risk Band chip to open the causal Factor Waterfall & A8 Lineage Graph</span>
            <span className="font-mono text-slate-400">Score Range: 0 (Safe) to 100 (Immediate Breach)</span>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              title="No impacted orders detected"
              description="This disruption does not intersect any open order allocation or warehouse buffer."
            />
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white shadow-xs">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 uppercase tracking-wider font-semibold">
                    <th className="py-3 px-4">Order Code</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">SKU</th>
                    <th className="py-3 px-4 text-right">Quantity</th>
                    <th className="py-3 px-4">Original Due</th>
                    <th className="py-3 px-4 text-right">Delay</th>
                    <th className="py-3 px-4 text-right">SLA Exposure</th>
                    <th className="py-3 px-4 text-center">Score</th>
                    <th className="py-3 px-4 text-center">Risk Band</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {orders.map((o) => (
                    <tr
                      key={o.order_id}
                      onClick={() => handleOpenDrawer(o)}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-indigo-600 flex items-center gap-1.5">
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                        {o.order_code}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-900">{o.customer_name}</td>
                      <td className="py-3 px-4 font-mono text-slate-700">{o.sku_code}</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-800">{o.quantity} units</td>
                      <td className="py-3 px-4 text-slate-700">
                        <TimeText iso={o.original_due_date} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-amber-700">+{o.delay_hours}h</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-rose-700">
                        <MoneyText amountInr={o.penalty_exposure} />
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-bold text-slate-900">
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                          {o.score}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <RiskBandChip band={o.risk_band} />
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDrawer(o);
                          }}
                        >
                          Evidence &gt;
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Factor Waterfall Explanatory Card */}
          <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-2 mb-3">
              <ShieldAlert className="w-4 h-4 text-indigo-600" />
              B5 Risk Band & Factor Scoring Engine
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-800 block font-semibold">1. Delay Factor (40% weight)</span>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  Logarithmic penalty slope scaling with hours past original SLA commitment.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-800 block font-semibold">2. Quantity Factor (25% weight)</span>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  Scale of affected units relative to total warehouse daily throughput.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-800 block font-semibold">3. Penalty Factor (25% weight)</span>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  Contractual INR liquidated damages rate per hour of unrecovered delay.
                </p>
              </div>
              <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-800 block font-semibold">4. Buffer Offset (-10% relief)</span>
                <p className="text-slate-600 mt-1 leading-relaxed">
                  Safety stock absorption capacity dampening impact prior to total stockout.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Heat-Grid Matrix */}
      {activeTab === 'heatgrid' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Facility vs SKU exposure cross-tabulation</span>
            <span className="text-slate-400">Calculated over rolling 72-hour planning horizon</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {heatgrid.map((cell, idx) => (
              <div
                key={idx}
                className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs flex items-start justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900">{cell.warehouse}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded font-mono font-bold border ${
                        cell.severity === 'CRITICAL'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : cell.severity === 'HIGH'
                          ? 'bg-amber-50 text-amber-800 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {cell.severity}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">SKU: {cell.sku}</div>
                  <div className="text-xs text-slate-600">Estimated stockout in {cell.stockout_hrs} hours</div>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-bold font-mono text-indigo-600">{cell.impact_count}</span>
                  <span className="block text-xs text-slate-400">orders starving</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 3: B2 Network Geography Map */}
      {activeTab === 'network' && (
        <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Network className="w-4 h-4 text-indigo-600" />
              B2 Supply Chain Topology & Active Lanes
            </h3>
            <p className="text-xs text-slate-500">
              Interactive node topology displaying suppliers, transit routes, and fulfillment warehouses.
            </p>
          </div>
          <NetworkMap />
        </div>
      )}

      {/* Evidence & Lineage Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selectedOrder ? `Order Evidence & Lineage: ${selectedOrder.order_code}` : 'Order Evidence'}
        width="w-[720px]"
      >
        {selectedOrder && (
          <div className="space-y-6 text-xs text-slate-700">
            {/* Header badges */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <span className="text-xs text-slate-500 block">Customer</span>
                <span className="text-sm font-semibold text-slate-900">{selectedOrder.customer_name}</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-slate-500 block">Risk Score</span>
                <span className="text-lg font-bold font-mono text-slate-900 flex items-center gap-1.5">
                  {selectedOrder.score} / 100
                  <RiskBandChip band={selectedOrder.risk_band} />
                </span>
              </div>
            </div>

            {/* A7 Date Chips */}
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                A7 Delivery Date Triangulation
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <span className="text-slate-500 block text-xs">Original SLA Due</span>
                  <span className="font-mono font-semibold text-slate-800 mt-1 block">
                    <TimeText iso={selectedOrder.original_due_date} />
                  </span>
                  <span className="text-xs text-slate-400">Contractual baseline</span>
                </div>
                <div className="p-3 rounded-lg bg-amber-50/60 border border-amber-200">
                  <span className="text-amber-800 block text-xs font-medium">Best Recoverable</span>
                  <span className="font-mono font-semibold text-amber-900 mt-1 block">
                    <TimeText iso={selectedOrder.best_recoverable_date} />
                  </span>
                  <span className="text-xs text-amber-700/80">Unassisted earliest</span>
                </div>
                <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-200">
                  <span className="text-emerald-800 block text-xs font-medium">Committed Promise</span>
                  <span className="font-mono font-semibold text-emerald-900 mt-1 block">
                    <TimeText iso={selectedOrder.committed_promise_date || selectedOrder.best_recoverable_date} />
                  </span>
                  <span className="text-xs text-emerald-700/80">Customer notice date</span>
                </div>
              </div>
            </div>

            {/* B13 Days of Cover & Drift Hint */}
            <div className="p-4 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-600">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-slate-800">B13 Days of Cover Buffer</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono font-bold text-slate-900 text-sm">
                      {selectedOrder.days_of_cover} days
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 font-medium">
                      Projection: {selectedOrder.cover_drift_hours}h drift
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-400 max-w-[200px] text-right">
                Based on continuous ledger consumption rate
              </span>
            </div>

            {/* Factor Waterfall Bars */}
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-indigo-600" />
                Factor Breakdown Waterfall
              </h4>

              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Delay Factor (+{selectedOrder.delay_hours} hrs)</span>
                    <span className="font-mono text-indigo-700 font-semibold">+{selectedOrder.factors.delay_factor} pts</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-indigo-600 h-full rounded-full"
                      style={{ width: `${Math.min(100, selectedOrder.factors.delay_factor * 2)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Quantity Scale ({selectedOrder.quantity} units)</span>
                    <span className="font-mono text-amber-700 font-semibold">+{selectedOrder.factors.quantity_factor} pts</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-500 h-full rounded-full"
                      style={{ width: `${Math.min(100, selectedOrder.factors.quantity_factor * 2)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Liquidated Damages Rate</span>
                    <span className="font-mono text-rose-700 font-semibold">+{selectedOrder.factors.penalty_factor} pts</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-rose-500 h-full rounded-full"
                      style={{ width: `${Math.min(100, selectedOrder.factors.penalty_factor * 2)}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-600">Safety Stock Buffer Offset</span>
                    <span className="font-mono text-emerald-700 font-semibold">{selectedOrder.factors.inventory_buffer_offset} pts</span>
                  </div>
                  <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full"
                      style={{ width: `${Math.abs(selectedOrder.factors.inventory_buffer_offset) * 3}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* A8 Lineage Graph (ReactFlow) */}
            <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <GitBranch className="w-3.5 h-3.5 text-indigo-600" />
                  A8 Causal Event Lineage
                </h4>
                <span className="text-xs text-slate-400">Click any transition line to inspect proof calculation</span>
              </div>

              {lineageLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : flowNodes.length > 0 ? (
                <div className="h-56 w-full border border-slate-200 rounded-lg bg-slate-50 overflow-hidden relative">
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    fitView
                    nodesDraggable={false}
                    nodesConnectable={false}
                    zoomOnScroll={false}
                    onEdgeClick={(_, edge) => setSelectedEdgeData(edge.data)}
                  >
                    <Background color="#cbd5e1" gap={16} size={1} />
                    <Controls showInteractive={false} />
                  </ReactFlow>
                </div>
              ) : (
                <EmptyState title="No lineage chain available" description="Could not resolve upstream transit nodes." />
              )}

              {/* Edge Calculation Inspector */}
              {selectedEdgeData && (
                <div className="p-3.5 rounded-lg bg-indigo-50 border border-indigo-200 space-y-1.5 animate-fadeIn">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-indigo-900 text-xs">
                      Edge Proof: {selectedEdgeData.relation}
                    </span>
                    <button
                      onClick={() => setSelectedEdgeData(null)}
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="font-mono text-slate-800 text-xs bg-white p-2.5 rounded border border-slate-200">
                    {selectedEdgeData.calculation}
                  </div>
                  <div className="flex items-center justify-between text-slate-500 text-xs pt-1">
                    <span>Observed: {selectedEdgeData.observed_at}</span>
                    <span>Evidence IDs: {selectedEdgeData.evidence_ids?.join(', ')}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
