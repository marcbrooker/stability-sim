import { describe, it, expect } from 'vitest';
import { Cache } from './cache';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { CacheConfig } from '../../types/configs';

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

/** Create an arrival event targeting the cache */
function createArrival(cacheId: string, workUnit: WorkUnit, timestamp: number = 0): SimEvent {
  return {
    id: `arr-${workUnit.id}`,
    timestamp,
    targetComponentId: cacheId,
    workUnit,
    kind: 'arrival',
  };
}

/** Create a departure event at the cache (response from downstream) */
function createDeparture(
  cacheId: string,
  workUnit: WorkUnit,
  timestamp: number = 1,
  failed: boolean = false,
): SimEvent {
  return {
    id: `dep-${workUnit.id}`,
    timestamp,
    targetComponentId: cacheId,
    workUnit: { ...workUnit, metadata: { ...workUnit.metadata, failed } },
    kind: 'departure',
  };
}

/** Create a basic work unit */
function createWorkUnit(id: string = 'wu-1', clientId: string = 'client-1', key: string = ''): WorkUnit {
  return {
    id,
    originClientId: clientId,
    createdAt: 0,
    key,
    isRead: true,
    retryCount: 0,
    metadata: {},
  };
}

describe('Cache component', () => {
  const basicConfig: CacheConfig = { hitRate: 0.8, downstreamComponentId: 'server-1' };

  describe('probabilistic mode (no key)', () => {
    it('returns success departure to origin on cache hit', () => {
      const cache = new Cache('cache-1', basicConfig);
      const ctx = createMockContext({ random: () => 0.3 });
      const wu = createWorkUnit('wu-1', 'client-1', '');

      const result = cache.handleEvent(createArrival('cache-1', wu), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });

    it('forwards to downstream on cache miss', () => {
      const cache = new Cache('cache-1', basicConfig);
      const ctx = createMockContext({ random: () => 0.9 });
      const wu = createWorkUnit('wu-1');

      const result = cache.handleEvent(createArrival('cache-1', wu), ctx);

      expect(result).toHaveLength(0);
      expect(ctx._scheduledEvents).toHaveLength(1);
      expect(ctx._scheduledEvents[0].kind).toBe('arrival');
      expect(ctx._scheduledEvents[0].targetComponentId).toBe('server-1');
    });
  });

  describe('origin rewriting on miss', () => {
    it('rewrites originClientId to cache ID when forwarding miss', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'db-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 0 });
      const wu = createWorkUnit('wu-1', 'client-1', 'user-42');

      cache.handleEvent(createArrival('cache-1', wu), ctx);

      expect(ctx._scheduledEvents).toHaveLength(1);
      // The forwarded work unit should have originClientId = cache ID
      expect(ctx._scheduledEvents[0].workUnit.originClientId).toBe('cache-1');
    });

    it('restores real originClientId on departure', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'db-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 0 });
      const wu = createWorkUnit('wu-1', 'client-1', 'user-42');

      // Miss → forwards to downstream
      cache.handleEvent(createArrival('cache-1', wu), ctx);

      // Simulate downstream response (originClientId is now cache-1)
      const downstreamWu = { ...wu, originClientId: 'cache-1' };
      const result = cache.handleEvent(createDeparture('cache-1', downstreamWu, 0.1, false), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      // Should be restored to the real client
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.originClientId).toBe('client-1');
    });
  });

  describe('key-based caching', () => {
    it('misses on first request for a key, hits on second', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'server-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 0 });
      const wu = createWorkUnit('wu-1', 'client-1', 'user-42');

      // First request: miss
      const r1 = cache.handleEvent(createArrival('cache-1', wu), ctx);
      expect(r1).toHaveLength(0);
      expect(ctx._scheduledEvents).toHaveLength(1);

      // Simulate successful downstream response — caches the key
      const downstreamWu = { ...wu, originClientId: 'cache-1' };
      cache.handleEvent(createDeparture('cache-1', downstreamWu, 0.1, false), ctx);

      // Second request with same key: hit
      const wu2 = createWorkUnit('wu-2', 'client-1', 'user-42');
      const r2 = cache.handleEvent(createArrival('cache-1', wu2), ctx);
      expect(r2).toHaveLength(1);
      expect(r2[0].kind).toBe('departure');
      expect(r2[0].workUnit.metadata['failed']).toBe(false);
    });

    it('expires entries after TTL', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'server-1', ttl: 5 };
      const cache = new Cache('cache-1', config);

      // Insert at t=0
      const ctx0 = createMockContext({ currentTime: 0 });
      const wu = createWorkUnit('wu-1', 'client-1', 'user-42');
      cache.handleEvent(createArrival('cache-1', wu), ctx0);
      const downstreamWu = { ...wu, originClientId: 'cache-1' };
      cache.handleEvent(createDeparture('cache-1', downstreamWu, 0.1, false), ctx0);

      // At t=4: still valid
      const ctx4 = createMockContext({ currentTime: 4 });
      const wu2 = createWorkUnit('wu-2', 'client-1', 'user-42');
      const r1 = cache.handleEvent(createArrival('cache-1', wu2), ctx4);
      expect(r1).toHaveLength(1); // hit

      // At t=5: expired
      const ctx5 = createMockContext({ currentTime: 5 });
      const wu3 = createWorkUnit('wu-3', 'client-1', 'user-42');
      const r2 = cache.handleEvent(createArrival('cache-1', wu3), ctx5);
      expect(r2).toHaveLength(0); // miss
    });

    it('does not cache keys from failed responses', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'server-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 0 });
      const wu = createWorkUnit('wu-1', 'client-1', 'user-42');

      cache.handleEvent(createArrival('cache-1', wu), ctx);
      const downstreamWu = { ...wu, originClientId: 'cache-1' };
      cache.handleEvent(createDeparture('cache-1', downstreamWu, 0.1, true), ctx);

      // Should still miss
      const wu2 = createWorkUnit('wu-2', 'client-1', 'user-42');
      const r = cache.handleEvent(createArrival('cache-1', wu2), ctx);
      expect(r).toHaveLength(0); // miss
    });
  });

  describe('eviction', () => {
    it('evicts LRU entry when maxSize exceeded', () => {
      const config: CacheConfig = {
        hitRate: 0, downstreamComponentId: 'server-1', ttl: 100, maxSize: 2, evictionPolicy: 'lru',
      };
      const cache = new Cache('cache-1', config);

      // Insert key-a at t=0
      const ctx0 = createMockContext({ currentTime: 0 });
      const wuA = createWorkUnit('wu-a', 'client-1', 'key-a');
      cache.handleEvent(createArrival('cache-1', wuA), ctx0);
      cache.handleEvent(createDeparture('cache-1', { ...wuA, originClientId: 'cache-1' }, 0.1, false), ctx0);

      // Insert key-b at t=1
      const ctx1 = createMockContext({ currentTime: 1 });
      const wuB = createWorkUnit('wu-b', 'client-1', 'key-b');
      cache.handleEvent(createArrival('cache-1', wuB), ctx1);
      cache.handleEvent(createDeparture('cache-1', { ...wuB, originClientId: 'cache-1' }, 1.1, false), ctx1);

      // Access key-a at t=2 (makes it recently used)
      const ctx2 = createMockContext({ currentTime: 2 });
      const wuA2 = createWorkUnit('wu-a2', 'client-1', 'key-a');
      cache.handleEvent(createArrival('cache-1', wuA2), ctx2);

      // Insert key-c at t=3 — should evict key-b (LRU)
      const ctx3 = createMockContext({ currentTime: 3 });
      const wuC = createWorkUnit('wu-c', 'client-1', 'key-c');
      cache.handleEvent(createArrival('cache-1', wuC), ctx3);
      cache.handleEvent(createDeparture('cache-1', { ...wuC, originClientId: 'cache-1' }, 3.1, false), ctx3);

      // key-a should still be cached
      const ctx4 = createMockContext({ currentTime: 4 });
      const wuA3 = createWorkUnit('wu-a3', 'client-1', 'key-a');
      const rA = cache.handleEvent(createArrival('cache-1', wuA3), ctx4);
      expect(rA).toHaveLength(1); // hit

      // key-b should be evicted
      const wuB2 = createWorkUnit('wu-b2', 'client-1', 'key-b');
      const rB = cache.handleEvent(createArrival('cache-1', wuB2), ctx4);
      expect(rB).toHaveLength(0); // miss
    });

    it('evicts FIFO entry when maxSize exceeded', () => {
      const config: CacheConfig = {
        hitRate: 0, downstreamComponentId: 'server-1', ttl: 100, maxSize: 2, evictionPolicy: 'fifo',
      };
      const cache = new Cache('cache-1', config);

      // Insert key-a at t=0, key-b at t=1
      const ctx0 = createMockContext({ currentTime: 0 });
      const wuA = createWorkUnit('wu-a', 'client-1', 'key-a');
      cache.handleEvent(createArrival('cache-1', wuA), ctx0);
      cache.handleEvent(createDeparture('cache-1', { ...wuA, originClientId: 'cache-1' }, 0.1, false), ctx0);

      const ctx1 = createMockContext({ currentTime: 1 });
      const wuB = createWorkUnit('wu-b', 'client-1', 'key-b');
      cache.handleEvent(createArrival('cache-1', wuB), ctx1);
      cache.handleEvent(createDeparture('cache-1', { ...wuB, originClientId: 'cache-1' }, 1.1, false), ctx1);

      // Access key-a at t=2 (doesn't matter for FIFO)
      const ctx2 = createMockContext({ currentTime: 2 });
      cache.handleEvent(createArrival('cache-1', createWorkUnit('wu-a2', 'client-1', 'key-a')), ctx2);

      // Insert key-c at t=3 — should evict key-a (oldest inserted)
      const ctx3 = createMockContext({ currentTime: 3 });
      const wuC = createWorkUnit('wu-c', 'client-1', 'key-c');
      cache.handleEvent(createArrival('cache-1', wuC), ctx3);
      cache.handleEvent(createDeparture('cache-1', { ...wuC, originClientId: 'cache-1' }, 3.1, false), ctx3);

      // key-a should be evicted (FIFO)
      const ctx4 = createMockContext({ currentTime: 4 });
      const rA = cache.handleEvent(createArrival('cache-1', createWorkUnit('wu-a3', 'client-1', 'key-a')), ctx4);
      expect(rA).toHaveLength(0); // miss

      // key-b should still be cached
      const rB = cache.handleEvent(createArrival('cache-1', createWorkUnit('wu-b2', 'client-1', 'key-b')), ctx4);
      expect(rB).toHaveLength(1); // hit
    });
  });

  describe('departure forwarding', () => {
    it('forwards successful departure from downstream back to origin', () => {
      const cache = new Cache('cache-1', basicConfig);
      const ctx = createMockContext({ currentTime: 5 });
      const wu = createWorkUnit('wu-1', 'client-1');

      const result = cache.handleEvent(createDeparture('cache-1', wu, 5, false), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].kind).toBe('departure');
      expect(result[0].targetComponentId).toBe('client-1');
      expect(result[0].workUnit.metadata['failed']).toBe(false);
    });

    it('forwards failed departure from downstream back to origin', () => {
      const cache = new Cache('cache-1', basicConfig);
      const ctx = createMockContext({ currentTime: 5 });
      const wu = createWorkUnit('wu-1', 'client-1');

      const result = cache.handleEvent(createDeparture('cache-1', wu, 5, true), ctx);

      expect(result).toHaveLength(1);
      expect(result[0].workUnit.metadata['failed']).toBe(true);
    });
  });

  describe('end-to-end miss→cache→hit flow', () => {
    it('caches key on successful DB response and serves subsequent hit', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'db-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 1 });

      // 1. Arrival with key → miss
      const wu = createWorkUnit('wu-1', 'client-1', 'product-99');
      const missResult = cache.handleEvent(createArrival('cache-1', wu), ctx);
      expect(missResult).toHaveLength(0);
      expect(ctx._scheduledEvents).toHaveLength(1);
      expect(ctx._scheduledEvents[0].workUnit.originClientId).toBe('cache-1');

      // 2. DB responds with departure to cache (originClientId was rewritten)
      const dbResponseWu: WorkUnit = { ...wu, originClientId: 'cache-1' };
      const depResult = cache.handleEvent(createDeparture('cache-1', dbResponseWu, 1.05, false), ctx);
      expect(depResult).toHaveLength(1);
      expect(depResult[0].targetComponentId).toBe('client-1'); // restored
      expect(depResult[0].workUnit.originClientId).toBe('client-1');

      // 3. Same key again → hit
      const wu2 = createWorkUnit('wu-2', 'client-1', 'product-99');
      const hitResult = cache.handleEvent(createArrival('cache-1', wu2), ctx);
      expect(hitResult).toHaveLength(1);
      expect(hitResult[0].kind).toBe('departure');
      expect(hitResult[0].workUnit.metadata['failed']).toBe(false);

      // Verify metrics
      const metrics = cache.getMetrics();
      expect(metrics.hitCount).toBe(1);
      expect(metrics.missCount).toBe(1);
      expect(metrics.cacheSize).toBe(1);
    });

    it('drops duplicate departure when pendingOrigins already consumed by retry', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'db-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ currentTime: 1 });

      // 1. First request misses
      const wu = createWorkUnit('wu-1', 'client-1', 'key-a');
      cache.handleEvent(createArrival('cache-1', wu), ctx);

      // 2. Retry with same work unit ID (overwrites pendingOrigins)
      cache.handleEvent(createArrival('cache-1', wu), ctx);

      // 3. First DB response comes back — consumes pendingOrigins
      const dbWu = { ...wu, originClientId: 'cache-1' };
      const r1 = cache.handleEvent(createDeparture('cache-1', dbWu, 1.1, false), ctx);
      expect(r1).toHaveLength(1);
      expect(r1[0].targetComponentId).toBe('client-1');

      // 4. Second DB response (duplicate) — pendingOrigins still has mapping, should forward
      const r2 = cache.handleEvent(createDeparture('cache-1', dbWu, 1.2, false), ctx);
      expect(r2).toHaveLength(1);
      expect(r2[0].targetComponentId).toBe('client-1');

      // Should NOT target cache-1 (which would cause infinite loop)
      expect(r2[0].targetComponentId).not.toBe('cache-1');
    });
  });

  describe('metrics recording', () => {
    it('records hit count, miss count, total requests, and hit rate', () => {
      const recorded: { name: string; value: number }[] = [];
      const cache = new Cache('cache-1', basicConfig);

      let callCount = 0;
      const ctx = createMockContext({
        random: () => {
          callCount++;
          return callCount === 1 ? 0.3 : 0.9;
        },
        recordMetric: (_cid, name, value, _time) => {
          recorded.push({ name, value });
        },
      });

      // No key → probabilistic mode
      cache.handleEvent(createArrival('cache-1', createWorkUnit('wu-1')), ctx);
      cache.handleEvent(createArrival('cache-1', createWorkUnit('wu-2')), ctx);

      const hitCounts = recorded.filter(m => m.name === 'hitCount');
      const missCounts = recorded.filter(m => m.name === 'missCount');
      const totalReqs = recorded.filter(m => m.name === 'totalRequests');
      const hitRates = recorded.filter(m => m.name === 'hitRate');

      expect(hitCounts[hitCounts.length - 1].value).toBe(1);
      expect(missCounts[missCounts.length - 1].value).toBe(1);
      expect(totalReqs[totalReqs.length - 1].value).toBe(2);
      expect(hitRates[hitRates.length - 1].value).toBe(0.5);
    });
  });

  describe('getMetrics', () => {
    it('returns correct initial metrics', () => {
      const cache = new Cache('cache-1', basicConfig);
      const metrics = cache.getMetrics();
      expect(metrics.hitCount).toBe(0);
      expect(metrics.missCount).toBe(0);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.cacheSize).toBe(0);
    });
  });

  describe('reset', () => {
    it('restores initial state including pending origins', () => {
      const config: CacheConfig = { hitRate: 0, downstreamComponentId: 'server-1', ttl: 10 };
      const cache = new Cache('cache-1', config);
      const ctx = createMockContext({ random: () => 0.3 });

      const wu = createWorkUnit('wu-1', 'client-1', 'key-a');
      cache.handleEvent(createArrival('cache-1', wu), ctx);
      // Don't send departure — leave pending origin

      cache.reset();

      const metrics = cache.getMetrics();
      expect(metrics.hitCount).toBe(0);
      expect(metrics.missCount).toBe(0);
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.hitRate).toBe(0);
      expect(metrics.cacheSize).toBe(0);
    });
  });
});
