import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  StepForward,
  Square,
  FastForward,
} from 'lucide-react';
import { WorkerBridge } from '../engine/worker-bridge';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import { useArchitectureStore } from '../stores/architecture-store';
import type { Architecture, SimulationConfig } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Slider } from './ui/slider';
import { Checkbox } from './ui/checkbox';
import { Separator } from './ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';

const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400',
  paused: 'text-amber-400',
  idle: 'text-muted-foreground',
  completed: 'text-muted-foreground',
};

interface IconButtonProps {
  onClick: () => void;
  disabled?: boolean;
  tooltip: string;
  variant?: 'default' | 'primary';
  children: React.ReactNode;
}

function IconButton({ onClick, disabled, tooltip, variant = 'default', children }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant={variant === 'primary' ? 'default' : 'outline'}
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

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <IconButton onClick={handlePlay} disabled={isRunning} tooltip="Play / Resume" variant="primary">
          <Play strokeWidth={2.5} />
        </IconButton>
        <IconButton onClick={handlePause} disabled={!isRunning} tooltip="Pause">
          <Pause strokeWidth={2.5} />
        </IconButton>
        <IconButton onClick={handleStep} tooltip="Step (one event)">
          <StepForward strokeWidth={2.5} />
        </IconButton>
        <IconButton onClick={handleReset} tooltip="Reset">
          <Square strokeWidth={2.5} />
        </IconButton>
        <IconButton
          onClick={handleRunToEnd}
          disabled={isRunning || status === 'completed'}
          tooltip="Run to end (max speed)"
        >
          <FastForward strokeWidth={2.5} />
        </IconButton>
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
        <span className="min-w-[36px] text-xs tabular-nums text-foreground">
          {speedMultiplier.toFixed(1)}×
        </span>
      </div>

      <Separator orientation="vertical" />

      {/* Duration */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Duration (s)</span>
        <Input
          type="number"
          min={1}
          value={endTime}
          onChange={(e) => setEndTime(Number(e.target.value))}
          disabled={isRunning || isPaused}
          className="w-16 tabular-nums"
        />
      </div>

      {/* Seed */}
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">Seed</span>
        <Input
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
          disabled={isRunning || isPaused || randomSeed}
          className="w-24 tabular-nums"
        />
        <label className="flex items-center gap-1 cursor-pointer" title="Use a random seed each run">
          <Checkbox
            checked={randomSeed}
            onCheckedChange={(v) => setRandomSeed(v === true)}
            disabled={isRunning || isPaused}
          />
          <span className="text-[11px] text-muted-foreground">Random</span>
        </label>
      </div>

      <Separator orientation="vertical" />

      {/* Status */}
      <span className="text-xs tabular-nums">
        t={currentTime.toFixed(2)}s{' '}
        <span className={cn('font-semibold', STATUS_COLORS[status])}>{status}</span>
      </span>
    </div>
  );
}
