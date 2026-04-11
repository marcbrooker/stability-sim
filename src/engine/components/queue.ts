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

  // FIFO buffer with head pointer for O(1) amortized dequeue
  private buffer: SimEvent[] = [];
  private bufferHead: number = 0;

  // Number of items currently in-flight to downstream
  private inFlightCount: number = 0;

  // Track real origin for in-flight items: workUnitId → real originClientId
  private pendingOrigins: Map<string, string> = new Map();

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
  /** Logical length of the FIFO buffer (excludes already-dequeued head elements) */
  private get bufferLength(): number {
    return this.buffer.length - this.bufferHead;
  }

  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    const depth = this.bufferLength + this.inFlightCount;

    // Reject if at max capacity (Req 5.2, 5.3)
    if (
      this.queueConfig.maxCapacity !== undefined &&
      depth >= this.queueConfig.maxCapacity
    ) {
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

    // Try to send the front item downstream
    return this.sendNextToDownstream(context);
  }

  /**
   * Handle a departure from downstream: forward response to origin,
   * then dequeue and send next item downstream.
   */
  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];

    this.inFlightCount--;

    // Restore the real origin and forward response to the client
    const realOrigin = this.pendingOrigins.get(event.workUnit.id);
    this.pendingOrigins.delete(event.workUnit.id);

    if (realOrigin) {
      const failed = event.workUnit.metadata['failed'] === true;
      events.push(createDepartureToOrigin(
        { ...event.workUnit, originClientId: realOrigin },
        context,
        failed,
      ));
    }
    // If no realOrigin, this is a stale duplicate (e.g., original response
    // arriving after a retry reused the same work unit ID) — don't forward.

    // Dequeue next and send to downstream
    if (this.bufferLength > 0) {
      events.push(...this.sendNextToDownstream(context));
    }

    return events;
  }

  /**
   * Dequeue the front item and send it as an arrival to the downstream component.
   * Respects maxConcurrency: won't send if already at the in-flight limit.
   */
  private sendNextToDownstream(context: SimContext): SimEvent[] {
    const downstreamIds = context.getDownstream(this.id);
    if (downstreamIds.length === 0 || this.bufferLength === 0) {
      return [];
    }

    // Respect concurrency limit
    if (
      this.queueConfig.maxConcurrency !== undefined &&
      this.inFlightCount >= this.queueConfig.maxConcurrency
    ) {
      return [];
    }

    // O(1) dequeue via head pointer; compact when head passes halfway
    const next = this.buffer[this.bufferHead++];
    if (this.bufferHead > this.buffer.length / 2) {
      this.buffer = this.buffer.slice(this.bufferHead);
      this.bufferHead = 0;
    }
    this.totalDequeued++;
    this.inFlightCount++;
    this.recordQueueDepth(context);

    // Stash the real origin and rewrite so the downstream response routes back here
    this.pendingOrigins.set(next.workUnit.id, next.workUnit.originClientId);

    const arrivalEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: downstreamIds[0],
      workUnit: { ...next.workUnit, originClientId: this.id },
      kind: 'arrival',
    };

    context.scheduleEvent(arrivalEvent);
    return [];
  }

  /**
   * Record the current queue depth metric (Req 5.5).
   */
  private recordQueueDepth(context: SimContext): void {
    context.recordMetric(this.id, 'queueDepth', this.bufferLength, context.currentTime);
  }

  /** Return current metrics snapshot */
  getMetrics(): ComponentMetrics {
    return {
      queueDepth: this.bufferLength,
      totalEnqueued: this.totalEnqueued,
      totalDequeued: this.totalDequeued,
      totalRejected: this.totalRejected,
    };
  }

  /** Reset component to initial state */
  reset(): void {
    this.buffer = [];
    this.bufferHead = 0;
    this.inFlightCount = 0;
    this.pendingOrigins.clear();
    this.totalEnqueued = 0;
    this.totalDequeued = 0;
    this.totalRejected = 0;
  }
}
