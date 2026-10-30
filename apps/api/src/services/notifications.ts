/**
 * apps/api/src/services/notifications.ts
 *
 * Notification dispatch and outbox engine (Step 10, A1).
 * Channels: IN_APP, EMAIL_SIM, WHATSAPP_SIM.
 * Triggers:
 *   - DISRUPTION_OPENED
 *   - PLAN_SUBMITTED
 *   - APPROVAL_DECIDED
 *   - GUARDRAIL_ESCALATION
 *   - RECOVERY_STATUS_CHANGED (PLAN_EXECUTED, PLAN_ROLLED_BACK)
 */

import mongoose from 'mongoose';
import { Notification, NotificationChannel, INotification } from '../models/notifications.js';
import { User } from '../models/users.js';
import { simClock } from './simClock.js';
import { subscribe } from './bus.js';

export interface DispatchNotificationParams {
  trigger: string;
  template_key: string;
  title: string;
  body: string;
  link_type: string;
  link_id: string;
  entity_type: string;
  entity_id: string;
  target_roles?: string[];
  target_user_ids?: string[];
}

export async function dispatchNotification(
  params: DispatchNotificationParams,
): Promise<INotification[]> {
  const now = await simClock.now();
  let users: any[] = [];

  if (params.target_user_ids && params.target_user_ids.length > 0) {
    users = await User.find({ _id: { $in: params.target_user_ids } }).lean();
  } else if (params.target_roles && params.target_roles.length > 0) {
    users = await User.find({ role: { $in: params.target_roles } }).lean();
  } else {
    // Default fan-out to analysts and managers
    users = await User.find({ role: { $in: ['Analyst', 'Manager', 'Procurement_Approver'] } }).lean();
  }

  const channels: NotificationChannel[] = ['IN_APP', 'EMAIL_SIM', 'WHATSAPP_SIM'];
  const createdDocs: INotification[] = [];

  for (const user of users) {
    for (const channel of channels) {
      const dedupKey = `${params.trigger}|${params.entity_id}|${user._id.toString()}|${channel}`;

      // Check if already dispatched (strictly exactly once per trigger)
      const existing = await Notification.findOne({ dedup_key: dedupKey });
      if (existing) continue;

      const doc = await Notification.create({
        user_id: user._id,
        channel,
        trigger: params.trigger,
        template_key: params.template_key,
        title: params.title,
        body: params.body,
        link_type: params.link_type,
        link_id: params.link_id,
        entity_type: params.entity_type,
        entity_id: params.entity_id,
        dedup_key: dedupKey,
        read: false,
        created_at: now,
      });
      createdDocs.push(doc);
    }
  }

  return createdDocs;
}

/**
 * Connect domain bus subscribers to notification fanout.
 */
export function initNotificationSubscribers(): void {
  subscribe('DISRUPTION_OPENED', async (payload) => {
    await dispatchNotification({
      trigger: 'DISRUPTION_OPENED',
      template_key: 'disruption_opened_tpl',
      title: 'Disruption Opened',
      body: `A new disruption of type ${payload.type} was detected.`,
      link_type: 'disruption',
      link_id: payload.disruptionId,
      entity_type: 'Disruption',
      entity_id: payload.disruptionId,
    });
  });

  subscribe('PLAN_SUBMITTED', async (payload) => {
    await dispatchNotification({
      trigger: 'PLAN_SUBMITTED',
      template_key: 'plan_submitted_tpl',
      title: 'Recovery Plan Submitted',
      body: `Recovery plan ${payload.planId} is awaiting approval.`,
      link_type: 'plan',
      link_id: payload.planId,
      entity_type: 'RecoveryPlan',
      entity_id: payload.planId,
      target_roles: ['Manager', 'Procurement_Approver'],
    });
  });

  subscribe('APPROVAL_DECIDED', async (payload) => {
    await dispatchNotification({
      trigger: 'APPROVAL_DECIDED',
      template_key: 'approval_decided_tpl',
      title: `Approval Decided: ${payload.decision}`,
      body: `Role ${payload.role} decided ${payload.decision} on plan ${payload.planId}.`,
      link_type: 'plan',
      link_id: payload.planId,
      entity_type: 'RecoveryPlan',
      entity_id: payload.planId,
    });
  });

  subscribe('PLAN_EXECUTED', async (payload) => {
    await dispatchNotification({
      trigger: 'RECOVERY_STATUS_CHANGED',
      template_key: 'plan_executed_tpl',
      title: 'Recovery Plan Executed',
      body: `Recovery plan ${payload.planId} has been successfully executed.`,
      link_type: 'plan',
      link_id: payload.planId,
      entity_type: 'RecoveryPlan',
      entity_id: payload.planId,
    });
  });
}

