import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  StepForward,
  Square,
  FastForward,
  Shuffle,
} from 'lucide-react';
import { WorkerBridge } from '../engine/worker-bridge';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import { useArchitectureStore } from '../stores/architecture-store';
import type { Architecture, SimulationConfig } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  paused: { label: 'Paused', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  idle: { label: 'Idle', className: 'bg-muted text-muted-foreground border-border' },
  completed: { label: 'Done', className: 'bg-muted text-muted-foreground border-border' },
};

interface IconBtnProps {
  onClick: () => void;
  disabled?: boolean;
  tooltip: string;
  primary?: boolean;
  children: React.ReactNode;
}

function IconBtn({ onClick, disabled, tooltip, primary, children }: IconBtnProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="iconSm"
          variant={primary ? 'default' : 'ghost'}
          onClick={onClick}
          disabled={disabled}
          aria-label={tooltip}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function SimulationControls() {
  const bridgeRef = useRef<WorkerBridge | null>(null);

  const status = useSimulationStore((s) => s.status);
  const currentTime = useSimulationStore((s) => s.currentTime);
  const speedMultiplier = useSimulationStore((s) => s.speedMultiplier);
  const simulationConfig = useSimulationStore((s) => s.simulationConfig);
  const setStatus = useSimulationStore((s) => s.setStatus);
  const setCurrentTime = useSimulationStore((s) => s.setCurrentTime);
  const setSpeed = useSimulationStore((s) => s.setSpeed);

  const resetMetrics = useMetricsStore((s) => s.reset);

  const [endTime, setEndTime] = useState(60);
  const [seed, setSeed] = useState(42);
  const [randomSeed, setRandomSeed] = useState(true);

  useEffect(() => {
    if (simulationConfig) {
      setEndTime(simulationConfig.endTime);
      setSeed(simulationConfig.seed);
      setRandomSeed(false);
    }
  }, [simulationConfig]);

  const getEffectiveSeed = useCallback((): number => {
    if (randomSeed) {
      const s = Math.floor(Math.random() * 2 ** 32);
      setSeed(s);
      return s;
    }
    return seed;
  }, [randomSeed, seed]);

  const buildStartPayload = useCallback(
    (effectiveSeed: number): { architecture: Architecture; config: SimulationConfig } => {
      const arch = useArchitectureStore.getState();
      const simStore = useSimulationStore.getState();
      const loadedConfig = simStore.simulationConfig;
      const storeScenarios = simStore.failureScenarios;
      const architecture: Architecture = {
        schemaVersion: 1,
        name: arch.name || 'Untitled',
        components: arch.components,
        connections: arch.connections,
      };
      const mergedScenarios = [
        ...(loadedConfig?.failureScenarios ?? []),
        ...storeScenarios,
      ];
      const config: SimulationConfig = {
        schemaVersion: loadedConfig?.schemaVersion ?? 1,
        name: loadedConfig?.name ?? 'default',
        endTime,
        metricsWindowSize: loadedConfig?.metricsWindowSize ?? 1,
        failureScenarios: mergedScenarios,
        seed: effectiveSeed,
      };
      return { architecture, config };
    },
    [endTime],
  );

  const getBridge = useCallback((): WorkerBridge => {
    if (!bridgeRef.current) {
      bridgeRef.current = new WorkerBridge({
        onMetrics: (snapshot) => {
          useMetricsStore.getState().pushSnapshot(snapshot);
          useSimulationStore.getState().setCurrentTime(snapshot.simTime);
        },
        onCompleted: () => {
          useSimulationStore.getState().setStatus('completed');
        },
        onPaused: (simTime) => {
          useSimulationStore.getState().setCurrentTime(simTime);
          useSimulationStore.getState().setStatus('paused');
        },
        onError: (message) => {
          console.error('[SimWorker]', message);
          useSimulationStore.getState().setStatus('idle');
        },
      });
    }
    return bridgeRef.current;
  }, []);

  useEffect(() => {
    return () => {
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
    };
  }, []);

  const handlePlay = useCallback(() => {
    const bridge = getBridge();
    if (status === 'paused') {
      bridge.resume();
      setStatus('running');
      return;
    }
    const s = getEffectiveSeed();
    const { architecture, config } = buildStartPayload(s);
    resetMetrics();
    setCurrentTime(0);
    bridge.start(architecture, config, s);
    bridge.setSpeed(useSimulationStore.getState().speedMultiplier);
    setStatus('running');
  }, [status, getEffectiveSeed, getBridge, buildStartPayload, setStatus, setCurrentTime, resetMetrics]);

  const handlePause = useCallback(() => {
    getBridge().pause();
  }, [getBridge]);

  const handleStep = useCallback(() => {
    const bridge = getBridge();
    if (status === 'idle' || status === 'completed') {
      const s = getEffectiveSeed();
      const { architecture, config } = buildStartPayload(s);
      resetMetrics();
      setCurrentTime(0);
      bridge.start(architecture, config, s);
      setStatus('paused');
    }
    bridge.step();
  }, [status, getEffectiveSeed, getBridge, buildStartPayload, setStatus, setCurrentTime, resetMetrics]);

  const handleReset = useCallback(() => {
    getBridge().reset();
    setStatus('idle');
    setCurrentTime(0);
    resetMetrics();
  }, [getBridge, setStatus, setCurrentTime, resetMetrics]);

  const handleSpeedChange = useCallback(
    (value: number) => {
      const clamped = Math.max(0.1, Math.min(100, value));
      setSpeed(clamped);
      if (bridgeRef.current) {
        bridgeRef.current.setSpeed(clamped);
      }
    },
    [setSpeed],
  );

  const handleRunToEnd = useCallback(() => {
    const bridge = getBridge();
    bridge.setSpeed(1e9);
    if (status === 'idle' || status === 'completed') {
      const s = getEffectiveSeed();
      const { architecture, config } = buildStartPayload(s);
      resetMetrics();
      setCurrentTime(0);
      bridge.start(architecture, config, s);
    } else {
      bridge.resume();
    }
    setStatus('running');
  }, [status, getEffectiveSeed, getBridge, buildStartPayload, setStatus, setCurrentTime, resetMetrics]);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const statusInfo = STATUS_VARIANT[status] ?? STATUS_VARIANT.idle;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Transport */}
      <div className="flex items-center gap-0.5 rounded-md bg-secondary/40 p-0.5">
        <IconBtn onClick={handlePlay} disabled={isRunning} tooltip="Play / Resume" primary={!isRunning && status !== 'completed'}>
          <Play strokeWidth={2.5} />
        </IconBtn>
        <IconBtn onClick={handlePause} disabled={!isRunning} tooltip="Pause">
          <Pause strokeWidth={2.5} />
        </IconBtn>
        <IconBtn onClick={handleStep} tooltip="Step (one event)">
          <StepForward strokeWidth={2.5} />
        </IconBtn>
        <IconBtn onClick={handleReset} tooltip="Reset">
          <Square strokeWidth={2.5} />
        </IconBtn>
        <IconBtn
          onClick={handleRunToEnd}
          disabled={isRunning || status === 'completed'}
          tooltip="Run to end (max speed)"
        >
          <FastForward strokeWidth={2.5} />
        </IconBtn>
      </div>

      <Separator orientation="vertical" />

      {/* Status + clock */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={cn('font-medium', statusInfo.className)}>
          {statusInfo.label}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">
          t={currentTime.toFixed(2)}s
        </span>
      </div>

      <Separator orientation="vertical" />

      {/* Speed */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">Speed</span>
        <Slider
          className="w-24"
          min={0.1}
          max={20}
          step={0.1}
          value={[speedMultiplier]}
          onValueChange={(v) => handleSpeedChange(v[0])}
          aria-label={`Speed ${speedMultiplier.toFixed(1)}×`}
        />
        <span className="min-w-[34px] text-xs tabular-nums">
          {speedMultiplier.toFixed(1)}×
        </span>
      </div>

      <Separator orientation="vertical" />

      {/* Run config: duration + seed grouped */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Duration</span>
          <Input
            type="number"
            min={1}
            value={endTime}
            onChange={(e) => setEndTime(Number(e.target.value))}
            disabled={isRunning || isPaused}
            className="w-14 tabular-nums"
            aria-label="Duration in seconds"
          />
          <span className="text-[11px] text-muted-foreground">s</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Seed</span>
          {randomSeed ? (
            <span className="flex h-8 w-24 items-center justify-center rounded-md border border-dashed border-border text-[11px] text-muted-foreground italic">
              random
            </span>
          ) : (
            <Input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              disabled={isRunning || isPaused}
              className="w-24 tabular-nums"
              aria-label="Seed"
            />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={randomSeed ? 'default' : 'outline'}
                size="iconSm"
                onClick={() => setRandomSeed((v) => !v)}
                disabled={isRunning || isPaused}
                aria-label="Toggle random seed"
              >
                <Shuffle strokeWidth={2.5} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{randomSeed ? 'Using random seed each run' : 'Click to use random seed'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
