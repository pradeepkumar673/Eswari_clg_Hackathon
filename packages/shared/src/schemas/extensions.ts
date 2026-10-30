import { z } from 'zod';

// ── 1. CCTV Clips & Events ────────────────────────────────────────────────────
export const CctvClipSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  clip_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  camera_id: z.string().min(1),
  synthetic_spec: z.record(z.any()).optional(),
  sha256: z.string().min(1),
  frame_count: z.number().int().nonnegative(),
  fps: z.number().positive(),
  created_at: z.coerce.date().optional(),
});
export type CctvClip = z.infer<typeof CctvClipSchema>;

export const CctvEventDamageBandSchema = z.enum(['MINOR', 'MAJOR', 'SEVERE']);
export type CctvEventDamageBand = z.infer<typeof CctvEventDamageBandSchema>;

export const CctvEventStatusSchema = z.enum(['DETECTED', 'LINKED', 'REJECTED']);
export type CctvEventStatus = z.infer<typeof CctvEventStatusSchema>;

export const CctvEventSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  event_id: z.string().min(1),
  clip_id: z.string().min(1),
  track_id: z.number().int().nonnegative(),
  shipment_id: z.string().nullable().optional(),
  warehouse_id: z.string().min(1),
  camera_id: z.string().min(1),
  band: CctvEventDamageBandSchema,
  damage_score: z.number().min(0).max(100),
  components: z.record(z.any()).optional(),
  units_damaged: z.number().int().nonnegative(),
  frame_start: z.number().int().nonnegative(),
  frame_end: z.number().int().nonnegative(),
  evidence_ids: z.array(z.string()).default([]),
  status: CctvEventStatusSchema.default('DETECTED'),
  linked_by: z.string().nullable().optional(),
  linked_at: z.coerce.date().nullable().optional(),
  created_at: z.coerce.date().optional(),
});
export type CctvEvent = z.infer<typeof CctvEventSchema>;

// ── 2. Evidence Items ─────────────────────────────────────────────────────────
export const EvidenceItemKindSchema = z.enum(['FRAME_SNAPSHOT', 'CLIP_SEGMENT']);
export type EvidenceItemKind = z.infer<typeof EvidenceItemKindSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  evidence_id: z.string().min(1),
  kind: EvidenceItemKindSchema,
  path: z.string().min(1),
  sha256: z.string().min(1),
  created_at: z.coerce.date().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

// ── 3. Supplier Claims ────────────────────────────────────────────────────────
export const SupplierClaimStatusSchema = z.enum(['OPEN', 'ACCEPTED', 'REJECTED', 'RESPONDED']);
export type SupplierClaimStatus = z.infer<typeof SupplierClaimStatusSchema>;

export const SupplierClaimSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  claim_id: z.string().min(1),
  supplier_id: z.string().min(1),
  shipment_id: z.string().min(1),
  cctv_event_id: z.string().min(1),
  band: CctvEventDamageBandSchema,
  units: z.number().int().positive(),
  delay_hours: z.number().int().nonnegative(),
  status: SupplierClaimStatusSchema.default('OPEN'),
  supplier_response: z.string().nullable().optional(),
  decided_by: z.string().nullable().optional(),
  linked_by: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  evidence_ids: z.array(z.string()).default([]),
  version: z.number().int().nonnegative().default(1),
  created_at: z.coerce.date().optional(),
});
export type SupplierClaim = z.infer<typeof SupplierClaimSchema>;

// ── 4. Driver Pings & Incidents ───────────────────────────────────────────────
export const DriverPingSourceSchema = z.enum(['SIM', 'DRIVER_DEVICE']);
export type DriverPingSource = z.infer<typeof DriverPingSourceSchema>;

export const DriverPingSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  driver_id: z.string().min(1),
  truck_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.coerce.date(),
  lat: z.number(),
  lng: z.number(),
  lane_id: z.string().nullable().optional(),
  km_on_lane: z.number().nullable().optional(),
  speed_kmh: z.number().nonnegative(),
  source: DriverPingSourceSchema.default('SIM'),
  created_at: z.coerce.date().optional(),
});
export type DriverPing = z.infer<typeof DriverPingSchema>;

