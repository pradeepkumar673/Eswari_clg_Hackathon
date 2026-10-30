/**
 * apps/api/src/services/spofRadar.ts
 *
 * Single Point of Failure (SPOF) Radar Engine (Step 10, A12).
 * Formula:
 *   SPOF = 100 * (0.50 * share_open_orders + 0.30 * share_open_penalty + 0.20 * (no_qualified_alt ? 1 : 0))
 */

import mongoose from 'mongoose';
import { Supplier } from '../models/suppliers.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { Sku } from '../models/skus.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { SPOFSnapshot } from '../models/spof-snapshots.js';
import { Alert } from '../models/alerts.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { simClock } from './simClock.js';

export interface SPOFResult {
  node_type: string;
  node_id: string;
  name: string;
  sku_code: string;
  score: number;
  rank: number;
  orders_exposed: number;
  penalty_exposure: number;
  has_alternative: boolean;
  missing_alternative?: string;
  exposed_order_codes: string[];
}

export async function computeSPOFRadar(): Promise<SPOFResult[]> {
  const now = await simClock.now();
  const openOrders = await Order.find({ status: { $in: ['OPEN', 'RECOVERING'] } }).lean();
  const totalOpenOrders = Math.max(1, openOrders.length);
  const totalOpenPenalty = Math.max(1, openOrders.reduce((s, o) => s + (o.penalty_per_hour * o.total_units), 0));

  const suppliers = await Supplier.find({}).lean();
  const skus = await Sku.find({}).lean();
  const results: Array<Omit<SPOFResult, 'rank'> & { rank?: number }> = [];

  for (const sup of suppliers) {
    const supSkus = await SupplierSku.find({ supplier_id: sup._id }).lean();

    for (const ss of supSkus) {
      const sku = skus.find((s) => s._id.toString() === ss.sku_id.toString());
      if (!sku) continue;

      // Find open orders depending on this SKU at the supplier's warehouse
      const orderLines = await OrderLine.find({ sku_id: ss.sku_id }).lean();
      const orderIds = orderLines.map((l) => l.order_id);
      const dependentOrders = openOrders.filter((o) =>
        orderIds.some((oid) => oid.toString() === o._id.toString()) &&
        o.warehouse_id.toString() === ss.warehouse_id.toString(),
      );

      const ordersExposed = dependentOrders.length;
      const penaltyExposure = dependentOrders.reduce((s, o) => s + (o.penalty_per_hour * o.total_units), 0);

      // Check if qualified alternative with capacity exists
      const alternatives = await SupplierSku.find({
        sku_id: ss.sku_id,
        warehouse_id: ss.warehouse_id,
        supplier_id: { $ne: sup._id },
        is_qualified: true,
      }).populate('supplier_id').lean();

      const hasAlt = alternatives.length > 0;
      const altMissing = hasAlt ? undefined : `No qualified alternative supplier for SKU ${sku.code} into warehouse ${ss.warehouse_id}`;

      const shareOrders = ordersExposed / totalOpenOrders;
      const sharePenalty = penaltyExposure / totalOpenPenalty;
      const altFactor = hasAlt ? 0 : 1;

      const spofScore = Math.min(
        100,
        Math.round(100 * (0.50 * shareOrders + 0.30 * sharePenalty + 0.20 * altFactor) * 100) / 100,
      );

      results.push({
        node_type: 'SUPPLIER_SKU',
        node_id: `${sup.code}:${sku.code}`,
        name: sup.name,
        sku_code: sku.code,
        score: spofScore,
        orders_exposed: ordersExposed,
        penalty_exposure: penaltyExposure,
        has_alternative: hasAlt,
        missing_alternative: altMissing,
        exposed_order_codes: dependentOrders.map((o) => o.code),
      });
    }
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);

  // Assign ranks and save snapshots
  const rankedResults: SPOFResult[] = [];
  for (let i = 0; i < results.length; i++) {
    const rank = i + 1;
    const r: SPOFResult = { ...results[i], rank };
    rankedResults.push(r);

    await SPOFSnapshot.create({
      node_type: r.node_type,
      node_id: r.node_id,
      orders_exposed: r.orders_exposed,
      penalty_exposure: r.penalty_exposure,
      has_alternative: r.has_alternative,
      score: r.score,
      rank,
      snapshot_at: now,
    });

    // If top-ranked high SPOF risk (score >= 70), raise SPOF Alert
    if (r.score >= 70) {
      const alertKey = `SPOF:${r.node_id}`;
      const existing = await Alert.findOne({ alert_key: alertKey, status: 'OPEN' });
      if (!existing) {
        await Alert.create({
          alert_key: alertKey,
          type: 'SPOF',
          severity: 'RED',
          status: 'OPEN',
          title: `Single Point of Failure: ${r.node_id}`,
          body: `Critical SPOF risk (Score: ${r.score}). ${r.orders_exposed} orders exposed (₹${r.penalty_exposure} penalty). ${r.missing_alternative || ''}`,
          entity_type: 'Supplier',
          entity_id: r.node_id,
          first_seen: now,
          last_seen: now,
          payload: { score: r.score, orders_exposed: r.orders_exposed, penalty: r.penalty_exposure },
          created_at: now,
        });
      }
    }
  }

  return rankedResults;
}

