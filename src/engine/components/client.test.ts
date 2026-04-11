import { describe, it, expect } from 'vitest';
import { Client } from './client';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { ClientConfig } from '../../types/configs';

/** Create a minimal SimContext for testing */
function createMockContext(overrides: Partial<SimContext> = {}): SimContext {
  let randomValue = 0.5;
  const scheduledEvents: SimEvent[] = [];
  return {
    currentTime: 0,
    scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
    getComponent: (_id: string) => { throw new Error('not implemented'); },
    getDownstream: (_id: string) => [],
    random: () => {
      // Return a deterministic value for testing
      return overrides.random ? overrides.random() : randomValue;
    },
    recordMetric: overrides.recordMetric ?? ((_cid, _name, _val, _time) => {}),
    ...overrides,
  };
}

/** Create a departure event (response) back to the client */
function createDepartureEvent(
  clientId: string,
  workUnit: WorkUnit,
  failed: boolean = false,
  timestamp: number = 1,
): SimEvent {
  const wu = { ...workUnit, metadata: { ...workUnit.metadata, failed } };
  return {
    id: 'dep-1',
    timestamp,
    targetComponentId: clientId,
    workUnit: wu,
    kind: 'departure',
  };
}

/** Create a basic work unit */
function createWorkUnit(clientId: string, createdAt: number = 0): WorkUnit {
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

describe('Client component', () => {

  describe('open-loop traffic pattern', () => {
    it('generates initial arrival events', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      const events = client.generateInitialEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].targetComponentId).toBe('client-1');
      expect(events[0].kind).toBe('arrival');
      expect(events[0].timestamp).toBeGreaterThan(0);
    });

    it('schedules next arrival on self-arrival and sends work to target', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 1, random: () => 0.5 });

      // Simulate a self-arrival
      const selfArrival: SimEvent = {
        id: 'ev-1',
        timestamp: 1,
        targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 1),
        kind: 'arrival',
      };

      const events = client.handleEvent(selfArrival, ctx);
      // Should produce: 1 arrival at server-1 + 1 next self-arrival
      expect(events.length).toBe(2);
      const toServer = events.find(e => e.targetComponentId === 'server-1');
      const toSelf = events.find(e => e.targetComponentId === 'client-1');
      expect(toServer).toBeDefined();
      expect(toServer!.kind).toBe('arrival');
      expect(toSelf).toBeDefined();
      expect(toSelf!.kind).toBe('arrival');
      expect(toSelf!.timestamp).toBeGreaterThan(1);
    });
  });

  describe('closed-loop traffic pattern', () => {
    it('generates maxConcurrency initial events', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'closed-loop', thinkTime: 0.1, maxConcurrency: 3 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0 });

      const events = client.generateInitialEvents(ctx);
      expect(events.length).toBe(3);
    });

    it('enforces maxConcurrency limit', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'closed-loop', thinkTime: 0.1, maxConcurrency: 1 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0 });

      // First self-arrival: should generate traffic (inFlight becomes 1)
      const selfArrival1: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const events1 = client.handleEvent(selfArrival1, ctx);
      expect(events1.some(e => e.targetComponentId === 'server-1')).toBe(true);

      // Second self-arrival: should be dropped (at maxConcurrency)
      const selfArrival2: SimEvent = {
        id: 'ev-2', timestamp: 0.01, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0.01), kind: 'arrival',
      };
      const events2 = client.handleEvent(selfArrival2, ctx);
      expect(events2.length).toBe(0);
    });

    it('generates next request on successful completion with think time', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'closed-loop', thinkTime: 0.5, maxConcurrency: 1 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0 });

      // Send first request
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const events1 = client.handleEvent(selfArrival, ctx);
      const sentWu = events1.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Simulate successful response
      const responseCtx = createMockContext({ currentTime: 1 });
      const departure = createDepartureEvent('client-1', sentWu, false, 1);
      const events2 = client.handleEvent(departure, responseCtx);

      // Should generate a new self-arrival with think time
      expect(events2.length).toBe(1);
      expect(events2[0].targetComponentId).toBe('client-1');
      expect(events2[0].timestamp).toBe(1.5); // currentTime + thinkTime
    });
  });

  describe('burst traffic pattern', () => {
    it('schedules all work units at atTime', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'burst', count: 5, atTime: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0 });

      const events = client.generateInitialEvents(ctx);
      expect(events.length).toBe(5);
      for (const e of events) {
        expect(e.timestamp).toBe(10);
        expect(e.targetComponentId).toBe('client-1');
      }
    });
  });

  describe('ramping traffic pattern', () => {
    it('generates initial arrival event', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'ramping', startRate: 1, endRate: 10, duration: 100 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      const events = client.generateInitialEvents(ctx);
      expect(events.length).toBe(1);
      expect(events[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe('retry strategy: none', () => {
    it('does not retry failed work units', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
        timeout: 0,
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      // Send a work unit through the client to register it
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const sent = client.handleEvent(selfArrival, ctx);
      const sentWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Send failure response
      const departure = createDepartureEvent('client-1', sentWu, true, 1);
      const events = client.handleEvent(departure, createMockContext({ currentTime: 1 }));

      // No retry events
      expect(events.filter(e => e.targetComponentId === 'server-1').length).toBe(0);
    });
  });

  describe('retry strategy: fixed-n', () => {
    it('retries up to maxRetries times', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'fixed-n', maxRetries: 2 },
        targetComponentId: 'server-1',
        timeout: 0,
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      // Send a work unit through the client to register it
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const sent = client.handleEvent(selfArrival, ctx);
      const sentWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // First failure → retry (retryCount becomes 1)
      const dep1 = createDepartureEvent('client-1', sentWu, true, 1);
      const events1 = client.handleEvent(dep1, createMockContext({ currentTime: 1 }));
      expect(events1.length).toBe(1);
      expect(events1[0].targetComponentId).toBe('server-1');
      expect(events1[0].workUnit.retryCount).toBe(1);

      // Second failure → retry (retryCount becomes 2)
      const dep2 = createDepartureEvent('client-1', events1[0].workUnit, true, 2);
      const events2 = client.handleEvent(dep2, createMockContext({ currentTime: 2 }));
      expect(events2.length).toBe(1);
      expect(events2[0].workUnit.retryCount).toBe(2);

      // Third failure → no retry (at maxRetries)
      const dep3 = createDepartureEvent('client-1', events2[0].workUnit, true, 3);
      const events3 = client.handleEvent(dep3, createMockContext({ currentTime: 3 }));
      expect(events3.filter(e => e.targetComponentId === 'server-1').length).toBe(0);
    });
  });

  describe('retry strategy: token-bucket', () => {
    it('consumes tokens on retry and deposits on success', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'token-bucket', capacity: 2, depositAmount: 0.5 },
        targetComponentId: 'server-1',
        timeout: 0,
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      // Initial tokens = capacity = 2
      expect(client.getMetrics().tokenBucketTokens).toBe(2);

      // Send a work unit through the client to register it
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const sent = client.handleEvent(selfArrival, ctx);
      const sentWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Failure → retry, tokens = 1
      const dep1 = createDepartureEvent('client-1', sentWu, true, 1);
      const events1 = client.handleEvent(dep1, createMockContext({ currentTime: 1 }));
      expect(events1.length).toBe(1);
      expect(client.getMetrics().tokenBucketTokens).toBe(1);

      // Another failure → retry, tokens = 0
      const dep2 = createDepartureEvent('client-1', events1[0].workUnit, true, 2);
      const events2 = client.handleEvent(dep2, createMockContext({ currentTime: 2 }));
      expect(events2.length).toBe(1);
      expect(client.getMetrics().tokenBucketTokens).toBe(0);

      // Another failure → no retry (no tokens)
      const dep3 = createDepartureEvent('client-1', events2[0].workUnit, true, 3);
      const events3 = client.handleEvent(dep3, createMockContext({ currentTime: 3 }));
      expect(events3.filter(e => e.targetComponentId === 'server-1').length).toBe(0);

      // Send another work unit for the success case
      const selfArrival2: SimEvent = {
        id: 'ev-2', timestamp: 3.5, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 3.5), kind: 'arrival',
      };
      const sent2 = client.handleEvent(selfArrival2, createMockContext({ currentTime: 3.5, random: () => 0.5 }));
      const sentWu2 = sent2.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Success → deposit 0.5 tokens
      const depSuccess = createDepartureEvent('client-1', sentWu2, false, 4);
      client.handleEvent(depSuccess, createMockContext({ currentTime: 4 }));
      expect(client.getMetrics().tokenBucketTokens).toBe(0.5);
    });
  });

  describe('retry strategy: circuit-breaker', () => {
    it('opens circuit when failure rate exceeds threshold', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'circuit-breaker', windowSize: 10, failureThreshold: 0.5, maxRetries: 10 },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);

      // Record failures to push failure rate above threshold
      const wu1 = createWorkUnit('client-1', 0);
      const dep1 = createDepartureEvent('client-1', wu1, true, 1);
      const events1 = client.handleEvent(dep1, createMockContext({ currentTime: 1 }));
      // First failure: window has 1 failure / 1 total = 100% > 50%, but the failure
      // was just recorded, so the retry check sees it. Let's verify:
      // After recording the failure, failureRate = 1/1 = 1.0 >= 0.5 → circuit open → no retry
      expect(events1.filter(e => e.targetComponentId === 'server-1').length).toBe(0);
    });

    it('closes circuit when failure rate drops below threshold', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'circuit-breaker', windowSize: 10, failureThreshold: 0.6, maxRetries: 10 },
        targetComponentId: 'server-1',
        timeout: 0,
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0, random: () => 0.5 });

      // Send first work unit through client, get a success response
      const selfArrival1: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const sent1 = client.handleEvent(selfArrival1, ctx);
      const sentWu1 = sent1.find(e => e.targetComponentId === 'server-1')!.workUnit;

      const depSuccess = createDepartureEvent('client-1', sentWu1, false, 0.5);
      client.handleEvent(depSuccess, createMockContext({ currentTime: 0.5 }));

      // Send second work unit, get a failure response
      const selfArrival2: SimEvent = {
        id: 'ev-2', timestamp: 0.6, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0.6), kind: 'arrival',
      };
      const sent2 = client.handleEvent(selfArrival2, createMockContext({ currentTime: 0.6, random: () => 0.5 }));
      const sentWu2 = sent2.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Failure: window has 1 success + 1 failure = 50% < 60% → circuit closed → retry
      const dep = createDepartureEvent('client-1', sentWu2, true, 1);
      const events = client.handleEvent(dep, createMockContext({ currentTime: 1 }));
      expect(events.filter(e => e.targetComponentId === 'server-1').length).toBe(1);
    });
  });

  describe('latency recording', () => {
    it('records end-to-end latency on successful completion', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
        timeout: 0,
      };
      const client = new Client('client-1', config);

      // Send a work unit through the client first to register it
      const sendCtx = createMockContext({ currentTime: 2, random: () => 0.5 });
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 2, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 2), kind: 'arrival',
      };
      const sent = client.handleEvent(selfArrival, sendCtx);
      const sentWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;

      // Now send the response back
      const recordedMetrics: { name: string; value: number }[] = [];
      const responseCtx = createMockContext({
        currentTime: 5,
        recordMetric: (_cid, name, value, _time) => {
          recordedMetrics.push({ name, value });
        },
      });

      const departure = createDepartureEvent('client-1', sentWu, false, 5);
      client.handleEvent(departure, responseCtx);

      expect(recordedMetrics.length).toBe(1);
      expect(recordedMetrics[0].name).toBe('latency');
      expect(recordedMetrics[0].value).toBe(3); // 5 - 2
    });
  });

  describe('timeout and retry correctness', () => {
    it('does not double-count when stale response arrives after timeout+retry', () => {
      // Regression: with old code, retries reused the same work unit ID.
      // A stale response from the original request would be processed alongside
      // the retry's response, causing inFlightCount to drift negative.
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'fixed-n', maxRetries: 3 },
        targetComponentId: 'server-1',
        timeout: 1.0,
      };
      const client = new Client('client-1', config);
      const scheduledEvents: SimEvent[] = [];
      const ctx = createMockContext({
        currentTime: 0,
        random: () => 0.5,
        scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
      });

      // Step 1: Client sends work unit X
      const selfArrival: SimEvent = {
        id: 'ev-1', timestamp: 0, targetComponentId: 'client-1',
        workUnit: createWorkUnit('client-1', 0), kind: 'arrival',
      };
      const sent = client.handleEvent(selfArrival, ctx);
      const originalWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;
      expect(client.getMetrics().inFlightCount).toBe(1);

      // Step 2: Timeout fires for original work unit
      const timeoutEvent: SimEvent = {
        id: 'timeout-1', timestamp: 1.0, targetComponentId: 'client-1',
        workUnit: { ...originalWu }, kind: 'timeout',
      };
      scheduledEvents.length = 0;
      const timeoutResult = client.handleEvent(timeoutEvent, createMockContext({
        currentTime: 1.0,
        scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
      }));

      // Should produce a retry with a NEW work unit ID
      const retryEvent = timeoutResult.find(e => e.targetComponentId === 'server-1');
      expect(retryEvent).toBeDefined();
      expect(retryEvent!.workUnit.id).not.toBe(originalWu.id);
      expect(retryEvent!.workUnit.retryCount).toBe(1);

      // Step 3: Stale response from original request arrives
      const staleResponse = createDepartureEvent('client-1', originalWu, false, 1.5);
      const staleResult = client.handleEvent(staleResponse, createMockContext({ currentTime: 1.5 }));

      // Should be silently dropped (original ID is no longer pending)
      expect(staleResult.length).toBe(0);

      // Step 4: Retry's response arrives
      const retryResponse = createDepartureEvent('client-1', retryEvent!.workUnit, false, 2.0);
      const retryResult = client.handleEvent(retryResponse, createMockContext({ currentTime: 2.0 }));

      // inFlightCount should be exactly 0, not negative
      expect(client.getMetrics().inFlightCount).toBe(0);
      // completedCount should be 1, not 2
      expect(client.getMetrics().completedCount).toBe(1);
      // The stale response should not have generated any events
      expect(staleResult.length).toBe(0);
      // The retry response may generate a next self-arrival (open-loop doesn't)
      expect(retryResult.length).toBe(0);
    });

    it('prunes resolvedWorkUnits when timeout fires for already-completed work', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
        timeout: 2.0,
      };
      const client = new Client('client-1', config);
      const scheduledEvents: SimEvent[] = [];

      // Send many work units, complete them, then let timeouts fire
      for (let i = 0; i < 100; i++) {
        const selfArrival: SimEvent = {
          id: `ev-${i}`, timestamp: i * 0.01, targetComponentId: 'client-1',
          workUnit: createWorkUnit('client-1', i * 0.01), kind: 'arrival',
        };
        const sent = client.handleEvent(selfArrival, createMockContext({
          currentTime: i * 0.01,
          random: () => 0.5,
          scheduleEvent: (e: SimEvent) => scheduledEvents.push(e),
        }));
        const sentWu = sent.find(e => e.targetComponentId === 'server-1')!.workUnit;

        // Complete immediately
        const dep = createDepartureEvent('client-1', sentWu, false, i * 0.01 + 0.001);
        client.handleEvent(dep, createMockContext({ currentTime: i * 0.01 + 0.001 }));
      }

      // Now fire all the timeout events — each should prune its entry
      const timeoutEvents = scheduledEvents.filter(e => e.kind === 'timeout');
      expect(timeoutEvents.length).toBe(100);

      for (const te of timeoutEvents) {
        client.handleEvent(te, createMockContext({ currentTime: te.timestamp }));
      }

      // After all timeouts fired, metrics should be clean
      expect(client.getMetrics().completedCount).toBe(100);
      expect(client.getMetrics().inFlightCount).toBe(0);
    });

    it('drops responses for work units the client never sent', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);

      // Send a departure for a work unit the client never created
      const unknownWu = createWorkUnit('client-1', 0);
      const dep = createDepartureEvent('client-1', unknownWu, false, 1);
      const events = client.handleEvent(dep, createMockContext({ currentTime: 1 }));

      expect(events.length).toBe(0);
      expect(client.getMetrics().completedCount).toBe(0);
      expect(client.getMetrics().inFlightCount).toBe(0);
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      const config: ClientConfig = {
        trafficPattern: { type: 'closed-loop', thinkTime: 0.1, maxConcurrency: 2 },
        retryStrategy: { type: 'token-bucket', capacity: 5, depositAmount: 0.1 },
        targetComponentId: 'server-1',
      };
      const client = new Client('client-1', config);
      const ctx = createMockContext({ currentTime: 0 });

      // Generate some traffic to change state
      client.generateInitialEvents(ctx);

      // Reset
      client.reset();

      const metrics = client.getMetrics();
      expect(metrics.completedCount).toBe(0);
      expect(metrics.failedCount).toBe(0);
      expect(metrics.retriedCount).toBe(0);
      expect(metrics.inFlightCount).toBe(0);
      expect(metrics.tokenBucketTokens).toBe(5); // reset to capacity
    });
  });
});
