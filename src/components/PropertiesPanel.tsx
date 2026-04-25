import { Trash2 } from 'lucide-react';
import { useArchitectureStore } from '../stores/architecture-store';
import { useUIStore } from '../stores/ui-store';
import type { ComponentConfig, ComponentDefinition, ConnectionDefinition } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Checkbox } from './ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const TYPE_LABELS: Record<string, string> = {
  client: 'Client',
  server: 'Server',
  database: 'Database',
  cache: 'Cache',
  'load-balancer': 'Load Balancer',
  queue: 'Queue',
  throttle: 'Throttle',
};

export function PropertiesPanel() {
  const selectedComponentId = useUIStore((s) => s.selectedComponentId);
  const selectedConnectionId = useUIStore((s) => s.selectedConnectionId);
  const components = useArchitectureStore((s) => s.components);
  const connections = useArchitectureStore((s) => s.connections);
  const updateComponentConfig = useArchitectureStore((s) => s.updateComponentConfig);
  const updateComponentNotes = useArchitectureStore((s) => s.updateComponentNotes);
  const removeComponent = useArchitectureStore((s) => s.removeComponent);
  const removeConnection = useArchitectureStore((s) => s.removeConnection);
  const selectComponent = useUIStore((s) => s.selectComponent);
  const selectConnection = useUIStore((s) => s.selectConnection);

  if (selectedComponentId) {
    const comp = components.find((c) => c.id === selectedComponentId);
    if (!comp) return <div className="p-3 text-sm text-muted-foreground">Component not found</div>;
    return (
      <div className="p-3 text-sm">
        <PanelHeader title={comp.label} subtitle={TYPE_LABELS[comp.type] ?? comp.type} />
        <ComponentConfigEditor key={comp.id} component={comp} onUpdate={updateComponentConfig} />
        <Field label="Notes">
          <Textarea
            value={comp.notes ?? ''}
            onChange={(e) => updateComponentNotes(comp.id, e.target.value)}
            placeholder="Add a note..."
            rows={2}
            className="resize-y"
          />
        </Field>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            removeComponent(comp.id);
            selectComponent(null);
          }}
          className="mt-3"
        >
          <Trash2 />
          Remove Component
        </Button>
      </div>
    );
  }

  if (selectedConnectionId) {
    const conn = connections.find((c) => c.id === selectedConnectionId);
    if (!conn) return <div className="p-3 text-sm text-muted-foreground">Connection not found</div>;
    return (
      <ConnectionPanel
        conn={conn}
        components={components}
        onDelete={() => {
          removeConnection(conn.id);
          selectConnection(null);
        }}
      />
    );
  }

  return (
    <div className="p-3 text-sm">
      <PanelHeader title="Properties" />
      <div className="text-muted-foreground text-sm">Select a component or connection to edit.</div>
    </div>
  );
}

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3 pb-2 border-b border-border">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {subtitle && <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>}
    </div>
  );
}

