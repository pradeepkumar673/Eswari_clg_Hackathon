import { z } from 'zod';

export const UserRoleSchema = z.enum([
  'Analyst',
  'Manager',
  'Warehouse_Operator',
  'Procurement_Approver',
  'Administrator',
  'DRIVER',
  'SUPPLIER',
  'Driver',
  'Supplier',
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  username: z.string().min(1),
  password_hash: z.string(),
  role: UserRoleSchema,
  warehouse_id: z.string().nullable().optional(),
  driver_id: z.string().nullable().optional(),
  truck_id: z.string().nullable().optional(),
  supplier_id: z.string().nullable().optional(),
  display_name: z.string(),
  created_at: z.coerce.date().optional()
});
export type User = z.infer<typeof UserSchema>;

export const SupplierSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  code: z.string().min(1),
  name: z.string(),
  risk_score: z.number().int().min(0).max(100),
  lead_time_hours: z.number().int().nonnegative(),
  map_x: z.number().int().min(0).max(1000),
  map_y: z.number().int().min(0).max(1000),
  lat: z.number().optional(),
  lng: z.number().optional(),
  on_time_rate: z.number().min(0).max(1).nullable().optional(),
  quality_score: z.number().min(0).max(1).nullable().optional(),
  created_at: z.coerce.date().optional()
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const WarehouseSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  code: z.string().min(1),
  name: z.string(),
  map_x: z.number().int().min(0).max(1000),
  map_y: z.number().int().min(0).max(1000),
  lat: z.number().optional(),
  lng: z.number().optional(),
  processing_hours: z.number().int().nonnegative().default(2),
  is_hub: z.boolean().default(false),
  created_at: z.coerce.date().optional()
});
export type Warehouse = z.infer<typeof WarehouseSchema>;

export const SkuSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  code: z.string().min(1),
  name: z.string(),
  unit_cost: z.number().int().nonnegative(), // INR integer
  weight_kg: z.number().nonnegative(),
  units_per_slot: z.number().int().positive().default(10),
  category: z.string(),
  is_critical: z.boolean().default(false),
  created_at: z.coerce.date().optional()
});
export type Sku = z.infer<typeof SkuSchema>;

export const SupplierSkuSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  supplier_id: z.string(),
  sku_id: z.string(),
  warehouse_id: z.string(),
  capacity_per_shipment: z.number().int().positive(),
  lead_time_hours: z.number().int().nonnegative(),
  unit_cost: z.number().int().nonnegative(), // INR integer
  is_qualified: z.boolean().default(true)
});
export type SupplierSku = z.infer<typeof SupplierSkuSchema>;

export const TransferLaneSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  from_warehouse_id: z.string(),
  to_warehouse_id: z.string(),
  transit_hours: z.number().int().nonnegative(),
  cost_per_unit: z.number().int().nonnegative(), // INR integer
  distance_km: z.number().int().nonnegative(),
  is_active: z.boolean().default(true)
});
export type TransferLane = z.infer<typeof TransferLaneSchema>;

export const ShipmentStatusSchema = z.enum(['IN_TRANSIT', 'DELIVERED', 'CANCELLED']);
export type ShipmentStatus = z.infer<typeof ShipmentStatusSchema>;

export const ShipmentSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  code: z.string().min(1),
  supplier_id: z.string(),
  warehouse_id: z.string(),
  status: ShipmentStatusSchema,
  promised_eta: z.coerce.date(),
  current_eta: z.coerce.date(),
  actual_arrival_at: z.coerce.date().nullable().optional(),
  carrier_name: z.string(),
  total_units: z.number().int().nonnegative(),
  usable_quantity: z.number().int().nonnegative().nullable().optional(),
  is_disrupted: z.boolean().default(false),
  created_at: z.coerce.date().optional()
});
export type Shipment = z.infer<typeof ShipmentSchema>;

export const ShipmentLineSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  shipment_id: z.string(),
  sku_id: z.string(),
  quantity: z.number().int().positive()
});
export type ShipmentLine = z.infer<typeof ShipmentLineSchema>;

export const InventoryBalanceSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  warehouse_id: z.string(),
  sku_id: z.string(),
  on_hand: z.number().int().min(0),
  reserved: z.number().int().min(0),
  updated_at: z.coerce.date().optional()
}).refine((data) => data.reserved <= data.on_hand, {
  message: 'reserved must be less than or equal to on_hand',
  path: ['reserved']
});
export type InventoryBalance = z.infer<typeof InventoryBalanceSchema>;

export const OrderPrioritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
export type OrderPriority = z.infer<typeof OrderPrioritySchema>;

export const OrderStatusSchema = z.enum(['OPEN', 'RECOVERING', 'FULFILLED', 'CANCELLED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  code: z.string().min(1),
  customer_name: z.string(),
  priority: OrderPrioritySchema,
  status: OrderStatusSchema,
  due_at: z.coerce.date(),
  penalty_per_hour: z.number().int().nonnegative(), // INR integer
  total_units: z.number().int().positive(),
  warehouse_id: z.string(),
  risk_score: z.number().int().min(0).max(100).nullable().optional(),
  risk_band: z.enum(['RED', 'AMBER', 'GREEN']).nullable().optional(),
  recovery_plan_id: z.string().nullable().optional(),
  created_at: z.coerce.date().optional()
});
export type Order = z.infer<typeof OrderSchema>;

export const OrderLineSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  order_id: z.string(),
  sku_id: z.string(),
  quantity: z.number().int().positive()
});
export type OrderLine = z.infer<typeof OrderLineSchema>;
