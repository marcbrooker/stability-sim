import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { ServerConfig } from '../../types/configs';
import { createDepartureToOrigin, sampleDistribution, applyLoadDependentLatency } from './shared';

/**
 * Server component: processes work units with configurable service time,
 * concurrency limits, load-dependent latency, and failure state handling.
 */
export class Server implements SimComponent {
  readonly id: string;
  readonly type = 'server' as const;
  readonly config: ComponentConfig;

  private serverConfig: ServerConfig;

  // Concurrency tracking
  private activeCount: number = 0;
  private waitQueue: SimEvent[] = [];

  // Failure states
  private crashed: boolean = false;
  private latencySpikeMultiplier: number = 1;
  private cpuReductionPercent: number = 0;

  // Metrics
  private tpsProcessed: number = 0;
  private totalRejected: number = 0;

  constructor(id: string, serverConfig: ServerConfig) {
    this.id = id;
    this.serverConfig = serverConfig;
    this.config = { type: 'server', ...serverConfig };
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

    const effectiveLimit = this.getEffectiveConcurrencyLimit();

    if (this.activeCount >= effectiveLimit) {
      if (
        this.serverConfig.maxQueueSize !== undefined &&
        this.waitQueue.length >= this.serverConfig.maxQueueSize
      ) {
        this.totalRejected++;
        return [createDepartureToOrigin(event.workUnit, context, true)];
      }
      this.waitQueue.push(event);
      return [];
    }

    return this.startProcessing(event.workUnit, context);
  }

  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const events: SimEvent[] = [];

    this.activeCount--;
    this.tpsProcessed++;
    this.recordUtilization(context);

    events.push(createDepartureToOrigin(event.workUnit, context, false));

    const effectiveLimit = this.getEffectiveConcurrencyLimit();
    if (this.waitQueue.length > 0 && this.activeCount < effectiveLimit) {
      const next = this.waitQueue.shift()!;
      events.push(...this.startProcessing(next.workUnit, context));
    }

    return events;
  }

  private startProcessing(workUnit: WorkUnit, context: SimContext): SimEvent[] {
    this.activeCount++;
    this.recordUtilization(context);

    const serviceTime = this.computeServiceTime(context);
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

  private computeServiceTime(context: SimContext): number {
    let base = sampleDistribution(this.serverConfig.serviceTimeDistribution, context);

    if (this.serverConfig.loadDependentLatency) {
      base = applyLoadDependentLatency(base, this.getUtilization(), this.serverConfig.loadDependentLatency);
    }

    base *= this.latencySpikeMultiplier;
    return base;
  }

  private getEffectiveConcurrencyLimit(): number {
    const base = this.serverConfig.concurrencyLimit;
    if (this.cpuReductionPercent > 0) {
      return Math.max(1, Math.floor(base * (1 - this.cpuReductionPercent / 100)));
    }
    return base;
  }

  private getUtilization(): number {
    const effectiveLimit = this.getEffectiveConcurrencyLimit();
    if (effectiveLimit === 0) return 1;
    return this.activeCount / effectiveLimit;
  }

  private recordUtilization(context: SimContext): void {
    context.recordMetric(this.id, 'utilization', this.getUtilization(), context.currentTime);
  }

  setCrashed(crashed: boolean): void { this.crashed = crashed; }
  setLatencySpike(multiplier: number): void { this.latencySpikeMultiplier = multiplier; }
  setCpuReduction(reductionPercent: number): void { this.cpuReductionPercent = reductionPercent; }

  getMetrics(): ComponentMetrics {
    return {
      activeCount: this.activeCount,
      queueDepth: this.waitQueue.length,
      utilization: this.getUtilization(),
      tpsProcessed: this.tpsProcessed,
      totalRejected: this.totalRejected,
      crashed: this.crashed ? 1 : 0,
      latencySpikeMultiplier: this.latencySpikeMultiplier,
      cpuReductionPercent: this.cpuReductionPercent,
    };
  }

  reset(): void {
    this.activeCount = 0;
    this.waitQueue = [];
    this.crashed = false;
    this.latencySpikeMultiplier = 1;
    this.cpuReductionPercent = 0;
    this.tpsProcessed = 0;
    this.totalRejected = 0;
  }
}