function Field({
  label,
  info,
  children,
}: {
  label: string;
  info?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1 mb-1">
        <label className="text-[11px] font-semibold text-muted-foreground">{label}</label>
        {info && <InfoTip text={info} />}
      </div>
      {children}
    </div>
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted text-muted-foreground text-[9px] font-bold cursor-help select-none leading-none"
          aria-label="Info"
        >
          i
        </span>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

function ConnectionPanel({
  conn,
  components,
  onDelete,
}: {
  conn: ConnectionDefinition;
  components: ComponentDefinition[];
  onDelete: () => void;
}) {
  const source = components.find((c) => c.id === conn.sourceId);
  const target = components.find((c) => c.id === conn.targetId);
  return (
    <div className="p-3 text-sm">
      <PanelHeader title="Connection" />
      <Field label="Source">
        <div className="text-foreground">{source?.label ?? conn.sourceId}</div>
      </Field>
      <Field label="Target">
        <div className="text-foreground">{target?.label ?? conn.targetId}</div>
      </Field>
      <Button variant="destructive" size="sm" onClick={onDelete} className="mt-2">
        <Trash2 />
        Delete Connection
      </Button>
    </div>
  );
}

function ComponentConfigEditor({
  component,
  onUpdate,
}: {
  component: ComponentDefinition;
  onUpdate: (id: string, config: ComponentConfig) => void;
}) {
  const config = component.config;

  const update = (partial: Record<string, unknown>) => {
    onUpdate(component.id, { ...config, ...partial } as ComponentConfig);
  };

  switch (config.type) {
    case 'client':
      return <ClientConfigFields config={config} update={update} />;
    case 'server':
      return <ServerConfigFields config={config} update={update} />;
    case 'database':
      return <DatabaseConfigFields config={config} update={update} />;
    case 'cache':
      return <CacheConfigFields config={config} update={update} />;
    case 'load-balancer':
      return <LoadBalancerConfigFields config={config} update={update} />;
    case 'queue':
      return <QueueConfigFields config={config} update={update} />;
    case 'throttle':
      return <ThrottleConfigFields config={config} update={update} />;
    default:
      return <div>Unknown component type</div>;
  }
}

function NumberField({
  label,
  value,
  onChange,
  info,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  info?: string;
}) {
  return (
    <Field label={label} info={info}>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="tabular-nums"
      />
    </Field>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  info,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  info?: string;
}) {
  return (
    <Field label={label} info={info}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ClientConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'client' };
  update: (p: Record<string, unknown>) => void;
}) {
  const tp = config.trafficPattern;
  return (
    <>
      <SelectField
        label="Traffic Pattern"
        value={tp.type}
        info="How the client generates requests. Open-loop sends at a fixed rate regardless of responses. Closed-loop waits for each response before sending the next. Ramping linearly changes rate over time. Burst sends all requests at once."
        options={[
          { value: 'open-loop', label: 'Open Loop' },
          { value: 'closed-loop', label: 'Closed Loop' },
          { value: 'ramping', label: 'Ramping' },
          { value: 'burst', label: 'Burst' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            'open-loop': { type: 'open-loop', meanArrivalRate: 100 },
            'closed-loop': { type: 'closed-loop', thinkTime: 0.01, maxConcurrency: 10 },
            ramping: { type: 'ramping', startRate: 10, endRate: 200, duration: 100 },
            burst: { type: 'burst', count: 50, atTime: 10 },
          };
          update({ trafficPattern: defaults[v] });
        }}
      />
      {tp.type === 'open-loop' && (
        <>
          <NumberField
            label="Mean Arrival Rate (req/s)"
            value={tp.meanArrivalRate}
            onChange={(v) => update({ trafficPattern: { ...tp, meanArrivalRate: v } })}
            info="Average requests per second. Actual inter-arrival times are exponentially distributed around this rate."
          />
          <NumberField
            label="Ramp-Up Time (s, 0 = instant)"
            value={tp.rampUpTime ?? 0}
            onChange={(v) => update({ trafficPattern: { ...tp, rampUpTime: v > 0 ? v : undefined } })}
            info="Linearly increases the arrival rate from 0 to the mean rate over this duration. Useful for warming caches before injecting failures."
          />
        </>
      )}
      {tp.type === 'closed-loop' && (
        <>
          <NumberField
            label="Think Time (s)"
            value={tp.thinkTime}
            onChange={(v) => update({ trafficPattern: { ...tp, thinkTime: v } })}
            info="Delay between receiving a response and sending the next request. Models user think time."
          />
          <NumberField
            label="Max Concurrency"
            value={tp.maxConcurrency}
            onChange={(v) => update({ trafficPattern: { ...tp, maxConcurrency: v } })}
            info="Maximum number of requests in flight simultaneously. Each slot sends a new request only after the previous one completes (or times out)."
          />
        </>
      )}
      {tp.type === 'ramping' && (
        <>
          <NumberField
            label="Start Rate (req/s)"
            value={tp.startRate}
            onChange={(v) => update({ trafficPattern: { ...tp, startRate: v } })}
            info="Arrival rate at the beginning of the ramp."
          />
          <NumberField
            label="End Rate (req/s)"
            value={tp.endRate}
            onChange={(v) => update({ trafficPattern: { ...tp, endRate: v } })}
            info="Arrival rate at the end of the ramp."
          />
          <NumberField
            label="Duration (s)"
            value={tp.duration}
            onChange={(v) => update({ trafficPattern: { ...tp, duration: v } })}
            info="How long the ramp lasts. The rate interpolates linearly from start to end over this period."
          />
        </>
      )}
      {tp.type === 'burst' && (
        <>
          <NumberField
            label="Count (requests)"
            value={tp.count}
            onChange={(v) => update({ trafficPattern: { ...tp, count: v } })}
            info="Total number of requests to send in the burst."
          />
          <NumberField
            label="At Time (s)"
            value={tp.atTime}
            onChange={(v) => update({ trafficPattern: { ...tp, atTime: v } })}
            info="Simulation time at which all burst requests are sent simultaneously."
          />
        </>
      )}
      <NumberField
        label="Num Keys (distinct cache keys, 0 = none)"
        value={config.numKeys ?? 0}
        onChange={(v) => update({ numKeys: v > 0 ? v : undefined })}
        info="Number of distinct cache keys. Each request gets a random key from this pool. 0 disables key-based caching."
      />
      <SelectField
        label="Retry Strategy"
        value={config.retryStrategy.type}
        info="How the client handles failed or timed-out requests."
        options={[
          { value: 'none', label: 'None' },
          { value: 'fixed-n', label: 'Fixed N' },
          { value: 'token-bucket', label: 'Token Bucket' },
          { value: 'circuit-breaker', label: 'Circuit Breaker' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            none: { type: 'none' },
            'fixed-n': { type: 'fixed-n', maxRetries: 3 },
            'token-bucket': { type: 'token-bucket', capacity: 10, depositAmount: 0.02 },
            'circuit-breaker': { type: 'circuit-breaker', windowSize: 10, failureThreshold: 5, maxRetries: 3 },
          };
          update({ retryStrategy: defaults[v] });
        }}
      />
      {config.retryStrategy.type === 'fixed-n' && (
        <NumberField
          label="Max Retries"
          value={config.retryStrategy.maxRetries}
          onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, maxRetries: v } })}
          info="Maximum number of retry attempts per request."
        />
      )}
      {config.retryStrategy.type === 'token-bucket' && (
        <>
          <NumberField
            label="Bucket Capacity"
            value={config.retryStrategy.capacity}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, capacity: v } })}
            info="Maximum number of retry tokens. The bucket starts full."
          />
          <NumberField
            label="Deposit per Success"
            value={config.retryStrategy.depositAmount}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, depositAmount: v } })}
            info="Tokens added to the bucket on each successful response."
          />
        </>
      )}
      {config.retryStrategy.type === 'circuit-breaker' && (
        <>
          <NumberField
            label="Max Retries"
            value={config.retryStrategy.maxRetries}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, maxRetries: v } })}
            info="Maximum retries per request while the circuit is closed."
          />
          <NumberField
            label="Window Size (s)"
            value={config.retryStrategy.windowSize}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, windowSize: v } })}
            info="Sliding window duration for measuring failure rate."
          />
          <NumberField
            label="Failure Threshold (0-1)"
            value={config.retryStrategy.failureThreshold}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, failureThreshold: v } })}
            info="Failure rate (0-1) that opens the circuit."
          />
        </>
      )}
      <NumberField
        label="Timeout (s)"
        value={config.timeout ?? 1}
        onChange={(v) => update({ timeout: v > 0 ? v : undefined })}
        info="Max time to wait for a response before treating the request as failed."
      />
    </>
  );
}

