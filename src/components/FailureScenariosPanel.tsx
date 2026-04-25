import { useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X, Zap } from 'lucide-react';
import { useSimulationStore } from '../stores/simulation-store';
import { useArchitectureStore } from '../stores/architecture-store';
import type { FailureScenario } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

type ScenarioType = FailureScenario['type'];

const SCENARIO_LABELS: Record<ScenarioType, string> = {
  'server-crash': 'Server Crash',
  'latency-spike': 'Latency Spike',
  'cpu-reduction': 'CPU Reduction',
  'network-partition': 'Network Partition',
  'cache-flush': 'Cache Flush',
  'random-error': 'Random Error',
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
    case 'random-error':
      return `${(s.errorRate * 100).toFixed(0)}% errors on ${labelOf(s.targetId)} at t=${s.triggerTime} for ${s.duration}s`;
  }
}

function FieldLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`text-[11px] font-medium text-muted-foreground ${className}`}>{children}</span>
  );
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
  const [errorRate, setErrorRate] = useState(0.1);
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
  const serverAndLbComponents = components.filter(
    (c) => c.type === 'server' || c.type === 'load-balancer',
  );
  const cacheComponents = components.filter((c) => c.type === 'cache');
  const targetOptions =
    type === 'network-partition'
      ? connections.map((c) => ({ value: c.id, label: `${c.sourceId} → ${c.targetId}` }))
      : type === 'cache-flush'
        ? cacheComponents.map((c) => ({ value: c.id, label: c.label || c.id }))
        : type === 'random-error'
          ? serverAndLbComponents.map((c) => ({ value: c.id, label: c.label || c.id }))
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
      case 'random-error':
        scenario = { type, targetId: target, triggerTime, duration, errorRate };
        break;
    }
    addScenario(scenario);
  };

  return (
    <div className="px-3 pb-3 border-t border-border pt-3">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <CollapsibleTrigger asChild>
          <button
            className="flex items-center gap-1 w-full text-left text-sm font-semibold text-foreground py-1 hover:text-foreground/80"
            aria-label="Toggle failure scenarios"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <span>Failure Scenarios</span>
            <span className="text-muted-foreground font-normal">({scenarios.length})</span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="flex flex-col gap-2 mt-2">
          {scenarios.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-destructive/15 border border-destructive/40 text-destructive-foreground"
            >
              <Zap className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="flex-1 text-xs leading-snug">
                {describeScenario(s, labelOf)}
              </span>
              <Button
                variant="ghost"
                size="iconSm"
                onClick={() => removeScenario(i)}
                disabled={isRunning}
                aria-label="Remove"
                className="h-5 w-5 hover:bg-destructive/30"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {!isRunning && (
            <div className="flex flex-col gap-2 mt-1">
              <Select value={type} onValueChange={(v) => { setType(v as ScenarioType); setTargetId(''); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SCENARIO_LABELS) as ScenarioType[]).map((t) => (
                    <SelectItem key={t} value={t}>{SCENARIO_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2">
                <FieldLabel className="min-w-11">Target</FieldLabel>
                {targetOptions.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic flex-1">No targets available</span>
                ) : (
                  <Select
                    value={targetId || targetOptions[0]?.value || ''}
                    onValueChange={setTargetId}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {targetOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="flex items-center gap-2">
                <FieldLabel className="min-w-11">At t=</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={triggerTime}
                  onChange={(e) => setTriggerTime(Number(e.target.value))}
                  className="w-16 tabular-nums"
                />
                <FieldLabel>for</FieldLabel>
                <Input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-16 tabular-nums"
                />
                <FieldLabel>s</FieldLabel>
              </div>

              {type === 'latency-spike' && (
                <div className="flex items-center gap-2">
                  <FieldLabel className="min-w-11">Factor</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={factor}
                    onChange={(e) => setFactor(Number(e.target.value))}
                    className="w-16 tabular-nums"
                  />
                  <FieldLabel>× latency</FieldLabel>
                </div>
              )}

              {type === 'cpu-reduction' && (
                <div className="flex items-center gap-2">
                  <FieldLabel className="min-w-11">Cut</FieldLabel>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step={5}
                    value={reductionPercent}
                    onChange={(e) => setReductionPercent(Number(e.target.value))}
                    className="w-16 tabular-nums"
                  />
                  <FieldLabel>%</FieldLabel>
                </div>
              )}

              {type === 'random-error' && (
                <div className="flex items-center gap-2">
                  <FieldLabel className="min-w-11">Rate</FieldLabel>
                  <Input
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.05}
                    value={errorRate}
                    onChange={(e) => setErrorRate(Number(e.target.value))}
                    className="w-16 tabular-nums"
                  />
                  <FieldLabel>({(errorRate * 100).toFixed(0)}% of requests fail)</FieldLabel>
                </div>
              )}

              <Button
                size="sm"
                variant="outline"
                onClick={handleAdd}
                disabled={targetOptions.length === 0}
                className="self-start"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Failure
              </Button>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
