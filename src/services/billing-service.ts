import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BILLING_PLANS,
  BILLING_SETTLEMENT_CURRENCY,
  BILLING_V2_VERSION,
  BILLING_XAF_PER_USD,
  FREE_ACTIVE_USER_COGS_CAP_USD,
  MINIMUM_PAID_GROSS_MARGIN,
  PUBLIC_PRICES,
  TARGET_GROSS_MARGIN,
  TOPUP_PRODUCTS_V2,
  normalizeBillingPlan,
  priceFor,
  type BillingInterval,
  type BillingPlanKey,
} from '../config/billing-v2.ts';

export type { BillingInterval };
export type PublicPlanKey = 'free' | 'pro' | 'business';
export type PlanKey = BillingPlanKey;
// Owned by `cloud-metering`, which is what prices each category; re-exported
// here so existing importers of the billing surface keep working.
export type { CloudUsageCategory } from './cloud-metering.ts';
export { CLOUD_USAGE_CATEGORIES } from './cloud-metering.ts';
import {
  CLOUD_MARKUP,
  CLOUD_USAGE_CATEGORIES,
  USD_PER_CLOUD_CREDIT,
  rawCloudCostUsd,
  type CloudUsageCategory,
} from './cloud-metering.ts';

export interface CloudPlanLimits {
  balanceUsd: number;
  aiAppBalanceUsd: number;
  databaseStorageGb: number;
  fileStorageGb: number;
  bandwidthGb: number;
  topupMinUsd: number | null;
  autoTopupAvailable: boolean;
  usageCategories: CloudUsageCategory[];
}

export interface PlanConfig {
  id: string; key: PlanKey; name: string; amount: number; annualAmount?: number;
  annualMonthlyEquivalent?: number; currency: typeof BILLING_SETTLEMENT_CURRENCY; credits: number; creditTiers: readonly number[];
  dailyCredits?: number; monthlyCreditCap?: number | null; maxProjects: number;
  customDomains: number; rollover: 'none' | 'monthly' | 'annual_period'; public: boolean;
  grants: { cloud: number; aiGateway: number; emailCount: number };
  cloud: CloudPlanLimits; features: string[];
}

export interface PlanEconomicsGuardrail {
  plan: PlanKey; grossMarginTarget: string; netMarginTarget: string;
  maxMonthlyAiCloudExposureUsd: number | null; monetizationPath: string[]; internalNote: string;
}

export interface TopupProduct {
  id: string; plan: 'pro' | 'business'; credits: number; price: number;
  settlementAmount: number; currency: typeof BILLING_SETTLEMENT_CURRENCY; expiresMonths: number;
}

export type AutoTopupConfig = {
  enabled: boolean;
  productId: string | null;
  creditsToAdd: number;
  thresholdCredits: number;
  monthlyCapCredits: number;
  creditsAddedThisMonth: number;
  hasPaymentMethod: boolean;
  lastTriggeredAt: string | null;
  lastError: string | null;
};

export interface CloudTopupProduct { id: string; amountUsd: number; label: string }

type SaspayCheckout = { id: string; checkout_url: string };
type SaspayTransaction = {
  id: string;
  reference?: string;
  status?: string;
  description?: string;
  requested_amount?: string;
  amount?: string;
  net_amount?: string;
  currency?: string;
  metadata?: Record<string, unknown>;
  checkout_session?: string | { id?: string; metadata?: Record<string, unknown> };
};
type CheckoutIntent = {
  id: string;
  account_id: string;
  kind: 'subscription' | 'topup';
  plan_id: string;
  plan_key: 'pro' | 'business';
  credit_tier: number;
  billing_interval: BillingInterval | 'one_time';
  amount: number;
  currency: string;
  price_version_id: string;
  provider_checkout_id?: string | null;
  customer_email?: string | null;
  status: string;
};

export const PUBLIC_PRICING_PLAN_KEYS = ['free', 'pro', 'business'] as const satisfies readonly PublicPlanKey[];
export const PAID_PLAN_KEYS = ['pro', 'business', 'enterprise'] as const satisfies readonly PlanKey[];


