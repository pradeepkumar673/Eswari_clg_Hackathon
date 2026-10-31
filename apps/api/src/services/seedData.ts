/**
 * apps/api/src/services/seedData.ts
 *
 * Populates the database with all Scenario A, Scenario B, add-on and
 * micro-feature data as specified in docs/BLUEPRINT.md section 8.
 *
 * Rules enforced here:
 *  - Idempotent: running twice leaves an identical state (upsert everywhere)
 *  - Deterministic: no new Date() in business data; all times computed from SIM_NOW
 *  - No alerts, disruptions, risk snapshots, plans or promise dates inserted;
 *    those are produced by engines in later steps
 *  - Money: INR integer rupees
 *  - Times: UTC stored
 */

import mongoose from 'mongoose';
import bcryptjs from 'bcryptjs';
import { ensureIndexes } from '../models/index.js';
import { Warehouse } from '../models/warehouses.js';
import { Supplier } from '../models/suppliers.js';
import { Sku } from '../models/skus.js';
import { SupplierSku } from '../models/supplier-skus.js';
import { TransferLane } from '../models/transfer-lanes.js';
import { Shipment } from '../models/shipments.js';
import { ShipmentLine } from '../models/shipment-lines.js';
import { Order } from '../models/orders.js';
import { OrderLine } from '../models/order-lines.js';
import { InventoryBalance } from '../models/inventory-balances.js';
import { User } from '../models/users.js';
import { SourceTrust } from '../models/source-trust.js';
import { RiskPolicy } from '../models/risk-policies.js';
import { StockThreshold } from '../models/stock-thresholds.js';
import { GuardrailPolicy } from '../models/guardrail-policies.js';
import { Fingerprint } from '../models/fingerprints.js';
import { HistoricalCase } from '../models/historical-cases.js';
import { Setting } from '../models/settings.js';
import { Zone } from '../models/zones.js';
import { DamagePolicy } from '../models/damage-policies.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertOne(
  Model: mongoose.Model<any>,
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<any> {
  const doc = await Model.findOneAndUpdate(filter, { $set: data }, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
  return doc;
}

async function upsertMany(
  Model: mongoose.Model<any>,
  docs: Array<{ filter: Record<string, unknown>; data: Record<string, unknown> }>,
): Promise<any[]> {
  return Promise.all(docs.map(({ filter, data }) => upsertOne(Model, filter, data)));
}

// ─── MAIN SEED FUNCTION ───────────────────────────────────────────────────────

export async function seed(targetUri?: string, disconnectAfter = true): Promise<void> {
  const uri = targetUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/disruptioniq?replicaSet=rs0';

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
    console.log('[seed] Connected to MongoDB at', uri);
  } else {
    console.log('[seed] Reusing existing MongoDB connection at', mongoose.connection.name);
  }

  await ensureIndexes();

  // ── Simulation Clock ────────────────────────────────────────────────────────
  const SIM_NOW_ISO = process.env.SIM_NOW || '2026-11-01T00:30:00Z'; // 06:00 IST
  const SIM_NOW = new Date(SIM_NOW_ISO);

  function simDate(offsetHours: number): Date {
    return new Date(SIM_NOW.getTime() + offsetHours * 3_600_000);
  }

  const TOMORROW_10 = new Date('2026-11-02T10:00:00Z');
  const TOMORROW_14 = new Date('2026-11-02T14:00:00Z');
  const TOMORROW_18 = new Date('2026-11-02T18:00:00Z');
  const IN_48H = new Date('2026-11-03T00:30:00Z');
  const TODAY_16 = new Date('2026-11-01T16:00:00Z');

  // ── 1. Settings: SimClock ──────────────────────────────────────────────────
  await upsertOne(Setting, { key: 'sim_now' }, {
    key: 'sim_now',
    value: SIM_NOW_ISO,
    updated_at: new Date(),
  });
  console.log('[seed] SimClock set to', SIM_NOW_ISO);

  // ── 2. Warehouses ─────────────────────────────────────────────────────────
  const whDocs = await upsertMany(Warehouse, [
    {
      filter: { code: 'WH-HOS' },
      data: {
        code: 'WH-HOS',
        name: 'Hosur Warehouse',
        map_x: 520,
        map_y: 340,
        lat: 12.7409, // SYNTHETIC approximate city coordinates
        lng: 77.8253, // SYNTHETIC approximate city coordinates
        processing_hours: 2,
        is_hub: false,
      },
    },
    {
      filter: { code: 'WH-CHN' },
      data: {
        code: 'WH-CHN',
        name: 'Chennai Warehouse',
        map_x: 640,
        map_y: 600,
        lat: 13.0827, // SYNTHETIC approximate city coordinates
        lng: 80.2707, // SYNTHETIC approximate city coordinates
        processing_hours: 2,
        is_hub: true,
      },
    },
    {
      filter: { code: 'WH-BLR' },
      data: {
        code: 'WH-BLR',
        name: 'Bengaluru Warehouse',
        map_x: 420,
        map_y: 450,
        lat: 12.9716, // SYNTHETIC approximate city coordinates
        lng: 77.5946, // SYNTHETIC approximate city coordinates
        processing_hours: 2,
        is_hub: false,
      },
    },
  ]);

  const wh: Record<string, mongoose.Types.ObjectId> = {};
  for (const w of whDocs) wh[w.code] = w._id;
  console.log('[seed] Warehouses: WH-HOS, WH-CHN, WH-BLR');

  // ── 3. Suppliers ──────────────────────────────────────────────────────────
  const supDocs = await upsertMany(Supplier, [
    {
      filter: { code: 'SUP-1' },
      data: {
        code: 'SUP-1',
        name: 'Apex Automotive Parts',
        risk_score: 62,
        lead_time_hours: 36,
        map_x: 490,
        map_y: 180,
        lat: 12.9352, // SYNTHETIC approximate city coordinates
        lng: 77.6245, // SYNTHETIC approximate city coordinates
        on_time_rate: null,
        quality_score: null,
      },
    },
    {
      filter: { code: 'SUP-2' },
      data: {
        code: 'SUP-2',
        name: 'Precision Components Ltd',
        risk_score: 35,
        lead_time_hours: 36,
        map_x: 310,
        map_y: 280,
        lat: 12.8342, // SYNTHETIC approximate city coordinates
        lng: 79.7036, // SYNTHETIC approximate city coordinates
        on_time_rate: null,
        quality_score: null,
      },
    },
    {
      filter: { code: 'SUP-3' },
      data: {
        code: 'SUP-3',
        name: 'Horizon Electronics',
        risk_score: 48,
        lead_time_hours: 48,
        map_x: 750,
        map_y: 200,
        lat: 11.0168, // SYNTHETIC approximate city coordinates
        lng: 76.9558, // SYNTHETIC approximate city coordinates
        on_time_rate: null,
        quality_score: null,
      },
    },
    {
      filter: { code: 'SUP-4' },
      data: {
        code: 'SUP-4',
        name: 'GlobalMech Industries',
        risk_score: 25,
        lead_time_hours: 24,
        map_x: 200,
        map_y: 500,
        lat: 12.2958, // SYNTHETIC approximate city coordinates
        lng: 76.6394, // SYNTHETIC approximate city coordinates
        on_time_rate: null,
        quality_score: null,
      },
    },
  ]);

  const sup: Record<string, mongoose.Types.ObjectId> = {};
  for (const s of supDocs) sup[s.code] = s._id;
  console.log('[seed] Suppliers: SUP-1, SUP-2, SUP-3, SUP-4');

  // ── 4. SKUs ───────────────────────────────────────────────────────────────
  const skuDocs = await upsertMany(Sku, [
    { filter: { code: 'SKU-101' }, data: { code: 'SKU-101', name: 'Bearing Assembly Type-A', unit_cost: 850, weight_kg: 1.2, units_per_slot: 10, category: 'Mechanical', is_critical: true } },
    { filter: { code: 'SKU-205' }, data: { code: 'SKU-205', name: 'Control Module ECU', unit_cost: 2400, weight_kg: 0.5, units_per_slot: 10, category: 'Electronics', is_critical: true } },
    { filter: { code: 'SKU-110' }, data: { code: 'SKU-110', name: 'Hydraulic Seal Kit', unit_cost: 320, weight_kg: 0.3, units_per_slot: 10, category: 'Mechanical', is_critical: false } },
    { filter: { code: 'SKU-115' }, data: { code: 'SKU-115', name: 'Drive Shaft Universal Joint', unit_cost: 1100, weight_kg: 2.8, units_per_slot: 10, category: 'Mechanical', is_critical: false } },
    { filter: { code: 'SKU-220' }, data: { code: 'SKU-220', name: 'Power Inverter Module', unit_cost: 3200, weight_kg: 1.8, units_per_slot: 10, category: 'Electronics', is_critical: true } },
    { filter: { code: 'SKU-330' }, data: { code: 'SKU-330', name: 'Coolant Pump', unit_cost: 750, weight_kg: 3.5, units_per_slot: 10, category: 'Fluid Systems', is_critical: false } },
    { filter: { code: 'SKU-401' }, data: { code: 'SKU-401', name: 'Brake Pad Set', unit_cost: 480, weight_kg: 2.0, units_per_slot: 10, category: 'Safety', is_critical: true } },
    { filter: { code: 'SKU-402' }, data: { code: 'SKU-402', name: 'ABS Sensor Ring', unit_cost: 620, weight_kg: 0.4, units_per_slot: 10, category: 'Safety', is_critical: true } },
    { filter: { code: 'SKU-510' }, data: { code: 'SKU-510', name: 'Gasket Set Premium', unit_cost: 290, weight_kg: 0.8, units_per_slot: 10, category: 'Mechanical', is_critical: false } },
    { filter: { code: 'SKU-615' }, data: { code: 'SKU-615', name: 'Wiring Harness Assembly', unit_cost: 1850, weight_kg: 4.2, units_per_slot: 10, category: 'Electronics', is_critical: false } },
  ]);

  const sku: Record<string, mongoose.Types.ObjectId> = {};
  for (const s of skuDocs) sku[s.code] = s._id;
  console.log('[seed] SKUs: SKU-101 through SKU-615');

  // ── 5. SupplierSKUs ───────────────────────────────────────────────────────
  await upsertMany(SupplierSku, [
    { filter: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-HOS'] }, data: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-HOS'], capacity_per_shipment: 200, lead_time_hours: 36, unit_cost: 850, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-CHN'] }, data: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-CHN'], capacity_per_shipment: 150, lead_time_hours: 36, unit_cost: 870, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-HOS'] }, data: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-HOS'], capacity_per_shipment: 40, lead_time_hours: 36, unit_cost: 1120, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-BLR'] }, data: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-101'], warehouse_id: wh['WH-BLR'], capacity_per_shipment: 60, lead_time_hours: 36, unit_cost: 1090, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-3'], sku_id: sku['SKU-205'], warehouse_id: wh['WH-CHN'] }, data: { supplier_id: sup['SUP-3'], sku_id: sku['SKU-205'], warehouse_id: wh['WH-CHN'], capacity_per_shipment: 80, lead_time_hours: 48, unit_cost: 2400, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-3'], sku_id: sku['SKU-205'], warehouse_id: wh['WH-BLR'] }, data: { supplier_id: sup['SUP-3'], sku_id: sku['SKU-205'], warehouse_id: wh['WH-BLR'], capacity_per_shipment: 60, lead_time_hours: 48, unit_cost: 2450, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-4'], sku_id: sku['SKU-110'], warehouse_id: wh['WH-CHN'] }, data: { supplier_id: sup['SUP-4'], sku_id: sku['SKU-110'], warehouse_id: wh['WH-CHN'], capacity_per_shipment: 500, lead_time_hours: 24, unit_cost: 320, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-4'], sku_id: sku['SKU-401'], warehouse_id: wh['WH-CHN'] }, data: { supplier_id: sup['SUP-4'], sku_id: sku['SKU-401'], warehouse_id: wh['WH-CHN'], capacity_per_shipment: 200, lead_time_hours: 24, unit_cost: 480, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-115'], warehouse_id: wh['WH-HOS'] }, data: { supplier_id: sup['SUP-1'], sku_id: sku['SKU-115'], warehouse_id: wh['WH-HOS'], capacity_per_shipment: 100, lead_time_hours: 36, unit_cost: 1100, is_qualified: true } },
    { filter: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-220'], warehouse_id: wh['WH-BLR'] }, data: { supplier_id: sup['SUP-2'], sku_id: sku['SKU-220'], warehouse_id: wh['WH-BLR'], capacity_per_shipment: 50, lead_time_hours: 36, unit_cost: 3200, is_qualified: true } },
  ]);
  console.log('[seed] SupplierSKUs seeded');

  // ── 6. TransferLanes ──────────────────────────────────────────────────────
  await upsertMany(TransferLane, [
    { filter: { from_warehouse_id: wh['WH-CHN'], to_warehouse_id: wh['WH-HOS'] }, data: { from_warehouse_id: wh['WH-CHN'], to_warehouse_id: wh['WH-HOS'], transit_hours: 5, cost_per_unit: 35, distance_km: 300, is_active: true } },
    { filter: { from_warehouse_id: wh['WH-BLR'], to_warehouse_id: wh['WH-HOS'] }, data: { from_warehouse_id: wh['WH-BLR'], to_warehouse_id: wh['WH-HOS'], transit_hours: 3, cost_per_unit: 50, distance_km: 40, is_active: true } },
    { filter: { from_warehouse_id: wh['WH-BLR'], to_warehouse_id: wh['WH-CHN'] }, data: { from_warehouse_id: wh['WH-BLR'], to_warehouse_id: wh['WH-CHN'], transit_hours: 4, cost_per_unit: 40, distance_km: 350, is_active: true } },
    { filter: { from_warehouse_id: wh['WH-HOS'], to_warehouse_id: wh['WH-CHN'] }, data: { from_warehouse_id: wh['WH-HOS'], to_warehouse_id: wh['WH-CHN'], transit_hours: 5, cost_per_unit: 38, distance_km: 300, is_active: true } },
    { filter: { from_warehouse_id: wh['WH-HOS'], to_warehouse_id: wh['WH-BLR'] }, data: { from_warehouse_id: wh['WH-HOS'], to_warehouse_id: wh['WH-BLR'], transit_hours: 3, cost_per_unit: 52, distance_km: 40, is_active: true } },
    { filter: { from_warehouse_id: wh['WH-CHN'], to_warehouse_id: wh['WH-BLR'] }, data: { from_warehouse_id: wh['WH-CHN'], to_warehouse_id: wh['WH-BLR'], transit_hours: 4, cost_per_unit: 42, distance_km: 350, is_active: true } },
  ]);
  console.log('[seed] TransferLanes: CHN↔HOS (300km), BLR↔HOS (40km), BLR↔CHN (350km)');

  // ── 7. Shipments ──────────────────────────────────────────────────────────
  type ShipmentSeed = {
    code: string;
    supplier: string;
    warehouse: string;
    status: 'IN_TRANSIT' | 'DELIVERED' | 'CANCELLED';
    promised_eta: Date;
    current_eta: Date;
    actual_arrival_at: Date | null;
    carrier_name: string;
    total_units: number;
    usable_quantity: number | null;
    is_disrupted: boolean;
    skus: Array<{ sku: string; qty: number }>;
  };

  const shipmentSeeds: ShipmentSeed[] = [
    {
      code: 'SHP-204', supplier: 'SUP-1', warehouse: 'WH-HOS',
      status: 'IN_TRANSIT', promised_eta: TOMORROW_10, current_eta: TOMORROW_10,
      actual_arrival_at: null, carrier_name: 'IndoFreight Express',
      total_units: 170, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 170 }],
    },
    {
      code: 'SHP-201', supplier: 'SUP-1', warehouse: 'WH-HOS',
      status: 'DELIVERED', promised_eta: simDate(-72), current_eta: simDate(-72),
      actual_arrival_at: simDate(-72), carrier_name: 'IndoFreight Express',
      total_units: 150, usable_quantity: 150, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 150 }],
    },
    {
      code: 'SHP-202', supplier: 'SUP-1', warehouse: 'WH-HOS',
      status: 'DELIVERED', promised_eta: simDate(-48), current_eta: simDate(-36),
      actual_arrival_at: simDate(-36), carrier_name: 'Bharath Cargo',
      total_units: 120, usable_quantity: 120, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 80 }, { sku: 'SKU-115', qty: 40 }],
    },
    {
      code: 'SHP-203', supplier: 'SUP-1', warehouse: 'WH-HOS',
      status: 'DELIVERED', promised_eta: simDate(-96), current_eta: simDate(-80),
      actual_arrival_at: simDate(-80), carrier_name: 'IndoFreight Express',
      total_units: 200, usable_quantity: 200, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 200 }],
    },
    {
      code: 'SHP-205', supplier: 'SUP-1', warehouse: 'WH-CHN',
      status: 'DELIVERED', promised_eta: simDate(-120), current_eta: simDate(-100),
      actual_arrival_at: simDate(-100), carrier_name: 'Bharath Cargo',
      total_units: 90, usable_quantity: 90, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 90 }],
    },
    {
      code: 'SHP-206', supplier: 'SUP-1', warehouse: 'WH-CHN',
      status: 'IN_TRANSIT', promised_eta: simDate(12), current_eta: simDate(12),
      actual_arrival_at: null, carrier_name: 'IndoFreight Express',
      total_units: 100, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-115', qty: 100 }],
    },
    {
      code: 'SHP-211', supplier: 'SUP-2', warehouse: 'WH-HOS',
      status: 'DELIVERED', promised_eta: simDate(-72), current_eta: simDate(-72),
      actual_arrival_at: simDate(-73), carrier_name: 'SouthExpress Logistics',
      total_units: 40, usable_quantity: 40, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 40 }],
    },
    {
      code: 'SHP-212', supplier: 'SUP-2', warehouse: 'WH-BLR',
      status: 'DELIVERED', promised_eta: simDate(-96), current_eta: simDate(-97),
      actual_arrival_at: simDate(-97), carrier_name: 'SouthExpress Logistics',
      total_units: 60, usable_quantity: 60, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 40 }, { sku: 'SKU-220', qty: 20 }],
    },
    {
      code: 'SHP-213', supplier: 'SUP-2', warehouse: 'WH-BLR',
      status: 'DELIVERED', promised_eta: simDate(-144), current_eta: simDate(-144),
      actual_arrival_at: simDate(-144), carrier_name: 'RapidMoves India',
      total_units: 50, usable_quantity: 50, is_disrupted: false,
      skus: [{ sku: 'SKU-220', qty: 50 }],
    },
    {
      code: 'SHP-214', supplier: 'SUP-2', warehouse: 'WH-HOS',
      status: 'IN_TRANSIT', promised_eta: simDate(48), current_eta: simDate(48),
      actual_arrival_at: null, carrier_name: 'SouthExpress Logistics',
      total_units: 40, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-101', qty: 40 }],
    },
    {
      code: 'SHP-310', supplier: 'SUP-3', warehouse: 'WH-CHN',
      status: 'IN_TRANSIT', promised_eta: TODAY_16, current_eta: TODAY_16,
      actual_arrival_at: null, carrier_name: 'PanIndia Freight',
      total_units: 60, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-205', qty: 60 }],
    },
    {
      code: 'SHP-311', supplier: 'SUP-3', warehouse: 'WH-CHN',
      status: 'DELIVERED', promised_eta: simDate(-72), current_eta: simDate(-72),
      actual_arrival_at: simDate(-72), carrier_name: 'PanIndia Freight',
      total_units: 80, usable_quantity: 80, is_disrupted: false,
      skus: [{ sku: 'SKU-205', qty: 80 }],
    },
    {
      code: 'SHP-312', supplier: 'SUP-3', warehouse: 'WH-BLR',
      status: 'DELIVERED', promised_eta: simDate(-100), current_eta: simDate(-98),
      actual_arrival_at: simDate(-98), carrier_name: 'NationalLink Transport',
      total_units: 60, usable_quantity: 60, is_disrupted: false,
      skus: [{ sku: 'SKU-205', qty: 60 }],
    },
    {
      code: 'SHP-401', supplier: 'SUP-4', warehouse: 'WH-CHN',
      status: 'DELIVERED', promised_eta: simDate(-48), current_eta: simDate(-48),
      actual_arrival_at: simDate(-48), carrier_name: 'VelocityCargo',
      total_units: 300, usable_quantity: 300, is_disrupted: false,
      skus: [{ sku: 'SKU-110', qty: 300 }, { sku: 'SKU-401', qty: 0 }],
    },
    {
      code: 'SHP-402', supplier: 'SUP-4', warehouse: 'WH-CHN',
      status: 'IN_TRANSIT', promised_eta: simDate(20), current_eta: simDate(20),
      actual_arrival_at: null, carrier_name: 'VelocityCargo',
      total_units: 200, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-401', qty: 100 }, { sku: 'SKU-402', qty: 100 }],
    },
    {
      code: 'SHP-403', supplier: 'SUP-4', warehouse: 'WH-BLR',
      status: 'DELIVERED', promised_eta: simDate(-60), current_eta: simDate(-60),
      actual_arrival_at: simDate(-60), carrier_name: 'VelocityCargo',
      total_units: 180, usable_quantity: 180, is_disrupted: false,
      skus: [{ sku: 'SKU-510', qty: 180 }],
    },
    {
      code: 'SHP-404', supplier: 'SUP-4', warehouse: 'WH-BLR',
      status: 'IN_TRANSIT', promised_eta: simDate(16), current_eta: simDate(16),
      actual_arrival_at: null, carrier_name: 'VelocityCargo',
      total_units: 100, usable_quantity: null, is_disrupted: false,
      skus: [{ sku: 'SKU-615', qty: 100 }],
    },
    {
      code: 'SHP-405', supplier: 'SUP-4', warehouse: 'WH-CHN',
      status: 'DELIVERED', promised_eta: simDate(-80), current_eta: simDate(-80),
      actual_arrival_at: simDate(-80), carrier_name: 'NationalLink Transport',
      total_units: 150, usable_quantity: 150, is_disrupted: false,
      skus: [{ sku: 'SKU-401', qty: 80 }, { sku: 'SKU-402', qty: 70 }],
    },
  ];

  for (const s of shipmentSeeds) {
    const ship = await upsertOne(Shipment, { code: s.code }, {
      code: s.code,
      supplier_id: sup[s.supplier],
      warehouse_id: wh[s.warehouse],
      status: s.status,
      promised_eta: s.promised_eta,
      current_eta: s.current_eta,
      actual_arrival_at: s.actual_arrival_at,
      carrier_name: s.carrier_name,
      total_units: s.total_units,
      usable_quantity: s.usable_quantity,
      is_disrupted: s.is_disrupted,
      resolved_eta: null,
      eta_basis_event_id: null,
    });

    for (const line of s.skus) {
      if (line.qty > 0) {
        await upsertOne(ShipmentLine, {
          shipment_id: ship._id,
          sku_id: sku[line.sku],
        }, {
          shipment_id: ship._id,
          sku_id: sku[line.sku],
          quantity: line.qty,
        });
      }
    }
  }
  console.log('[seed] Shipments: 18 shipments + lines');

  // ── 8. Orders ─────────────────────────────────────────────────────────────
  type OrderSeed = {
    code: string;
    customer_name: string;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'OPEN' | 'RECOVERING' | 'FULFILLED' | 'CANCELLED';
    due_at: Date;
    penalty_per_unit_short: number;
    warehouse: string;
    skus: Array<{ sku: string; qty: number }>;
  };

  const orderSeeds: OrderSeed[] = [
    { code: 'ORD-1042', customer_name: 'Tata Motors Pune', priority: 'CRITICAL', status: 'OPEN', due_at: TOMORROW_14, penalty_per_unit_short: 1500, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-101', qty: 80 }] },
    { code: 'ORD-1047', customer_name: 'Bajaj Auto Aurangabad', priority: 'HIGH', status: 'OPEN', due_at: TOMORROW_18, penalty_per_unit_short: 1300, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-101', qty: 60 }] },
    { code: 'ORD-1051', customer_name: 'Hero MotoCorp Dharuhera', priority: 'MEDIUM', status: 'OPEN', due_at: IN_48H, penalty_per_unit_short: 1200, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-101', qty: 50 }] },
    { code: 'ORD-2001', customer_name: 'Bosch India Bangalore', priority: 'HIGH', status: 'OPEN', due_at: TODAY_16, penalty_per_unit_short: 2000, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-205', qty: 40 }] },
    { code: 'ORD-2002', customer_name: 'Minda Industries Delhi', priority: 'MEDIUM', status: 'OPEN', due_at: simDate(28), penalty_per_unit_short: 1800, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-205', qty: 30 }] },
    { code: 'ORD-1010', customer_name: 'Mahindra Electric Pune', priority: 'HIGH', status: 'OPEN', due_at: simDate(72), penalty_per_unit_short: 600, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-110', qty: 60 }] },
    { code: 'ORD-1015', customer_name: 'Maruti Suzuki Manesar', priority: 'MEDIUM', status: 'OPEN', due_at: simDate(96), penalty_per_unit_short: 500, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-401', qty: 80 }] },
    { code: 'ORD-1022', customer_name: 'Ashok Leyland Chennai', priority: 'LOW', status: 'OPEN', due_at: simDate(120), penalty_per_unit_short: 400, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-402', qty: 50 }] },
    { code: 'ORD-1030', customer_name: 'Ola Electric Bengaluru', priority: 'HIGH', status: 'OPEN', due_at: simDate(36), penalty_per_unit_short: 1800, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-220', qty: 25 }] },
    { code: 'ORD-1033', customer_name: 'TVS Motor Mysuru', priority: 'MEDIUM', status: 'OPEN', due_at: simDate(48), penalty_per_unit_short: 700, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-101', qty: 15 }] },
    { code: 'ORD-1037', customer_name: 'Eicher Motors Pithampur', priority: 'LOW', status: 'OPEN', due_at: simDate(120), penalty_per_unit_short: 350, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-510', qty: 100 }] },
    { code: 'ORD-1055', customer_name: 'Force Motors Chakan', priority: 'MEDIUM', status: 'OPEN', due_at: simDate(60), penalty_per_unit_short: 550, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-115', qty: 30 }] },
    { code: 'ORD-1060', customer_name: 'SML Isuzu Ropar', priority: 'LOW', status: 'OPEN', due_at: simDate(144), penalty_per_unit_short: 300, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-510', qty: 50 }] },
    { code: 'ORD-1065', customer_name: 'Piaggio Vehicles Pune', priority: 'LOW', status: 'OPEN', due_at: simDate(120), penalty_per_unit_short: 280, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-510', qty: 80 }] },
    { code: 'ORD-0991', customer_name: 'Tata Motors Pune', priority: 'HIGH', status: 'FULFILLED', due_at: simDate(-48), penalty_per_unit_short: 1200, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-101', qty: 100 }] },
    { code: 'ORD-0995', customer_name: 'Bajaj Auto Aurangabad', priority: 'MEDIUM', status: 'FULFILLED', due_at: simDate(-72), penalty_per_unit_short: 1000, warehouse: 'WH-HOS', skus: [{ sku: 'SKU-101', qty: 80 }] },
    { code: 'ORD-0997', customer_name: 'Bosch India Bangalore', priority: 'HIGH', status: 'FULFILLED', due_at: simDate(-96), penalty_per_unit_short: 1800, warehouse: 'WH-CHN', skus: [{ sku: 'SKU-205', qty: 60 }] },
    { code: 'ORD-0998', customer_name: 'Hero MotoCorp Dharuhera', priority: 'LOW', status: 'FULFILLED', due_at: simDate(-120), penalty_per_unit_short: 400, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-101', qty: 40 }] },
    { code: 'ORD-1001', customer_name: 'Mahindra Electric Pune', priority: 'MEDIUM', status: 'OPEN', due_at: simDate(80), penalty_per_unit_short: 600, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-220', qty: 20 }] },
    { code: 'ORD-1005', customer_name: 'Ola Electric Bengaluru', priority: 'HIGH', status: 'OPEN', due_at: simDate(40), penalty_per_unit_short: 1600, warehouse: 'WH-BLR', skus: [{ sku: 'SKU-615', qty: 20 }] },
  ];

  for (const o of orderSeeds) {
    const order = await upsertOne(Order, { code: o.code }, {
      code: o.code,
      customer_name: o.customer_name,
      priority: o.priority,
      status: o.status,
      due_at: o.due_at,
      penalty_per_hour: o.penalty_per_unit_short,
      total_units: o.skus.reduce((acc, s) => acc + s.qty, 0),
      warehouse_id: wh[o.warehouse],
      risk_score: null,
      risk_band: null,
      recovery_plan_id: null,
    });

    for (const line of o.skus) {
      await upsertOne(OrderLine, {
        order_id: order._id,
        sku_id: sku[line.sku],
      }, {
        order_id: order._id,
        sku_id: sku[line.sku],
        quantity: line.qty,
      });
    }
  }
  console.log('[seed] Orders: 20 orders + lines');

  // ── 9. Inventory Balances ─────────────────────────────────────────────────
  type InvSeed = { warehouse: string; sku_code: string; on_hand: number; reserved: number };

  const invSeeds: InvSeed[] = [
    { warehouse: 'WH-HOS', sku_code: 'SKU-101', on_hand: 20, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-101', on_hand: 15, reserved: 0 },
    { warehouse: 'WH-BLR', sku_code: 'SKU-101', on_hand: 10, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-205', on_hand: 10, reserved: 0 },
    { warehouse: 'WH-BLR', sku_code: 'SKU-205', on_hand: 30, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-110', on_hand: 180, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-401', on_hand: 120, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-402', on_hand: 90, reserved: 0 },
    { warehouse: 'WH-CHN', sku_code: 'SKU-510', on_hand: 200, reserved: 0 },
    { warehouse: 'WH-HOS', sku_code: 'SKU-115', on_hand: 80, reserved: 0 },
    { warehouse: 'WH-HOS', sku_code: 'SKU-510', on_hand: 120, reserved: 0 },
    { warehouse: 'WH-BLR', sku_code: 'SKU-220', on_hand: 45, reserved: 0 },
    { warehouse: 'WH-BLR', sku_code: 'SKU-510', on_hand: 160, reserved: 0 },
    { warehouse: 'WH-BLR', sku_code: 'SKU-615', on_hand: 55, reserved: 0 },
  ];

  for (const inv of invSeeds) {
    await upsertOne(InventoryBalance, {
      warehouse_id: wh[inv.warehouse],
      sku_id: sku[inv.sku_code],
    }, {
      warehouse_id: wh[inv.warehouse],
      sku_id: sku[inv.sku_code],
      on_hand: inv.on_hand,
      reserved: inv.reserved,
      updated_at: SIM_NOW,
    });
  }
  console.log('[seed] InventoryBalances: 14 records seeded');

  // ── 10. Users ─────────────────────────────────────────────────────────────
  const rawPassword = process.env.DEMO_PASSWORD || 'Demo@1234';
  const passwordHash = await bcryptjs.hash(rawPassword, 10);

  const userSeeds = [
    { username: 'analyst', display_name: 'Priya Analyst', role: 'Analyst' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    { username: 'manager', display_name: 'Rajan Manager', role: 'Manager' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    { username: 'manager2', display_name: 'Divya Manager', role: 'Manager' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    { username: 'operator', display_name: 'Suresh Operator', role: 'Warehouse_Operator' as const, warehouse_id: wh['WH-HOS'], driver_id: null, truck_id: null, supplier_id: null },
    { username: 'procurement', display_name: 'Meena Procurement', role: 'Procurement_Approver' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    { username: 'procurement2', display_name: 'Arjun Procurement', role: 'Procurement_Approver' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    { username: 'admin', display_name: 'Admin User', role: 'Administrator' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: null },
    // Step 19 Users
    { username: 'drv1', display_name: 'Driver 1 (Ramesh)', role: 'DRIVER' as const, warehouse_id: null, driver_id: 'DRV-1', truck_id: 'SHP-204', supplier_id: null },
    { username: 'drv2', display_name: 'Driver 2 (Karthik)', role: 'DRIVER' as const, warehouse_id: null, driver_id: 'DRV-2', truck_id: 'SHP-310', supplier_id: null },
    { username: 'drv3', display_name: 'Driver 3 (Murugan)', role: 'DRIVER' as const, warehouse_id: null, driver_id: 'DRV-3', truck_id: 'SHP-212', supplier_id: null },
    { username: 'drv4', display_name: 'Driver 4 (Anand)', role: 'DRIVER' as const, warehouse_id: null, driver_id: 'DRV-4', truck_id: 'SHP-311', supplier_id: null },
    { username: 'sup1', display_name: 'Supplier Rep 1 (Apex)', role: 'SUPPLIER' as const, warehouse_id: null, driver_id: null, truck_id: null, supplier_id: 'SUP-1' },
  ];

  const validUsernames = userSeeds.map((u) => u.username);
  await User.deleteMany({ username: { $nin: validUsernames } });

  for (const u of userSeeds) {
    await upsertOne(User, { username: u.username }, {
      username: u.username,
      password_hash: passwordHash,
      role: u.role,
      warehouse_id: u.warehouse_id,
      driver_id: u.driver_id,
      truck_id: u.truck_id,
      supplier_id: u.supplier_id,
      display_name: u.display_name,
    });
  }
  console.log('[seed] Users: 12 users (1 Analyst, 2 Managers, 1 Operator, 2 Procurement, 1 Admin, 4 DRIVER, 1 SUPPLIER)');

  // ── 11. SourceTrust ───────────────────────────────────────────────────────
  const validSources = ['FIELD_REPORT', 'CARRIER_API', 'SUPPLIER_PORTAL', 'CSV', 'EMAIL_TEXT'];
  await SourceTrust.deleteMany({ source: { $nin: validSources } });
  await upsertMany(SourceTrust, [
    { filter: { source: 'FIELD_REPORT' }, data: { source: 'FIELD_REPORT', trust_level: 3, tolerance_minutes: 240 } },
    { filter: { source: 'CARRIER_API' }, data: { source: 'CARRIER_API', trust_level: 2, tolerance_minutes: 240 } },
    { filter: { source: 'SUPPLIER_PORTAL' }, data: { source: 'SUPPLIER_PORTAL', trust_level: 1, tolerance_minutes: 240 } },
    { filter: { source: 'CSV' }, data: { source: 'CSV', trust_level: 1, tolerance_minutes: 240 } },
    { filter: { source: 'EMAIL_TEXT' }, data: { source: 'EMAIL_TEXT', trust_level: 1, tolerance_minutes: 240 } },
  ]);
  console.log('[seed] SourceTrust: 5 sources');

  // ── 12. RiskPolicies ──────────────────────────────────────────────────────
  await upsertMany(RiskPolicy, [
    { filter: { band: 'RED' }, data: { band: 'RED', min_score: 70, max_score: 100, description: 'Critical risk: immediate escalation required' } },
    { filter: { band: 'AMBER' }, data: { band: 'AMBER', min_score: 40, max_score: 69, description: 'Elevated risk: monitor closely and prepare recovery' } },
    { filter: { band: 'GREEN' }, data: { band: 'GREEN', min_score: 0, max_score: 39, description: 'Low risk: normal operations' } },
  ]);
  console.log('[seed] RiskPolicies: RED>=70, AMBER 40-69, GREEN<40');

  // ── 13. StockThresholds ───────────────────────────────────────────────────
  await upsertMany(StockThreshold, [
    { filter: { warehouse_id: wh['WH-HOS'], sku_id: sku['SKU-101'] }, data: { warehouse_id: wh['WH-HOS'], sku_id: sku['SKU-101'], min_quantity: 30, horizon_hours: 72 } },
    { filter: { warehouse_id: wh['WH-CHN'], sku_id: sku['SKU-205'] }, data: { warehouse_id: wh['WH-CHN'], sku_id: sku['SKU-205'], min_quantity: 15, horizon_hours: 72 } },
    { filter: { warehouse_id: wh['WH-BLR'], sku_id: sku['SKU-101'] }, data: { warehouse_id: wh['WH-BLR'], sku_id: sku['SKU-101'], min_quantity: 5, horizon_hours: 72 } },
    { filter: { warehouse_id: wh['WH-CHN'], sku_id: sku['SKU-101'] }, data: { warehouse_id: wh['WH-CHN'], sku_id: sku['SKU-101'], min_quantity: 10, horizon_hours: 72 } },
    { filter: { warehouse_id: wh['WH-BLR'], sku_id: sku['SKU-205'] }, data: { warehouse_id: wh['WH-BLR'], sku_id: sku['SKU-205'], min_quantity: 20, horizon_hours: 72 } },
  ]);
  console.log('[seed] StockThresholds: SKU-101@WH-HOS=30, SKU-205@WH-CHN=15');

  // ── 14. GuardrailPolicies ─────────────────────────────────────────────────
  await upsertMany(GuardrailPolicy, [
    {
      filter: { code: 'EXPEDITE_SPEND' },
      data: { code: 'EXPEDITE_SPEND', description: 'Maximum expedite and alternative-sourcing spend per plan', threshold_value: 6000, threshold_unit: 'INR', is_active: true },
    },
    {
      filter: { code: 'SERVICE_DAMAGE_RESIDUAL' },
      data: { code: 'SERVICE_DAMAGE_RESIDUAL', description: 'Maximum residual penalty (INR) allowed after recovery', threshold_value: 2500, threshold_unit: 'INR', is_active: true },
    },
    {
      filter: { code: 'SERVICE_DAMAGE_BACKORDER_PCT' },
      data: { code: 'SERVICE_DAMAGE_BACKORDER_PCT', description: 'Maximum percentage of any order units that can be backordered', threshold_value: 20, threshold_unit: 'PERCENT', is_active: true },
    },
    {
      filter: { code: 'SUPPLIER_RISK' },
      data: { code: 'SUPPLIER_RISK', description: 'Maximum supplier risk score allowed in recovery plan actions', threshold_value: 50, threshold_unit: 'SCORE', is_active: true },
    },
    {
      filter: { code: 'TRANSFER_DISTANCE' },
      data: { code: 'TRANSFER_DISTANCE', description: 'Maximum transfer distance for inter-warehouse moves in recovery plan', threshold_value: 400, threshold_unit: 'KM', is_active: true },
    },
  ]);
  console.log('[seed] GuardrailPolicies: EXPEDITE_SPEND, SERVICE_DAMAGE, SUPPLIER_RISK, TRANSFER_DISTANCE');

  // ── 15. Fingerprints (F1, F2, F3) ─────────────────────────────────────────
  const fpDocs = await upsertMany(Fingerprint, [
    {
      filter: { code: 'F1' },
      data: {
        code: 'F1',
        pattern: {
          label: 'SUP-1 delays in festival-peak windows',
          supplier_code: 'SUP-1',
          disruption_type: 'DAMAGE_AND_DELAY',
          warehouse_code: 'WH-HOS',
          seasonal_context: 'festival-peak',
          description: 'SUP-1 regularly experiences damage and delay on Hosur deliveries during festival-peak demand windows (Oct–Nov and Jan–Feb). Splitting orders reduced late deliveries at the cost of higher freight.',
        },
        occurrence_count: 4,
        last_seen_at: simDate(-168),
      },
    },
    {
      filter: { code: 'F2' },
      data: {
        code: 'F2',
        pattern: {
          label: 'WH-CHN shortages follow inbound delays',
          warehouse_code: 'WH-CHN',
          disruption_type: 'SHORTAGE_FROM_INBOUND_DELAY',
          description: 'Chennai warehouse shortages are preceded (within 48h) by an inbound delay event on any active shipment. Stock dips below minimum within 24h of the delay event.',
        },
        occurrence_count: 3,
        last_seen_at: simDate(-240),
      },
    },
    {
      filter: { code: 'F3' },
      data: {
        code: 'F3',
        pattern: {
          label: 'Carrier scan gaps on the CHN-to-HOS lane',
          lane: 'WH-CHN to WH-HOS',
          disruption_type: 'ETA_CONFLICT_FROM_SCAN_GAP',
          description: 'Carrier scan events on the Chennai-to-Hosur lane frequently have a 6–12h gap between consecutive scans, causing ETA conflicts with supplier-portal estimates.',
        },
        occurrence_count: 3,
        last_seen_at: simDate(-336),
      },
    },
  ]);

  const fp: Record<string, mongoose.Types.ObjectId> = {};
  for (const f of fpDocs) fp[f.code] = f._id;
  console.log('[seed] Fingerprints: F1 (4 cases), F2 (3 cases), F3 (3 cases)');

  // ── 16. HistoricalCases (12 resolved disruptions, marked SEEDED) ──────────
  const historicalCases = [
    {
      fingerprint_id: fp['F1'],
      disruption_type: 'DAMAGE_AND_DELAY',
      strategy_used: 'SPLIT_ORDER_TRANSFER',
      outcome: 'Splitting ORD across WH-CHN transfer and expedited supplier cut late orders from 3 to 1. Freight cost increased by ₹8,400.',
      cost: 8400, resolution_hours: 14,
    },
    {
      fingerprint_id: fp['F1'],
      disruption_type: 'DAMAGE_AND_DELAY',
      strategy_used: 'EXPEDITE_ALTERNATIVE_SUPPLIER',
      outcome: 'Expedited alternative supplier (SUP-2) fulfilled partial demand within 36h. Lead-time cost ₹12,600 but zero late orders.',
      cost: 12600, resolution_hours: 36,
    },
    {
      fingerprint_id: fp['F1'],
      disruption_type: 'DAMAGE_AND_DELAY',
      strategy_used: 'TRANSFER_FROM_BLR',
      outcome: 'Transferred 10 units from WH-BLR, fulfilled ORD-priority-1 on time. Remaining orders delayed 4h.',
      cost: 5000, resolution_hours: 8,
    },
    {
      fingerprint_id: fp['F1'],
      disruption_type: 'DAMAGE_AND_DELAY',
      strategy_used: 'MULTI_WAREHOUSE_SPLIT',
      outcome: 'Two-warehouse split plus partial SUP-2 order. All orders fulfilled within 6h of original deadline.',
      cost: 15200, resolution_hours: 18,
    },
    {
      fingerprint_id: fp['F2'],
      disruption_type: 'SHORTAGE_FROM_INBOUND_DELAY',
      strategy_used: 'EMERGENCY_TRANSFER_FROM_BLR',
      outcome: 'Emergency transfer from WH-BLR covered SKU-205 shortage for 48h until delayed shipment arrived.',
      cost: 4800, resolution_hours: 6,
    },
    {
      fingerprint_id: fp['F2'],
      disruption_type: 'SHORTAGE_FROM_INBOUND_DELAY',
      strategy_used: 'RESEQUENCE_ORDERS',
      outcome: 'Resequenced order dispatch; critical orders fulfilled from existing safety stock. 2 lower-priority orders delayed.',
      cost: 0, resolution_hours: 2,
    },
    {
      fingerprint_id: fp['F2'],
      disruption_type: 'SHORTAGE_FROM_INBOUND_DELAY',
      strategy_used: 'SPLIT_AND_NOTIFY',
      outcome: 'Split order, fulfilled 70% on time, issued customer notice for 30% backorder. Avoided escalation.',
      cost: 2100, resolution_hours: 4,
    },
    {
      fingerprint_id: fp['F2'],
      disruption_type: 'SHORTAGE_FROM_INBOUND_DELAY',
      strategy_used: 'EXPEDITE_SHIPMENT',
      outcome: 'Expedited SHP-310 predecessor via air freight. All orders fulfilled on time. High freight cost.',
      cost: 22000, resolution_hours: 12,
    },
    {
      fingerprint_id: fp['F3'],
      disruption_type: 'ETA_CONFLICT_FROM_SCAN_GAP',
      strategy_used: 'WAIT_FOR_RESOLUTION',
      outcome: 'ETA conflict resolved within 3h when carrier scan resumed. No action required.',
      cost: 0, resolution_hours: 3,
    },
    {
      fingerprint_id: fp['F3'],
      disruption_type: 'ETA_CONFLICT_FROM_SCAN_GAP',
      strategy_used: 'CONSERVATIVE_RESERVE',
      outcome: 'Reserved stock conservatively based on later ETA. Shipment arrived earlier; reservations released.',
      cost: 800, resolution_hours: 2,
    },
    {
      fingerprint_id: fp['F3'],
      disruption_type: 'ETA_CONFLICT_FROM_SCAN_GAP',
      strategy_used: 'ESCALATE_TO_CARRIER',
      outcome: 'Escalated to carrier; received confirmed ETA within 1h. No stock action needed.',
      cost: 0, resolution_hours: 1,
    },
    {
      fingerprint_id: fp['F3'],
      disruption_type: 'ETA_CONFLICT_FROM_SCAN_GAP',
      strategy_used: 'PREEMPTIVE_TRANSFER',
      outcome: 'Pre-emptive 5-unit transfer from WH-CHN to cover risk window. Slight over-transfer reversed next day.',
      cost: 1200, resolution_hours: 8,
    },
  ];

  for (let i = 0; i < historicalCases.length; i++) {
    const hc = historicalCases[i];
    await upsertOne(HistoricalCase, {
      fingerprint_id: hc.fingerprint_id,
      disruption_type: hc.disruption_type,
      strategy_used: hc.strategy_used,
    }, {
      ...hc,
      is_seeded: true,
      created_at: simDate(-(i + 1) * 168),
    });
  }
  console.log('[seed] HistoricalCases: 12 cases (marked SEEDED)');

  // ── 17. Step 19: Damage Policies ───────────────────────────────────────────
  await upsertMany(DamagePolicy, [
    {
      filter: { band: 'MINOR' },
      data: {
        band: 'MINOR',
        lead_time_hours: 0,
        action_description: 'Minor cosmetic packaging damage; accept with note',
        requires_supplier_claim: false,
      },
    },
    {
      filter: { band: 'MAJOR' },
      data: {
        band: 'MAJOR',
        lead_time_hours: 24,
        action_description: 'Structural box crush; quarantine and inspect sample',
        requires_supplier_claim: true,
      },
    },
    {
      filter: { band: 'SEVERE' },
      data: {
        band: 'SEVERE',
        lead_time_hours: 48,
        action_description: 'Severe structural puncture; full shipment rejected',
        requires_supplier_claim: true,
      },
    },
  ]);
  console.log('[seed] DamagePolicies: MINOR (0h), MAJOR (24h), SEVERE (48h)');

  // ── 18. Step 19: Zones for WH-HOS & WH-CHN ──────────────────────────────────
  await upsertMany(Zone, [
    {
      filter: { zone_id: 'ZN-HOS-REC' },
      data: {
        zone_id: 'ZN-HOS-REC',
        warehouse_id: 'WH-HOS',
        name: 'Receiving Dock A',
        zone_type: 'RECEIVING',
        polygon: [
          [50, 50],
          [250, 50],
          [250, 200],
          [50, 200],
        ],
        capacity_slots: 50,
        reserved_inbound_slots: 0,
        version: 1,
      },
    },
    {
      filter: { zone_id: 'ZN-HOS-STR' },
      data: {
        zone_id: 'ZN-HOS-STR',
        warehouse_id: 'WH-HOS',
        name: 'Main Storage Racks',
        zone_type: 'STORAGE',
        polygon: [
          [50, 250],
          [450, 250],
          [450, 600],
          [50, 600],
        ],
        capacity_slots: 120,
        reserved_inbound_slots: 0,
        version: 1,
      },
    },
    {
      filter: { zone_id: 'ZN-HOS-DSP' },
      data: {
        zone_id: 'ZN-HOS-DSP',
        warehouse_id: 'WH-HOS',
        name: 'Dispatch Staging Bay',
        zone_type: 'DISPATCH',
        polygon: [
          [500, 50],
          [700, 50],
          [700, 300],
          [500, 300],
        ],
        capacity_slots: 40,
        reserved_inbound_slots: 0,
        version: 1,
      },
    },
    {
      filter: { zone_id: 'ZN-CHN-REC' },
      data: {
        zone_id: 'ZN-CHN-REC',
        warehouse_id: 'WH-CHN',
        name: 'Chennai Inbound Bay 1',
        zone_type: 'RECEIVING',
        polygon: [
          [100, 100],
          [300, 100],
          [300, 300],
          [100, 300],
        ],
        capacity_slots: 30,
        reserved_inbound_slots: 0,
        version: 1,
      },
    },
    {
      filter: { zone_id: 'ZN-CHN-STR' },
      data: {
        zone_id: 'ZN-CHN-STR',
        warehouse_id: 'WH-CHN',
        name: 'Chennai High-Bay Racks',
        zone_type: 'STORAGE',
        polygon: [
          [350, 100],
          [750, 100],
          [750, 500],
          [350, 500],
        ],
        capacity_slots: 100,
        reserved_inbound_slots: 0,
        version: 1,
      },
    },
  ]);
  console.log('[seed] Zones: 3 zones for WH-HOS, 2 zones for WH-CHN');

  // ── Done ──────────────────────────────────────────────────────────────────
  if (disconnectAfter) {
    await mongoose.disconnect();
  }
  console.log('\n[seed] ✅ Seed complete.');
}

