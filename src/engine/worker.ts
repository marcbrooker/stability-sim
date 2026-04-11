/**
 * Simulation Web Worker entry point.
 *
 * Runs the discrete-event simulation off the main thread, communicating
 * via the MainToWorker / WorkerToMain protocol.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import type { MainToWorker, WorkerToMain } from '../types/worker-protocol';
import type { Architecture, SimulationConfig } from '../types/models';
import type { ComponentDefinition } from '../types/models';
import type { SimComponent } from '../types/components';
import type { MetricSnapshot } from '../types/metrics';
import { SimulationEngine } from './simulation-engine';
import { FailureInjector } from './failure-injector';
import { Client } from './components/client';
import { Server } from './components/server';
import { Queue } from './components/queue';
import { Cache } from './components/cache';
import { LoadBalancer } from './components/load-balancer';
import { Database } from './components/database';

// --- Worker state ---

let engine: SimulationEngine | null = null;
let failureInjector: FailureInjector | null = null;
let speedMultiplier = 1;
let loopTimerId: ReturnType<typeof setTimeout> | null = null;
let isPaused = false;

/** Reference to the built components for metric collection */
let componentsList: SimComponent[] = [];

/** Number of events to process per batch before yielding to setTimeout */
const EVENTS_PER_BATCH = 100;

/** Interval in simulation time units between metric snapshots */
const METRICS_INTERVAL = 0.5;

/** Track the last sim time at which we posted metrics */
let lastMetricsTime = 0;

// --- Helpers ---

function postMsg(msg: WorkerToMain): void {
  (self as unknown as Worker).postMessage(msg);
}

/**
 * Build a SimComponent from a ComponentDefinition.
 */
function buildComponent(def: ComponentDefinition): SimComponent {
  const cfg = def.config;
  switch (cfg.type) {
    case 'client': {
      const { type: _, ...clientCfg } = cfg;
      return new Client(def.id, clientCfg);
    }
    case 'server': {
      const { type: _, ...serverCfg } = cfg;
      return new Server(def.id, serverCfg);
    }
    case 'queue': {
      const { type: _, ...queueCfg } = cfg;
      return new Queue(def.id, queueCfg);
    }
    case 'cache': {
      const { type: _, ...cacheCfg } = cfg;
      return new Cache(def.id, cacheCfg);
    }
    case 'load-balancer': {
      const { type: _, ...lbCfg } = cfg;
      return new LoadBalancer(def.id, lbCfg);
    }
    case 'database': {
      const { type: _, ...dbCfg } = cfg;
      return new Database(def.id, dbCfg);
    }
    default:
      throw new Error(`Unknown component type: ${(cfg as { type: string }).type}`);
  }
}

/**
 * Build a MetricSnapshot from the current engine state.
 */
function buildSnapshot(): MetricSnapshot {
  if (!engine) {
    return {
      simTime: 0,
      componentMetrics: {},
      latencyPercentiles: { p50: 0, p95: 0, p99: 0, p999: 0 },
      completedCount: 0,
      failedCount: 0,
    };
  }

  const metrics = engine.getMetrics();
  const simTime = engine.currentTime;

  // Gather per-component metrics
  const componentMetrics: Record<string, Record<string, number>> = {};
  // We need access to the components map — use the engine's context approach
  // The engine doesn't expose components directly, so we collect from getMetrics
  // on each component. We'll store a reference to the components list.
  for (const comp of componentsList) {
    componentMetrics[comp.id] = comp.getMetrics() as Record<string, number>;
  }

  // Compute latency percentiles over a trailing window
  const LATENCY_WINDOW = 10; // seconds
  const latencyPercentiles = metrics.getLatencyPercentiles(Math.max(0, simTime - LATENCY_WINDOW), simTime);

  // Aggregate completed/failed from client components
  let completedCount = 0;
  let failedCount = 0;
  for (const comp of componentsList) {
    if (comp.type === 'client') {
      const m = comp.getMetrics();
      completedCount += (m.completedCount ?? 0);
      failedCount += (m.failedCount ?? 0);
    }
  }

  return {
    simTime,
    componentMetrics,
    latencyPercentiles,
    completedCount,
    failedCount,
  };
}

// --- Simulation loop with pacing ---

/**
 * Run the simulation loop in batches, yielding control via setTimeout
 * to keep the worker responsive and to implement speed pacing.
 *
 * Req 12.1: "play" runs continuously.
 * Req 12.4: speed multiplier controls sim-time to wall-clock ratio.
 */
