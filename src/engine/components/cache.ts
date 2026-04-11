import { v4 as uuidv4 } from 'uuid';
import type { SimEvent, WorkUnit } from '../../types/events';
import type {
  SimComponent,
  SimContext,
  ComponentConfig,
  ComponentMetrics,
} from '../../types/components';
import type { CacheConfig } from '../../types/configs';

interface CacheEntry {
  key: string;
  insertedAt: number;
  lastAccessedAt: number;
  prev: CacheEntry | null;
  next: CacheEntry | null;
}

/**
 * Cache component with key-based caching, TTL, bounded size, and eviction.
 *
 * When a work unit arrives:
 * - If the work unit has a non-empty key and that key is in the cache (and not expired), it's a hit.
 * - Otherwise it's a miss: forward to downstream with originClientId rewritten to this cache's ID
 *   so the response routes back through the cache. On departure, restore the real origin, cache
 *   the key (on success), and forward to the client.
 * - If no key is set on the work unit, fall back to probabilistic hitRate.
 */
export class Cache implements SimComponent {
  readonly id: string;
  readonly type = 'cache' as const;
  readonly config: ComponentConfig;

  private cacheConfig: CacheConfig;

  // Key-based cache store: key → entry (entry is also an LRU list node)
  private store: Map<string, CacheEntry> = new Map();
  // Doubly-linked list for O(1) LRU/FIFO eviction (head = oldest/LRU, tail = newest/MRU)
  private lruHead: CacheEntry | null = null;
  private lruTail: CacheEntry | null = null;

  // Track real origin for in-flight misses: workUnitId → real originClientId
  private pendingOrigins: Map<string, string> = new Map();

  // Metrics
  private hitCount: number = 0;
  private missCount: number = 0;
  private totalRequests: number = 0;

  constructor(id: string, cacheConfig: CacheConfig) {
    this.id = id;
    this.cacheConfig = cacheConfig;
    this.config = { type: 'cache', ...cacheConfig };
  }

  handleEvent(event: SimEvent, context: SimContext): SimEvent[] {
    if (event.kind === 'arrival') {
      return this.handleArrival(event, context);
    } else if (event.kind === 'departure') {
      return this.handleDeparture(event, context);
    }
    return [];
  }

  private handleArrival(event: SimEvent, context: SimContext): SimEvent[] {
    this.totalRequests++;
    const key = event.workUnit.key;

    let isHit: boolean;
    if (key) {
      const entry = this.store.get(key);
      if (entry && !this.isExpired(entry, context.currentTime)) {
        isHit = true;
        entry.lastAccessedAt = context.currentTime;
        // Move to tail only for LRU — FIFO evicts by insertion order, not access order
        if ((this.cacheConfig.evictionPolicy ?? 'lru') === 'lru') {
          this.unlinkEntry(entry);
          this.appendEntry(entry);
        }
      } else {
        if (entry) this.removeKey(key);
        isHit = false;
      }
    } else {
      isHit = context.random() < this.cacheConfig.hitRate;
    }

    if (isHit) {
      this.hitCount++;
      this.recordMetrics(context);
      return [this.createDepartureToOrigin(event.workUnit, context, false)];
    }

    this.missCount++;
    this.recordMetrics(context);

    // Stash the real origin and rewrite originClientId to this cache so the
    // downstream response routes back here as a departure.
    const realOrigin = event.workUnit.originClientId;
    this.pendingOrigins.set(event.workUnit.id, realOrigin);

    const forwardedWu: WorkUnit = {
      ...event.workUnit,
      originClientId: this.id,
    };

    const arrivalEvent: SimEvent = {
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: this.cacheConfig.downstreamComponentId,
      workUnit: forwardedWu,
      kind: 'arrival',
    };
    context.scheduleEvent(arrivalEvent);
    return [];
  }