function DistributionFields({
  label,
  dist,
  onChange,
}: {
  label: string;
  dist: { type: string; [k: string]: unknown };
  onChange: (d: Record<string, unknown>) => void;
}) {
  return (
    <>
      <SelectField
        label={`${label} Type`}
        value={dist.type as string}
        info="Probability distribution for sampling times. Uniform: equal chance between min and max. Exponential: memoryless. Log-normal: heavy-tailed, models real-world latency well."
        options={[
          { value: 'uniform', label: 'Uniform' },
          { value: 'exponential', label: 'Exponential' },
          { value: 'log-normal', label: 'Log-Normal' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            uniform: { type: 'uniform', min: 0.001, max: 0.01 },
            exponential: { type: 'exponential', mean: 0.005 },
            'log-normal': { type: 'log-normal', mu: -5, sigma: 0.5 },
          };
          onChange(defaults[v] as Record<string, unknown>);
        }}
      />
      {dist.type === 'uniform' && (
        <>
          <NumberField label="Min" value={dist.min as number} onChange={(v) => onChange({ ...dist, min: v })}
            info="Minimum possible value (seconds)." />
          <NumberField label="Max" value={dist.max as number} onChange={(v) => onChange({ ...dist, max: v })}
            info="Maximum possible value (seconds). Mean is (min+max)/2." />
        </>
      )}
      {dist.type === 'exponential' && (
        <NumberField label="Mean" value={dist.mean as number} onChange={(v) => onChange({ ...dist, mean: v })}
          info="Average value in seconds. Exponential distributions are memoryless." />
      )}
      {dist.type === 'log-normal' && (
        <>
          <NumberField label="Mu" value={dist.mu as number} onChange={(v) => onChange({ ...dist, mu: v })}
            info="Log-space mean. The real-space mean is exp(μ + σ²/2)." />
          <NumberField label="Sigma" value={dist.sigma as number} onChange={(v) => onChange({ ...dist, sigma: v })}
            info="Log-space standard deviation. Larger values produce heavier tails." />
        </>
      )}
    </>
  );
}

