export type BillingPlanKey = 'free' | 'pro' | 'business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';
export type UsageRestriction = 'build' | 'cloud' | 'ai_gateway' | 'general' | 'email';

export const BILLING_V2_VERSION = '2026-09-19.canonical-v1';
export const TARGET_GROSS_MARGIN = 0.80;
export const MINIMUM_PAID_GROSS_MARGIN = 0.55;
export const FREE_ACTIVE_USER_COGS_CAP_USD = 1;
export const ANNUAL_DISCOUNT = 0.20;
export const TOPUP_PREMIUM = 0.25;
export const BILLING_SETTLEMENT_CURRENCY = 'XAF' as const;
export const BILLING_XAF_PER_USD = 600;
export const PRO_CREDIT_TIERS = [25, 60, 100] as const;
export const BUSINESS_CREDIT_TIERS = [250] as const;
export const CREDIT_TIERS = [...PRO_CREDIT_TIERS, ...BUSINESS_CREDIT_TIERS] as const;
export const TOPUP_TIERS = [50, 100, 150, 200, 250, 300, 400, 500, 1_000, 2_000, 3_000, 5_000, 10_000] as const;

export type BillableAction = 'targeted_style' | 'component' | 'plan' | 'feature' | 'full_page';
export const ACTION_CREDIT_PRICES: Readonly<Record<BillableAction, number>> = Object.freeze({
  targeted_style: 0.5,
  component: 0.9,
  plan: 1,
  feature: 1.2,
  full_page: 1.7,
});

export type PublicationLimits = {
  publishedSites: number | null;
  customDomains: number | null;
};

export function publicationLimitsFor(plan: BillingPlanKey, credits = 0): PublicationLimits {
  if (plan === 'business' || plan === 'enterprise') return { publishedSites: null, customDomains: null };
  if (plan !== 'pro') return { publishedSites: 0, customDomains: 0 };
  if (credits >= 100) return { publishedSites: null, customDomains: 10 };
  if (credits >= 60) return { publishedSites: 3, customDomains: 3 };
  return { publishedSites: 1, customDomains: 1 };
}

export type BillingPlan = {
  id: string;
  key: BillingPlanKey;
  name: string;
  public: boolean;
  baseCredits: number;
  baseMonthlyUsd: number | null;
  tiers: readonly number[];
  grants: {
    signupCredits: number;
    monthlyEmailCount: number;
  };
  technicalAllowances: {
    cloudBudgetUsd: number;
    aiAppBudgetUsd: number;
  };
  publication: PublicationLimits;
  capabilities: readonly string[];
};

