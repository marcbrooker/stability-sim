/**
 * Shared utility functions for simulation components.
 *
 * Centralizes logic that would otherwise be duplicated across Server,
 * Database, Cache, Queue, and LoadBalancer components.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit } from '../../types/events';
import type { SimContext } from '../../types/components';
import type { Distribution, LoadDependentLatency } from '../../types/configs';

/**
 * Create a departure event directed back to the work unit's originating client.
 */
export function createDepartureToOrigin(
  workUnit: WorkUnit,
  context: SimContext,
  failed: boolean,
): SimEvent {
  const wu: WorkUnit = {
    ...workUnit,
    metadata: { ...workUnit.metadata, failed },
  };
  return {
    id: uuidv4(),
    timestamp: context.currentTime,
    targetComponentId: workUnit.originClientId,
    workUnit: wu,
    kind: 'departure',
  };
}

/**
 * Sample from a probability distribution using the context's seeded PRNG.
 *
 * Implements inverse transform sampling for exponential, Box-Muller for
 * log-normal, and linear mapping for uniform.
 */
export function sampleDistribution(dist: Distribution, context: SimContext): number {
  switch (dist.type) {
    case 'uniform':
      return dist.min + context.random() * (dist.max - dist.min);
    case 'exponential': {
      const u = context.random();
      return -dist.mean * Math.log(1 - u);
    }
    case 'log-normal': {
      const u1 = context.random();
      const u2 = context.random();
      const normal = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
      return Math.exp(dist.mu + dist.sigma * normal);
    }
  }
}

/**
 * Apply load-dependent latency scaling to a base service time.
 *
 * Utilization (u) is typically activeConnections / poolSize, in [0, 1].
 * - Linear:      base × (1 + factor × u)
 * - Polynomial:  base × (1 + factor × u^exponent)
 * - Exponential: base × e^(factor × u)
 */
export function applyLoadDependentLatency(
  base: number,
  utilization: number,
  config: LoadDependentLatency,
): number {
  switch (config.mode) {
    case 'linear':
      return base * (1 + config.factor * utilization);
    case 'polynomial':
      return base * (1 + config.factor * Math.pow(utilization, config.exponent ?? 2));
    case 'exponential':
      return base * Math.exp(config.factor * utilization);
  }
}