function LoadDependentLatencyFields({
  value,
  onChange,
}: {
  value?: { mode: string; factor: number; exponent?: number };
  onChange: (v: { mode: string; factor: number; exponent?: number } | undefined) => void;
}) {
  const enabled = !!value;
  const mode = value?.mode ?? 'linear';
  const factor = value?.factor ?? 1;
  const exponent = value?.exponent ?? 2;

  return (
    <div className="border border-border rounded-md p-2.5 mb-3 bg-secondary/40">
      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox
          checked={enabled}
          onCheckedChange={(v) => onChange(v ? { mode: 'linear', factor: 1 } : undefined)}
        />
        <span className="text-[11px] font-semibold text-foreground">Load-Dependent Latency</span>
      </label>
      {enabled && (
        <div className="mt-3">
          <SelectField
            label="Mode"
            value={mode}
            options={[
              { value: 'linear', label: 'Linear: base × (1 + f·u)' },
              { value: 'polynomial', label: 'Polynomial: base × (1 + f·uⁿ)' },
              { value: 'exponential', label: 'Exponential: base × eᶠᵘ' },
            ]}
            onChange={(v) => onChange({ ...value!, mode: v })}
            info="How latency scales with utilization (u). Linear grows steadily. Polynomial stays flat at low utilization then spikes near saturation. Exponential grows aggressively."
          />
          <NumberField
            label="Factor (f)"
            value={factor}
            onChange={(v) => onChange({ ...value!, factor: v })}
            info="Scaling multiplier. Higher values make latency more sensitive to utilization."
          />
          {mode === 'polynomial' && (
            <NumberField
              label="Exponent (n)"
              value={exponent}
              onChange={(v) => onChange({ ...value!, exponent: v })}
              info="Controls the shape of the curve. Higher exponents keep latency flat at low utilization but cause a sharper spike near saturation."
            />
          )}
          <div className="text-[10px] text-muted-foreground mt-1">
            u = utilization (0–1). At 80% util, latency ×{' '}
            {mode === 'linear'
              ? (1 + factor * 0.8).toFixed(1)
              : mode === 'polynomial'
                ? (1 + factor * Math.pow(0.8, exponent)).toFixed(1)
                : Math.exp(factor * 0.8).toFixed(1)}
          </div>
        </div>
      )}
    </div>
  );
}

function ServerConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'server' };
  update: (p: Record<string, unknown>) => void;
}) {
  const dist = config.serviceTimeDistribution;
  let meanServiceTime: number;
  switch (dist.type) {
    case 'uniform':
      meanServiceTime = (dist.min + dist.max) / 2;
      break;
    case 'exponential':
      meanServiceTime = dist.mean;
      break;
    case 'log-normal':
      meanServiceTime = Math.exp(dist.mu + (dist.sigma * dist.sigma) / 2);
      break;
  }
  const approxTps = meanServiceTime > 0 ? config.concurrencyLimit / meanServiceTime : Infinity;

  return (
    <>
      <DistributionFields
        label="Service Time"
        dist={config.serviceTimeDistribution}
        onChange={(d) => update({ serviceTimeDistribution: d })}
      />
      <NumberField
        label="Concurrency Limit"
        value={config.concurrencyLimit}
        onChange={(v) => update({ concurrencyLimit: v })}
        info="Max requests processed simultaneously. Arrivals beyond this are rejected — use an explicit Queue component upstream for buffering."
      />
      <div className="text-[11px] text-muted-foreground mb-3 -mt-1">
        ≈ {isFinite(approxTps) ? approxTps.toFixed(0) : '∞'} req/s max throughput
        (mean service time: {(meanServiceTime * 1000).toFixed(1)}ms)
      </div>
      <LoadDependentLatencyFields
        value={config.loadDependentLatency}
        onChange={(v) => update({ loadDependentLatency: v })}
      />
    </>
  );
}

function DatabaseConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'database' };
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <>
      <DistributionFields
        label="Read Latency"
        dist={config.readLatencyDistribution}
        onChange={(d) => update({ readLatencyDistribution: d })}
      />
      <DistributionFields
        label="Write Latency"
        dist={config.writeLatencyDistribution}
        onChange={(d) => update({ writeLatencyDistribution: d })}
      />
      <NumberField
        label="Connection Pool Size"
        value={config.connectionPoolSize}
        onChange={(v) => update({ connectionPoolSize: v })}
        info="Max concurrent database connections. Requests beyond this queue until a connection is freed."
      />
      <LoadDependentLatencyFields
        value={config.loadDependentLatency}
        onChange={(v) => update({ loadDependentLatency: v })}
      />
    </>
  );
}

function CacheConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'cache' };
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <>
      <NumberField
        label="Hit Rate (0-1, fallback when no key)"
        value={config.hitRate}
        onChange={(v) => update({ hitRate: v })}
        info="Probabilistic hit rate used only when requests have no cache key."
      />
      <NumberField
        label="TTL (seconds, 0 = no expiry)"
        value={config.ttl ?? 0}
        onChange={(v) => update({ ttl: v > 0 ? v : undefined })}
        info="Time-to-live for cached entries. 0 means entries never expire."
      />
      <NumberField
        label="Max Size (0 = unbounded)"
        value={config.maxSize ?? 0}
        onChange={(v) => update({ maxSize: v > 0 ? v : undefined })}
        info="Maximum number of entries in the cache. When full, the eviction policy removes an entry to make room."
      />
      <SelectField
        label="Eviction Policy"
        value={config.evictionPolicy ?? 'lru'}
        options={[
          { value: 'lru', label: 'LRU' },
          { value: 'fifo', label: 'FIFO' },
        ]}
        onChange={(v) => update({ evictionPolicy: v })}
        info="LRU evicts the least recently accessed entry. FIFO evicts the oldest inserted entry."
      />
    </>
  );
}

function LoadBalancerConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'load-balancer' };
  update: (p: Record<string, unknown>) => void;
}) {
  return (
    <SelectField
      label="Strategy"
      value={config.strategy}
      options={[
        { value: 'round-robin', label: 'Round Robin' },
        { value: 'random', label: 'Random' },
        { value: 'least-connections', label: 'Least Connections' },
      ]}
      onChange={(v) => update({ strategy: v })}
      info="How requests are distributed across downstream components."
    />
  );
}

function QueueConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'queue' };
  update: (p: Record<string, unknown>) => void;
}) {
  const unlimited = config.maxCapacity === undefined;
  const unlimitedConcurrency = config.maxConcurrency === undefined;
  return (
    <>
      <label className="flex items-center gap-2 mb-2 cursor-pointer">
        <Checkbox
          checked={unlimited}
          onCheckedChange={(v) => update({ maxCapacity: v ? undefined : 1000 })}
        />
        <span className="text-[11px] text-foreground">Unlimited capacity</span>
      </label>
      {!unlimited && (
        <>
          <NumberField
            label="Max Capacity"
            value={config.maxCapacity!}
            onChange={(v) => update({ maxCapacity: v })}
            info="Maximum number of requests the queue can hold. Arrivals when the queue is full are rejected as failures."
          />
          <NumberField
            label="Load Shedding Threshold"
            value={config.loadSheddingThreshold ?? config.maxCapacity!}
            onChange={(v) => update({ loadSheddingThreshold: v })}
            info="Queue depth at which new arrivals start being rejected. Must be ≤ max capacity."
          />
        </>
      )}
      <label className="flex items-center gap-2 mb-2 cursor-pointer">
        <Checkbox
          checked={unlimitedConcurrency}
          onCheckedChange={(v) => update({ maxConcurrency: v ? undefined : 10 })}
        />
        <span className="text-[11px] text-foreground">Unlimited concurrency</span>
      </label>
      {!unlimitedConcurrency && (
        <NumberField
          label="Max Concurrency"
          value={config.maxConcurrency!}
          onChange={(v) => update({ maxConcurrency: v })}
          info="Max items sent to downstream concurrently. Match this to the downstream server's concurrency limit."
        />
      )}
    </>
  );
}

function ThrottleConfigFields({
  config,
  update,
}: {
  config: ComponentConfig & { type: 'throttle' };
  update: (p: Record<string, unknown>) => void;
}) {
  const mode = config.mode;
  return (
    <>
      <SelectField
        label="Throttle Mode"
        value={mode.type}
        options={[
          { value: 'disabled', label: 'Disabled (pass-through)' },
          { value: 'concurrency', label: 'Max Concurrency' },
          { value: 'rps', label: 'Max Requests/s (EWMA)' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            disabled: { type: 'disabled' },
            concurrency: { type: 'concurrency', maxConcurrency: 10 },
            rps: { type: 'rps', maxRps: 100, ewmaHalfLife: 1 },
          };
          update({ mode: defaults[v] });
        }}
        info="Disabled: all requests pass through. Concurrency: reject when in-flight count exceeds limit. RPS: reject when EWMA of arrival rate exceeds limit."
      />
      {mode.type === 'concurrency' && (
        <NumberField
          label="Max Concurrency"
          value={mode.maxConcurrency}
          onChange={(v) => update({ mode: { ...mode, maxConcurrency: v } })}
          info="Maximum in-flight requests to downstream. Arrivals beyond this are immediately rejected."
        />
      )}
      {mode.type === 'rps' && (
        <>
          <NumberField
            label="Max RPS"
            value={mode.maxRps}
            onChange={(v) => update({ mode: { ...mode, maxRps: v } })}
            info="Maximum allowed requests per second. When the EWMA of the arrival rate exceeds this, new arrivals are rejected."
          />
          <NumberField
            label="EWMA Half-Life (s)"
            value={mode.ewmaHalfLife}
            onChange={(v) => update({ mode: { ...mode, ewmaHalfLife: v } })}
            info="How quickly the rate estimate reacts to changes."
          />
        </>
      )}
    </>
  );
}
