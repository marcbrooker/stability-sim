import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { encodeScenario, decodeScenario } from './url-codec';

/**
 * Property-based tests for URL codec round-trip.
 *
 * The codec compresses scenario JSON with deflate-raw + base64url.
 * The key invariant: decode(encode(x)) ≡ x for any JSON-serializable value.
 */

/** Arbitrary for a JSON-serializable scenario-like object. */
const jsonObjectArb = fc.record({
  schemaVersion: fc.integer({ min: 1, max: 100 }),
  architecture: fc.record({
    name: fc.string({ minLength: 0, maxLength: 50 }),
    components: fc.array(
      fc.record({
        id: fc.string({ minLength: 1, maxLength: 20 }),
        type: fc.string({ minLength: 1, maxLength: 20 }),
        config: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.oneof(fc.integer(), fc.double({ noNaN: true }), fc.string(), fc.boolean())),
      }),
      { minLength: 0, maxLength: 5 },
    ),
  }),
  simulationConfig: fc.record({
    endTime: fc.integer({ min: 1, max: 10000 }),
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
  }),
});

describe('url-codec property tests', () => {
  it('round-trip: decode(encode(x)) produces a value equal to x', () => {
    fc.assert(
      fc.asyncProperty(jsonObjectArb, async (obj) => {
        const encoded = await encodeScenario(obj);
        const decoded = await decodeScenario(encoded);
        expect(decoded).toEqual(obj);
      }),
      { numRuns: 100 },
    );
  });

  it('encoded output is a valid base64url string (no +, /, or = characters)', () => {
    fc.assert(
      fc.asyncProperty(jsonObjectArb, async (obj) => {
        const encoded = await encodeScenario(obj);
        expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      }),
      { numRuns: 100 },
    );
  });
});
