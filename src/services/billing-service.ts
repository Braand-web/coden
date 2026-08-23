import Stripe from 'stripe';

export type BillingInterval = 'monthly' | 'annual';
export type PublicPlanKey = 'free' | 'pro' | 'scale';
export type PlanKey = PublicPlanKey | 'enterprise';
export type CloudUsageCategory =
  | 'database_server'
  | 'database_storage'
  | 'compute'
  | 'file_storage'
  | 'live_updates'
  | 'network'
  | 'ai_app_usage';

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
  id: string;
  key: PlanKey;
  name: string;
  amount: number;
  annualAmount?: number;
  annualMonthlyEquivalent?: number;
  credits: number;
  dailyCredits?: number;
  monthlyCreditCap?: number;
  maxProjects: number;
  customDomains: number;
  topupPricePer50?: number;
  rollover: 'none' | 'monthly' | 'annual_period';
  public: boolean;
  cloud: CloudPlanLimits;
  features: string[];
}

export interface PlanEconomicsGuardrail {
  plan: PlanKey;
  grossMarginTarget: string;
  netMarginTarget: string;
  maxMonthlyAiCloudExposureUsd: number | null;
  monetizationPath: string[];
  internalNote: string;
}

export interface TopupProduct {
  id: string;
  plan: 'pro' | 'scale';
  credits: number;
  price: number;
  expiresMonths: number;
}

export interface CloudTopupProduct {
  id: string;
  amountUsd: number;
  label: string;
}

export const PUBLIC_PRICING_PLAN_KEYS = ['free', 'pro', 'scale'] as const satisfies readonly PublicPlanKey[];
export const PAID_PLAN_KEYS = ['pro', 'scale', 'enterprise'] as const satisfies readonly PlanKey[];
export const CLOUD_USAGE_CATEGORIES: CloudUsageCategory[] = [
  'database_server',
  'database_storage',
  'compute',
  'file_storage',
  'live_updates',
  'network',
  'ai_app_usage',
];

