/**
 * apps/api/src/services/liveQueues.ts
 * Forwards approval-queue and capacity changes to live screens over the 'alerts' topic.
 */

import { subscribe } from './bus.js';
import { broadcastToTopic } from './websocket.js';

export function initLiveQueues(): void {
  const planChanged = async () => {
    await broadcastToTopic('alerts', { type: 'PLAN_QUEUE_CHANGED' });
  };
  const capacityChanged = async () => {
    await broadcastToTopic('alerts', { type: 'CAPACITY_CHANGED' });
  };

  subscribe('PLAN_SUBMITTED', planChanged);
  subscribe('APPROVAL_DECIDED', planChanged);
  subscribe('PLAN_APPROVED', planChanged);
  subscribe('PLAN_EXECUTED', planChanged);
  subscribe('CHANGES_REQUESTED', planChanged);
  subscribe('INVENTORY_CHANGED', capacityChanged);
}

