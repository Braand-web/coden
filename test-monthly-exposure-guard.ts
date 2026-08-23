// Unit tests for the monthly exposure guard (Step 6 — pure margin cap logic).

import assert from 'node:assert/strict';
import {
  evaluateExposure,
  isOverExposureCap,
  exposureBlockReason,
} from './src/services/monthly-exposure-guard.ts';

// Under cap → allowed, with correct remaining.
{
  const e = evaluateExposure({ capUsd: 10, monthToDateUsd: 4, pendingUsd: 2 });
  assert.equal(e.allowed, true);
  assert.equal(e.projectedUsd, 6);
  assert.equal(e.remainingUsd, 6);
  assert.ok(Math.abs((e.utilization ?? 0) - 0.4) < 1e-9);
  assert.equal(exposureBlockReason(e), '');
}

// Exactly at cap → allowed (boundary inclusive).
{
  const e = evaluateExposure({ capUsd: 10, monthToDateUsd: 8, pendingUsd: 2 });
  assert.equal(e.allowed, true, 'projected == cap is allowed');
}

// Over cap → blocked, with a clear reason.
{
  const e = evaluateExposure({ capUsd: 10, monthToDateUsd: 9.5, pendingUsd: 1 });
  assert.equal(e.allowed, false);
  assert.equal(e.remainingUsd, 0.5);
  assert.match(exposureBlockReason(e), /Monthly usage limit/);
}

// Unlimited (null cap) → always allowed, no reason.
{
  const e = evaluateExposure({ capUsd: null, monthToDateUsd: 1_000_000, pendingUsd: 5000 });
  assert.equal(e.allowed, true);
  assert.equal(e.capUsd, null);
  assert.equal(e.remainingUsd, null);
  assert.equal(e.utilization, null);
  assert.equal(exposureBlockReason(e), '');
}

// Negative / NaN inputs are clamped to 0 (never falsely block, never crash).
{
  const e = evaluateExposure({ capUsd: 10, monthToDateUsd: -5, pendingUsd: Number.NaN });
  assert.equal(e.monthToDateUsd, 0);
  assert.equal(e.pendingUsd, 0);
  assert.equal(e.allowed, true);
}

// isOverExposureCap helper.
{
  assert.equal(isOverExposureCap(null, 999), false, 'unlimited is never over');
  assert.equal(isOverExposureCap(10, 10), true, 'at cap counts as over');
  assert.equal(isOverExposureCap(10, 9.99), false);
  assert.equal(isOverExposureCap(10, 4), false);
}

console.log('test-monthly-exposure-guard passed');
