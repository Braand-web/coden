import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { billingMonthAt, annualInstallments } from './billing-calendar.ts';
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
  publicationLimitsFor,
  priceFor,
  type BillingInterval,
  type BillingPlanKey,
  type PublicationLimits,
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
  signupCredits: number; maxProjects: number; publishedSites: number | null;
  customDomains: number | null; rollover: 'none' | 'monthly' | 'annual_period'; public: boolean;
  technicalAllowances: { cloudBudgetUsd: number; aiAppBudgetUsd: number; emailCount: number };
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
  provider_transaction_id?: string | null;
  customer_email?: string | null;
  status: string;
};

export const PUBLIC_PRICING_PLAN_KEYS = ['free', 'pro', 'business'] as const satisfies readonly PublicPlanKey[];
export const PAID_PLAN_KEYS = ['pro', 'business', 'enterprise'] as const satisfies readonly PlanKey[];


/*
 * What the plan's cloud allowance is actually worth.
 *
 * Cloud and app-runtime AI are technical allowances denominated in USD. They
 * are deliberately not customer credits and never contribute to the balance
 * shown in the Builder. This keeps one canonical customer ledger while still
 * leaving the infrastructure meter in the units it actually incurs.
 */
const compatibilityCloud = (plan: BillingPlanKey): CloudPlanLimits => {
  const allowances = BILLING_PLANS[plan].technicalAllowances;
  const cloudUsd = allowances.cloudBudgetUsd;
  // What the allowance buys if it were spent entirely on one resource. These
  // are the "up to" figures a pricing page quotes, not separate budgets: one
  // wallet funds all of them.
  const buys = (meter: Parameters<typeof rawCloudCostUsd>[0]) => {
    const perUnit = rawCloudCostUsd(meter, 1) * CLOUD_MARKUP;
    return perUnit > 0 ? Math.floor(cloudUsd / perUnit) : 0;
  };
  return {
    balanceUsd: Number(cloudUsd.toFixed(2)),
    aiAppBalanceUsd: Number(allowances.aiAppBudgetUsd.toFixed(2)),
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
  const monthly = key === 'pro' || key === 'business' ? priceFor(key, plan.baseCredits, 'monthly') : null;
  const annual = key === 'pro' || key === 'business' ? priceFor(key, plan.baseCredits, 'annual') : null;
  const publication = publicationLimitsFor(key, plan.baseCredits);
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
    signupCredits: plan.grants.signupCredits,
    maxProjects: key === 'free' ? 1 : key === 'pro' ? 50 : 9_999,
    publishedSites: publication.publishedSites,
    customDomains: publication.customDomains,
    rollover: key === 'free' ? 'none' : key === 'enterprise' ? 'annual_period' : 'monthly',
    public: plan.public,
    technicalAllowances: {
      cloudBudgetUsd: plan.technicalAllowances.cloudBudgetUsd,
      aiAppBudgetUsd: plan.technicalAllowances.aiAppBudgetUsd,
      emailCount: plan.grants.monthlyEmailCount,
    },
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

export type PublicationEntitlement = PublicationLimits & {
  plan: PlanKey;
  creditTier: number;
  subscriptionStatus: string;
  canPublish: boolean;
  canAddDomain: boolean;
  canServeExisting: boolean;
  currentPeriodEnd: string | null;
  graceEndsAt: string | null;
};

/** Publishing and existing domains survive a downgrade; only adding a new domain needs a paid subscription. */
export async function resolvePublicationEntitlement(
  supabase: any,
  accountId: string,
  now = new Date(),
): Promise<PublicationEntitlement> {
  const { data, error } = await supabase
    .from('billing_subscriptions_v2')
    .select('plan_id,credit_tier,status,current_period_end,updated_at')
    .eq('account_id', accountId)
    // A cancelled historical row can be updated after a renewal. The most
    // recent entitlement is the period that ends last, not the row touched
    // last by a webhook.
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Publication entitlement lookup failed: ${error.message}`);

  const plan = getPlanConfig(data?.plan_id)?.key || 'free';
  const creditTier = Math.max(0, Number(data?.credit_tier || 0));
  const limits = publicationLimitsFor(plan, creditTier);
  const periodEnd = data?.current_period_end ? new Date(String(data.current_period_end)) : null;
  const validPeriod = Boolean(periodEnd && Number.isFinite(periodEnd.getTime()) && periodEnd > now);
  const active = isPaidPlanKey(plan) && data?.status === 'active' && validPeriod;
  return {
    ...limits,
    plan,
    creditTier,
    subscriptionStatus: String(data?.status || 'inactive'),
    canPublish: true,
    canAddDomain: active,
    canServeExisting: true,
    currentPeriodEnd: periodEnd && Number.isFinite(periodEnd.getTime()) ? periodEnd.toISOString() : null,
    graceEndsAt: null,
  };
}
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
  return billingMonthAt(input, months);
}

function cleanCustomerName(email: string) {
  const local = String(email || '').split('@')[0]?.replace(/[^a-z0-9]+/gi, ' ').trim();
  return local || 'Client Coden';
}

function saspayData<T>(payload: any): T {
  return (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' ? payload.data : payload) as T;
}

/** Told when an account's plan really changes (the Community reacts to it); never allowed to disturb billing. */
let planChangeHook: ((change: { accountId: string; from: string; to: string }) => void | Promise<void>) | null = null;
export function setPlanChangeHook(hook: typeof planChangeHook) { planChangeHook = hook; }

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
    const { data: existing, error: lookupError } = await this.supabase.from('billing_checkout_intents')
      .select('account_id,kind,plan_key,credit_tier,billing_interval,amount,currency,price_version_id,checkout_url,status,expires_at')
      .eq('idempotency_key', idempotencyKey).maybeSingle();
    if (lookupError) throw new Error('Checkout idempotency lookup is temporarily unavailable.');
    const samePurchase = existing && existing.account_id === input.accountId
      && existing.kind === input.kind && existing.plan_key === input.plan
      && Number(existing.credit_tier) === input.credits && existing.billing_interval === input.interval
      && Number(existing.amount) === input.amount && existing.currency === BILLING_SETTLEMENT_CURRENCY
      && existing.price_version_id === input.priceVersionId;
    if (samePurchase && existing.status === 'pending' && new Date(existing.expires_at).getTime() > Date.now()
      && /^https:\/\//i.test(String(existing.checkout_url || ''))) return String(existing.checkout_url);
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
    const { data: existing, error: lookupError } = await this.supabase.from('provider_webhook_events').select('status,attempts,processing_started_at').eq('provider', 'saspay').eq('event_id', eventId).maybeSingle();
    if (lookupError) throw new Error(`Webhook idempotency lookup failed: ${lookupError.message}`);
    if (existing?.status === 'processed') return false;
    // Do not let two webhook workers retry the same failed delivery concurrently.
    if (existing?.status === 'processing' && Date.parse(existing.processing_started_at) > Date.now() - 5 * 60_000) throw new Error('Webhook is already being processed; retry later.');
    const { data: retry, error: retryError } = await this.supabase.from('provider_webhook_events')
      .update({ status: 'processing', attempts: Number(existing?.attempts || 1) + 1, processing_started_at: new Date().toISOString(), last_error: null })
      .eq('provider', 'saspay').eq('event_id', eventId).eq('status', existing?.status).eq('attempts', Number(existing?.attempts || 1)).select('event_id').maybeSingle();
    if (retryError) throw new Error('Webhook retry persistence failed.');
    if (!retry) throw new Error('Webhook is already being processed; retry later.');
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
    if (String(transaction.status || '').toUpperCase() !== 'SUCCESS') throw new Error('Payment transaction is not confirmed.');
    const verified = transaction as SaspayTransaction & { transaction_type?: string; flow_direction?: string };
    if (verified.transaction_type !== 'PAIEMENT' || verified.flow_direction !== 'INBOUND') throw new Error('Transaction is not a customer payment.');
    if (String(transaction.id) !== String(fallback.id)) throw new Error('Payment transaction identity does not match.');
    const paidAmount = Number(transaction.requested_amount ?? transaction.amount ?? 0);
    const currency = String(transaction.currency || '').toUpperCase();
    if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - Number(intent.amount)) > 0.01) throw new Error('Paid amount does not match the checkout intent.');
    if (currency !== String(intent.currency).toUpperCase()) throw new Error('Paid currency does not match the checkout intent.');
  }

  private async grantMonthlyPlanCredits(accountId: string, plan: PlanConfig, credits: number, monthlyNetRevenueUsd: number, reference: string, expiresAt: string) {
    const totalCogsBudget = monthlyNetRevenueUsd * (1 - MINIMUM_PAID_GROSS_MARGIN);
    await this.grant({ accountId, kind: 'monthly_plan', restriction: 'general', credits, netRevenueUsd: monthlyNetRevenueUsd, maxCogsUsd: totalCogsBudget, sourceReference: reference, expiresAt });
  }

  private async grantPlan(intent: CheckoutIntent, transaction: SaspayTransaction) {
    const plan = getPlanConfig(intent.plan_key);
    if (!plan || (plan.key !== 'pro' && plan.key !== 'business')) throw new Error('Checkout plan is invalid.');
    const existing = await this.supabase.from('billing_subscriptions_v2').select('account_id,current_period_start')
      .eq('provider_subscription_id', intent.provider_checkout_id).maybeSingle();
    if (existing.error || (existing.data && existing.data.account_id !== intent.account_id)) throw new Error('Subscription identity persistence failed.');
    const now = existing.data?.current_period_start ? new Date(existing.data.current_period_start) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error('Subscription calendar is invalid.');
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
    const previousPlan = await this.readPlanKey(intent.account_id);
    const { error: organizationError } = await this.supabase.from('organizations').update({ plan: plan.key, updated_at: now.toISOString() }).eq('id', intent.account_id);
    if (organizationError) throw new Error('Workspace plan persistence failed.');
    this.emitPlanChange(intent.account_id, previousPlan, plan.key);
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
        if (intent.status==='paid' && intent.provider_transaction_id && intent.provider_transaction_id!==transaction.id)
          throw new Error('This checkout was already paid by a different transaction; reconciliation required.');
        if (intent.status !== 'paid') {
          if (intent.kind === 'topup') {
            await this.grant({ accountId: intent.account_id, kind: 'topup', restriction: 'general', credits: Number(intent.credit_tier), netRevenueUsd: estimateSaspayNetRevenue(Number(transaction.net_amount || intent.amount)), sourceReference: `saspay:${transaction.id}`, expiresAt: addUtcMonths(new Date(), 12).toISOString() });
          } else {
            await this.grantPlan(intent, transaction);
          }
          const { error: paidError } = await this.supabase.from('billing_checkout_intents').update({ status: 'paid', provider_transaction_id: transaction.id, provider_reference: transaction.reference || null, paid_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', intent.id);
          if (paidError) throw new Error('Paid checkout persistence failed.');
        }
      } else if (eventType === 'transaction.failed' || eventType === 'transaction.cancelled') {
        const { error: outcomeError } = await this.supabase.from('billing_checkout_intents').update({ status: eventType.endsWith('cancelled') ? 'cancelled' : 'failed', provider_transaction_id: transaction.id, updated_at: new Date().toISOString() }).eq('id', intent.id).neq('status', 'paid');
        if (outcomeError) throw new Error('Checkout outcome persistence failed.');
      }
      const { error: processedError } = await this.supabase.from('provider_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('provider', 'saspay').eq('event_id', eventId);
      if (processedError) throw new Error('Webhook completion persistence failed.');
      return { processed: true };
    } catch (error: any) {
      await this.supabase.from('provider_webhook_events').update({ status: 'failed', last_error: String(error?.message || error).slice(0, 500) }).eq('provider', 'saspay').eq('event_id', eventId);
      throw error;
    }
  }

  async grantDueAnnualCredits(limit = 100) {
    const now = new Date();
    const { data, error } = await this.supabase.from('billing_subscriptions_v2')
      .select('provider_subscription_id,account_id,plan_id,credit_tier,next_credit_grant_at,current_period_start,current_period_end,monthly_net_revenue_usd')
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
      const anchor = new Date(String(row.current_period_start || ''));
      const dueAt = new Date(String(row.next_credit_grant_at));
      const due = annualInstallments(anchor,now).filter(period => period.index > 0 && period.startsAt >= dueAt);
      let nextGrant = dueAt;
      for (const period of due) {
        // Never resurrect an expired monthly entitlement or shift the anniversary.
        if (period.expiresAt > now) {
          const reference = `saspay-annual:${row.provider_subscription_id}:${period.startsAt.toISOString().slice(0, 10)}`;
          await this.grantMonthlyPlanCredits(String(row.account_id), plan, Number(row.credit_tier || plan.credits), Number(row.monthly_net_revenue_usd || 0), reference, period.expiresAt.toISOString());
          granted += 1;
        }
        nextGrant = period.expiresAt;
      }
      const { error: scheduleError } = await this.supabase.from('billing_subscriptions_v2').update({ last_credit_grant_at: now.toISOString(), next_credit_grant_at: nextGrant < periodEnd ? nextGrant.toISOString() : null, updated_at: now.toISOString() }).eq('provider_subscription_id', row.provider_subscription_id);
      if (scheduleError) throw new Error('Annual credit schedule persistence failed.');
    }
    return granted;
  }

  async expireEndedPlans(limit = 500) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('billing_subscriptions_v2').select('id,account_id').in('provider', ['saspay', 'admin']).eq('status', 'active').lte('current_period_end', now).limit(Math.max(1, Math.min(2_000, limit)));
    if (error) throw new Error(`Expired plan listing failed: ${error.message}`);
    for (const row of data || []) {
      const { error: expiryError } = await this.supabase.from('billing_subscriptions_v2').update({ status: 'expired', updated_at: now }).eq('id', row.id);
      if (expiryError) throw new Error('Subscription expiry persistence failed.');
      const { data: active, error: activeError } = await this.supabase.from('billing_subscriptions_v2').select('id').eq('account_id', row.account_id).eq('status', 'active').gt('current_period_end', now).limit(1).maybeSingle();
      if (activeError) throw new Error('Active subscription lookup failed.');
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
    const { data: organizations, error } = await this.supabase.from('organizations').select('id,plan').limit(Math.max(1, Math.min(2_000, limit)));
    if (error) throw new Error(`Included credit account scan failed: ${error.message}`);
    let issued = 0;
    for (const organization of organizations || []) {
      const accountId = String(organization.id || '');
      const planKey = normalizePlanKey(organization.plan || 'free') || 'free';
      const plan = SAAS_PLANS[planKey];
      if (!accountId || planKey !== 'free' || !plan.signupCredits) continue;
      const sourceReference = `signup_free:${accountId}:v1`;
      const { data: existingGrant, error: existingGrantError } = await this.supabase
        .from('credit_grants')
        .select('id')
        .eq('account_id', accountId)
        .eq('kind', 'signup_free')
        .limit(1).maybeSingle();
      if (existingGrantError) throw new Error(`Signup grant lookup failed: ${existingGrantError.message}`);
      if (existingGrant) continue;
      await this.grant({
        accountId,
        kind: 'signup_free',
        restriction: 'general',
        credits: plan.signupCredits,
        netRevenueUsd: 0,
        maxCogsUsd: FREE_ACTIVE_USER_COGS_CAP_USD,
        sourceReference,
        expiresAt: '2099-12-31T23:59:59.999Z',
      });
      issued += 1;
    }
    return issued;
  }

  private async readPlanKey(accountId: string): Promise<string> {
    try {
      const { data } = await this.supabase.from('organizations').select('plan').eq('id', accountId).maybeSingle();
      return String(data?.plan || 'free');
    } catch { return 'free'; }
  }

  private emitPlanChange(accountId: string, from: string, to: string) {
    if (from === to || !planChangeHook) return;
    try { void Promise.resolve(planChangeHook({ accountId, from, to })).catch(() => undefined); } catch { /* billing never waits for it */ }
  }

  private async demoteToFreePlan(accountId: string) {
    const previousPlan = await this.readPlanKey(accountId);
    await this.supabase.from('organizations').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('id', accountId);
    this.emitPlanChange(accountId, previousPlan, 'free');
    await this.supabase.from('credit_grants').update({ frozen_at: new Date().toISOString() }).eq('account_id', accountId).in('kind', ['monthly_plan', 'rollover']);
  }
}
