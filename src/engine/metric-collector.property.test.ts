import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { MetricCollector } from './metric-collector';

/**
 * Property-based tests for MetricCollector percentile computation.
 *
 * **Validates: Requirements 10.5**
 */
describe('MetricCollector property tests', () => {
  /**
   * Property 4: p50 ≤ p95 ≤ p99 ≤ p99.9 for any set of recorded latencies.
   *
   * For any non-empty list of positive latency values, recording them all
   * at time 0 and computing percentiles over window [0, 0] must yield
   * p50 ≤ p95 ≤ p99 ≤ p999.
   *
   * **Validates: Requirements 10.5**
   */
  it('p50 ≤ p95 ≤ p99 ≤ p99.9 for any set of recorded latencies', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.001, max: 1_000_000, noNaN: true }), { minLength: 1, maxLength: 500 }),
        (latencies) => {
          const collector = new MetricCollector();

          for (let i = 0; i < latencies.length; i++) {
            collector.recordLatency(latencies[i], 0);
          }

          const percentiles = collector.getLatencyPercentiles(0, 0);

          expect(percentiles.p50).toBeLessThanOrEqual(percentiles.p95);
          expect(percentiles.p95).toBeLessThanOrEqual(percentiles.p99);
          expect(percentiles.p99).toBeLessThanOrEqual(percentiles.p999);
        }
      ),
      { numRuns: 200 }
    );
  });
});
