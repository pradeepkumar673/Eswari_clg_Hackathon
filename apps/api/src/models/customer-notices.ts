import mongoose, { Schema, Document } from 'mongoose';

export interface ICustomerNotice extends Document {
  plan_id?: mongoose.Types.ObjectId | null;
  order_id: mongoose.Types.ObjectId;
  channel?: string;
  template: string;
  content: string;
  status: 'DRAFT' | 'RELEASED';
  committed_at?: Date | null;
  released_by?: mongoose.Types.ObjectId | null;
  released_at?: Date | null;
  sent_at?: Date | null;
  created_at: Date;
}

const customerNoticeSchema = new Schema<ICustomerNotice>(
  {
    plan_id: { type: Schema.Types.ObjectId, ref: 'RecoveryPlan', default: null },
    order_id: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    channel: { type: String, default: 'IN_APP' },
    template: { type: String, required: true },
    content: { type: String, required: true },
    status: { type: String, required: true, enum: ['DRAFT', 'RELEASED'], default: 'DRAFT' },
    committed_at: { type: Date, default: null },
    released_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    released_at: { type: Date, default: null },
    sent_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { collection: 'customer_notices' }
);

customerNoticeSchema.index({ order_id: 1 });
customerNoticeSchema.index({ plan_id: 1 });

export const CustomerNotice = mongoose.model<ICustomerNotice>('CustomerNotice', customerNoticeSchema);