export const SAAS_PLANS: Record<PlanKey, PlanConfig> = {
  free: {
    id: 'plan_free',
    key: 'free',
    name: 'Free',
    amount: 0,
    annualAmount: 0,
    annualMonthlyEquivalent: 0,
    credits: 50,
    monthlyCreditCap: 50,
    maxProjects: 1,
    customDomains: 0,
    rollover: 'none',
    public: true,
    cloud: {
      balanceUsd: 1,
      aiAppBalanceUsd: 0.25,
      databaseStorageGb: 0.1,
      fileStorageGb: 0.25,
      bandwidthGb: 1,
      topupMinUsd: null,
      autoTopupAvailable: false,
      usageCategories: CLOUD_USAGE_CATEGORIES,
    },
    features: [
      '50 starter credits',
      '1 active project',
      'Live preview',
      'Limited Coden Cloud',
      '$1 Cloud balance included',
      '0.1 GB database storage',
      '0.25 GB file storage',
      '1 GB bandwidth',
      'Simple automatic database',
      'Simple auth',
      'Coden subdomain',
      'Built with Coden badge',
      'Standard AI streaming',
      'Limited history',
    ],
  },
  pro: {
    id: 'plan_pro',
    key: 'pro',
    name: 'Pro',
    amount: 25,
    annualAmount: 240,
    annualMonthlyEquivalent: 20,
    credits: 1000,
    monthlyCreditCap: 1000,
    maxProjects: 10,
    customDomains: 1,
    topupPricePer50: 1,
    rollover: 'monthly',
    public: true,
    cloud: {
      balanceUsd: 10,
      aiAppBalanceUsd: 1,
      databaseStorageGb: 1,
      fileStorageGb: 5,
      bandwidthGb: 50,
      topupMinUsd: 10,
      autoTopupAvailable: false,
      usageCategories: CLOUD_USAGE_CATEGORIES,
    },
    features: [
      '1,000 credits / month',
      '$10 Cloud balance included',
      '1 GB database storage',
      '5 GB file storage',
      '50 GB bandwidth',
      '10 active projects',
      '3 published apps',
      'Automatic Coden Cloud',
      'Automatic database, auth and storage',
      'Premium visual streaming',
      'Premium preview',
      'Custom domain',
      'Remove Coden badge',
      '1-click deploy',
      'Code export',
      'Version history and rollback',
      'GitHub integration',
      'Credit top-ups',
      'Standard support',
    ],
  },
  scale: {
    id: 'plan_scale',
    key: 'scale',
    name: 'Scale',
    amount: 200,
    annualAmount: 1920,
    annualMonthlyEquivalent: 160,
    credits: 10000,
    monthlyCreditCap: 10000,
    maxProjects: 9999,
    customDomains: 10,
    topupPricePer50: 1,
    rollover: 'monthly',
    public: true,
    cloud: {
      balanceUsd: 75,
      aiAppBalanceUsd: 10,
      databaseStorageGb: 20,
      fileStorageGb: 100,
      bandwidthGb: 250,
      topupMinUsd: 25,
      autoTopupAvailable: true,
      usageCategories: CLOUD_USAGE_CATEGORIES,
    },
    features: [
      '10,000 credits / month',
      '$75 Cloud balance included',
      '20 GB database storage',
      '100 GB file storage',
      '250 GB bandwidth',
      'Auto top-up available',
      'Unlimited draft projects',
      '25 published apps',
      'Advanced Coden Cloud',
      'Advanced automatic backends',
      'Automatic auth, database and storage',
      'Multiple custom domains',
      'Advanced GitHub sync',
      'Team workspace',
      'Roles and permissions',
      'Advanced analytics',
      'Generation logs and detailed AI runs',
      'Generation priority',
      'Premium models',
      'Basic security audit',
      'Priority support',
      'Full export and advanced rollback',
    ],
  },
  enterprise: {
    id: 'plan_enterprise',
    key: 'enterprise',
    name: 'Enterprise',
    amount: 0,
    credits: 0,
    maxProjects: 9999,
    customDomains: 9999,
    rollover: 'annual_period',
    public: false,
    cloud: {
      balanceUsd: 0,
      aiAppBalanceUsd: 0,
      databaseStorageGb: 0,
      fileStorageGb: 0,
      bandwidthGb: 0,
      topupMinUsd: null,
      autoTopupAvailable: true,
      usageCategories: CLOUD_USAGE_CATEGORIES,
    },
    features: [
      'Custom credits',
      'Custom Coden Cloud balance',
      'Custom storage and bandwidth',
      'Multiple workspaces',
      'Dedicated backend',
      'Stronger isolation',
      'SSO / SAML',
      'Advanced audit logs',
      'Advanced roles',
      'Custom contracts',
      'Private priority support',
      'Custom onboarding',
      'SLA',
      'Invoice billing',
      'Advanced security',
      'Multi-team management',
      'Custom limits',
    ],
  },
};

export const PLAN_ECONOMICS_GUARDRAILS: Record<PlanKey, PlanEconomicsGuardrail> = {
  free: {
    plan: 'free',
    grossMarginTarget: 'controlled_acquisition',
    netMarginTarget: 'loss_limited',
    maxMonthlyAiCloudExposureUsd: 1,
    monetizationPath: ['upgrade_to_pro', 'credit_topup_after_upgrade', 'cloud_topup_after_upgrade'],
    internalNote: 'Free should prove value with strict credits, limited Cloud balance, limited storage, and no unlimited promise.',
  },
  pro: {
    plan: 'pro',
    grossMarginTarget: '60-75%',
    netMarginTarget: '20-35%',
    maxMonthlyAiCloudExposureUsd: 10,
    monetizationPath: ['credit_topups', 'cloud_topups', 'custom_domain', 'upgrade_to_scale'],
    internalNote: 'Pro must stay margin-aware: 1,000 credits are routed economically, premium models are controlled, and heavy Cloud usage moves to top-ups.',
  },
  scale: {
    plan: 'scale',
    grossMarginTarget: '55-75%',
    netMarginTarget: '25-45%',
    maxMonthlyAiCloudExposureUsd: 85,
    monetizationPath: ['larger_credit_usage', 'cloud_topups', 'auto_topup', 'enterprise_expansion'],
    internalNote: 'Scale is the main growth plan for serious builders, teams, storage-heavy apps, custom domains, and production traffic.',
  },
  enterprise: {
    plan: 'enterprise',
    grossMarginTarget: '80-90%',
    netMarginTarget: '40-60%',
    maxMonthlyAiCloudExposureUsd: null,
    monetizationPath: ['platform_fee', 'volume_pricing', 'dedicated_backend', 'support_onboarding', 'custom_limits'],
    internalNote: 'Enterprise should be negotiated around volume, governance, dedicated infrastructure, onboarding, and support.',
  },
};