/*
 * What the plan's cloud allowance is actually worth.
 *
 * Every field here was hardcoded to zero, while the same plans granted
 * `monthlyCloudCredits: 20` and the interface showed customers a storage and
 * bandwidth allowance. So the product advertised an entitlement of literally
 * nothing, and the twenty credits it granted bought nothing that was measured.
 *
 * The numbers are now derived from the grant that was already declared, rather
 * than invented: the monthly cloud credits are converted to money at the Pro
 * plan's own rate, and the headline GB figures are what that money buys at the
 * metered price of each resource. Nothing here sets a price — it reports, in
 * the units a customer thinks in, the allowance the plan already gives.
 *
 * `aiAppBalanceUsd` follows `monthlyAiCredits`, which is the third counter:
 * models called from inside a published app at runtime, not the agent that
 * built it.
 */
const compatibilityCloud = (plan: BillingPlanKey): CloudPlanLimits => {
  const grants = BILLING_PLANS[plan].grants;
  const cloudUsd = grants.monthlyCloudCredits * USD_PER_CLOUD_CREDIT;
  // What the allowance buys if it were spent entirely on one resource. These
  // are the "up to" figures a pricing page quotes, not separate budgets: one
  // wallet funds all of them.
  const buys = (meter: Parameters<typeof rawCloudCostUsd>[0]) => {
    const perUnit = rawCloudCostUsd(meter, 1) * CLOUD_MARKUP;
    return perUnit > 0 ? Math.floor(cloudUsd / perUnit) : 0;
  };
  return {
    balanceUsd: Number(cloudUsd.toFixed(2)),
    aiAppBalanceUsd: Number((grants.monthlyAiCredits * USD_PER_CLOUD_CREDIT).toFixed(2)),
    databaseStorageGb: buys('database_storage_gb_month'),
    fileStorageGb: buys('file_storage_gb_month'),
    bandwidthGb: buys('database_egress_gb'),
    topupMinUsd: plan === 'pro' || plan === 'business' ? 0 : null,
    autoTopupAvailable: false,
    usageCategories: CLOUD_USAGE_CATEGORIES,
  };
};

function planConfig(key: PlanKey): PlanConfig {
  const plan = BILLING_PLANS[key];
  const monthly = key === 'pro' || key === 'business' ? priceFor(key, 100, 'monthly') : null;
  const annual = key === 'pro' || key === 'business' ? priceFor(key, 100, 'annual') : null;
  return {
    id: plan.id,
    key,
    name: plan.name,
    amount: monthly?.amount || 0,
    annualAmount: annual?.amount || 0,
    annualMonthlyEquivalent: annual?.monthlyEquivalent || 0,
    currency: BILLING_SETTLEMENT_CURRENCY,
    credits: plan.baseCredits,
    creditTiers: plan.tiers,
    dailyCredits: plan.grants.dailyBuildCredits,
    monthlyCreditCap: plan.grants.dailyBuildMonthlyCap,
    maxProjects: key === 'free' ? 1 : key === 'pro' ? 50 : 9_999,
    customDomains: key === 'free' ? 0 : key === 'pro' ? 1 : key === 'business' ? 10 : 9_999,
    rollover: key === 'free' ? 'none' : key === 'enterprise' ? 'annual_period' : 'monthly',
    public: plan.public,
    grants: { cloud: plan.grants.monthlyCloudCredits, aiGateway: plan.grants.monthlyAiCredits, emailCount: plan.grants.monthlyEmailCount },
    cloud: compatibilityCloud(key),
    features: [...plan.capabilities],
  };
}

export const SAAS_PLANS: Record<PlanKey, PlanConfig> = {
  free: planConfig('free'), pro: planConfig('pro'), business: planConfig('business'), enterprise: planConfig('enterprise'),
};

export const PLAN_ECONOMICS_GUARDRAILS: Record<PlanKey, PlanEconomicsGuardrail> = {
  free: { plan: 'free', grossMarginTarget: 'controlled_acquisition', netMarginTarget: 'loss_limited', maxMonthlyAiCloudExposureUsd: FREE_ACTIVE_USER_COGS_CAP_USD, monetizationPath: ['upgrade_to_pro'], internalNote: 'Free COGS is capped per active user; no paid provider usage is treated as free.' },
  pro: { plan: 'pro', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: `${MINIMUM_PAID_GROSS_MARGIN * 100}% minimum`, maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['credit_topups', 'upgrade_to_business'], internalNote: 'Every settlement prices measured full cost and enforces the paid margin floor.' },
  business: { plan: 'business', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: `${MINIMUM_PAID_GROSS_MARGIN * 100}% minimum`, maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['larger_credit_tiers', 'dedicated_backend', 'enterprise_expansion'], internalNote: 'Premium capabilities remain bounded by measured provider cost and tenant budgets.' },
  enterprise: { plan: 'enterprise', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: 'contractual', maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['commitment', 'volume_pricing', 'dedicated_infrastructure'], internalNote: 'Enterprise economics are versioned by contract and never inferred from public pricing.' },
};

