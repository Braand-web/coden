/**
 * Coden's pricing, as data.
 *
 * Every tariff — plans, grants, top-ups, the value of a credit, Cloud unit
 * costs, thresholds — lives in `billing_pricing_versions`, one validated
 * document per version, edited from the admin console and activated without
 * a redeploy. This module is the single definition of that document: its
 * schema, its initial values (section 3 bis of docs/facturation-coden-v3.md),
 * and the rules derived from it (credits for a real cost, price display in
 * dollars with FCFA in superscript, profitability).
 *
 * Pure: no I/O. The server loads the active version and passes it in.
 */
import { z } from 'zod';

const money = z.number().finite().min(0).max(1_000_000);
const credits = z.number().finite().min(0).max(10_000_000);

const planSchema = z.object({
  label: z.string().min(1).max(40),
  monthly_usd: money.nullable(),
  annual_monthly_usd: money.nullable(),
  monthly_credits: credits,
  /** Credits granted once, at sign-up (the free plan's only grant). */
  signup_credits: credits.default(0),
  daily_credits: credits.default(0),
  /** Monthly ceiling on daily credits; null = none. */
  daily_credits_monthly_cap: credits.nullable().default(null),
  topup_price_usd: money.nullable(),
  rollover_months: z.number().int().min(0).max(12).default(0),
  per_seat: z.boolean().default(false),
  team_features: z.boolean().default(false),
  custom: z.boolean().default(false),
  public: z.boolean().default(true),
});

export const pricingConfigSchema = z.object({
  schema_version: z.literal(1),
  currency: z.object({
    base: z.literal('USD'),
    secondary: z.enum(['XAF', 'XOF']),
    secondary_label: z.string().min(1).max(12),
    secondary_per_usd: z.number().finite().positive().max(100_000),
    display_round_secondary: z.number().int().positive().max(10_000),
  }),
  credit: z.object({
    /** The lowest price a credit is sold at (it anchors what a credit may cost Coden). */
    reference_price_usd: z.number().finite().positive().max(100),
    /** Real cost of a credit (OpenRouter + infrastructure) as a share of its price, at most. */
    max_cost_ratio: z.number().finite().gt(0).lte(1),
    provider_fee_rate: z.number().finite().min(0).max(0.5),
    rounding: z.number().finite().positive().max(1),
    minimum: z.object({ build: credits, chat: credits, app_ai: credits, connectors: credits }),
  }),
  plans: z.object({ free: planSchema, pro: planSchema, pro_plus: planSchema, business: planSchema, enterprise: planSchema }),
  topup: z.object({ tiers: z.array(z.number().int().positive().max(1_000_000)).min(1).max(20), validity_months: z.number().int().min(1).max(36) }),
  monthly_grants: z.object({ cloud: credits, app_ai: credits, rollover: z.boolean() }),
  /** Daily credits cover agent messages: build and chat. */
  daily_credits_scope: z.enum(['build', 'agent']),
  indicative: z.record(z.string().max(40), z.tuple([credits, credits])),
  cloud: z.object({
    db_instance_month: z.object({ small: credits, medium: credits, large: credits }),
    small_instance_mode: z.enum(['shared_schema', 'dedicated']),
    db_storage_gb_month: credits,
    file_storage_gb_month: credits,
    egress_gb: credits,
    functions_per_100k: credits,
    realtime_per_million: credits,
    warn_at_ratio: z.array(z.number().min(0).max(1)).max(5),
    grace_hours: z.number().int().min(0).max(24 * 30),
  }),
  transparency: z.object({ default_confirm_above: credits, default_pause_above: credits }),
  alerts: z.object({ low_balance_credits: credits, expiring_within_days: z.number().int().min(1).max(90), spike_factor: z.number().min(1).max(100) }),
});

export type PricingConfig = z.infer<typeof pricingConfigSchema>;
export type PlanKey = keyof PricingConfig['plans'];
export type UsageCategory = 'build' | 'chat' | 'cloud' | 'app_ai' | 'connectors';