export const TOPUP_PRODUCTS: TopupProduct[] = [
  { id: 'topup_credits_500', plan: 'pro', credits: 500, price: 10.00, expiresMonths: 12 },
  { id: 'topup_credits_1500', plan: 'pro', credits: 1500, price: 30.00, expiresMonths: 12 },
  { id: 'topup_credits_4000', plan: 'scale', credits: 4000, price: 80.00, expiresMonths: 12 },
];

export const CLOUD_TOPUP_PRODUCTS: CloudTopupProduct[] = [
  { id: 'cloud_topup_10', amountUsd: 10, label: '$10 Cloud balance' },
  { id: 'cloud_topup_25', amountUsd: 25, label: '$25 Cloud balance' },
  { id: 'cloud_topup_100', amountUsd: 100, label: '$100 Cloud balance' },
];

export function normalizePlanKey(value: unknown): PlanKey | null {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'free' || key === 'pro' || key === 'scale' || key === 'enterprise') return key;
  return null;
}

export function getPlanConfig(value: unknown): PlanConfig | null {
  const key = normalizePlanKey(value);
  if (key) return SAAS_PLANS[key];
  const text = String(value || '').trim().toLowerCase();
  return Object.values(SAAS_PLANS).find(plan => plan.id.toLowerCase() === text) || null;
}

export function getPublicPlans() {
  return Object.fromEntries(PUBLIC_PRICING_PLAN_KEYS.map(key => [key, SAAS_PLANS[key]])) as Record<PublicPlanKey, PlanConfig>;
}

export function getPlanEconomicsGuardrail(value: unknown): PlanEconomicsGuardrail | null {
  const key = getPlanConfig(value)?.key || normalizePlanKey(value);
  return key ? PLAN_ECONOMICS_GUARDRAILS[key] : null;
}

export function getCloudUsageCategories() {
  return CLOUD_USAGE_CATEGORIES.map(category => ({
    id: category,
    label: category
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
  }));
}

export function isPaidPlanKey(value: unknown): boolean {
  const key = normalizePlanKey(value);
  return key === 'pro' || key === 'scale' || key === 'enterprise';
}

export function resolveCheckoutAmount(plan: PlanConfig, billingInterval: BillingInterval) {
  if (billingInterval === 'annual' && plan.annualAmount != null) {
    return {
      amount: plan.annualAmount,
      recurringInterval: 'year' as const,
      label: `$${plan.annualMonthlyEquivalent || Math.round(plan.annualAmount / 12)} / month, billed annually`,
    };
  }

  return {
    amount: plan.amount,
    recurringInterval: 'month' as const,
    label: `$${plan.amount} / month`,
  };
}

export class StripeService {
  private stripe: Stripe | null = null;
  private supabase: any;

  constructor(supabaseClient: any) {
    this.supabase = supabaseClient;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (stripeKey) {
      this.stripe = new Stripe(stripeKey, { apiVersion: '2025-02-18' as any });
    } else {
      console.warn('STRIPE_SECRET_KEY is missing. Stripe integrations will execute in simulation mode.');
    }
  }