export const TOPUP_PRODUCTS: TopupProduct[] = TOPUP_PRODUCTS_V2.map(item => ({
  id: item.id,
  plan: item.plan,
  credits: item.credits,
  price: item.amount,
  settlementAmount: item.amount,
  currency: item.currency,
  expiresMonths: item.expiresMonths,
}));
export const CLOUD_TOPUP_PRODUCTS: CloudTopupProduct[] = [];

export function normalizePlanKey(value: unknown): PlanKey | null { return normalizeBillingPlan(value); }
export function getPlanConfig(value: unknown): PlanConfig | null {
  const key = normalizePlanKey(value);
  if (key) return SAAS_PLANS[key];
  const id = String(value || '').trim().toLowerCase();
  return Object.values(SAAS_PLANS).find(plan => plan.id.toLowerCase() === id) || null;
}
export function getPublicPlans() { return Object.fromEntries(PUBLIC_PRICING_PLAN_KEYS.map(key => [key, SAAS_PLANS[key]])) as Record<PublicPlanKey, PlanConfig>; }
export function getPlanEconomicsGuardrail(value: unknown) { const key = normalizePlanKey(value); return key ? PLAN_ECONOMICS_GUARDRAILS[key] : null; }
export function getCloudUsageCategories() { return CLOUD_USAGE_CATEGORIES.map(id => ({ id, label: id.split('_').map(part => part[0].toUpperCase() + part.slice(1)).join(' ') })); }
export function isPaidPlanKey(value: unknown) { const key = normalizePlanKey(value); return key === 'pro' || key === 'business' || key === 'enterprise'; }
export function resolveCheckoutAmount(plan: PlanConfig, billingInterval: BillingInterval, credits = plan.credits) {
  if (plan.key !== 'pro' && plan.key !== 'business') throw new Error('A public paid plan is required.');
  const price = priceFor(plan.key, credits, billingInterval);
  return {
    amount: price.amount,
    currency: price.currency,
    recurringInterval: billingInterval === 'annual' ? 'year' as const : 'month' as const,
    label: `${price.monthlyEquivalent.toLocaleString('fr-FR')} FCFA / mois${billingInterval === 'annual' ? ', payé annuellement' : ''}`,
  };
}

export function estimateSaspayNetRevenue(netAmountXaf: number) {
  const rate = Math.max(1, Number(process.env.SASPAY_XAF_PER_USD || BILLING_XAF_PER_USD));
  return Number((Math.max(0, netAmountXaf) / rate).toFixed(8));
}

export function verifySaspayWebhookSignature(rawBody: string | Buffer, signature: string, timestamp: string, secret: string, nowMs = Date.now()) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature) || !/^\d{10,13}$/.test(timestamp)) return false;
  const seconds = Number(timestamp.length === 13 ? Number(timestamp) / 1000 : timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Math.floor(nowMs / 1000) - seconds) > 300) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const actualBytes = Buffer.from(signature.toLowerCase(), 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function addUtcMonths(input: Date, months: number) {
  const value = new Date(input);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day, lastDay));
  return value;
}

function cleanCustomerName(email: string) {
  const local = String(email || '').split('@')[0]?.replace(/[^a-z0-9]+/gi, ' ').trim();
  return local || 'Client Coden';
}

