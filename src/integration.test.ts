/**
 * Integration tests for the stability-sim engine.
 *
 * These are engine-level integration tests (not browser/UI tests).
 * They build components from ComponentDefinitions, create a SimulationEngine,
 * schedule initial events, run the engine, and verify results.
 *
 * Validates: Requirements 1.1–1.5, 9.1–9.5, 13.4, 14.4
 */

import { describe, it, expect } from 'vitest';
import type { Architecture, SimulationConfig, ComponentDefinition } from './types/models';
import type { SimComponent, SimContext } from './types/components';
import { SimulationEngine } from './engine/simulation-engine';
import { FailureInjector } from './engine/failure-injector';
import { Client } from './engine/components/client';
import { Server } from './engine/components/server';
import { Queue } from './engine/components/queue';
import { Cache } from './engine/components/cache';
import { LoadBalancer } from './engine/components/load-balancer';
import { Database } from './engine/components/database';
import { serialize, parse } from './persistence/architecture-serializer';

/**
 * Mirrors the worker's buildComponent logic for testing.
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
 * Create a SimContext that wires components to the engine, mirroring the worker setup.
 */
function createContext(
  engine: SimulationEngine,
  components: SimComponent[],
  connections: Architecture['connections'],
): SimContext {
  return {
    get currentTime() {
      return engine.currentTime;
    },
    scheduleEvent(evt) {
      engine.scheduleEvent(evt);
    },
    getComponent(id: string) {
      const comp = components.find(c => c.id === id);
      if (!comp) throw new Error(`Component not found: ${id}`);
      return comp;
    },
    getDownstream(componentId: string) {
      return connections
        .filter(c => c.sourceId === componentId)
        .map(c => c.targetId);
    },
    random() {
      return engine.getRng().random();
    },
    recordMetric(componentId: string, name: string, value: number, time: number) {
      engine.getMetrics().record(componentId, name, value, time);
    },
  };
}

/**
 * Seed initial client events into the engine, mirroring the worker's start logic.
 */
function seedClientEvents(
  components: SimComponent[],
  context: SimContext,
  engine: SimulationEngine,
): void {
  for (const comp of components) {
    if (comp.type === 'client' && comp instanceof Client) {
      const initialEvents = comp.generateInitialEvents(context);
      for (const evt of initialEvents) {
        engine.scheduleEvent(evt);
      }
    }
  }
}

describe('Integration: Client → Server simulation', () => {
  it('runs a burst-traffic simulation to completion and produces latency metrics', () => {
    const arch: Architecture = {
      schemaVersion: 1,
      name: 'Client-Server Test',
      components: [
        {
          id: 'client-1',
          type: 'client',
          label: 'Client',
          position: { x: 0, y: 0 },
          config: {
            type: 'client',
            trafficPattern: { type: 'burst', count: 5, atTime: 0 },
            retryStrategy: { type: 'none' },
            targetComponentId: 'server-1',
            timeout: 10,
          },
        },
        {
          id: 'server-1',
          type: 'server',
          label: 'Server',
          position: { x: 200, y: 0 },
          config: {
            type: 'server',
            serviceTimeDistribution: { type: 'uniform', min: 1, max: 2 },
            concurrencyLimit: 10,
          },
        },
      ],
      connections: [
        { id: 'conn-1', sourceId: 'client-1', targetId: 'server-1' },
      ],
    };

    const config: SimulationConfig = {
      schemaVersion: 1,
      name: 'Test Config',
      endTime: 100,
      metricsWindowSize: 10,
      failureScenarios: [],
      seed: 42,
    };

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    const injector = new FailureInjector();
    injector.scheduleFailures(config.failureScenarios, (evt) => engine.scheduleEvent(evt));

    const context = createContext(engine, components, arch.connections);
    seedClientEvents(components, context, engine);

    // Run to completion
    engine.run();

    // Verify engine completed
    expect(engine.status).toBe('completed');
    expect(engine.currentTime).toBeGreaterThan(0);

    // Verify client has completedCount > 0
    const client = components.find(c => c.id === 'client-1')!;
    const clientMetrics = client.getMetrics();
    expect(clientMetrics.completedCount).toBeGreaterThan(0);

    // Verify metrics collector has latency data (client records via recordMetric)
    const metrics = engine.getMetrics();
    const latencySeries = metrics.getTimeSeries('client-1', 'latency');
    expect(latencySeries.length).toBeGreaterThan(0);

    // All latency values should be positive
    for (const point of latencySeries) {
      expect(point.value).toBeGreaterThan(0);
    }
  });
});