export const DriverIncidentKindSchema = z.enum(['BREAKDOWN', 'ACCIDENT', 'DELAY_OTHER']);
export type DriverIncidentKind = z.infer<typeof DriverIncidentKindSchema>;

export const DriverIncidentSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  incident_id: z.string().min(1),
  driver_id: z.string().min(1),
  truck_id: z.string().min(1),
  kind: DriverIncidentKindSchema,
  ts: z.coerce.date(),
  status: z.string().default('REPORTED'),
  idempotency_key: z.string().min(1),
  created_at: z.coerce.date().optional(),
});
export type DriverIncident = z.infer<typeof DriverIncidentSchema>;

// ── 5. Reroute Proposals ──────────────────────────────────────────────────────
export const RerouteMethodSchema = z.enum(['ROAD_GRAPH', 'STRAIGHT_LINE_ESTIMATE']);
export type RerouteMethod = z.infer<typeof RerouteMethodSchema>;

export const RerouteStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED_SIMULATED', 'STALE']);
export type RerouteStatus = z.infer<typeof RerouteStatusSchema>;

export const RerouteProposalSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  proposal_id: z.string().min(1),
  truck_id: z.string().min(1),
  from_position: z.record(z.any()),
  nearest_warehouse_id: z.string().min(1),
  road_km: z.number().nonnegative(),
  path: z.array(z.string()).optional(),
  method: RerouteMethodSchema.default('ROAD_GRAPH'),
  status: RerouteStatusSchema.default('PENDING'),
  proposed_by: z.string().default('system'),
  created_at: z.coerce.date().optional(),
  decided_by: z.string().nullable().optional(),
  reason: z.string().min(1),
});
export type RerouteProposal = z.infer<typeof RerouteProposalSchema>;

// ── 6. Zones, Capacity & Slot Plans ───────────────────────────────────────────
export const ZoneTypeSchema = z.enum(['RECEIVING', 'STORAGE', 'DISPATCH', 'QUARANTINE']);
export type ZoneType = z.infer<typeof ZoneTypeSchema>;

export const ZoneSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  zone_id: z.string().min(1),
  warehouse_id: z.string().min(1),
  name: z.string().min(1),
  zone_type: ZoneTypeSchema,
  polygon: z.array(z.tuple([z.number(), z.number()])),
  capacity_slots: z.number().int().nonnegative(),
  reserved_inbound_slots: z.number().int().nonnegative().default(0),
  version: z.number().int().nonnegative().default(1),
  created_at: z.coerce.date().optional(),
}).refine((data) => data.reserved_inbound_slots <= data.capacity_slots, {
  message: 'reserved_inbound_slots must be <= capacity_slots',
  path: ['reserved_inbound_slots'],
});
export type Zone = z.infer<typeof ZoneSchema>;

export const ZoneStockAssignmentSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  warehouse_id: z.string().min(1),
  sku_id: z.string().min(1),
  zone_id: z.string().min(1),
  units: z.number().int().nonnegative(),
  created_at: z.coerce.date().optional(),
});
export type ZoneStockAssignment = z.infer<typeof ZoneStockAssignmentSchema>;

export const InboundSlotPlanStatusSchema = z.enum(['PLANNED', 'RELEASED']);
export type InboundSlotPlanStatus = z.infer<typeof InboundSlotPlanStatusSchema>;

export const InboundSlotPlanSchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  shipment_id: z.string().min(1),
  zone_id: z.string().min(1),
  slots: z.number().int().positive(),
  status: InboundSlotPlanStatusSchema.default('PLANNED'),
  created_at: z.coerce.date().optional(),
});
export type InboundSlotPlan = z.infer<typeof InboundSlotPlanSchema>;

// ── 7. Damage Policies ────────────────────────────────────────────────────────
export const DamagePolicySchema = z.object({
  id: z.string().optional(),
  _id: z.string().optional(),
  band: CctvEventDamageBandSchema,
  lead_time_hours: z.number().int().nonnegative(),
  action_description: z.string().min(1),
  requires_supplier_claim: z.boolean().default(true),
  created_at: z.coerce.date().optional(),
});
export type DamagePolicy = z.infer<typeof DamagePolicySchema>;

