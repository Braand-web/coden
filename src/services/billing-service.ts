import Stripe from 'stripe';
import {
  ANNUAL_DISCOUNT,
  BILLING_PLANS,
  BILLING_V2_VERSION,
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
export type CloudUsageCategory = 'database_server' | 'database_storage' | 'compute' | 'file_storage' | 'live_updates' | 'network' | 'ai_app_usage';

export interface CloudPlanLimits {
  /** Compatibility fields only. V2 meters these resources against unified grants. */
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
  annualMonthlyEquivalent?: number; credits: number; creditTiers: readonly number[];
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
  expiresMonths: number; stripePriceEnv: string;
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

/** Retained as an empty compatibility export. Cloud top-ups are unified credit top-ups in V2. */
export interface CloudTopupProduct { id: string; amountUsd: number; label: string }

export const PUBLIC_PRICING_PLAN_KEYS = ['free', 'pro', 'business'] as const satisfies readonly PublicPlanKey[];
export const PAID_PLAN_KEYS = ['pro', 'business', 'enterprise'] as const satisfies readonly PlanKey[];
export const CLOUD_USAGE_CATEGORIES: CloudUsageCategory[] = ['database_server', 'database_storage', 'compute', 'file_storage', 'live_updates', 'network', 'ai_app_usage'];

const compatibilityCloud = (plan: BillingPlanKey): CloudPlanLimits => ({
  balanceUsd: 0,
  aiAppBalanceUsd: 0,
  databaseStorageGb: 0,
  fileStorageGb: 0,
  bandwidthGb: 0,
  topupMinUsd: plan === 'pro' || plan === 'business' ? 0 : null,
  autoTopupAvailable: plan === 'pro' || plan === 'business' || plan === 'enterprise',
  usageCategories: CLOUD_USAGE_CATEGORIES,
});

function planConfig(key: PlanKey): PlanConfig {
  const plan = BILLING_PLANS[key];
  const monthly = key === 'pro' || key === 'business' ? priceFor(key, 100, 'monthly') : null;
  const annual = key === 'pro' || key === 'business' ? priceFor(key, 100, 'annual') : null;
  return {
    id: plan.id,
    key,
    name: plan.name,
    amount: monthly?.amountUsd || 0,
    annualAmount: annual?.amountUsd || 0,
    annualMonthlyEquivalent: annual?.monthlyEquivalentUsd || 0,
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
  pro: { plan: 'pro', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: `${MINIMUM_PAID_GROSS_MARGIN * 100}% minimum`, maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['credit_topups', 'auto_topup', 'upgrade_to_business'], internalNote: 'Every settlement prices measured full cost and enforces the paid margin floor.' },
  business: { plan: 'business', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: `${MINIMUM_PAID_GROSS_MARGIN * 100}% minimum`, maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['larger_credit_tiers', 'auto_topup', 'dedicated_backend', 'enterprise_expansion'], internalNote: 'Premium capabilities remain bounded by measured provider cost and tenant budgets.' },
  enterprise: { plan: 'enterprise', grossMarginTarget: `${TARGET_GROSS_MARGIN * 100}%`, netMarginTarget: 'contractual', maxMonthlyAiCloudExposureUsd: null, monetizationPath: ['commitment', 'volume_pricing', 'dedicated_infrastructure'], internalNote: 'Enterprise economics are versioned by contract and never inferred from public pricing.' },
};

export const TOPUP_PRODUCTS: TopupProduct[] = TOPUP_PRODUCTS_V2.map(item => ({
  id: item.id, plan: item.plan, credits: item.credits, price: item.amountUsd,
  expiresMonths: item.expiresMonths, stripePriceEnv: item.stripePriceEnv,
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
  return { amount: price.amountUsd, recurringInterval: billingInterval === 'annual' ? 'year' as const : 'month' as const, label: `$${price.monthlyEquivalentUsd} / month${billingInterval === 'annual' ? ', billed annually' : ''}`, stripePriceEnv: price.stripePriceEnv };
}

function configuredStripePrice(envName: string) {
  const value = String(process.env[envName] || '').trim();
  if (!/^price_[A-Za-z0-9]+$/.test(value)) throw new Error(`Stripe Price is not configured for ${envName}.`);
  return value;
}

/** Conservative interim net revenue until Stripe balance transactions are reconciled. */
export function estimateStripeNetRevenue(grossUsd: number) {
  const percentage = Math.max(0, Number(process.env.STRIPE_EFFECTIVE_FEE_PERCENT || 0.029));
  const fixed = Math.max(0, Number(process.env.STRIPE_EFFECTIVE_FEE_FIXED_USD || 0.30));
  return Number(Math.max(0, grossUsd - (grossUsd * percentage) - fixed).toFixed(8));
}

export class StripeService {
  private readonly stripe: Stripe | null;
  constructor(private readonly supabase: any) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    this.stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: '2025-02-18' as any }) : null;
  }
  private getStripeClient() { if (!this.stripe) throw new Error('Stripe is not configured.'); return this.stripe; }

  private async customer(organizationId: string, email: string) {
    const stripe = this.getStripeClient();
    await this.ensureAccount(organizationId);
    const { data } = await this.supabase.from('billing_provider_customers').select('provider_customer_id').eq('account_id', organizationId).eq('provider', 'stripe').maybeSingle();
    if (data?.provider_customer_id) return String(data.provider_customer_id);
    const created = await stripe.customers.create({ email, metadata: { organization_id: organizationId } }, { idempotencyKey: `coden-customer-${organizationId}` });
    const { error } = await this.supabase.from('billing_provider_customers').upsert([{
      account_id: organizationId,
      provider: 'stripe',
      provider_customer_id: created.id,
      email,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'account_id,provider' });
    if (error) throw new Error(`Stripe customer persistence failed: ${error.message}`);
    return created.id;
  }

  async createSubscriptionCheckout(organizationId: string, email: string, planValue: string, successUrl: string, cancelUrl: string, billingInterval: BillingInterval = 'monthly', credits?: number, checkoutReference?: string) {
    const plan = getPlanConfig(planValue);
    if (!plan || !plan.public || (plan.key !== 'pro' && plan.key !== 'business')) throw new Error(`Unknown public paid plan key: ${planValue}`);
    const tier = Number(credits || plan.credits);
    const price = PUBLIC_PRICES.find(item => item.plan === plan.key && item.credits === tier && item.interval === billingInterval);
    if (!price) throw new Error(`Unsupported ${plan.key} credit tier: ${tier}`);
    const stripe = this.getStripeClient();
    const customer = await this.customer(organizationId, email);
    const metadata = { organization_id: organizationId, plan_key: plan.key, credit_tier: String(tier), billing_interval: billingInterval, price_version: BILLING_V2_VERSION };
    const session = await stripe.checkout.sessions.create({
      customer, line_items: [{ price: configuredStripePrice(price.stripePriceEnv), quantity: 1 }], mode: 'subscription',
      success_url: successUrl, cancel_url: cancelUrl, metadata, subscription_data: { metadata },
      allow_promotion_codes: false,
    }, { idempotencyKey: `subscription:${organizationId}:${plan.key}:${tier}:${billingInterval}:${String(checkoutReference || '').trim() || crypto.randomUUID()}` });
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return session.url;
  }

  async createTopupCheckout(organizationId: string, email: string, productId: string, successUrl: string, cancelUrl: string, checkoutReference?: string) {
    const item = TOPUP_PRODUCTS.find(product => product.id === productId);
    if (!item) throw new Error(`Invalid top-up product: ${productId}`);
    const { data: organization, error: planError } = await this.supabase.from('organizations').select('plan').eq('id', organizationId).maybeSingle();
    if (planError) throw new Error(`Workspace plan lookup failed: ${planError.message}`);
    const activePlan = normalizePlanKey(organization?.plan || 'free');
    if (activePlan !== item.plan) throw new Error(`This top-up is only available on the ${item.plan} plan.`);
    const stripe = this.getStripeClient();
    const customer = await this.customer(organizationId, email);
    const reference = String(checkoutReference || '').trim() || crypto.randomUUID();
    const session = await stripe.checkout.sessions.create({
      customer,
      line_items: [{ price: configuredStripePrice(item.stripePriceEnv), quantity: 1 }], mode: 'payment',
      success_url: successUrl, cancel_url: cancelUrl,
      payment_intent_data: { setup_future_usage: 'off_session' },
      metadata: { organization_id: organizationId, plan_key: item.plan, topup_credits: String(item.credits), topup_product_id: item.id, price_version: BILLING_V2_VERSION },
    }, { idempotencyKey: `topup:${organizationId}:${productId}:${reference}` });
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return session.url;
  }

  async createCloudTopupCheckout() { throw new Error('Separate Cloud top-ups were retired. Use a unified credit top-up.'); }

  private async ensureAccount(accountId: string) {
    const { error } = await this.supabase.from('billing_accounts').upsert([{ id: accountId, organization_id: accountId, owner_user_id: accountId, currency: 'usd', status: 'active' }], { onConflict: 'id' });
    if (error) throw new Error(`Billing account persistence failed: ${error.message}`);
  }

  private async grant(input: { accountId: string; kind: string; restriction: string; credits: number; netRevenueUsd: number; maxCogsUsd?: number; sourceReference: string; expiresAt?: string | null }) {
    await this.ensureAccount(input.accountId);
    const maxCogsUsd = input.maxCogsUsd ?? (input.netRevenueUsd > 0 ? input.netRevenueUsd * (1 - MINIMUM_PAID_GROSS_MARGIN) : 0);
    const { error } = await this.supabase.rpc('coden_billing_grant', {
      p_account_id: input.accountId, p_kind: input.kind, p_restriction: input.restriction,
      p_credits: input.credits, p_net_revenue_usd: input.netRevenueUsd, p_max_cogs_usd: maxCogsUsd,
      p_expires_at: input.expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(), p_source_reference: input.sourceReference,
      p_idempotency_key: input.sourceReference, p_metadata: { provider: 'stripe', price_version: BILLING_V2_VERSION },
    });
    if (error) throw new Error(`Credit grant failed: ${error.message}`);
  }

  async getAutoTopupConfig(accountId: string): Promise<AutoTopupConfig> {
    await this.ensureAccount(accountId);
    const { data, error } = await this.supabase.from('auto_topup_configs')
      .select('enabled,credits_to_add,threshold_credits,monthly_cap_credits,credits_added_this_month,provider_payment_method_id,last_triggered_at,last_error,price_version_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw new Error(`Auto top-up lookup failed: ${error.message}`);
    return {
      enabled: Boolean(data?.enabled),
      productId: data?.price_version_id ? String(data.price_version_id) : null,
      creditsToAdd: Number(data?.credits_to_add || 0),
      thresholdCredits: Number(data?.threshold_credits || 0),
      monthlyCapCredits: Number(data?.monthly_cap_credits || 0),
      creditsAddedThisMonth: Number(data?.credits_added_this_month || 0),
      hasPaymentMethod: Boolean(data?.provider_payment_method_id),
      lastTriggeredAt: data?.last_triggered_at ? String(data.last_triggered_at) : null,
      lastError: data?.last_error ? String(data.last_error) : null,
    };
  }

  async configureAutoTopup(accountId: string, input: { enabled: boolean; productId: string; thresholdCredits: number; monthlyCapCredits: number }) {
    await this.ensureAccount(accountId);
    const item = TOPUP_PRODUCTS.find(product => product.id === input.productId);
    if (!item) throw new Error('Unknown auto top-up product.');
    const { data: organization, error: planError } = await this.supabase.from('organizations').select('plan').eq('id', accountId).maybeSingle();
    if (planError) throw new Error(`Workspace plan lookup failed: ${planError.message}`);
    const plan = normalizePlanKey(organization?.plan || 'free');
    if (plan !== item.plan) throw new Error(`Auto top-up requires the ${item.plan} plan.`);
    const threshold = Math.max(0, Math.floor(Number(input.thresholdCredits || 0) * 10_000) / 10_000);
    const monthlyCap = Math.max(0, Math.floor(Number(input.monthlyCapCredits || 0) * 10_000) / 10_000);
    if (!Number.isFinite(threshold) || !Number.isFinite(monthlyCap) || monthlyCap < item.credits) {
      throw new Error(`The monthly cap must cover at least one ${item.credits}-credit top-up.`);
    }
    const { data: current, error: currentError } = await this.supabase.from('auto_topup_configs')
      .select('revision,provider_payment_method_id,usage_month,credits_added_this_month')
      .eq('account_id', accountId)
      .maybeSingle();
    if (currentError) throw new Error(`Auto top-up lookup failed: ${currentError.message}`);
    const hasPaymentMethod = Boolean(current?.provider_payment_method_id);
    const shouldEnable = Boolean(input.enabled && hasPaymentMethod);
    const currentMonth = new Date().toISOString().slice(0, 7);
    const sameMonth = String(current?.usage_month || '').slice(0, 7) === currentMonth;
    const { error } = await this.supabase.from('auto_topup_configs').upsert([{
      account_id: accountId,
      revision: Number(current?.revision || 0) + 1,
      enabled: shouldEnable,
      credits_to_add: item.credits,
      threshold_credits: threshold,
      monthly_cap_credits: monthlyCap,
      credits_added_this_month: sameMonth ? Number(current?.credits_added_this_month || 0) : 0,
      usage_month: `${currentMonth}-01`,
      provider_payment_method_id: current?.provider_payment_method_id || null,
      in_progress_key: null,
      in_progress_started_at: null,
      last_error: input.enabled && !hasPaymentMethod ? 'A saved payment method is required before auto top-up can be enabled.' : null,
      price_version_id: item.id,
      updated_at: new Date().toISOString(),
    }], { onConflict: 'account_id' });
    if (error) throw new Error(`Auto top-up update failed: ${error.message}`);
    return { ...(await this.getAutoTopupConfig(accountId)), requiresPaymentMethod: Boolean(input.enabled && !hasPaymentMethod) };
  }

  private async claimWebhook(event: Stripe.Event) {
    const row = { provider: 'stripe', event_id: event.id, event_type: event.type, status: 'processing' };
    const { error } = await this.supabase.from('provider_webhook_events').insert([row]);
    if (!error) return true;
    if (error.code === '23505' || /duplicate|unique/i.test(error.message || '')) return false;
    throw new Error(`Webhook idempotency persistence failed: ${error.message}`);
  }

  async handleWebhook(rawBody: string | Buffer, signature: string, webhookSecret: string): Promise<{ processed: boolean; reason?: string }> {
    const stripe = this.getStripeClient();
    if (!signature || !webhookSecret) throw new Error('Stripe webhook signature configuration is missing.');
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret); }
    catch { throw new Error('Stripe signature validation failed.'); }
    if (!(await this.claimWebhook(event))) return { processed: true, reason: 'Webhook already processed.' };
    try {
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountId = String(session.metadata?.organization_id || '');
        if (!accountId) throw new Error('Stripe session has no billing account reference.');
        if (session.mode === 'payment') {
          if (session.payment_status !== 'paid') throw new Error('Top-up payment is not confirmed.');
          const credits = Number(session.metadata?.topup_credits || 0);
          if (!Number.isFinite(credits) || credits <= 0) throw new Error('Top-up credits are invalid.');
          const grossRevenueUsd = Number(session.amount_total || 0) / 100;
          await this.grant({ accountId, kind: 'topup', restriction: 'general', credits, netRevenueUsd: estimateStripeNetRevenue(grossRevenueUsd), sourceReference: `stripe:${session.id}`, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() });
          if (session.payment_intent) {
            const paymentIntent = await stripe.paymentIntents.retrieve(String(session.payment_intent));
            const paymentMethodId = typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : paymentIntent.payment_method?.id;
            if (paymentMethodId) {
              await this.supabase.from('auto_topup_configs').update({ provider_payment_method_id: paymentMethodId, last_error: null, updated_at: new Date().toISOString() }).eq('account_id', accountId);
            }
          }
        } else if (session.mode === 'subscription' && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
          await this.syncSubscription(accountId, subscription, false);
        }
      } else if (event.type === 'customer.subscription.updated') {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = String(subscription.metadata?.organization_id || '');
        if (accountId) await this.syncSubscription(accountId, subscription, false);
      } else if (event.type === 'invoice.paid') {
        const invoice = event.data.object as Stripe.Invoice;
        const rawInvoice = invoice as any;
        const subscriptionId = String(rawInvoice.subscription || rawInvoice.parent?.subscription_details?.subscription || '');
        if (subscriptionId) {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const accountId = String(subscription.metadata?.organization_id || '');
          if (!accountId) throw new Error('Paid invoice subscription has no billing account reference.');
          await this.syncSubscription(accountId, subscription, true, `stripe-invoice:${invoice.id}`, estimateStripeNetRevenue(Number(invoice.amount_paid || 0) / 100));
        }
      } else if (event.type === 'customer.subscription.deleted') {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = String(subscription.metadata?.organization_id || '');
        if (accountId) await this.demoteToFreePlan(accountId);
      }
      await this.supabase.from('provider_webhook_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('provider', 'stripe').eq('event_id', event.id);
      return { processed: true };
    } catch (error: any) {
      await this.supabase.from('provider_webhook_events').update({ status: 'failed', last_error: String(error?.message || error).slice(0, 500) }).eq('provider', 'stripe').eq('event_id', event.id);
      throw error;
    }
  }

  private async syncSubscription(accountId: string, subscription: Stripe.Subscription, grantCredits: boolean, grantReference?: string, netRevenueOverride?: number) {
    const plan = getPlanConfig(subscription.metadata?.plan_key) || SAAS_PLANS.pro;
    const credits = Number(subscription.metadata?.credit_tier || plan.credits);
    const active = subscription.status === 'active' || subscription.status === 'trialing';
    await this.ensureAccount(accountId);
    const firstItem = subscription.items.data[0];
    const periodStart = Number(firstItem?.current_period_start || 0);
    const periodEnd = Number(firstItem?.current_period_end || 0);
    const annual = subscription.metadata?.billing_interval === 'annual';
    const monthlyGrantExpiry = new Date();
    monthlyGrantExpiry.setUTCMonth(monthlyGrantExpiry.getUTCMonth() + 1);
    const listedGrossRevenue = Number(firstItem?.price?.unit_amount || 0) / 100;
    const monthlyNetRevenue = netRevenueOverride !== undefined
      ? (annual ? netRevenueOverride / 12 : netRevenueOverride)
      : (annual ? estimateStripeNetRevenue(listedGrossRevenue) / 12 : estimateStripeNetRevenue(listedGrossRevenue));
    const { error } = await this.supabase.from('billing_subscriptions_v2').upsert([{
      account_id: accountId, provider_subscription_id: subscription.id, provider_customer_id: String(subscription.customer),
      plan_id: plan.id, credit_tier: credits, billing_interval: annual ? 'annual' : 'monthly',
      status: subscription.status, current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      ...(grantCredits ? { last_credit_grant_at: new Date().toISOString(), next_credit_grant_at: annual ? monthlyGrantExpiry.toISOString() : null } : {}),
      monthly_net_revenue_usd: monthlyNetRevenue,
      cancel_at_period_end: subscription.cancel_at_period_end,
    }], { onConflict: 'provider_subscription_id' });
    if (error) throw new Error(`Subscription persistence failed: ${error.message}`);
    await this.supabase.from('organizations').update({ plan: active ? plan.key : 'free', updated_at: new Date().toISOString() }).eq('id', accountId);
    if (!active || !grantCredits || credits <= 0) return;
    const reference = grantReference || `stripe:${subscription.id}:${periodStart || subscription.created}`;
    const expiresAt = annual ? monthlyGrantExpiry.toISOString() : (periodEnd ? new Date(periodEnd * 1000).toISOString() : monthlyGrantExpiry.toISOString());
    const dailyCreditsBudget = Number(plan.dailyCredits || 0) * 31;
    const totalEntitledCredits = credits + plan.grants.cloud + plan.grants.aiGateway + dailyCreditsBudget;
    const totalCogsBudget = monthlyNetRevenue * (1 - MINIMUM_PAID_GROSS_MARGIN);
    const cogsFor = (grantCreditsCount: number) => totalEntitledCredits > 0 ? totalCogsBudget * grantCreditsCount / totalEntitledCredits : 0;
    await this.grant({ accountId, kind: 'monthly_plan', restriction: 'general', credits, netRevenueUsd: monthlyNetRevenue, maxCogsUsd: cogsFor(credits), sourceReference: reference, expiresAt });
    if (plan.grants.cloud) await this.grant({ accountId, kind: 'monthly_cloud', restriction: 'cloud', credits: plan.grants.cloud, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.cloud), sourceReference: `${reference}:cloud`, expiresAt });
    if (plan.grants.aiGateway) await this.grant({ accountId, kind: 'monthly_ai', restriction: 'ai_gateway', credits: plan.grants.aiGateway, netRevenueUsd: 0, maxCogsUsd: cogsFor(plan.grants.aiGateway), sourceReference: `${reference}:ai`, expiresAt });
  }

  async grantDueAnnualCredits(limit = 100) {
    const stripe = this.getStripeClient();
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('billing_subscriptions_v2')
      .select('provider_subscription_id,next_credit_grant_at,monthly_net_revenue_usd')
      .eq('billing_interval', 'annual')
      .in('status', ['active', 'trialing'])
      .lte('next_credit_grant_at', now)
      .order('next_credit_grant_at', { ascending: true })
      .limit(Math.max(1, Math.min(500, limit)));
    if (error) throw new Error(`Annual grant listing failed: ${error.message}`);
    let granted = 0;
    for (const row of data || []) {
      if (!row.provider_subscription_id || !row.next_credit_grant_at) continue;
      const subscription = await stripe.subscriptions.retrieve(String(row.provider_subscription_id));
      const accountId = String(subscription.metadata?.organization_id || '');
      if (!accountId) continue;
      const monthKey = String(row.next_credit_grant_at).slice(0, 10);
      await this.syncSubscription(accountId, subscription, true, `stripe-annual:${subscription.id}:${monthKey}`, Number(row.monthly_net_revenue_usd || 0) * 12);
      granted += 1;
    }
    return granted;
  }

  async processDueAutoTopups(limit = 50) {
    const stripe = this.getStripeClient();
    const { data, error } = await this.supabase.from('auto_topup_configs')
      .select('account_id,revision,usage_month,credits_added_this_month')
      .eq('enabled', true)
      .is('in_progress_key', null)
      .limit(Math.max(1, Math.min(200, limit)));
    if (error) throw new Error(`Auto top-up scan failed: ${error.message}`);
    const outcomes: Array<{ accountId: string; status: 'paid' | 'skipped' | 'failed'; error?: string }> = [];
    for (const candidate of data || []) {
      const accountId = String(candidate.account_id || '');
      const triggerKey = `auto:${accountId}:${Number(candidate.revision || 1)}:${String(candidate.usage_month || '').slice(0, 10)}:${Number(candidate.credits_added_this_month || 0)}`;
      let claim: any = null;
      try {
        const result = await this.supabase.rpc('coden_claim_auto_topup', { p_account_id: accountId, p_trigger_key: triggerKey });
        if (result.error) throw new Error(result.error.message);
        claim = result.data;
        if (!claim) { outcomes.push({ accountId, status: 'skipped' }); continue; }
        const item = TOPUP_PRODUCTS.find(product => product.id === String(claim.price_version_id || ''));
        if (!item || Number(claim.credits_to_add || 0) !== item.credits) throw new Error('The claimed auto top-up price is no longer valid.');
        const { data: customer, error: customerError } = await this.supabase.from('billing_provider_customers')
          .select('provider_customer_id').eq('account_id', accountId).eq('provider', 'stripe').maybeSingle();
        if (customerError || !customer?.provider_customer_id) throw new Error('The Stripe customer is unavailable.');
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(item.price * 100),
          currency: 'usd',
          customer: String(customer.provider_customer_id),
          payment_method: String(claim.provider_payment_method_id),
          confirm: true,
          off_session: true,
          description: `Coden auto top-up: ${item.credits} credits`,
          metadata: { organization_id: accountId, auto_topup_key: triggerKey, topup_product_id: item.id, topup_credits: String(item.credits), price_version: BILLING_V2_VERSION },
        }, { idempotencyKey: triggerKey });
        if (paymentIntent.status !== 'succeeded') throw new Error(`Stripe payment is ${paymentIntent.status}.`);
        await this.grant({ accountId, kind: 'topup', restriction: 'general', credits: item.credits, netRevenueUsd: estimateStripeNetRevenue(item.price), sourceReference: `stripe:${paymentIntent.id}`, expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() });
        const completed = await this.supabase.rpc('coden_complete_auto_topup', { p_account_id: accountId, p_trigger_key: triggerKey, p_credits: item.credits });
        if (completed.error || completed.data !== true) throw new Error(completed.error?.message || 'Auto top-up completion lock was lost.');
        outcomes.push({ accountId, status: 'paid' });
      } catch (cause: any) {
        const message = String(cause?.message || cause || 'Auto top-up failed').slice(0, 500);
        if (claim) await this.supabase.rpc('coden_fail_auto_topup', { p_account_id: accountId, p_trigger_key: triggerKey, p_error: message }).catch(() => null);
        outcomes.push({ accountId, status: 'failed', error: message });
      }
    }
    return outcomes;
  }

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
      const { data: dailyRows, error: dailyError } = await this.supabase.from('credit_grants')
        .select('credits_issued')
        .eq('account_id', accountId)
        .eq('kind', 'daily_build')
        .gte('issued_at', monthStart);
      if (dailyError) throw new Error(`Daily grant lookup failed: ${dailyError.message}`);
      const issuedThisMonth = (dailyRows || []).reduce((sum: number, row: any) => sum + Number(row.credits_issued || 0), 0);
      const remainingCap = plan.monthlyCreditCap == null ? plan.dailyCredits : Math.max(0, plan.monthlyCreditCap - issuedThisMonth);
      const dailyCredits = Math.min(plan.dailyCredits, remainingCap);

      let monthlyNetRevenue = 0;
      let monthlyPlanCredits = plan.credits;
      if (planKey === 'pro' || planKey === 'business') {
        const { data: subscription } = await this.supabase.from('billing_subscriptions_v2')
          .select('monthly_net_revenue_usd,credit_tier')
          .eq('account_id', accountId)
          .in('status', ['active', 'trialing'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        monthlyNetRevenue = Number(subscription?.monthly_net_revenue_usd || 0);
        monthlyPlanCredits = Number(subscription?.credit_tier || plan.credits);
      }

      const entitlementTotal = planKey === 'free'
        ? Number(plan.monthlyCreditCap || 0) + plan.grants.cloud + plan.grants.aiGateway
        : monthlyPlanCredits + (plan.dailyCredits * 31) + plan.grants.cloud + plan.grants.aiGateway;
      const totalCogsBudget = planKey === 'free'
        ? FREE_ACTIVE_USER_COGS_CAP_USD
        : monthlyNetRevenue * (1 - MINIMUM_PAID_GROSS_MARGIN);
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
    await this.supabase.from('billing_subscriptions_v2').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('account_id', accountId);
    await this.supabase.from('organizations').update({ plan: 'free', updated_at: new Date().toISOString() }).eq('id', accountId);
    await this.supabase.from('credit_grants').update({ frozen_at: new Date().toISOString() }).eq('account_id', accountId).in('kind', ['monthly_plan', 'rollover']);
  }
}
