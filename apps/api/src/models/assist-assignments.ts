/**
 * apps/api/src/models/assist-assignments.ts
 *
 * A responder truck (another driver) that was matched to a broken-down truck.
 * payload holds the exact object pushed to the responder's screen so the
 * driver can reload it after a reconnect without recomputing anything.
 */

import mongoose, { Schema, Document } from 'mongoose';

export type AssistStatus = 'SUGGESTED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export interface IAssistAssignment extends Document {
  assist_id: string;
  incident_id: string;
  broken_driver_id: string;
  broken_truck_id: string;
  responder_driver_id: string;
  responder_truck_id: string;
  reason: 'SAME_DESTINATION' | 'ON_ROUTE';
  status: AssistStatus;
  payload: Record<string, any>;
  created_at: Date;
  decided_at: Date | null;
}

const AssistAssignmentSchema = new Schema<IAssistAssignment>(
  {
    assist_id: { type: String, required: true, unique: true },
    incident_id: { type: String, required: true, index: true },
    broken_driver_id: { type: String, required: true },
    broken_truck_id: { type: String, required: true },
    responder_driver_id: { type: String, required: true, index: true },
    responder_truck_id: { type: String, required: true },
    reason: { type: String, required: true, enum: ['SAME_DESTINATION', 'ON_ROUTE'] },
    status: {
      type: String,
      required: true,
      enum: ['SUGGESTED', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
      default: 'SUGGESTED',
    },
    payload: { type: Schema.Types.Mixed, required: true },
    created_at: { type: Date, default: Date.now },
    decided_at: { type: Date, default: null },
  },
  { collection: 'assist_assignments' },
);

AssistAssignmentSchema.index({ responder_driver_id: 1, status: 1 });

export const AssistAssignment = mongoose.model<IAssistAssignment>(
  'AssistAssignment',
  AssistAssignmentSchema,
);
