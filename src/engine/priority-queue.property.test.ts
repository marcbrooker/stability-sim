import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { PriorityQueue } from './priority-queue';

/**
 * Property-based tests for PriorityQueue.
 *
 * **Validates: Requirements 1.1, 1.2**
 */
describe('PriorityQueue property tests', () => {
  /**
   * Property 2: extractMin always returns the minimum-priority element.
   *
   * For any non-empty list of (item, priority) pairs, inserting them all
   * and then calling extractMin must return the item with the lowest
   * priority value.
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  it('extractMin always returns the minimum-priority element', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.string(), fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })),
          { minLength: 1, maxLength: 200 }
        ),
        (pairs) => {
          const pq = new PriorityQueue<string>();
          for (const [item, priority] of pairs) {
            pq.insert(item, priority);
          }

          const minPriority = Math.min(...pairs.map(([, p]) => p));
          // Find the first inserted item with the minimum priority (FIFO tie-breaking)
          const expectedItem = pairs.find(([, p]) => p === minPriority)![0];

          expect(pq.extractMin()).toBe(expectedItem);
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * Property 3: insert followed by extracting all elements yields sorted order.
   *
   * For any list of (item, priority) pairs, inserting them all and then
   * extracting all elements must yield priorities in non-decreasing order,
   * with FIFO tie-breaking for equal priorities (items inserted earlier
   * come out first).
   *
   * **Validates: Requirements 1.1, 1.2**
   */
  it('extracting all elements yields non-decreasing priority order with FIFO tie-breaking', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.integer({ min: 0, max: 999 }), fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })),
          { minLength: 0, maxLength: 200 }
        ),
        (pairs) => {
          const pq = new PriorityQueue<number>();
          // Insert items using their original index as the item value
          // so we can verify FIFO ordering for equal priorities
          for (let i = 0; i < pairs.length; i++) {
            const [, priority] = pairs[i];
            pq.insert(i, priority);
          }

          const extracted: { item: number; priority: number }[] = [];
          while (pq.size > 0) {
            const item = pq.extractMin()!;
            extracted.push({ item, priority: pairs[item][1] });
          }

          // Verify non-decreasing priority order
          for (let i = 1; i < extracted.length; i++) {
            expect(extracted[i].priority).toBeGreaterThanOrEqual(extracted[i - 1].priority);
          }

          // Verify FIFO tie-breaking: among elements with equal priority,
          // insertion order (original index) must be non-decreasing
          for (let i = 1; i < extracted.length; i++) {
            if (extracted[i].priority === extracted[i - 1].priority) {
              expect(extracted[i].item).toBeGreaterThan(extracted[i - 1].item);
            }
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
