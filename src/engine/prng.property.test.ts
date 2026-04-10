import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { SeededRNG } from './prng';

/**
 * Property-based tests for SeededRNG determinism.
 *
 * **Validates: Requirements 1.1, 6.1**
 */
describe('SeededRNG property tests', () => {
  /**
   * Property 1: Same seed produces identical sequence.
   *
   * For any seed and any sequence length, two SeededRNG instances
   * initialized with the same seed must produce identical sequences.
   *
   * **Validates: Requirements 1.1, 6.1**
   */
  it('same seed produces identical sequence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        fc.integer({ min: 1, max: 500 }),
        (seed, length) => {
          const rng1 = new SeededRNG(seed);
          const rng2 = new SeededRNG(seed);

          for (let i = 0; i < length; i++) {
            expect(rng1.random()).toBe(rng2.random());
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
