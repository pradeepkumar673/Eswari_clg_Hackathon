/**
 * apps/api/src/services/replay.ts
 *
 * Decision Replay Service (Step 10, A5).
 * Reconstructs chronological timeline of events and audit logs for a disruption.
 * When `upTo` step is specified, reconstructs past system state from audit before/after values.
 */

import mongoose from 'mongoose';
import { AuditLog } from '../models/audit-logs.js';
import { ShipmentEvent } from '../models/shipment-events.js';
import { Disruption } from '../models/disruptions.js';
import { Shipment } from '../models/shipments.js';

export interface ReplayStep {
  step_number: number;
  step_type: string;
  source: string;
  timestamp: string;
  audit_id: string;
  reason: string;
  details: any;
}

export interface ReplayResponse {
  disruption_id: string;
  correlation_id: string;
  total_steps: number;
  active_step?: number;
  steps: ReplayStep[];
  reconstructed_state?: {
    resolved_eta: string | null;
    risk_score: number | null;
    plan_status: string | null;
  };
}

export async function getDecisionReplay(
  disruptionId: mongoose.Types.ObjectId | string,
  upToStep?: number,
): Promise<ReplayResponse> {
  const dId = typeof disruptionId === 'string' ? new mongoose.Types.ObjectId(disruptionId) : disruptionId;
  const disruption = await Disruption.findById(dId);
  if (!disruption) throw new Error('Disruption not found');

  const correlationId = disruption.correlation_id || disruption._id.toString();

  // Find audit logs matching correlationId, disruption_id, or shipment_id
  const auditLogs = await AuditLog.find({
    $or: [
      { correlationId },
      { 'after.disruption_id': disruption._id.toString() },
      { entityId: disruption._id.toString() },
      { entityId: disruption.shipment_id.toString() },
    ],
  })
    .sort({ seq: 1 })
    .lean();

  const steps: ReplayStep[] = auditLogs.map((log, index) => {
    const after = log.after as any;
    const before = log.before as any;
    return {
      step_number: index + 1,
      step_type: log.action || (log as any).step_type || 'AUDIT_STEP',
      source: log.actor ? log.actor.toString() : 'SYSTEM',
      timestamp: (log as any).created_at ? new Date((log as any).created_at).toISOString() : new Date().toISOString(),
      audit_id: log._id.toString(),
      reason: after?.reason || before?.reason || log.action || 'Audit log event recorded',
      details: after || before || {},
    };
  });

  const response: ReplayResponse = {
    disruption_id: disruption._id.toString(),
    correlation_id: correlationId,
    total_steps: steps.length,
    steps,
  };

  if (upToStep !== undefined && upToStep > 0) {
    const clampedStep = Math.min(upToStep, steps.length);
    response.active_step = clampedStep;
    response.steps = steps.slice(0, clampedStep);

    // Reconstruct state at that step from audit logs
    let resolvedEta: string | null = null;
    let riskScore: number | null = null;
    let planStatus: string | null = null;

    for (let i = 0; i < clampedStep; i++) {
      const details = steps[i].details;
      if (details.resolved_eta) resolvedEta = details.resolved_eta;
      if (details.risk_score !== undefined) riskScore = details.risk_score;
      if (details.plan_status) planStatus = details.plan_status;
      if (details.status) planStatus = details.status;
    }

    response.reconstructed_state = {
      resolved_eta: resolvedEta,
      risk_score: riskScore,
      plan_status: planStatus,
    };
  }

  return response;
}

