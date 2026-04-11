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
   * Entries are appended chronologically (simulation clock is monotonic), so
   * binary search locates the window boundaries. Entries before windowStart
   * are pruned since the window only advances forward.
   *
   * Returns all zeros for empty windows.
   */
  getLatencyPercentiles(windowStart: number, windowEnd: number): LatencyPercentiles {
    // Prune entries before the window — they'll never be in a future window
    const pruneIdx = lowerBound(this.latencyEntries, windowStart);
    if (pruneIdx > 0) {
      this.latencyEntries = this.latencyEntries.slice(pruneIdx);
    }

    // Find end of window in the (now pruned) array
    const endIdx = upperBound(this.latencyEntries, windowEnd);

    if (endIdx === 0) {
      return { p50: 0, p95: 0, p99: 0, p999: 0 };
    }

    // Extract and sort latency values in the window
    const windowLatencies = new Array<number>(endIdx);
    for (let i = 0; i < endIdx; i++) {
      windowLatencies[i] = this.latencyEntries[i].latency;
    }

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
 * Find the index of the first entry with time >= target (lower bound).
 */
function lowerBound(entries: LatencyEntry[], target: number): number {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].time < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Find the index past the last entry with time <= target (upper bound).
 */
function upperBound(entries: LatencyEntry[], target: number): number {
  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (entries[mid].time <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
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
