import assert from 'node:assert/strict';
import {
  PUBLIC_PRICING_PLAN_KEYS,
  CLOUD_TOPUP_PRODUCTS,
  PLAN_ECONOMICS_GUARDRAILS,
  SAAS_PLANS,
  TOPUP_PRODUCTS,
  getPlanEconomicsGuardrail,
  getCloudUsageCategories,
  getPlanConfig,
  getPublicPlans,
  isPaidPlanKey,
  resolveCheckoutAmount,
} from './src/services/billing-service.ts';
import { MODEL_CREDIT_RATES, UserPlan } from './src/config/ai-models.ts';
import { domainPlanLimits } from './src/services/domain-service.ts';

const publicPlans = getPublicPlans();

assert.deepEqual(Object.keys(publicPlans), ['free', 'pro', 'scale']);
assert.deepEqual([...PUBLIC_PRICING_PLAN_KEYS], ['free', 'pro', 'scale']);

assert.equal(SAAS_PLANS.free.credits, 50);
assert.equal(SAAS_PLANS.free.maxProjects, 1);
assert.equal(SAAS_PLANS.free.customDomains, 0);
assert.equal(SAAS_PLANS.free.cloud.balanceUsd, 1);
assert.equal(SAAS_PLANS.free.cloud.databaseStorageGb, 0.1);
assert.equal(SAAS_PLANS.free.cloud.fileStorageGb, 0.25);

assert.equal(SAAS_PLANS.pro.amount, 25);
assert.equal(SAAS_PLANS.pro.annualAmount, 240);
assert.equal(SAAS_PLANS.pro.annualMonthlyEquivalent, 20);
assert.equal(SAAS_PLANS.pro.credits, 1000);
assert.equal(SAAS_PLANS.pro.maxProjects, 10);
assert.equal(SAAS_PLANS.pro.customDomains, 1);
assert.equal(SAAS_PLANS.pro.cloud.balanceUsd, 10);
assert.equal(SAAS_PLANS.pro.cloud.aiAppBalanceUsd, 1);
assert.equal(SAAS_PLANS.pro.cloud.databaseStorageGb, 1);
assert.equal(SAAS_PLANS.pro.cloud.fileStorageGb, 5);
assert.equal(SAAS_PLANS.pro.cloud.bandwidthGb, 50);
assert.equal(SAAS_PLANS.pro.cloud.topupMinUsd, 10);

assert.equal(SAAS_PLANS.scale.amount, 200);
assert.equal(SAAS_PLANS.scale.annualAmount, 1920);
assert.equal(SAAS_PLANS.scale.annualMonthlyEquivalent, 160);
assert.equal(SAAS_PLANS.scale.credits, 10000);
assert.equal(SAAS_PLANS.scale.maxProjects, 9999);
assert.equal(SAAS_PLANS.scale.customDomains, 10);
assert.equal(SAAS_PLANS.scale.cloud.balanceUsd, 75);
assert.equal(SAAS_PLANS.scale.cloud.aiAppBalanceUsd, 10);
assert.equal(SAAS_PLANS.scale.cloud.databaseStorageGb, 20);
assert.equal(SAAS_PLANS.scale.cloud.fileStorageGb, 100);
assert.equal(SAAS_PLANS.scale.cloud.bandwidthGb, 250);
assert.equal(SAAS_PLANS.scale.cloud.autoTopupAvailable, true);

assert.equal(SAAS_PLANS.enterprise.public, false);
assert.equal((publicPlans as Record<string, unknown>).enterprise, undefined);
assert.equal(getPlanConfig('business'), null);
assert.equal(getPlanConfig('pro_400'), null);
assert.equal(getPlanConfig('plan_business_100'), null);
assert.equal(getPlanConfig('plan_scale')?.key, 'scale');

assert.equal(resolveCheckoutAmount(SAAS_PLANS.pro, 'monthly').amount, 25);
assert.equal(resolveCheckoutAmount(SAAS_PLANS.pro, 'annual').amount, 240);
assert.equal(resolveCheckoutAmount(SAAS_PLANS.scale, 'monthly').amount, 200);
assert.equal(resolveCheckoutAmount(SAAS_PLANS.scale, 'annual').amount, 1920);

