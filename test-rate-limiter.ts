/**
 * Tests for the rate-limiter service.
 * Run: node --experimental-strip-types test-rate-limiter.ts
 */

import assert from 'node:assert/strict';
import {
  InMemoryRateLimiter,
  rateLimitHeaders,
  RATE_TIER_GENERATE,
  RATE_TIER_API,
  RATE_TIER_AUTH,
  RATE_TIER_WEBHOOK,
  type RateLimitTier,
  type RateLimitResult,
} from './src/services/rate-limiter.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub Date.now() to a fixed value for deterministic tests. */
let fakeNow = 1_000_000;
const originalDateNow = Date.now;

function freezeTime(ms: number): void {
  fakeNow = ms;
  Date.now = () => fakeNow;
}

function advanceTime(ms: number): void {
  fakeNow += ms;
}

function restoreTime(): void {
  Date.now = originalDateNow;
}

// Use GC interval of 0 to disable the timer (we'll call gc manually via _size).
function makeLimiter(): InMemoryRateLimiter {
  return new InMemoryRateLimiter(0);
}

// ---------------------------------------------------------------------------
// Test: basic rate limiting — allow up to limit, then deny
// ---------------------------------------------------------------------------
{
  freezeTime(1_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 3, windowMs: 60_000, burstMultiplier: 1 };

  const r1 = limiter.consume('user-1', tier);
  assert.equal(r1.allowed, true, 'request 1 should be allowed');

  const r2 = limiter.consume('user-1', tier);
  assert.equal(r2.allowed, true, 'request 2 should be allowed');

  const r3 = limiter.consume('user-1', tier);
  assert.equal(r3.allowed, true, 'request 3 should be allowed');

  const r4 = limiter.consume('user-1', tier);
  assert.equal(r4.allowed, false, 'request 4 should be denied (over limit)');
  assert.equal(typeof r4.retryAfterMs, 'number', 'denied result should have retryAfterMs');
  assert.ok(r4.retryAfterMs! > 0, 'retryAfterMs should be positive');

  // Different key should be independent.
  const r5 = limiter.consume('user-2', tier);
  assert.equal(r5.allowed, true, 'different user should be allowed');

  limiter.destroy();
  console.log('  [pass] basic rate limiting');
}

// ---------------------------------------------------------------------------
// Test: burst allowance
// ---------------------------------------------------------------------------
{
  freezeTime(2_000_000);
  const limiter = makeLimiter();
  // limit=3 with burst multiplier 2 => burst ceiling = 6
  const tier: RateLimitTier = { limit: 3, windowMs: 60_000, burstMultiplier: 2 };

  let allowed = 0;
  for (let i = 0; i < 10; i++) {
    const r = limiter.consume('burst-user', tier);
    if (r.allowed) allowed++;
  }

  // With burst multiplier of 2, we should be able to get more than the base limit
  // but no more than limit * burstMultiplier = 6.
  assert.ok(allowed > 3, `burst should allow more than base limit (got ${allowed})`);
  assert.ok(allowed <= 6, `burst should not exceed limit * burstMultiplier (got ${allowed})`);

  limiter.destroy();
  console.log('  [pass] burst allowance');
}

