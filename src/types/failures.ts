/** Failure scenario union type for injection during simulation */
export type FailureScenario =
  | { type: 'server-crash'; targetId: string; triggerTime: number; recoveryTime: number }
  | { type: 'latency-spike'; targetId: string; triggerTime: number; duration: number; factor: number }
  | { type: 'cpu-reduction'; targetId: string; triggerTime: number; duration: number; reductionPercent: number }
  | { type: 'network-partition'; connectionId: string; triggerTime: number; duration: number }
  | { type: 'cache-flush'; targetId: string; triggerTime: number };
