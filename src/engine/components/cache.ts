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

  // Key-based cache store: key → entry
  private store: Map<string, CacheEntry> = new Map();
  // Insertion-order list for FIFO eviction
  private insertionOrder: string[] = [];

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
      return;
    }

    const maxSize = this.cacheConfig.maxSize;
    if (maxSize && maxSize > 0 && this.store.size >= maxSize) {
      this.evict();
    }

    this.store.set(key, { key, insertedAt: currentTime, lastAccessedAt: currentTime });
    this.insertionOrder.push(key);
  }

  private evict(): void {
    const policy = this.cacheConfig.evictionPolicy ?? 'lru';
    if (policy === 'fifo') {
      while (this.insertionOrder.length > 0) {
        const oldest = this.insertionOrder.shift()!;
        if (this.store.has(oldest)) {
          this.store.delete(oldest);
          return;
        }
      }
    } else {
      let lruKey: string | null = null;
      let lruTime = Infinity;
      for (const [k, entry] of this.store) {
        if (entry.lastAccessedAt < lruTime) {
          lruTime = entry.lastAccessedAt;
          lruKey = k;
        }
      }
      if (lruKey) {
        this.store.delete(lruKey);
      }
    }
  }

  private removeKey(key: string): void {
    this.store.delete(key);
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
    this.insertionOrder = [];
    this.pendingOrigins.clear();
  }

  /** Clear all cached entries (used by failure injector for cache-flush). */
  flush(): void {
    this.store.clear();
    this.insertionOrder = [];
  }
}
