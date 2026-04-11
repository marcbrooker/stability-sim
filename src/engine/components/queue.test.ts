import { describe, it, expect } from 'vitest';
import { Queue } from './queue';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { QueueConfig } from '../../types/configs';

/** Create a minimal SimContext for testing */
function createMockContext(overrides: Partial<SimContext> = {}): SimContext & { _scheduledEvents: SimEvent[] } {
  const scheduledEvents: SimEvent[] = [];
  return {
    currentTime: overrides.currentTime ?? 0,
    scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
    getComponent: (_id: string) => { throw new Error('not implemented'); },
    getDownstream: overrides.getDownstream ?? ((_id: string) => ['downstream-1']),
    random: overrides.random ?? (() => 0.5),
    recordMetric: overrides.recordMetric ?? ((_cid, _name, _val, _time) => {}),
    ...overrides,
    _scheduledEvents: scheduledEvents,
  } as SimContext & { _scheduledEvents: SimEvent[] };
}

/** Create an arrival event targeting the queue */
function createArrival(
  queueId: string,
  workUnit: WorkUnit,
  timestamp: number = 0,
): SimEvent {
  return {
    id: `arr-${workUnit.id}`,
    timestamp,
    targetComponentId: queueId,
    workUnit,
    kind: 'arrival',
  };
}

/** Create a departure event at the queue (response from downstream) */
function createDeparture(
  queueId: string,
  workUnit: WorkUnit,
  timestamp: number = 1,
  failed: boolean = false,
): SimEvent {
  return {
    id: `dep-${workUnit.id}`,
    timestamp,
    targetComponentId: queueId,
    workUnit: { ...workUnit, metadata: { ...workUnit.metadata, failed } },
    kind: 'departure',
  };
}

/** Create a basic work unit */
function createWorkUnit(id: string = 'wu-1', clientId: string = 'client-1'): WorkUnit {
  return {
    id,
    originClientId: clientId,
    createdAt: 0,
    key: 'test-key',
    isRead: true,
    retryCount: 0,
    metadata: {},
  };
}

