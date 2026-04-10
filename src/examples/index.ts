import type { Architecture, SimulationConfig } from '../types';

export interface Example {
  id: string;
  name: string;
  description: string;
  architecture: Architecture;
  simulationConfig: SimulationConfig;
}

/**
 * Metastable Failure via Retry Amplification
 *
 * Topology: Client → Load Balancer → 2 Servers
 *
 * The client sends traffic at a rate that keeps both servers near 70% utilization.
 * At t=5 one server crashes for 2 seconds. During the outage the surviving server
 * is overwhelmed, requests fail, and the client's aggressive retry strategy (fixed-3)
 * amplifies load. When the crashed server recovers at t=7, the retry storm has
 * already pushed both servers past their capacity. The system enters a metastable
 * failure state where retries sustain the overload indefinitely.
 */
const metastableRetry: Example = {
  id: 'metastable-retry',
  name: 'Metastable Failure (Retry Storm)',
  description:
    'A short server crash triggers retry amplification that sustains overload long after recovery. ' +
    'Demonstrates how aggressive retries create a positive feedback loop.',
  architecture: {
    schemaVersion: 1,
    name: 'Metastable Retry Storm',
    components: [
      {
        id: 'client-1',
        type: 'client',
        label: 'Web Client',
        position: { x: 50, y: 200 },
        config: {
          type: 'client',
          trafficPattern: { type: 'open-loop', meanArrivalRate: 70 },
          retryStrategy: { type: 'fixed-n', maxRetries: 3 },
          targetComponentId: 'lb-1',
          timeout: 1,
        },
      },
      {
        id: 'lb-1',
        type: 'load-balancer',
        label: 'Load Balancer',
        position: { x: 300, y: 200 },
        config: {
          type: 'load-balancer',
          strategy: 'round-robin',
        },
      },
      {
        id: 'srv-1',
        type: 'server',
        label: 'Server A',
        position: { x: 550, y: 100 },
        config: {
          type: 'server',
          serviceTimeDistribution: { type: 'exponential', mean: 0.1 },
          concurrencyLimit: 5,
          maxQueueSize: 10000,
        },
      },
      {
        id: 'srv-2',
        type: 'server',
        label: 'Server B',
        position: { x: 550, y: 300 },
        config: {
          type: 'server',
          serviceTimeDistribution: { type: 'exponential', mean: 0.1 },
          concurrencyLimit: 5,
          maxQueueSize: 10000,
        },
      },
    ],
    connections: [
      { id: 'conn-1', sourceId: 'client-1', targetId: 'lb-1' },
      { id: 'conn-2', sourceId: 'lb-1', targetId: 'srv-1' },
      { id: 'conn-3', sourceId: 'lb-1', targetId: 'srv-2' },
    ],
  },
  simulationConfig: {
    schemaVersion: 1,
    name: 'Metastable Retry Storm',
    endTime: 60,
    metricsWindowSize: 1,
    seed: 42,
    failureScenarios: [
      {
        type: 'server-crash',
        targetId: 'srv-1',
        triggerTime: 5,
        recoveryTime: 10,
      },
    ],
  },
};

/**
 * GC Pressure / Capacity Death Spiral
 *
 * Topology: Client → Server
 *
 * Models the Twitter GC case study from the metastable failures paper.
 * The server uses exponential load-dependent latency to model GC pauses:
 * as utilization rises, latency grows super-linearly (modeling increased
 * GC pressure and stop-the-world pauses). A burst of extra traffic at t=10
 * pushes utilization past the tipping point. Latency spikes cause timeouts,
 * retries amplify load, and the exponential latency scaling prevents recovery
 * even after the burst ends — combining workload amplification (retries) with
 * capacity degradation (load-dependent latency).
 */
