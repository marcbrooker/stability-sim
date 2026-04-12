import { useCallback, useEffect, useRef, useState } from 'react';
import { WorkerBridge } from '../engine/worker-bridge';
import { useSimulationStore } from '../stores/simulation-store';
import { useMetricsStore } from '../stores/metrics-store';
import { useArchitectureStore } from '../stores/architecture-store';
import type { Architecture, SimulationConfig } from '../types';

/**
 * Simulation Controls bar — play/pause/step/reset, speed control,
 * simulation config (end time, seed), and current status display.
 *
 * Creates and owns the WorkerBridge instance, wiring callbacks to
 * the Zustand stores (simulation-store, metrics-store).
 *
 * When a SimulationConfig has been loaded (via Load Config), its
 * failureScenarios, endTime, seed, and metricsWindowSize are used
 * when starting the simulation.
 *
 * Validates: Requirements 9.1, 11.5, 12.1, 12.2, 12.3, 12.4, 12.5
 */
export function SimulationControls() {
  const bridgeRef = useRef<WorkerBridge | null>(null);

  // Simulation store
  const status = useSimulationStore((s) => s.status);
  const currentTime = useSimulationStore((s) => s.currentTime);
  const speedMultiplier = useSimulationStore((s) => s.speedMultiplier);
  const simulationConfig = useSimulationStore((s) => s.simulationConfig);
  const setStatus = useSimulationStore((s) => s.setStatus);
  const setCurrentTime = useSimulationStore((s) => s.setCurrentTime);
  const setSpeed = useSimulationStore((s) => s.setSpeed);

  // Metrics store
  const resetMetrics = useMetricsStore((s) => s.reset);

  // Config inputs — local overrides; loaded SimulationConfig takes precedence
  const [endTime, setEndTime] = useState(60);
  const [seed, setSeed] = useState(42);
  const [randomSeed, setRandomSeed] = useState(true);

  // Sync local inputs when a SimulationConfig is loaded
  useEffect(() => {
    if (simulationConfig) {
      setEndTime(simulationConfig.endTime);
      setSeed(simulationConfig.seed);
      setRandomSeed(false);
    }
  }, [simulationConfig]);

  /** Return the seed to use for the next run, generating a new one if randomSeed is on. */
  const getEffectiveSeed = useCallback((): number => {
    if (randomSeed) {
      const s = Math.floor(Math.random() * 2 ** 32);
      setSeed(s);
      return s;
    }
    return seed;
  }, [randomSeed, seed]);

  /** Build the Architecture and SimulationConfig to send to the worker. */
  const buildStartPayload = useCallback((effectiveSeed: number): { architecture: Architecture; config: SimulationConfig } => {
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
    // Merge: loaded config scenarios + manually added scenarios from the store
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
  }, [endTime]);

  // Lazily create the bridge on first use
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

  // Cleanup on unmount
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
    // Status will be set by onPaused callback
  }, [getBridge]);

  const handleStep = useCallback(() => {
    const bridge = getBridge();
    if (status === 'idle' || status === 'completed') {
      // Need to start first
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {/* Transport controls */}
      <button className="transport-btn" onClick={handlePlay} disabled={isRunning} title="Play / Resume">
        ▶
      </button>
      <button className="transport-btn" onClick={handlePause} disabled={!isRunning} title="Pause">
        ⏸
      </button>
      <button className="transport-btn" onClick={handleStep} title="Step (one event)">
        ⏭
      </button>
      <button className="transport-btn" onClick={handleReset} title="Reset">
        ⏹
      </button>
      <button className="transport-btn" onClick={handleRunToEnd} disabled={isRunning || status === 'completed'} title="Run to end (max speed)">
        ⏩
      </button>

      <span className="sep" />

      {/* Speed */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#8888aa' }}>Speed</span>
        <input
          type="range"
          min={0.1}
          max={20}
          step={0.1}
          value={speedMultiplier}
          onChange={(e) => handleSpeedChange(Number(e.target.value))}
          style={{ width: 90 }}
        />
        <span style={{ minWidth: 36, fontSize: 13 }}>{speedMultiplier.toFixed(1)}×</span>
      </label>

      <span className="sep" />

      {/* Config */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, color: '#8888aa' }}>Duration (s)</span>
        <input
          className="sim-input"
          type="number"
          min={1}
          value={endTime}
          onChange={(e) => setEndTime(Number(e.target.value))}
          style={{ width: 68 }}
          disabled={isRunning || isPaused}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontSize: 11, color: '#8888aa' }}>Seed</span>
        <input
          className="sim-input"
          type="number"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value))}
          style={{ width: 68 }}
          disabled={isRunning || isPaused || randomSeed}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Use a random seed each run">
          <input
            className="sim-checkbox"
            type="checkbox"
            checked={randomSeed}
            onChange={(e) => setRandomSeed(e.target.checked)}
            disabled={isRunning || isPaused}
          />
          <span style={{ fontSize: 11, color: '#8888aa' }}>Random</span>
        </label>
      </label>

      <span className="sep" />

      {/* Status */}
      <span style={{ fontSize: 13 }}>
        t={currentTime.toFixed(2)}s{' '}
        <span className={`status-${status}`} style={{ fontWeight: 600 }}>
          {status}
        </span>
      </span>
    </div>
  );
}
