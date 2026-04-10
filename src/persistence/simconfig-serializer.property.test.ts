import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { serialize, parse } from './simconfig-serializer';
import type { SimulationConfig } from '../types/models';
import type { FailureScenario } from '../types/failures';

/**
 * Property-based tests for SimulationConfig serialization round-trip.
 *
 * **Validates: Requirements 14.4**
 */

const failureScenarioArb: fc.Arbitrary<FailureScenario> = fc.oneof(
  fc.record({
    type: fc.constant('server-crash' as const),
    targetId: fc.string({ minLength: 1, maxLength: 20 }),
    triggerTime: fc.double({ min: 0, max: 10000, noNaN: true }),
    recoveryTime: fc.double({ min: 0, max: 10000, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('latency-spike' as const),
    targetId: fc.string({ minLength: 1, maxLength: 20 }),
    triggerTime: fc.double({ min: 0, max: 10000, noNaN: true }),
    duration: fc.double({ min: 0.1, max: 5000, noNaN: true }),
    factor: fc.double({ min: 1, max: 100, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('cpu-reduction' as const),
    targetId: fc.string({ minLength: 1, maxLength: 20 }),
    triggerTime: fc.double({ min: 0, max: 10000, noNaN: true }),
    duration: fc.double({ min: 0.1, max: 5000, noNaN: true }),
    reductionPercent: fc.double({ min: 1, max: 100, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('network-partition' as const),
    connectionId: fc.string({ minLength: 1, maxLength: 20 }),
    triggerTime: fc.double({ min: 0, max: 10000, noNaN: true }),
    duration: fc.double({ min: 0.1, max: 5000, noNaN: true }),
  }),
);

const simulationConfigArb: fc.Arbitrary<SimulationConfig> = fc.record({
  schemaVersion: fc.constant(1),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  endTime: fc.double({ min: 1, max: 100000, noNaN: true }),
  metricsWindowSize: fc.double({ min: 0.1, max: 1000, noNaN: true }),
  failureScenarios: fc.array(failureScenarioArb, { minLength: 0, maxLength: 5 }),
  seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
});

describe('SimulationConfig serializer property tests', () => {
  /**
   * Property 8: serialize then parse produces a SimulationConfig equivalent to the original.
   *
   * **Validates: Requirements 14.4**
   */
  it('round-trip: serialize then parse produces equivalent SimulationConfig', () => {
    fc.assert(
      fc.property(simulationConfigArb, (config) => {
        const json = serialize(config);
        const parsed = parse(json);
        expect(parsed).toEqual(config);
      }),
      { numRuns: 200 },
    );
  });
});
