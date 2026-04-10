import type { TimeSeriesPoint, LatencyPercentiles } from '../types/metrics';

/** A recorded latency entry with its timestamp for window filtering */
interface LatencyEntry {
  time: number;
  latency: number;
}

/**
 * Collects time-series metrics and latency data during simulation.
 *
 * Time-series data is stored per (componentId, metricName) pair.
 * Latency values are stored with timestamps for windowed percentile computation.
 * Sorted insertion is used within getLatencyPercentiles for efficient percentile calculation.
 */
export class MetricCollector {
  /** Map of "componentId::metricName" → time-series points */
  private timeSeries: Map<string, TimeSeriesPoint[]> = new Map();

  /** All recorded latency entries (unsorted; sorted on demand per window) */
  private latencyEntries: LatencyEntry[] = [];

  /** Record a generic metric data point for a component */
  record(componentId: string, metricName: string, value: number, time: number): void {
    const key = `${componentId}::${metricName}`;
    let series = this.timeSeries.get(key);
    if (!series) {
      series = [];
      this.timeSeries.set(key, series);
    }
    series.push({ time, value });
  }

  /** Record an end-to-end latency measurement */
  recordLatency(latency: number, time: number): void {
    this.latencyEntries.push({ time, latency });
  }

  /** Retrieve the full time-series for a (componentId, metricName) pair */
  getTimeSeries(componentId: string, metricName: string): TimeSeriesPoint[] {
    const key = `${componentId}::${metricName}`;
    return this.timeSeries.get(key) ?? [];
  }

  /**
   * Compute latency percentiles (p50, p95, p99, p99.9) over a time window.
   *
   * Filters latency entries within [windowStart, windowEnd], sorts them,
   * and computes percentiles using nearest-rank method.
   * Returns all zeros for empty windows.
   */
  getLatencyPercentiles(windowStart: number, windowEnd: number): LatencyPercentiles {
    // Filter entries within the window
    const windowLatencies: number[] = [];
    for (const entry of this.latencyEntries) {
      if (entry.time >= windowStart && entry.time <= windowEnd) {
        windowLatencies.push(entry.latency);
      }
    }

    if (windowLatencies.length === 0) {
      return { p50: 0, p95: 0, p99: 0, p999: 0 };
    }

    // Sort using native sort (O(n log n))
    sortArray(windowLatencies);

    return {
      p50: percentile(windowLatencies, 0.50),
      p95: percentile(windowLatencies, 0.95),
      p99: percentile(windowLatencies, 0.99),
      p999: percentile(windowLatencies, 0.999),
    };
  }

  /** Reset all collected metrics */
  reset(): void {
    this.timeSeries.clear();
    this.latencyEntries = [];
  }
}

/**
 * Sort an array in-place.
 */
function sortArray(arr: number[]): void {
  arr.sort((a, b) => a - b);
}

/**
 * Compute a percentile value from a sorted array using nearest-rank method.
 * @param sorted - sorted array of values
 * @param p - percentile as a fraction (e.g. 0.95 for p95)
 */
function percentile(sorted: number[], p: number): number {
  const index = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}