/**
 * Initial values — section 3 bis, with the decisions taken on 2026-09-26:
 * the free plan grants 5 credits once at sign-up; Business is priced per
 * seat and its top-up is aligned with Pro+; daily credits cover build and
 * chat; FCFA at 600 per dollar, Saspay's XAF.
 */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  schema_version: 1,
  currency: { base: 'USD', secondary: 'XAF', secondary_label: 'FCFA', secondary_per_usd: 600, display_round_secondary: 100 },
  credit: {
    reference_price_usd: 0.144,
    max_cost_ratio: 0.4,
    provider_fee_rate: 0.055,
    rounding: 0.01,
    minimum: { build: 0.1, chat: 0.05, app_ai: 0.01, connectors: 0.01 },
  },
  plans: {
    free: { label: 'Gratuit', monthly_usd: 0, annual_monthly_usd: null, monthly_credits: 0, signup_credits: 5, daily_credits: 0, daily_credits_monthly_cap: null, topup_price_usd: null, rollover_months: 0, per_seat: false, team_features: false, custom: false, public: true },
    pro: { label: 'Pro', monthly_usd: 20, annual_monthly_usd: 16, monthly_credits: 100, signup_credits: 0, daily_credits: 5, daily_credits_monthly_cap: null, topup_price_usd: 0.25, rollover_months: 1, per_seat: false, team_features: false, custom: false, public: true },
    pro_plus: { label: 'Pro+', monthly_usd: 45, annual_monthly_usd: 36, monthly_credits: 250, signup_credits: 0, daily_credits: 5, daily_credits_monthly_cap: null, topup_price_usd: 0.22, rollover_months: 1, per_seat: false, team_features: false, custom: false, public: true },
    business: { label: 'Business', monthly_usd: 40, annual_monthly_usd: 32, monthly_credits: 100, signup_credits: 0, daily_credits: 5, daily_credits_monthly_cap: null, topup_price_usd: 0.22, rollover_months: 1, per_seat: true, team_features: true, custom: false, public: true },
    enterprise: { label: 'Enterprise', monthly_usd: null, annual_monthly_usd: null, monthly_credits: 0, signup_credits: 0, daily_credits: 0, daily_credits_monthly_cap: null, topup_price_usd: null, rollover_months: 0, per_seat: true, team_features: true, custom: true, public: true },
  },
  topup: { tiers: [50, 100, 250, 500, 1000], validity_months: 12 },
  monthly_grants: { cloud: 20, app_ai: 5, rollover: false },
  daily_credits_scope: 'agent',
  indicative: { small_edit: [0.3, 0.5], medium_feature: [1, 2], full_page: [2, 3], chat: [0.05, 0.2] },
  cloud: {
    db_instance_month: { small: 10, medium: 30, large: 80 },
    small_instance_mode: 'shared_schema',
    db_storage_gb_month: 1,
    file_storage_gb_month: 0.5,
    egress_gb: 0.5,
    functions_per_100k: 1,
    realtime_per_million: 1,
    warn_at_ratio: [0.1, 0],
    grace_hours: 72,
  },
  transparency: { default_confirm_above: 5, default_pause_above: 20 },
  alerts: { low_balance_credits: 10, expiring_within_days: 7, spike_factor: 3 },
};

export type PricingValidation = { ok: true; config: PricingConfig } | { ok: false; errors: string[] };

/** Parses an admin draft. Refuses anything that would make a plan or a conversion meaningless. */
export function validatePricingConfig(input: unknown): PricingValidation {
  const parsed = pricingConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 20).map(issue => `${issue.path.join('.') || 'config'} : ${issue.message}`) };
  const config = parsed.data;
  const errors: string[] = [];
  for (const [key, plan] of Object.entries(config.plans)) {
    if (plan.custom) continue;
    if (plan.monthly_usd === null) errors.push(`plans.${key}.monthly_usd : prix mensuel requis pour un plan non personnalisé`);
    if ((plan.monthly_usd || 0) > 0 && plan.monthly_credits <= 0) errors.push(`plans.${key}.monthly_credits : un plan payant doit inclure des crédits`);
    if (plan.annual_monthly_usd !== null && plan.monthly_usd !== null && plan.annual_monthly_usd > plan.monthly_usd) errors.push(`plans.${key}.annual_monthly_usd : le prix annuel mensualisé dépasse le prix mensuel`);
  }
  const sortedTiers = [...config.topup.tiers].sort((a, b) => a - b);
  if (new Set(sortedTiers).size !== sortedTiers.length) errors.push('topup.tiers : paliers en double');
  if (config.credit.reference_price_usd > lowestCreditPriceUsd(config) + 1e-9) errors.push(`credit.reference_price_usd : ${config.credit.reference_price_usd} $ dépasse le prix de vente le plus bas d’un crédit (${lowestCreditPriceUsd(config).toFixed(4)} $) : la règle des ${Math.round(config.credit.max_cost_ratio * 100)} % ne serait pas tenue pour cette offre`);
  return errors.length ? { ok: false, errors } : { ok: true, config: { ...config, topup: { ...config.topup, tiers: sortedTiers } } };
}

