/** A single time-series data point */
export interface TimeSeriesPoint {
  time: number;
  value: number;
}

/** Latency percentile values */
export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
  p999: number;
}

/** Per-component metrics keyed by metric name */
export interface ComponentMetrics {
  [metricName: string]: number;
}

/** Snapshot of all metrics at a point in simulation time (transferred from worker to main thread) */
export interface MetricSnapshot {
  simTime: number;
  componentMetrics: Record<string, Record<string, number>>;
  latencyPercentiles: LatencyPercentiles;
  completedCount: number;
  failedCount: number;
}
