export type BillingPlanKey = 'free' | 'pro' | 'business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';
export type UsageRestriction = 'build' | 'cloud' | 'ai_gateway' | 'general' | 'email';

export const BILLING_V2_VERSION = '2026-09-06.v1';
export const TARGET_GROSS_MARGIN = 0.80;
export const MINIMUM_PAID_GROSS_MARGIN = 0.55;
export const FREE_ACTIVE_USER_COGS_CAP_USD = 1;
export const ANNUAL_DISCOUNT = 0.20;
export const TOPUP_PREMIUM = 0.25;
export const CREDIT_TIERS = [100, 200, 400, 800, 1_200, 2_000, 3_000, 4_000, 5_000, 7_500, 10_000] as const;
export const TOPUP_TIERS = [50, 100, 150, 200, 250, 300, 400, 500, 1_000, 2_000, 3_000, 5_000, 10_000] as const;

export type BillingPlan = {
  id: string;
  key: BillingPlanKey;
  name: string;
  public: boolean;
  baseCredits: number;
  baseMonthlyUsd: number | null;
  tiers: readonly number[];
  grants: {
    dailyBuildCredits: number;
    dailyBuildMonthlyCap: number | null;
    monthlyCloudCredits: number;
    monthlyAiCredits: number;
    monthlyEmailCount: number;
  };
  capabilities: readonly string[];
};

export const BILLING_PLANS: Readonly<Record<BillingPlanKey, BillingPlan>> = {
  free: {
    id: 'coden_free_v2', key: 'free', name: 'Free', public: true,
    baseCredits: 0, baseMonthlyUsd: 0, tiers: [],
    grants: { dailyBuildCredits: 5, dailyBuildMonthlyCap: 30, monthlyCloudCredits: 20, monthlyAiCredits: 4, monthlyEmailCount: 0 },
    capabilities: ['Shared infrastructure', 'Economy models', 'Coden subdomain', 'Git sync'],
  },
  pro: {
    id: 'coden_pro_v2', key: 'pro', name: 'Pro', public: true,
    baseCredits: 100, baseMonthlyUsd: 25, tiers: CREDIT_TIERS,
    grants: { dailyBuildCredits: 5, dailyBuildMonthlyCap: null, monthlyCloudCredits: 20, monthlyAiCredits: 4, monthlyEmailCount: 1_000 },
    capabilities: ['Code editing', 'Custom domains', 'Top-ups', 'Auto top-up', 'Design systems'],
  },
  business: {
    id: 'coden_business_v2', key: 'business', name: 'Business', public: true,
    baseCredits: 100, baseMonthlyUsd: 50, tiers: CREDIT_TIERS,
    grants: { dailyBuildCredits: 5, dailyBuildMonthlyCap: null, monthlyCloudCredits: 20, monthlyAiCredits: 4, monthlyEmailCount: 1_000 },
    capabilities: ['Premium models', 'Manual Astra', 'Roles', 'Member limits', 'Internal projects', 'Dedicated backend add-on'],
  },
  enterprise: {
    id: 'coden_enterprise_v2', key: 'enterprise', name: 'Enterprise', public: false,
    baseCredits: 0, baseMonthlyUsd: null, tiers: [],
    grants: { dailyBuildCredits: 0, dailyBuildMonthlyCap: null, monthlyCloudCredits: 0, monthlyAiCredits: 0, monthlyEmailCount: 0 },
    capabilities: ['Contracted volume', 'SSO', 'SCIM', 'Audit log', 'Policies', 'Dedicated infrastructure'],
  },
};

export type PublicPrice = {
  id: string;
  plan: 'pro' | 'business';
  credits: number;
  interval: BillingInterval;
  amountUsd: number;
  monthlyEquivalentUsd: number;
  stripePriceEnv: string;
};

export function priceFor(plan: 'pro' | 'business', credits: number, interval: BillingInterval): PublicPrice {
  if (!CREDIT_TIERS.includes(credits as (typeof CREDIT_TIERS)[number])) throw new Error(`Unsupported credit tier: ${credits}`);
  const base = BILLING_PLANS[plan].baseMonthlyUsd!;
  const monthly = (base * credits) / 100;
  const amountUsd = interval === 'annual' ? monthly * 12 * (1 - ANNUAL_DISCOUNT) : monthly;
  return {
    id: `${plan}_${credits}_${interval}_${BILLING_V2_VERSION}`,
    plan,
    credits,
    interval,
    amountUsd: Number(amountUsd.toFixed(2)),
    monthlyEquivalentUsd: Number((interval === 'annual' ? amountUsd / 12 : amountUsd).toFixed(2)),
    stripePriceEnv: `STRIPE_PRICE_${plan.toUpperCase()}_${credits}_${interval.toUpperCase()}`,
  };
}

export function topupPriceFor(plan: 'pro' | 'business', credits: number) {
  if (!TOPUP_TIERS.includes(credits as (typeof TOPUP_TIERS)[number])) throw new Error(`Unsupported top-up tier: ${credits}`);
  const monthlyUnit = BILLING_PLANS[plan].baseMonthlyUsd! / 100;
  const amountUsd = Number((credits * monthlyUnit * (1 + TOPUP_PREMIUM)).toFixed(2));
  return {
    id: `topup_${plan}_${credits}_${BILLING_V2_VERSION}`,
    plan,
    credits,
    amountUsd,
    expiresMonths: 12,
    stripePriceEnv: `STRIPE_PRICE_TOPUP_${plan.toUpperCase()}_${credits}`,
  } as const;
}

export const PUBLIC_PRICES = (['pro', 'business'] as const).flatMap(plan =>
  CREDIT_TIERS.flatMap(credits => (['monthly', 'annual'] as const).map(interval => priceFor(plan, credits, interval))),
);

export const TOPUP_PRODUCTS_V2 = (['pro', 'business'] as const).flatMap(plan => TOPUP_TIERS.map(credits => topupPriceFor(plan, credits)));

export function normalizeBillingPlan(value: unknown): BillingPlanKey | null {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'scale') return 'business'; // Read-only compatibility for historical subscriptions.
  if (key === 'free' || key === 'pro' || key === 'business' || key === 'enterprise') return key;
  return null;
}

export function publicBillingCatalog() {
  return {
    version: BILLING_V2_VERSION,
    currency: 'usd',
    annualDiscountPercent: ANNUAL_DISCOUNT * 100,
    topupPremiumPercent: TOPUP_PREMIUM * 100,
    creditTiers: [...CREDIT_TIERS],
    topupTiers: [...TOPUP_TIERS],
    plans: [BILLING_PLANS.free, BILLING_PLANS.pro, BILLING_PLANS.business],
    prices: PUBLIC_PRICES.map(({ stripePriceEnv: _private, ...price }) => price),
    topups: TOPUP_PRODUCTS_V2.map(({ stripePriceEnv: _private, ...price }) => price),
  };
}
