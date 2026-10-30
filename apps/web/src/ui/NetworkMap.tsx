/**
 * apps/web/src/ui/NetworkMap.tsx
 *
 * B2 Network Map: Plain SVG logistics network map (Bright Executive Theme).
 * Renders warehouses, suppliers, and transfer lanes with live highlighting of
 * disrupted shipments and destination hubs.
 * Clicking a node opens an inspection drawer listing orders behind it.
 */

import { useState } from 'react';
import { Drawer, MoneyText, RiskBandChip } from './components.js';

export interface MapNode {
  id: string;
  code: string;
  name: string;
  type: 'WAREHOUSE' | 'SUPPLIER';
  x: number;
  y: number;
  is_hub?: boolean;
  highlighted?: boolean;
}

export interface MapLane {
  from: string;
  to: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  distance_km: number;
  transit_hours: number;
}

const SEEDED_NODES: MapNode[] = [
  { id: '1', code: 'WH-BLR', name: 'Bangalore Hub', type: 'WAREHOUSE', x: 250, y: 700, is_hub: true },
  { id: '2', code: 'WH-HOS', name: 'Hosur Distribution Center', type: 'WAREHOUSE', x: 280, y: 750, is_hub: false, highlighted: true },
  { id: '3', code: 'WH-CHE', name: 'Chennai Central Hub', type: 'WAREHOUSE', x: 550, y: 680, is_hub: true },
  { id: '4', code: 'WH-COI', name: 'Coimbatore Hub', type: 'WAREHOUSE', x: 200, y: 820, is_hub: false },
  { id: '5', code: 'SUP-1', name: 'Tata AutoComp Component', type: 'SUPPLIER', x: 220, y: 350, highlighted: true },
  { id: '6', code: 'SUP-2', name: 'Bharat Forge Precision', type: 'SUPPLIER', x: 400, y: 300 },
  { id: '7', code: 'SUP-3', name: 'Sundram Fasteners', type: 'SUPPLIER', x: 520, y: 600 },
];

const SEEDED_LANES: MapLane[] = [
  { from: 'WH-BLR', to: 'WH-HOS', fromX: 250, fromY: 700, toX: 280, toY: 750, distance_km: 42, transit_hours: 2 },
  { from: 'WH-BLR', to: 'WH-CHE', fromX: 250, fromY: 700, toX: 550, toY: 680, distance_km: 340, transit_hours: 8 },
  { from: 'WH-BLR', to: 'WH-COI', fromX: 250, fromY: 700, toX: 200, toY: 820, distance_km: 360, transit_hours: 9 },
  { from: 'SUP-1', to: 'WH-BLR', fromX: 220, fromY: 350, toX: 250, toY: 700, distance_km: 480, transit_hours: 14 },
  { from: 'SUP-2', to: 'WH-BLR', fromX: 400, fromY: 300, toX: 250, toY: 700, distance_km: 510, transit_hours: 16 },
  { from: 'SUP-3', to: 'WH-CHE', fromX: 520, fromY: 600, toX: 550, toY: 680, distance_km: 90, transit_hours: 3 },
];

const SCENARIO_A_ORDERS_HOSUR = [
  { code: 'ORD-1042', customer: 'Ashok Leyland Motors', units: 40, penalty: 2000, status: 'OPEN', risk: 85 },
  { code: 'ORD-1047', customer: 'TVS Motor Manufacturing', units: 20, penalty: 1500, status: 'OPEN', risk: 75 },
  { code: 'ORD-1051', customer: 'Brakes India Hosur', units: 50, penalty: 3000, status: 'OPEN', risk: 90 },
];

