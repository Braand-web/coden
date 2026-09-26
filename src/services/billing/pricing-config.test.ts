import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING_CONFIG, creditsForCost, displayPrice, lowestCreditPriceUsd, maxCostPerCreditUsd, meteredCategory, profitabilityReport, publicPricing, shadowComparison, validatePricingConfig } from './pricing-config';

const clone = () => JSON.parse(JSON.stringify(DEFAULT_PRICING_CONFIG));

describe('pricing configuration', () => {
  it('ships valid defaults matching section 3 bis and the decisions taken', () => {
    const result = validatePricingConfig(clone());
    expect(result.ok).toBe(true);
    const plans = DEFAULT_PRICING_CONFIG.plans;
    expect([plans.pro.monthly_usd, plans.pro.annual_monthly_usd, plans.pro.monthly_credits, plans.pro.topup_price_usd]).toEqual([20, 16, 100, 0.25]);
    expect([plans.pro_plus.monthly_usd, plans.pro_plus.annual_monthly_usd, plans.pro_plus.monthly_credits, plans.pro_plus.topup_price_usd]).toEqual([45, 36, 250, 0.22]);
    expect(plans.business).toMatchObject({ monthly_usd: 40, per_seat: true, topup_price_usd: 0.22 });
    expect(plans.free).toMatchObject({ signup_credits: 5, daily_credits: 0, topup_price_usd: null });
    expect(DEFAULT_PRICING_CONFIG.topup.tiers).toEqual([50, 100, 250, 500, 1000]);
    expect(DEFAULT_PRICING_CONFIG.monthly_grants).toEqual({ cloud: 20, app_ai: 5, rollover: false });
    expect(DEFAULT_PRICING_CONFIG.daily_credits_scope).toBe('agent');
  });

  it('anchors a credit on the lowest sale price, so the 40 % rule holds for every offer', () => {
    expect(lowestCreditPriceUsd(DEFAULT_PRICING_CONFIG)).toBeCloseTo(0.144, 6);
    expect(maxCostPerCreditUsd(DEFAULT_PRICING_CONFIG)).toBeCloseTo(0.0576, 6);
    const report = profitabilityReport(DEFAULT_PRICING_CONFIG);
    expect(report.rows.every(row => row.ok)).toBe(true);
    const proAnnual = report.rows.find(row => row.plan === 'pro' && row.kind === 'annual')!;
    expect(proAnnual.cost_ratio).toBeCloseTo(0.36, 3);
    expect(proAnnual.cost_ratio_with_daily).toBeGreaterThan(0.8);
  });

  it('turns a real provider cost into credits, rounded up, never below the minimum', () => {
    expect(creditsForCost(0, 'build', DEFAULT_PRICING_CONFIG)).toBe(0);
    expect(creditsForCost(0.0001, 'chat', DEFAULT_PRICING_CONFIG)).toBe(0.05);
    expect(creditsForCost(0.02, 'build', DEFAULT_PRICING_CONFIG)).toBe(0.37);
    expect(creditsForCost(0.1, 'build', DEFAULT_PRICING_CONFIG)).toBe(1.84);
  });

  it('refuses a draft that would break a plan or the profitability anchor', () => {
    const tooHigh = clone(); tooHigh.credit.reference_price_usd = 0.2;
    expect(validatePricingConfig(tooHigh)).toMatchObject({ ok: false });
    const noCredits = clone(); noCredits.plans.pro.monthly_credits = 0;
    expect(validatePricingConfig(noCredits)).toMatchObject({ ok: false });
    const badRatio = clone(); badRatio.credit.max_cost_ratio = 1.5;
    expect(validatePricingConfig(badRatio)).toMatchObject({ ok: false });
    const extra = clone(); extra.plans.pro.monthly_usd = -1;
    expect(validatePricingConfig(extra).ok).toBe(false);
  });

  it('displays dollars with FCFA for the superscript, and exposes no cost data publicly', () => {
    expect(displayPrice(20, DEFAULT_PRICING_CONFIG)).toMatchObject({ usd_label: '20 $', secondary: 12_000 });
    expect(displayPrice(0.25, DEFAULT_PRICING_CONFIG).secondary).toBe(150);
    expect(displayPrice(0.22, DEFAULT_PRICING_CONFIG).secondary).toBe(130);
    expect(displayPrice(16, DEFAULT_PRICING_CONFIG).secondary).toBe(9_600);
    const pub = publicPricing(DEFAULT_PRICING_CONFIG, 1);
    const json = JSON.stringify(pub);
    expect(json).not.toContain('max_cost_ratio');
    expect(json).not.toContain('reference_price_usd');
    expect(pub.plans.find(plan => plan.key === 'pro')!.topup!.tiers[0]).toMatchObject({ credits: 50, price: { usd: 12.5, secondary: 7_500 } });
  });

  it('maps v2 categories to the metered v3 ones, Chat under both names', () => {
    expect(meteredCategory('ai_gateway')).toBe('chat');
    expect(meteredCategory('chat')).toBe('chat');
    expect(meteredCategory('build')).toBe('build');
    expect(meteredCategory('cloud')).toBeNull();
    expect(meteredCategory('email')).toBeNull();
    expect(meteredCategory(null)).toBeNull();
  });

  it('compares the current and v3 grids per category, flagging cost per credit', () => {
    const report = shadowComparison([
      { category: 'build', provider_cost_usd: 0.1, cost_credits: 1, v3_credits: 1.84 },
      { category: 'build', provider_cost_usd: '0.02', cost_credits: '1', v3_credits: '0.37' },
      { category: 'ai_gateway', provider_cost_usd: 0.0001, cost_credits: 0, v3_credits: 0.05 },
      { category: 'cloud', provider_cost_usd: 5, cost_credits: 10, v3_credits: null },
    ], DEFAULT_PRICING_CONFIG);
    expect(report.max_cost_per_credit_usd).toBeCloseTo(0.0576, 6);
    expect(report.rows.map(row => row.category)).toEqual(['build', 'chat']);
    const build = report.rows[0];
    expect(build).toMatchObject({ events: 2, provider_cost_usd: 0.12, v2_credits: 2, v3_credits: 2.21 });
    expect(build.v2_cost_per_credit_usd).toBeCloseTo(0.06, 6);
    expect(build.v3_cost_per_credit_usd!).toBeLessThan(report.max_cost_per_credit_usd);
    expect(report.rows[1].v2_cost_per_credit_usd).toBeNull();
  });
});

describe('pricing seed', () => {
  it('seeds exactly the default grid, and it validates', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../../../supabase/migrations/20260926120000_billing_pricing_config.sql', import.meta.url), 'utf8');
    const seed = /select 1, 'active', '(\{.*\})'::jsonb/.exec(sql);
    expect(seed).toBeTruthy();
    const parsed = JSON.parse(seed![1]);
    expect(parsed).toEqual(DEFAULT_PRICING_CONFIG);
    expect(validatePricingConfig(parsed).ok).toBe(true);
  });
});
