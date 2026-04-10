import { describe, it, expect } from 'vitest';
import { Database } from './database';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { DatabaseConfig } from '../../types/configs';

/** Create a minimal SimContext for testing */
function createMockContext(overrides: Partial<SimContext> = {}): SimContext & { _scheduledEvents: SimEvent[] } {
  const scheduledEvents: SimEvent[] = [];
  return {
    currentTime: overrides.currentTime ?? 0,
    scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
    getComponent: (_id: string) => { throw new Error('not implemented'); },
    getDownstream: (_id: string) => [],
    random: overrides.random ?? (() => 0.5),
    recordMetric: overrides.recordMetric ?? ((_cid, _name, _val, _time) => {}),
    ...overrides,
    _scheduledEvents: scheduledEvents,
  } as SimContext & { _scheduledEvents: SimEvent[] };
}

/** Create an arrival event targeting the database */
function createArrival(
  dbId: string,
  workUnit: WorkUnit,
  timestamp: number = 0,
): SimEvent {
  return {
    id: 'arr-1',
    timestamp,
    targetComponentId: dbId,
    workUnit,
    kind: 'arrival',
  };
}

/** Create a departure event at the database */
function createDeparture(
  dbId: string,
  workUnit: WorkUnit,
  timestamp: number = 1,
): SimEvent {
  return {
    id: 'dep-1',
    timestamp,
    targetComponentId: dbId,
    workUnit,
    kind: 'departure',
  };
}

/** Create a basic work unit */
function createWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'wu-1',
    originClientId: 'client-1',
    createdAt: 0,
    key: 'test-key',
    isRead: true,
    retryCount: 0,
    metadata: {},
    ...overrides,
  };
}

