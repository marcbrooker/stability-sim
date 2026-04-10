import { v4 as uuidv4 } from 'uuid';
import type { SimEvent } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { QueueConfig } from '../../types/configs';
import { createDepartureToOrigin } from './shared';

/**
 * Queue component: buffers work units in FIFO order with configurable
 * capacity limits and load-shedding behavior.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 */
export class Queue implements SimComponent {
  readonly id: string;
  readonly type = 'queue' as const;
  readonly config: ComponentConfig;

  private queueConfig: QueueConfig;

  // FIFO buffer
  private buffer: SimEvent[] = [];

  // Whether the downstream component is currently busy
  private downstreamBusy: boolean = false;

  // Metrics
  private totalEnqueued: number = 0;
  private totalDequeued: number = 0;
  private totalRejected: number = 0;

  constructor(id: string, queueConfig: QueueConfig) {
    this.id = id;
    this.queueConfig = queueConfig;
    this.config = { type: 'queue', ...queueConfig };
  }

  /**
   * Process an incoming event.
   *
   * 'arrival': Check capacity/load-shedding → reject or enqueue.
   * 'departure': Forward response to origin, dequeue next and send downstream.
   */
  handleEvent(event: SimEvent, context: SimContext): SimEvent[] {
    if (event.kind === 'arrival') {
      return this.handleArrival(event, context);
    } else if (event.kind === 'departure') {
      return this.handleDeparture(event, context);
    }
    return [];
  }

  /**
   * Handle an arrival: reject if full or load-shedding threshold exceeded,
   * otherwise enqueue and forward to downstream if idle.
   */
  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    const depth = this.buffer.length;

    // Reject if at max capacity (Req 5.2, 5.3)
    if (depth >= this.queueConfig.maxCapacity) {
      this.totalRejected++;
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }

    // Reject if load-shedding threshold exceeded (Req 5.4)
    if (
      this.queueConfig.loadSheddingThreshold !== undefined &&
      depth >= this.queueConfig.loadSheddingThreshold
    ) {
      this.totalRejected++;
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }

    // Enqueue (Req 5.1 — FIFO)
    this.buffer.push(event);
    this.totalEnqueued++;
    this.recordQueueDepth(context);

    // If downstream is not busy, send the front item immediately
    if (!this.downstreamBusy) {
      return this.sendNextToDownstream(context);
    }

    return [];
  }

  /**
   * Handle a departure from downstream: forward response to origin,
   * then dequeue and send next item downstream.
   */
  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];

    this.downstreamBusy = false;

    // Forward the response back to the originating client
    const failed = event.workUnit.metadata['failed'] === true;
    events.push(createDepartureToOrigin(event.workUnit, context, failed));

    // Dequeue next and send to downstream
    if (this.buffer.length > 0) {
      events.push(...this.sendNextToDownstream(context));
    }

    return events;
  }

  /**
   * Dequeue the front item and send it as an arrival to the downstream component.
   */
  private sendNextToDownstream(context: SimContext): SimEvent[] {
    const downstreamIds = context.getDownstream(this.id);
    if (downstreamIds.length === 0) {
      return [];
    }

    const next = this.buffer.shift()!;
    this.totalDequeued++;
    this.downstreamBusy = true;
    this.recordQueueDepth(context);

    const arrivalEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: downstreamIds[0],
      workUnit: next.workUnit,
      kind: 'arrival',
    };

    context.scheduleEvent(arrivalEvent);
    return [];
  }

  /**
   * Record the current queue depth metric (Req 5.5).
   */
  private recordQueueDepth(context: SimContext): void {
    context.recordMetric(this.id, 'queueDepth', this.buffer.length, context.currentTime);
  }

  /** Return current metrics snapshot */
  getMetrics(): ComponentMetrics {
    return {
      queueDepth: this.buffer.length,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalRejected: this.totalRejected,
    };
  }

  /** Reset component to initial state */
  reset(): void {
    this.buffer = [];
    this.downstreamBusy = false;
    this.totalEnqueued = 0;
    this.totalDequeued = 0;
    this.totalRejected = 0;
  }
}
