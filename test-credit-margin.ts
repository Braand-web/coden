// Regression guard for the credit margin engine.
//
// Protects the fix where sell_value_per_credit was 0.20 (a 10x overestimate of
// the real ~$0.018–0.02 a credit actually sells for), which made every reported
// margin fictional and caused real losses on heavy premium builds.
//
// These tests fail if anyone reintroduces an inflated credit value, or if a
// heavy premium build stops being margin-positive.

import assert from 'node:assert/strict';
import { CostEstimatorService } from './src/services/credit-system.ts';

const estimator = new CostEstimatorService();

// The realized price of a credit across SKUs (Pro $25/1000 … Scale volume
// top-up $50/4000) sits at or below $0.025. The engine's internal value must be
// at or below that floor — never an order of magnitude above it.
{
  const heavy = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 2.95, // ~120k in / 35k out on a frontier model
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  // Revenue at the WORST realized price a customer pays (Scale volume = $0.0125)
  // must still beat cost. This is the case that used to run at -194%.
  const worstRealizedPrice = 0.0125;
  const revenue = heavy.finalCredits * worstRealizedPrice;
  assert.ok(
    revenue > 2.95,
    `heavy premium build must be margin-positive even at the lowest realized credit price: revenue $${revenue.toFixed(2)} vs cost $2.95 (credits=${heavy.finalCredits})`,
  );
}

// The engine's own margin estimate for a heavy build must be >= 65%.
{
  const heavy = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 2.95,
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  assert.ok(
    heavy.marginEstimated >= 65,
    `heavy build estimated margin must be >= 65%, got ${heavy.marginEstimated}%`,
  );
}

// A tiny cheap action still respects the per-action minimum and stays positive.
{
  const tiny = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 0.0008, // small edit on an economy model
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
    minimum_action_credits: 1,
  });
  assert.ok(tiny.finalCredits >= 1, 'tiny action respects the minimum action credits');
  assert.ok(tiny.marginEstimated >= 65, `tiny action margin should be healthy, got ${tiny.marginEstimated}%`);
}

// Guard the constant itself: a $1.00 real cost must require clearly more than
// the ~17 credits the broken 0.20 value produced (it should now be ~170).
{
  const oneDollar = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 1.0,
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  assert.ok(
    oneDollar.finalCredits > 100,
    `a $1.00 cost must map to >100 credits with a correctly-priced credit, got ${oneDollar.finalCredits}`,
  );
}

console.log('test-credit-margin passed');
