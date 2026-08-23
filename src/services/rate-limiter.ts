/**
 * Production-grade rate limiter with sliding window counters and token bucket burst support.
 *
 * Features:
 * - Sliding window counter (weighted previous + current window) for memory efficiency
 * - Token bucket overlay for configurable burst allowance
 * - Automatic garbage collection of expired entries
 * - Abstract RateLimitStore interface for future Redis adapter
 * - Standard rate-limit response headers
 * - Zero external dependencies
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitTier = {
  /** Maximum sustained requests allowed per window. */
  limit: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Multiplier for burst capacity (e.g. 1.5 = 50 % burst above limit). Defaults to 1. */
  burstMultiplier?: number;
};

export type RateLimitResult = {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** The configured limit for the tier. */
  limit: number;
  /** Remaining requests in the current window (never negative). */
  remaining: number;
  /** Absolute timestamp (ms since epoch) when the current window resets. */
  resetMs: number;
  /** Only present when `allowed` is false: milliseconds until a retry may succeed. */
  retryAfterMs?: number;
};

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface RateLimitStore {
  /**
   * Peek at the current state without consuming capacity.
   * Useful for informational headers on non-mutating endpoints.
   */
  check(key: string, tier: RateLimitTier): Promise<RateLimitResult> | RateLimitResult;

  /**
   * Consume one unit of capacity. Returns the updated state.
   */
  consume(key: string, tier: RateLimitTier): Promise<RateLimitResult> | RateLimitResult;
}

// ---------------------------------------------------------------------------
// Preset tiers
// ---------------------------------------------------------------------------

/** /generate endpoint: 12 req/min */
export const RATE_TIER_GENERATE: RateLimitTier = {
  limit: 12,
  windowMs: 60_000,
  burstMultiplier: 1.5,
};

/** Standard API calls: 60 req/min */
export const RATE_TIER_API: RateLimitTier = {
  limit: 60,
  windowMs: 60_000,
  burstMultiplier: 1.25,
};

/** Auth endpoints (login/signup): 5 req/min, no burst */
export const RATE_TIER_AUTH: RateLimitTier = {
  limit: 5,
  windowMs: 60_000,
  burstMultiplier: 1,
};

/** Stripe webhooks: 120 req/min */
export const RATE_TIER_WEBHOOK: RateLimitTier = {
  limit: 120,
  windowMs: 60_000,
  burstMultiplier: 1.5,
};

// ---------------------------------------------------------------------------
// Internal bucket state
// ---------------------------------------------------------------------------

