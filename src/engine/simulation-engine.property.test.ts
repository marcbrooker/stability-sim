import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { SimulationEngine } from './simulation-engine';
import type { SimComponent, SimContext, ComponentConfig } from '../types/components';
import type { SimEvent, WorkUnit } from '../types/events';
import type { SimulationConfig } from '../types/models';

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

/**
 * Create a stub component that records context.currentTime at each handleEvent call.
 */
function makeStubComponent(id: string, recordedTimes: number[]): SimComponent {
  return {
    id,
    type: 'server',
    config: {
      type: 'server',
      serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 },
      concurrencyLimit: 10,
    } as ComponentConfig,
    handleEvent(_event: SimEvent, context: SimContext): SimEvent[] {
      recordedTimes.push(context.currentTime);
      return [];
    },
    getMetrics: () => ({}),
    reset: () => {},
  };
}

/**
 * Property-based tests for SimulationEngine clock monotonicity.
 *
 * **Validates: Requirements 1.4**
 */
describe('SimulationEngine property tests', () => {
  /**
   * Property 5: Simulation clock is monotonically non-decreasing across all processed events.
   *
   * For any random list of event timestamps (positive numbers), scheduling them all
   * and running the engine must produce context.currentTime values observed by the
   * component in non-decreasing order.
   *
   * **Validates: Requirements 1.4**
   */
  it('simulation clock is monotonically non-decreasing across all processed events', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.double({ min: 0.001, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1, maxLength: 200 },
        ),
        (timestamps) => {
          const recordedTimes: number[] = [];
          const comp = makeStubComponent('comp-a', recordedTimes);

          const config: SimulationConfig = {
            schemaVersion: 1,
            name: 'prop-test',
            endTime: 1e7, // high endTime to not interfere
            metricsWindowSize: 100,
            failureScenarios: [],
            seed: 42,
          };

          const engine = new SimulationEngine([comp], [], config);

          // Schedule events with the generated timestamps
          for (let i = 0; i < timestamps.length; i++) {
            engine.scheduleEvent(
              makeEvent({
                id: `evt-${i}`,
                timestamp: timestamps[i],
                targetComponentId: 'comp-a',
              }),
            );
          }

          engine.run();

          // All events should have been processed
          expect(recordedTimes.length).toBe(timestamps.length);

          // Assert monotonically non-decreasing
          for (let i = 1; i < recordedTimes.length; i++) {
            expect(recordedTimes[i]).toBeGreaterThanOrEqual(recordedTimes[i - 1]);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