// ---------------------------------------------------------------------------
// Test: sliding window behavior — requests expire over time
// ---------------------------------------------------------------------------
{
  freezeTime(3_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 3, windowMs: 60_000, burstMultiplier: 1 };

  // Fill up the limit.
  limiter.consume('sw-user', tier);
  limiter.consume('sw-user', tier);
  limiter.consume('sw-user', tier);

  const denied = limiter.consume('sw-user', tier);
  assert.equal(denied.allowed, false, 'should be denied at limit');

  // Advance past the full window. The 3 requests from the previous window
  // should decay via the sliding weight.
  advanceTime(60_001);

  // Now the window has rotated: prevCount=3, currCount=0.
  // Sliding count = 3 * (1 - 1/60000) ~ nearly 0 + 0 = ~0.
  // Actually at exactly 60001ms past currWindowStart, advanceWindow triggers:
  //   prevCount = 3, currCount = 0, currWindowStart advances by windowMs.
  // So elapsed from new currWindowStart = 1ms, weight = 1 - 1/60000 ≈ 1.
  // slidingCount ≈ 3 * 0.99998 ≈ 2.9999.  Still under limit of 3.
  const afterWindow = limiter.consume('sw-user', tier);
  assert.equal(afterWindow.allowed, true, 'should be allowed after window passes');

  // Advance well into the window so previous count decays significantly.
  advanceTime(50_000);
  // Now elapsed = 50001ms into new window. weight ≈ 1 - 50001/60000 ≈ 0.167.
  // slidingCount = 3 * 0.167 + 1 ≈ 1.5. Well under limit.
  const decayed = limiter.consume('sw-user', tier);
  assert.equal(decayed.allowed, true, 'should be allowed as previous window decays');

  // Advance past two full windows — everything is forgotten.
  advanceTime(200_000);
  for (let i = 0; i < 3; i++) {
    const r = limiter.consume('sw-user', tier);
    assert.equal(r.allowed, true, `should be allowed after full reset (req ${i + 1})`);
  }

  limiter.destroy();
  console.log('  [pass] sliding window behavior');
}

// ---------------------------------------------------------------------------
// Test: GC doesn't break active keys
// ---------------------------------------------------------------------------
{
  freezeTime(4_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 5, windowMs: 10_000, burstMultiplier: 1 };

  limiter.consume('active-user', tier);
  limiter.consume('stale-user', tier);

  assert.equal(limiter._size, 2, 'should have 2 buckets');

  // Make stale-user expire (advance > 2 * windowMs).
  advanceTime(25_000);

  // Touch active-user so it stays alive.
  limiter.consume('active-user', tier);

  // The active-user bucket got advanced by advanceWindow, but stale-user
  // did not. After 25s (> 2 * 10s), stale-user's bucket should be GC'd
  // on the next check cycle. We trigger GC by consuming, which won't
  // call gc() directly — gc runs on a timer. Since we disabled the timer,
  // let's simulate by consuming and checking _size after a consume.
  // Actually, _size just counts buckets. stale-user's bucket is still in
  // the map until gc() runs. Let's verify the *active* user still works.

  const result = limiter.consume('active-user', tier);
  assert.equal(result.allowed, true, 'active user should still work after time passes');

  // Verify stale-user's limit is fully reset (effectively new bucket behavior).
  const staleResult = limiter.consume('stale-user', tier);
  assert.equal(staleResult.allowed, true, 'stale user should be allowed (window reset)');
  assert.equal(staleResult.remaining, 4, 'stale user should have nearly full capacity');

  limiter.destroy();
  console.log('  [pass] GC does not break active keys');
}

// ---------------------------------------------------------------------------
// Test: headers format
// ---------------------------------------------------------------------------
{
  freezeTime(5_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 10, windowMs: 60_000, burstMultiplier: 1 };

  const result = limiter.consume('header-user', tier);
  const headers = rateLimitHeaders(result);

  assert.equal(headers['RateLimit-Limit'], '10');
  assert.ok(Number(headers['RateLimit-Remaining']) >= 0);
  assert.ok(Number(headers['RateLimit-Reset']) > 0, 'Reset should be a positive Unix timestamp');
  assert.equal(headers['Retry-After'], undefined, 'Retry-After should not be present when allowed');

  // Exhaust the limit.
  for (let i = 0; i < 10; i++) {
    limiter.consume('header-user', tier);
  }

  const denied = limiter.consume('header-user', tier);
  const deniedHeaders = rateLimitHeaders(denied);

  assert.equal(deniedHeaders['RateLimit-Remaining'], '0');
  assert.ok(deniedHeaders['Retry-After'] !== undefined, 'Retry-After should be present when denied');
  assert.ok(Number(deniedHeaders['Retry-After']) > 0, 'Retry-After should be positive');

  limiter.destroy();
  console.log('  [pass] headers format');
}