describe('Integration: Architecture save/load round-trip', () => {
  it('serializes and parses an architecture with multiple components and connections', () => {
    const original: Architecture = {
      schemaVersion: 1,
      name: 'Multi-Component Arch',
      components: [
        {
          id: 'client-1',
          type: 'client',
          label: 'Web Client',
          position: { x: 0, y: 0 },
          config: {
            type: 'client',
            trafficPattern: { type: 'open-loop', meanArrivalRate: 50 },
            retryStrategy: { type: 'fixed-n', maxRetries: 3 },
            targetComponentId: 'server-1',
            timeout: 10,
          },
        },
        {
          id: 'server-1',
          type: 'server',
          label: 'App Server',
          position: { x: 200, y: 0 },
          config: {
            type: 'server',
            serviceTimeDistribution: { type: 'exponential', mean: 5 },
            concurrencyLimit: 20,
          },
        },
        {
          id: 'db-1',
          type: 'database',
          label: 'Database',
          position: { x: 400, y: 0 },
          config: {
            type: 'database',
            readLatencyDistribution: { type: 'uniform', min: 1, max: 5 },
            writeLatencyDistribution: { type: 'uniform', min: 2, max: 10 },
            connectionPoolSize: 20,
          },
        },
      ],
      connections: [
        { id: 'conn-1', sourceId: 'client-1', targetId: 'server-1' },
        { id: 'conn-2', sourceId: 'server-1', targetId: 'db-1' },
      ],
    };

    // Serialize
    const json = serialize(original);

    // Parse back
    const parsed = parse(json);

    // Verify the parsed architecture matches the original
    expect(parsed.schemaVersion).toBe(original.schemaVersion);
    expect(parsed.name).toBe(original.name);
    expect(parsed.components).toHaveLength(original.components.length);
    expect(parsed.connections).toHaveLength(original.connections.length);

    // Verify each component round-trips correctly
    for (let i = 0; i < original.components.length; i++) {
      expect(parsed.components[i].id).toBe(original.components[i].id);
      expect(parsed.components[i].type).toBe(original.components[i].type);
      expect(parsed.components[i].label).toBe(original.components[i].label);
      expect(parsed.components[i].position).toEqual(original.components[i].position);
      expect(parsed.components[i].config).toEqual(original.components[i].config);
    }

    // Verify each connection round-trips correctly
    for (let i = 0; i < original.connections.length; i++) {
      expect(parsed.connections[i].id).toBe(original.connections[i].id);
      expect(parsed.connections[i].sourceId).toBe(original.connections[i].sourceId);
      expect(parsed.connections[i].targetId).toBe(original.connections[i].targetId);
    }
  });
});