interface BucketState {
  /** Request count in the *previous* full window. */
  prevCount: number;
  /** Request count in the *current* window. */
  currCount: number;
  /** Start timestamp of the current window (ms). */
  currWindowStart: number;
  /** Token bucket: available burst tokens. */
  burstTokens: number;
  /** Timestamp of the last burst-token refill. */
  lastRefill: number;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export class InMemoryRateLimiter implements RateLimitStore {
  private readonly buckets = new Map<string, Map<string, BucketState>>();
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(gcIntervalMs = 60_000) {
    if (gcIntervalMs > 0) {
      this.gcTimer = setInterval(() => this.gc(), gcIntervalMs);
      // Allow the process to exit without waiting for this timer.
      if (this.gcTimer && typeof this.gcTimer === 'object' && 'unref' in this.gcTimer) {
        (this.gcTimer as { unref: () => void }).unref();
      }
    }
  }

  // -- public API -----------------------------------------------------------

  check(key: string, tier: RateLimitTier): RateLimitResult {
    return this.evaluate(key, tier, false);
  }

  consume(key: string, tier: RateLimitTier): RateLimitResult {
    return this.evaluate(key, tier, true);
  }

  /** Stop the GC timer (useful in tests or graceful shutdown). */
  destroy(): void {
    if (this.gcTimer !== null) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  // -- internals ------------------------------------------------------------

  /**
   * Build a composite key from the tier so that the same string key can be
   * rate-limited independently across different tiers.
   */
  private tierKey(tier: RateLimitTier): string {
    return `${tier.limit}:${tier.windowMs}`;
  }

  private getOrCreateBucket(key: string, tier: RateLimitTier, now: number): BucketState {
    const tk = this.tierKey(tier);
    let tierMap = this.buckets.get(tk);
    if (!tierMap) {
      tierMap = new Map();
      this.buckets.set(tk, tierMap);
    }

    let bucket = tierMap.get(key);
    if (!bucket) {
      bucket = {
        prevCount: 0,
        currCount: 0,
        currWindowStart: now,
        burstTokens: this.maxBurst(tier),
        lastRefill: now,
      };
      tierMap.set(key, bucket);
    }
    return bucket;
  }

  private maxBurst(tier: RateLimitTier): number {
    const mult = tier.burstMultiplier ?? 1;
    return Math.floor(tier.limit * mult);
  }

  /**
   * Advance the sliding window so `currWindowStart` is always within the
   * current window period.  When the current window elapses, the current
   * count becomes the previous count and a fresh window starts.
   */
  private advanceWindow(bucket: BucketState, tier: RateLimitTier, now: number): void {
    const elapsed = now - bucket.currWindowStart;

    if (elapsed >= 2 * tier.windowMs) {
      // More than two full windows passed — everything expired.
      bucket.prevCount = 0;
      bucket.currCount = 0;
      bucket.currWindowStart = now;
    } else if (elapsed >= tier.windowMs) {
      // Exactly one window boundary crossed.
      bucket.prevCount = bucket.currCount;
      bucket.currCount = 0;
      bucket.currWindowStart = bucket.currWindowStart + tier.windowMs;
    }
    // else: still inside the current window, nothing to do.
  }

  /**
   * Refill burst tokens proportionally to elapsed time.
   * The refill rate is `tier.limit` tokens per `tier.windowMs`.
   */
  private refillBurst(bucket: BucketState, tier: RateLimitTier, now: number): void {
    const elapsed = now - bucket.lastRefill;
    if (elapsed <= 0) return;

    const maxTokens = this.maxBurst(tier);
    const refillRate = tier.limit / tier.windowMs; // tokens per ms
    const newTokens = elapsed * refillRate;
    bucket.burstTokens = Math.min(maxTokens, bucket.burstTokens + newTokens);
    bucket.lastRefill = now;
  }

  /**
   * Approximate count using the sliding window algorithm:
   *   count = prevCount * (1 - elapsed / windowMs) + currCount
   */
  private slidingCount(bucket: BucketState, tier: RateLimitTier, now: number): number {
    const elapsed = now - bucket.currWindowStart;
    const weight = Math.max(0, 1 - elapsed / tier.windowMs);
    return bucket.prevCount * weight + bucket.currCount;
  }

  private evaluate(key: string, tier: RateLimitTier, shouldConsume: boolean): RateLimitResult {
    const now = Date.now();
    const bucket = this.getOrCreateBucket(key, tier, now);

    this.advanceWindow(bucket, tier, now);
    this.refillBurst(bucket, tier, now);

    const effectiveCount = this.slidingCount(bucket, tier, now);
    const maxBurst = this.maxBurst(tier);

    // The request is allowed if BOTH the sliding-window AND burst-bucket permit it.
    const slidingAllowed = effectiveCount < tier.limit;
    const burstAllowed = bucket.burstTokens >= 1;

    // Burst can let requests through even when the sliding window is "full",
    // up to the burst ceiling.  We use the burst bucket as the *primary*
    // gate when a burst multiplier > 1 is configured.
    const allowed = burstAllowed && effectiveCount < maxBurst;

    if (shouldConsume && allowed) {
      bucket.currCount += 1;
      bucket.burstTokens = Math.max(0, bucket.burstTokens - 1);
    }

    // Remaining: how many more requests could go through.
    const remainingSliding = Math.max(0, maxBurst - Math.ceil(effectiveCount) - (shouldConsume && allowed ? 1 : 0));
    const remainingBurst = Math.max(0, Math.floor(bucket.burstTokens) - (shouldConsume && allowed ? 0 : 0));
    const remaining = Math.min(remainingSliding, remainingBurst);

    // Reset: end of the current window.
    const resetMs = bucket.currWindowStart + tier.windowMs;

    const result: RateLimitResult = {
      allowed,
      limit: tier.limit,
      remaining: Math.max(0, remaining),
      resetMs,
    };

    if (!allowed) {
      result.retryAfterMs = Math.max(1, resetMs - now);
    }

    return result;
  }

  /**
   * Garbage-collect buckets whose windows have fully expired (i.e. no
   * activity within 2x the window period means both prev and curr are zero).
   */
  private gc(): void {
    const now = Date.now();
    for (const [tierKey, tierMap] of this.buckets) {
      // Parse windowMs from the tier key (format "limit:windowMs").
      const windowMs = Number(tierKey.split(':')[1]);
      for (const [key, bucket] of tierMap) {
        if (now - bucket.currWindowStart >= 2 * windowMs) {
          tierMap.delete(key);
        }
      }
      if (tierMap.size === 0) {
        this.buckets.delete(tierKey);
      }
    }
  }

  /** Expose bucket count for testing. */
  get _size(): number {
    let total = 0;
    for (const tierMap of this.buckets.values()) {
      total += tierMap.size;
    }
    return total;
  }
}

// ---------------------------------------------------------------------------
// Header helper
// ---------------------------------------------------------------------------

/**
 * Converts a RateLimitResult into standard rate-limit headers.
 * Values follow the IETF RateLimit header fields draft.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil(result.resetMs / 1000)), // Unix epoch seconds
  };

  if (!result.allowed && result.retryAfterMs !== undefined) {
    headers['Retry-After'] = String(Math.ceil(result.retryAfterMs / 1000));
  }

  return headers;
}
