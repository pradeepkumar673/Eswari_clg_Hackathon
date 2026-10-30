/**
 * apps/api/src/services/nearestWarehouse.ts
 *
 * Graph Dijkstra for road-network nearest warehouse calculations and
 * straight-line fallback for off-network telemetry.
 */

import mongoose from 'mongoose';
import { Warehouse } from '../models/warehouses.js';
import { TransferLane } from '../models/transfer-lanes.js';

export interface FindNearestWarehouseParams {
  lane_id?: string | null;
  km_on_lane?: number | null;
  lat?: number;
  lng?: number;
}

export interface NearestWarehouseResult {
  nearest_warehouse_id: string;
  nearest_warehouse_code: string;
  road_km: number;
  path: string[];
  method: 'ROAD_GRAPH' | 'STRAIGHT_LINE_ESTIMATE';
  distances: Record<string, number>;
}

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

export async function findNearestWarehouse(
  params: FindNearestWarehouseParams,
): Promise<NearestWarehouseResult> {
  const warehouses = await Warehouse.find({ is_active: { $ne: false }, lat: { $ne: null }, lng: { $ne: null } }).lean();
  if (warehouses.length === 0) {
    throw new Error('No warehouses configured in system');
  }

  // 1. OFF_NETWORK or Missing Lane Data -> STRAIGHT_LINE_ESTIMATE
  if (
    !params.lane_id ||
    params.km_on_lane === null ||
    params.km_on_lane === undefined ||
    params.lat === undefined ||
    params.lng === undefined
  ) {
    // If lane_id is provided, check if valid lane
    let laneDoc: any = null;
    if (params.lane_id && mongoose.Types.ObjectId.isValid(params.lane_id)) {
      laneDoc = await TransferLane.findById(params.lane_id).lean();
    }

    if (!laneDoc || params.km_on_lane === null || params.km_on_lane === undefined) {
      // Must use straight-line haversine
      const truckLat = params.lat ?? 12.7409;
      const truckLng = params.lng ?? 77.8253;

      const distances: Record<string, number> = {};
      let bestWh = warehouses[0];
      let minKm = Infinity;

      for (const wh of warehouses) {
        const d = haversineDistanceKm(truckLat, truckLng, wh.lat ?? 12.0, wh.lng ?? 77.0);
        distances[wh.code] = d;

        if (d < minKm || (d === minKm && wh.code.localeCompare(bestWh.code) < 0)) {
          minKm = d;
          bestWh = wh;
        }
      }

      return {
        nearest_warehouse_id: bestWh._id.toString(),
        nearest_warehouse_code: bestWh.code,
        road_km: minKm,
        path: [], // No road route proposed for off-network
        method: 'STRAIGHT_LINE_ESTIMATE',
        distances,
      };
    }
  }

  // 2. ROAD_GRAPH Dijkstra Calculation
  const laneDoc = await TransferLane.findById(params.lane_id).lean();
  if (!laneDoc) {
    throw new Error(`Lane not found: ${params.lane_id}`);
  }

  const allLanes = await TransferLane.find({}).lean();

  // Build undirected adjacency graph
  // Node IDs are strings
  const adj: Map<string, Array<{ to: string; dist: number }>> = new Map();

  const addEdge = (u: string, v: string, dist: number) => {
    if (!adj.has(u)) adj.set(u, []);
    adj.get(u)!.push({ to: v, dist });
  };

  for (const l of allLanes) {
    const u = l.from_warehouse_id.toString();
    const v = l.to_warehouse_id.toString();
    addEdge(u, v, l.distance_km);
    addEdge(v, u, l.distance_km);
  }

  const nodeA = laneDoc.from_warehouse_id.toString();
  const nodeB = laneDoc.to_warehouse_id.toString();
  const totalLaneDist = laneDoc.distance_km;
  const kmFromA = Math.max(0, Math.min(params.km_on_lane, totalLaneDist));
  const kmFromB = totalLaneDist - kmFromA;

  // Dijkstra from virtual truck position T
  // T connects to nodeA with weight kmFromA, and nodeB with weight kmFromB
  const distMap: Map<string, number> = new Map();
  const prevMap: Map<string, string | null> = new Map();
  const visited: Set<string> = new Set();

  // Populate all known nodes
  for (const wh of warehouses) {
    distMap.set(wh._id.toString(), Infinity);
  }
  for (const [node] of adj) {
    if (!distMap.has(node)) distMap.set(node, Infinity);
  }

  distMap.set(nodeA, kmFromA);
  prevMap.set(nodeA, null);

  distMap.set(nodeB, kmFromB);
  prevMap.set(nodeB, null);

  while (true) {
    // Find unvisited node with smallest distance
    let u: string | null = null;
    let uDist = Infinity;

    for (const [node, d] of distMap) {
      if (!visited.has(node) && d < uDist) {
        uDist = d;
        u = node;
      }
    }

    if (!u || uDist === Infinity) break;
    visited.add(u);

    const neighbors = adj.get(u) || [];
    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;
      const alt = uDist + edge.dist;
      if (alt < (distMap.get(edge.to) ?? Infinity)) {
        distMap.set(edge.to, alt);
        prevMap.set(edge.to, u);
      }
    }
  }

  // Find nearest warehouse
  const distancesByCode: Record<string, number> = {};
  let bestWh = warehouses[0];
  let minDistance = Infinity;

  for (const wh of warehouses) {
    const whId = wh._id.toString();
    const d = distMap.get(whId) ?? Infinity;
    distancesByCode[wh.code] = d;

    if (d < minDistance || (d === minDistance && wh.code.localeCompare(bestWh.code) < 0)) {
      minDistance = d;
      bestWh = wh;
    }
  }

  // Reconstruct path to best warehouse
  const path: string[] = [];
  let curr: string | null = bestWh._id.toString();
  const idToCode = new Map<string, string>();
  for (const wh of warehouses) idToCode.set(wh._id.toString(), wh.code);

  while (curr) {
    const code = idToCode.get(curr) || curr;
    path.unshift(code);
    curr = prevMap.get(curr) || null;
  }

  return {
    nearest_warehouse_id: bestWh._id.toString(),
    nearest_warehouse_code: bestWh.code,
    road_km: minDistance,
    path,
    method: 'ROAD_GRAPH',
    distances: distancesByCode,
  };
}

