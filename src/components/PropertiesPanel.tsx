import { useArchitectureStore } from '../stores/architecture-store';
import { useUIStore } from '../stores/ui-store';
import type { ComponentConfig, ComponentDefinition, ConnectionDefinition } from '../types';

const panelStyle: React.CSSProperties = {
  padding: 12,
  fontSize: 13,
  overflowY: 'auto',
};

const headerStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 10,
  color: '#fff',
};

const fieldStyle: React.CSSProperties = {
  marginBottom: 10,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: '#8888aa',
  marginBottom: 3,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  fontSize: 13,
  border: '1px solid #3a3a5a',
  borderRadius: 5,
  boxSizing: 'border-box',
  maxWidth: '100%',
  background: '#2a2a4a',
  color: '#e8e8e8',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const btnDanger: React.CSSProperties = {
  marginTop: 12,
  padding: '6px 14px',
  background: '#8b3a3a',
  color: '#fff',
  border: '1px solid #a04a4a',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
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
    if (!comp) return <div style={panelStyle}>Component not found</div>;
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>{comp.label} ({comp.type})</div>
        <ComponentConfigEditor key={comp.id} component={comp} onUpdate={updateComponentConfig} />
        <div style={fieldStyle}>
          <span style={labelStyle}>Notes</span>
          <textarea
            className="sim-input"
            value={comp.notes ?? ''}
            onChange={(e) => updateComponentNotes(comp.id, e.target.value)}
            placeholder="Add a note..."
            rows={2}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </div>
        <button
          style={btnDanger}
          onClick={() => {
            removeComponent(comp.id);
            selectComponent(null);
          }}
        >
          Remove Component
        </button>
      </div>
    );
  }

  if (selectedConnectionId) {
    const conn = connections.find((c) => c.id === selectedConnectionId);
    if (!conn) return <div style={panelStyle}>Connection not found</div>;
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
    <div style={panelStyle}>
      <div style={headerStyle}>Properties</div>
      <div style={{ color: '#6b6b8a', fontSize: 13 }}>Select a component or connection to edit.</div>
    </div>
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
    <div style={panelStyle}>
      <div style={headerStyle}>Connection</div>
      <div style={fieldStyle}>
        <span style={labelStyle}>Source</span>
        <div>{source?.label ?? conn.sourceId}</div>
      </div>
      <div style={fieldStyle}>
        <span style={labelStyle}>Target</span>
        <div>{target?.label ?? conn.targetId}</div>
      </div>
      <button style={btnDanger} onClick={onDelete}>
        Delete Connection
      </button>
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

function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: 'inline-block',
        marginLeft: 4,
        width: 14,
        height: 14,
        lineHeight: '14px',
        textAlign: 'center',
        fontSize: 9,
        fontWeight: 700,
        borderRadius: '50%',
        background: '#3a3a5a',
        color: '#8888aa',
        cursor: 'help',
        verticalAlign: 'middle',
        userSelect: 'none',
      }}
    >
      i
    </span>
  );
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
    <div style={fieldStyle}>
      <span style={labelStyle}>{label}{info && <InfoTip text={info} />}</span>
      <input
        style={inputStyle}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
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
    <div style={fieldStyle}>
      <span style={labelStyle}>{label}{info && <InfoTip text={info} />}</span>
      <select style={selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
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
            'ramping': { type: 'ramping', startRate: 10, endRate: 200, duration: 100 },
            'burst': { type: 'burst', count: 50, atTime: 10 },
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
            info="Average requests per second. Actual inter-arrival times are exponentially distributed around this rate. Higher values increase load on downstream components."
          />
          <NumberField
            label="Ramp-Up Time (s, 0 = instant)"
            value={tp.rampUpTime ?? 0}
            onChange={(v) => update({ trafficPattern: { ...tp, rampUpTime: v > 0 ? v : undefined } })}
            info="Linearly increases the arrival rate from 0 to the mean rate over this duration. Useful for warming caches before injecting failures. 0 means full rate from the start."
          />
        </>
      )}
      {tp.type === 'closed-loop' && (
        <>
          <NumberField
            label="Think Time (s)"
            value={tp.thinkTime}
            onChange={(v) => update({ trafficPattern: { ...tp, thinkTime: v } })}
            info="Delay between receiving a response and sending the next request. Models user think time. Lower values increase sustained load."
          />
          <NumberField
            label="Max Concurrency"
            value={tp.maxConcurrency}
            onChange={(v) => update({ trafficPattern: { ...tp, maxConcurrency: v } })}
            info="Maximum number of requests in flight simultaneously. Each slot sends a new request only after the previous one completes (or times out). Limits peak load on the system."
          />
        </>
      )}
      {tp.type === 'ramping' && (
        <>
          <NumberField
            label="Start Rate (req/s)"
            value={tp.startRate}
            onChange={(v) => update({ trafficPattern: { ...tp, startRate: v } })}
            info="Arrival rate at the beginning of the ramp. Rate increases linearly from here to the end rate."
          />
          <NumberField
            label="End Rate (req/s)"
            value={tp.endRate}
            onChange={(v) => update({ trafficPattern: { ...tp, endRate: v } })}
            info="Arrival rate at the end of the ramp. Traffic generation stops after the duration elapses."
          />
          <NumberField
            label="Duration (s)"
            value={tp.duration}
            onChange={(v) => update({ trafficPattern: { ...tp, duration: v } })}
            info="How long the ramp lasts. The rate interpolates linearly from start to end over this period. No traffic is generated after this time."
          />
        </>
      )}
      {tp.type === 'burst' && (
        <>
          <NumberField
            label="Count (requests)"
            value={tp.count}
            onChange={(v) => update({ trafficPattern: { ...tp, count: v } })}
            info="Total number of requests to send in the burst. All are scheduled at the same simulation time."
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
        info="Number of distinct cache keys (e.g. customers or products). Each request gets a random key from this pool. Downstream caches use these keys for hit/miss decisions. 0 disables key-based caching."
      />
      <SelectField
        label="Retry Strategy"
        value={config.retryStrategy.type}
        info="How the client handles failed or timed-out requests. Fixed-N retries up to N times. Token-bucket limits retry rate globally. Circuit-breaker stops retrying when failure rate is high."
        options={[
          { value: 'none', label: 'None' },
          { value: 'fixed-n', label: 'Fixed N' },
          { value: 'token-bucket', label: 'Token Bucket' },
          { value: 'circuit-breaker', label: 'Circuit Breaker' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            'none': { type: 'none' },
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
          info="Maximum number of retry attempts per request. After this many failures the request is dropped."
        />
      )}
      {config.retryStrategy.type === 'token-bucket' && (
        <>
          <NumberField
            label="Bucket Capacity"
            value={config.retryStrategy.capacity}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, capacity: v } })}
            info="Maximum number of retry tokens. The bucket starts full. Each retry consumes one token. When empty, no retries are allowed."
          />
          <NumberField
            label="Deposit per Success"
            value={config.retryStrategy.depositAmount}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, depositAmount: v } })}
            info="Tokens added to the bucket on each successful response. Controls how quickly retry capacity recovers after a failure."
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
            info="Sliding window duration for measuring failure rate. Only events within this window count toward the threshold."
          />
          <NumberField
            label="Failure Threshold (0-1)"
            value={config.retryStrategy.failureThreshold}
            onChange={(v) => update({ retryStrategy: { ...config.retryStrategy, failureThreshold: v } })}
            info="Failure rate (0-1) that opens the circuit. When the rate in the sliding window exceeds this, all retries are blocked."
          />
        </>
      )}
      <NumberField
        label="Timeout (s)"
        value={config.timeout ?? 1}
        onChange={(v) => update({ timeout: v > 0 ? v : undefined })}
        info="Max time to wait for a response before treating the request as failed. Timed-out requests may trigger retries. Interacts with server/DB latency — if service time exceeds this, requests will fail."
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
        info="Probability distribution for sampling times. Uniform: equal chance between min and max. Exponential: memoryless, good for inter-arrival times. Log-normal: heavy-tailed, models real-world latency well."
        options={[
          { value: 'uniform', label: 'Uniform' },
          { value: 'exponential', label: 'Exponential' },
          { value: 'log-normal', label: 'Log-Normal' },
        ]}
        onChange={(v) => {
          const defaults: Record<string, unknown> = {
            'uniform': { type: 'uniform', min: 0.001, max: 0.01 },
            'exponential': { type: 'exponential', mean: 0.005 },
            'log-normal': { type: 'log-normal', mu: -5, sigma: 0.5 },
          };
          onChange(defaults[v] as Record<string, unknown>);
        }}
      />
      {dist.type === 'uniform' && (
        <>
          <NumberField label="Min" value={dist.min as number} onChange={(v) => onChange({ ...dist, min: v })}
            info="Minimum possible value (seconds). Every sample is equally likely between min and max." />
          <NumberField label="Max" value={dist.max as number} onChange={(v) => onChange({ ...dist, max: v })}
            info="Maximum possible value (seconds). Mean is (min+max)/2." />
        </>
      )}
      {dist.type === 'exponential' && (
        <NumberField label="Mean" value={dist.mean as number} onChange={(v) => onChange({ ...dist, mean: v })}
          info="Average value in seconds. Exponential distributions are memoryless — most samples are below the mean, with occasional long tails." />
      )}
      {dist.type === 'log-normal' && (
        <>
          <NumberField label="Mu" value={dist.mu as number} onChange={(v) => onChange({ ...dist, mu: v })}
            info="Log-space mean. The real-space mean is exp(μ + σ²/2). More negative values give smaller times." />
          <NumberField label="Sigma" value={dist.sigma as number} onChange={(v) => onChange({ ...dist, sigma: v })}
            info="Log-space standard deviation. Larger values produce heavier tails (more variance, more outliers)." />
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
    <div style={{ border: '1px solid #3a3a5a', borderRadius: 6, padding: 8, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: enabled ? 6 : 0 }}>
        <input
          className="sim-checkbox"
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? { mode: 'linear', factor: 1 } : undefined)}
        />
        <span style={{ fontSize: 11, fontWeight: 600, color: '#c8c8d8' }}>Load-Dependent Latency</span>
      </div>
      {enabled && (
        <>
          <SelectField
            label="Mode"
            value={mode}
            options={[
              { value: 'linear', label: 'Linear: base × (1 + f·u)' },
              { value: 'polynomial', label: 'Polynomial: base × (1 + f·uⁿ)' },
              { value: 'exponential', label: 'Exponential: base × eᶠᵘ' },
            ]}
            onChange={(v) => onChange({ ...value!, mode: v })}
            info="How latency scales with utilization (u). Linear grows steadily. Polynomial stays flat at low utilization then spikes near saturation. Exponential grows aggressively — small utilization increases cause large latency jumps."
          />
          <NumberField
            label="Factor (f)"
            value={factor}
            onChange={(v) => onChange({ ...value!, factor: v })}
            info="Scaling multiplier. Higher values make latency more sensitive to utilization. At factor=1 linear mode doubles latency at 100% utilization."
          />
          {mode === 'polynomial' && (
            <NumberField
              label="Exponent (n)"
              value={exponent}
              onChange={(v) => onChange({ ...value!, exponent: v })}
              info="Controls the shape of the curve. Higher exponents keep latency flat at low utilization but cause a sharper spike near saturation. n=2 is quadratic, n=3 is cubic."
            />
          )}
          <div style={{ fontSize: 10, color: '#6b6b8a', marginTop: 2 }}>
            u = utilization (0–1). At 80% util, latency ×{' '}
            {mode === 'linear'
              ? (1 + factor * 0.8).toFixed(1)
              : mode === 'polynomial'
                ? (1 + factor * Math.pow(0.8, exponent)).toFixed(1)
                : Math.exp(factor * 0.8).toFixed(1)}
          </div>
        </>
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
  // Compute approximate TPS from distribution mean and concurrency
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
  const approxTps = meanServiceTime > 0
    ? config.concurrencyLimit / meanServiceTime
    : Infinity;

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
      <div style={{ ...fieldStyle, fontSize: 11, color: '#6b6b8a' }}>
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
        info="Max concurrent database connections. Requests beyond this queue until a connection is freed. Utilization = active connections / pool size, which drives load-dependent latency scaling."
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
        info="Probabilistic hit rate used only when requests have no cache key. When keys are present, hits are determined by whether the key exists in the cache and hasn't expired."
      />
      <NumberField
        label="TTL (seconds, 0 = no expiry)"
        value={config.ttl ?? 0}
        onChange={(v) => update({ ttl: v > 0 ? v : undefined })}
        info="Time-to-live for cached entries. After this duration, the entry expires and the next request for that key is a miss. Shorter TTLs increase downstream load. 0 means entries never expire."
      />
      <NumberField
        label="Max Size (0 = unbounded)"
        value={config.maxSize ?? 0}
        onChange={(v) => update({ maxSize: v > 0 ? v : undefined })}
        info="Maximum number of entries in the cache. When full, the eviction policy removes an entry to make room. If smaller than the number of distinct keys, some keys will always miss."
      />
      <SelectField
        label="Eviction Policy"
        value={config.evictionPolicy ?? 'lru'}
        options={[
          { value: 'lru', label: 'LRU' },
          { value: 'fifo', label: 'FIFO' },
        ]}
        onChange={(v) => update({ evictionPolicy: v })}
        info="How to choose which entry to remove when the cache is full. LRU evicts the least recently accessed entry. FIFO evicts the oldest inserted entry regardless of access pattern."
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
      info="How requests are distributed across downstream components. Round-robin cycles in order. Random picks uniformly. Least-connections sends to the downstream with the fewest in-flight requests."
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer' }}>
        <input
          className="sim-checkbox"
          type="checkbox"
          checked={unlimited}
          onChange={(e) => update({ maxCapacity: e.target.checked ? undefined : 1000 })}
        />
        <span style={{ fontSize: 11, color: '#c8c8d8' }}>Unlimited capacity</span>
      </label>
      {!unlimited && (
        <>
          <NumberField
            label="Max Capacity"
            value={config.maxCapacity!}
            onChange={(v) => update({ maxCapacity: v })}
            info="Maximum number of requests the queue can hold. Arrivals when the queue is full are rejected as failures. Larger queues absorb bursts but increase latency under sustained overload."
          />
          <NumberField
            label="Load Shedding Threshold"
            value={config.loadSheddingThreshold ?? config.maxCapacity!}
            onChange={(v) => update({ loadSheddingThreshold: v })}
            info="Queue depth at which new arrivals start being rejected. Must be ≤ max capacity. Allows early rejection before the queue is completely full, reducing latency for accepted requests."
          />
        </>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer' }}>
        <input
          className="sim-checkbox"
          type="checkbox"
          checked={unlimitedConcurrency}
          onChange={(e) => update({ maxConcurrency: e.target.checked ? undefined : 10 })}
        />
        <span style={{ fontSize: 11, color: '#c8c8d8' }}>Unlimited concurrency</span>
      </label>
      {!unlimitedConcurrency && (
        <NumberField
          label="Max Concurrency"
          value={config.maxConcurrency!}
          onChange={(v) => update({ maxConcurrency: v })}
          info="Max items sent to downstream concurrently. Match this to the downstream server's concurrency limit so the queue actually buffers. Excess arrivals wait in the queue."
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
  return (
    <NumberField
      label="Max Concurrency"
      value={config.maxConcurrency}
      onChange={(v) => update({ maxConcurrency: v })}
      info="Maximum in-flight requests to downstream. Arrivals beyond this are immediately rejected as failures — no buffering, no queueing delay."
    />
  );
}