  private getStripeClient(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe client is missing keys and must be initialized in .env with STRIPE_SECRET_KEY.');
    }
    return this.stripe;
  }

  async createSubscriptionCheckout(
    organizationId: string,
    email: string,
    planKey: string,
    successUrl: string,
    cancelUrl: string,
    billingInterval: BillingInterval = 'monthly'
  ): Promise<string> {
    const plan = getPlanConfig(planKey);
    if (!plan || !plan.public || plan.key === 'free') {
      throw new Error(`Unknown public paid plan key specified: ${planKey}`);
    }

    const resolvedBilling = resolveCheckoutAmount(plan, billingInterval);

    if (this.stripe) {
      const client = this.getStripeClient();

      let customerId = '';
      const { data: custRecord } = await this.supabase
        .from('stripe_customers')
        .select('stripe_customer_id')
        .eq('id', organizationId)
        .maybeSingle();

      if (custRecord) {
        customerId = custRecord.stripe_customer_id;
      } else {
        const customer = await client.customers.create({
          email,
          metadata: { organization_id: organizationId },
        });
        customerId = customer.id;
        await this.supabase
          .from('stripe_customers')
          .insert([{ id: organizationId, stripe_customer_id: customerId, email }]);
      }

      const metadata = {
        organization_id: organizationId,
        plan_key: plan.key,
        billing_interval: billingInterval,
      };

      const session = await client.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Coden - ${plan.name}`,
                description: `${plan.name} includes ${plan.credits.toLocaleString('en-US')} Coden credits plus app generation, Coden Cloud, preview and publishing workflows. Provider costs and margins are never exposed.`,
              },
              unit_amount: Math.round(resolvedBilling.amount * 100),
              recurring: { interval: resolvedBilling.recurringInterval },
            },
            quantity: 1,
          },
        ],
        mode: 'subscription',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        subscription_data: { metadata },
      });

      return session.url || successUrl;
    }

    console.log(`[STRIPE SIMULATION] Subscription checkout created for ${plan.key} (${billingInterval})`);
    return `/settings?plan=${plan.key}&billing=${billingInterval}&simulated_success=true`;
  }

  async createTopupCheckout(organizationId: string, email: string, productId: string, successUrl: string, cancelUrl: string): Promise<string> {
    const item = TOPUP_PRODUCTS.find(p => p.id === productId);
    if (!item) throw new Error(`Invalid top-up product: ${productId}`);

    if (this.stripe) {
      const client = this.getStripeClient();
      const session = await client.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Coden credits - ${item.credits} credits`,
                description: `User-facing Coden credits for AI actions and publishing workflows. Internal provider costs are not exposed.`,
              },
              unit_amount: Math.round(item.price * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { organization_id: organizationId, topup_credits: String(item.credits), topup_product_id: productId },
      });

      return session.url || successUrl;
    }

    return `/settings?topup=${productId}&simulated_success=true`;
  }

  async createCloudTopupCheckout(organizationId: string, email: string, productId: string, successUrl: string, cancelUrl: string): Promise<string> {
    const item = CLOUD_TOPUP_PRODUCTS.find(p => p.id === productId);
    if (!item) throw new Error(`Invalid Cloud top-up product: ${productId}`);

    if (this.stripe) {
      const client = this.getStripeClient();
      const session = await client.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: `Coden Cloud balance - $${item.amountUsd}`,
                description: 'User-facing Coden Cloud balance for published app hosting, database, storage, realtime, bandwidth and deployed AI usage.',
              },
              unit_amount: Math.round(item.amountUsd * 100),
            },
            quantity: 1,
          },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { organization_id: organizationId, cloud_topup_usd: String(item.amountUsd), cloud_topup_product_id: productId },
      });

      return session.url || successUrl;
    }

    return `/settings?cloud_topup=${productId}&simulated_success=true`;
  }

  /**
   * Safe handle of webhook events including subscription updates and one-time pay topups.
   */
  async handleWebhook(rawBody: string, signature: string, webhookSecret: string): Promise<{ processed: boolean; reason?: string }> {
    if (!this.stripe) {
      return { processed: false, reason: 'Stripe is running in simulated context. Raw webhooks are bypassed.' };
    }

    const client = this.getStripeClient();
    let event: Stripe.Event;

    try {
      event = client.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      throw new Error(`Stripe signature validation failed: ${err.message}`);
    }

    const { data: alreadyProcessed } = await this.supabase
      .from('stripe_events')
      .select('processed')
      .eq('event_id', event.id)
      .maybeSingle();

    if (alreadyProcessed?.processed) {
      return { processed: true, reason: 'Webhook already evaluated. Safe exit.' };
    }

    await this.supabase
      .from('stripe_events')
      .upsert([{ event_id: event.id, event_type: event.type, processed: false }]);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.organization_id;

        if (!orgId) break;

        if (session.mode === 'payment') {
          const cloudTopupUsd = Number(session.metadata?.cloud_topup_usd || 0);
          if (Number.isFinite(cloudTopupUsd) && cloudTopupUsd > 0) {
            await this.grantCloudBalance(
              orgId,
              cloudTopupUsd,
              session.id,
              `Cloud balance top-up purchased - ID: ${session.metadata?.cloud_topup_product_id}`
            );
            break;
          }

          const creditsStr = session.metadata?.topup_credits;
          const creditsVal = creditsStr ? parseInt(creditsStr, 10) : 0;
          if (creditsVal > 0) {
            const { data: wallet } = await this.supabase
              .from('credit_wallets')
              .select('balance')
              .eq('organization_id', orgId)
              .maybeSingle();

            const current = wallet ? parseFloat(wallet.balance) : 0;
            const updated = current + creditsVal;

            await this.supabase
              .from('credit_wallets')
              .upsert([{ organization_id: orgId, balance: updated, updated_at: new Date().toISOString() }]);

            await this.supabase
              .from('credit_ledger')
              .insert([{
                wallet_id: orgId,
                type: 'topup',
                amount: creditsVal,
                balance_after: updated,
                description: `Credit top-up purchased - ID: ${session.metadata?.topup_product_id}`,
                reference_id: session.id,
              }]);
          }
        }

        if (session.mode === 'subscription' && session.subscription) {
          const plan = getPlanConfig(session.metadata?.plan_key) || SAAS_PLANS.pro;
          const subObj = await client.subscriptions.retrieve(session.subscription as string);
          await this.syncSubscription(orgId, subObj, plan.key, plan.id, plan.credits, plan);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const { data: customer } = await this.supabase
          .from('stripe_customers')
          .select('id')
          .eq('stripe_customer_id', sub.customer as string)
          .maybeSingle();

        if (customer) {
          const plan = getPlanConfig(sub.metadata?.plan_key || sub.metadata?.plan_id) || SAAS_PLANS.pro;
          await this.syncSubscription(customer.id, sub, plan.key, plan.id, plan.credits, plan);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const { data: customer } = await this.supabase
          .from('stripe_customers')
          .select('id')
          .eq('stripe_customer_id', sub.customer as string)
          .maybeSingle();

        if (customer) {
          await this.demoteToFreePlan(customer.id);
        }
        break;
      }
    }

    await this.supabase
      .from('stripe_events')
      .update({ processed: true })
      .eq('event_id', event.id);

    return { processed: true };
  }

  private async syncSubscription(organizationId: string, stripeSubscription: any, planKey: PlanKey, planId: string, creditsToGrant: number, planConfig: PlanConfig) {
    if (!this.supabase) return;

    await this.supabase
      .from('subscriptions')
      .upsert({
        organization_id: organizationId,
        stripe_subscription_id: stripeSubscription.id,
        plan_id: planId,
        status: stripeSubscription.status,
        current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: stripeSubscription.cancel_at_period_end,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'stripe_subscription_id' });

    await this.supabase
      .from('organizations')
      .update({ plan: planKey, updated_at: new Date().toISOString() })
      .eq('id', organizationId);

    const { data: wallet } = await this.supabase
      .from('credit_wallets')
      .select('balance')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const current = wallet ? parseFloat(wallet.balance) : 0;
    const updated = current + creditsToGrant;

    await this.supabase
      .from('credit_wallets')
      .upsert([{ organization_id: organizationId, balance: updated, updated_at: new Date().toISOString() }]);

    await this.supabase
      .from('credit_ledger')
      .insert([{
        wallet_id: organizationId,
        type: 'subscription_grant',
        amount: creditsToGrant,
        balance_after: updated,
        description: `Plan subscription credits granted automatically.`,
        reference_id: stripeSubscription.id,
      }]);

    await this.grantIncludedCloudBalance(organizationId, planConfig, stripeSubscription.id);
  }

  private async grantIncludedCloudBalance(organizationId: string, plan: PlanConfig, referenceId: string) {
    const amount = Number(plan.cloud?.balanceUsd || 0);
    const aiAppBalance = Number(plan.cloud?.aiAppBalanceUsd || 0);
    if (!this.supabase || amount <= 0) return;

    try {
      const { data: wallet } = await this.supabase
        .from('cloud_wallets')
        .select('balance_usd,included_balance_usd,ai_app_balance_usd')
        .eq('organization_id', organizationId)
        .maybeSingle();

      const current = wallet ? Number(wallet.balance_usd || 0) : 0;
      const currentIncluded = wallet ? Number(wallet.included_balance_usd || 0) : 0;
      const currentAiApp = wallet ? Number(wallet.ai_app_balance_usd || 0) : 0;

      await this.supabase
        .from('cloud_wallets')
        .upsert([{
          organization_id: organizationId,
          balance_usd: current + amount,
          included_balance_usd: currentIncluded + amount,
          ai_app_balance_usd: currentAiApp + aiAppBalance,
          auto_topup_enabled: false,
          updated_at: new Date().toISOString(),
        }]);

      await this.supabase
        .from('cloud_usage_ledger')
        .insert([{
          organization_id: organizationId,
          usage_type: 'included_grant',
          amount_usd: amount,
          description: `${plan.name} included Coden Cloud balance granted.`,
          reference_id: referenceId,
        }]);
    } catch (error: any) {
      console.warn(`[coden:cloud_wallet_grant_skipped] ${error?.message || error}`);
    }
  }

  private async grantCloudBalance(organizationId: string, amountUsd: number, referenceId: string, description: string) {
    if (!this.supabase || amountUsd <= 0) return;

    try {
      const { data: wallet } = await this.supabase
        .from('cloud_wallets')
        .select('balance_usd')
        .eq('organization_id', organizationId)
        .maybeSingle();

      const current = wallet ? Number(wallet.balance_usd || 0) : 0;
      const updated = current + amountUsd;

      await this.supabase
        .from('cloud_wallets')
        .upsert([{ organization_id: organizationId, balance_usd: updated, updated_at: new Date().toISOString() }]);

      // A positive balance after a top-up must lift any metering suspension.
      if (updated > 0) {
        await this.supabase.rpc('reactivate_cloud_wallet', { org_id: organizationId }).catch((error: any) => {
          console.warn(`[coden:cloud_wallet_reactivate_skipped] ${error?.message || error}`);
        });
      }

      await this.supabase
        .from('cloud_usage_ledger')
        .insert([{
          organization_id: organizationId,
          usage_type: 'topup',
          amount_usd: amountUsd,
          description,
          reference_id: referenceId,
        }]);
    } catch (error: any) {
      console.warn(`[coden:cloud_wallet_topup_skipped] ${error?.message || error}`);
    }
  }

  private async demoteToFreePlan(organizationId: string) {
    if (!this.supabase) return;

    const freePlan = SAAS_PLANS.free;

    await this.supabase
      .from('subscriptions')
      .update({
        plan_id: freePlan.id,
        status: 'canceled',
        stripe_subscription_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('organization_id', organizationId);

    await this.supabase
      .from('organizations')
      .update({ plan: freePlan.key, updated_at: new Date().toISOString() })
      .eq('id', organizationId);

    const { data: wallet } = await this.supabase
      .from('credit_wallets')
      .select('balance')
      .eq('organization_id', organizationId)
      .maybeSingle();

    const current = wallet ? parseFloat(wallet.balance) : 0;
    const targetBalance = Math.min(current, parseFloat(String(freePlan.credits)));

    await this.supabase
      .from('credit_wallets')
      .update({ balance: targetBalance })
      .eq('organization_id', organizationId);
  }
}
