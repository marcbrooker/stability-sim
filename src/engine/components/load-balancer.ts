import { v4 as uuidv4 } from 'uuid';
import type { SimEvent } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { LoadBalancerConfig } from '../../types/configs';
import { createDepartureToOrigin } from './shared';

/**
 * LoadBalancer component: distributes incoming work units across downstream
 * components using a configurable strategy (round-robin, random, least-connections).
 *
 * Validates: Requirements 8.1, 8.2, 8.3
 */
export class LoadBalancer implements SimComponent {
  readonly id: string;
  readonly type = 'load-balancer' as const;
  readonly config: ComponentConfig;

  private lbConfig: LoadBalancerConfig;

  // Round-robin index
  private rrIndex: number = 0;

  // Least-connections tracking: downstream ID → active connection count
  private connectionCounts: Map<string, number> = new Map();

  // Failed downstream component IDs (set by failure injector)
  private failedDownstream: Set<string> = new Set();

  // Track in-flight work units to know which downstream they went to
  private workUnitToDownstream: Map<string, string> = new Map();

  // Track real origin for in-flight items: workUnitId → real originClientId
  private pendingOrigins: Map<string, string> = new Map();

  // Metrics
  private totalForwarded: number = 0;
  private totalFailed: number = 0;

  constructor(id: string, lbConfig: LoadBalancerConfig) {
    this.id = id;
    this.lbConfig = lbConfig;
    this.config = { type: 'load-balancer', ...lbConfig };
  }

  /**
   * Process an incoming event.
   *
   * 'arrival': Select a downstream component based on strategy, forward the work unit.
   * 'departure': Forward response back to origin, decrement connection count.
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
   * Handle an arrival: select a downstream and forward the work unit.
   * Excludes failed downstream components (Req 8.2).
   * Returns failure if all downstream are failed (Req 8.3).
   */
  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    const allDownstream = context.getDownstream(this.id);
    const available = allDownstream.filter(id => !this.failedDownstream.has(id));

    // All downstream failed → return failure to origin (Req 8.3)
    if (available.length === 0) {
      this.totalFailed++;
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }

    const selected = this.selectDownstream(available, context);

    // Track for least-connections decrement on departure
    this.workUnitToDownstream.set(event.workUnit.id, selected);
    const count = this.connectionCounts.get(selected) ?? 0;
    this.connectionCounts.set(selected, count + 1);

    this.totalForwarded++;

    // Stash real origin and rewrite so departures route back through this LB
    this.pendingOrigins.set(event.workUnit.id, event.workUnit.originClientId);

    // Forward as arrival to selected downstream
    const arrivalEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: selected,
      workUnit: { ...event.workUnit, originClientId: this.id },
      kind: 'arrival',
    };

    context.scheduleEvent(arrivalEvent);
    return [];
  }

  /**
   * Handle a departure from downstream: forward response back to origin,
   * decrement connection count for least-connections tracking.
   */
  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const downstreamId = this.workUnitToDownstream.get(event.workUnit.id);
    if (downstreamId) {
      const count = this.connectionCounts.get(downstreamId) ?? 0;
      this.connectionCounts.set(downstreamId, Math.max(0, count - 1));
      this.workUnitToDownstream.delete(event.workUnit.id);
    }

    // Restore real origin; drop stale duplicates (same pattern as Queue)
    const realOrigin = this.pendingOrigins.get(event.workUnit.id);
    this.pendingOrigins.delete(event.workUnit.id);
    if (!realOrigin) return [];

    const failed = event.workUnit.metadata['failed'] === true;
    return [createDepartureToOrigin(
      { ...event.workUnit, originClientId: realOrigin },
      context,
      failed,
    )];
  }

  /**
   * Select a downstream component based on the configured strategy (Req 8.1).
   */
  private selectDownstream(available: string[], context: SimContext): string {
    switch (this.lbConfig.strategy) {
      case 'round-robin':
        return this.selectRoundRobin(available);
      case 'random':
        return this.selectRandom(available, context);
      case 'least-connections':
        return this.selectLeastConnections(available);
    }
  }

  /** Round-robin: cycle through available downstream in order */
  private selectRoundRobin(available: string[]): string {
    const index = this.rrIndex % available.length;
    this.rrIndex++;
    return available[index];
  }

  /** Random: use context.random() to pick a random downstream */
  private selectRandom(available: string[], context: SimContext): string {
    const index = Math.floor(context.random() * available.length);
    return available[index];
  }

  /** Least-connections: pick the downstream with the fewest active connections */
  private selectLeastConnections(available: string[]): string {
    let minCount = Infinity;
    let selected = available[0];
    for (const id of available) {
      const count = this.connectionCounts.get(id) ?? 0;
      if (count < minCount) {
        minCount = count;
        selected = id;
      }
    }
    return selected;
  }

  // --- Failure state setters (called by failure injector) ---

  /** Mark a downstream component as failed (Req 8.2) */
  setDownstreamFailed(componentId: string, failed: boolean): void {
    if (failed) {
      this.failedDownstream.add(componentId);
    } else {
      this.failedDownstream.delete(componentId);
    }
  }

  /** Return current metrics snapshot */
  getMetrics(): ComponentMetrics {
    return {
      tpsForwarded: this.totalForwarded,
      totalFailed: this.totalFailed,
      failedDownstreamCount: this.failedDownstream.size,
    };
  }

  /** Reset component to initial state */
  reset(): void {
    this.rrIndex = 0;
    this.connectionCounts.clear();
    this.failedDownstream.clear();
    this.workUnitToDownstream.clear();
    this.pendingOrigins.clear();
    this.totalForwarded = 0;
    this.totalFailed = 0;
  }
}
