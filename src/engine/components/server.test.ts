import { describe, it, expect } from 'vitest';
import { Server } from './server';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { ServerConfig } from '../../types/configs';

/** Create a minimal SimContext for testing */
function createMockContext(overrides: Partial<SimContext> = {}): SimContext {
  const scheduledEvents: SimEvent[] = [];
  return {
    currentTime: overrides.currentTime ?? 0,
    scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
    getComponent: (_id: string) => { throw new Error('not implemented'); },
    getDownstream: (_id: string) => [],
    random: overrides.random ?? (() => 0.5),
    recordMetric: overrides.recordMetric ?? ((_cid, _name, _val, _time) => {}),
    ...overrides,
    // Expose scheduled events for assertions
    _scheduledEvents: scheduledEvents,
  } as SimContext & { _scheduledEvents: SimEvent[] };
}

/** Create an arrival event targeting the server */
function createArrival(
  serverId: string,
  workUnit: WorkUnit,
  timestamp: number = 0,
): SimEvent {
  return {
    id: 'arr-1',
    timestamp,
    targetComponentId: serverId,
    workUnit,
    kind: 'arrival',
  };
}

/** Create a departure event at the server (internal completion) */
function createDeparture(
  serverId: string,
  workUnit: WorkUnit,
  timestamp: number = 1,
): SimEvent {
  return {
    id: 'dep-1',
    timestamp,
    targetComponentId: serverId,
    workUnit,
    kind: 'departure',
  };
}

/** Create a basic work unit */
function createWorkUnit(clientId: string = 'client-1', createdAt: number = 0): WorkUnit {
  return {
    id: 'wu-1',
    originClientId: clientId,
    createdAt,
    key: 'test-key',
    isRead: true,
    retryCount: 0,
    metadata: {},
  };
}

