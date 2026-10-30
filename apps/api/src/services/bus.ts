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
  | 'PLAN_APPROVED'
  | 'PLAN_EXECUTED';

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
  PLAN_APPROVED: {
    planId: string;
    approvedBy: string;
    role: string;
  };
  PLAN_EXECUTED: {
    planId: string;
    executedBy: string;
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
    if (!set || set.size === 0) {
      return;
    }

    for (const handler of Array.from(set)) {
      try {
        await handler(payload);
      } catch (err) {
        logger.error(
          { event, err, payload },
          'Error executing domain bus event handler',
        );
        throw err;
      }
    }
  }

  /**
   * Clears all subscribers (useful for tests).
   */
  public clearSubscribers(event?: DomainEvent): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

export const domainBus = new DomainBus();
export const subscribe = domainBus.subscribe.bind(domainBus);
export const publish = domainBus.publish.bind(domainBus);

