import { useState } from 'react';
import { useSimulationStore } from '../stores/simulation-store';
import { useArchitectureStore } from '../stores/architecture-store';
import type { FailureScenario } from '../types';

type ScenarioType = FailureScenario['type'];

const SCENARIO_LABELS: Record<ScenarioType, string> = {
  'server-crash': 'Server Crash',
  'latency-spike': 'Latency Spike',
  'cpu-reduction': 'CPU Reduction',
  'network-partition': 'Network Partition',
  'cache-flush': 'Cache Flush',
};

function describeScenario(
  s: FailureScenario,
  labelOf: (id: string) => string,
): string {
  switch (s.type) {
    case 'server-crash':
      return `Crash ${labelOf(s.targetId)} at t=${s.triggerTime}, recover at t=${s.recoveryTime}`;
    case 'latency-spike':
      return `${s.factor}× latency on ${labelOf(s.targetId)} at t=${s.triggerTime} for ${s.duration}s`;
    case 'cpu-reduction':
      return `${s.reductionPercent}% CPU cut on ${labelOf(s.targetId)} at t=${s.triggerTime} for ${s.duration}s`;
    case 'network-partition':
      return `Partition ${s.connectionId} at t=${s.triggerTime} for ${s.duration}s`;
    case 'cache-flush':
      return `Flush ${labelOf(s.targetId)} at t=${s.triggerTime}`;
  }
}

export function FailureScenariosPanel() {
  const scenarios = useSimulationStore((s) => s.failureScenarios);
  const addScenario = useSimulationStore((s) => s.addFailureScenario);
  const removeScenario = useSimulationStore((s) => s.removeFailureScenario);
  const status = useSimulationStore((s) => s.status);

  const components = useArchitectureStore((s) => s.components);
  const connections = useArchitectureStore((s) => s.connections);

  const [type, setType] = useState<ScenarioType>('server-crash');
  const [targetId, setTargetId] = useState('');
  const [triggerTime, setTriggerTime] = useState(3);
  const [duration, setDuration] = useState(1);
  const [factor, setFactor] = useState(10);
  const [reductionPercent, setReductionPercent] = useState(50);
  const [expanded, setExpanded] = useState(true);

  const isRunning = status === 'running' || status === 'paused';

  const labelOf = (id: string) => {
    const c = components.find((comp) => comp.id === id);
    return c ? c.label : id;
  };

  // Filter targets based on scenario type
  const serverComponents = components.filter(
    (c) => c.type === 'server' || c.type === 'database',
  );
  const cacheComponents = components.filter((c) => c.type === 'cache');
  const targetOptions =
    type === 'network-partition'
      ? connections.map((c) => ({ value: c.id, label: `${c.sourceId} → ${c.targetId}` }))
      : type === 'cache-flush'
        ? cacheComponents.map((c) => ({ value: c.id, label: c.label || c.id }))
        : serverComponents.map((c) => ({ value: c.id, label: c.label || c.id }));

  const handleAdd = () => {
    const target = targetId || targetOptions[0]?.value;
    if (!target) return;

    let scenario: FailureScenario;
    switch (type) {
      case 'server-crash':
        scenario = { type, targetId: target, triggerTime, recoveryTime: triggerTime + duration };
        break;
      case 'latency-spike':
        scenario = { type, targetId: target, triggerTime, duration, factor };
        break;
      case 'cpu-reduction':
        scenario = { type, targetId: target, triggerTime, duration, reductionPercent };
        break;
      case 'network-partition':
        scenario = { type, connectionId: target, triggerTime, duration };
        break;
      case 'cache-flush':
        scenario = { type, targetId: target, triggerTime };
        break;
    }
    addScenario(scenario);
  };

  return (
    <div style={{ fontSize: 13, padding: '0 14px 14px' }}>
      <div
        style={{ cursor: 'pointer', fontWeight: 700, padding: '4px 0', userSelect: 'none', color: '#fff' }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? '▾' : '▸'} Failure Scenarios ({scenarios.length})
      </div>

      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Existing scenarios */}
          {scenarios.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                background: '#2a2a4a', padding: '6px 10px', borderRadius: 6,
                border: '1px solid #3a3a5a',
              }}
            >
              <span style={{
                fontSize: 11, lineHeight: 1, opacity: 0.5, marginRight: 2,
              }}>⚡</span>
              <span style={{ flex: 1, color: '#c8c8d8', fontSize: 12 }}>{describeScenario(s, labelOf)}</span>
              <button
                onClick={() => removeScenario(i)}
                disabled={isRunning}
                style={{
                  fontSize: 10, padding: '2px 6px', background: 'none',
                  border: '1px solid #3a3a5a', borderRadius: 4, cursor: 'pointer',
                  color: '#6b6b8a',
                }}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}

          {/* Add form */}
          {!isRunning && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as ScenarioType);
                    setTargetId('');
                  }}
                  style={{ flex: 1 }}
                >
                  {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((t) => (
                    <option key={t} value={t}>{SCENARIO_LABELS[t]}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ minWidth: 44 }}>Target:</label>
                <select
                  value={targetId || targetOptions[0]?.value || ''}
                  onChange={(e) => setTargetId(e.target.value)}
                  style={{ flex: 1 }}
                >
                  {targetOptions.length === 0 && (
                    <option value="">No targets available</option>
                  )}
                  {targetOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <label style={{ minWidth: 44 }}>At t=</label>
                <input
                  type="number" min={0} step={0.1} value={triggerTime}
                  onChange={(e) => setTriggerTime(Number(e.target.value))}
                  style={{ width: 56 }}
                />
                <label>for</label>
                <input
                  type="number" min={0.01} step={0.1} value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  style={{ width: 56 }}
                />
                <span>s</span>
              </div>

              {type === 'latency-spike' && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <label style={{ minWidth: 44 }}>Factor:</label>
                  <input
                    type="number" min={1} step={1} value={factor}
                    onChange={(e) => setFactor(Number(e.target.value))}
                    style={{ width: 56 }}
                  />
                  <span>× latency</span>
                </div>
              )}

              {type === 'cpu-reduction' && (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <label style={{ minWidth: 44 }}>Cut:</label>
                  <input
                    type="number" min={1} max={100} step={5} value={reductionPercent}
                    onChange={(e) => setReductionPercent(Number(e.target.value))}
                    style={{ width: 56 }}
                  />
                  <span>%</span>
                </div>
              )}

              <button
                onClick={handleAdd}
                disabled={targetOptions.length === 0}
                style={{ alignSelf: 'flex-start', padding: '2px 10px' }}
              >
                + Add Failure
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
