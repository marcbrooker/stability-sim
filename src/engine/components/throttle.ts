import { v4 as uuidv4 } from 'uuid';
import type { SimEvent } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { ThrottleConfig } from '../../types/configs';
import { createDepartureToOrigin } from './shared';

/**
 * Throttle component: fast-rejects requests based on admission control.
 *
 * Two modes:
 * - **concurrency**: reject when in-flight count exceeds maxConcurrency
 * - **rps**: reject when EWMA of arrival rate exceeds maxRps
 *
 * Unlike a Queue, the throttle has no buffer — excess arrivals are immediately
 * returned as failures. Place between a load balancer and a server to enforce
 * admission control without queueing delay.
 */
export class Throttle implements SimComponent {
  readonly id: string;
  readonly type = 'throttle' as const;
  readonly config: ComponentConfig;

  private throttleConfig: ThrottleConfig;

  // Number of items currently in-flight to downstream
  private inFlightCount: number = 0;

  // Track real origin for in-flight items: workUnitId → real originClientId
  private pendingOrigins: Map<string, string> = new Map();

  // EWMA state for RPS mode
  private ewmaRate: number = 0;
  private lastArrivalTime: number = -1;

  // Metrics
  private totalAdmitted: number = 0;
  private totalRejected: number = 0;

  constructor(id: string, throttleConfig: ThrottleConfig) {
    this.id = id;
    this.throttleConfig = throttleConfig;
    this.config = { type: 'throttle', ...throttleConfig };
  }

  handleEvent(event: SimEvent, context: SimContext): SimEvent[] {
    if (event.kind === 'arrival') {
      return this.handleArrival(event, context);
    } else if (event.kind === 'departure') {
      return this.handleDeparture(event, context);
    }
    return [];
  }

  private shouldReject(context: SimContext): boolean {
    const mode = this.throttleConfig.mode;
    switch (mode.type) {
      case 'disabled':
        return false;
      case 'concurrency':
        return this.inFlightCount >= mode.maxConcurrency;
      case 'rps':
        return this.getEwmaRate(context.currentTime, mode.ewmaHalfLife) > mode.maxRps;
    }
  }

  /**
   * Compute the EWMA arrival rate. On each arrival, we update the estimate
   * using the time since the last arrival as an instantaneous rate sample.
   * The half-life controls how quickly old samples decay.
   */
  private getEwmaRate(currentTime: number, halfLife: number): number {
    if (this.lastArrivalTime < 0) return 0;
    const dt = currentTime - this.lastArrivalTime;
    if (dt <= 0) return this.ewmaRate;
    // Decay factor: alpha = 1 - 2^(-dt/halfLife)
    const alpha = 1 - Math.pow(2, -dt / halfLife);
    const instantRate = 1 / dt;
    return this.ewmaRate * (1 - alpha) + instantRate * alpha;
  }

  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    // Update EWMA before checking (so the current arrival is reflected)
    if (this.throttleConfig.mode.type === 'rps') {
      this.ewmaRate = this.getEwmaRate(context.currentTime, this.throttleConfig.mode.ewmaHalfLife);
      this.lastArrivalTime = context.currentTime;
    }

    if (this.shouldReject(context)) {
      this.totalRejected++;
      context.recordMetric(this.id, 'totalRejected', this.totalRejected, context.currentTime);
      context.recordMetric(this.id, 'ewmaRate', this.ewmaRate, context.currentTime);
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }

    const downstreamIds = context.getDownstream(this.id);
    if (downstreamIds.length === 0) {
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }

    this.inFlightCount++;
    this.totalAdmitted++;

    // Stash origin and rewrite so departures route back through the throttle
    this.pendingOrigins.set(event.workUnit.id, event.workUnit.originClientId);

    const arrivalEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: downstreamIds[0],
      workUnit: { ...event.workUnit, originClientId: this.id },
      kind: 'arrival',
    };

    context.scheduleEvent(arrivalEvent);
    context.recordMetric(this.id, 'inFlight', this.inFlightCount, context.currentTime);
    context.recordMetric(this.id, 'ewmaRate', this.ewmaRate, context.currentTime);
    return [];
  }

  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    this.inFlightCount--;

    const realOrigin = this.pendingOrigins.get(event.workUnit.id);
    this.pendingOrigins.delete(event.workUnit.id);

    context.recordMetric(this.id, 'inFlight', this.inFlightCount, context.currentTime);

    if (!realOrigin) return [];

    const failed = event.workUnit.metadata['failed'] === true;
    return [createDepartureToOrigin(
      { ...event.workUnit, originClientId: realOrigin },
      context,
      failed,
    )];
  }

  getMetrics(): ComponentMetrics {
    return {
      inFlightCount: this.inFlightCount,
      ewmaRate: this.ewmaRate,
      totalAdmitted: this.totalAdmitted,
      totalRejected: this.totalRejected,
    };
  }

  reset(): void {
    this.inFlightCount = 0;
    this.pendingOrigins.clear();
    this.ewmaRate = 0;
    this.lastArrivalTime = -1;
    this.totalAdmitted = 0;
    this.totalRejected = 0;
  }
}
