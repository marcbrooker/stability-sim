import { describe, it, expect, beforeEach } from 'vitest';
import { MetricCollector } from './metric-collector';

describe('MetricCollector', () => {
  let collector: MetricCollector;

  beforeEach(() => {
    collector = new MetricCollector();
  });

  /**
   * Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.6
   */

  // --- record() and getTimeSeries() ---

  describe('record() and getTimeSeries()', () => {
    it('stores data points and retrieves them correctly', () => {
      collector.record('server-1', 'throughput', 42, 1.0);
      collector.record('server-1', 'throughput', 55, 2.0);

      const series = collector.getTimeSeries('server-1', 'throughput');
      expect(series).toEqual([
        { time: 1.0, value: 42 },
        { time: 2.0, value: 55 },
      ]);
    });

    it('returns empty array for unknown component/metric', () => {
      const series = collector.getTimeSeries('nonexistent', 'metric');
      expect(series).toEqual([]);
    });

    it('stores multiple components and metrics independently', () => {
      collector.record('server-1', 'utilization', 0.5, 1.0);
      collector.record('server-2', 'utilization', 0.8, 1.0);
      collector.record('server-1', 'throughput', 100, 1.0);

      expect(collector.getTimeSeries('server-1', 'utilization')).toEqual([
        { time: 1.0, value: 0.5 },
      ]);
      expect(collector.getTimeSeries('server-2', 'utilization')).toEqual([
        { time: 1.0, value: 0.8 },
      ]);
      expect(collector.getTimeSeries('server-1', 'throughput')).toEqual([
        { time: 1.0, value: 100 },
      ]);
      // Cross-check: no bleed between keys
      expect(collector.getTimeSeries('server-2', 'throughput')).toEqual([]);
    });
  });

  // --- recordLatency() and getLatencyPercentiles() ---

  describe('recordLatency() and getLatencyPercentiles()', () => {
    it('computes correct percentiles for a known set of values', () => {
      // Record 100 latencies: 1, 2, 3, ..., 100
      for (let i = 1; i <= 100; i++) {
        collector.recordLatency(i, 0);
      }

      const p = collector.getLatencyPercentiles(0, 0);

      // nearest-rank: p50 → ceil(0.50*100)-1 = index 49 → value 50
      expect(p.p50).toBe(50);
      // p95 → ceil(0.95*100)-1 = index 94 → value 95
      expect(p.p95).toBe(95);
      // p99 → ceil(0.99*100)-1 = index 98 → value 99
      expect(p.p99).toBe(99);
      // p999 → ceil(0.999*100)-1 = index 99 → value 100
      expect(p.p999).toBe(100);
    });

    it('returns all zeros for an empty window', () => {
      const p = collector.getLatencyPercentiles(0, 10);
      expect(p).toEqual({ p50: 0, p95: 0, p99: 0, p999: 0 });
    });

    it('returns all zeros when no entries fall within the window', () => {
      collector.recordLatency(10, 5.0);
      collector.recordLatency(20, 15.0);

      // Window [6, 14] excludes both entries (time 5 and time 15)
      const p = collector.getLatencyPercentiles(6, 14);
      expect(p).toEqual({ p50: 0, p95: 0, p99: 0, p999: 0 });
    });

    it('filters entries by time window [windowStart, windowEnd]', () => {
      collector.recordLatency(100, 1.0); // outside window
      collector.recordLatency(200, 5.0); // inside
      collector.recordLatency(300, 8.0); // inside
      collector.recordLatency(400, 12.0); // outside

      const p = collector.getLatencyPercentiles(5.0, 10.0);

      // Only values 200 and 300 are in window. Sorted: [200, 300]
      // p50 → ceil(0.50*2)-1 = 0 → 200
      expect(p.p50).toBe(200);
      // p95 → ceil(0.95*2)-1 = 1 → 300
      expect(p.p95).toBe(300);
      expect(p.p99).toBe(300);
      expect(p.p999).toBe(300);
    });

    it('includes entries exactly at window boundaries', () => {
      collector.recordLatency(10, 5.0);  // at windowStart
      collector.recordLatency(20, 10.0); // at windowEnd

      const p = collector.getLatencyPercentiles(5.0, 10.0);
      // Both included. Sorted: [10, 20]
      expect(p.p50).toBe(10);
      expect(p.p999).toBe(20);
    });
  });

  // --- pruning and efficiency ---

  describe('latency entry pruning', () => {
    it('prunes entries before the window start', () => {
      // Record 10000 entries spanning t=0 to t=99.99
      for (let i = 0; i < 10000; i++) {
        collector.recordLatency(i * 0.1, i * 0.01);
      }

      // Query a window near the end — should prune old entries
      const p = collector.getLatencyPercentiles(90, 100);
      expect(p.p50).toBeGreaterThan(0);

      // After pruning, querying an earlier window returns empty
      // (those entries were removed)
      const p2 = collector.getLatencyPercentiles(0, 50);
      expect(p2).toEqual({ p50: 0, p95: 0, p99: 0, p999: 0 });
    });

    it('keeps entries within and after the window', () => {
      collector.recordLatency(10, 1.0);
      collector.recordLatency(20, 5.0);
      collector.recordLatency(30, 8.0);
      collector.recordLatency(40, 12.0);

      // Query [5, 10] — prunes entry at t=1.0
      const p1 = collector.getLatencyPercentiles(5.0, 10.0);
      expect(p1.p50).toBe(20); // entries at t=5.0 and t=8.0

      // Query [8, 15] — entry at t=8.0 and t=12.0 should still be available
      const p2 = collector.getLatencyPercentiles(8.0, 15.0);
      expect(p2.p50).toBe(30);
    });
  });

  // --- reset() ---

  describe('reset()', () => {
    it('clears all time-series data', () => {
      collector.record('server-1', 'utilization', 0.9, 1.0);
      collector.record('queue-1', 'depth', 5, 1.0);

      collector.reset();

      expect(collector.getTimeSeries('server-1', 'utilization')).toEqual([]);
      expect(collector.getTimeSeries('queue-1', 'depth')).toEqual([]);
    });

    it('clears all latency data', () => {
      collector.recordLatency(50, 1.0);
      collector.recordLatency(100, 2.0);

      collector.reset();

      const p = collector.getLatencyPercentiles(0, 100);
      expect(p).toEqual({ p50: 0, p95: 0, p99: 0, p999: 0 });
    });

    it('allows recording new data after reset', () => {
      collector.record('s1', 'metric', 10, 1.0);
      collector.reset();
      collector.record('s1', 'metric', 20, 2.0);

      expect(collector.getTimeSeries('s1', 'metric')).toEqual([
        { time: 2.0, value: 20 },
      ]);
    });
  });
});
