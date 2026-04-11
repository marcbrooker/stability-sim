import type { SimEvent } from '../types/events';
import type { SimComponent, SimContext } from '../types/components';
import type { ConnectionDefinition, SimulationConfig } from '../types/models';
import { PriorityQueue } from './priority-queue';
import { MetricCollector } from './metric-collector';
import { SeededRNG } from './prng';
import type { FailureInjector } from './failure-injector';

/** Simulation execution status */
export type SimulationStatus = 'idle' | 'running' | 'paused' | 'completed';

/**
 * Core discrete-event simulation engine.
 *
 * Processes events in timestamp order from a priority queue, dispatches them
 * to target components, and collects metrics. The simulation clock advances
 * monotonically to each event's timestamp.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 12.1–12.5
 */
export class SimulationEngine {
  /** Event priority queue ordered by (timestamp, insertionOrder) */
  private eventQueue: PriorityQueue<SimEvent>;

  /** Registered simulation components keyed by id */
  private components: Map<string, SimComponent>;

  /** Downstream connection map: componentId → downstream componentIds[] */
  private downstreamMap: Map<string, string[]>;

  /** Connection definitions by ID, for network partition lookups */
  private connectionById: Map<string, { sourceId: string; targetId: string }>;

  /** Metric collector instance */
  private metrics: MetricCollector;

  /** Seeded PRNG for deterministic randomness */
  private rng: SeededRNG;

  /** Current simulation clock (monotonically non-decreasing) */
  private _currentTime: number = 0;

  /** Current engine status */
  private _status: SimulationStatus = 'idle';

  /** Speed multiplier (used by the worker for pacing) */
  private _speedMultiplier: number = 1;

  /** Configured simulation end time */
  private endTime: number;

  /** Seed for PRNG (stored for reset) */
  private seed: number;

  /** Flag set by pause() to interrupt the run loop */
  private pauseRequested: boolean = false;

  /** ID of the component currently being dispatched to (for partition checks) */
  private currentDispatchId: string | null = null;

  /** Initial components for reset */
  private initialComponents: SimComponent[];

  /** Initial connections for reset */
  private initialConnections: ConnectionDefinition[];

  /** Optional failure injector for handling failure-inject/failure-recover events */
  private failureInjector: FailureInjector | null = null;

  constructor(
    components: SimComponent[],
    connections: ConnectionDefinition[],
    config: SimulationConfig,
  ) {
    this.initialComponents = components;
    this.initialConnections = connections;
    this.endTime = config.endTime;
    this.seed = config.seed;

    this.eventQueue = new PriorityQueue<SimEvent>();
    this.metrics = new MetricCollector();
    this.rng = new SeededRNG(config.seed);

    // Build component registry
    this.components = new Map();
    for (const comp of components) {
      this.components.set(comp.id, comp);
    }

    // Build downstream connection map and connection-by-ID lookup
    this.downstreamMap = new Map();
    this.connectionById = new Map();
    for (const conn of connections) {
      const existing = this.downstreamMap.get(conn.sourceId);
      if (existing) {
        existing.push(conn.targetId);
      } else {
        this.downstreamMap.set(conn.sourceId, [conn.targetId]);
      }
      this.connectionById.set(conn.id, { sourceId: conn.sourceId, targetId: conn.targetId });
    }
  }

  // --- Public accessors ---

  get currentTime(): number {
    return this._currentTime;
  }

  get status(): SimulationStatus {
    return this._status;
  }

  get speedMultiplier(): number {
    return this._speedMultiplier;
  }

  get queueSize(): number {
    return this.eventQueue.size;
  }

  getMetrics(): MetricCollector {
    return this.metrics;
  }

  getRng(): SeededRNG {
    return this.rng;
  }

  /** Set the failure injector for handling failure events during simulation */
  setFailureInjector(injector: FailureInjector): void {
    this.failureInjector = injector;
  }

  // --- Event seeding ---

  /** Insert an initial event into the queue (e.g., first client arrivals, failure injections) */
  scheduleEvent(event: SimEvent): void {
    this.eventQueue.insert(event, event.timestamp);
  }

  // --- Control methods (Req 12.1–12.5) ---

  /**
   * Run the simulation continuously until paused, queue empty, or endTime reached.
   * Req 12.1: "play" command runs simulation continuously.
   */
  run(): void {
    if (this._status === 'completed') return;
    this._status = 'running';
    this.pauseRequested = false;

    while (!this.pauseRequested) {
      const done = this.processNextEvent();
      if (done) break;
    }

    // If we stopped because of pause, set status accordingly
    if (this.pauseRequested && this._status === 'running') {
      this._status = 'paused';
    }
  }

  /**
   * Pause the simulation, preserving state.
   * Req 12.2: "pause" halts event processing while preserving state.
   */
  pause(): void {
    this.pauseRequested = true;
    if (this._status === 'running') {
      this._status = 'paused';
    }
  }

  /**
   * Process exactly one event and then pause.
   * Req 12.3: "step" processes exactly one event.
   */
  step(): boolean {
    if (this._status === 'completed') return true;
    this._status = 'running';
    const done = this.processNextEvent();
    if (!done) {
      this._status = 'paused';
    }
    return done;
  }

