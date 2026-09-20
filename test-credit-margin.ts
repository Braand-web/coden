// Regression guard for the credit margin engine.
//
// The engine used to hold its own opinion of what a credit sells for —
// `sell_value_per_credit = 0.02` — while `priceFor()` charged between $0.20
// and $0.625. A tenfold error, in the direction that under-charges, and
// `usage_settlements` recorded its effect on every row it ever wrote:
// `realized_revenue_usd = 0.0200` against costs up to $0.0317, which is how a
// Kimi K3 conversation settled at −58% margin.
//
// Both numbers are derived from the billing catalogue now. These tests fail if
// either is restated as a literal, or if a heavy premium build stops clearing
// the target margin.

import assert from 'node:assert/strict';
import { CostEstimatorService, minimumRealizedCreditPriceUsd } from './src/services/credit-system.ts';
import { PUBLIC_PRICES, TARGET_GROSS_MARGIN } from './src/config/billing-v2.ts';

const estimator = new CostEstimatorService();

// The price the margin is computed against is the cheapest credit a customer
// can actually buy — so no other SKU can come out behind it.
{
  const floor = minimumRealizedCreditPriceUsd();
  const everyPublishedPrice = PUBLIC_PRICES.map(price => price.monthlyEquivalentUsd / price.credits);
  assert.ok(
    everyPublishedPrice.every(price => price >= floor - 1e-9),
    `the derived credit price must be the minimum across every SKU, got ${floor}`,
  );
  assert.ok(
    floor > 0.1,
    `a credit sells for far more than a cent; a floor of ${floor} means the catalogue link is broken again`,
  );
}

// A heavy premium build must clear the target margin at the WORST price a
// customer pays. This is the case that used to run at −194%, then at −58%.
{
  const heavy = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 2.95, // ~120k in / 35k out on a frontier model
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  const revenue = heavy.finalCredits * minimumRealizedCreditPriceUsd();
  assert.ok(
    revenue > 2.95,
    `heavy premium build must be margin-positive at the lowest realized credit price: revenue $${revenue.toFixed(2)} vs cost $2.95 (credits=${heavy.finalCredits})`,
  );
  const realizedMargin = (revenue - 2.95) / revenue;
  assert.ok(
    realizedMargin >= TARGET_GROSS_MARGIN - 0.01,
    `heavy build must clear the ${(TARGET_GROSS_MARGIN * 100).toFixed(0)}% target, got ${(realizedMargin * 100).toFixed(1)}%`,
  );
}

// And the engine's own estimate must agree with that, not with a rosier one.
{
  const heavy = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 2.95,
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  assert.ok(
    heavy.marginEstimated >= TARGET_GROSS_MARGIN * 100 - 1,
    `heavy build estimated margin must reach the target, got ${heavy.marginEstimated}%`,
  );
}

// A tiny cheap action still respects the per-action minimum and stays healthy.
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

// Guard the arithmetic itself: at the target margin, revenue is cost / (1 - m),
// so a $1.00 cost must map to exactly that many credits at the floor price.
{
  const oneDollar = estimator.calculateRequiredCredits({
    openrouter_cost_usd: 1.0,
    infra_cost_usd: 0,
    storage_cost_usd: 0,
    build_cost_usd: 0,
    domain_operation_cost_usd: 0,
  });
  const expected = 1.0 / (1 - TARGET_GROSS_MARGIN) / minimumRealizedCreditPriceUsd();
  assert.ok(
    Math.abs(oneDollar.finalCredits - expected) <= 0.1,
    `a $1.00 cost must map to ~${expected.toFixed(1)} credits, got ${oneDollar.finalCredits}`,
  );
}

console.log('test-credit-margin passed');
