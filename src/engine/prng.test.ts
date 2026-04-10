import { describe, it, expect } from 'vitest';
import { SeededRNG } from './prng';

describe('SeededRNG', () => {
  describe('seed and determinism', () => {
    it('same seed produces identical sequence', () => {
      const rng1 = new SeededRNG(42);
      const rng2 = new SeededRNG(42);
      for (let i = 0; i < 100; i++) {
        expect(rng1.random()).toBe(rng2.random());
      }
    });

    it('different seeds produce different sequences', () => {
      const rng1 = new SeededRNG(1);
      const rng2 = new SeededRNG(2);
      const seq1 = Array.from({ length: 10 }, () => rng1.random());
      const seq2 = Array.from({ length: 10 }, () => rng2.random());
      expect(seq1).not.toEqual(seq2);
    });

    it('re-seeding resets the sequence', () => {
      const rng = new SeededRNG(99);
      const first = Array.from({ length: 5 }, () => rng.random());
      rng.seed(99);
      const second = Array.from({ length: 5 }, () => rng.random());
      expect(first).toEqual(second);
    });
  });

  describe('random() range', () => {
    it('returns values in [0, 1)', () => {
      const rng = new SeededRNG(123);
      for (let i = 0; i < 1000; i++) {
        const v = rng.random();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });
  });

  describe('uniform(min, max)', () => {
    it('returns values in [min, max)', () => {
      const rng = new SeededRNG(7);
      for (let i = 0; i < 500; i++) {
        const v = rng.uniform(5, 10);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThan(10);
      }
    });
  });

  describe('exponential(mean)', () => {
    it('returns non-negative values', () => {
      const rng = new SeededRNG(55);
      for (let i = 0; i < 500; i++) {
        expect(rng.exponential(10)).toBeGreaterThanOrEqual(0);
      }
    });

    it('mean of many samples approximates the configured mean', () => {
      const rng = new SeededRNG(200);
      const mean = 5;
      const n = 10000;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        sum += rng.exponential(mean);
      }
      const sampleMean = sum / n;
      expect(sampleMean).toBeGreaterThan(mean * 0.9);
      expect(sampleMean).toBeLessThan(mean * 1.1);
    });
  });

  describe('logNormal(mu, sigma)', () => {
    it('returns positive values', () => {
      const rng = new SeededRNG(77);
      for (let i = 0; i < 500; i++) {
        expect(rng.logNormal(0, 1)).toBeGreaterThan(0);
      }
    });
  });

  describe('sampleDistribution', () => {
    it('dispatches to uniform', () => {
      const rng = new SeededRNG(1);
      const v = rng.sampleDistribution({ type: 'uniform', min: 0, max: 1 });
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    });

    it('dispatches to exponential', () => {
      const rng = new SeededRNG(2);
      const v = rng.sampleDistribution({ type: 'exponential', mean: 10 });
      expect(v).toBeGreaterThanOrEqual(0);
    });

    it('dispatches to log-normal', () => {
      const rng = new SeededRNG(3);
      const v = rng.sampleDistribution({ type: 'log-normal', mu: 0, sigma: 1 });
      expect(v).toBeGreaterThan(0);
    });
  });
});
