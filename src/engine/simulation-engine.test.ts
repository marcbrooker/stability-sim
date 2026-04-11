import { describe, it, expect, vi } from 'vitest';
import { SimulationEngine } from './simulation-engine';
import { FailureInjector } from './failure-injector';
import type { SimComponent, SimContext, ComponentConfig } from '../types/components';
import type { SimEvent, WorkUnit } from '../types/events';
import type { ConnectionDefinition, SimulationConfig } from '../types/models';
import type { FailureScenario } from '../types/failures';

// --- Helpers ---

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'wu-1',
    originClientId: 'client-1',
    createdAt: 0,
    key: 'k',
    isRead: true,
    retryCount: 0,
    metadata: {},
    ...overrides,
  };
}

function makeEvent(overrides: Partial<SimEvent> = {}): SimEvent {
  return {
    id: 'evt-1',
    timestamp: 1,
    targetComponentId: 'comp-a',
    workUnit: makeWorkUnit(),
    kind: 'arrival',
    ...overrides,
  };
}

const defaultConfig: SimulationConfig = {
  schemaVersion: 1,
  name: 'test',
  endTime: 1000,
  metricsWindowSize: 100,
  failureScenarios: [],
  seed: 42,
};

/** A stub component that records calls and optionally returns new events */
function makeStubComponent(
  id: string,
  returnEvents: SimEvent[] = [],
): SimComponent {
  return {
    id,
    type: 'server',
    config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
    handleEvent: vi.fn().mockReturnValue(returnEvents),
    getMetrics: vi.fn().mockReturnValue({}),
    reset: vi.fn(),
  };
}

// --- Tests ---