const gcDeathSpiral: Example = {
  id: 'gc-death-spiral',
  name: 'GC Pressure Death Spiral',
  description:
    'A traffic burst pushes a server past its GC tipping point. Exponential latency scaling ' +
    'causes timeouts, retries amplify load, and the system cannot recover.',
  architecture: {
    schemaVersion: 1,
    name: 'GC Pressure Death Spiral',
    components: [
      {
        id: 'client-1',
        type: 'client',
        label: 'Steady Traffic',
        position: { x: 50, y: 150 },
        config: {
          type: 'client',
          trafficPattern: { type: 'open-loop', meanArrivalRate: 80 },
          retryStrategy: { type: 'fixed-n', maxRetries: 3 },
          targetComponentId: 'srv-1',
          timeout: 1,
        },
      },
      {
        id: 'client-2',
        type: 'client',
        label: 'Traffic Burst',
        position: { x: 50, y: 300 },
        config: {
          type: 'client',
          trafficPattern: { type: 'burst', count: 100, atTime: 10 },
          retryStrategy: { type: 'none' },
          targetComponentId: 'srv-1',
        },
      },
      {
        id: 'srv-1',
        type: 'server',
        label: 'App Server (GC-sensitive)',
        position: { x: 400, y: 200 },
        config: {
          type: 'server',
          serviceTimeDistribution: { type: 'exponential', mean: 0.008 },
          concurrencyLimit: 10,
          maxQueueSize: 200,
          loadDependentLatency: { mode: 'exponential', factor: 4 },
        },
      },
    ],
    connections: [
      { id: 'conn-1', sourceId: 'client-1', targetId: 'srv-1' },
      { id: 'conn-2', sourceId: 'client-2', targetId: 'srv-1' },
    ],
  },
  simulationConfig: {
    schemaVersion: 1,
    name: 'GC Pressure Death Spiral',
    endTime: 60,
    metricsWindowSize: 1,
    seed: 42,
    failureScenarios: [],
  },
};

/**
 * Connection Pool Exhaustion
 *
 * Topology: Client → Server → Database
 *
 * The server proxies requests to a database with a limited connection pool.
 * A latency spike on the DB at t=8 causes connections to be held longer,
 * exhausting the pool. The server's internal queue fills as requests wait
 * for connections. Client timeouts trigger retries, adding more load.
 * Even after the DB latency spike ends at t=13, the backed-up server queue
 * keeps the DB at high utilization via load-dependent latency, and retries
 * sustain the overload — the pool never drains.
 */
