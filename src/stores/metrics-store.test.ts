import { describe, it, expect, beforeEach } from 'vitest';
import { useMetricsStore } from './metrics-store';
import type { MetricSnapshot } from '../types';

const makeSnapshot = (simTime: number): MetricSnapshot => ({
  simTime,
  componentMetrics: { 's1': { throughput: simTime * 10 } },
  latencyPercentiles: { p50: 5, p95: 20, p99: 50, p999: 100 },
  completedCount: simTime,
  failedCount: 0,
});

describe('useMetricsStore', () => {
  beforeEach(() => {
    useMetricsStore.getState().reset();
  });

  it('starts empty', () => {
    const s = useMetricsStore.getState();
    expect(s.snapshots).toEqual([]);
    expect(s.latestSnapshot).toBeNull();
  });

  it('pushSnapshot appends and updates latestSnapshot', () => {
    const snap1 = makeSnapshot(1);
    const snap2 = makeSnapshot(2);

    useMetricsStore.getState().pushSnapshot(snap1);
    expect(useMetricsStore.getState().snapshots).toEqual([snap1]);
    expect(useMetricsStore.getState().latestSnapshot).toEqual(snap1);

    useMetricsStore.getState().pushSnapshot(snap2);
    expect(useMetricsStore.getState().snapshots).toEqual([snap1, snap2]);
    expect(useMetricsStore.getState().latestSnapshot).toEqual(snap2);
  });

  it('reset clears everything', () => {
    useMetricsStore.getState().pushSnapshot(makeSnapshot(1));
    useMetricsStore.getState().reset();
    expect(useMetricsStore.getState().snapshots).toEqual([]);
    expect(useMetricsStore.getState().latestSnapshot).toBeNull();
  });
});
