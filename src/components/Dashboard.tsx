import { useCallback, useMemo, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useMetricsStore } from '../stores/metrics-store';
import { useSimulationStore } from '../stores/simulation-store';
import { useArchitectureStore } from '../stores/architecture-store';

/**
 * Dashboard panel — time-series charts for selected metrics,
 * metric selector, and simulation status display.
 *
 * Subscribes to the Metrics Store and re-renders as new snapshots arrive.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 */

// Matches the component palette colors from ComponentPalette.tsx
const COLORS = ['#4a90d9', '#c0392b', '#27ae60', '#f39c12', '#8e44ad', '#e07b39'];

/** Format X-axis time ticks as rounded integers */
const formatTimeTick = (value: number) => Math.round(value).toString();

/** Returns true if a metric name represents a cumulative counter that should be shown as per-second */
function isCumulativeMetric(name: string): boolean {
  if (name === 'utilization' || name === 'queueDepth' || name === 'activeCount' ||
      name === 'inFlightCount' || name === 'hitRate' || name === 'missRate' ||
      name === 'crashed' || name === 'latencySpikeMultiplier' || name === 'cpuReductionPercent' ||
      name === 'failedDownstreamCount' || name === 'tokenBucketTokens') {
    return false;
  }
  return true; // tpsForwarded, tpsProcessed, totalRejected, completedCount, failedCount, retriedCount, etc.
}

interface SelectedMetric {
  componentId: string;
  metricName: string;
}