const connectionPoolExhaustion: Example = {
  id: 'connection-pool-exhaustion',
  name: 'Connection Pool Exhaustion',
  description:
    'A DB latency spike drains the connection pool. Backed-up requests and retries ' +
    'keep the pool saturated long after the spike ends.',
  architecture: {
    schemaVersion: 1,
    name: 'Connection Pool Exhaustion',
    components: [
      {
        id: 'client-1',
        type: 'client',
        label: 'App Client',
        position: { x: 50, y: 200 },
        config: {
          type: 'client',
          trafficPattern: { type: 'open-loop', meanArrivalRate: 150 },
          retryStrategy: { type: 'fixed-n', maxRetries: 2 },
          targetComponentId: 'srv-1',
          timeout: 1.5,
        },
      },
      {
        id: 'srv-1',
        type: 'server',
        label: 'App Server',
        position: { x: 300, y: 200 },
        config: {
          type: 'server',
          serviceTimeDistribution: { type: 'exponential', mean: 0.002 },
          concurrencyLimit: 50,
          maxQueueSize: 500,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        label: 'Database',
        position: { x: 550, y: 200 },
        config: {
          type: 'database',
          readLatencyDistribution: { type: 'exponential', mean: 0.005 },
          writeLatencyDistribution: { type: 'exponential', mean: 0.01 },
          connectionPoolSize: 20,
          loadDependentLatency: { mode: 'polynomial', factor: 4, exponent: 3 },
        },
      },
    ],
    connections: [
      { id: 'conn-1', sourceId: 'client-1', targetId: 'srv-1' },
      { id: 'conn-2', sourceId: 'srv-1', targetId: 'db-1' },
    ],
  },
  simulationConfig: {
    schemaVersion: 1,
    name: 'Connection Pool Exhaustion',
    endTime: 60,
    metricsWindowSize: 1,
    seed: 42,
    failureScenarios: [
      {
        type: 'latency-spike',
        targetId: 'db-1',
        triggerTime: 8,
        duration: 5,
        factor: 15,
      },
    ],
  },
};

/**
 * Cache Stampede
 *
 * Topology: Client → Cache → Queue → Database
 *
 * The client generates traffic for 100 distinct keys (customers). The cache
 * stores entries with a 5-second TTL and a max size of 80 entries (LRU eviction).
 * In steady state most requests hit the cache. At t=10 a latency spike on the
 * database causes miss traffic to queue up. The queue's bounded capacity triggers
 * load shedding, and the database's load-dependent latency creates a feedback
 * loop. Even after the spike ends, queued requests sustain elevated latency and
 * cache entries expire faster than they can be refilled — a classic stampede.
 */
const cacheStampede: Example = {
  id: 'cache-stampede',
  name: 'Cache Stampede',
  description:
    'A database latency spike causes cache-miss traffic to overwhelm a bounded queue and database. ' +
    'Demonstrates how TTL expiry and queue buildup create a stampede feedback loop.',
  architecture: {
    schemaVersion: 1,
    name: 'Cache Stampede',
    components: [
      {
        id: 'client-1',
        type: 'client',
        label: 'App Client',
        position: { x: 50, y: 200 },
        config: {
          type: 'client',
          trafficPattern: { type: 'open-loop', meanArrivalRate: 200 },
          retryStrategy: { type: 'fixed-n', maxRetries: 1 },
          targetComponentId: 'cache-1',
          timeout: 2,
          numKeys: 100,
        },
      },
      {
        id: 'cache-1',
        type: 'cache',
        label: 'App Cache',
        position: { x: 250, y: 200 },
        config: {
          type: 'cache',
          hitRate: 0.0,
          downstreamComponentId: 'queue-1',
          ttl: 5,
          maxSize: 80,
          evictionPolicy: 'lru' as const,
        },
      },
      {
        id: 'queue-1',
        type: 'queue',
        label: 'DB Queue',
        position: { x: 450, y: 200 },
        config: {
          type: 'queue',
          maxCapacity: 100,
          loadSheddingThreshold: 80,
        },
      },
      {
        id: 'db-1',
        type: 'database',
        label: 'Primary DB',
        position: { x: 650, y: 200 },
        config: {
          type: 'database',
          readLatencyDistribution: { type: 'exponential', mean: 0.005 },
          writeLatencyDistribution: { type: 'exponential', mean: 0.01 },
          connectionPoolSize: 20,
          loadDependentLatency: { mode: 'polynomial', factor: 3, exponent: 2 },
        },
      },
    ],
    connections: [
      { id: 'conn-1', sourceId: 'client-1', targetId: 'cache-1' },
      { id: 'conn-2', sourceId: 'cache-1', targetId: 'queue-1' },
      { id: 'conn-3', sourceId: 'queue-1', targetId: 'db-1' },
    ],
  },
  simulationConfig: {
    schemaVersion: 1,
    name: 'Cache Stampede',
    endTime: 60,
    metricsWindowSize: 1,
    seed: 123,
    failureScenarios: [
      {
        type: 'latency-spike',
        targetId: 'db-1',
        triggerTime: 10,
        duration: 5,
        factor: 20,
      },
    ],
  },
};

/**
 * Cache Flush Metastability
 *
 * Topology: Client → Cache → Database
 *
 * The client generates traffic for 50 distinct keys. The cache has a large
 * capacity and long TTL, so in steady state nearly everything is a hit and
 * the database is lightly loaded. At t=10 the cache is flushed. All 50 keys
 * become misses simultaneously, flooding the database. The database's
 * load-dependent latency (polynomial) causes service times to spike as
 * utilization jumps. Requests take so long they time out (2s), so the
 * cache never gets refilled — creating a metastable failure where the
 * system cannot recover even though the original disruption was instantaneous.
 */
const cacheFlush: Example = {
  id: 'cache-flush',
  name: 'Cache Flush Metastability',
  description:
    'Flushing a warm cache floods the database with misses. Load-dependent latency causes ' +
    'timeouts before responses return, preventing cache refill — a metastable failure.',
  architecture: {
    schemaVersion: 1,
    name: 'Cache Flush Metastability',
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
          readLatencyDistribution: { type: 'exponential', mean: 0.5 },
          writeLatencyDistribution: { type: 'exponential', mean: 0.5 },
          connectionPoolSize: 30,
          loadDependentLatency: { mode: 'polynomial', factor: 5, exponent: 3 },
        },
      },
    ],
    connections: [
      { id: 'conn-1', sourceId: 'client-1', targetId: 'cache-1' },
      { id: 'conn-2', sourceId: 'cache-1', targetId: 'db-1' },
    ],
  },
  simulationConfig: {
    schemaVersion: 1,
    name: 'Cache Flush Metastability',
    endTime: 60,
    metricsWindowSize: 1,
    seed: 77,
    failureScenarios: [
      {
        type: 'cache-flush',
        targetId: 'cache-1',
        triggerTime: 10,
      },
    ],
  },
};

export const EXAMPLES: Example[] = [
  metastableRetry,
  gcDeathSpiral,
  connectionPoolExhaustion,
  cacheStampede,
  cacheFlush,
];