  /**
   * Restore the simulation to its initial state.
   * Req 12.5: "reset" restores initial state.
   */
  reset(): void {
    this._currentTime = 0;
    this._status = 'idle';
    this.pauseRequested = false;

    this.eventQueue.clear();
    this.metrics.reset();
    this.rng.seed(this.seed);

    // Reset all components
    for (const comp of this.components.values()) {
      comp.reset();
    }

    // Rebuild component registry from initial components
    this.components.clear();
    for (const comp of this.initialComponents) {
      this.components.set(comp.id, comp);
    }

    // Rebuild downstream map and connection lookup from initial connections
    this.downstreamMap.clear();
    this.connectionById.clear();
    for (const conn of this.initialConnections) {
      const existing = this.downstreamMap.get(conn.sourceId);
      if (existing) {
        existing.push(conn.targetId);
      } else {
        this.downstreamMap.set(conn.sourceId, [conn.targetId]);
      }
      this.connectionById.set(conn.id, { sourceId: conn.sourceId, targetId: conn.targetId });
    }
  }

  /**
   * Set the speed multiplier. Actual pacing is done by the worker.
   * Req 12.4: configurable simulation speed multiplier.
   */
  setSpeed(multiplier: number): void {
    this._speedMultiplier = multiplier;
  }

  // --- Core event processing ---

  /**
   * Process the next event from the queue.
   * Returns true if the simulation is done (queue empty or endTime reached).
   *
   * Req 1.1: Events processed in non-decreasing timestamp order (priority queue).
   * Req 1.2: New events from components are inserted into the queue.
   * Req 1.3: Terminates when queue is empty.
   * Req 1.4: Clock is monotonically non-decreasing.
   * Req 1.5: Terminates when endTime is reached.
   */
  private processNextEvent(): boolean {
    // Req 1.3: empty queue → completed
    if (this.eventQueue.size === 0) {
      this._status = 'completed';
      return true;
    }

    const event = this.eventQueue.extractMin()!;

    // Req 1.5: end-time reached → completed
    if (event.timestamp > this.endTime) {
      this._status = 'completed';
      return true;
    }

    // Req 1.4: advance clock monotonically
    this._currentTime = Math.max(this._currentTime, event.timestamp);

    // Intercept failure-inject and failure-recover events
    if (
      (event.kind === 'failure-inject' || event.kind === 'failure-recover') &&
      this.failureInjector
    ) {
      this.failureInjector.handleFailureEvent(event, this.components);
      return false;
    }

    // Look up target component
    const target = this.components.get(event.targetComponentId);
    if (!target) {
      // Target component not found — skip event
      return false;
    }

    // Track dispatching component for network partition checks in scheduleEvent
    this.currentDispatchId = target.id;

    // Create context for this event dispatch
    const context = this.createContext();

    // Dispatch event to target component
    const newEvents = target.handleEvent(event, context);

    // Req 1.2: insert returned events into the queue (checking for partitions)
    for (const newEvent of newEvents) {
      if (!this.isEventBlocked(target.id, newEvent)) {
        this.eventQueue.insert(newEvent, newEvent.timestamp);
      }
    }

    this.currentDispatchId = null;

    return false;
  }

  /**
   * Check whether an event is blocked by a network partition.
   * Only checks events between different components that are connected.
   */
  private isEventBlocked(sourceId: string, event: SimEvent): boolean {
    if (!this.failureInjector) return false;
    const targetId = event.targetComponentId;
    if (sourceId === targetId) return false;
    return this.failureInjector.isPathBlocked(sourceId, targetId, this.connectionById);
  }

  /** Peek at the next event without removing it (for debugging) */
  peekNextEvent(): { timestamp: number; kind: string; targetComponentId: string; workUnitId: string } | null {
    const event = this.eventQueue.peek();
    if (!event) return null;
    return {
      timestamp: event.timestamp,
      kind: event.kind,
      targetComponentId: event.targetComponentId,
      workUnitId: event.workUnit.id,
    };
  }

  /**
   * Create a SimContext for component event handling.
   * Provides currentTime, scheduleEvent, getComponent, getDownstream, random, recordMetric.
   */
  private createContext(): SimContext {
    const engine = this;
    return {
      get currentTime(): number {
        return engine._currentTime;
      },
      scheduleEvent(event: SimEvent): void {
        if (engine.currentDispatchId && engine.isEventBlocked(engine.currentDispatchId, event)) {
          return; // Dropped by network partition; client timeout handles failure detection
        }
        engine.eventQueue.insert(event, event.timestamp);
      },
      getComponent(id: string): SimComponent {
        const comp = engine.components.get(id);
        if (!comp) {
          throw new Error(`Component not found: ${id}`);
        }
        return comp;
      },
      getDownstream(componentId: string): string[] {
        return engine.downstreamMap.get(componentId) ?? [];
      },
      random(): number {
        return engine.rng.random();
      },
      recordMetric(componentId: string, name: string, value: number, time: number): void {
        engine.metrics.record(componentId, name, value, time);
        // Also feed latency values into the dedicated latency collector for percentile computation
        if (name === 'latency') {
          engine.metrics.recordLatency(value, time);
        }
      },
    };
  }
}
