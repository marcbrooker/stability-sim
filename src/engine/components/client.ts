import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit, EventKind } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { ClientConfig, TrafficPattern } from '../../types/configs';

/**
 * Client component: generates traffic and handles retry logic.
 *
 * Supports four traffic patterns (open-loop, closed-loop, ramping, burst)
 * and four retry strategies (none, fixed-n, token-bucket, circuit-breaker).
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 10.1
 */
export class Client implements SimComponent {
  readonly id: string;
  readonly type = 'client' as const;
  readonly config: ComponentConfig;

  private clientConfig: ClientConfig;

  // Closed-loop state
  private inFlightCount: number = 0;

  // Token-bucket state
  private tokenBucketTokens: number = 0;

  // Circuit-breaker state: sliding window of (time, isFailure) entries
  private circuitBreakerWindow: { time: number; isFailure: boolean }[] = [];

  // Metrics counters
  private completedCount: number = 0;
  private failedCount: number = 0;
  private retriedCount: number = 0;
  private timedOutCount: number = 0;

  // Track in-flight work unit IDs (for timeout detection)
  private pendingWorkUnits: Set<string> = new Set();

  // Track work units that have already been resolved (by timeout or response).
  // Periodically pruned to avoid unbounded growth.
  private resolvedWorkUnits: Set<string> = new Set();

  // Track whether initial events have been generated (for start)
  private started: boolean = false;

  constructor(id: string, clientConfig: ClientConfig) {
    this.id = id;
    this.clientConfig = clientConfig;
    this.config = { type: 'client', ...clientConfig };

    // Initialize token bucket to full capacity
    if (clientConfig.retryStrategy.type === 'token-bucket') {
      this.tokenBucketTokens = clientConfig.retryStrategy.capacity;
    }
  }

  /**
   * Generate initial events to kick off traffic generation.
   * Called when the simulation starts. Schedules the first arrival(s)
   * at this client based on the traffic pattern.
   */
  generateInitialEvents(context: SimContext): SimEvent[] {
    if (this.started) return [];
    this.started = true;

    const pattern = this.clientConfig.trafficPattern;
    const events: SimEvent[] = [];

    switch (pattern.type) {
      case 'open-loop': {
        // Schedule first self-arrival; subsequent ones are chained in handleEvent
        const rate = this.getOpenLoopRate(context.currentTime, pattern);
        const interArrival = rate > 0
          ? this.exponentialSample(1 / rate, context)
          : 0.001;
        events.push(this.createSelfArrival(context.currentTime + interArrival));
        break;
      }
      case 'closed-loop': {
        // Start maxConcurrency work units immediately
        const count = pattern.maxConcurrency;
        for (let i = 0; i < count; i++) {
          events.push(this.createSelfArrival(context.currentTime));
        }
        break;
      }
      case 'ramping': {
        // Schedule first self-arrival based on startRate
        if (pattern.startRate > 0) {
          const interArrival = this.exponentialSample(1 / pattern.startRate, context);
          events.push(this.createSelfArrival(context.currentTime + interArrival));
        } else {
          // Start rate is 0, schedule a small delay then check
          events.push(this.createSelfArrival(context.currentTime + 0.001));
        }
        break;
      }
      case 'burst': {
        // Schedule all burst work units at atTime
        for (let i = 0; i < pattern.count; i++) {
          events.push(this.createSelfArrival(pattern.atTime));
        }
        break;
      }
    }

    return events;
  }

  /**
   * Handle an incoming event.
   *
   * 'arrival' at self: generate a work unit and send it downstream, then
   *   schedule the next self-arrival based on traffic pattern.
   * 'departure' at self: response from downstream — record latency, handle
   *   retry logic, and for closed-loop generate next request.
   */
  handleEvent(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];

    if (event.kind === 'arrival' && event.targetComponentId === this.id) {
      // This is a "generate traffic" trigger
      events.push(...this.handleGenerateTraffic(event, context));
    } else if (event.kind === 'departure' && event.targetComponentId === this.id) {
      // This is a response coming back from downstream
      events.push(...this.handleResponse(event, context));
    } else if (event.kind === 'timeout' && event.targetComponentId === this.id) {
      // Timeout for an in-flight work unit
      events.push(...this.handleTimeout(event, context));
    }

