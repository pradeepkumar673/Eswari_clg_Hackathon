/**
 * apps/api/src/services/lineage.ts
 *
 * Event Lineage Engine (Step 10, A8).
 * Traces causal chain: Supplier -> Delayed Shipment -> Warehouse Shortage -> Order
 * Every edge carries evidence_ids, observed_at, and explicit calculation string.
 */

import mongoose from 'mongoose';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { Supplier } from '../models/suppliers.js';
import { LineageEdge, ILineageEdge } from '../models/lineage-edges.js';
import { simClock } from './simClock.js';

export interface LineageChain {
  order_id: string;
  order_code: string;
  disruption_id: string;
  edges: Array<{
    from_type: string;
    from_id: string;
    to_type: string;
    to_id: string;
    relation: string;
    calculation: string;
    evidence_ids: string[];
    observed_at: string;
  }>;
}

export async function buildOrderLineage(
  orderId: mongoose.Types.ObjectId | string,
  disruptionId?: mongoose.Types.ObjectId | string,
): Promise<LineageChain> {
  const oId = typeof orderId === 'string' ? new mongoose.Types.ObjectId(orderId) : orderId;
  const order = await Order.findById(oId);
  if (!order) throw new Error('Order not found');

  const now = await simClock.now();
  let disruption: any = null;

  if (disruptionId) {
    disruption = await Disruption.findById(disruptionId);
  } else {
    disruption = await Disruption.findOne({ status: { $in: ['OPEN', 'IN_RECOVERY'] } });
  }

  const edges: ILineageEdge[] = [];

  if (disruption) {
    const shipment = await Shipment.findById(disruption.shipment_id);
    if (shipment) {
      const supplier = await Supplier.findById(shipment.supplier_id);
      const shpLines = await ShipmentLine.find({ shipment_id: shipment._id });
      const skuId = shpLines[0]?.sku_id;

      // Edge 1: Supplier -> Shipment (Delay / Damage)
      const supCode = supplier ? supplier.code : 'SUPPLIER';
      const delayHours = disruption.delay_hours || 0;
      const calc1 = `Supplier ${supCode} promised ETA ${shipment.promised_eta.toISOString()}, actual delay: +${delayHours}h`;
      const edge1 = await LineageEdge.findOneAndUpdate(
        { from_type: 'Supplier', from_id: supCode, to_type: 'Shipment', to_id: shipment.code },
        {
          $set: {
            relation: 'SUPPLIER_DELAY',
            calculation: calc1,
            evidence_ids: [disruption.created_by_event_id.toString(), shipment._id.toString()],
            observed_at: disruption.detected_at,
            disruption_id: disruption._id,
          },
        },
        { upsert: true, new: true },
      );
      edges.push(edge1);

      // Edge 2: Shipment -> Destination Warehouse (Inbound Shortage)
      const bal = await InventoryBalance.findOne({
        warehouse_id: shipment.warehouse_id,
        sku_id: skuId,
      });
      const free = bal ? Math.max(0, bal.on_hand - bal.reserved) : 0;
      const usable = disruption.usable_quantity !== undefined ? disruption.usable_quantity : shipment.total_units;
      const calc2 = `free stock ${free} + usable inbound ${usable} = ${free + usable} units available`;
      const edge2 = await LineageEdge.findOneAndUpdate(
        { from_type: 'Shipment', from_id: shipment.code, to_type: 'Warehouse', to_id: shipment.warehouse_id.toString() },
        {
          $set: {
            relation: 'INBOUND_SHORTAGE',
            calculation: calc2,
            evidence_ids: [shipment._id.toString(), ...(bal ? [bal._id.toString()] : [])],
            observed_at: disruption.detected_at,
            disruption_id: disruption._id,
          },
        },
        { upsert: true, new: true },
      );
      edges.push(edge2);

      // Edge 3: Destination Warehouse -> Order (Demand deficit)
      const orderLines = await OrderLine.find({ order_id: order._id });
      const orderDemand = orderLines.reduce((s, l) => s + l.quantity, 0);
      const totalAvailable = free + usable;
      const calc3 = `available ${totalAvailable} < order demand ${orderDemand} -> ${Math.max(0, orderDemand - totalAvailable)} units short`;
      const edge3 = await LineageEdge.findOneAndUpdate(
        { from_type: 'Warehouse', from_id: shipment.warehouse_id.toString(), to_type: 'Order', to_id: order.code },
        {
          $set: {
            relation: 'ORDER_DEFICIT',
            calculation: calc3,
            evidence_ids: [order._id.toString(), ...(orderLines.map((l) => l._id.toString()))],
            observed_at: disruption.detected_at,
            disruption_id: disruption._id,
          },
        },
        { upsert: true, new: true },
      );
      edges.push(edge3);
    }
  }

  return {
    order_id: order._id.toString(),
    order_code: order.code,
    disruption_id: disruption ? disruption._id.toString() : 'NONE',
    edges: edges.map((e) => ({
      from_type: e.from_type,
      from_id: e.from_id,
      to_type: e.to_type,
      to_id: e.to_id,
      relation: e.relation,
      calculation: e.calculation,
      evidence_ids: e.evidence_ids,
      observed_at: e.observed_at.toISOString(),
    })),
  };
}

