import { z } from 'zod';

export const RecoveryPlanStatusSchema = z.enum([
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'COMPLETED',
  'REJECTED',
  'BLOCKED',
  'ROLLED_BACK'
]);
export type RecoveryPlanStatus = z.infer<typeof RecoveryPlanStatusSchema>;

export const RecoveryPlanStrategySchema = z.enum([
  'REALLOCATE',
  'EXPEDITE',
  'SPLIT',
  'BACKORDER',
  'HYBRID'
]);
export type RecoveryPlanStrategy = z.infer<typeof RecoveryPlanStrategySchema>;

export const RecoveryPlanSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  disruption_id: z.string(),
  version: z.number().int().positive().default(1),
  status: RecoveryPlanStatusSchema,
  strategy: RecoveryPlanStrategySchema,
  total_cost: z.number().int().nonnegative(), // INR integer
  residual_risk: z.number().int().min(0).max(100),
  narrative: z.string(),
  created_by: z.string(),
  created_at: z.coerce.date().optional(),
  approved_at: z.coerce.date().nullable().optional()
});
export type RecoveryPlan = z.infer<typeof RecoveryPlanSchema>;

export const PlanActionTypeSchema = z.enum([
  'RESERVE',
  'TRANSFER',
  'EXPEDITE',
  'BACKORDER',
  'SPLIT'
]);
export type PlanActionType = z.infer<typeof PlanActionTypeSchema>;

export const PlanActionStatusSchema = z.enum([
  'PENDING',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'ROLLED_BACK'
]);
export type PlanActionStatus = z.infer<typeof PlanActionStatusSchema>;

export const PlanActionSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  plan_id: z.string(),
  seq: z.number().int().positive(),
  action_type: PlanActionTypeSchema,
  from_warehouse_id: z.string().nullable().optional(),
  to_warehouse_id: z.string(),
  sku_id: z.string(),
  quantity: z.number().int().positive(),
  cost: z.number().int().nonnegative(), // INR integer
  duration_hours: z.number().int().nonnegative(),
  status: PlanActionStatusSchema
});
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanClaimSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  plan_id: z.string(),
  claim_type: z.string(),
  claim_data: z.record(z.any()),
  verified: z.boolean(),
  verification_details: z.record(z.any()).optional(),
  checked_at: z.coerce.date().optional()
});
export type PlanClaim = z.infer<typeof PlanClaimSchema>;

export const StockReservationStatusSchema = z.enum(['HELD', 'RELEASED', 'CONSUMED']);
export type StockReservationStatus = z.infer<typeof StockReservationStatusSchema>;

export const StockReservationSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  plan_id: z.string(),
  action_id: z.string(),
  warehouse_id: z.string(),
  sku_id: z.string(),
  quantity: z.number().int().positive(),
  status: StockReservationStatusSchema,
  reserved_at: z.coerce.date().optional(),
  released_at: z.coerce.date().nullable().optional()
});
export type StockReservation = z.infer<typeof StockReservationSchema>;

export const ApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ApprovalSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  plan_id: z.string(),
  plan_version: z.number().int().positive(),
  required_role: z.string(),
  status: ApprovalStatusSchema,
  decided_by: z.string().nullable().optional(),
  decided_at: z.coerce.date().nullable().optional(),
  comment: z.string().nullable().optional()
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ExecutionLedgerSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  plan_id: z.string(),
  action_id: z.string(),
  step_type: z.string(),
  before_state: z.record(z.any()),
  after_state: z.record(z.any()),
  actor: z.string(),
  seq: z.number().int().positive(),
  prev_hash: z.string(),
  row_hash: z.string(),
  executed_at: z.coerce.date().optional()
});
export type ExecutionLedger = z.infer<typeof ExecutionLedgerSchema>;

export const AuditLogSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  actor: z.string().nullable().optional(),
  action: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().nullable().optional(),
  before: z.record(z.any()).nullable().optional(),
  after: z.record(z.any()).nullable().optional(),
  correlation_id: z.string(),
  step_type: z.string().nullable().optional(),
  seq: z.number().int().positive(),
  prev_hash: z.string(),
  row_hash: z.string(),
  created_at: z.coerce.date().optional()
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const NotificationSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  user_id: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  entity_type: z.string().nullable().optional(),
  entity_id: z.string().nullable().optional(),
  read: z.boolean().default(false),
  created_at: z.coerce.date().optional()
});
export type Notification = z.infer<typeof NotificationSchema>;
