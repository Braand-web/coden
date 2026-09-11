import { describe, expect, it } from 'vitest';
import { BILLING_PLANS, CREDIT_TIERS, PUBLIC_PRICES, TOPUP_PRODUCTS_V2, normalizeBillingPlan, priceFor, topupPriceFor } from '../config/billing-v2';
import { calculateCreditCharge, completeCostUsd, openRouterTokenCost } from './unified-billing';
import { CLOUD_TOPUP_PRODUCTS, estimateSaspayNetRevenue, getPublicPlans, normalizePlanKey, verifySaspayWebhookSignature } from './billing-service';
import { createHmac } from 'node:crypto';

describe('Coden V4 unified billing', () => {
  it('publishes Free, Pro and Business with Lovable-style credit tiers', () => {
    expect(Object.keys(getPublicPlans())).toEqual(['free', 'pro', 'business']);
    expect(BILLING_PLANS.free.grants).toMatchObject({ dailyBuildCredits: 5, dailyBuildMonthlyCap: 30, monthlyCloudCredits: 20, monthlyAiCredits: 4 });
    expect(CREDIT_TIERS).toContain(10_000);
    expect(PUBLIC_PRICES).toHaveLength(CREDIT_TIERS.length * 2 * 2);
    expect(TOPUP_PRODUCTS_V2.length).toBeGreaterThan(CREDIT_TIERS.length);
    expect(CLOUD_TOPUP_PRODUCTS).toEqual([]);
  });

  it('maps legacy Scale reads to Business without publishing Scale', () => {
    expect(normalizeBillingPlan('scale')).toBe('business');
    expect(normalizePlanKey('plan_scale')).toBeNull();
    expect(normalizePlanKey('business')).toBe('business');
  });

  it('applies the annual discount and top-up premium', () => {
    expect(priceFor('pro', 100, 'monthly').amountUsd).toBe(25);
    expect(priceFor('pro', 100, 'annual').amountUsd).toBe(240);
    expect(topupPriceFor('pro', 100).amountUsd).toBe(31.25);
  });

  it('charges measured complete cost at no less than the target margin', () => {
    const result = calculateCreditCharge(
      { providerCostUsd: 1, allocatedInfrastructureUsd: 0.1, allocatedPaymentFeesUsd: 0.05, refundFraudReserveUsd: 0.05 },
      { issuedCredits: 100, netRevenueUsd: 25 },
    );
    expect(result.fullCostUsd).toBe(1.2);
    expect(result.realizedMargin).toBeGreaterThanOrEqual(0.8);
    expect(result.creditsCharged).toBeGreaterThan(0);
  });

  it('meters OpenRouter tokens and provider fees from actual quantities', () => {
    expect(openRouterTokenCost({ inputTokens: 1_000_000, outputTokens: 100_000, inputUsdPerMillion: 10, outputUsdPerMillion: 50, providerFeeRate: 0.05 })).toEqual({ subtotalUsd: 15, providerFeeUsd: 0.75, totalUsd: 15.75 });
    expect(() => completeCostUsd({ providerCostUsd: -1 })).toThrow();
  });

  it('converts the Saspay net settlement to the internal COGS currency', () => {
    expect(estimateSaspayNetRevenue(15_000)).toBe(25);
    expect(estimateSaspayNetRevenue(18_750)).toBe(31.25);
  });

  it('accepts only fresh Saspay webhook signatures', () => {
    const body = JSON.stringify({ event: 'transaction.success', data: { id: 'tx_1' } });
    const secret = 'whsec_test_value';
    const now = Date.UTC(2026, 8, 10, 12, 0, 0);
    const timestamp = String(Math.floor(now / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    expect(verifySaspayWebhookSignature(body, signature, timestamp, secret, now)).toBe(true);
    expect(verifySaspayWebhookSignature(body, signature, String(Number(timestamp) - 301), secret, now)).toBe(false);
  });
});
