import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { serialize, parse } from './architecture-serializer';
import type { Architecture } from '../types/models';
import type { ComponentConfig } from '../types/components';

/**
 * Property-based tests for Architecture serialization round-trip.
 *
 * **Validates: Requirements 13.4**
 */

const componentTypeArb = fc.constantFrom(
  'client' as const,
  'server' as const,
  'database' as const,
  'cache' as const,
  'load-balancer' as const,
  'queue' as const,
);

const distributionArb = fc.oneof(
  fc.record({
    type: fc.constant('uniform' as const),
    min: fc.double({ min: 0, max: 100, noNaN: true }),
    max: fc.double({ min: 100, max: 1000, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('exponential' as const),
    mean: fc.double({ min: 0.01, max: 1000, noNaN: true }),
  }),
  fc.record({
    type: fc.constant('log-normal' as const),
    mu: fc.double({ min: -10, max: 10, noNaN: true }),
    sigma: fc.double({ min: 0.01, max: 5, noNaN: true }),
  }),
);

const loadDependentLatencyArb = fc.oneof(
  fc.record({
    mode: fc.constant('linear' as const),
    factor: fc.double({ min: 0, max: 10, noNaN: true }),
  }),
  fc.record({
    mode: fc.constant('polynomial' as const),
    factor: fc.double({ min: 0, max: 10, noNaN: true }),
    exponent: fc.double({ min: 1, max: 5, noNaN: true }),
  }),
  fc.record({
    mode: fc.constant('exponential' as const),
    factor: fc.double({ min: 0, max: 10, noNaN: true }),
  }),
);

const componentConfigArb: fc.Arbitrary<ComponentConfig> = fc.oneof(
  fc.record({
    type: fc.constant('client' as const),
    trafficPattern: fc.oneof(
      fc.record({ type: fc.constant('open-loop' as const), meanArrivalRate: fc.double({ min: 0.1, max: 1000, noNaN: true }) }),
      fc.record({ type: fc.constant('closed-loop' as const), thinkTime: fc.double({ min: 0, max: 100, noNaN: true }), maxConcurrency: fc.integer({ min: 1, max: 100 }) }),
      fc.record({ type: fc.constant('ramping' as const), startRate: fc.double({ min: 0.1, max: 500, noNaN: true }), endRate: fc.double({ min: 0.1, max: 500, noNaN: true }), duration: fc.double({ min: 1, max: 10000, noNaN: true }) }),
      fc.record({ type: fc.constant('burst' as const), count: fc.integer({ min: 1, max: 1000 }), atTime: fc.double({ min: 0, max: 10000, noNaN: true }) }),
    ),
    retryStrategy: fc.oneof(
      fc.record({ type: fc.constant('none' as const) }),
      fc.record({ type: fc.constant('fixed-n' as const), maxRetries: fc.integer({ min: 0, max: 10 }) }),
      fc.record({ type: fc.constant('token-bucket' as const), capacity: fc.integer({ min: 1, max: 100 }), depositAmount: fc.double({ min: 0.01, max: 1, noNaN: true }) }),
      fc.record({ type: fc.constant('circuit-breaker' as const), windowSize: fc.integer({ min: 1, max: 100 }), failureThreshold: fc.double({ min: 0.01, max: 1, noNaN: true }), maxRetries: fc.integer({ min: 1, max: 10 }) }),
    ),
    targetComponentId: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    type: fc.constant('server' as const),
    serviceTimeDistribution: distributionArb,
    concurrencyLimit: fc.integer({ min: 1, max: 100 }),
    loadDependentLatency: fc.option(loadDependentLatencyArb, { nil: undefined }),
    maxQueueSize: fc.option(fc.integer({ min: 1, max: 1000 }), { nil: undefined }),
  }),
  fc.record({
    type: fc.constant('database' as const),
    readLatencyDistribution: distributionArb,
    writeLatencyDistribution: distributionArb,
    connectionPoolSize: fc.integer({ min: 1, max: 100 }),
    loadDependentLatency: fc.option(loadDependentLatencyArb, { nil: undefined }),
  }),
  fc.record({
    type: fc.constant('cache' as const),
    hitRate: fc.double({ min: 0, max: 1, noNaN: true }),
    downstreamComponentId: fc.string({ minLength: 1, maxLength: 20 }),
  }),
  fc.record({
    type: fc.constant('load-balancer' as const),
    strategy: fc.constantFrom('round-robin' as const, 'random' as const, 'least-connections' as const),
  }),
  fc.record({
    type: fc.constant('queue' as const),
    maxCapacity: fc.integer({ min: 1, max: 10000 }),
    loadSheddingThreshold: fc.option(fc.integer({ min: 1, max: 10000 }), { nil: undefined }),
  }),
);

const componentDefArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  type: componentTypeArb,
  label: fc.string({ minLength: 1, maxLength: 50 }),
  position: fc.record({
    x: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }).map(v => Object.is(v, -0) ? 0 : v),
    y: fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }).map(v => Object.is(v, -0) ? 0 : v),
  }),
  config: componentConfigArb,
});

const connectionDefArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 20 }),
  sourceId: fc.string({ minLength: 1, maxLength: 20 }),
  targetId: fc.string({ minLength: 1, maxLength: 20 }),
});

const architectureArb: fc.Arbitrary<Architecture> = fc.record({
  schemaVersion: fc.constant(1),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  components: fc.array(componentDefArb, { minLength: 0, maxLength: 5 }),
  connections: fc.array(connectionDefArb, { minLength: 0, maxLength: 5 }),
});

describe('Architecture serializer property tests', () => {
  /**
   * Property 7: serialize then parse produces an Architecture equivalent to the original.
   *
   * **Validates: Requirements 13.4**
   */
  it('round-trip: serialize then parse produces equivalent Architecture', () => {
    fc.assert(
      fc.property(architectureArb, (arch) => {
        const json = serialize(arch);
        const parsed = parse(json);
        // Normalize: JSON round-trip drops undefined fields and converts -0 to 0
        const normalized = JSON.parse(JSON.stringify(arch));
        expect(parsed).toEqual(normalized);
      }),
      { numRuns: 200 },
    );
  });
});