describe('Database component', () => {
  const basicConfig: DatabaseConfig = {
    readLatencyDistribution: { type: 'uniform', min: 5, max: 5 },
    writeLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
    connectionPoolSize: 2,
  };

  describe('basic processing', () => {
    it('processes a read arrival by scheduling a departure via context.scheduleEvent', () => {
      const db = new Database('db-1', basicConfig);
      const ctx = createMockContext({ random: () => 0.5 });
      const wu = createWorkUnit({ isRead: true });

      const result = db.handleEvent(createArrival('db-1', wu), ctx);

      expect(result).toHaveLength(0);
      expect(ctx._scheduledEvents).toHaveLength(1);
      expect(ctx._scheduledEvents[0].kind).toBe('departure');
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('db-1');
    });

    it('returns a departure to the origin client on internal departure', () => {
      const db = new Database('db-1', basicConfig);
      const ctx = createMockContext();
      const wu = createWorkUnit();

      // Process arrival to increment activeConnections
      db.handleEvent(createArrival('db-1', wu), ctx);

      // Process departure
      const depCtx = createMockContext({ currentTime: 5 });
      const result = db.handleEvent(createDeparture('db-1', wu, 5), depCtx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });
  });

  describe('read/write latency distributions (Req 16.1, 16.2)', () => {
    it('uses read latency distribution for read work units', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 5, max: 5 },
        writeLatencyDistribution: { type: 'uniform', min: 20, max: 20 },
        connectionPoolSize: 10,
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });
      const wu = createWorkUnit({ isRead: true });

      db.handleEvent(createArrival('db-1', wu), ctx);

      // Read: uniform(5,5) = 5, departure at t=0+5=5
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(5);
    });

    it('uses write latency distribution for write work units', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 5, max: 5 },
        writeLatencyDistribution: { type: 'uniform', min: 20, max: 20 },
        connectionPoolSize: 10,
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });
      const wu = createWorkUnit({ isRead: false });

      db.handleEvent(createArrival('db-1', wu), ctx);

      // Write: uniform(20,20) = 20, departure at t=0+20=20
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(20);
    });

    it('computes exponential service time correctly', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'exponential', mean: 5 },
        writeLatencyDistribution: { type: 'exponential', mean: 10 },
        connectionPoolSize: 10,
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });

      db.handleEvent(createArrival('db-1', createWorkUnit({ isRead: true })), ctx);
      const expectedRead = -5 * Math.log(0.5);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(expectedRead);
    });

    it('computes log-normal service time correctly', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'log-normal', mu: 0, sigma: 1 },
        writeLatencyDistribution: { type: 'uniform', min: 1, max: 1 },
        connectionPoolSize: 10,
      };
      const db = new Database('db-1', config);
      let callIdx = 0;
      const values = [0.5, 0.5];
      const ctx = createMockContext({ random: () => values[callIdx++] });

      db.handleEvent(createArrival('db-1', createWorkUnit({ isRead: true })), ctx);

      const u1 = 0.5, u2 = 0.5;
      const normal = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
      const expected = Math.exp(0 + 1 * normal);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(expected);
    });
  });

  describe('connection pool limit and queuing (Req 16.3, 16.4)', () => {
    it('enqueues arrivals when connection pool is exhausted', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 1, max: 1 },
        writeLatencyDistribution: { type: 'uniform', min: 1, max: 1 },
        connectionPoolSize: 1,
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext();

      // First arrival: should be processed
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-1' })), ctx);
      expect(ctx._scheduledEvents).toHaveLength(1);

      // Second arrival: should be enqueued
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-2' })), ctx);
      expect(ctx._scheduledEvents).toHaveLength(1); // Still just 1

      expect(db.getMetrics().queueDepth).toBe(1);
    });

    it('dequeues next work unit when a departure frees a connection', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 1, max: 1 },
        writeLatencyDistribution: { type: 'uniform', min: 1, max: 1 },
        connectionPoolSize: 1,
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext();

      // Fill the pool
      const wu1 = createWorkUnit({ id: 'wu-1' });
      db.handleEvent(createArrival('db-1', wu1), ctx);

      // Enqueue a second
      const wu2 = createWorkUnit({ id: 'wu-2' });
      db.handleEvent(createArrival('db-1', wu2), ctx);

      // Process departure of wu1
      const depCtx = createMockContext({ currentTime: 1 });
      const result = db.handleEvent(createDeparture('db-1', wu1, 1), depCtx);

      // Should return departure to client AND schedule processing of wu2
      expect(result).toHaveLength(1); // departure to client
      expect(depCtx._scheduledEvents).toHaveLength(1); // wu2 now being processed
      expect(db.getMetrics().queueDepth).toBe(0);
      expect(db.getMetrics().activeConnections).toBe(1);
    });

    it('handles pool size of 2 correctly', () => {
      const db = new Database('db-1', basicConfig); // poolSize = 2
      const ctx = createMockContext();

      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-1' })), ctx);
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-2' })), ctx);
      expect(ctx._scheduledEvents).toHaveLength(2);
      expect(db.getMetrics().activeConnections).toBe(2);

      // Third should be enqueued
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-3' })), ctx);
      expect(ctx._scheduledEvents).toHaveLength(2);
      expect(db.getMetrics().queueDepth).toBe(1);
    });
  });

  describe('load-dependent latency (Req 16.5, 16.6)', () => {
    it('applies linear scaling', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        writeLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        connectionPoolSize: 2,
        loadDependentLatency: { mode: 'linear', factor: 2 },
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });

      // After increment: activeConnections=1, utilization=1/2=0.5
      // linear: 10 * (1 + 2 * 0.5) = 10 * 2 = 20
      db.handleEvent(createArrival('db-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(20);
    });

    it('applies polynomial scaling', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        writeLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        connectionPoolSize: 2,
        loadDependentLatency: { mode: 'polynomial', factor: 3, exponent: 2 },
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });

      // After increment: utilization=0.5
      // polynomial: 10 * (1 + 3 * 0.5^2) = 10 * 1.75 = 17.5
      db.handleEvent(createArrival('db-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(17.5);
    });

    it('applies exponential scaling', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        writeLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        connectionPoolSize: 2,
        loadDependentLatency: { mode: 'exponential', factor: 1 },
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });

      // After increment: utilization=0.5
      // exponential: 10 * e^(1 * 0.5) ≈ 16.487
      db.handleEvent(createArrival('db-1', createWorkUnit()), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(10 * Math.exp(0.5));
    });

    it('applies load-dependent latency to write work units too', () => {
      const config: DatabaseConfig = {
        readLatencyDistribution: { type: 'uniform', min: 5, max: 5 },
        writeLatencyDistribution: { type: 'uniform', min: 10, max: 10 },
        connectionPoolSize: 2,
        loadDependentLatency: { mode: 'linear', factor: 2 },
      };
      const db = new Database('db-1', config);
      const ctx = createMockContext({ random: () => 0.5 });

      // Write: base=10, utilization=0.5, linear: 10*(1+2*0.5) = 20
      db.handleEvent(createArrival('db-1', createWorkUnit({ isRead: false })), ctx);
      expect(ctx._scheduledEvents[0].timestamp).toBeCloseTo(20);
    });
  });

  describe('utilization metric recording', () => {
    it('records utilization on arrival and departure', () => {
      const recordedMetrics: { name: string; value: number }[] = [];
      const db = new Database('db-1', basicConfig);
      const ctx = createMockContext({
        recordMetric: (_cid, name, value, _time) => {
          recordedMetrics.push({ name, value });
        },
      });

      // Arrival: activeConnections 0→1, utilization = 1/2 = 0.5
      db.handleEvent(createArrival('db-1', createWorkUnit()), ctx);
      expect(recordedMetrics).toContainEqual({ name: 'utilization', value: 0.5 });

      // Departure: activeConnections 1→0, utilization = 0
      const depCtx = createMockContext({
        currentTime: 5,
        recordMetric: (_cid, name, value, _time) => {
          recordedMetrics.push({ name, value });
        },
      });
      db.handleEvent(createDeparture('db-1', createWorkUnit(), 5), depCtx);
      expect(recordedMetrics).toContainEqual({ name: 'utilization', value: 0 });
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const db = new Database('db-1', basicConfig);
      const metrics = db.getMetrics();
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.utilization).toBe(0);
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalRejected).toBe(0);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      const db = new Database('db-1', basicConfig);
      const ctx = createMockContext();

      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-1' })), ctx);
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-2' })), ctx);
      db.handleEvent(createArrival('db-1', createWorkUnit({ id: 'wu-3' })), ctx);

      db.reset();

      const metrics = db.getMetrics();
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.totalProcessed).toBe(0);
      expect(metrics.totalRejected).toBe(0);
    });
  });
});
