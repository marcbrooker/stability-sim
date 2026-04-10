import type { Distribution } from '../types/configs';

/**
 * Seeded pseudo-random number generator using xoshiro128** algorithm.
 * Provides deterministic random number generation from a single integer seed.
 * The seed is expanded into 4 state words using splitmix32.
 */
export class SeededRNG {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed?: number) {
    if (seed !== undefined) {
      this.seed(seed);
    }
  }

  /**
   * Initialize internal state from a single integer seed using splitmix32
   * to expand into the 4 state words required by xoshiro128**.
   */
  seed(n: number): void {
    // Use splitmix32 to generate 4 state words from a single seed
    let s = n | 0;
    s = this.splitmix32(s);
    this.s0 = s;
    s = this.splitmix32(s);
    this.s1 = s;
    s = this.splitmix32(s);
    this.s2 = s;
    s = this.splitmix32(s);
    this.s3 = s;
  }

  /**
   * splitmix32: a simple 32-bit state hash used to expand a seed.
   */
  private splitmix32(state: number): number {
    state = (state + 0x9e3779b9) | 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  }

  /**
   * Generate the next random number in [0, 1) using xoshiro128**.
   */
  random(): number {
    const result = this.xoshiro128ss();
    return result / 0x100000000;
  }

  /**
   * xoshiro128** core: produces a 32-bit unsigned integer.
   */
  private xoshiro128ss(): number {
    const s0 = this.s0 >>> 0;
    const s1 = this.s1 >>> 0;
    const s2 = this.s2 >>> 0;
    const s3 = this.s3 >>> 0;

    // result = rotl(s1 * 5, 7) * 9
    const r = Math.imul(s1, 5);
    const result = (Math.imul(((r << 7) | (r >>> 25)) >>> 0, 9)) >>> 0;

    const t = (s1 << 9) >>> 0;

    let ns2 = s2 ^ s0;
    let ns3 = s3 ^ s1;
    this.s1 = (s1 ^ ns2) >>> 0;
    this.s0 = (s0 ^ ns3) >>> 0;
    this.s2 = (ns2 ^ t) >>> 0;
    this.s3 = (((ns3 << 11) | (ns3 >>> 21))) >>> 0;

    return result;
  }

  // --- Distribution samplers ---

  /**
   * Sample from a uniform distribution in [min, max).
   */
  uniform(min: number, max: number): number {
    return min + this.random() * (max - min);
  }

  /**
   * Sample from an exponential distribution with the given mean.
   * Uses inverse transform sampling: -mean * ln(1 - U).
   */
  exponential(mean: number): number {
    // Avoid log(0) by using 1 - random() which is in (0, 1]
    const u = this.random();
    return -mean * Math.log(1 - u);
  }

  /**
   * Sample from a log-normal distribution with parameters mu and sigma.
   * Uses Box-Muller transform to generate a normal sample, then exponentiates.
   */
  logNormal(mu: number, sigma: number): number {
    const normal = this.boxMullerNormal();
    return Math.exp(mu + sigma * normal);
  }

  /**
   * Box-Muller transform: generate a standard normal sample from two uniform samples.
   */
  private boxMullerNormal(): number {
    const u1 = this.random();
    const u2 = this.random();
    return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  }

  /**
   * Convenience method: sample from a Distribution config object.
   */
  sampleDistribution(dist: Distribution): number {
    switch (dist.type) {
      case 'uniform':
        return this.uniform(dist.min, dist.max);
      case 'exponential':
        return this.exponential(dist.mean);
      case 'log-normal':
        return this.logNormal(dist.mu, dist.sigma);
    }
  }
}
