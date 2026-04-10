import { describe, it, expect } from 'vitest';
import { createDepartureToOrigin, sampleDistribution, applyLoadDependentLatency } from './shared';
import type { SimContext } from '../../types/components';
import type { WorkUnit } from '../../types/events';

function createMockContext(overrides: Partial<SimContext> = {}): SimContext {
  return {
    currentTime: overrides.currentTime ?? 1.0,
    scheduleEvent: overrides.scheduleEvent ?? (() => {}),
    getComponent: () => { throw new Error('not implemented'); },
    getDownstream: () => [],
    random: overrides.random ?? (() => 0.5),
    recordMetric: () => {},
  };
}

function createWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'wu-1',
    originClientId: 'client-1',
    createdAt: 0,
    key: '',
    isRead: true,
    retryCount: 0,
    metadata: {},
    ...overrides,
  };
}

describe('shared utilities', () => {
  describe('createDepartureToOrigin', () => {
    it('creates a departure event targeting the originClientId', () => {
      const wu = createWorkUnit({ originClientId: 'client-42' });
      const ctx = createMockContext({ currentTime: 5.0 });
      const event = createDepartureToOrigin(wu, ctx, false);

      expect(event.kind).toBe('departure');
      expect(event.targetComponentId).toBe('client-42');
      expect(event.timestamp).toBe(5.0);
      expect(event.workUnit.metadata['failed']).toBe(false);
    });

    it('sets failed=true in metadata when failed', () => {
      const event = createDepartureToOrigin(createWorkUnit(), createMockContext(), true);
      expect(event.workUnit.metadata['failed']).toBe(true);
    });

    it('preserves existing metadata', () => {
      const wu = createWorkUnit({ metadata: { traceId: 'abc' } });
      const event = createDepartureToOrigin(wu, createMockContext(), false);
      expect(event.workUnit.metadata['traceId']).toBe('abc');
      expect(event.workUnit.metadata['failed']).toBe(false);
    });

    it('does not mutate the original work unit', () => {
      const wu = createWorkUnit();
      createDepartureToOrigin(wu, createMockContext(), true);
      expect(wu.metadata['failed']).toBeUndefined();
    });
  });

  describe('sampleDistribution', () => {
    it('samples uniform distribution in [min, max)', () => {
      const ctx = createMockContext({ random: () => 0.5 });
      const val = sampleDistribution({ type: 'uniform', min: 10, max: 20 }, ctx);
      expect(val).toBe(15);
    });

    it('samples exponential distribution', () => {
      const ctx = createMockContext({ random: () => 0.5 });
      const val = sampleDistribution({ type: 'exponential', mean: 1.0 }, ctx);
      expect(val).toBeCloseTo(-Math.log(0.5), 10);
    });

    it('samples log-normal distribution', () => {
      const ctx = createMockContext({ random: () => 0.5 });
      // With u1=0.5, u2=0.5: normal = sqrt(-2*ln(0.5)) * cos(π) = -sqrt(2*ln(2))
      const val = sampleDistribution({ type: 'log-normal', mu: 0, sigma: 1 }, ctx);
      expect(val).toBeGreaterThan(0);
    });
  });

  describe('applyLoadDependentLatency', () => {
    it('linear: base * (1 + factor * utilization)', () => {
      expect(applyLoadDependentLatency(10, 0.5, { mode: 'linear', factor: 2 })).toBe(20);
    });

    it('polynomial: base * (1 + factor * u^n)', () => {
      expect(applyLoadDependentLatency(10, 0.5, { mode: 'polynomial', factor: 4, exponent: 2 })).toBe(20);
    });

    it('exponential: base * e^(factor * u)', () => {
      const result = applyLoadDependentLatency(10, 1.0, { mode: 'exponential', factor: 1 });
      expect(result).toBeCloseTo(10 * Math.E, 10);
    });

    it('polynomial defaults exponent to 2', () => {
      const result = applyLoadDependentLatency(10, 0.5, { mode: 'polynomial', factor: 4 });
      expect(result).toBe(20); // 10 * (1 + 4 * 0.25)
    });

    it('returns base when utilization is 0', () => {
      expect(applyLoadDependentLatency(10, 0, { mode: 'linear', factor: 100 })).toBe(10);
      expect(applyLoadDependentLatency(10, 0, { mode: 'polynomial', factor: 100, exponent: 3 })).toBe(10);
      expect(applyLoadDependentLatency(10, 0, { mode: 'exponential', factor: 100 })).toBe(10);
    });
  });
});
