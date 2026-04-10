import fc from 'fast-check';
import { describe, it, expect } from 'vitest';

/**
 * Pure mathematical property tests for load-dependent latency formulas.
 *
 * The three scaling modes are:
 *   linear:      base × (1 + factor × utilization)
 *   polynomial:  base × (1 + factor × utilization^exponent)
 *   exponential: base × e^(factor × utilization)
 *
 * **Validates: Requirements 6.5, 6.6, 16.5, 16.6**
 */

/** Compute load-dependent service time for a given mode. */
function computeServiceTime(
  base: number,
  utilization: number,
  mode: 'linear' | 'polynomial' | 'exponential',
  factor: number,
  exponent: number,
): number {
  switch (mode) {
    case 'linear':
      return base * (1 + factor * utilization);
    case 'polynomial':
      return base * (1 + factor * Math.pow(utilization, exponent));
    case 'exponential':
      return base * Math.exp(factor * utilization);
  }
}

describe('Load-dependent latency property tests', () => {
  /**
   * Property 6: Load-dependent service time is monotonically non-decreasing
   * as utilization increases, for all three scaling modes.
   *
   * For any positive base service time, non-negative factor, exponent >= 1
   * (polynomial), and utilization pair u1 < u2 in [0, 1]:
   *   serviceTime(u2) >= serviceTime(u1)
   *
   * **Validates: Requirements 6.5, 6.6, 16.5, 16.6**
   */
  it('linear mode: service time is non-decreasing with utilization', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1000, noNaN: true }),   // base > 0
        fc.double({ min: 0, max: 100, noNaN: true }),         // factor >= 0
        fc.double({ min: 0, max: 1, noNaN: true }),           // u1 in [0,1]
        fc.double({ min: 0, max: 1, noNaN: true }),           // u2 in [0,1]
        (base, factor, rawU1, rawU2) => {
          const u1 = Math.min(rawU1, rawU2);
          const u2 = Math.max(rawU1, rawU2);

          const t1 = computeServiceTime(base, u1, 'linear', factor, 1);
          const t2 = computeServiceTime(base, u2, 'linear', factor, 1);

          expect(t2).toBeGreaterThanOrEqual(t1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('polynomial mode: service time is non-decreasing with utilization', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1000, noNaN: true }),   // base > 0
        fc.double({ min: 0, max: 100, noNaN: true }),         // factor >= 0
        fc.double({ min: 1, max: 10, noNaN: true }),          // exponent >= 1
        fc.double({ min: 0, max: 1, noNaN: true }),           // u1 in [0,1]
        fc.double({ min: 0, max: 1, noNaN: true }),           // u2 in [0,1]
        (base, factor, exponent, rawU1, rawU2) => {
          const u1 = Math.min(rawU1, rawU2);
          const u2 = Math.max(rawU1, rawU2);

          const t1 = computeServiceTime(base, u1, 'polynomial', factor, exponent);
          const t2 = computeServiceTime(base, u2, 'polynomial', factor, exponent);

          expect(t2).toBeGreaterThanOrEqual(t1);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('exponential mode: service time is non-decreasing with utilization', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 1000, noNaN: true }),   // base > 0
        fc.double({ min: 0, max: 100, noNaN: true }),         // factor >= 0
        fc.double({ min: 0, max: 1, noNaN: true }),           // u1 in [0,1]
        fc.double({ min: 0, max: 1, noNaN: true }),           // u2 in [0,1]
        (base, factor, rawU1, rawU2) => {
          const u1 = Math.min(rawU1, rawU2);
          const u2 = Math.max(rawU1, rawU2);

          const t1 = computeServiceTime(base, u1, 'exponential', factor, 1);
          const t2 = computeServiceTime(base, u2, 'exponential', factor, 1);

          expect(t2).toBeGreaterThanOrEqual(t1);
        },
      ),
      { numRuns: 500 },
    );
  });
});
