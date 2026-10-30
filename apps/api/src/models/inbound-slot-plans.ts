import mongoose, { Schema, Document } from 'mongoose';

export interface IInboundSlotPlan extends Document {
  shipment_id: string;
  zone_id: string;
  slots: number;
  status: 'PLANNED' | 'RELEASED';
  created_at: Date;
}

const inboundSlotPlanSchema = new Schema<IInboundSlotPlan>({
  shipment_id: { type: String, required: true },
  zone_id: { type: String, required: true, index: true },
  slots: { type: Number, required: true, min: 1 },
  status: { type: String, required: true, enum: ['PLANNED', 'RELEASED'], default: 'PLANNED' },
  created_at: { type: Date, default: Date.now },
}, { collection: 'inbound_slot_plans' });

// Partial unique index: only one PLANNED plan per shipment
inboundSlotPlanSchema.index(
  { shipment_id: 1 },
  {
    name: 'unique_planned_shipment_idx',
    unique: true,
    partialFilterExpression: { status: 'PLANNED' },
  },
);

export const InboundSlotPlan = mongoose.model<IInboundSlotPlan>(
  'InboundSlotPlan',
  inboundSlotPlanSchema,
);
