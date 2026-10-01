import { describe, expect, it } from 'vitest';
import {
  ACTION_CREDIT_PRICES,
  ANNUAL_DISCOUNT,
  BILLING_PLANS,
  BILLING_XAF_PER_USD,
  CREDIT_TIERS,
  MONTHLY_EMAILS,
  PUBLIC_PRICES,
  TOPUP_PRODUCTS_V2,
  TOPUP_TIERS,
  planComparisonRows,
  planFeatures,
} from './billing-v2';
import { MODEL_REGISTRY } from './ai-models';
import { ROUTING_MODES, ROUTING_MODE_HINTS, ROUTING_MODE_LABELS } from '../lib/routing-mode';
import { REASONING_LEVELS } from '../services/openrouter-request';

/**
 * What the customer sees must not move by accident.
 *
 * Cost work is internal: routing, cache, context, providers, compute. It never changes a price, a plan, a credit tier,
 * the cost in credits of an action, the list of models, the three modes or the reasoning levels. This is the photograph
 * of all of that. A cost change that moves any of it fails here, and the person who really wants the change updates the
 * snapshot in the same review, where it is seen.
 */
describe('what is visible in production', () => {
  it('prices, plans, credit tiers, top-ups, annual discount and action costs', () => {
    expect({
      annualDiscount: ANNUAL_DISCOUNT,
      xafPerUsd: BILLING_XAF_PER_USD,
      creditTiers: [...CREDIT_TIERS],
      topupTiers: [...TOPUP_TIERS],
      monthlyEmails: MONTHLY_EMAILS,
      actionCredits: ACTION_CREDIT_PRICES,
      prices: PUBLIC_PRICES.map(price => [price.plan, price.credits, price.interval, price.amount]),
      topups: TOPUP_PRODUCTS_V2.map(topup => [topup.plan, topup.credits, topup.amount]),
      plans: Object.values(BILLING_PLANS).map(plan => ({ key: plan.key, name: plan.name, baseCredits: plan.baseCredits, signupCredits: plan.grants.signupCredits, tiers: [...plan.tiers], publication: plan.publication })),
    }).toMatchSnapshot();
  });

  it('what each plan says it includes, and the comparison table', () => {
    expect({
      free: planFeatures('free'),
      pro: planFeatures('pro', 25),
      proLarge: planFeatures('pro', 100),
      business: planFeatures('business', 100),
      comparison: planComparisonRows(),
    }).toMatchSnapshot();
  });

  it('the model list and the plan each model starts at', () => {
    expect(MODEL_REGISTRY.map(model => ({ id: model.id, label: model.label, tier: model.tier, minPlan: model.minPlan, creditFloor: model.creditFloor }))).toMatchSnapshot();
  });

  it('the three modes, their names and descriptions, and the reasoning levels', () => {
    expect({ modes: [...ROUTING_MODES], labels: ROUTING_MODE_LABELS, hints: ROUTING_MODE_HINTS, reasoningLevels: [...REASONING_LEVELS] }).toMatchSnapshot();
  });

  it('the three modes keep the names the product shows', () => {
    expect(ROUTING_MODES).toEqual(['economy', 'balanced', 'performance']);
    expect(Object.values(ROUTING_MODE_LABELS)).toEqual(['Économique', 'Équilibré', 'Performance']);
  });
});
