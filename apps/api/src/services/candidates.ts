/**
 * apps/api/src/services/candidates.ts
 *
 * Candidate enumerator for recovery plan generation (Step 7, A1).
 *
 * Produces CandidateIn[] (matching the solver's input schema) from live DB:
 *   - TRANSFER: active transfer lanes where donor warehouse has free stock
 *   - VIA: one-hop via-warehouse paths (donor->via->dest), lead = lane1+lane2+2h processing
 *   - ALT_SUPPLIER: qualified supplier-SKU rows with capacity, excluding routes that miss deadlines
 *
 * LLM hook: exported typed stub, not yet active.
 */

import mongoose from 'mongoose';
import { TransferLane } from '../models/transfer-lanes.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { Sku } from '../models/skus.js';

export interface SolverCandidate {
  type: 'TRANSFER' | 'ALT_SUPPLIER' | 'EXPEDITE' | 'VIA';
  donor?: string;       // warehouse code (TRANSFER / VIA)
  via_warehouse?: string;
  supplier?: string;    // supplier code (ALT_SUPPLIER)
  sku: string;
  free_units?: number;  // TRANSFER / VIA
  capacity?: number;    // ALT_SUPPLIER
  lead_hours: number;
  unit_cost: number;    // INR integer
}

export interface OrderDeadline {
  sku_id: string;          // ObjectId string
  sku_code: string;
  fulfil_warehouse_id: string;   // ObjectId string
  fulfil_warehouse_code: string;
  due_hours_from_now: number;
}

/** LLM candidate hook — not yet active (typed stub for future Step 12). */
export type LLMCandidateHook = (
  orders: OrderDeadline[],
  context: string,
) => Promise<SolverCandidate[]>;

/**
 * Enumerate feasible candidates for the given orders.
 * Candidates that cannot arrive before ALL order deadlines are dropped.
 */
export async function enumerateCandidates(
  orders: OrderDeadline[],
  _llmHook?: LLMCandidateHook,
): Promise<SolverCandidate[]> {
  const results: SolverCandidate[] = [];

  // Unique (sku_id, fulfil_warehouse_id) pairs
  const pairs = Array.from(
    new Map(
      orders.map((o) => [`${o.sku_id}|${o.fulfil_warehouse_id}`, o]),
    ).values(),
  );

  for (const order of pairs) {
    const destId = new mongoose.Types.ObjectId(order.fulfil_warehouse_id);
    const skuId = new mongoose.Types.ObjectId(order.sku_id);
    const minDue = Math.min(
      ...orders
        .filter((o) => o.sku_id === order.sku_id && o.fulfil_warehouse_id === order.fulfil_warehouse_id)
        .map((o) => o.due_hours_from_now),
    );

    // ---- TRANSFER candidates ----
    const inboundLanes = await TransferLane.find({ to_warehouse_id: destId, is_active: true });

    for (const lane of inboundLanes) {
      if (lane.transit_hours > minDue) continue; // misses earliest deadline

      // Free stock at donor = on_hand - reserved
      const bal = await InventoryBalance.findOne({
        warehouse_id: lane.from_warehouse_id,
        sku_id: skuId,
      });
      const free = bal ? Math.max(0, bal.on_hand - bal.reserved) : 0;
      if (free <= 0) continue;

      // Get warehouse code for donor
      const Warehouse = mongoose.model('Warehouse');
      const donor = await Warehouse.findById(lane.from_warehouse_id).lean();
      if (!donor) continue;

      results.push({
        type: 'TRANSFER',
        donor: (donor as any).code,
        sku: order.sku_code,
        free_units: free,
        lead_hours: lane.transit_hours,
        unit_cost: Math.round(lane.cost_per_unit),
      });
    }

    // ---- VIA candidates (one-hop) ----
    // Find all outbound lanes from donor that then have inbound lanes to dest
    const outboundLanes = await TransferLane.find({ to_warehouse_id: { $ne: destId }, is_active: true });
    const Warehouse = mongoose.model('Warehouse');

    for (const leg1 of outboundLanes) {
      // Check leg2: viaWarehouse -> dest
      const leg2 = await TransferLane.findOne({
        from_warehouse_id: leg1.to_warehouse_id,
        to_warehouse_id: destId,
        is_active: true,
      });
      if (!leg2) continue;

      const totalHours = leg1.transit_hours + leg2.transit_hours + 2; // 2h processing
      if (totalHours > minDue) continue;

      const bal = await InventoryBalance.findOne({
        warehouse_id: leg1.from_warehouse_id,
        sku_id: skuId,
      });
      const free = bal ? Math.max(0, bal.on_hand - bal.reserved) : 0;
      if (free <= 0) continue;

      const donor = await Warehouse.findById(leg1.from_warehouse_id).lean();
      const via = await Warehouse.findById(leg1.to_warehouse_id).lean();
      if (!donor || !via) continue;

      // Skip if already added as direct transfer
      const alreadyDirect = results.some(
        (r) => r.type === 'TRANSFER' && r.donor === (donor as any).code && r.sku === order.sku_code,
      );
      if (alreadyDirect) continue;

      results.push({
        type: 'VIA',
        donor: (donor as any).code,
        via_warehouse: (via as any).code,
        sku: order.sku_code,
        free_units: free,
        lead_hours: totalHours,
        unit_cost: Math.round(leg1.cost_per_unit + leg2.cost_per_unit),
      });
    }

    // ---- ALT_SUPPLIER candidates ----
    const supplierSkus = await SupplierSku.find({
      sku_id: skuId,
      warehouse_id: destId,
      is_qualified: true,
    }).populate('supplier_id');

    for (const ss of supplierSkus) {
      if (ss.lead_time_hours > minDue) continue;

      const supplierDoc = ss.supplier_id as any;
      const supplierCode = supplierDoc?.code || supplierDoc?._id?.toString() || 'UNKNOWN';

      results.push({
        type: 'ALT_SUPPLIER',
        supplier: supplierCode,
        sku: order.sku_code,
        capacity: ss.capacity_per_shipment,
        lead_hours: ss.lead_time_hours,
        unit_cost: Math.round(ss.unit_cost),
      });
    }
  }

  return results;
}

