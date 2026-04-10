/**
 * Min-heap priority queue with deterministic tie-breaking.
 *
 * Items are ordered by (priority, insertionOrder) so that equal-priority
 * items are extracted in FIFO order.  This guarantees deterministic
 * event ordering in the simulation engine.
 *
 * Validates: Requirements 1.1, 1.2
 */

interface HeapEntry<T> {
  item: T;
  priority: number;
  order: number;
}

export class PriorityQueue<T> {
  private heap: HeapEntry<T>[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  /** Insert an item with the given priority (lower = higher urgency). */
  insert(item: T, priority: number): void {
    if (Number.isNaN(priority)) {
      throw new Error(`PriorityQueue: NaN priority`);
    }
    const entry: HeapEntry<T> = { item, priority, order: this.counter++ };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  /** Remove and return the minimum-priority item, or undefined if empty. */
  extractMin(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const min = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return min.item;
  }

  /** Return the minimum-priority item without removing it, or undefined if empty. */
  peek(): T | undefined {
    return this.heap.length === 0 ? undefined : this.heap[0].item;
  }

  /** Remove all items and reset the insertion counter. */
  clear(): void {
    this.heap = [];
    this.counter = 0;
  }

  // --- heap internals ---

  private less(i: number, j: number): boolean {
    const a = this.heap[i];
    const b = this.heap[j];
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.order < b.order;
  }

  private swap(i: number, j: number): void {
    const tmp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = tmp;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(i, parent)) {
        this.swap(i, parent);
        i = parent;
      } else {
        break;
      }
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}
