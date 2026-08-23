export type PublicPlanKey = 'free' | 'pro' | 'scale';
export type BillingInterval = 'monthly' | 'annual';

export type PublicPlanDetails = {
  key: PublicPlanKey;
  name: string;
  monthly: number;
  annual: number;
  annualTotal: number;
  annualSaving: number;
  credits: string;
  cloud: string;
  bestFor: string;
};

/**
 * Public pricing is deliberately kept in one module so landing, pricing and
 * checkout cannot silently disagree about the selected offer.
 */
export const PUBLIC_PRICING_PLANS: Record<PublicPlanKey, PublicPlanDetails> = {
  free: {
    key: 'free',
    name: 'Free',
    monthly: 0,
    annual: 0,
    annualTotal: 0,
    annualSaving: 0,
    credits: 'Crédits de découverte pour créer un premier prototype',
    cloud: 'Preview locale non publiée',
    bestFor: 'Découvrir Coden et créer un premier prototype',
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthly: 25,
    annual: 20,
    annualTotal: 240,
    annualSaving: 60,
    credits: '1 000 crédits pour construire et améliorer vos applications',
    cloud: '10 $ d’hébergement inclus pour vos applications publiées',
    bestFor: 'Fondateurs et freelances qui publient leurs premières applications',
  },
  scale: {
    key: 'scale',
    name: 'Scale',
    monthly: 200,
    annual: 160,
    annualTotal: 1920,
    annualSaving: 480,
    credits: '10 000 crédits pour construire et améliorer vos applications',
    cloud: '75 $ d’hébergement inclus pour vos applications publiées',
    bestFor: 'Équipes qui livrent plusieurs applications en production',
  },
};

export function getPublicPlan(plan: PublicPlanKey): PublicPlanDetails {
  return PUBLIC_PRICING_PLANS[plan];
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
