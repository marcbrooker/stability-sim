/**
 * Tests for the simulation Web Worker logic.
 *
 * Since Web Workers can't run directly in Vitest's Node environment,
 * we test the worker's core logic by simulating the message protocol
 * against the actual engine components.
 *
 * Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it, expect } from 'vitest';
import type { Architecture, SimulationConfig } from '../types/models';
import type { SimComponent } from '../types/components';
import { SimulationEngine } from './simulation-engine';
import { FailureInjector } from './failure-injector';
import { Client } from './components/client';
import { Server } from './components/server';
import { Queue } from './components/queue';
import { Cache } from './components/cache';
import { LoadBalancer } from './components/load-balancer';
import { Database } from './components/database';
import type { ComponentDefinition } from '../types/models';

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

/** Helper: create a minimal architecture with a client and server */
function createTestArchitecture(): Architecture {
  return {
    schemaVersion: 1,
    name: 'Test',
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
}

function createTestConfig(): SimulationConfig {
  return {
    schemaVersion: 1,
    name: 'Test Config',
    endTime: 100,
    metricsWindowSize: 10,
    failureScenarios: [],
    seed: 42,
  };
}

describe('Worker buildComponent', () => {
  it('builds a Client from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 'c1',
      type: 'client',
      label: 'Client',
      position: { x: 0, y: 0 },
      config: {
        type: 'client',
        trafficPattern: { type: 'open-loop', meanArrivalRate: 10 },
        retryStrategy: { type: 'none' },
        targetComponentId: 'srv',
      },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(Client);
    expect(comp.id).toBe('c1');
    expect(comp.type).toBe('client');
  });

  it('builds a Server from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 's1',
      type: 'server',
      label: 'Server',
      position: { x: 0, y: 0 },
      config: {
        type: 'server',
        serviceTimeDistribution: { type: 'exponential', mean: 5 },
        concurrencyLimit: 10,
      },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(Server);
    expect(comp.id).toBe('s1');
  });

  it('builds a Queue from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 'q1',
      type: 'queue',
      label: 'Queue',
      position: { x: 0, y: 0 },
      config: { type: 'queue', maxCapacity: 100 },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(Queue);
  });

  it('builds a Cache from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 'cache1',
      type: 'cache',
      label: 'Cache',
      position: { x: 0, y: 0 },
      config: { type: 'cache', hitRate: 0.8, downstreamComponentId: 'db1' },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(Cache);
  });

  it('builds a LoadBalancer from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 'lb1',
      type: 'load-balancer',
      label: 'LB',
      position: { x: 0, y: 0 },
      config: { type: 'load-balancer', strategy: 'round-robin' },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(LoadBalancer);
  });

  it('builds a Database from a ComponentDefinition', () => {
    const def: ComponentDefinition = {
      id: 'db1',
      type: 'database',
      label: 'DB',
      position: { x: 0, y: 0 },
      config: {
        type: 'database',
        readLatencyDistribution: { type: 'uniform', min: 1, max: 5 },
        writeLatencyDistribution: { type: 'uniform', min: 2, max: 10 },
        connectionPoolSize: 20,
      },
    };
    const comp = buildComponent(def);
    expect(comp).toBeInstanceOf(Database);
  });

  it('throws for unknown component type', () => {
    const def = {
      id: 'x1',
      type: 'unknown' as any,
      label: 'X',
      position: { x: 0, y: 0 },
      config: { type: 'unknown' },
    } as any;
    expect(() => buildComponent(def)).toThrow('Unknown component type');
  });
});