describe('Queue component', () => {
  const basicConfig: QueueConfig = { maxCapacity: 3 };

  describe('FIFO ordering (Req 5.1)', () => {
    it('forwards work units to downstream in arrival order', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext();

      const wu1 = createWorkUnit('wu-1');
      const wu2 = createWorkUnit('wu-2');
      const wu3 = createWorkUnit('wu-3');

      // All arrivals are forwarded to downstream immediately
      queue.handleEvent(createArrival('q-1', wu1), ctx);
      queue.handleEvent(createArrival('q-1', wu2), ctx);
      queue.handleEvent(createArrival('q-1', wu3), ctx);
      expect(ctx._scheduledEvents).toHaveLength(3);
      expect(ctx._scheduledEvents[0].workUnit.id).toBe('wu-1');
      expect(ctx._scheduledEvents[1].workUnit.id).toBe('wu-2');
      expect(ctx._scheduledEvents[2].workUnit.id).toBe('wu-3');

      // originClientId is rewritten to queue ID for routing back
      expect(ctx._scheduledEvents[0].workUnit.originClientId).toBe('q-1');
    });
  });

  describe('max capacity (Req 5.2, 5.3)', () => {
    it('rejects arrivals when queue is full (buffer + in-flight)', () => {
      const config: QueueConfig = { maxCapacity: 2 };
      const queue = new Queue('q-1', config);
      const ctx = createMockContext();

      // Two arrivals: both sent downstream → inFlightCount=2, depth=2=maxCapacity
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);

      // Third arrival: depth=2 >= maxCapacity → rejected
      const result = queue.handleEvent(createArrival('q-1', createWorkUnit('wu-3')), ctx);
      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(true);
    });

    it('tracks rejected count in metrics', () => {
      const config: QueueConfig = { maxCapacity: 2 };
      const queue = new Queue('q-1', config);
      const ctx = createMockContext();

      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);
      // Third rejected
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-3')), ctx);

      expect(queue.getMetrics().totalRejected).toBe(1);
    });
  });

  describe('load-shedding threshold (Req 5.4)', () => {
    it('rejects arrivals when depth exceeds load-shedding threshold', () => {
      const config: QueueConfig = { maxCapacity: 5, loadSheddingThreshold: 2 };
      const queue = new Queue('q-1', config);
      const ctx = createMockContext();

      // Two arrivals sent downstream → inFlightCount=2 = threshold
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);

      // Third should be rejected (depth=2 >= threshold=2)
      const result = queue.handleEvent(createArrival('q-1', createWorkUnit('wu-3')), ctx);
      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
    });

    it('does not shed load when threshold is not set', () => {
      const config: QueueConfig = { maxCapacity: 5 };
      const queue = new Queue('q-1', config);
      const ctx = createMockContext();

      // Fill up to 5 items (1 sent downstream + 4 buffered)
      for (let i = 1; i <= 5; i++) {
        queue.handleEvent(createArrival('q-1', createWorkUnit(`wu-${i}`)), ctx);
      }
      // All 5 accepted (1 dequeued + 4 in buffer)
      expect(queue.getMetrics().totalRejected).toBe(0);
    });
  });

  describe('queue depth metric recording (Req 5.5)', () => {
    it('records queue depth on enqueue and dequeue', () => {
      const recordedMetrics: { name: string; value: number; time: number }[] = [];
      const config: QueueConfig = { maxCapacity: 5 };
      const queue = new Queue('q-1', config);
      const ctx = createMockContext({
        recordMetric: (_cid, name, value, time) => {
          recordedMetrics.push({ name, value, time });
        },
      });

      // Arrival: enqueue then immediately dequeue to downstream
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      const depthRecords = recordedMetrics.filter(m => m.name === 'queueDepth');
      expect(depthRecords.length).toBeGreaterThanOrEqual(1);

      // With no downstream returning, second arrival also sent immediately (buffer stays 0)
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);
      const lastRecord = recordedMetrics.filter(m => m.name === 'queueDepth').pop();
      // Buffer is 0 after dequeue; depth metric records buffer length
      expect(lastRecord!.value).toBe(0);
    });
  });

  describe('departure forwarding', () => {
    it('forwards successful departure back to origin client', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext();
      const wu = createWorkUnit('wu-1', 'client-1');

      queue.handleEvent(createArrival('q-1', wu), ctx);

      // Downstream sends departure back to queue (originClientId rewritten to q-1)
      const downstreamWu = { ...wu, originClientId: 'q-1' };
      const ctx2 = createMockContext({ currentTime: 1 });
      const result = queue.handleEvent(createDeparture('q-1', downstreamWu, 1, false), ctx2);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      // Real origin restored
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });

    it('forwards failed departure back to origin client', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext();
      const wu = createWorkUnit('wu-1', 'client-1');

      queue.handleEvent(createArrival('q-1', wu), ctx);

      const downstreamWu = { ...wu, originClientId: 'q-1' };
      const ctx2 = createMockContext({ currentTime: 1 });
      const result = queue.handleEvent(createDeparture('q-1', downstreamWu, 1, true), ctx2);

      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
      expect(result[0].targetComponentId).toBe('client-1');
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const queue = new Queue('q-1', basicConfig);
      const metrics = queue.getMetrics();
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.totalEnqueued).toBe(0);
      expect(metrics.totalDequeued).toBe(0);
      expect(metrics.totalRejected).toBe(0);
    });

    it('tracks enqueue and dequeue counts', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext();

      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);

      // Both enqueued and immediately dequeued to downstream
      expect(queue.getMetrics().totalEnqueued).toBe(2);
      expect(queue.getMetrics().totalDequeued).toBe(2);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext();

      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-2')), ctx);

      queue.reset();

      const metrics = queue.getMetrics();
      expect(metrics.queueDepth).toBe(0);
      expect(metrics.totalEnqueued).toBe(0);
      expect(metrics.totalDequeued).toBe(0);
      expect(metrics.totalRejected).toBe(0);
    });
  });

  describe('no downstream', () => {
    it('buffers items when no downstream is configured', () => {
      const queue = new Queue('q-1', basicConfig);
      const ctx = createMockContext({ getDownstream: () => [] });

      queue.handleEvent(createArrival('q-1', createWorkUnit('wu-1')), ctx);
      // Item enqueued but not sent anywhere
      expect(queue.getMetrics().totalEnqueued).toBe(1);
      expect(queue.getMetrics().totalDequeued).toBe(0);
      expect(ctx._scheduledEvents).toHaveLength(0);
    });
  });
});
