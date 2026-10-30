/**
 * apps/api/src/services/bus.ts
 *
 * In-process domain event bus.
 * Handlers are awaited inside the request to guarantee atomic or sequential
 * propagation across system domains (impact, risk, detectors, notifications).
 */

import { logger } from '../logger.js';

export type DomainEvent =
  | 'IMPORT_COMMITTED'
  | 'ETA_CHANGED'
  | 'EVENT_APPLIED'
  | 'INVENTORY_CHANGED'
  | 'DISRUPTION_OPENED'
  | 'PLAN_GENERATED'
  | 'PLAN_SUBMITTED'
  | 'APPROVAL_DECIDED'
  | 'PLAN_APPROVED'
  | 'PLAN_EXECUTED'
  | 'INVENTORY_CORRECTED'
  | 'CUSTOMER_NOTICE_RELEASED'
  | 'CHANGES_REQUESTED'
  | 'DELEGATION_RECEIVED';

export interface DomainEventPayloads {
  IMPORT_COMMITTED: {
    batchId: string;
    entityType: string;
    rowCount: number;
    committedBy: string;
  };
  ETA_CHANGED: {
    shipmentId: string;
    shipmentCode: string;
    oldEta?: Date | null;
    newEta: Date;
    source: string;
    reason: string;
    correlationId: string;
  };
  EVENT_APPLIED: {
    eventId: string;
    shipmentId: string;
    shipmentCode: string;
    eventType: string;
    source: string;
    correlationId: string;
  };
  INVENTORY_CHANGED: {
    warehouseId: string;
    skuId: string;
    previousOnHand: number;
    newOnHand: number;
    delta: number;
    reason: string;
    actor: string;
  };
  DISRUPTION_OPENED: {
    disruptionId: string;
    shipmentId?: string;
    type: string;
    correlationId: string;
  };
  PLAN_GENERATED: {
    planId: string;
    disruptionId: string;
  };
  PLAN_SUBMITTED: {
    planId: string;
    submittedBy: string;
    contractHash: string;
  };
  APPROVAL_DECIDED: {
    planId: string;
    approvalId: string;
    decision: 'APPROVED' | 'REJECTED';
    decidedBy: string;
    role: string;
  };
  PLAN_APPROVED: {
    planId: string;
    approvedBy: string;
    role: string;
  };
  PLAN_EXECUTED: {
    planId: string;
    executedBy: string;
  };
  INVENTORY_CORRECTED: {
    warehouseId: string;
    skuId: string;
    newOnHand: number;
    actor: string;
  };
  CUSTOMER_NOTICE_RELEASED: {
    noticeId: string;
    orderId: string;
    planId: string;
    releasedBy: string;
  };
  CHANGES_REQUESTED: {
    planId: string;
    requestedBy: string;
    role: string;
    comment: string;
    newVersion: number;
  };
  DELEGATION_RECEIVED: {
    delegationId: string;
    delegatorId: string;
    delegateId: string;
    role: string;
    planId: string | null;
  };
}

export type EventHandler<E extends DomainEvent> = (
  payload: DomainEventPayloads[E],
) => Promise<void> | void;

class DomainBus {
  private handlers: Map<DomainEvent, Set<EventHandler<any>>> = new Map();

  /**
   * Subscribes a handler to a specific domain event.
   * Returns an unsubscribe function.
   */
  public subscribe<E extends DomainEvent>(
    event: E,
    handler: EventHandler<E>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);

    return () => {
      set.delete(handler);
    };
  }

  /**
   * Publishes an event to all subscribers and awaits execution sequentially.
   */
  public async publish<E extends DomainEvent>(
    event: E,
    payload: DomainEventPayloads[E],
  ): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        logger.error(
          { event, error: err instanceof Error ? err.message : String(err) },
          'Error in domain event handler',
        );
      }
    }
  }

  public clear(): void {
    this.handlers.clear();
  }
}

export const bus = new DomainBus();
export const domainBus = bus;
export const publish = bus.publish.bind(bus);
export const subscribe = bus.subscribe.bind(bus);
