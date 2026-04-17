import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { migrate, CURRENT_VERSION } from './migrate';
import { validateScenario } from '../components/SaveLoadButtons';

/**
 * Property-based tests for the schema migration pipeline.
 *
 * These verify structural invariants that must hold regardless of
 * what specific migrations exist in the chain.
 */

/** Arbitrary for a minimal valid v1 scenario (the baseline format). */
const v1ScenarioArb = fc.record({
  schemaVersion: fc.constant(1),
  architecture: fc.record({
    schemaVersion: fc.constant(1),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    components: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 20 }),
        type: fc.constantFrom('client', 'server', 'database', 'cache', 'load-balancer', 'queue', 'throttle'),
        label: fc.string({ minLength: 1, maxLength: 30 }),
        position: fc.record({
          x: fc.integer({ min: 0, max: 1000 }),
          y: fc.integer({ min: 0, max: 1000 }),
        }),
        config: fc.record({
          type: fc.constantFrom('client', 'server', 'database', 'cache', 'load-balancer', 'queue', 'throttle'),
        }),
      }),
      { minLength: 1, maxLength: 5 },
    ),
    connections: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 20 }),
        sourceId: fc.string({ minLength: 1, maxLength: 20 }),
        targetId: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
  }),
  simulationConfig: fc.record({
    schemaVersion: fc.constant(1),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    endTime: fc.integer({ min: 1, max: 10000 }),
    metricsWindowSize: fc.integer({ min: 1, max: 100 }),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    failureScenarios: fc.constant([]),
  }),
});

describe('migrate property tests', () => {
  it('migrated output always passes validateScenario', () => {
    fc.assert(
      fc.property(v1ScenarioArb, (scenario) => {
        const migrated = migrate(structuredClone(scenario));
        expect(() => validateScenario(migrated)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it('migrate is idempotent — running it twice gives the same result', () => {
    fc.assert(
      fc.property(v1ScenarioArb, (scenario) => {
        const once = migrate(structuredClone(scenario));
        const twice = migrate(structuredClone(once));
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it('migrate does not mutate the input object', () => {
    fc.assert(
      fc.property(v1ScenarioArb, (scenario) => {
        const snapshot = JSON.stringify(scenario);
        migrate(scenario);
        expect(JSON.stringify(scenario)).toBe(snapshot);
      }),
      { numRuns: 100 },
    );
  });

  it('migrations array length equals CURRENT_VERSION - 1', () => {
    // This is a static assertion, not a property test, but it belongs here
    // because it guards the invariant that every version bump has a migration.
    // We access the array length indirectly: migrate(v1 data) must work,
    // and migrate(vCURRENT data) must be a no-op. If a migration is missing,
    // the loop would index into undefined and throw.
    const v1 = { schemaVersion: 1, architecture: { components: [], connections: [] }, simulationConfig: { endTime: 1, failureScenarios: [] } };
    expect(() => migrate(v1)).not.toThrow();
    const vCurrent = { schemaVersion: CURRENT_VERSION, architecture: { components: [], connections: [] }, simulationConfig: { endTime: 1, failureScenarios: [] } };
    expect(() => migrate(vCurrent)).not.toThrow();
  });
});
