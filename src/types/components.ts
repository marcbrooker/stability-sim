import type { SimEvent } from './events';
import type {
  ClientConfig,
  ServerConfig,
  DatabaseConfig,
  CacheConfig,
  LoadBalancerConfig,
  QueueConfig,
  ThrottleConfig,
} from './configs';

/** Supported component types */
export type ComponentType = 'client' | 'load-balancer' | 'server' | 'cache' | 'database' | 'queue' | 'throttle';

/** Union of all component configurations, discriminated by type */
export type ComponentConfig =
  | ({ type: 'client' } & ClientConfig)
  | ({ type: 'server' } & ServerConfig)
  | ({ type: 'database' } & DatabaseConfig)
  | ({ type: 'cache' } & CacheConfig)
  | ({ type: 'load-balancer' } & LoadBalancerConfig)
  | ({ type: 'queue' } & QueueConfig)
  | ({ type: 'throttle' } & ThrottleConfig);

/** Per-component metrics snapshot */
export interface ComponentMetrics {
  [metricName: string]: number;
}

/** Context provided by the engine to components during event processing */
export interface SimContext {
  currentTime: number;
  scheduleEvent(event: SimEvent): void;
  getComponent(id: string): SimComponent;
  getDownstream(componentId: string): string[];
  random(): number; // seeded PRNG
  recordMetric(componentId: string, name: string, value: number, time: number): void;
}

/** Common interface implemented by every simulation component */
export interface SimComponent {
  readonly id: string;
  readonly type: ComponentType;
  readonly config: ComponentConfig;

  /** Process an incoming event, return zero or more new events */
  handleEvent(event: SimEvent, context: SimContext): SimEvent[];

  /** Return current metrics snapshot for this component */
  getMetrics(): ComponentMetrics;

  /** Reset component to initial state */
  reset(): void;
}