assert.equal(isPaidPlanKey('free'), false);
assert.equal(isPaidPlanKey('pro'), true);
assert.equal(isPaidPlanKey('scale'), true);
assert.equal(isPaidPlanKey('enterprise'), true);

assert.equal(TOPUP_PRODUCTS.some(item => String(item.plan) === 'business' || item.id.includes('business')), false);
assert.equal(TOPUP_PRODUCTS.every(item => item.plan === 'pro' || item.plan === 'scale'), true);
// Repriced so no SKU sells a credit below the $0.02 floor (see credit-system.ts).
assert.equal(TOPUP_PRODUCTS.find(item => item.id === 'topup_credits_500')?.price, 10);
assert.equal(TOPUP_PRODUCTS.find(item => item.id === 'topup_credits_1500')?.price, 30);
assert.equal(TOPUP_PRODUCTS.find(item => item.id === 'topup_credits_4000')?.price, 80);
// No top-up may price a credit under the guaranteed $0.02 floor.
assert.ok(TOPUP_PRODUCTS.every(item => item.price / item.credits >= 0.02 - 1e-9));
assert.equal(CLOUD_TOPUP_PRODUCTS.some(item => item.id === 'cloud_topup_50'), false);
assert.equal(CLOUD_TOPUP_PRODUCTS.some(item => item.amountUsd < 10), false);
assert.equal(CLOUD_TOPUP_PRODUCTS.some(item => item.id === 'cloud_topup_10'), true);
assert.ok(getCloudUsageCategories().some(category => category.id === 'database_storage'));
assert.ok(getCloudUsageCategories().some(category => category.id === 'file_storage'));
assert.ok(getCloudUsageCategories().some(category => category.id === 'ai_app_usage'));

assert.equal(PLAN_ECONOMICS_GUARDRAILS.free.maxMonthlyAiCloudExposureUsd, 1);
assert.equal(PLAN_ECONOMICS_GUARDRAILS.pro.grossMarginTarget, '60-75%');
assert.equal(PLAN_ECONOMICS_GUARDRAILS.pro.maxMonthlyAiCloudExposureUsd, 10);
assert.equal(PLAN_ECONOMICS_GUARDRAILS.scale.grossMarginTarget, '55-75%');
assert.equal(PLAN_ECONOMICS_GUARDRAILS.scale.maxMonthlyAiCloudExposureUsd, 85);
assert.equal(PLAN_ECONOMICS_GUARDRAILS.enterprise.grossMarginTarget, '80-90%');
assert.equal(getPlanEconomicsGuardrail('plan_scale')?.plan, 'scale');
assert.equal(getPlanEconomicsGuardrail('business'), null);
assert.ok(PLAN_ECONOMICS_GUARDRAILS.free.internalNote.includes('no unlimited promise'));
assert.ok(PLAN_ECONOMICS_GUARDRAILS.scale.monetizationPath.includes('cloud_topups'));

assert.equal(domainPlanLimits.getCustomDomainLimit('free'), 0);
assert.equal(domainPlanLimits.getCustomDomainLimit('pro'), 1);
assert.equal(domainPlanLimits.getCustomDomainLimit('scale'), 10);
assert.equal(domainPlanLimits.getCustomDomainLimit('enterprise'), 9999);

const premiumRates = MODEL_CREDIT_RATES.filter(rate => rate.tier === 'Premium');
assert.ok(premiumRates.length >= 1);
assert.equal(
  premiumRates.filter(rate => rate.id !== 'anthropic/claude-fable-5.1:batch')
    .every(rate => rate.availability === UserPlan.SCALE),
  true,
);
assert.equal(
  premiumRates.find(rate => rate.id === 'anthropic/claude-fable-5.1:batch')?.availability,
  UserPlan.ENTERPRISE,
);

console.log('pricing plans ok');
