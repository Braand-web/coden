export type BillingPlanKey = 'free' | 'pro' | 'business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';
export type UsageRestriction = 'build' | 'cloud' | 'ai_gateway' | 'general' | 'email';

export const BILLING_V2_VERSION = '2026-09-21.canonical-v2';
export const TARGET_GROSS_MARGIN = 0.80;
export const MINIMUM_PAID_GROSS_MARGIN = 0.55;
export const FREE_ACTIVE_USER_COGS_CAP_USD = 1;
export const ANNUAL_DISCOUNT = 0.20;
export const TOPUP_PREMIUM = 0.25;
export const BILLING_SETTLEMENT_CURRENCY = 'XAF' as const;
export const BILLING_XAF_PER_USD = 600;
export const LEGACY_CREDIT_TIERS = [100, 200, 400, 800, 1_200, 2_000, 3_000, 4_000, 5_000, 7_500, 10_000] as const;
export const PRO_CREDIT_TIERS = [25, 60, ...LEGACY_CREDIT_TIERS] as const;
export const BUSINESS_CREDIT_TIERS = [...LEGACY_CREDIT_TIERS] as const;
export const CREDIT_TIERS = PRO_CREDIT_TIERS;
export const TOPUP_TIERS = [50, 100, 150, 200, 250, 300, 400, 500, 1_000, 2_000, 3_000, 5_000, 10_000] as const;

export const TOPUP_EXPIRY_MONTHS = 12;
export const MONTHLY_EMAILS: Readonly<Record<'free' | 'pro' | 'business', number>> = Object.freeze({ free: 0, pro: 1_000, business: 5_000 });

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

const formatCount = (value: number) => new Intl.NumberFormat('fr-FR').format(value);

/** "1 site publié et 1 domaine personnalisé", from the same limits the server enforces. */
export function publicationLabel(plan: BillingPlanKey, credits = 0): string {
  const { publishedSites, customDomains } = publicationLimitsFor(plan, credits);
  if (publishedSites === null && customDomains === null) return 'Sites publiés et domaines personnalisés illimités';
  if (publishedSites === 0) return 'Aucune publication publique ni domaine personnalisé';
  const sites = publishedSites === null ? 'Sites publiés illimités' : `${publishedSites} site${publishedSites > 1 ? 's' : ''} publié${publishedSites > 1 ? 's' : ''}`;
  const domains = customDomains === null ? 'domaines personnalisés illimités' : `${customDomains} domaine${customDomains > 1 ? 's' : ''} personnalisé${customDomains > 1 ? 's' : ''}`;
  return `${sites} et ${domains}`;
}

/**
 * What a plan includes, word for word the same on the landing, the pricing
 * page, the upgrade modal, the onboarding and Settings → Facturation. The
 * credit count is not in the list: every surface shows it in its tier menu.
 */
export function planFeatures(plan: 'free' | 'pro' | 'business', credits = 0): string[] {
  const topups = `Recharges ponctuelles, valables ${TOPUP_EXPIRY_MONTHS} mois`;
  if (plan === 'free') {
    return ['1 projet actif et preview privée', 'Génération et modifications selon le solde', publicationLabel('free'), 'Aucun renouvellement automatique des crédits'];
  }
  if (plan === 'pro') {
    return [publicationLabel('pro', credits), 'Édition et export du code', 'Historique des versions et rollback', `${formatCount(MONTHLY_EMAILS.pro)} e-mails transactionnels par mois`, topups];
  }
  return [publicationLabel('business', credits), 'Rôles et projets internes', 'Modèles premium et support prioritaire', `${formatCount(MONTHLY_EMAILS.business)} e-mails transactionnels par mois`, topups];
}

/** The badge on the plan most people choose, the same everywhere. */
export const FEATURED_PLAN_BADGE = 'Le plus choisi';

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
    capabilities: ['5 crédits offerts une seule fois', ...planFeatures('free')],
  },
  pro: {
    id: 'coden_pro_v2', key: 'pro', name: 'Pro', public: true,
    baseCredits: 100, baseMonthlyUsd: Number((15_000 / BILLING_XAF_PER_USD).toFixed(8)), tiers: PRO_CREDIT_TIERS,
    grants: { signupCredits: 0, monthlyEmailCount: MONTHLY_EMAILS.pro },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('pro', 100),
    capabilities: planFeatures('pro', PRO_CREDIT_TIERS[0]),
  },
  business: {
    id: 'coden_business_v2', key: 'business', name: 'Business', public: true,
    baseCredits: 100, baseMonthlyUsd: Number((30_000 / BILLING_XAF_PER_USD).toFixed(8)), tiers: BUSINESS_CREDIT_TIERS,
    grants: { signupCredits: 0, monthlyEmailCount: MONTHLY_EMAILS.business },
    technicalAllowances: { cloudBudgetUsd: 0, aiAppBudgetUsd: 0 },
    publication: publicationLimitsFor('business', 100),
    capabilities: planFeatures('business', BUSINESS_CREDIT_TIERS[0]),
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
    ? credits * 300
    : credits === 25
      ? 5_000
      : credits === 60
        ? 10_000
        : credits * 150;
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

/**
 * One credit of the plan's own subscription at its reference tier (100
 * credits a month): 150 FCFA on Pro, 300 FCFA on Business.
 */
export function planCreditUnitXaf(plan: 'pro' | 'business'): number {
  return priceFor(plan, 100, 'monthly').amount / 100;
}

/** What a top-up credit costs: the plan's own credit, plus the top-up premium. */
export function topupUnitXaf(plan: 'pro' | 'business'): number {
  return planCreditUnitXaf(plan) * (1 + TOPUP_PREMIUM);
}

/*
 * A top-up is never cheaper than the subscription it tops up.
 *
 * It was derived from the plan's credit until the Business subscription moved
 * to 300 FCFA a credit and the top-up stayed on a typed-in 120: Business
 * top-ups then sold at 150 FCFA, half the subscription's price. Derived again,
 * so the two cannot drift apart.
 */
export function topupPriceFor(plan: 'pro' | 'business', credits: number) {
  if (!TOPUP_TIERS.includes(credits as (typeof TOPUP_TIERS)[number])) throw new Error(`Unsupported top-up tier: ${credits}`);
  const amount = Math.round(credits * topupUnitXaf(plan));
  const amountUsd = Number((amount / BILLING_XAF_PER_USD).toFixed(2));
  return {
    id: `topup_${plan}_${credits}_${BILLING_V2_VERSION}`,
    plan,
    credits,
    amountUsd,
    amount,
    currency: BILLING_SETTLEMENT_CURRENCY,
    expiresMonths: TOPUP_EXPIRY_MONTHS,
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
    topupUnit: { pro: topupUnitXaf('pro'), business: topupUnitXaf('business') },
    featuredPlanBadge: FEATURED_PLAN_BADGE,
    creditTiers: [...CREDIT_TIERS],
    topupTiers: [...TOPUP_TIERS],
    plans: [BILLING_PLANS.free, BILLING_PLANS.pro, BILLING_PLANS.business],
    prices: PUBLIC_PRICES.map(({ amountUsd: _internalAmount, monthlyEquivalentUsd: _internalMonthly, ...price }) => price),
    topups: TOPUP_PRODUCTS_V2.map(({ amountUsd: _internalAmount, ...price }) => price),
    usageExamples: CREDIT_USAGE_EXAMPLES,
  };
}