export function NetworkMap() {
  const [selectedNode, setSelectedNode] = useState<MapNode | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleNodeClick = (node: MapNode) => {
    setSelectedNode(node);
    setDrawerOpen(true);
  };

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200 shadow-xs space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Logistics Network Map (B2)</h3>
          <p className="text-[11px] text-slate-500">
            Interactive plain SVG topology. Click any node to inspect inventory buffers and dependent orders.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded bg-indigo-600 inline-block" /> Hub
          </span>
          <span className="flex items-center gap-1.5 text-slate-700">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Supplier
          </span>
          <span className="flex items-center gap-1.5 text-rose-700 font-semibold">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping inline-block" /> Disrupted
          </span>
        </div>
      </div>

      {/* SVG Canvas (viewBox 0 0 800 1000) */}
      <div className="relative w-full h-[420px] bg-slate-50 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
        <svg viewBox="100 200 600 700" className="w-full h-full">
          {/* Transfer Lanes */}
          {SEEDED_LANES.map((lane, i) => (
            <g key={i}>
              <line
                x1={lane.fromX}
                y1={lane.fromY}
                x2={lane.toX}
                y2={lane.toY}
                stroke="#cbd5e1"
                strokeWidth={lane.distance_km < 100 ? 3 : 1.5}
                strokeDasharray={lane.distance_km > 300 ? '4 4' : 'none'}
              />
              <text
                x={(lane.fromX + lane.toX) / 2 + 5}
                y={(lane.fromY + lane.toY) / 2}
                fill="#64748b"
                fontSize="10"
                fontFamily="monospace"
              >
                {lane.distance_km}km ({lane.transit_hours}h)
              </text>
            </g>
          ))}

          {/* Nodes */}
          {SEEDED_NODES.map((node) => {
            const isDisrupted = node.highlighted;
            const isSupplier = node.type === 'SUPPLIER';

            return (
              <g
                key={node.id}
                onClick={() => handleNodeClick(node)}
                className="cursor-pointer transition-transform hover:scale-110"
              >
                {/* Disruption pulse ring */}
                {isDisrupted && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="22"
                    fill="none"
                    stroke="#f43f5e"
                    strokeWidth="2"
                    opacity="0.6"
                    className="animate-ping"
                  />
                )}

                {/* Node Shape */}
                {isSupplier ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r="14"
                    fill={isDisrupted ? '#f43f5e' : '#f59e0b'}
                    stroke="#ffffff"
                    strokeWidth="3"
                    filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))"
                  />
                ) : (
                  <rect
                    x={node.x - 14}
                    y={node.y - 14}
                    width="28"
                    height="28"
                    rx="6"
                    fill={isDisrupted ? '#f43f5e' : '#4f46e5'}
                    stroke="#ffffff"
                    strokeWidth="3"
                    filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))"
                  />
                )}

                {/* Label */}
                <text
                  x={node.x}
                  y={node.y + 24}
                  textAnchor="middle"
                  fill="#0f172a"
                  fontSize="11"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {node.code}
                </text>
                <text
                  x={node.x}
                  y={node.y + 36}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="9"
                >
                  {node.name.slice(0, 15)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Node Orders Inspection Drawer */}
      <Drawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={`Node Inspection: ${selectedNode?.code} — ${selectedNode?.name}`}
        width="max-w-lg"
      >
        <div className="space-y-4 text-xs text-slate-700">
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">Facility Type</span>
              <span className="font-mono text-slate-600">{selectedNode?.type}</span>
            </div>
            {selectedNode?.highlighted && (
              <div className="text-rose-700 font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                Active Disruption Impact: Downstream orders delayed
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              Orders Dependent on this Facility ({SCENARIO_A_ORDERS_HOSUR.length})
            </h4>

            <div className="space-y-2">
              {SCENARIO_A_ORDERS_HOSUR.map((o) => (
                <div key={o.code} className="p-3.5 rounded-lg bg-white border border-slate-200 shadow-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-900">{o.code}</span>
                    <RiskBandChip score={o.risk} />
                  </div>
                  <div className="text-slate-700 font-medium">{o.customer}</div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                    <span>Units: {o.units}</span>
                    <span>Hourly Penalty: <MoneyText amount={o.penalty} /></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