  private handleDeparture(event: SimEvent, context: SimContext): SimEvent[] {
    const failed = event.workUnit.metadata['failed'] === true;

    // On successful downstream response, cache the key
    if (!failed && event.workUnit.key) {
      this.insertKey(event.workUnit.key, context.currentTime);
    }

    // Restore the real origin (keep the mapping for duplicate responses from retries)
    const realOrigin = this.pendingOrigins.get(event.workUnit.id)
      ?? (event.workUnit.originClientId !== this.id ? event.workUnit.originClientId : null);

    // If no mapping and originClientId is this cache, it's a stale duplicate — drop it
    if (!realOrigin) {
      return [];
    }

    const wu: WorkUnit = {
      ...event.workUnit,
      originClientId: realOrigin,
      metadata: { ...event.workUnit.metadata, failed },
    };
    return [{
      id: uuidv4(),
      timestamp: context.currentTime,
      targetComponentId: realOrigin,
      workUnit: wu,
      kind: 'departure',
    }];
  }

  private isExpired(entry: CacheEntry, currentTime: number): boolean {
    const ttl = this.cacheConfig.ttl;
    if (ttl === undefined || ttl <= 0) return false;
    return currentTime - entry.insertedAt >= ttl;
  }

  private insertKey(key: string, currentTime: number): void {
    if (this.store.has(key)) {
      const entry = this.store.get(key)!;
      entry.insertedAt = currentTime;
      entry.lastAccessedAt = currentTime;
      // Move to tail (most recently used/inserted)
      this.unlinkEntry(entry);
      this.appendEntry(entry);
      return;
    }

    const maxSize = this.cacheConfig.maxSize;
    if (maxSize && maxSize > 0 && this.store.size >= maxSize) {
      this.evict();
    }

    const entry: CacheEntry = { key, insertedAt: currentTime, lastAccessedAt: currentTime, prev: null, next: null };
    this.store.set(key, entry);
    this.appendEntry(entry);
  }

  /** O(1) eviction: remove the head of the list (oldest for FIFO, least-recently-used for LRU) */
  private evict(): void {
    // Both FIFO and LRU evict the head: for FIFO it's the oldest insertion,
    // for LRU it's the least-recently-accessed (moved to tail on access).
    if (!this.lruHead) return;
    const victim = this.lruHead;
    this.unlinkEntry(victim);
    this.store.delete(victim.key);
  }

  private removeKey(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      this.unlinkEntry(entry);
      this.store.delete(key);
    }
  }

  /** Remove an entry from the doubly-linked list */
  private unlinkEntry(entry: CacheEntry): void {
    if (entry.prev) {
      entry.prev.next = entry.next;
    } else {
      this.lruHead = entry.next;
    }
    if (entry.next) {
      entry.next.prev = entry.prev;
    } else {
      this.lruTail = entry.prev;
    }
    entry.prev = null;
    entry.next = null;
  }

  /** Append an entry at the tail of the list (most recently used) */
  private appendEntry(entry: CacheEntry): void {
    entry.prev = this.lruTail;
    entry.next = null;
    if (this.lruTail) {
      this.lruTail.next = entry;
    } else {
      this.lruHead = entry;
    }
    this.lruTail = entry;
  }

  private createDepartureToOrigin(
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

  private recordMetrics(context: SimContext): void {
    context.recordMetric(this.id, 'hitCount', this.hitCount, context.currentTime);
    context.recordMetric(this.id, 'missCount', this.missCount, context.currentTime);
    context.recordMetric(this.id, 'totalRequests', this.totalRequests, context.currentTime);
    const computedHitRate = this.totalRequests > 0 ? this.hitCount / this.totalRequests : 0;
    context.recordMetric(this.id, 'hitRate', computedHitRate, context.currentTime);
    context.recordMetric(this.id, 'cacheSize', this.store.size, context.currentTime);
  }

  getMetrics(): ComponentMetrics {
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      totalRequests: this.totalRequests,
      hitRate: this.totalRequests > 0 ? this.hitCount / this.totalRequests : 0,
      cacheSize: this.store.size,
    };
  }

  reset(): void {
    this.hitCount = 0;
    this.missCount = 0;
    this.totalRequests = 0;
    this.store.clear();
    this.lruHead = null;
    this.lruTail = null;
    this.pendingOrigins.clear();
  }

  /** Clear all cached entries (used by failure injector for cache-flush). */
  flush(): void {
    this.store.clear();
    this.lruHead = null;
    this.lruTail = null;
  }
}