/** The most real cost (USD) one credit may carry. */
export function maxCostPerCreditUsd(config: PricingConfig): number {
  return config.credit.reference_price_usd * config.credit.max_cost_ratio;
}

function roundUp(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

/**
 * Credits for a measured provider cost: cost × (1 + provider fee), divided
 * by what a credit may cost at most, rounded up to the configured step, never
 * below the category's minimum. Zero cost charges nothing.
 */
export function creditsForCost(costUsd: number, category: UsageCategory, config: PricingConfig): number {
  const cost = Math.max(0, Number(costUsd) || 0);
  if (!cost) return 0;
  const complete = cost * (1 + config.credit.provider_fee_rate);
  const raw = complete / maxCostPerCreditUsd(config);
  const minimum = category === 'build' || category === 'chat' || category === 'app_ai' || category === 'connectors' ? config.credit.minimum[category] : 0;
  return Math.round(Math.max(minimum, roundUp(raw, config.credit.rounding)) * 10_000) / 10_000;
}

export type Offer = { plan: PlanKey; kind: 'monthly' | 'annual' | 'topup'; price_usd: number; credits: number; price_per_credit_usd: number };

/** Every way a credit is sold, with its unit price. */
export function creditOffers(config: PricingConfig): Offer[] {
  const offers: Offer[] = [];
  for (const [key, plan] of Object.entries(config.plans) as Array<[PlanKey, PricingConfig['plans'][PlanKey]]>) {
    if (plan.custom || !plan.monthly_credits) continue;
    if (plan.monthly_usd) offers.push({ plan: key, kind: 'monthly', price_usd: plan.monthly_usd, credits: plan.monthly_credits, price_per_credit_usd: plan.monthly_usd / plan.monthly_credits });
    if (plan.annual_monthly_usd) offers.push({ plan: key, kind: 'annual', price_usd: plan.annual_monthly_usd, credits: plan.monthly_credits, price_per_credit_usd: plan.annual_monthly_usd / plan.monthly_credits });
    if (plan.topup_price_usd) offers.push({ plan: key, kind: 'topup', price_usd: plan.topup_price_usd, credits: 1, price_per_credit_usd: plan.topup_price_usd });
  }
  return offers;
}

export function lowestCreditPriceUsd(config: PricingConfig): number {
  const prices = creditOffers(config).map(offer => offer.price_per_credit_usd);
  return prices.length ? Math.min(...prices) : config.credit.reference_price_usd;
}

export type ProfitabilityRow = Offer & {
  /** Real cost ratio when every paid credit is consumed at the conversion ceiling. */
  cost_ratio: number;
  /** Same, when the daily credits of the month are also consumed. */
  cost_ratio_with_daily: number | null;
  ok: boolean;
};

/**
 * The profitability rule, offer by offer: a credit converted at the ceiling
 * costs `maxCostPerCredit`; each offer's ratio is that over its price. The
 * second ratio adds the month's daily credits, which are given, not sold.
 */
export function profitabilityReport(config: PricingConfig): { max_cost_per_credit_usd: number; limit: number; rows: ProfitabilityRow[] } {
  const ceiling = maxCostPerCreditUsd(config);
  const rows = creditOffers(config).map(offer => {
    const plan = config.plans[offer.plan];
    const ratio = ceiling / offer.price_per_credit_usd;
    let withDaily: number | null = null;
    if (offer.kind !== 'topup' && plan.daily_credits > 0) {
      const dailyMonth = plan.daily_credits_monthly_cap ?? plan.daily_credits * 30;
      withDaily = (ceiling * (offer.credits + dailyMonth)) / offer.price_usd;
    }
    return { ...offer, cost_ratio: Math.round(ratio * 1000) / 1000, cost_ratio_with_daily: withDaily === null ? null : Math.round(withDaily * 1000) / 1000, ok: ratio <= config.credit.max_cost_ratio + 1e-9 };
  });
  return { max_cost_per_credit_usd: Math.round(ceiling * 1_000_000) / 1_000_000, limit: config.credit.max_cost_ratio, rows };
}

export type DisplayPrice = { usd: number; usd_label: string; secondary: number; secondary_label: string };

/** "20 $" with "12 000 FCFA" to show in superscript; the FCFA figure is rounded for display only. */
export function displayPrice(usd: number, config: PricingConfig): DisplayPrice {
  // Large amounts round to the configured step (100 FCFA); unit prices stay exact to 5 FCFA.
  const exact = usd * config.currency.secondary_per_usd;
  const step = exact >= 1_000 ? config.currency.display_round_secondary : 5;
  const secondary = Math.round(exact / step) * step;
  const usdLabel = `${usd.toLocaleString('fr-FR', { minimumFractionDigits: Number.isInteger(usd) ? 0 : 2, maximumFractionDigits: 2 })} $`;
  return { usd, usd_label: usdLabel, secondary, secondary_label: `${secondary.toLocaleString('fr-FR')} ${config.currency.secondary_label}` };
}

/** What the public pricing surfaces may show: prices and quantities, nothing about costs or margins. */
export function publicPricing(config: PricingConfig, version: number) {
  const plans = (Object.entries(config.plans) as Array<[PlanKey, PricingConfig['plans'][PlanKey]]>)
    .filter(([, plan]) => plan.public)
    .map(([key, plan]) => ({
      key,
      label: plan.label,
      custom: plan.custom,
      per_seat: plan.per_seat,
      team_features: plan.team_features,
      monthly: plan.monthly_usd === null ? null : displayPrice(plan.monthly_usd, config),
      annual_monthly: plan.annual_monthly_usd === null ? null : displayPrice(plan.annual_monthly_usd, config),
      monthly_credits: plan.monthly_credits,
      signup_credits: plan.signup_credits,
      daily_credits: plan.daily_credits,
      daily_credits_monthly_cap: plan.daily_credits_monthly_cap,
      rollover_months: plan.rollover_months,
      topup: plan.topup_price_usd === null ? null : {
        unit: displayPrice(plan.topup_price_usd, config),
        tiers: config.topup.tiers.map(tier => ({ credits: tier, price: displayPrice(Math.round(tier * plan.topup_price_usd! * 100) / 100, config) })),
      },
    }));
  return {
    version,
    currency: { base: 'USD', secondary: config.currency.secondary, secondary_label: config.currency.secondary_label, secondary_per_usd: config.currency.secondary_per_usd },
    plans,
    monthly_grants: config.monthly_grants,
    daily_credits_scope: config.daily_credits_scope,
    topup_validity_months: config.topup.validity_months,
    indicative: config.indicative,
    cloud: config.cloud,
  };
}

/**
 * The v3 category a measured usage event belongs to, from its v2 name, when
 * it is metered by provider cost (Build and Chat). Cloud and e-mail are
 * metered by resource, not by tokens, so they return null here.
 */
export function meteredCategory(category: string | null | undefined): UsageCategory | null {
  if (category === 'build') return 'build';
  if (category === 'ai_gateway' || category === 'chat') return 'chat';
  if (category === 'app_ai' || category === 'connectors') return category;
  return null;
}

export type ShadowRow = { category?: string | null; provider_cost_usd?: number | string | null; cost_credits?: number | string | null; v3_credits?: number | string | null };

/**
 * Observation mode: per category, what was measured at the provider, what
 * the current grid charged and what the v3 grid would have charged, with the
 * real cost per credit each implies against the ceiling that keeps the margin.
 */
export function shadowComparison(rows: ShadowRow[], config: PricingConfig) {
  const limit = maxCostPerCreditUsd(config);
  const buckets = new Map<string, { category: string; events: number; provider_cost_usd: number; v2_credits: number; v3_credits: number }>();
  for (const row of rows) {
    const category = meteredCategory(row.category);
    if (!category) continue;
    const bucket = buckets.get(category) || { category, events: 0, provider_cost_usd: 0, v2_credits: 0, v3_credits: 0 };
    bucket.events += 1;
    bucket.provider_cost_usd += Math.max(0, Number(row.provider_cost_usd) || 0);
    bucket.v2_credits += Math.max(0, Number(row.cost_credits) || 0);
    bucket.v3_credits += Math.max(0, Number(row.v3_credits) || 0);
    buckets.set(category, bucket);
  }
  const perCredit = (cost: number, credits: number) => (credits > 0 ? Math.round((cost / credits) * 1_000_000) / 1_000_000 : null);
  return {
    max_cost_per_credit_usd: limit,
    rows: [...buckets.values()].map(bucket => ({
      ...bucket,
      provider_cost_usd: Math.round(bucket.provider_cost_usd * 10_000) / 10_000,
      v2_credits: Math.round(bucket.v2_credits * 100) / 100,
      v3_credits: Math.round(bucket.v3_credits * 100) / 100,
      v2_cost_per_credit_usd: perCredit(bucket.provider_cost_usd, bucket.v2_credits),
      v3_cost_per_credit_usd: perCredit(bucket.provider_cost_usd, bucket.v3_credits),
    })).sort((a, b) => b.provider_cost_usd - a.provider_cost_usd),
  };
}
