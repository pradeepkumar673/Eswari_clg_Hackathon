import { z } from 'zod';

export const SourceTrustSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  source: z.string(),
  trust_level: z.number().int().min(1).max(5),
  tolerance_minutes: z.number().int().nonnegative()
});
export type SourceTrust = z.infer<typeof SourceTrustSchema>;

export const ShipmentEventSourceSchema = z.enum([
  'CARRIER_API',
  'FIELD_REPORT',
  'SUPPLIER_PORTAL',
  'CSV',
  'EMAIL_TEXT',
  'CCTV',
  'DRIVER_DEVICE',
  'SIM',
]);
export type ShipmentEventSource = z.infer<typeof ShipmentEventSourceSchema>;

export const ShipmentEventTypeSchema = z.enum([
  'DELAY',
  'ETA_UPDATE',
  'DAMAGE',
  'PARTIAL_LOSS',
  'INVENTORY_CORRECTION',
  'ARRIVED_GEOFENCE',
]);
export type ShipmentEventType = z.infer<typeof ShipmentEventTypeSchema>;

export const ShipmentEventSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  shipment_id: z.string(),
  source: z.string(),
  external_event_id: z.string().nullable().optional(),
  event_type: z.string(),
  reported_eta: z.coerce.date().nullable().optional(),
  quantity_affected: z.number().int().nullable().optional(),
  confidence: z.number().min(0).max(1),
  raw_payload: z.record(z.any()),
  ingested_at: z.coerce.date().optional()
});
export type ShipmentEvent = z.infer<typeof ShipmentEventSchema>;

export const FieldReportChannelSchema = z.enum(['VOICE', 'TEXT', 'FORM']);
export type FieldReportChannel = z.infer<typeof FieldReportChannelSchema>;

export const FieldReportSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  shipment_id: z.string(),
  reporter_user_id: z.string(),
  channel: FieldReportChannelSchema,
  raw_text: z.string(),
  extracted_data: z.record(z.any()),
  llm_used: z.boolean(),
  created_at: z.coerce.date().optional()
});
export type FieldReport = z.infer<typeof FieldReportSchema>;

export const ImportBatchStatusSchema = z.enum(['PENDING', 'VALIDATED', 'COMMITTED', 'REJECTED']);
export type ImportBatchStatus = z.infer<typeof ImportBatchStatusSchema>;

export const ImportBatchSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  filename: z.string(),
  file_hash: z.string(),
  status: ImportBatchStatusSchema,
  uploaded_by: z.string(),
  row_count: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
  created_at: z.coerce.date().optional(),
  committed_at: z.coerce.date().nullable().optional()
});
export type ImportBatch = z.infer<typeof ImportBatchSchema>;

export const ImportRowStatusSchema = z.enum([
  'VALID',
  'REPAIRED',
  'QUARANTINED',
  'DISCARDED',
  'DUPLICATE',
  'CONFLICT',
]);
export type ImportRowStatus = z.infer<typeof ImportRowStatusSchema>;

export const ImportRowSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  batch_id: z.string(),
  row_number: z.number().int().positive(),
  entity_type: z.string().optional(),
  natural_key: z.string().nullable().optional(),
  raw_data: z.record(z.any()),
  repaired_data: z.record(z.any()).nullable().optional(),
  status: ImportRowStatusSchema,
  errors: z.array(z.any()).default([]),
  shipment_event_id: z.string().nullable().optional(),
});
export type ImportRow = z.infer<typeof ImportRowSchema>;

export const DisruptionTypeSchema = z.enum(['DELAY', 'DAMAGE', 'PARTIAL_LOSS', 'FULL_LOSS']);
export type DisruptionType = z.infer<typeof DisruptionTypeSchema>;

export const DisruptionSeveritySchema = z.enum(['RED', 'AMBER', 'GREEN']);
export type DisruptionSeverity = z.infer<typeof DisruptionSeveritySchema>;

export const DisruptionSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  shipment_id: z.string(),
  disruption_type: DisruptionTypeSchema,
  severity: DisruptionSeveritySchema,
  usable_quantity: z.number().int().nonnegative(),
  original_quantity: z.number().int().nonnegative(),
  delay_hours: z.number().int().nullable().optional(),
  detected_at: z.coerce.date().optional(),
  resolved_at: z.coerce.date().nullable().optional(),
  created_by_event_id: z.string()
});
export type Disruption = z.infer<typeof DisruptionSchema>;

export const OrderRiskSnapshotSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  order_id: z.string(),
  risk_score: z.number().int().min(0).max(100),
  urgency: z.number().min(0).max(1),
  supply_gap: z.number().min(0).max(1),
  delay_factor: z.number().min(0).max(1),
  penalty_factor: z.number().min(0).max(1),
  band: z.enum(['RED', 'AMBER', 'GREEN']),
  snapshot_at: z.coerce.date().optional()
});
export type OrderRiskSnapshot = z.infer<typeof OrderRiskSnapshotSchema>;

export const LLMCacheSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  input_hash: z.string(),
  model: z.string(),
  prompt_type: z.string(),
  input_text: z.string(),
  output_text: z.string(),
  tokens_used: z.number().int().nonnegative(),
  created_at: z.coerce.date().optional()
});
export type LLMCache = z.infer<typeof LLMCacheSchema>;
