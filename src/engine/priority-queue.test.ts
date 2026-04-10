import { describe, it, expect } from 'vitest';
import { PriorityQueue } from './priority-queue';

describe('PriorityQueue', () => {
  describe('basic operations', () => {
    it('starts empty', () => {
      const pq = new PriorityQueue<string>();
      expect(pq.size).toBe(0);
      expect(pq.peek()).toBeUndefined();
      expect(pq.extractMin()).toBeUndefined();
    });

    it('insert increases size', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', 1);
      expect(pq.size).toBe(1);
      pq.insert('b', 2);
      expect(pq.size).toBe(2);
    });

    it('rejects NaN priority', () => {
      const pq = new PriorityQueue<string>();
      expect(() => pq.insert('a', NaN)).toThrow('NaN priority');
    });

    it('accepts Infinity priority (filtered by engine endTime check)', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', Infinity);
      expect(pq.size).toBe(1);
    });

    it('accepts negative priority', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', -1);
      expect(pq.extractMin()).toBe('a');
    });

    it('extractMin decreases size', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', 1);
      pq.insert('b', 2);
      pq.extractMin();
      expect(pq.size).toBe(1);
    });

    it('peek returns min without removing', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', 5);
      pq.insert('b', 2);
      expect(pq.peek()).toBe('b');
      expect(pq.size).toBe(2);
    });

    it('clear removes all items and resets', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('a', 1);
      pq.insert('b', 2);
      pq.clear();
      expect(pq.size).toBe(0);
      expect(pq.peek()).toBeUndefined();
    });
  });

  describe('ordering', () => {
    it('extracts items in priority order', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('c', 3);
      pq.insert('a', 1);
      pq.insert('b', 2);
      expect(pq.extractMin()).toBe('a');
      expect(pq.extractMin()).toBe('b');
      expect(pq.extractMin()).toBe('c');
    });

    it('breaks ties by insertion order (FIFO)', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('first', 5);
      pq.insert('second', 5);
      pq.insert('third', 5);
      expect(pq.extractMin()).toBe('first');
      expect(pq.extractMin()).toBe('second');
      expect(pq.extractMin()).toBe('third');
    });

    it('handles mixed priorities with ties correctly', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('b1', 2);
      pq.insert('a1', 1);
      pq.insert('a2', 1);
      pq.insert('b2', 2);
      expect(pq.extractMin()).toBe('a1');
      expect(pq.extractMin()).toBe('a2');
      expect(pq.extractMin()).toBe('b1');
      expect(pq.extractMin()).toBe('b2');
    });
  });

  describe('edge cases', () => {
    it('works with a single element', () => {
      const pq = new PriorityQueue<number>();
      pq.insert(42, 0);
      expect(pq.peek()).toBe(42);
      expect(pq.extractMin()).toBe(42);
      expect(pq.extractMin()).toBeUndefined();
    });

    it('works with negative priorities', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('neg', -10);
      pq.insert('pos', 10);
      expect(pq.extractMin()).toBe('neg');
    });

    it('works with fractional priorities', () => {
      const pq = new PriorityQueue<string>();
      pq.insert('b', 1.5);
      pq.insert('a', 1.1);
      pq.insert('c', 1.9);
      expect(pq.extractMin()).toBe('a');
      expect(pq.extractMin()).toBe('b');
      expect(pq.extractMin()).toBe('c');
    });
  });
});