export function Dashboard() {
  // Subscribe to latestSnapshot as the change signal; read full array via getState()
  const latestSnapshot = useMetricsStore((s) => s.latestSnapshot);
  const currentTime = useSimulationStore((s) => s.currentTime);
  const speedMultiplier = useSimulationStore((s) => s.speedMultiplier);
  const status = useSimulationStore((s) => s.status);
  const components = useArchitectureStore((s) => s.components);

  const [selections, setSelections] = useState<SelectedMetric[]>([]);
  const [pickComponent, setPickComponent] = useState('');
  const [pickMetric, setPickMetric] = useState('');

  // Derive available metrics: component list from architecture, metric names from latest snapshot
  const availableMetrics = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const comp of components) {
      result[comp.id] = latestSnapshot?.componentMetrics[comp.id]
        ? Object.keys(latestSnapshot.componentMetrics[comp.id])
        : [];
    }
    return result;
  }, [components, latestSnapshot]);

  const addSelection = useCallback(() => {
    if (!pickComponent || !pickMetric) return;
    setSelections((prev) => {
      const exists = prev.some(
        (s) => s.componentId === pickComponent && s.metricName === pickMetric,
      );
      return exists ? prev : [...prev, { componentId: pickComponent, metricName: pickMetric }];
    });
  }, [pickComponent, pickMetric]);

  const removeSelection = useCallback((idx: number) => {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  // Build chart data: per-second rates for cumulative metrics, raw values for point-in-time
  const chartData = useMemo(() => {
    const snapshots = useMetricsStore.getState().snapshots;
    if (snapshots.length === 0) return [];
    return snapshots.map((snap, idx) => {
      const row: Record<string, number> = { time: snap.simTime };
      selections.forEach((sel, i) => {
        const val = snap.componentMetrics[sel.componentId]?.[sel.metricName] ?? 0;
        if (isCumulativeMetric(sel.metricName) && idx > 0) {
          const prev = snapshots[idx - 1];
          const prevVal = prev.componentMetrics[sel.componentId]?.[sel.metricName] ?? 0;
          const dt = snap.simTime - prev.simTime;
          row[`s${i}`] = dt > 0 ? (val - prevVal) / dt : 0;
        } else if (isCumulativeMetric(sel.metricName) && idx === 0) {
          const dt = snap.simTime || 1;
          row[`s${i}`] = val / dt;
        } else {
          row[`s${i}`] = val;
        }
      });
      return row;
    });
  }, [latestSnapshot, selections]);

  // Group selections by metric name for separate chart panes
  const selectionGroups = useMemo(() => {
    const groups: Record<string, { selections: (SelectedMetric & { globalIndex: number })[]; metricName: string }> = {};
    selections.forEach((sel, i) => {
      if (!groups[sel.metricName]) {
        groups[sel.metricName] = { selections: [], metricName: sel.metricName };
      }
      groups[sel.metricName].selections.push({ ...sel, globalIndex: i });
    });
    return Object.values(groups);
  }, [selections]);

  // Latency percentile chart data
  const latencyData = useMemo(() => {
    const snapshots = useMetricsStore.getState().snapshots;
    return snapshots.map((snap) => ({
      time: snap.simTime,
      p50: snap.latencyPercentiles.p50,
      p95: snap.latencyPercentiles.p95,
      p99: snap.latencyPercentiles.p99,
    }));
  }, [latestSnapshot]);

  // Throughput chart data — per-second rates computed from consecutive snapshot deltas
  const throughputData = useMemo(() => {
    const snapshots = useMetricsStore.getState().snapshots;
    if (snapshots.length === 0) return [];
    const result: { time: number; completedPerSec: number; failedPerSec: number }[] = [];
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (i === 0) {
        // First snapshot: rate is count / time (or 0 if time is 0)
        const dt = snap.simTime || 1;
        result.push({
          time: snap.simTime,
          completedPerSec: snap.completedCount / dt,
          failedPerSec: snap.failedCount / dt,
        });
      } else {
        const prev = snapshots[i - 1];
        const dt = snap.simTime - prev.simTime;
        if (dt > 0) {
          result.push({
            time: snap.simTime,
            completedPerSec: (snap.completedCount - prev.completedCount) / dt,
            failedPerSec: (snap.failedCount - prev.failedCount) / dt,
          });
        }
      }
    }
    return result;
  }, [latestSnapshot]);

  // Component label lookup
  const compLabel = useCallback(
    (id: string) => {
      const c = components.find((comp) => comp.id === id);
      return c ? c.label : id;
    },
    [components],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 4 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <strong style={{ color: '#fff', fontSize: 13 }}>Dashboard</strong>
        <span style={{ fontSize: 11, color: '#8888aa' }}>
          t={currentTime.toFixed(2)}s | {speedMultiplier.toFixed(1)}× | {status}
        </span>

        <span className="sep" />

        {/* Metric selector */}
        <select
          className="sim-select sim-btn-sm"
          value={pickComponent}
          onChange={(e) => {
            setPickComponent(e.target.value);
            setPickMetric('');
          }}
        >
          <option value="">Component…</option>
          {Object.keys(availableMetrics).map((id) => (
            <option key={id} value={id}>
              {compLabel(id)}
            </option>
          ))}
        </select>
        <select
          className="sim-select sim-btn-sm"
          value={pickMetric}
          onChange={(e) => setPickMetric(e.target.value)}
          disabled={!pickComponent}
        >
          <option value="">Metric…</option>
          {(availableMetrics[pickComponent] ?? []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="sim-btn sim-btn-sm" onClick={addSelection} disabled={!pickComponent || !pickMetric}>
          + Add
        </button>

        {/* Active selections */}
        {selections.map((sel, i) => (
          <span
            key={i}
            className="metric-chip"
            style={{
              background: COLORS[i % COLORS.length] + '22',
              border: `1px solid ${COLORS[i % COLORS.length]}`,
              color: COLORS[i % COLORS.length],
              cursor: 'pointer',
            }}
            onClick={() => removeSelection(i)}
            title="Click to remove"
          >
            {compLabel(sel.componentId)}.{sel.metricName} ×
          </span>
        ))}
      </div>

      {/* Charts row */}
      <div style={{ display: 'flex', flex: 1, gap: 8, minHeight: 140, flexWrap: 'wrap' }}>
        {/* Latency percentiles */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dashboard-chart-title">Latency Percentiles</div>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={formatTimeTick} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="linear" dataKey="p50" stroke="#2980b9" dot={false} strokeWidth={1.5} name="p50" />
              <Line type="linear" dataKey="p95" stroke="#f39c12" dot={false} strokeWidth={1.5} name="p95" />
              <Line type="linear" dataKey="p99" stroke="#e74c3c" dot={false} strokeWidth={1.5} name="p99" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Throughput */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dashboard-chart-title">Throughput (req/s)</div>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={throughputData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={formatTimeTick} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="linear" dataKey="completedPerSec" stroke="#27ae60" dot={false} strokeWidth={1.5} name="Completed/s" />
              <Line type="linear" dataKey="failedPerSec" stroke="#e74c3c" dot={false} strokeWidth={1.5} name="Failed/s" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Custom metric selections — one pane per unit group */}
        {selectionGroups.map((group) => (
          <div key={group.metricName} style={{ flex: 1, minWidth: 0 }}>
            <div className="dashboard-chart-title">
              {group.metricName}{isCumulativeMetric(group.metricName) ? ' (/s)' : ''}
            </div>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={formatTimeTick} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                {group.selections.map((sel) => (
                  <Line
                    key={sel.globalIndex}
                    type="linear"
                    dataKey={`s${sel.globalIndex}`}
                    stroke={COLORS[sel.globalIndex % COLORS.length]}
                    dot={false}
                    strokeWidth={1.5}
                    name={`${compLabel(sel.componentId)}.${sel.metricName}`}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
}