    return events;
  }

  /**
   * Resolve the downstream target component ID.
   * Uses the explicit targetComponentId if set, otherwise the first downstream connection.
   */
  private getTargetId(context: SimContext): string {
    if (this.clientConfig.targetComponentId) {
      return this.clientConfig.targetComponentId;
    }
    const downstream = context.getDownstream(this.id);
    return downstream[0] ?? '';
  }

  /**
   * Handle a "generate traffic" arrival at this client.
   * Creates a new WorkUnit and sends it to the target component.
   * Schedules the next self-arrival based on traffic pattern.
   */
  private handleGenerateTraffic(_event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];
    const pattern = this.clientConfig.trafficPattern;

    // For closed-loop, check concurrency limit
    if (pattern.type === 'closed-loop') {
      if (this.inFlightCount >= pattern.maxConcurrency) {
        return events; // Drop — at concurrency limit
      }
    }

    // Track in-flight for all patterns
    this.inFlightCount++;

    // Create a new work unit and send it downstream
    const workUnit = this.createWorkUnit(context.currentTime, context);
    this.pendingWorkUnits.add(workUnit.id);
    events.push({
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: this.getTargetId(context),
      workUnit,
      kind: 'arrival' as EventKind,
    });

    // Schedule a timeout event if configured
    const timeout = this.clientConfig.timeout ?? 1;
    if (timeout > 0) {
      const timeoutEvent: SimEvent = {
        id: uuidv4(),
        timestamp: context.currentTime + timeout,
        targetComponentId: this.id,
        workUnit: { ...workUnit },
        kind: 'timeout' as EventKind,
      };
      context.scheduleEvent(timeoutEvent);
    }

    // Schedule next self-arrival based on traffic pattern
    // (burst and closed-loop don't chain self-arrivals here)
    if (pattern.type === 'open-loop') {
      const rate = this.getOpenLoopRate(context.currentTime, pattern);
      if (rate > 0) {
        const interArrival = this.exponentialSample(1 / rate, context);
        events.push(this.createSelfArrival(context.currentTime + interArrival));
      } else {
        events.push(this.createSelfArrival(context.currentTime + 0.001));
      }
    } else if (pattern.type === 'ramping') {
      const currentRate = this.getRampingRate(context.currentTime, pattern);
      if (currentRate > 0) {
        const interArrival = this.exponentialSample(1 / currentRate, context);
        const nextTime = context.currentTime + interArrival;
        // Only schedule if within the ramping duration
        if (nextTime <= pattern.duration) {
          events.push(this.createSelfArrival(nextTime));
        }
      }
    }
    // burst: no chaining — all events are pre-scheduled
    // closed-loop: next request is generated on completion (departure)

    return events;
  }

  /**
   * Handle a response (departure) coming back from downstream.
   * Records latency, applies retry strategy on failure, and for
   * closed-loop generates the next request.
   */
  private handleResponse(_event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];
    const workUnit = _event.workUnit;
    const pattern = this.clientConfig.trafficPattern;

    // If this work unit was already resolved (e.g. by timeout), ignore the late response
    const wasPending = this.pendingWorkUnits.has(workUnit.id);
    if (wasPending && this.resolvedWorkUnits.has(workUnit.id)) {
      return events;
    }
    if (wasPending) {
      this.resolvedWorkUnits.add(workUnit.id);
      this.pendingWorkUnits.delete(workUnit.id);
    }

    const isSuccess = !workUnit.metadata['failed'];

    if (isSuccess) {
      // Record end-to-end latency (Req 10.1)
      const latency = context.currentTime - workUnit.createdAt;
      context.recordMetric(this.id, 'latency', latency, context.currentTime);
      this.completedCount++;
      this.inFlightCount--;

      // Token-bucket: deposit tokens on success (Req 4.3)
      if (this.clientConfig.retryStrategy.type === 'token-bucket') {
        const strategy = this.clientConfig.retryStrategy;
        this.tokenBucketTokens = Math.min(
          strategy.capacity,
          this.tokenBucketTokens + strategy.depositAmount,
        );
      }

      // Circuit-breaker: record success in window
      if (this.clientConfig.retryStrategy.type === 'circuit-breaker') {
        this.circuitBreakerWindow.push({ time: context.currentTime, isFailure: false });
        this.pruneCircuitBreakerWindow(context.currentTime);
      }

      // Closed-loop: generate next request (Req 3.2)
      if (pattern.type === 'closed-loop') {
        const thinkTime = pattern.thinkTime;
        events.push(this.createSelfArrival(context.currentTime + thinkTime));
      }
    } else {
      // Failure path
      this.failedCount++;

      // Circuit-breaker: record failure in window
      if (this.clientConfig.retryStrategy.type === 'circuit-breaker') {
        this.circuitBreakerWindow.push({ time: context.currentTime, isFailure: true });
        this.pruneCircuitBreakerWindow(context.currentTime);
      }

      // Apply retry strategy
      const retryEvents = this.applyRetryStrategy(workUnit, context);
      if (retryEvents.length > 0) {
        // Retrying — work unit stays in-flight (don't decrement)
        events.push(...retryEvents);
      } else {
        // No retry — work unit is done
        this.inFlightCount--;
        // For closed-loop, generate next request
        if (pattern.type === 'closed-loop') {
          const thinkTime = pattern.thinkTime;
          events.push(this.createSelfArrival(context.currentTime + thinkTime));
        }
      }
    }

    return events;
  }

  /**
   * Handle a timeout event for an in-flight work unit.
   * If the work unit is still pending, treat it as a failure and apply retry logic.
   */
  private handleTimeout(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];
    const workUnit = event.workUnit;

    // If the work unit already completed (response arrived before timeout), ignore
    if (this.resolvedWorkUnits.has(workUnit.id)) {
      return events;
    }
    this.resolvedWorkUnits.add(workUnit.id);
    this.pendingWorkUnits.delete(workUnit.id);

    this.timedOutCount++;
    this.failedCount++;
    const pattern = this.clientConfig.trafficPattern;

    // Circuit-breaker: record failure
    if (this.clientConfig.retryStrategy.type === 'circuit-breaker') {
      this.circuitBreakerWindow.push({ time: context.currentTime, isFailure: true });
      this.pruneCircuitBreakerWindow(context.currentTime);
    }

    // Apply retry strategy
    const retryEvents = this.applyRetryStrategy(workUnit, context);
    if (retryEvents.length > 0) {
      events.push(...retryEvents);
    } else {
      // No retry — work unit is done
      this.inFlightCount--;
      if (pattern.type === 'closed-loop') {
        const thinkTime = pattern.thinkTime;
        events.push(this.createSelfArrival(context.currentTime + thinkTime));
      }
    }

    return events;
  }

  /**
   * Apply the configured retry strategy to a failed work unit.
   * Returns events to schedule if a retry should happen, empty array otherwise.
   */
  private applyRetryStrategy(workUnit: WorkUnit, context: SimContext): SimEvent[] {
    const strategy = this.clientConfig.retryStrategy;

    switch (strategy.type) {
      case 'none':
        // Req 4.1: no retry
        return [];

      case 'fixed-n': {
        // Req 4.2: retry up to maxRetries
        if (workUnit.retryCount < strategy.maxRetries) {
          workUnit.retryCount++;
          this.retriedCount++;
          return this.createRetryEvents(workUnit, context);
        }
        return [];
      }

      case 'token-bucket': {
        // Req 4.3, 4.4: consume one token per retry
        if (this.tokenBucketTokens >= 1) {
          this.tokenBucketTokens -= 1;
          workUnit.retryCount++;
          this.retriedCount++;
          return this.createRetryEvents(workUnit, context);
        }
        return [];
      }

      case 'circuit-breaker': {
        // Req 4.5, 4.6: check failure rate in sliding window and retry limit
        if (workUnit.retryCount >= strategy.maxRetries) {
          return [];
        }
        this.pruneCircuitBreakerWindow(context.currentTime);
        const failureRate = this.getCircuitBreakerFailureRate();
        if (failureRate < strategy.failureThreshold) {
          // Circuit is closed — allow retry
          workUnit.retryCount++;
          this.retriedCount++;
          return this.createRetryEvents(workUnit, context);
        }
        // Circuit is open — drop
        return [];
      }
    }
  }

  /**
   * Create retry events: send the work unit downstream again and schedule a timeout.
   */
  private createRetryEvents(workUnit: WorkUnit, context: SimContext): SimEvent[] {
    // Clear resolved state so the retry's response will be processed
    this.resolvedWorkUnits.delete(workUnit.id);
    this.pendingWorkUnits.add(workUnit.id);
    const events: SimEvent[] = [{
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: this.getTargetId(context),
      workUnit,
      kind: 'arrival' as EventKind,
    }];

    // Schedule timeout for the retry
    const timeout = this.clientConfig.timeout ?? 1;
    if (timeout > 0) {
      const timeoutEvent: SimEvent = {
        id: uuidv4(),
        timestamp: context.currentTime + timeout,
        targetComponentId: this.id,
        workUnit: { ...workUnit },
        kind: 'timeout' as EventKind,
      };
      context.scheduleEvent(timeoutEvent);
    }

    return events;
  }

  /**
   * Prune circuit-breaker sliding window entries older than windowSize.
   */
  private pruneCircuitBreakerWindow(currentTime: number): void {
    if (this.clientConfig.retryStrategy.type !== 'circuit-breaker') return;
    const windowSize = this.clientConfig.retryStrategy.windowSize;
    const cutoff = currentTime - windowSize;
    this.circuitBreakerWindow = this.circuitBreakerWindow.filter(e => e.time >= cutoff);
  }

  /**
   * Get the current failure rate from the circuit-breaker sliding window.
   */
  private getCircuitBreakerFailureRate(): number {
    if (this.circuitBreakerWindow.length === 0) return 0;
    const failures = this.circuitBreakerWindow.filter(e => e.isFailure).length;
    return failures / this.circuitBreakerWindow.length;
  }

  // --- Helper methods ---

  /**
   * Create a self-arrival event (trigger to generate traffic).
   */
  private createSelfArrival(timestamp: number): SimEvent {
    return {
      id: uuidv4(),
      timestamp,
      targetComponentId: this.id,
      workUnit: {
        id: uuidv4(),
        originClientId: this.id,
        createdAt: timestamp,
        key: '',
        isRead: true,
        retryCount: 0,
        metadata: {},
      },
      kind: 'arrival' as EventKind,
    };
  }

  /**
   * Create a new WorkUnit originating from this client.
   */
  private createWorkUnit(currentTime: number, context: SimContext): WorkUnit {
    const numKeys = this.clientConfig.numKeys;
    const key = numKeys && numKeys > 0
      ? `key-${Math.floor(context.random() * numKeys)}`
      : '';
    return {
      id: uuidv4(),
      originClientId: this.id,
      createdAt: currentTime,
      key,
      isRead: true,
      retryCount: 0,
      metadata: {},
    };
  }

  /**
   * Sample from an exponential distribution using the context's seeded PRNG.
   * Returns -mean * ln(1 - U) where U is uniform [0, 1).
   */
  private exponentialSample(mean: number, context: SimContext): number {
    const u = context.random();
    return -mean * Math.log(1 - u);
  }

  /**
   * Compute the current arrival rate for an open-loop pattern with optional ramp-up.
   */
  private getOpenLoopRate(
    currentTime: number,
    pattern: Extract<TrafficPattern, { type: 'open-loop' }>,
  ): number {
    const rampUp = pattern.rampUpTime;
    if (!rampUp || rampUp <= 0 || currentTime >= rampUp) {
      return pattern.meanArrivalRate;
    }
    // Use midpoint rate for the next interval to avoid near-zero rates
    // producing enormous inter-arrival times at the start of ramp-up.
    const midpoint = Math.min(currentTime + rampUp / 100, rampUp);
    return (midpoint / rampUp) * pattern.meanArrivalRate;
  }

  /**
   * Compute the current arrival rate for a ramping traffic pattern
   * via linear interpolation between startRate and endRate.
   */
  private getRampingRate(
    currentTime: number,
    pattern: Extract<TrafficPattern, { type: 'ramping' }>,
  ): number {
    if (currentTime >= pattern.duration) {
      return pattern.endRate;
    }
    const fraction = currentTime / pattern.duration;
    return pattern.startRate + (pattern.endRate - pattern.startRate) * fraction;
  }

  /** Return current metrics snapshot */
  getMetrics(): ComponentMetrics {
    return {
      completedCount: this.completedCount,
      failedCount: this.failedCount,
      retriedCount: this.retriedCount,
      timedOutCount: this.timedOutCount,
      inFlightCount: this.inFlightCount,
      tokenBucketTokens: this.tokenBucketTokens,
    };
  }

  /** Reset component to initial state */
  reset(): void {
    this.inFlightCount = 0;
    this.completedCount = 0;
    this.failedCount = 0;
    this.retriedCount = 0;
    this.timedOutCount = 0;
    this.pendingWorkUnits.clear();
    this.resolvedWorkUnits.clear();
    this.started = false;
    this.circuitBreakerWindow = [];

    if (this.clientConfig.retryStrategy.type === 'token-bucket') {
      this.tokenBucketTokens = this.clientConfig.retryStrategy.capacity;
    } else {
      this.tokenBucketTokens = 0;
    }
  }
}