export const BILLING_PLANS: Readonly<Record<BillingPlanKey, BillingPlan>> = {
  free: {
    id: 'coden_free_v2', key: 'free', name: 'Free', public: true,
    baseCredits: 5, baseMonthlyUsd: 0, tiers: [],
    grants: { signupCredits: 5, monthlyEmailCount: 0 },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('free'),
    capabilities: ['5 crédits offerts une seule fois', '1 projet actif', 'Preview privée', 'Aucun renouvellement automatique'],
  },
  pro: {
    id: 'coden_pro_v2', key: 'pro', name: 'Pro', public: true,
    baseCredits: 25, baseMonthlyUsd: Number((5_000 / BILLING_XAF_PER_USD).toFixed(8)), tiers: PRO_CREDIT_TIERS,
    grants: { signupCredits: 0, monthlyEmailCount: 1_000 },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('pro', 25),
    capabilities: ['Édition et export du code', 'Versions et rollback', 'Publication publique', 'Domaines personnalisés', 'Recharges de crédits'],
  },
  business: {
    id: 'coden_business_v2', key: 'business', name: 'Business', public: true,
    baseCredits: 250, baseMonthlyUsd: Number((30_000 / BILLING_XAF_PER_USD).toFixed(8)), tiers: BUSINESS_CREDIT_TIERS,
    grants: { signupCredits: 0, monthlyEmailCount: 5_000 },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('business', 250),
    capabilities: ['250 crédits par mois', 'Sites et domaines illimités', 'Rôles et projets internes', 'Modèles premium', 'Support prioritaire'],
  },
  enterprise: {
    id: 'coden_enterprise_v2', key: 'enterprise', name: 'Enterprise', public: false,
    baseCredits: 0, baseMonthlyUsd: null, tiers: [],
    grants: { signupCredits: 0, monthlyEmailCount: 0 },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('enterprise'),
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
  amount: number;
  monthlyEquivalent: number;
  currency: typeof BILLING_SETTLEMENT_CURRENCY;
};

export function priceFor(plan: 'pro' | 'business', credits: number, interval: BillingInterval): PublicPrice {
  if (!BILLING_PLANS[plan].tiers.includes(credits)) throw new Error(`Unsupported ${plan} credit tier: ${credits}`);
  const monthlyXaf = plan === 'business'
    ? 30_000
    : credits === 25
      ? 5_000
      : credits === 60
        ? 10_000
        : 15_000;
  const amount = interval === 'annual' ? Math.round(monthlyXaf * 12 * (1 - ANNUAL_DISCOUNT)) : monthlyXaf;
  const monthlyEquivalent = interval === 'annual' ? Math.round(amount / 12) : amount;
  const amountUsd = amount / BILLING_XAF_PER_USD;
  return {
    id: `${plan}_${credits}_${interval}_${BILLING_V2_VERSION}`,
    plan,
    credits,
    interval,
    amountUsd: Number(amountUsd.toFixed(2)),
    monthlyEquivalentUsd: Number((monthlyEquivalent / BILLING_XAF_PER_USD).toFixed(2)),
    amount,
    monthlyEquivalent,
    currency: BILLING_SETTLEMENT_CURRENCY,
  };
}

export function topupPriceFor(plan: 'pro' | 'business', credits: number) {
  if (!TOPUP_TIERS.includes(credits as (typeof TOPUP_TIERS)[number])) throw new Error(`Unsupported top-up tier: ${credits}`);
  const unitXaf = plan === 'business' ? 120 : 150;
  const amount = Math.round(credits * unitXaf * (1 + TOPUP_PREMIUM));
  const amountUsd = Number((amount / BILLING_XAF_PER_USD).toFixed(2));
  return {
    id: `topup_${plan}_${credits}_${BILLING_V2_VERSION}`,
    plan,
    credits,
    amountUsd,
    amount,
    currency: BILLING_SETTLEMENT_CURRENCY,
    expiresMonths: 12,
  } as const;
}

export const PUBLIC_PRICES = (['pro', 'business'] as const).flatMap(plan =>
  BILLING_PLANS[plan].tiers.flatMap(credits => (['monthly', 'annual'] as const).map(interval => priceFor(plan, credits, interval))),
);

export const TOPUP_PRODUCTS_V2 = (['pro', 'business'] as const).flatMap(plan => TOPUP_TIERS.map(credits => topupPriceFor(plan, credits)));

export const CREDIT_USAGE_EXAMPLES = [
  { id: 'plan', label: 'Préparer un plan', credits: 1 },
  { id: 'small_edit', label: 'Modifier un style ciblé', credits: 0.5 },
  { id: 'component_edit', label: 'Modifier un composant', credits: 0.9 },
  { id: 'feature', label: 'Ajouter une fonctionnalité', credits: 1.2 },
  { id: 'full_page', label: 'Créer une page complète', credits: 1.7 },
] as const;

export function normalizeBillingPlan(value: unknown): BillingPlanKey | null {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'scale') return 'business'; // Read-only compatibility for historical subscriptions.
  if (key === 'free' || key === 'pro' || key === 'business' || key === 'enterprise') return key;
  return null;
}

export function publicBillingCatalog() {
  return {
    version: BILLING_V2_VERSION,
    currency: BILLING_SETTLEMENT_CURRENCY.toLowerCase(),
    provider: 'saspay',
    annualDiscountPercent: ANNUAL_DISCOUNT * 100,
    topupPremiumPercent: TOPUP_PREMIUM * 100,
    creditTiers: [...CREDIT_TIERS],
    topupTiers: [...TOPUP_TIERS],
    plans: [BILLING_PLANS.free, BILLING_PLANS.pro, BILLING_PLANS.business],
    prices: PUBLIC_PRICES.map(({ amountUsd: _internalAmount, monthlyEquivalentUsd: _internalMonthly, ...price }) => price),
    topups: TOPUP_PRODUCTS_V2.map(({ amountUsd: _internalAmount, ...price }) => price),
    usageExamples: CREDIT_USAGE_EXAMPLES,
  };
}
