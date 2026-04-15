/** Traffic pattern configuration for Client components */
export type TrafficPattern =
  | { type: 'open-loop'; meanArrivalRate: number; rampUpTime?: number }
  | { type: 'closed-loop'; thinkTime: number; maxConcurrency: number }
  | { type: 'ramping'; startRate: number; endRate: number; duration: number }
  | { type: 'burst'; count: number; atTime: number };

/** Retry strategy configuration for Client components */
export type RetryStrategy =
  | { type: 'none' }
  | { type: 'fixed-n'; maxRetries: number }
  | { type: 'token-bucket'; capacity: number; depositAmount: number }
  | { type: 'circuit-breaker'; windowSize: number; failureThreshold: number; maxRetries: number };

/** Probability distribution configuration */
export type Distribution =
  | { type: 'uniform'; min: number; max: number }
  | { type: 'exponential'; mean: number }
  | { type: 'log-normal'; mu: number; sigma: number };

/** Load-dependent latency scaling configuration */
export interface LoadDependentLatency {
  mode: 'linear' | 'polynomial' | 'exponential';
  factor: number;
  exponent?: number; // only for polynomial mode
}

/** Client component configuration */
export interface ClientConfig {
  trafficPattern: TrafficPattern;
  retryStrategy: RetryStrategy;
  targetComponentId: string;
  timeout?: number; // seconds; if set, work units that don't complete within this time are treated as failed
  numKeys?: number; // number of distinct cache keys (customers); work units get key = floor(random * numKeys)
}

/** Server component configuration */
export interface ServerConfig {
  serviceTimeDistribution: Distribution;
  concurrencyLimit: number;
  loadDependentLatency?: LoadDependentLatency;
}

/** Database component configuration */
export interface DatabaseConfig {
  readLatencyDistribution: Distribution;
  writeLatencyDistribution: Distribution;
  connectionPoolSize: number;
  loadDependentLatency?: LoadDependentLatency;
}

/** Cache component configuration */
export interface CacheConfig {
  hitRate: number; // 0.0 to 1.0 — used as fallback when no key-based caching
  downstreamComponentId: string;
  ttl?: number; // seconds; cached entries expire after this duration
  maxSize?: number; // max number of entries; 0 or undefined = unbounded
  evictionPolicy?: 'fifo' | 'lru'; // eviction when maxSize exceeded; default 'lru'
}

/** Load balancer component configuration */
export interface LoadBalancerConfig {
  strategy: 'round-robin' | 'random' | 'least-connections';
}

/** Throttle component configuration */
export interface ThrottleConfig {
  maxConcurrency: number; // reject arrivals when this many requests are in-flight
}

/** Queue component configuration */
export interface QueueConfig {
  maxCapacity?: number; // undefined = unlimited
  maxConcurrency?: number; // max items in-flight to downstream; undefined = unlimited
  loadSheddingThreshold?: number; // must be <= maxCapacity
}