describe('SimulationEngine', () => {
  it('starts in idle status', () => {
    const engine = new SimulationEngine([], [], defaultConfig);
    expect(engine.status).toBe('idle');
    expect(engine.currentTime).toBe(0);
  });

  it('completes immediately when queue is empty (Req 1.3)', () => {
    const engine = new SimulationEngine([], [], defaultConfig);
    engine.run();
    expect(engine.status).toBe('completed');
  });

  it('step() processes exactly one event (Req 12.3)', () => {
    const comp = makeStubComponent('comp-a');
    const engine = new SimulationEngine([comp], [], defaultConfig);

    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 10 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 20 }));

    const done = engine.step();
    expect(done).toBe(false);
    expect(engine.status).toBe('paused');
    expect(engine.currentTime).toBe(10);
    expect(comp.handleEvent).toHaveBeenCalledTimes(1);
  });

  it('pause() preserves state (Req 12.2)', () => {
    const comp = makeStubComponent('comp-a');
    const engine = new SimulationEngine([comp], [], defaultConfig);

    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 5 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 15 }));
    engine.scheduleEvent(makeEvent({ id: 'e3', timestamp: 25 }));

    // Step once, then pause
    engine.step();
    expect(engine.currentTime).toBe(5);

    engine.pause();
    expect(engine.status).toBe('paused');
    // Queue should still have 2 events
    expect(engine.queueSize).toBe(2);
  });

  it('reset() restores initial state (Req 12.5)', () => {
    const comp = makeStubComponent('comp-a');
    const engine = new SimulationEngine([comp], [], defaultConfig);

    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 10 }));
    engine.step();
    expect(engine.currentTime).toBe(10);

    engine.reset();
    expect(engine.status).toBe('idle');
    expect(engine.currentTime).toBe(0);
    expect(engine.queueSize).toBe(0);
    expect(comp.reset).toHaveBeenCalled();
  });

  it('terminates when endTime is reached (Req 1.5)', () => {
    const config = { ...defaultConfig, endTime: 50 };
    const comp = makeStubComponent('comp-a');
    const engine = new SimulationEngine([comp], [], config);

    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 10 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 30 }));
    engine.scheduleEvent(makeEvent({ id: 'e3', timestamp: 60 })); // beyond endTime

    engine.run();
    expect(engine.status).toBe('completed');
    // Should have processed events at t=10 and t=30, but not t=60
    expect(comp.handleEvent).toHaveBeenCalledTimes(2);
    expect(engine.currentTime).toBe(30);
  });

  it('processes events in timestamp order (Req 1.1)', () => {
    const timestamps: number[] = [];
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(event: SimEvent) {
        timestamps.push(event.timestamp);
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);

    // Insert out of order
    engine.scheduleEvent(makeEvent({ id: 'e3', timestamp: 30 }));
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 10 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 20 }));

    engine.run();
    expect(timestamps).toEqual([10, 20, 30]);
  });

  it('inserts new events returned by components (Req 1.2)', () => {
    const processed: string[] = [];

    const childEvent = makeEvent({ id: 'child', timestamp: 15, targetComponentId: 'comp-a' });
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(event: SimEvent) {
        processed.push(event.id);
        if (event.id === 'root') {
          return [childEvent];
        }
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'root', timestamp: 10 }));

    engine.run();
    expect(processed).toEqual(['root', 'child']);
  });

  it('clock is monotonically non-decreasing (Req 1.4)', () => {
    const clockValues: number[] = [];
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(_event: SimEvent, context: SimContext) {
        clockValues.push(context.currentTime);
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 5 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 5 })); // same timestamp
    engine.scheduleEvent(makeEvent({ id: 'e3', timestamp: 10 }));

    engine.run();
    for (let i = 1; i < clockValues.length; i++) {
      expect(clockValues[i]).toBeGreaterThanOrEqual(clockValues[i - 1]);
    }
  });

  it('setSpeed() stores the speed multiplier (Req 12.4)', () => {
    const engine = new SimulationEngine([], [], defaultConfig);
    expect(engine.speedMultiplier).toBe(1);
    engine.setSpeed(5);
    expect(engine.speedMultiplier).toBe(5);
  });

  it('SimContext provides getDownstream from connection map', () => {
    const connections: ConnectionDefinition[] = [
      { id: 'c1', sourceId: 'comp-a', targetId: 'comp-b' },
      { id: 'c2', sourceId: 'comp-a', targetId: 'comp-c' },
    ];

    let capturedDownstream: string[] = [];
    const compA: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(_event: SimEvent, context: SimContext) {
        capturedDownstream = context.getDownstream('comp-a');
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };
    const compB = makeStubComponent('comp-b');
    const compC = makeStubComponent('comp-c');

    const engine = new SimulationEngine([compA, compB, compC], connections, defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 1 }));
    engine.step();

    expect(capturedDownstream).toEqual(['comp-b', 'comp-c']);
  });

  it('SimContext.getComponent throws for unknown id', () => {
    let threwError = false;
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(_event: SimEvent, context: SimContext) {
        try {
          context.getComponent('nonexistent');
        } catch {
          threwError = true;
        }
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 1 }));
    engine.step();
    expect(threwError).toBe(true);
  });

  it('SimContext.recordMetric delegates to MetricCollector', () => {
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(_event: SimEvent, context: SimContext) {
        context.recordMetric('comp-a', 'throughput', 42, context.currentTime);
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 5 }));
    engine.step();

    const series = engine.getMetrics().getTimeSeries('comp-a', 'throughput');
    expect(series).toEqual([{ time: 5, value: 42 }]);
  });

  it('SimContext.random() returns deterministic values from seeded PRNG', () => {
    const values: number[] = [];
    const comp: SimComponent = {
      id: 'comp-a',
      type: 'server',
      config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
      handleEvent(_event: SimEvent, context: SimContext) {
        values.push(context.random());
        return [];
      },
      getMetrics: () => ({}),
      reset: () => {},
    };

    const engine = new SimulationEngine([comp], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 1 }));
    engine.scheduleEvent(makeEvent({ id: 'e2', timestamp: 2 }));
    engine.run();

    // Run again with reset — should produce same values
    engine.reset();
    const values2: number[] = [];
    const comp2: SimComponent = {
      ...comp,
      handleEvent(_event: SimEvent, context: SimContext) {
        values2.push(context.random());
        return [];
      },
    };
    // Re-create engine with same seed to verify determinism
    const engine2 = new SimulationEngine([comp2], [], defaultConfig);
    engine2.scheduleEvent(makeEvent({ id: 'e1', timestamp: 1 }));
    engine2.scheduleEvent(makeEvent({ id: 'e2', timestamp: 2 }));
    engine2.run();

    expect(values).toEqual(values2);
  });

  it('skips events targeting unknown components', () => {
    const engine = new SimulationEngine([], [], defaultConfig);
    engine.scheduleEvent(makeEvent({ id: 'e1', timestamp: 1, targetComponentId: 'nonexistent' }));
    engine.run();
    expect(engine.status).toBe('completed');
  });

  it('run() does nothing when already completed', () => {
    const engine = new SimulationEngine([], [], defaultConfig);
    engine.run(); // completes (empty queue)
    expect(engine.status).toBe('completed');
    engine.run(); // should be a no-op
    expect(engine.status).toBe('completed');
  });

  describe('network partition enforcement', () => {
    it('drops events traversing a partitioned connection (forward direction)', () => {
      // Regression: network-partition failures previously had no effect because
      // isConnectionDisabled() was never checked during event dispatch.
      const processedAtB: SimEvent[] = [];

      const compA: SimComponent = {
        id: 'comp-a',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(_event: SimEvent, context: SimContext) {
          // comp-a forwards an arrival to comp-b
          return [{
            id: 'forwarded-1',
            timestamp: context.currentTime,
            targetComponentId: 'comp-b',
            workUnit: _event.workUnit,
            kind: 'arrival' as const,
          }];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const compB: SimComponent = {
        id: 'comp-b',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(event: SimEvent) {
          processedAtB.push(event);
          return [];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const connections: ConnectionDefinition[] = [
        { id: 'conn-ab', sourceId: 'comp-a', targetId: 'comp-b' },
      ];

      const engine = new SimulationEngine([compA, compB], connections, defaultConfig);

      // Set up failure injector with a network partition
      const injector = new FailureInjector();
      engine.setFailureInjector(injector);

      const scenario: FailureScenario = {
        type: 'network-partition',
        connectionId: 'conn-ab',
        triggerTime: 0,
        duration: 50,
      };
      injector.scheduleFailures([scenario], (e) => engine.scheduleEvent(e));

      // Schedule an arrival at comp-a at t=5 (during partition)
      engine.scheduleEvent(makeEvent({ id: 'trigger', timestamp: 5, targetComponentId: 'comp-a' }));

      engine.run();

      // comp-a was dispatched but its forwarded event to comp-b was dropped
      expect(processedAtB.length).toBe(0);
    });

    it('drops events traversing a partitioned connection (reverse direction)', () => {
      const processedAtA: SimEvent[] = [];

      const compA: SimComponent = {
        id: 'comp-a',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(event: SimEvent) {
          processedAtA.push(event);
          return [];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      // comp-b sends a departure back to comp-a (reverse direction of the connection)
      const compB: SimComponent = {
        id: 'comp-b',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(_event: SimEvent, context: SimContext) {
          return [{
            id: 'response-1',
            timestamp: context.currentTime,
            targetComponentId: 'comp-a',
            workUnit: _event.workUnit,
            kind: 'departure' as const,
          }];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const connections: ConnectionDefinition[] = [
        { id: 'conn-ab', sourceId: 'comp-a', targetId: 'comp-b' },
      ];

      const engine = new SimulationEngine([compA, compB], connections, defaultConfig);
      const injector = new FailureInjector();
      engine.setFailureInjector(injector);

      injector.scheduleFailures([{
        type: 'network-partition',
        connectionId: 'conn-ab',
        triggerTime: 0,
        duration: 50,
      }], (e) => engine.scheduleEvent(e));

      // Send arrival to comp-b at t=5 — it will try to respond to comp-a
      engine.scheduleEvent(makeEvent({ id: 'trigger', timestamp: 5, targetComponentId: 'comp-b' }));

      engine.run();

      // comp-b's response to comp-a should be dropped (reverse direction also blocked)
      expect(processedAtA.length).toBe(0);
    });

    it('allows traffic after partition recovery', () => {
      const processedAtB: SimEvent[] = [];

      const compA: SimComponent = {
        id: 'comp-a',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(_event: SimEvent, context: SimContext) {
          return [{
            id: `fwd-${_event.id}`,
            timestamp: context.currentTime,
            targetComponentId: 'comp-b',
            workUnit: _event.workUnit,
            kind: 'arrival' as const,
          }];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const compB: SimComponent = {
        id: 'comp-b',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(event: SimEvent) {
          processedAtB.push(event);
          return [];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const connections: ConnectionDefinition[] = [
        { id: 'conn-ab', sourceId: 'comp-a', targetId: 'comp-b' },
      ];

      const engine = new SimulationEngine([compA, compB], connections, defaultConfig);
      const injector = new FailureInjector();
      engine.setFailureInjector(injector);

      // Partition from t=0 to t=10
      injector.scheduleFailures([{
        type: 'network-partition',
        connectionId: 'conn-ab',
        triggerTime: 0,
        duration: 10,
      }], (e) => engine.scheduleEvent(e));

      // Event during partition (should be dropped)
      engine.scheduleEvent(makeEvent({ id: 'during', timestamp: 5, targetComponentId: 'comp-a' }));
      // Event after recovery (should get through)
      engine.scheduleEvent(makeEvent({ id: 'after', timestamp: 15, targetComponentId: 'comp-a' }));

      engine.run();

      // Only the post-recovery event should reach comp-b
      expect(processedAtB.length).toBe(1);
    });

    it('does not affect self-targeted events during partition', () => {
      let selfEventCount = 0;

      const compA: SimComponent = {
        id: 'comp-a',
        type: 'server',
        config: { type: 'server', serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 }, concurrencyLimit: 10 } as ComponentConfig,
        handleEvent(_event: SimEvent, context: SimContext) {
          selfEventCount++;
          if (_event.id === 'trigger') {
            // Schedule a self-targeted event
            return [{
              id: 'self-event',
              timestamp: context.currentTime + 1,
              targetComponentId: 'comp-a',
              workUnit: _event.workUnit,
              kind: 'departure' as const,
            }];
          }
          return [];
        },
        getMetrics: () => ({}),
        reset: () => {},
      };

      const compB = makeStubComponent('comp-b');
      const connections: ConnectionDefinition[] = [
        { id: 'conn-ab', sourceId: 'comp-a', targetId: 'comp-b' },
      ];

      const engine = new SimulationEngine([compA, compB], connections, defaultConfig);
      const injector = new FailureInjector();
      engine.setFailureInjector(injector);

      injector.scheduleFailures([{
        type: 'network-partition',
        connectionId: 'conn-ab',
        triggerTime: 0,
        duration: 50,
      }], (e) => engine.scheduleEvent(e));

      engine.scheduleEvent(makeEvent({ id: 'trigger', timestamp: 5, targetComponentId: 'comp-a' }));
      engine.run();

      // Both the trigger and self-event should be processed
      expect(selfEventCount).toBe(2);
    });
  });
});