describe('Server component', () => {
  const basicConfig: ServerConfig = {
    serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
    concurrencyLimit: 2,
  };

  describe('basic processing', () => {
    it('processes an arrival by scheduling a departure via context.scheduleEvent', () => {
      const server = new Server('srv-1', basicConfig);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };
      const wu = createWorkUnit();
      const arrival = createArrival('srv-1', wu);

      const result = server.handleEvent(arrival, ctx);

      // No direct return events from arrival (departure is scheduled via context)
      expect(result).toHaveLength(0);
      // A departure event should have been scheduled
      expect(ctx._scheduledEvents).toHaveLength(1);
      expect(ctx._scheduledEvents[0].kind).toBe('departure');
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('srv-1');
    });

    it('returns a departure to the origin client on internal departure', () => {
      const server = new Server('srv-1', basicConfig);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };
      const wu = createWorkUnit('client-1');

      // First, process an arrival to increment activeCount
      server.handleEvent(createArrival('srv-1', wu), ctx);

      // Now process the departure
      const depCtx = createMockContext({ currentTime: 1 }) as SimContext & { _scheduledEvents: SimEvent[] };
      const result = server.handleEvent(createDeparture('srv-1', wu, 1), depCtx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });
  });

  describe('concurrency limit (Req 6.2, 6.3)', () => {
    it('rejects arrivals when at concurrency limit', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
        concurrencyLimit: 1,
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };

      // First arrival: should be processed
      const wu1 = { ...createWorkUnit(), id: 'wu-1' };
      server.handleEvent(createArrival('srv-1', wu1), ctx);
      expect(ctx._scheduledEvents).toHaveLength(1);

      // Second arrival: should be rejected (no internal queue)
      const wu2 = { ...createWorkUnit(), id: 'wu-2' };
      const result = server.handleEvent(createArrival('srv-1', wu2), ctx);
      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
      expect(server.getMetrics().totalRejected).toBe(1);
    });

    it('accepts new arrivals after a departure frees a slot', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
        concurrencyLimit: 1,
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };

      // Fill the slot
      const wu1 = { ...createWorkUnit(), id: 'wu-1' };
      server.handleEvent(createArrival('srv-1', wu1), ctx);

      // Process departure of wu1
      const depCtx = createMockContext({ currentTime: 1 }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createDeparture('srv-1', wu1, 1), depCtx);

      // New arrival should be accepted
      const wu2 = { ...createWorkUnit(), id: 'wu-2' };
      const ctx2 = createMockContext({ currentTime: 1 }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createArrival('srv-1', wu2), ctx2);
      expect(ctx2._scheduledEvents).toHaveLength(1);
      expect(server.getMetrics().activeCount).toBe(1);
    });
  });

  describe('service time distributions (Req 6.1)', () => {
    it('computes uniform service time correctly', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 2, max: 6 },
        concurrencyLimit: 10,
      };
      const server = new Server('srv-1', config);
      // random() = 0.5 → uniform(2, 6) = 2 + 0.5 * 4 = 4
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);

      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(4); // 0 + 4
    });

    it('computes exponential service time correctly', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'exponential', mean: 5 },
        concurrencyLimit: 10,
      };
      const server = new Server('srv-1', config);
      // random() = 0.5 → -5 * ln(1 - 0.5) = -5 * ln(0.5) ≈ 3.4657
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);

      const expected = -5 * Math.log(0.5);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(expected);
    });

    it('computes log-normal service time correctly', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'log-normal', mu: 0, sigma: 1 },
        concurrencyLimit: 10,
      };
      const server = new Server('srv-1', config);
      // Uses two random() calls for Box-Muller
      let callIdx = 0;
      const values = [0.5, 0.5];
      const ctx = createMockContext({ random: () => values[callIdx++] }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);

      const u1 = 0.5, u2 = 0.5;
      const normal = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
      const expected = Math.exp(0 + 1 * normal);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(expected);
    });
  });

  describe('load-dependent latency (Req 6.5, 6.6, 6.7)', () => {
    it('applies linear scaling', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 10, max: 10 },
        concurrencyLimit: 2,
        loadDependentLatency: { mode: 'linear', factor: 2 },
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };

      // First arrival: utilization = 0/2 = 0 at time of computation (before increment)
      // Actually, activeCount is incremented before computeServiceTime
      // After increment: activeCount=1, utilization=1/2=0.5
      // linear: 10 * (1 + 2 * 0.5) = 10 * 2 = 20
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(20);
    });

    it('applies polynomial scaling', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 10, max: 10 },
        concurrencyLimit: 2,
        loadDependentLatency: { mode: 'polynomial', factor: 3, exponent: 2 },
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };

      // After increment: activeCount=1, utilization=0.5
      // polynomial: 10 * (1 + 3 * 0.5^2) = 10 * (1 + 0.75) = 17.5
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(17.5);
    });

    it('applies exponential scaling', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 10, max: 10 },
        concurrencyLimit: 2,
        loadDependentLatency: { mode: 'exponential', factor: 1 },
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };

      // After increment: activeCount=1, utilization=0.5
      // exponential: 10 * e^(1 * 0.5) ≈ 10 * 1.6487 ≈ 16.487
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(10 * Math.exp(0.5));
    });
  });

  describe('utilization metric recording (Req 6.4)', () => {
    it('records utilization on arrival and departure', () => {
      const recordedMetrics: { name: string; value: number }[] = [];
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
        concurrencyLimit: 4,
      };
      const server = new Server('srv-1', config);
      const ctx = createMockContext({
        recordMetric: (_cid, name, value, _time) => {
          recordedMetrics.push({ name, value });
        },
      }) as SimContext & { _scheduledEvents: SimEvent[] };

      // Arrival: activeCount goes 0→1, utilization = 1/4 = 0.25
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(recordedMetrics).toContainEqual({ name: 'utilization', value: 0.25 });

      // Departure: activeCount goes 1→0, utilization = 0/4 = 0
      const depCtx = createMockContext({
        currentTime: 1,
        recordMetric: (_cid, name, value, _time) => {
          recordedMetrics.push({ name, value });
        },
      }) as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createDeparture('srv-1', createWorkUnit(), 1), depCtx);
      expect(recordedMetrics).toContainEqual({ name: 'utilization', value: 0 });
    });
  });

  describe('failure states', () => {
    it('rejects all arrivals when crashed (Req 9.2)', () => {
      const server = new Server('srv-1', basicConfig);
      server.setCrashed(true);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };
      const wu = createWorkUnit('client-1');

      const result = server.handleEvent(createArrival('srv-1', wu), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(true);
      expect(ctx._scheduledEvents).toHaveLength(0); // Nothing scheduled
    });

    it('recovers from crash when setCrashed(false) is called', () => {
      const server = new Server('srv-1', basicConfig);
      server.setCrashed(true);
      server.setCrashed(false);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };

      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents).toHaveLength(1); // Processing normally
    });

    it('multiplies service time during latency spike (Req 9.3)', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 10, max: 10 },
        concurrencyLimit: 10,
      };
      const server = new Server('srv-1', config);
      server.setLatencySpike(3);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };

      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      // base = 10, multiplier = 3 → service time = 30
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(30);
    });

    it('removes latency spike when multiplier reset to 1', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 10, max: 10 },
        concurrencyLimit: 10,
      };
      const server = new Server('srv-1', config);
      server.setLatencySpike(3);
      server.setLatencySpike(1);
      const ctx = createMockContext({ random: () => 0.5 }) as SimContext & { _scheduledEvents: SimEvent[] };

      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(10);
    });

    it('reduces effective concurrency during cpu-reduction (Req 9.4)', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
        concurrencyLimit: 4,
      };
      const server = new Server('srv-1', config);
      server.setCpuReduction(50); // 50% reduction → effective limit = 2

      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };

      // Fill 2 slots (effective limit)
      server.handleEvent(createArrival('srv-1', { ...createWorkUnit(), id: 'wu-1' }), ctx);
      server.handleEvent(createArrival('srv-1', { ...createWorkUnit(), id: 'wu-2' }), ctx);
      expect(ctx._scheduledEvents).toHaveLength(2);

      // Third arrival should be rejected (no internal queue)
      const result = server.handleEvent(createArrival('srv-1', { ...createWorkUnit(), id: 'wu-3' }), ctx);
      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
      expect(server.getMetrics().totalRejected).toBe(1);
    });

    it('ensures effective concurrency is at least 1', () => {
      const config: ServerConfig = {
        serviceTimeDistribution: { type: 'uniform', min: 1, max: 1 },
        concurrencyLimit: 2,
      };
      const server = new Server('srv-1', config);
      server.setCpuReduction(100); // 100% reduction → floor to 1

      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents).toHaveLength(1); // Can still process 1
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const server = new Server('srv-1', basicConfig);
      const metrics = server.getMetrics();
      expect(metrics.activeCount).toBe(0);
      expect(metrics.utilization).toBe(0);
      expect(metrics.tpsProcessed).toBe(0);
      expect(metrics.totalRejected).toBe(0);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      const server = new Server('srv-1', basicConfig);
      const ctx = createMockContext() as SimContext & { _scheduledEvents: SimEvent[] };

      // Process some events and set failure states
      server.handleEvent(createArrival('srv-1', createWorkUnit()), ctx);
      server.setCrashed(true);
      server.setLatencySpike(5);
      server.setCpuReduction(50);

      server.reset();

      const metrics = server.getMetrics();
      expect(metrics.activeCount).toBe(0);
      expect(metrics.tpsProcessed).toBe(0);
      expect(metrics.totalRejected).toBe(0);
      expect(metrics.crashed).toBe(0);
      expect(metrics.latencySpikeMultiplier).toBe(1);
      expect(metrics.cpuReductionPercent).toBe(0);
    });
  });
});