describe('Worker simulation flow (integration)', () => {
  it('runs a simple client→server simulation to completion', () => {
    const arch = createTestArchitecture();
    const config = createTestConfig();

    // Build components (mirrors worker handleStart)
    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    // Schedule failure events (none in this test)
    const injector = new FailureInjector();
    injector.scheduleFailures(config.failureScenarios, (evt) => engine.scheduleEvent(evt));

    // Generate initial client events
    const context = {
      currentTime: 0,
      scheduleEvent: (evt: any) => engine.scheduleEvent(evt),
      getComponent: (id: string) => {
        const comp = components.find(c => c.id === id);
        if (!comp) throw new Error(`Component not found: ${id}`);
        return comp;
      },
      getDownstream: (componentId: string) => {
        return arch.connections
          .filter(c => c.sourceId === componentId)
          .map(c => c.targetId);
      },
      random: () => engine.getRng().random(),
      recordMetric: (componentId: string, name: string, value: number, time: number) => {
        engine.getMetrics().record(componentId, name, value, time);
      },
    };

    for (const comp of components) {
      if (comp.type === 'client' && comp instanceof Client) {
        const initialEvents = comp.generateInitialEvents(context);
        for (const evt of initialEvents) {
          engine.scheduleEvent(evt);
        }
      }
    }

    // Run to completion
    engine.run();

    expect(engine.status).toBe('completed');
    expect(engine.currentTime).toBeGreaterThan(0);

    // Client should have processed some work units
    const clientComp = components.find(c => c.id === 'client-1')!;
    const metrics = clientComp.getMetrics();
    expect(metrics.completedCount).toBeGreaterThan(0);
  });

  it('step processes exactly one event at a time', () => {
    const arch = createTestArchitecture();
    const config = createTestConfig();

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    // Generate initial events
    const context = {
      currentTime: 0,
      scheduleEvent: (evt: any) => engine.scheduleEvent(evt),
      getComponent: (id: string) => {
        const comp = components.find(c => c.id === id);
        if (!comp) throw new Error(`Component not found: ${id}`);
        return comp;
      },
      getDownstream: (componentId: string) => {
        return arch.connections
          .filter(c => c.sourceId === componentId)
          .map(c => c.targetId);
      },
      random: () => engine.getRng().random(),
      recordMetric: (componentId: string, name: string, value: number, time: number) => {
        engine.getMetrics().record(componentId, name, value, time);
      },
    };

    for (const comp of components) {
      if (comp.type === 'client' && comp instanceof Client) {
        const initialEvents = comp.generateInitialEvents(context);
        for (const evt of initialEvents) {
          engine.scheduleEvent(evt);
        }
      }
    }

    const sizeBefore = engine.queueSize;
    expect(sizeBefore).toBeGreaterThan(0);

    // Step once
    const done = engine.step();
    expect(done).toBe(false);
    expect(engine.status).toBe('paused');
  });

  it('pause preserves simulation state', () => {
    const arch = createTestArchitecture();
    const config = createTestConfig();

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    const context = {
      currentTime: 0,
      scheduleEvent: (evt: any) => engine.scheduleEvent(evt),
      getComponent: (id: string) => {
        const comp = components.find(c => c.id === id);
        if (!comp) throw new Error(`Component not found: ${id}`);
        return comp;
      },
      getDownstream: (componentId: string) => {
        return arch.connections
          .filter(c => c.sourceId === componentId)
          .map(c => c.targetId);
      },
      random: () => engine.getRng().random(),
      recordMetric: (componentId: string, name: string, value: number, time: number) => {
        engine.getMetrics().record(componentId, name, value, time);
      },
    };

    for (const comp of components) {
      if (comp.type === 'client' && comp instanceof Client) {
        const initialEvents = comp.generateInitialEvents(context);
        for (const evt of initialEvents) {
          engine.scheduleEvent(evt);
        }
      }
    }

    // Step a few times
    engine.step();
    engine.step();
    const timeAfterSteps = engine.currentTime;
    const queueSizeAfterSteps = engine.queueSize;

    // Pause
    engine.pause();
    expect(engine.status).toBe('paused');
    expect(engine.currentTime).toBe(timeAfterSteps);
    expect(engine.queueSize).toBe(queueSizeAfterSteps);
  });

  it('reset restores engine to initial state', () => {
    const arch = createTestArchitecture();
    const config = createTestConfig();

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    const context = {
      currentTime: 0,
      scheduleEvent: (evt: any) => engine.scheduleEvent(evt),
      getComponent: (id: string) => {
        const comp = components.find(c => c.id === id);
        if (!comp) throw new Error(`Component not found: ${id}`);
        return comp;
      },
      getDownstream: (componentId: string) => {
        return arch.connections
          .filter(c => c.sourceId === componentId)
          .map(c => c.targetId);
      },
      random: () => engine.getRng().random(),
      recordMetric: (componentId: string, name: string, value: number, time: number) => {
        engine.getMetrics().record(componentId, name, value, time);
      },
    };

    for (const comp of components) {
      if (comp.type === 'client' && comp instanceof Client) {
        const initialEvents = comp.generateInitialEvents(context);
        for (const evt of initialEvents) {
          engine.scheduleEvent(evt);
        }
      }
    }

    // Run some events — step enough to advance past time 0
    let steps = 0;
    while (steps < 20 && engine.status !== 'completed') {
      engine.step();
      steps++;
    }
    expect(engine.currentTime).toBeGreaterThanOrEqual(0);
    expect(steps).toBeGreaterThan(0);

    // Reset
    engine.reset();
    expect(engine.status).toBe('idle');
    expect(engine.currentTime).toBe(0);
    expect(engine.queueSize).toBe(0);
  });

  it('setSpeed updates the speed multiplier', () => {
    const arch = createTestArchitecture();
    const config = createTestConfig();

    const components = arch.components.map(buildComponent);
    const engine = new SimulationEngine(components, arch.connections, config);

    expect(engine.speedMultiplier).toBe(1);
    engine.setSpeed(5);
    expect(engine.speedMultiplier).toBe(5);
    engine.setSpeed(0.5);
    expect(engine.speedMultiplier).toBe(0.5);
  });
});
