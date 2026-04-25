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
import { Plus, X } from 'lucide-react';
import { useMetricsStore } from '../stores/metrics-store';
import { useArchitectureStore } from '../stores/architecture-store';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Separator } from './ui/separator';

const COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#a855f7', '#f97316'];

/** Format a number for display in chart tooltips and Y-axis ticks.
 *  Targets 3-4 significant digits across the typical range of values
 *  produced by the simulator, avoiding ugly scientific notation for
 *  the common cases. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1000) return Math.round(n).toLocaleString();
  if (abs >= 100) return n.toFixed(1);
  if (abs >= 10) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  if (abs >= 0.001) return n.toFixed(4);
  return n.toExponential(2);
}

const tooltipFormatter = (value: unknown): string =>
  typeof value === 'number' ? fmt(value) : String(value);

const formatTimeTick = (value: number) => Math.round(value).toString();

function isCumulativeMetric(name: string): boolean {
  if (
    name === 'utilization' || name === 'queueDepth' || name === 'activeCount' ||
    name === 'inFlightCount' || name === 'hitRate' || name === 'missRate' ||
    name === 'crashed' || name === 'latencySpikeMultiplier' || name === 'cpuReductionPercent' ||
    name === 'failedDownstreamCount' || name === 'tokenBucketTokens'
  ) {
    return false;
  }
  return true;
}

interface SelectedMetric {
  componentId: string;
  metricName: string;
}

function ChartTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold text-foreground/80 mb-1">{children}</div>
  );
}

const RECHARTS_TOOLTIP_STYLE = {
  background: 'oklch(0.21 0.006 285.885)',
  border: '1px solid oklch(1 0 0 / 12%)',
  borderRadius: 6,
  fontSize: 12,
};

const RECHARTS_TICK_STYLE = { fontSize: 10, fill: 'oklch(0.705 0.015 286.067)' };

export function Dashboard() {
  const latestSnapshot = useMetricsStore((s) => s.latestSnapshot);
  const components = useArchitectureStore((s) => s.components);

  const [selections, setSelections] = useState<SelectedMetric[]>([]);
  const [pickComponent, setPickComponent] = useState('');
  const [pickMetric, setPickMetric] = useState('');

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

  const latencyData = useMemo(() => {
    const snapshots = useMetricsStore.getState().snapshots;
    return snapshots.map((snap) => ({
      time: snap.simTime,
      p50: snap.latencyPercentiles.p50,
      p95: snap.latencyPercentiles.p95,
      p99: snap.latencyPercentiles.p99,
    }));
  }, [latestSnapshot]);

  const throughputData = useMemo(() => {
    const snapshots = useMetricsStore.getState().snapshots;
    if (snapshots.length === 0) return [];
    const result: { time: number; completedPerSec: number; failedPerSec: number }[] = [];
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      if (i === 0) {
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

  const compLabel = useCallback(
    (id: string) => {
      const c = components.find((comp) => comp.id === id);
      return c ? c.label : id;
    },
    [components],
  );

  return (
    <div className="flex flex-col h-full gap-1">
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Dashboard
        </span>

        <Separator orientation="vertical" />

        <Select
          value={pickComponent}
          onValueChange={(v) => {
            setPickComponent(v);
            setPickMetric('');
          }}
        >
          <SelectTrigger className="w-40 h-7 text-xs">
            <SelectValue placeholder="Component…" />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(availableMetrics).map((id) => (
              <SelectItem key={id} value={id}>
                {compLabel(id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={pickMetric} onValueChange={setPickMetric} disabled={!pickComponent}>
          <SelectTrigger className="w-44 h-7 text-xs">
            <SelectValue placeholder="Metric…" />
          </SelectTrigger>
          <SelectContent>
            {(availableMetrics[pickComponent] ?? []).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          variant="outline"
          onClick={addSelection}
          disabled={!pickComponent || !pickMetric}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>

        <div className="flex flex-wrap gap-1.5">
          {selections.map((sel, i) => {
            const c = COLORS[i % COLORS.length];
            return (
              <button
                key={i}
                type="button"
                onClick={() => removeSelection(i)}
                title="Click to remove"
                className="group inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80"
                style={{
                  background: `${c}1a`,
                  borderColor: `${c}55`,
                  color: c,
                }}
              >
                <span>{compLabel(sel.componentId)}.{sel.metricName}</span>
                <X className="h-3 w-3 opacity-60 group-hover:opacity-100" strokeWidth={2.5} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-1 gap-3 min-h-[140px] flex-wrap">
        <div className="flex-1 min-w-0">
          <ChartTitle>Latency Percentiles</ChartTitle>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={latencyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
              <XAxis dataKey="time" tick={RECHARTS_TICK_STYLE} tickFormatter={formatTimeTick} />
              <YAxis tick={RECHARTS_TICK_STYLE} tickFormatter={fmt} width={44} />
              <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} formatter={tooltipFormatter} labelFormatter={(t) => `t=${fmt(Number(t))}s`} />
              <Line type="linear" dataKey="p50" stroke="#2980b9" dot={false} strokeWidth={1.5} name="p50" />
              <Line type="linear" dataKey="p95" stroke="#f39c12" dot={false} strokeWidth={1.5} name="p95" />
              <Line type="linear" dataKey="p99" stroke="#e74c3c" dot={false} strokeWidth={1.5} name="p99" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 min-w-0">
          <ChartTitle>Throughput (req/s)</ChartTitle>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={throughputData}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
              <XAxis dataKey="time" tick={RECHARTS_TICK_STYLE} tickFormatter={formatTimeTick} />
              <YAxis tick={RECHARTS_TICK_STYLE} tickFormatter={fmt} width={44} />
              <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} formatter={tooltipFormatter} labelFormatter={(t) => `t=${fmt(Number(t))}s`} />
              <Line type="linear" dataKey="completedPerSec" stroke="#27ae60" dot={false} strokeWidth={1.5} name="Completed/s" />
              <Line type="linear" dataKey="failedPerSec" stroke="#e74c3c" dot={false} strokeWidth={1.5} name="Failed/s" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {selectionGroups.map((group) => (
          <div key={group.metricName} className="flex-1 min-w-0">
            <ChartTitle>
              {group.metricName}
              {isCumulativeMetric(group.metricName) ? ' (/s)' : ''}
            </ChartTitle>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
                <XAxis dataKey="time" tick={RECHARTS_TICK_STYLE} tickFormatter={formatTimeTick} />
                <YAxis tick={RECHARTS_TICK_STYLE} />
                <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE} />
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