function runLoop(): void {
  if (!engine || isPaused) return;

  try {
    const batchStartWall = Date.now();
    let eventsProcessed = 0;
    const startSimTime = engine.currentTime;

    // Process a batch of events
    while (eventsProcessed < EVENTS_PER_BATCH) {
      if (isPaused) break;

      const done = engine.step();
      eventsProcessed++;

      if (done) {
        postMsg({ type: 'metrics', snapshot: buildSnapshot() });
        postMsg({ type: 'completed' });
        return;
      }

      if (engine.currentTime - lastMetricsTime >= METRICS_INTERVAL) {
        lastMetricsTime = engine.currentTime;
        postMsg({ type: 'metrics', snapshot: buildSnapshot() });
      }
    }

    if (isPaused) {
      postMsg({ type: 'paused', simTime: engine.currentTime });
      return;
    }

    const simTimeElapsed = engine.currentTime - startSimTime;
    const batchWallMs = Date.now() - batchStartWall;
    const targetWallMs = speedMultiplier > 0
      ? (simTimeElapsed / speedMultiplier) * 1000
      : 0;
    const delay = Math.max(0, targetWallMs - batchWallMs);

    // Schedule next batch
    loopTimerId = setTimeout(runLoop, delay);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    postMsg({ type: 'error', message: stack ? `${message}\n${stack}` : message });
  }
}

/**
 * Stop the paced loop timer.
 */
function stopLoop(): void {
  if (loopTimerId !== null) {
    clearTimeout(loopTimerId);
    loopTimerId = null;
  }
}

// Global error handler — catches anything that escapes try/catch
self.onerror = (event) => {
  const message = typeof event === 'string' ? event : (event as ErrorEvent).message ?? 'Unknown worker error';
  postMsg({ type: 'error', message });
};

// --- Message handler ---

self.onmessage = (event: MessageEvent<MainToWorker>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'start':
        handleStart(msg.architecture, msg.config, msg.seed);
        break;
      case 'pause':
        handlePause();
        break;
      case 'resume':
        handleResume();
        break;
      case 'step':
        handleStep();
        break;
      case 'reset':
        handleReset();
        break;
      case 'setSpeed':
        handleSetSpeed(msg.multiplier);
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    postMsg({ type: 'error', message });
  }
};

/**
 * Handle 'start': build components, create engine, schedule initial events, begin loop.
 */
function handleStart(architecture: Architecture, config: SimulationConfig, seed: number): void {
  stopLoop();

  // Override seed in config if provided separately
  const simConfig: SimulationConfig = { ...config, seed };

  // Build SimComponent instances from architecture definitions
  componentsList = architecture.components.map(buildComponent);

  // Create the simulation engine
  engine = new SimulationEngine(componentsList, architecture.connections, simConfig);

  // Create failure injector, attach to engine, and schedule failure events
  failureInjector = new FailureInjector();
  engine.setFailureInjector(failureInjector);
  failureInjector.scheduleFailures(
    simConfig.failureScenarios,
    (evt) => engine!.scheduleEvent(evt),
  );

  // Generate initial events from client components
  const context = {
    currentTime: 0,
    scheduleEvent: (evt: import('../types/events').SimEvent) => engine!.scheduleEvent(evt),
    getComponent: (id: string) => {
      const comp = componentsList.find(c => c.id === id);
      if (!comp) throw new Error(`Component not found: ${id}`);
      return comp;
    },
    getDownstream: (componentId: string) => {
      return architecture.connections
        .filter(c => c.sourceId === componentId)
        .map(c => c.targetId);
    },
    random: () => engine!.getRng().random(),
    recordMetric: (componentId: string, name: string, value: number, time: number) => {
      engine!.getMetrics().record(componentId, name, value, time);
    },
  };

  for (const comp of componentsList) {
    if (comp.type === 'client' && comp instanceof Client) {
      const initialEvents = comp.generateInitialEvents(context);
      for (const evt of initialEvents) {
        engine.scheduleEvent(evt);
      }
    }
  }

  // Reset pacing state
  isPaused = false;
  lastMetricsTime = 0;

  // Begin the simulation loop
  runLoop();
}

/**
 * Handle 'pause': stop the loop and preserve state.
 * Req 12.2
 */
function handlePause(): void {
  isPaused = true;
  stopLoop();
  if (engine) {
    engine.pause();
    postMsg({ type: 'paused', simTime: engine.currentTime });
  }
}

/**
 * Handle 'resume': restart the loop from current state.
 * Req 12.1
 */
function handleResume(): void {
  if (!engine) return;
  isPaused = false;
  runLoop();
}

/**
 * Handle 'step': process exactly one event.
 * Req 12.3
 */
function handleStep(): void {
  if (!engine) return;
  isPaused = true;
  stopLoop();

  const done = engine.step();

  // Post updated metrics
  postMsg({ type: 'metrics', snapshot: buildSnapshot() });

  if (done) {
    postMsg({ type: 'completed' });
  } else {
    postMsg({ type: 'paused', simTime: engine.currentTime });
  }
}

/**
 * Handle 'reset': restore engine to initial state.
 * Req 12.5
 */
function handleReset(): void {
  stopLoop();
  isPaused = false;
  lastMetricsTime = 0;

  if (engine) {
    engine.reset();
  }

  engine = null;
  failureInjector = null;
  componentsList = [];
}

/**
 * Handle 'setSpeed': update the speed multiplier for pacing.
 * Req 12.4
 */
function handleSetSpeed(multiplier: number): void {
  speedMultiplier = multiplier;
  if (engine) {
    engine.setSpeed(multiplier);
  }
}
