import { describe, it, expect } from 'vitest';
import { LoadBalancer } from './load-balancer';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { LoadBalancerConfig } from '../../types/configs';

/** Create a minimal SimContext for testing */
function createMockContext(overrides: Partial<SimContext> = {}): SimContext & { _scheduledEvents: SimEvent[] } {
  const scheduledEvents: SimEvent[] = [];
  return {
    currentTime: overrides.currentTime ?? 0,
    scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
    getComponent: (_id: string) => { throw new Error('not implemented'); },
    getDownstream: overrides.getDownstream ?? ((_id: string) => ['server-1', 'server-2', 'server-3']),
    random: overrides.random ?? (() => 0.5),
    recordMetric: overrides.recordMetric ?? ((_cid, _name, _val, _time) => {}),
    ...overrides,
    _scheduledEvents: scheduledEvents,
  } as SimContext & { _scheduledEvents: SimEvent[] };
}

/** Create an arrival event targeting the load balancer */
function createArrival(lbId: string, workUnit: WorkUnit, timestamp: number = 0): SimEvent {
  return {
    id: `arr-${workUnit.id}`,
    timestamp,
    targetComponentId: lbId,
    workUnit,
    kind: 'arrival',
  };
}

/** Create a departure event at the load balancer (response from downstream) */
function createDeparture(
  lbId: string,
  workUnit: WorkUnit,
  timestamp: number = 1,
  failed: boolean = false,
): SimEvent {
  return {
    id: `dep-${workUnit.id}`,
    timestamp,
    targetComponentId: lbId,
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

describe('LoadBalancer component', () => {
  describe('round-robin strategy (Req 8.1)', () => {
    const config: LoadBalancerConfig = { strategy: 'round-robin' };

    it('distributes work units to downstream in order', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-3')), ctx);

      expect(ctx._scheduledEvents).toHaveLength(3);
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-1');
      expect(ctx._scheduledEvents[1].targetComponentId).toBe('server-2');
      expect(ctx._scheduledEvents[2].targetComponentId).toBe('server-3');
    });

    it('wraps around after cycling through all downstream', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      for (let i = 0; i < 4; i++) {
        lb.handleEvent(createArrival('lb-1', createWorkUnit(`wu-${i}`)), ctx);
      }

      expect(ctx._scheduledEvents[3].targetComponentId).toBe('server-1');
    });

    it('forwards work unit as arrival event', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();
      const wu = createWorkUnit('wu-1');

      lb.handleEvent(createArrival('lb-1', wu), ctx);

      expect(ctx._scheduledEvents[0].kind).toBe('arrival');
      expect(ctx._scheduledEvents[0].workUnit.id).toBe('wu-1');
    });
  });

  describe('random strategy (Req 8.1)', () => {
    const config: LoadBalancerConfig = { strategy: 'random' };

    it('selects downstream based on context.random()', () => {
      const lb = new LoadBalancer('lb-1', config);
      // random() = 0.0 → index 0 (server-1)
      const ctx = createMockContext({ random: () => 0.0 });

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);

      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-1');
    });

    it('selects different downstream for different random values', () => {
      const lb = new LoadBalancer('lb-1', config);
      // random() = 0.99 → index 2 (server-3)
      const ctx = createMockContext({ random: () => 0.99 });

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);

      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-3');
    });
  });

  describe('least-connections strategy (Req 8.1)', () => {
    const config: LoadBalancerConfig = { strategy: 'least-connections' };

    it('selects downstream with fewest active connections', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      // First request goes to server-1 (all at 0)
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-1');

      // Second request goes to server-2 (server-1 has 1 connection)
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);
      expect(ctx._scheduledEvents[1].targetComponentId).toBe('server-2');

      // Third request goes to server-3 (server-1 and server-2 each have 1)
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-3')), ctx);
      expect(ctx._scheduledEvents[2].targetComponentId).toBe('server-3');
    });

    it('decrements connection count on departure', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      // Send 3 requests, one to each server
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-3')), ctx);

      // Complete wu-1 (from server-1) → server-1 goes back to 0
      lb.handleEvent(createDeparture('lb-1', createWorkUnit('wu-1')), ctx);

      // Next request should go to server-1 (0 connections, others have 1)
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-4')), ctx);
      expect(ctx._scheduledEvents[3].targetComponentId).toBe('server-1');
    });
  });

  describe('failed downstream exclusion (Req 8.2)', () => {
    const config: LoadBalancerConfig = { strategy: 'round-robin' };

    it('excludes failed downstream from distribution pool', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      lb.setDownstreamFailed('server-1', true);

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);

      // Should only distribute to server-2 and server-3
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-2');
      expect(ctx._scheduledEvents[1].targetComponentId).toBe('server-3');
    });

    it('re-includes downstream when recovered', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      lb.setDownstreamFailed('server-1', true);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-2');

      lb.setDownstreamFailed('server-1', false);
      // Reset round-robin to test fresh
      lb.reset();
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);
      expect(ctx._scheduledEvents[1].targetComponentId).toBe('server-1');
    });
  });

  describe('all downstream failed (Req 8.3)', () => {
    const config: LoadBalancerConfig = { strategy: 'round-robin' };

    it('returns failure departure to origin when all downstream are failed', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      lb.setDownstreamFailed('server-1', true);
      lb.setDownstreamFailed('server-2', true);
      lb.setDownstreamFailed('server-3', true);

      const result = lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1', 'client-1')), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(true);
    });

    it('does not schedule any events when all downstream are failed', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext();

      lb.setDownstreamFailed('server-1', true);
      lb.setDownstreamFailed('server-2', true);
      lb.setDownstreamFailed('server-3', true);

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);

      expect(ctx._scheduledEvents).toHaveLength(0);
    });
  });

  describe('departure forwarding', () => {
    const config: LoadBalancerConfig = { strategy: 'round-robin' };

    it('forwards successful departure from downstream back to origin', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext({ currentTime: 5 });
      const wu = createWorkUnit('wu-1', 'client-1');

      // First send arrival so the work unit is tracked
      lb.handleEvent(createArrival('lb-1', wu), ctx);

      // Departure from downstream has originClientId rewritten to lb-1
      const downstreamWu = { ...wu, originClientId: 'lb-1' };
      const result = lb.handleEvent(createDeparture('lb-1', downstreamWu, 5, false), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });

    it('forwards failed departure from downstream back to origin', () => {
      const lb = new LoadBalancer('lb-1', config);
      const ctx = createMockContext({ currentTime: 5 });
      const wu = createWorkUnit('wu-1', 'client-1');

      lb.handleEvent(createArrival('lb-1', wu), ctx);
      const downstreamWu = { ...wu, originClientId: 'lb-1' };
      const result = lb.handleEvent(createDeparture('lb-1', downstreamWu, 5, true), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
      expect(result[0].targetComponentId).toBe('client-1');
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const lb = new LoadBalancer('lb-1', { strategy: 'round-robin' });
      const metrics = lb.getMetrics();
      expect(metrics.tpsForwarded).toBe(0);
      expect(metrics.totalFailed).toBe(0);
      expect(metrics.failedDownstreamCount).toBe(0);
    });

    it('tracks forwarded and failed counts', () => {
      const lb = new LoadBalancer('lb-1', { strategy: 'round-robin' });
      const ctx = createMockContext();

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-2')), ctx);

      lb.setDownstreamFailed('server-1', true);
      lb.setDownstreamFailed('server-2', true);
      lb.setDownstreamFailed('server-3', true);

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-3')), ctx);

      const metrics = lb.getMetrics();
      expect(metrics.tpsForwarded).toBe(2);
      expect(metrics.totalFailed).toBe(1);
      expect(metrics.failedDownstreamCount).toBe(3);
    });
  });

  describe('reset', () => {
    it('restores initial state', () => {
      const lb = new LoadBalancer('lb-1', { strategy: 'least-connections' });
      const ctx = createMockContext();

      lb.handleEvent(createArrival('lb-1', createWorkUnit('wu-1')), ctx);
      lb.setDownstreamFailed('server-1', true);

      lb.reset();

      const metrics = lb.getMetrics();
      expect(metrics.tpsForwarded).toBe(0);
      expect(metrics.totalFailed).toBe(0);
      expect(metrics.failedDownstreamCount).toBe(0);
    });
  });
});