describe('Integration: Server-crash failure injection', () => {
  it('server rejects work units during crash window', () => {
    const arch: Architecture = {
      schemaVersion: 1,
      name: 'Crash Test',
      components: [
        {
          id: 'client-1',
          type: 'client',
          label: 'Client',
          position: { x: 0, y: 0 },
          config: {
            type: 'client',
            trafficPattern: { type: 'open-loop', meanArrivalRate: 2 },
            retryStrategy: { type: 'none' },
            targetComponentId: 'server-1',
            timeout: 10,
          },
        },
        {
          id: 'server-1',
          type: 'server',
          label: 'Server',
          position: { x: 200, y: 0 },
          config: {
            type: 'server',
            serviceTimeDistribution: { type: 'uniform', min: 0.5, max: 1 },
            concurrencyLimit: 10,
          },
        },
      ],
      connections: [
        { id: 'conn-1', sourceId: 'client-1', targetId: 'server-1' },
      ],
    };

    const config: SimulationConfig = {
      schemaVersion: 1,
      name: 'Crash Config',
      endTime: 100,
      metricsWindowSize: 10,
      failureScenarios: [
        { type: 'server-crash', targetId: 'server-1', triggerTime: 5, recoveryTime: 50 },
      ],
      seed: 42,
    };

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    // Schedule failure events
    const injector = new FailureInjector();
    injector.scheduleFailures(config.failureScenarios, (evt) => engine.scheduleEvent(evt));

    const context = createContext(engine, components, arch.connections);
    seedClientEvents(components, context, engine);

    // Manually apply the crash at the correct time by directly setting
    // the server's crashed state. The failure injector schedules events
    // but the engine dispatches them to the component's handleEvent,
    // which doesn't process failure-inject/failure-recover kinds.
    // In a full integration, the worker loop would intercept these.
    // Here we simulate the effect directly on the server.
    const server = components.find(c => c.id === 'server-1')! as Server;

    // Step through the simulation, intercepting failure events
    while (engine.status !== 'completed') {
      const prevTime = engine.currentTime;
      const done = engine.step();

      // After each step, check if we crossed the crash/recovery boundaries
      // and apply the failure state accordingly
      if (engine.currentTime >= 5 && prevTime < 5) {
        server.setCrashed(true);
      }
      if (engine.currentTime >= 50 && prevTime < 50) {
        server.setCrashed(false);
      }

      if (done) break;
    }

    expect(engine.status).toBe('completed');

    // Verify server rejected work units during the crash window
    const serverMetrics = server.getMetrics();
    expect(serverMetrics.totalRejected).toBeGreaterThan(0);

    // Verify the server also processed some work units (before crash and after recovery)
    expect(serverMetrics.tpsProcessed).toBeGreaterThan(0);

    // Verify the client saw failures
    const client = components.find(c => c.id === 'client-1')!;
    const clientMetrics = client.getMetrics();
    expect(clientMetrics.failedCount).toBeGreaterThan(0);
  });
});

describe('Integration: Cache flush with seed 76', () => {
  it('runs the cache flush scenario to completion without crashing', () => {
    const arch: Architecture = {
      schemaVersion: 1,
      name: 'Cache Flush Test',
      components: [
        {
          id: 'client-1',
          type: 'client',
          label: 'App Client',
          position: { x: 50, y: 200 },
          config: {
            type: 'client',
            trafficPattern: { type: 'open-loop', meanArrivalRate: 300, rampUpTime: 8 },
            retryStrategy: { type: 'fixed-n', maxRetries: 2 },
            targetComponentId: 'cache-1',
            timeout: 2,
            numKeys: 50,
          },
        },
        {
          id: 'cache-1',
          type: 'cache',
          label: 'App Cache',
          position: { x: 300, y: 200 },
          config: {
            type: 'cache',
            hitRate: 0.0,
            downstreamComponentId: 'db-1',
            ttl: 30,
            maxSize: 200,
            evictionPolicy: 'lru' as const,
          },
        },
        {
          id: 'db-1',
          type: 'database',
          label: 'Primary DB',
          position: { x: 550, y: 200 },
          config: {
            type: 'database',
            readLatencyDistribution: { type: 'exponential', mean: 0.01 },
            writeLatencyDistribution: { type: 'exponential', mean: 0.02 },
            connectionPoolSize: 30,
            loadDependentLatency: { mode: 'polynomial', factor: 5, exponent: 3 },
          },
        },
      ],
      connections: [
        { id: 'conn-1', sourceId: 'client-1', targetId: 'cache-1' },
        { id: 'conn-2', sourceId: 'cache-1', targetId: 'db-1' },
      ],
    };

    const config: SimulationConfig = {
      schemaVersion: 1,
      name: 'Cache Flush Test',
      endTime: 60,
      metricsWindowSize: 1,
      seed: 76,
      failureScenarios: [
        { type: 'cache-flush', targetId: 'cache-1', triggerTime: 10 },
      ],
    };

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    const injector = new FailureInjector();
    engine.setFailureInjector(injector);
    injector.scheduleFailures(config.failureScenarios, (evt) => engine.scheduleEvent(evt));

    const context = createContext(engine, components, arch.connections);
    seedClientEvents(components, context, engine);

    // Run to completion — should not throw
    engine.run();

    expect(engine.status).toBe('completed');
  });
});