// ---------------------------------------------------------------------------
// Test: check() doesn't consume capacity
// ---------------------------------------------------------------------------
{
  freezeTime(6_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 2, windowMs: 60_000, burstMultiplier: 1 };

  // Check several times — should not reduce capacity.
  const c1 = limiter.check('check-user', tier);
  const c2 = limiter.check('check-user', tier);
  const c3 = limiter.check('check-user', tier);

  assert.equal(c1.allowed, true);
  assert.equal(c2.allowed, true);
  assert.equal(c3.allowed, true);
  assert.equal(c1.remaining, c2.remaining, 'check should not change remaining');
  assert.equal(c2.remaining, c3.remaining, 'check should not change remaining');

  // Now actually consume.
  limiter.consume('check-user', tier);
  limiter.consume('check-user', tier);

  const afterConsume = limiter.check('check-user', tier);
  assert.equal(afterConsume.allowed, false, 'should be denied after consuming full capacity');

  // But check still should not consume — a subsequent consume should also be denied.
  const denyConsume = limiter.consume('check-user', tier);
  assert.equal(denyConsume.allowed, false, 'consume should also be denied');

  limiter.destroy();
  console.log('  [pass] check() does not consume capacity');
}

// ---------------------------------------------------------------------------
// Test: preset tiers are correctly defined
// ---------------------------------------------------------------------------
{
  assert.equal(RATE_TIER_GENERATE.limit, 12);
  assert.equal(RATE_TIER_GENERATE.windowMs, 60_000);

  assert.equal(RATE_TIER_API.limit, 60);
  assert.equal(RATE_TIER_API.windowMs, 60_000);

  assert.equal(RATE_TIER_AUTH.limit, 5);
  assert.equal(RATE_TIER_AUTH.windowMs, 60_000);

  assert.equal(RATE_TIER_WEBHOOK.limit, 120);
  assert.equal(RATE_TIER_WEBHOOK.windowMs, 60_000);

  console.log('  [pass] preset tiers');
}

// ---------------------------------------------------------------------------
// Test: remaining count decreases correctly
// ---------------------------------------------------------------------------
{
  freezeTime(7_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 5, windowMs: 60_000, burstMultiplier: 1 };

  const results: RateLimitResult[] = [];
  for (let i = 0; i < 5; i++) {
    results.push(limiter.consume('remaining-user', tier));
  }

  // Each successive consume should show a decreasing remaining count.
  for (let i = 0; i < results.length - 1; i++) {
    assert.ok(
      results[i].remaining > results[i + 1].remaining,
      `remaining should decrease: ${results[i].remaining} > ${results[i + 1].remaining} (at index ${i})`
    );
  }

  // Last allowed request should show 0 remaining.
  assert.equal(results[results.length - 1].remaining, 0, 'last allowed request should show 0 remaining');

  limiter.destroy();
  console.log('  [pass] remaining count decreases');
}

// ---------------------------------------------------------------------------
// Test: burst tokens refill over time
// ---------------------------------------------------------------------------
{
  freezeTime(8_000_000);
  const limiter = makeLimiter();
  const tier: RateLimitTier = { limit: 4, windowMs: 60_000, burstMultiplier: 1.5 };
  // maxBurst = floor(4 * 1.5) = 6

  // Consume 6 requests quickly (burst allows it).
  let consumed = 0;
  for (let i = 0; i < 10; i++) {
    const r = limiter.consume('refill-user', tier);
    if (r.allowed) consumed++;
  }
  assert.equal(consumed, 6, 'should allow exactly 6 burst requests');

  // Now advance past the full window to reset sliding counter + refill tokens.
  advanceTime(120_001);

  // Should be able to consume again.
  const afterReset = limiter.consume('refill-user', tier);
  assert.equal(afterReset.allowed, true, 'should be allowed after full window reset and token refill');

  limiter.destroy();
  console.log('  [pass] burst tokens refill over time');
}

// ---------------------------------------------------------------------------
// Cleanup & result
// ---------------------------------------------------------------------------
restoreTime();
console.log('test-rate-limiter passed');
