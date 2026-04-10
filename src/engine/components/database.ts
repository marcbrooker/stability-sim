import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { DatabaseConfig } from '../../types/configs';
import { createDepartureToOrigin, sampleDistribution, applyLoadDependentLatency } from './shared';

/**
 * Database component: processes work units with separate read/write latency
 * distributions, connection pool limits, and load-dependent latency scaling.
 */
export class Database implements SimComponent {
  readonly id: string;
  readonly type = 'database' as const;
  readonly config: ComponentConfig;

  private dbConfig: DatabaseConfig;

  // Connection pool tracking
  private activeConnections: number = 0;
  private waitQueue: SimEvent[] = [];

  // Failure states
  private crashed: boolean = false;
  private latencySpikeMultiplier: number = 1;

  // Metrics
  private totalProcessed: number = 0;
  private totalRejected: number = 0;

  constructor(id: string, dbConfig: DatabaseConfig) {
    this.id = id;
    this.dbConfig = dbConfig;
    this.config = { type: 'database', ...dbConfig };
  }

  handleEvent(event: SimEvent, context: SimContext): SimEvent[] {
    if (event.kind === 'arrival') {
      return this.handleArrival(event, context);
    } else if (event.kind === 'departure') {
      return this.handleDeparture(event, context);
    }
    return [];
  }

  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    if (this.crashed) {
      this.totalRejected++;
      return [createDepartureToOrigin(event.workUnit, context, true)];
    }
    if (this.activeConnections >= this.dbConfig.connectionPoolSize) {
      this.waitQueue.push(event);
      return [];
    }
    return this.startProcessing(event.workUnit, context);
  }

  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];

    this.activeConnections--;
    this.totalProcessed++;
    this.recordUtilization(context);

    events.push(createDepartureToOrigin(event.workUnit, context, false));

    if (this.waitQueue.length > 0 && this.activeConnections < this.dbConfig.connectionPoolSize) {
      const next = this.waitQueue.shift()!;
      events.push(...this.startProcessing(next.workUnit, context));
    }

    return events;
  }

  private startProcessing(workUnit: WorkUnit, context: SimContext): SimEvent[] {
    this.activeConnections++;
    this.recordUtilization(context);

    const serviceTime = this.computeServiceTime(workUnit, context);
    const departureEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime + serviceTime,
      targetComponentId: this.id,
      workUnit,
      kind: 'departure',
    };

    context.scheduleEvent(departureEvent);
    return [];
  }

  private computeServiceTime(workUnit: WorkUnit, context: SimContext): number {
    const dist = workUnit.isRead
      ? this.dbConfig.readLatencyDistribution
      : this.dbConfig.writeLatencyDistribution;

    let base = sampleDistribution(dist, context);

    if (this.dbConfig.loadDependentLatency) {
      base = applyLoadDependentLatency(base, this.getUtilization(), this.dbConfig.loadDependentLatency);
    }

    base *= this.latencySpikeMultiplier;
    return base;
  }

  private getUtilization(): number {
    if (this.dbConfig.connectionPoolSize === 0) return 1;
    return this.activeConnections / this.dbConfig.connectionPoolSize;
  }

  private recordUtilization(context: SimContext): void {
    context.recordMetric(this.id, 'utilization', this.getUtilization(), context.currentTime);
  }

  setCrashed(crashed: boolean): void { this.crashed = crashed; }
  setLatencySpike(multiplier: number): void { this.latencySpikeMultiplier = multiplier; }

  getMetrics(): ComponentMetrics {
    return {
      activeConnections: this.activeConnections,
      queueDepth: this.waitQueue.length,
      utilization: this.getUtilization(),
      totalProcessed: this.totalProcessed,
      totalRejected: this.totalRejected,
      crashed: this.crashed ? 1 : 0,
      latencySpikeMultiplier: this.latencySpikeMultiplier,
    };
  }

  reset(): void {
    this.activeConnections = 0;
    this.waitQueue = [];
    this.crashed = false;
    this.latencySpikeMultiplier = 1;
    this.totalProcessed = 0;
    this.totalRejected = 0;
  }
}
