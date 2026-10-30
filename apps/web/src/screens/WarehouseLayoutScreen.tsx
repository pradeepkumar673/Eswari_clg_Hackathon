/**
 * apps/web/src/screens/WarehouseLayoutScreen.tsx
 *
 * Screen 11: Warehouse Zone Capacity Mapper (Leaflet CRS.Simple 0-1000 Space).
 *
 * Features:
 * - Leaflet map with CRS.Simple on 0-1000 coordinate space (no tile layer).
 * - Warehouse boundaries (0 to 1000 coordinate box).
 * - Zones rendered as coloured polygons with labels (GREEN, AMBER, RED).
 * - RED zones rendered with thick red outline (pulsing effect).
 * - Tooltip & Click Drawer: zone name, type, capacity_slots, occupied_slots,
 *   reserved_inbound_slots, projected_utilisation %, and verbatim explanation sentence.
 * - Editing (Manager and Admin only): vertex editing controls. Save calls PATCH /zones/:id.
 * - Side panel: quick-assign SKU units; "Check incoming shipment" simulates arrivals without writing.
 * - Inbound plan reservation: POST /capacity/inbound-plans with governed plan_over_capacity for Managers.
 * - Keyboard accessible: alternative List View with identical numbers and actions.
 * - Real-time WebSocket: listens to 'capacity' and 'zones' topics to update colours live.
 * - Presence banner: shows "Operator X is also viewing this zone" when viewing same zone.
 * - Mobile 390px responsive compatibility.
 */

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, Polygon, Tooltip as LeafletTooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { api, getStoredUser, getStoredToken } from '../api/client.js';
import { resolveWarehouseCode } from '../utils/normalize.js';
import { WarehouseSiteMap } from '../ui/WarehouseSiteMap.js';
import { useWarehouses } from '../hooks/useWarehouses.js';
import { WarehouseSelector } from '../ui/WarehouseSelector.js';
import { NewWarehouseDialog } from '../ui/NewWarehouseDialog.js';
import {
  Button,
  Drawer,
  ErrorState,
  Skeleton,
} from '../ui/components.js';
import {
  Warehouse as WarehouseIcon,
  AlertTriangle,
  RefreshCw,
  Eye,
  Sliders,
  Trash2,
  Users,
  Search,
  List,
  Map as MapIcon,
  ArrowRight,
} from 'lucide-react';

export interface ZoneData {
  zone_id: string;
  name: string;
  warehouse_id: string;
  zone_type: string;
  capacity_slots: number;
  occupied_slots: number;
  reserved_inbound_slots: number;
  projected_slots: number;
  utilization_pct: number;
  colour: 'GREEN' | 'AMBER' | 'RED';
  explanation: string;
  polygon: Array<[number, number]>;
  assignments: Array<{ sku_id: string; units: number; slots: number }>;
  inbound_plans: Array<{ plan_id: string; shipment_id: string; slots: number; status: string }>;
}

const clamp1000 = (n: number) => Math.max(0, Math.min(1000, Math.round(n)));

/** Adds the geoman toolbar (draw polygon/rectangle + edit vertices) to the Leaflet map. */
function ZoneDrawControls({ onCreated }: { onCreated: (pts: [number, number][]) => void }) {
  const map = useMap();
  const cbRef = useRef(onCreated);
  cbRef.current = onCreated;

  useEffect(() => {
    const pm = (map as any).pm;
    if (!pm) return;
    pm.addControls({
      position: 'topleft',
      drawPolygon: true,
      drawRectangle: true,
      editMode: true,
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawText: false,
      dragMode: false,
      cutPolygon: false,
      removalMode: false,
      rotateMode: false,
    });
    pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true });

    const handleCreate = (e: any) => {
      const ring: L.LatLng[] = e.layer.getLatLngs()[0];
      // Leaflet is [lat, lng] = [y, x]; the DB stores [x, y]
      const pts = ring.map((ll) => [clamp1000(ll.lng), clamp1000(ll.lat)] as [number, number]);
      map.removeLayer(e.layer); // real polygon is re-rendered from the API after save
      cbRef.current(pts);
    };

    map.on('pm:create', handleCreate);
    return () => {
      map.off('pm:create', handleCreate);
      pm.removeControls();
    };
  }, [map]);

  return null;
}

