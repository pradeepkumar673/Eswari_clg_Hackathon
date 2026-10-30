/**
 * apps/api/src/routes/kpis.ts
 *
 * KPI strip endpoint (Step 10, B1).
 * GET /overview/kpis
 * 6 cards:
 *   1. Shipments in transit
 *   2. Delayed shipments
 *   3. Items below threshold
 *   4. Open orders
 *   5. At-risk orders
 *   6. Penalty exposure
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authenticateToken, requirePermission } from '../middleware/auth.js';
import { Shipment } from '../models/shipments.js';
import { Order } from '../models/orders.js';
import { StockThreshold } from '../models/stock-thresholds.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { simClock } from '../services/simClock.js';

export const kpisRouter = Router();

// ---------------------------------------------------------------------------
// GET /overview/kpis
// ---------------------------------------------------------------------------
kpisRouter.get(
  '/kpis',
  authenticateToken,
  requirePermission('view_cockpit'),
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const now = await simClock.now();

      // 1. Shipments in transit
      const inTransitShipments = await Shipment.find({ status: 'IN_TRANSIT' })
        .select('code carrier_name status current_eta promised_eta')
        .lean();

      // 2. Delayed shipments (reconciled ETA > promised ETA)
      const delayedShipments = await Shipment.find({
        status: { $in: ['IN_TRANSIT', 'DELIVERED'] },
        $expr: {
          $gt: [{ $ifNull: ['$resolved_eta', '$current_eta'] }, '$promised_eta'],
        },
      })
        .select('code carrier_name status current_eta resolved_eta promised_eta')
        .lean();

      // 3. Items below threshold
      const thresholds = await StockThreshold.find({}).lean();
      const belowThresholdItems: any[] = [];
      for (const th of thresholds) {
        const bal = await InventoryBalance.findOne({
          warehouse_id: th.warehouse_id,
          sku_id: th.sku_id,
        }).lean();
        const free = bal ? Math.max(0, bal.on_hand - bal.reserved) : 0;
        if (free < th.min_quantity) {
          belowThresholdItems.push({
            warehouse_id: th.warehouse_id,
            sku_id: th.sku_id,
            min_quantity: th.min_quantity,
            free_stock: free,
          });
        }
      }

      // 4. Open orders
      const openOrders = await Order.find({ status: { $in: ['OPEN', 'RECOVERING'] } })
        .select('code customer_name priority due_at total_units warehouse_id')
        .lean();

      // 5. At-risk orders (risk_score >= 40 or RED/AMBER)
      const atRiskOrders = await Order.find({
        status: { $in: ['OPEN', 'RECOVERING'] },
        $or: [{ risk_score: { $gte: 40 } }, { risk_band: { $in: ['RED', 'AMBER'] } }],
      })
        .select('code customer_name priority due_at risk_score risk_band')
        .lean();

      // 6. Penalty exposure
      const totalPenaltyExposure = openOrders.reduce((sum, o: any) => sum + ((o.penalty_per_hour || 0) * (o.total_units || 0)), 0);

      res.status(200).json({
        kpis: {
          shipments_in_transit: {
            count: inTransitShipments.length,
            items: inTransitShipments,
          },
          delayed_shipments: {
            count: delayedShipments.length,
            items: delayedShipments,
          },
          items_below_threshold: {
            count: belowThresholdItems.length,
            items: belowThresholdItems,
          },
          open_orders: {
            count: openOrders.length,
            items: openOrders,
          },
          at_risk_orders: {
            count: atRiskOrders.length,
            items: atRiskOrders,
          },
          penalty_exposure: {
            count: totalPenaltyExposure,
            items: openOrders.map((o: any) => ({
              code: o.code,
              penalty_exposure: (o.penalty_per_hour || 0) * (o.total_units || 0),
            })),
          },
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