function saspayData<T>(payload: any): T {
  return (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' ? payload.data : payload) as T;
}

export class SaspayService {
  private readonly apiBase = String(process.env.SASPAY_API_URL || 'https://api.saspay.me/api/v1').replace(/\/+$/, '');
  private readonly apiKey = String(process.env.SASPAY_API_KEY || '').trim();

  constructor(private readonly supabase: any) {}

  private requireApiKey() {
    if (!/^sk_(?:live|test)_[A-Za-z0-9_-]+$/.test(this.apiKey)) throw new Error('Saspay is not configured. Add SASPAY_API_KEY on the server.');
    return this.apiKey;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${this.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.requireApiKey()}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = String(payload?.error?.message || payload?.message || payload?.detail || `HTTP ${response.status}`).slice(0, 300);
        throw new Error(`Saspay request failed: ${message}`);
      }
      return saspayData<T>(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async ensureAccount(accountId: string) {
    const { error } = await this.supabase.from('billing_accounts').upsert([{ id: accountId, organization_id: accountId, owner_user_id: accountId, currency: 'usd', status: 'active' }], { onConflict: 'id' });
    if (error) throw new Error(`Billing account persistence failed: ${error.message}`);
  }

  private async createCheckout(input: {
    accountId: string;
    email: string;
    kind: 'subscription' | 'topup';
    plan: 'pro' | 'business';
    credits: number;
    interval: BillingInterval | 'one_time';
    amount: number;
    priceVersionId: string;
    successUrl: string;
    checkoutReference?: string;
  }) {
    await this.ensureAccount(input.accountId);
    const requestedKey = String(input.checkoutReference || '').trim();
    const idempotencyKey = /^[A-Za-z0-9:_-]{8,128}$/.test(requestedKey) ? requestedKey : randomUUID();
    const { data: existing } = await this.supabase.from('billing_checkout_intents').select('checkout_url,status').eq('idempotency_key', idempotencyKey).maybeSingle();
    if (existing?.checkout_url && existing.status === 'pending') return String(existing.checkout_url);
    if (existing) throw new Error('This checkout request has already been used. Please try again.');

    const intentId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    const intent = {
      id: intentId,
      account_id: input.accountId,
      provider: 'saspay',
      kind: input.kind,
      plan_id: SAAS_PLANS[input.plan].id,
      plan_key: input.plan,
      credit_tier: input.credits,
      billing_interval: input.interval,
      amount: input.amount,
      currency: BILLING_SETTLEMENT_CURRENCY,
      price_version_id: input.priceVersionId,
      customer_email: input.email,
      status: 'pending',
      idempotency_key: idempotencyKey,
      expires_at: expiresAt.toISOString(),
      metadata: { price_version: BILLING_V2_VERSION },
    };
    const { error: intentError } = await this.supabase.from('billing_checkout_intents').insert([intent]);
    if (intentError) throw new Error(`Checkout intent persistence failed: ${intentError.message}`);

    try {
      const country = String(process.env.SASPAY_COUNTRY || '').trim().toUpperCase();
      const checkout = await this.request<SaspayCheckout>('POST', '/checkout-sessions/', {
        amount: input.amount.toFixed(2),
        currency: BILLING_SETTLEMENT_CURRENCY,
        description: `Coden billing ${intentId}`,
        customer_email: input.email,
        customer_name: cleanCustomerName(input.email),
        return_url: input.successUrl,
        ...(country ? { country } : {}),
        metadata: {
          coden_intent_id: intentId,
          organization_id: input.accountId,
          kind: input.kind,
          plan_key: input.plan,
          credit_tier: input.credits,
          billing_interval: input.interval,
          price_version: BILLING_V2_VERSION,
        },
      });
      if (!checkout?.id || !/^https:\/\//i.test(String(checkout.checkout_url || ''))) throw new Error('Saspay did not return a valid checkout URL.');
      const { error: updateError } = await this.supabase.from('billing_checkout_intents').update({ provider_checkout_id: checkout.id, checkout_url: checkout.checkout_url, updated_at: new Date().toISOString() }).eq('id', intentId);
      if (updateError) throw new Error(`Checkout session persistence failed: ${updateError.message}`);
      return checkout.checkout_url;
    } catch (error) {
      await this.supabase.from('billing_checkout_intents').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', intentId);
      throw error;
    }
  }

  async createSubscriptionCheckout(organizationId: string, email: string, planValue: string, successUrl: string, _cancelUrl: string, billingInterval: BillingInterval = 'monthly', credits?: number, checkoutReference?: string) {
    const plan = getPlanConfig(planValue);
    if (!plan || !plan.public || (plan.key !== 'pro' && plan.key !== 'business')) throw new Error(`Unknown public paid plan key: ${planValue}`);
    const tier = Number(credits || plan.credits);
    const price = PUBLIC_PRICES.find(item => item.plan === plan.key && item.credits === tier && item.interval === billingInterval);
    if (!price) throw new Error(`Unsupported ${plan.key} credit tier: ${tier}`);
    return this.createCheckout({ accountId: organizationId, email, kind: 'subscription', plan: plan.key, credits: tier, interval: billingInterval, amount: price.amount, priceVersionId: price.id, successUrl, checkoutReference });
  }

  async createTopupCheckout(organizationId: string, email: string, productId: string, successUrl: string, _cancelUrl: string, checkoutReference?: string) {
    const item = TOPUP_PRODUCTS.find(product => product.id === productId);
    if (!item) throw new Error(`Invalid top-up product: ${productId}`);
    const { data: organization, error: planError } = await this.supabase.from('organizations').select('plan').eq('id', organizationId).maybeSingle();
    if (planError) throw new Error(`Workspace plan lookup failed: ${planError.message}`);
    const activePlan = normalizePlanKey(organization?.plan || 'free');
    if (activePlan !== item.plan) throw new Error(`This top-up is only available on the ${item.plan} plan.`);
    return this.createCheckout({ accountId: organizationId, email, kind: 'topup', plan: item.plan, credits: item.credits, interval: 'one_time', amount: item.settlementAmount, priceVersionId: item.id, successUrl, checkoutReference });
  }

  async createCloudTopupCheckout() { throw new Error('Separate Cloud top-ups were retired. Use a unified credit top-up.'); }

  private async grant(input: { accountId: string; kind: string; restriction: string; credits: number; netRevenueUsd: number; maxCogsUsd?: number; sourceReference: string; expiresAt?: string | null }) {
    await this.ensureAccount(input.accountId);
    const maxCogsUsd = input.maxCogsUsd ?? (input.netRevenueUsd > 0 ? input.netRevenueUsd * (1 - MINIMUM_PAID_GROSS_MARGIN) : 0);
    const { error } = await this.supabase.rpc('coden_billing_grant', {
      p_account_id: input.accountId,
      p_kind: input.kind,
      p_restriction: input.restriction,
      p_credits: input.credits,
      p_net_revenue_usd: input.netRevenueUsd,
      p_max_cogs_usd: maxCogsUsd,
      p_expires_at: input.expiresAt || addUtcMonths(new Date(), 1).toISOString(),
      p_source_reference: input.sourceReference,
      p_idempotency_key: input.sourceReference,
      p_metadata: { provider: 'saspay', price_version: BILLING_V2_VERSION },
    });
    if (error) throw new Error(`Credit grant failed: ${error.message}`);
  }

  private async claimWebhook(eventId: string, eventType: string) {
    const row = { provider: 'saspay', event_id: eventId, event_type: eventType, status: 'processing' };
    const { error } = await this.supabase.from('provider_webhook_events').insert([row]);
    if (!error) return true;
    if (error.code !== '23505' && !/duplicate|unique/i.test(error.message || '')) throw new Error(`Webhook idempotency persistence failed: ${error.message}`);
    const { data: existing, error: lookupError } = await this.supabase.from('provider_webhook_events').select('status,attempts').eq('provider', 'saspay').eq('event_id', eventId).maybeSingle();
    if (lookupError) throw new Error(`Webhook idempotency lookup failed: ${lookupError.message}`);
    if (existing?.status === 'processed') return false;
    await this.supabase.from('provider_webhook_events').update({ status: 'processing', attempts: Number(existing?.attempts || 1) + 1, last_error: null }).eq('provider', 'saspay').eq('event_id', eventId);
    return true;
  }

  private async resolveIntent(data: Record<string, any>): Promise<{ intent: CheckoutIntent; transaction: SaspayTransaction } | null> {
    const transactionId = String(data.id || data.transaction_id || '').trim();
    let transaction: SaspayTransaction = data as SaspayTransaction;
    if (transactionId) transaction = await this.request<SaspayTransaction>('GET', `/transactions/${encodeURIComponent(transactionId)}/`);
    const metadata = transaction.metadata || (typeof transaction.checkout_session === 'object' ? transaction.checkout_session.metadata : undefined) || data.metadata || {};
    let intentId = String((metadata as any).coden_intent_id || '').trim();
    if (!intentId) {
      const match = String(transaction.description || data.description || '').match(/Coden billing ([0-9a-f-]{36})/i);
      intentId = match?.[1] || '';
    }
    let query = this.supabase.from('billing_checkout_intents').select('*');
    if (intentId) query = query.eq('id', intentId);
    else if (typeof transaction.checkout_session === 'string') query = query.eq('provider_checkout_id', transaction.checkout_session);
    else return null;
    const { data: intent, error } = await query.maybeSingle();
    if (error) throw new Error(`Checkout intent lookup failed: ${error.message}`);
    return intent ? { intent: intent as CheckoutIntent, transaction } : null;
  }

  private assertPaidAmount(intent: CheckoutIntent, transaction: SaspayTransaction, fallback: Record<string, any>) {
    const paidAmount = Number(transaction.requested_amount || transaction.amount || fallback.amount || 0);
    const currency = String(transaction.currency || fallback.currency || '').toUpperCase();
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - Number(intent.amount)) > 0.01) throw new Error('Paid amount does not match the checkout intent.');
    if (currency !== String(intent.currency).toUpperCase()) throw new Error('Paid currency does not match the checkout intent.');
  }

  private async grantMonthlyPlanCredits(accountId: string, plan: PlanConfig, credits: number, monthlyNetRevenueUsd: number, reference: string, expiresAt: string) {
    const dailyCreditsBudget = Number(plan.dailyCredits || 0) * 31;
    const totalEntitledCredits = credits + plan.grants.cloud + plan.grants.aiGateway + dailyCreditsBudget;
    const totalCogsBudget = monthlyNetRevenueUsd * (1 - MINIMUM_PAID_GROSS_MARGIN);
    const cogsFor = (value: number) => totalEntitledCredits > 0 ? totalCogsBudget * value / totalEntitledCredits : 0;
    await this.grant({ accountId, kind: 'monthly_plan', restriction: 'general', credits, netRevenueUsd: monthlyNetRevenueUsd, maxCogsUsd: cogsFor(credits), sourceReference: reference, expiresAt });
    if (plan.grants.cloud) await this.grant({ accountId, kind: 'monthly_cloud', restriction: 'cloud', credits: plan.grants.cloud, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.cloud), sourceReference: `${reference}:cloud`, expiresAt });
    if (plan.grants.aiGateway) await this.grant({ accountId, kind: 'monthly_ai', restriction: 'ai_gateway', credits: plan.grants.aiGateway, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.aiGateway), sourceReference: `${reference}:ai`, expiresAt });
  }

  private async grantPlan(intent: CheckoutIntent, transaction: SaspayTransaction) {
    const plan = getPlanConfig(intent.plan_key);
    if (!plan || (plan.key !== 'pro' && plan.key !== 'business')) throw new Error('Checkout plan is invalid.');
    const now = new Date();
    const annual = intent.billing_interval === 'annual';
    const periodEnd = addUtcMonths(now, annual ? 12 : 1);
    const monthlyExpiry = addUtcMonths(now, 1);
    const netAmountXaf = Number(transaction.net_amount || transaction.requested_amount || intent.amount);
    const totalNetRevenueUsd = estimateSaspayNetRevenue(netAmountXaf);
    const monthlyNetRevenueUsd = annual ? totalNetRevenueUsd / 12 : totalNetRevenueUsd;
    const { error } = await this.supabase.from('billing_subscriptions_v2').upsert([{
      account_id: intent.account_id,
      provider: 'saspay',
      provider_subscription_id: intent.provider_checkout_id,
      provider_customer_id: intent.customer_email || null,
      plan_id: plan.id,
      price_version_id: intent.price_version_id,
      credit_tier: intent.credit_tier,
      billing_interval: annual ? 'annual' : 'monthly',
      status: 'active',
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
      last_credit_grant_at: now.toISOString(),
      next_credit_grant_at: annual ? monthlyExpiry.toISOString() : null,
      monthly_net_revenue_usd: monthlyNetRevenueUsd,
      cancel_at_period_end: true,
      updated_at: now.toISOString(),
    }], { onConflict: 'provider_subscription_id' });
    if (error) throw new Error(`Plan persistence failed: ${error.message}`);
    await this.supabase.from('organizations').update({ plan: plan.key, updated_at: now.toISOString() }).eq('id', intent.account_id);
    await this.grantMonthlyPlanCredits(intent.account_id, plan, intent.credit_tier, monthlyNetRevenueUsd, `saspay:${transaction.id}:initial`, monthlyExpiry.toISOString());
  }

  async handleWebhook(rawBody: string | Buffer, signature: string, timestamp: string, eventHeader: string, webhookSecret: string): Promise<{ processed: boolean; reason?: string }> {
    if (!verifySaspayWebhookSignature(rawBody, signature, timestamp, webhookSecret)) throw new Error('Saspay webhook signature validation failed.');
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
    const payload = JSON.parse(raw || '{}');
    const eventType = String(payload.event || eventHeader || '').trim();
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
    if (!eventType || !data.id) throw new Error('Saspay webhook payload is invalid.');
    const eventId = `${eventType}:${String(data.id)}`;
    if (!(await this.claimWebhook(eventId, eventType))) return { processed: true, reason: 'Webhook already processed.' };
    try {
      const resolved = await this.resolveIntent(data);
      if (!resolved) throw new Error('No Coden checkout intent matches this Saspay transaction.');
      const { intent, transaction } = resolved;
      if (eventType === 'transaction.success') {
        this.assertPaidAmount(intent, transaction, data);
        if (intent.status !== 'paid') {
          if (intent.kind === 'topup') {
            await this.grant({ accountId: intent.account_id, kind: 'topup', restriction: 'general', credits: Number(intent.credit_tier), netRevenueUsd: estimateSaspayNetRevenue(Number(transaction.net_amount || intent.amount)), sourceReference: `saspay:${transaction.id}`, expiresAt: addUtcMonths(new Date(), 12).toISOString() });
          } else {
            await this.grantPlan(intent, transaction);
          }
          await this.supabase.from('billing_checkout_intents').update({ status: 'paid', provider_transaction_id: transaction.id, provider_reference: transaction.reference || null, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', intent.id);
        }
      } else if (eventType === 'transaction.failed' || eventType === 'transaction.cancelled') {
        await this.supabase.from('billing_checkout_intents').update({ status: eventType.endsWith('cancelled') ? 'cancelled' : 'failed', provider_transaction_id: transaction.id, updated_at: new Date().toISOString() }).eq('id', intent.id).neq('status', 'paid');
      }
      await this.supabase.from('provider_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('provider', 'saspay').eq('event_id', eventId);
      return { processed: true };
    } catch (error: any) {
      await this.supabase.from('provider_webhook_events').update({ status: 'failed', last_error: String(error?.message || error).slice(0, 500) }).eq('provider', 'saspay').eq('event_id', eventId);
      throw error;
    }
  }

  async grantDueAnnualCredits(limit = 100) {
    const now = new Date();
    const { data, error } = await this.supabase.from('billing_subscriptions_v2')
      .select('provider_subscription_id,account_id,plan_id,credit_tier,next_credit_grant_at,current_period_end,monthly_net_revenue_usd')
      .eq('provider', 'saspay')
      .eq('billing_interval', 'annual')
      .eq('status', 'active')
      .lte('next_credit_grant_at', now.toISOString())
      .order('next_credit_grant_at', { ascending: true })
      .limit(Math.max(1, Math.min(500, limit)));
    if (error) throw new Error(`Annual grant listing failed: ${error.message}`);
    let granted = 0;
    for (const row of data || []) {
      const periodEnd = new Date(String(row.current_period_end || ''));
      if (!Number.isFinite(periodEnd.getTime()) || periodEnd <= now) continue;
      const plan = getPlanConfig(row.plan_id);
      if (!plan) continue;
      const grantAt = new Date(String(row.next_credit_grant_at));
      const nextGrant = addUtcMonths(grantAt, 1);
      const expiresAt = nextGrant < periodEnd ? nextGrant : periodEnd;
      const reference = `saspay-annual:${row.provider_subscription_id}:${grantAt.toISOString().slice(0, 10)}`;
      await this.grantMonthlyPlanCredits(String(row.account_id), plan, Number(row.credit_tier || plan.credits), Number(row.monthly_net_revenue_usd || 0), reference, expiresAt.toISOString());
      await this.supabase.from('billing_subscriptions_v2').update({ last_credit_grant_at: now.toISOString(), next_credit_grant_at: nextGrant < periodEnd ? nextGrant.toISOString() : null, updated_at: now.toISOString() }).eq('provider_subscription_id', row.provider_subscription_id);
      granted += 1;
    }
    return granted;
  }

  async expireEndedPlans(limit = 500) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('billing_subscriptions_v2').select('id,account_id').eq('provider', 'saspay').eq('status', 'active').lte('current_period_end', now).limit(Math.max(1, Math.min(2_000, limit)));
    if (error) throw new Error(`Expired plan listing failed: ${error.message}`);
    for (const row of data || []) {
      await this.supabase.from('billing_subscriptions_v2').update({ status: 'expired', updated_at: now }).eq('id', row.id);
      const { data: active } = await this.supabase.from('billing_subscriptions_v2').select('id').eq('account_id', row.account_id).eq('status', 'active').gt('current_period_end', now).limit(1).maybeSingle();
      if (!active) await this.demoteToFreePlan(String(row.account_id));
    }
    return (data || []).length;
  }

  async getAutoTopupConfig(_accountId: string): Promise<AutoTopupConfig> {
    return { enabled: false, productId: null, creditsToAdd: 0, thresholdCredits: 0, monthlyCapCredits: 0, creditsAddedThisMonth: 0, hasPaymentMethod: false, lastTriggeredAt: null, lastError: 'Saspay uses secure manual checkout for each top-up.' };
  }
  async configureAutoTopup() { throw new Error('Automatic top-up is not available with Saspay. Use a secure manual checkout.'); }
  async processDueAutoTopups() { return [] as Array<{ accountId: string; status: 'paid' | 'skipped' | 'failed'; error?: string }>; }

  async issueDueIncludedGrants(limit = 500) {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    const monthKey = dayKey.slice(0, 7);
    const nextDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const { data: organizations, error } = await this.supabase.from('organizations').select('id,plan').limit(Math.max(1, Math.min(2_000, limit)));
    if (error) throw new Error(`Included credit account scan failed: ${error.message}`);
    let issued = 0;
    for (const organization of organizations || []) {
      const accountId = String(organization.id || '');
      const planKey = normalizePlanKey(organization.plan || 'free') || 'free';
      const plan = SAAS_PLANS[planKey];
      if (!accountId || !plan.dailyCredits) continue;
      await this.ensureAccount(accountId);
      const monthStart = `${monthKey}-01T00:00:00.000Z`;
      const { data: dailyRows, error: dailyError } = await this.supabase.from('credit_grants').select('credits_issued').eq('account_id', accountId).eq('kind', 'daily_build').gte('issued_at', monthStart);
      if (dailyError) throw new Error(`Daily grant lookup failed: ${dailyError.message}`);
      const issuedThisMonth = (dailyRows || []).reduce((sum: number, row: any) => sum + Number(row.credits_issued || 0), 0);
      const remainingCap = plan.monthlyCreditCap == null ? plan.dailyCredits : Math.max(0, plan.monthlyCreditCap - issuedThisMonth);
      const dailyCredits = Math.min(plan.dailyCredits, remainingCap);

      let monthlyNetRevenue = 0;
      let monthlyPlanCredits = plan.credits;
      if (planKey === 'pro' || planKey === 'business') {
        const { data: subscription } = await this.supabase.from('billing_subscriptions_v2').select('monthly_net_revenue_usd,credit_tier').eq('account_id', accountId).eq('status', 'active').gt('current_period_end', now.toISOString()).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (!subscription) continue;
        monthlyNetRevenue = Number(subscription?.monthly_net_revenue_usd || 0);
        monthlyPlanCredits = Number(subscription?.credit_tier || plan.credits);
      }

      const entitlementTotal = planKey === 'free' ? Number(plan.monthlyCreditCap || 0) + plan.grants.cloud + plan.grants.aiGateway : monthlyPlanCredits + (plan.dailyCredits * 31) + plan.grants.cloud + plan.grants.aiGateway;
      const totalCogsBudget = planKey === 'free' ? FREE_ACTIVE_USER_COGS_CAP_USD : monthlyNetRevenue * (1 - MINIMUM_PAID_GROSS_MARGIN);
      const cogsFor = (credits: number) => entitlementTotal > 0 ? totalCogsBudget * credits / entitlementTotal : 0;

      if (dailyCredits > 0) {
        await this.grant({ accountId, kind: 'daily_build', restriction: 'build', credits: dailyCredits, netRevenueUsd: 0, maxCogsUsd: cogsFor(dailyCredits), sourceReference: `included:${accountId}:daily_build:${dayKey}`, expiresAt: nextDay });
        issued += 1;
      }
      if (planKey === 'free') {
        if (plan.grants.cloud > 0) {
          await this.grant({ accountId, kind: 'monthly_cloud', restriction: 'cloud', credits: plan.grants.cloud, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.cloud), sourceReference: `included:${accountId}:monthly_cloud:${monthKey}`, expiresAt: nextMonth });
          issued += 1;
        }
        if (plan.grants.aiGateway > 0) {
          await this.grant({ accountId, kind: 'monthly_ai', restriction: 'ai_gateway', credits: plan.grants.aiGateway, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.aiGateway), sourceReference: `included:${accountId}:monthly_ai:${monthKey}`, expiresAt: nextMonth });
          issued += 1;
        }
      }
    }
    return issued;
  }

  private async demoteToFreePlan(accountId: string) {
    await this.supabase.from('organizations').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('id', accountId);
    await this.supabase.from('credit_grants').update({ frozen_at: new Date().toISOString() }).eq('account_id', accountId).in('kind', ['monthly_plan', 'rollover']);
  }
}