export function WarehouseLayoutScreen() {
  const currentUser = getStoredUser();
  const isManagerOrAdmin = currentUser?.role === 'Manager' || currentUser?.role === 'Administrator';
  const { warehouses, refresh: refreshWarehouses } = useWarehouses();
  const [showNewWarehouse, setShowNewWarehouse] = useState(false);

  const [warehouseId, setWarehouseId] = useState<string>(resolveWarehouseCode(currentUser));
  const [zones, setZones] = useState<ZoneData[]>([]);
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Zone Drawer
  const [selectedZone, setSelectedZone] = useState<ZoneData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Accessible View Toggle (Site Map vs Zone Grid vs List)
  const [viewMode, setViewMode] = useState<'site' | 'map' | 'list'>('site');

  // Quick Assign State
  const [assignSku, setAssignSku] = useState('SKU-101');
  const [assignUnits, setAssignUnits] = useState('10');
  const [assignSubmitting, setAssignSubmitting] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Check Inbound State
  const [checkModalOpen, setCheckModalOpen] = useState(false);
  const [checkShipmentId, setCheckShipmentId] = useState('SHP-HOS-001');
  const [checkZoneId, setCheckZoneId] = useState('');
  const [checkSlots, setCheckSlots] = useState('5');
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [planOverCapacity, setPlanOverCapacity] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);

  // Vertex Editing State
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editPoints, setEditPoints] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Presence State
  const [presenceUser, setPresenceUser] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // New-zone form (opens after the user finishes drawing a polygon)
  const [pendingPolygon, setPendingPolygon] = useState<[number, number][] | null>(null);
  const [newZone, setNewZone] = useState({ name: '', zone_type: 'STORAGE', capacity_slots: '50' });
  const [newZoneSaving, setNewZoneSaving] = useState(false);

  const fetchCapacity = async () => {
    try {
      setLoading(true);
      setError(null);
      const [overviewData, zonesData] = await Promise.all([
        api.capacity.getOverview(warehouseId).catch(() => null),
        api.capacity.getZones(warehouseId), // errors now reach the catch below
      ]);

      setOverview(overviewData);
      setZones(Array.isArray(zonesData) ? zonesData : []);

      if (selectedZone) {
        const refreshed = (Array.isArray(zonesData) ? zonesData : []).find(
          (z: ZoneData) => z.zone_id === selectedZone.zone_id,
        );
        if (refreshed) setSelectedZone(refreshed);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load warehouse zones');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCapacity();
  }, [warehouseId]);

  // WebSocket for Real-time Capacity Updates & Presence
  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const socket = new WebSocket(wsUrl);
    wsRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'auth', token }));
      socket.send(JSON.stringify({ type: 'subscribe', topic: 'capacity' }));
      socket.send(JSON.stringify({ type: 'subscribe', topic: 'presence' }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.topic === 'capacity' || msg.topic === 'zones') {
          // Re-fetch zones on live updates
          api.capacity.getZones(warehouseId).then((res) => {
            if (res) setZones(res);
          }).catch(() => {});
          api.capacity.getOverview(warehouseId).then((res) => {
            if (res) setOverview(res);
          }).catch(() => {});
        } else if (msg.topic === 'presence') {
          const data = msg.data;
          if (
            data.kind === 'zone' &&
            selectedZone &&
            data.id === selectedZone.zone_id &&
            data.username !== currentUser?.username
          ) {
            setPresenceUser(data.username || data.role || 'Another operator');
            setTimeout(() => setPresenceUser(null), 5000);
          }
        }
      } catch {
        // Ignore message error
      }
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [warehouseId, selectedZone?.zone_id]);

  // Emit presence when a zone is opened
  const handleOpenZone = (zone: ZoneData) => {
    setSelectedZone(zone);
    setDrawerOpen(true);
    setAssignError(null);
    setCheckZoneId(zone.zone_id);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'viewing',
          kind: 'zone',
          id: zone.zone_id,
        })
      );
    }
  };

  const handleStockAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedZone) return;
    try {
      setAssignSubmitting(true);
      setAssignError(null);
      const units = parseInt(assignUnits, 10);
      if (isNaN(units) || units < 0) {
        setAssignError('Units must be a non-negative integer');
        return;
      }

      await api.capacity.assignStock(selectedZone.zone_id, assignSku, units);
      await fetchCapacity();
      const updated = await api.capacity.getZone(selectedZone.zone_id);
      setSelectedZone(updated);
      setAssignUnits('10');
    } catch (err: any) {
      setAssignError(err.message || 'Stock assignment failed');
    } finally {
      setAssignSubmitting(false);
    }
  };

  const handleCheckInbound = async () => {
    if (!checkZoneId) return;
    try {
      setChecking(true);
      setCheckResult(null);
      const slots = parseInt(checkSlots, 10) || 0;
      const res = await api.capacity.checkCapacity(checkZoneId, checkShipmentId, slots);
      setCheckResult(res);
    } catch (err: any) {
      setCheckResult({ error: err.message || 'Capacity check failed' });
    } finally {
      setChecking(false);
    }
  };

  const handleConfirmInboundPlan = async () => {
    if (!checkZoneId) return;
    try {
      setPlanSubmitting(true);
      const slots = parseInt(checkSlots, 10) || 0;
      await api.capacity.createInboundPlan(
        checkShipmentId,
        checkZoneId,
        slots,
        planOverCapacity
      );
      await fetchCapacity();
      if (selectedZone) {
        const updated = await api.capacity.getZone(selectedZone.zone_id);
        setSelectedZone(updated);
      }
      setCheckModalOpen(false);
      setCheckResult(null);
    } catch (err: any) {
      setCheckResult((prev: any) => ({ ...prev, commitError: err.message || 'Failed to create plan' }));
    } finally {
      setPlanSubmitting(false);
    }
  };

  const handleReleasePlan = async (planId: string) => {
    try {
      await api.capacity.deleteInboundPlan(planId);
      await fetchCapacity();
      if (selectedZone) {
        const updated = await api.capacity.getZone(selectedZone.zone_id);
        setSelectedZone(updated);
      }
    } catch (err: any) {
      alert(`Failed to release plan: ${err.message}`);
    }
  };

  const handleStartEdit = (zone: ZoneData) => {
    setEditingZoneId(zone.zone_id);
    setEditPoints(JSON.stringify(zone.polygon));
  };

  const handleSavePolygon = async (zoneId: string) => {
    try {
      setEditSubmitting(true);
      const parsedPoints = JSON.parse(editPoints);
      if (!Array.isArray(parsedPoints) || parsedPoints.length < 3) {
        alert('Polygon must be an array of at least 3 [x, y] coordinates');
        return;
      }
      await api.capacity.patchZone(zoneId, { polygon: parsedPoints });
      setEditingZoneId(null);
      await fetchCapacity();
    } catch (err: any) {
      alert(`Failed to save polygon: ${err.message}`);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleSaveNewZone = async () => {
    if (!pendingPolygon) return;
    try {
      setNewZoneSaving(true);
      await api.capacity.createZone({
        zone_id: `ZN-${warehouseId.replace('WH-', '')}-${Date.now().toString().slice(-5)}`,
        warehouse_id: warehouseId,
        name: newZone.name.trim(),
        zone_type: newZone.zone_type,
        capacity_slots: parseInt(newZone.capacity_slots, 10) || 0,
        polygon: pendingPolygon,
      });
      setPendingPolygon(null);
      setNewZone({ name: '', zone_type: 'STORAGE', capacity_slots: '50' });
      await fetchCapacity();
    } catch (err: any) {
      alert(`Could not create zone: ${err.message}`);
    } finally {
      setNewZoneSaving(false);
    }
  };

  // Fired by geoman after a vertex of an existing zone is dragged
  const handleZoneEdited = async (zoneId: string, layer: any) => {
    try {
      const ring: L.LatLng[] = layer.getLatLngs()[0];
      const pts = ring.map((ll) => [clamp1000(ll.lng), clamp1000(ll.lat)] as [number, number]);
      await api.capacity.patchZone(zoneId, { polygon: pts });
      await fetchCapacity();
    } catch (err: any) {
      alert(`Could not save polygon: ${err.message}`);
      await fetchCapacity(); // revert to the saved shape
    }
  };

  const getColourClass = (colour: string) => {
    switch (colour) {
      case 'RED':
        return 'text-rose-700 bg-rose-50 border-rose-300';
      case 'AMBER':
        return 'text-amber-800 bg-amber-50 border-amber-300';
      case 'GREEN':
      default:
        return 'text-emerald-800 bg-emerald-50 border-emerald-300';
    }
  };

  const getPolygonStyle = (colour: string) => {
    switch (colour) {
      case 'RED':
        return {
          fillColor: '#EF4444',
          fillOpacity: 0.45,
          color: '#DC2626',
          weight: 4,
          dashArray: '6, 4',
        };
      case 'AMBER':
        return {
          fillColor: '#F59E0B',
          fillOpacity: 0.35,
          color: '#D97706',
          weight: 2,
        };
      case 'GREEN':
      default:
        return {
          fillColor: '#10B981',
          fillOpacity: 0.35,
          color: '#059669',
          weight: 2,
        };
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Presence Alert Banner */}
      {presenceUser && (
        <div className="bg-sky-50 border border-sky-300 text-sky-800 px-4 py-3 rounded-lg flex items-center justify-between text-sm shadow-sm animate-pulse">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-sky-600" />
            <span className="font-semibold">Operator {presenceUser} is also viewing this zone.</span>
          </div>
          <span className="text-xs bg-sky-200 px-2 py-0.5 rounded text-sky-900 font-medium">LIVE COLLABORATION</span>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <WarehouseIcon className="w-6 h-6 text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900">Warehouse Capacity Mapper</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              CRS.Simple (0–1000)
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Deterministic slot occupancy, geoman zone boundary mapping, and inbound slot governance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Warehouse Selector */}
          <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-lg border border-slate-200">
            <span className="text-xs font-semibold text-slate-600 px-2">Warehouse:</span>
            <WarehouseSelector
              warehouses={warehouses.filter((w) => w.is_active)}
              value={warehouseId}
              onChange={setWarehouseId}
              onCreateNew={() => setShowNewWarehouse(true)}
              canCreate={isManagerOrAdmin}
            />
          </div>

          {/* Map vs List View Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setViewMode('site')}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-all ${
                viewMode === 'site'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Site Map
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-all ${
                viewMode === 'map'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              Zone Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded font-medium transition-all ${
                viewMode === 'list'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List View (Accessible)
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCheckZoneId(zones[0]?.zone_id || '');
              setCheckModalOpen(true);
            }}
          >
            <Search className="w-3.5 h-3.5 mr-1 text-indigo-600" />
            Check Inbound
          </Button>

          <Button variant="ghost" size="sm" onClick={fetchCapacity}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Warehouse Rollup KPI Cards */}
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Slots</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{overview.total_capacity_slots}</div>
            <div className="text-xs text-slate-500 mt-0.5">Physical storage capacity</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Occupied Slots</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{overview.total_occupied_slots}</div>
            <div className="text-xs text-slate-500 mt-0.5">Assigned SKU stock</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Reserved Inbound</div>
            <div className="text-2xl font-bold text-amber-700 mt-1">{overview.total_reserved_inbound_slots}</div>
            <div className="text-xs text-slate-500 mt-0.5">Planned shipments</div>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Projected Utilisation</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-2xl font-bold text-slate-900">{overview.overall_utilization_pct}%</span>
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold border ${getColourClass(
                  overview.overall_colour
                )}`}
              >
                {overview.overall_colour}
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Occupied + Inbound</div>
          </div>
        </div>
      )}

      {/* RED Zone Alert Feed (Listed First) */}
      {overview?.red_zones && overview.red_zones.length > 0 && (
        <div className="bg-rose-50 border border-rose-300 p-4 rounded-xl text-rose-900 shadow-sm space-y-2">
          <div className="flex items-center gap-2 font-bold text-sm text-rose-800">
            <AlertTriangle className="w-5 h-5 text-rose-600 animate-bounce" />
            CRITICAL CAPACITY EXCEEDED: {overview.red_zones.length} ZONE(S) AT RISK
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {overview.red_zones.map((rz: any) => (
              <div
                key={rz.zone_id}
                onClick={() => {
                  const z = zones.find((x) => x.zone_id === rz.zone_id);
                  if (z) handleOpenZone(z);
                }}
                className="bg-white p-3 rounded-lg border border-rose-200 cursor-pointer hover:border-rose-400 shadow-xs flex items-center justify-between"
              >
                <div>
                  <div className="font-bold text-slate-900 text-sm">{rz.name} ({rz.zone_id})</div>
                  <div className="text-xs text-rose-700 mt-0.5 font-medium">{rz.explanation}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-rose-600" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main View Area: Leaflet Map or Accessible List */}
      {viewMode === 'site' ? (
        <WarehouseSiteMap key={warehouseId} warehouseCode={warehouseId} canEdit={isManagerOrAdmin} />
      ) : loading ? (
        <div className="p-8 bg-white rounded-xl border border-slate-200 shadow-sm text-center">
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={fetchCapacity} />
      ) : viewMode === 'map' ? (
        /* LEAFLET CRS.SIMPLE MAP VIEW */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-3 rounded bg-emerald-500 inline-block"></span> GREEN (&lt;80%)
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-3 rounded bg-amber-500 inline-block"></span> AMBER (80-100%)
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <span className="w-3 h-3 rounded bg-rose-500 inline-block"></span> RED (&gt;100%)
              </span>
            </div>
            <span>Click any zone polygon to inspect or assign stock</span>
          </div>

          <div
            className="w-full h-[520px] rounded-lg border border-slate-300 overflow-hidden relative"
            style={{
              backgroundColor: '#f8fafc',
              backgroundImage:
                'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          >
            <MapContainer
              crs={L.CRS.Simple}
              bounds={[[0, 0], [1000, 1000]]}
              maxBounds={[[-100, -100], [1100, 1100]]}
              zoom={-1}
              minZoom={-2}
              maxZoom={2}
              zoomSnap={0.1}
              zoomDelta={0.5}
              style={{ width: '100%', height: '100%', background: 'transparent' }}
            >
              {isManagerOrAdmin && <ZoneDrawControls onCreated={setPendingPolygon} />}

              {/* Outer Warehouse Boundary (0,0 to 1000,1000) */}
              <Polygon
                positions={[
                  [0, 0],
                  [0, 1000],
                  [1000, 1000],
                  [1000, 0],
                ]}
                pathOptions={{
                  color: '#94a3b8',
                  weight: 2,
                  dashArray: '8, 8',
                  fill: false,
                  pmIgnore: true,
                } as any}
              />

              {/* Zones */}
              {zones
                .filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3)
                .map((zone) => {
                // DB polygon is [[x, y], ...]. In CRS.Simple, Leaflet maps [lat, lng] as [y, x]
                const positions: [number, number][] = zone.polygon.map(([x, y]) => [y, x]);
                const style = getPolygonStyle(zone.colour);

                return (
                  <Polygon
                    key={zone.zone_id}
                    positions={positions}
                    pathOptions={style}
                    eventHandlers={{
                      click: () => handleOpenZone(zone),
                      'pm:edit': (e: any) => handleZoneEdited(zone.zone_id, e.layer),
                    }}
                  >
                    <LeafletTooltip sticky direction="top" opacity={0.95}>
                      <div className="p-1 space-y-0.5 text-xs">
                        <div className="font-bold text-slate-900">{zone.name}</div>
                        <div className="text-slate-600">Type: {zone.zone_type} | ID: {zone.zone_id}</div>
                        <div className="font-medium text-slate-800">
                          Occupancy: {zone.occupied_slots} / {zone.capacity_slots} slots ({zone.utilization_pct}%)
                        </div>
                        <div className="text-slate-500">Reserved Inbound: {zone.reserved_inbound_slots} slots</div>
                        <div className={`font-semibold ${zone.colour === 'RED' ? 'text-rose-600' : 'text-slate-700'}`}>
                          {zone.explanation}
                        </div>
                      </div>
                    </LeafletTooltip>
                  </Polygon>
                );
              })}
            </MapContainer>
          </div>
        </div>
      ) : (
        /* ACCESSIBLE KEYBOARD-FRIENDLY LIST VIEW */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 font-semibold text-slate-900 text-sm">
            Warehouse Zones Breakdown ({zones.length} Zones)
          </div>
          <div className="divide-y divide-slate-100">
            {zones.map((zone) => (
              <div
                key={zone.zone_id}
                className="p-4 hover:bg-slate-50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">{zone.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono">
                      {zone.zone_id}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded font-bold border ${getColourClass(zone.colour)}`}>
                      {zone.colour} ({zone.utilization_pct}%)
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 font-medium">
                    {zone.explanation}
                  </div>
                  <div className="text-xs text-slate-500">
                    Capacity: {zone.capacity_slots} slots | Occupied: {zone.occupied_slots} slots | Planned Inbound: {zone.reserved_inbound_slots} slots
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleOpenZone(zone)}>
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    Details & Stock
                  </Button>
                  {isManagerOrAdmin && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleStartEdit(zone)}
                    >
                      <Sliders className="w-3.5 h-3.5 mr-1" />
                      Edit Vertices
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zone Detail & Quick Assign Drawer */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={selectedZone ? `${selectedZone.name} (${selectedZone.zone_id})` : 'Zone Details'}
      >
        {selectedZone && (
          <div className="space-y-6">
            {/* Occupancy Card */}
            <div className={`p-4 rounded-xl border ${getColourClass(selectedZone.colour)} space-y-2`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider">Occupancy Status</span>
                <span className="font-black text-sm">{selectedZone.colour}</span>
              </div>
              <div className="text-sm font-semibold">{selectedZone.explanation}</div>
              <div className="grid grid-cols-2 gap-2 pt-2 text-xs border-t border-slate-200">
                <div>
                  <span className="text-slate-500">Total Capacity:</span>{' '}
                  <span className="font-bold">{selectedZone.capacity_slots} slots</span>
                </div>
                <div>
                  <span className="text-slate-500">Occupied:</span>{' '}
                  <span className="font-bold">{selectedZone.occupied_slots} slots</span>
                </div>
                <div>
                  <span className="text-slate-500">Reserved Inbound:</span>{' '}
                  <span className="font-bold">{selectedZone.reserved_inbound_slots} slots</span>
                </div>
                <div>
                  <span className="text-slate-500">Projected:</span>{' '}
                  <span className="font-bold">{selectedZone.projected_slots} slots ({selectedZone.utilization_pct}%)</span>
                </div>
              </div>
            </div>

            {/* Current Stock Assignments */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-900 flex items-center justify-between">
                <span>Stock in Zone ({selectedZone.assignments?.length || 0} SKUs)</span>
              </div>

              {selectedZone.assignments && selectedZone.assignments.length > 0 ? (
                <div className="bg-slate-50 rounded-lg p-2 border border-slate-200 divide-y divide-slate-200 text-xs">
                  {selectedZone.assignments.map((a, i) => (
                    <div key={i} className="py-2 flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-800">{a.sku_id}</span>
                        <div className="text-slate-500">{a.units} physical units</div>
                      </div>
                      <span className="px-2 py-1 rounded bg-white border border-slate-200 font-semibold text-slate-700">
                        {a.slots} discrete slots
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
                  No inventory currently assigned to this zone.
                </div>
              )}
            </div>

            {/* Quick Assign Form */}
            <form onSubmit={handleStockAssign} className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Quick Assign SKU Stock
              </div>
              <p className="text-xs text-slate-500">
                Assigns physical on-hand units to this zone location. Does not mutate warehouse on-hand or reserved totals.
              </p>

              {assignError && (
                <div className="p-2 bg-rose-50 text-rose-700 border border-rose-200 rounded text-xs">
                  {assignError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-600 block mb-1 font-medium">SKU ID</label>
                  <select
                    value={assignSku}
                    onChange={(e) => setAssignSku(e.target.value)}
                    className="w-full text-xs p-2 rounded border border-slate-300 bg-white"
                  >
                    <option value="SKU-101">SKU-101 (10 units/slot)</option>
                    <option value="SKU-205">SKU-205 (10 units/slot)</option>
                    <option value="SKU-310">SKU-310 (10 units/slot)</option>
                    <option value="SKU-402">SKU-402 (10 units/slot)</option>
                    <option value="SKU-615">SKU-615 (10 units/slot)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-slate-600 block mb-1 font-medium">Units</label>
                  <input
                    type="number"
                    min="0"
                    value={assignUnits}
                    onChange={(e) => setAssignUnits(e.target.value)}
                    className="w-full text-xs p-2 rounded border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <Button type="submit" size="sm" className="w-full" disabled={assignSubmitting}>
                {assignSubmitting ? 'Assigning...' : 'Assign Stock to Zone'}
              </Button>
            </form>

            {/* Planned Inbound Reservations */}
            <div className="space-y-3">
              <div className="text-sm font-bold text-slate-900">
                Planned Inbound Slots ({selectedZone.inbound_plans?.length || 0})
              </div>

              {selectedZone.inbound_plans && selectedZone.inbound_plans.length > 0 ? (
                <div className="space-y-2">
                  {selectedZone.inbound_plans.map((p) => (
                    <div
                      key={p.plan_id}
                      className="p-3 bg-white rounded-lg border border-slate-200 shadow-2xs flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-slate-900">{p.shipment_id}</div>
                        <div className="text-slate-500">{p.slots} slots reserved</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleReleasePlan(p.plan_id)}
                        className="text-rose-600 hover:text-rose-800 hover:bg-rose-50 text-xs py-0.5 px-2"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Release
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-lg border border-slate-200 text-center">
                  No inbound plans currently reserved for this zone.
                </div>
              )}
            </div>

            {/* Manager Vertex Edit Box */}
            {isManagerOrAdmin && (
              <div className="pt-2 border-t border-slate-200">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-slate-700"
                  onClick={() => handleStartEdit(selectedZone)}
                >
                  <Sliders className="w-3.5 h-3.5 mr-1" />
                  Edit Zone Boundary Coordinates
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Inbound Shipment Check & Plan Modal */}
      {checkModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Search className="w-5 h-5 text-indigo-600" />
                Check Incoming Shipment Capacity
              </h3>
              <button
                onClick={() => setCheckModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Simulate an inbound shipment arrival against warehouse zones without writing any database records.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Target Zone</label>
                <select
                  value={checkZoneId}
                  onChange={(e) => setCheckZoneId(e.target.value)}
                  className="w-full text-xs p-2 rounded border border-slate-300 bg-white"
                >
                  {zones.map((z) => (
                    <option key={z.zone_id} value={z.zone_id}>
                      {z.name} ({z.zone_id}) — {z.occupied_slots + z.reserved_inbound_slots}/{z.capacity_slots} slots
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Shipment Code</label>
                  <input
                    type="text"
                    value={checkShipmentId}
                    onChange={(e) => setCheckShipmentId(e.target.value)}
                    className="w-full text-xs p-2 rounded border border-slate-300"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Required Slots</label>
                  <input
                    type="number"
                    min="1"
                    value={checkSlots}
                    onChange={(e) => setCheckSlots(e.target.value)}
                    className="w-full text-xs p-2 rounded border border-slate-300"
                  />
                </div>
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={handleCheckInbound}
                disabled={checking}
              >
                {checking ? 'Evaluating Capacity...' : 'Simulate Arrival (Read-Only)'}
              </Button>

              {/* Simulation Result */}
              {checkResult && (
                <div
                  className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                    checkResult.error
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : checkResult.would_exceed
                      ? 'bg-rose-50 border-rose-300 text-rose-900'
                      : 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  }`}
                >
                  {checkResult.error ? (
                    <div>{checkResult.error}</div>
                  ) : (
                    <>
                      <div className="font-bold flex items-center justify-between">
                        <span>Projected: {checkResult.colour}</span>
                        <span>{checkResult.projected?.utilization_pct}%</span>
                      </div>
                      <div className="font-medium">{checkResult.explanation}</div>

                      {checkResult.would_exceed && (
                        <div className="pt-2 border-t border-rose-200 space-y-2">
                          <div className="text-rose-700 font-semibold">
                            ⚠️ This inbound arrival would exceed available zone capacity.
                          </div>
                          {isManagerOrAdmin && (
                            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                              <input
                                type="checkbox"
                                checked={planOverCapacity}
                                onChange={(e) => setPlanOverCapacity(e.target.checked)}
                                className="rounded text-indigo-600"
                              />
                              <span>Manager Override (plan_over_capacity: true)</span>
                            </label>
                          )}
                        </div>
                      )}

                      <div className="pt-2">
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={
                            planSubmitting ||
                            (checkResult.would_exceed && !planOverCapacity)
                          }
                          onClick={handleConfirmInboundPlan}
                        >
                          {planSubmitting ? 'Reserving...' : 'Commit Inbound Plan'}
                        </Button>
                        {checkResult.commitError && (
                          <div className="text-rose-600 font-bold mt-1 text-center">
                            {checkResult.commitError}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Vertex Editor Modal */}
      {editingZoneId && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-600" />
                Edit Polygon Vertices ({editingZoneId})
              </h3>
              <button
                onClick={() => setEditingZoneId(null)}
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Coordinates must be bounded in 0 to 1000 space, contain $\ge 3$ vertices, and must not self-intersect.
            </p>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                JSON Polygon Points [[x, y], ...]
              </label>
              <textarea
                rows={5}
                value={editPoints}
                onChange={(e) => setEditPoints(e.target.value)}
                className="w-full text-xs font-mono p-2 rounded border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="ghost" size="sm" onClick={() => setEditingZoneId(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={editSubmitting}
                onClick={() => handleSavePolygon(editingZoneId)}
              >
                {editSubmitting ? 'Validating & Saving...' : 'Save Boundary (PATCH)'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingPolygon && (
        <div className="fixed inset-0 z-[2000] bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-md p-5 space-y-4">
            <h3 className="font-bold text-slate-900">New zone in {warehouseId}</h3>
            <p className="text-xs text-slate-500">{pendingPolygon.length} vertices drawn</p>

            <label className="block text-xs font-semibold text-slate-700">
              Zone name
              <input
                value={newZone.name}
                onChange={(e) => setNewZone({ ...newZone, name: e.target.value })}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                placeholder="e.g. Cold Storage B"
              />
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              Type
              <select
                value={newZone.zone_type}
                onChange={(e) => setNewZone({ ...newZone, zone_type: e.target.value })}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              >
                {['RECEIVING', 'STORAGE', 'DISPATCH', 'QUARANTINE'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-700">
              Capacity (slots)
              <input
                type="number"
                min={1}
                value={newZone.capacity_slots}
                onChange={(e) => setNewZone({ ...newZone, capacity_slots: e.target.value })}
                className="mt-1 w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setPendingPolygon(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveNewZone}
                loading={newZoneSaving}
                disabled={!newZone.name.trim()}
              >
                Save zone
              </Button>
            </div>
          </div>
        </div>
      )}

      {showNewWarehouse && (
        <NewWarehouseDialog
          onClose={() => setShowNewWarehouse(false)}
          onCreated={(code) => {
            setShowNewWarehouse(false);
            refreshWarehouses();
            setWarehouseId(code);
          }}
        />
      )}
    </div>
  );
}
