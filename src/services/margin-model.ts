/**
 * Margin per credit and per action, from the public price list and a set of explicit assumptions.
 *
 * Nothing here is measured revenue (there is none yet: billing is in shadow mode). It answers "if this plan, this
 * tier and this kind of run were billed as announced, what is left?" from inputs that can each be changed and each say
 * whether it is measured, estimated or assumed. Pure: no I/O. The announced prices and credit costs are read, never
 * written: `priceFor`, `ACTION_CREDIT_PRICES`.
 */
import { ACTION_CREDIT_PRICES, MINIMUM_PAID_GROSS_MARGIN, TARGET_GROSS_MARGIN, priceFor, type BillableAction, type BillingInterval } from '../config/billing-v2.ts';

export type Basis = 'measured' | 'estimated' | 'assumed';

export type MarginAssumptions = {
  /** FCFA per US dollar: revenue is in FCFA, costs are mostly in dollars. */
  xafPerUsd: number;
  /** Tax included in the announced price, as a rate on the net price (0 = the price is net). Country-dependent: assumed. */
  vatRate: number;
  /** Share of each payment kept by the payment channel (cards, mobile money, aggregator). Assumed until read from a statement. */
  paymentFeeRate: number;
  /** Share of revenue refunded or lost to disputes. */
  refundRate: number;
  /** Share of the credits sold that are actually consumed (1 = all; below 1 is unused credits, which only helps). */
  usedShare: number;
  /** Platform cost attached to one run on top of the provider (preview compute, storage). */
  platformCostPerRunUsd: number;
};

export const DEFAULT_ASSUMPTIONS: MarginAssumptions = {
  xafPerUsd: 600,
  vatRate: 0,
  paymentFeeRate: 0.03,
  refundRate: 0,
  usedShare: 1,
  platformCostPerRunUsd: 0.0001,
};

export const ASSUMPTION_BASIS: Record<keyof MarginAssumptions, Basis> = {
  xafPerUsd: 'measured', // BILLING_XAF_PER_USD, the rate the prices are quoted at
  vatRate: 'assumed',
  paymentFeeRate: 'assumed',
  refundRate: 'assumed',
  usedShare: 'assumed',
  platformCostPerRunUsd: 'estimated',
};

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** What one credit brings in, after tax, payment fees and refunds, in dollars. Pro 100 credits: 15 000 FCFA → 25 $ → 0,25 $ a credit. */
export function netRevenuePerCreditUsd(plan: 'pro' | 'business', credits: number, interval: BillingInterval, assumptions: MarginAssumptions = DEFAULT_ASSUMPTIONS): number {
  const price = priceFor(plan, credits, interval);
  // The annual price covers twelve months of the same credits.
  const creditsPaidFor = interval === 'annual' ? credits * 12 : credits;
  const grossUsd = price.amount / assumptions.xafPerUsd;
  const netUsd = grossUsd / (1 + assumptions.vatRate) * (1 - assumptions.paymentFeeRate) * (1 - assumptions.refundRate);
  return netUsd / creditsPaidFor;
}

export type ActionMargin = {
  action: BillableAction;
  credits: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  /** null when nothing is billed. */
  marginPct: number | null;
  verdict: 'above_target' | 'above_floor' | 'below_floor' | 'loss';
};

/** One action, one plan and tier: what it brings in against what the run cost. */
export function actionMargin(input: {
  plan: 'pro' | 'business';
  credits: number;
  interval: BillingInterval;
  action: BillableAction;
  /** Provider cost of the run, purchase fee included (what the ledger holds). */
  providerCostUsd: number;
  assumptions?: MarginAssumptions;
}): ActionMargin {
  const assumptions = input.assumptions || DEFAULT_ASSUMPTIONS;
  const credits = ACTION_CREDIT_PRICES[input.action];
  const revenueUsd = credits * netRevenuePerCreditUsd(input.plan, input.credits, input.interval, assumptions) * assumptions.usedShare;
  const costUsd = input.providerCostUsd + assumptions.platformCostPerRunUsd;
  const marginUsd = revenueUsd - costUsd;
  const marginPct = revenueUsd > 0 ? marginUsd / revenueUsd : null;
  const verdict: ActionMargin['verdict'] = marginPct === null || marginPct < 0 ? 'loss'
    : marginPct < MINIMUM_PAID_GROSS_MARGIN ? 'below_floor'
      : marginPct < TARGET_GROSS_MARGIN ? 'above_floor' : 'above_target';
  return { action: input.action, credits, revenueUsd: round(revenueUsd), costUsd: round(costUsd), marginUsd: round(marginUsd), marginPct: marginPct === null ? null : round(marginPct, 4), verdict };
}

/** The most a run may cost the provider and still keep `targetMargin`, for this plan, tier and action. */
export function maxProviderCostUsd(input: { plan: 'pro' | 'business'; credits: number; interval: BillingInterval; action: BillableAction; targetMargin?: number; assumptions?: MarginAssumptions }): number {
  const assumptions = input.assumptions || DEFAULT_ASSUMPTIONS;
  const revenue = ACTION_CREDIT_PRICES[input.action] * netRevenuePerCreditUsd(input.plan, input.credits, input.interval, assumptions) * assumptions.usedShare;
  return round(Math.max(0, revenue * (1 - (input.targetMargin ?? MINIMUM_PAID_GROSS_MARGIN)) - assumptions.platformCostPerRunUsd));
}

export type SensitivityRow = { label: string; change: Partial<MarginAssumptions> | { providerCostFactor: number }; marginPct: number | null };

/** The questions a person asks: what if models cost 20 % more, the franc weakens 10 %, tax is 19,25 %, fees are 5 %. */
export function sensitivity(input: { plan: 'pro' | 'business'; credits: number; interval: BillingInterval; action: BillableAction; providerCostUsd: number; assumptions?: MarginAssumptions }): SensitivityRow[] {
  const base = input.assumptions || DEFAULT_ASSUMPTIONS;
  const at = (assumptions: MarginAssumptions, factor = 1) => actionMargin({ ...input, assumptions, providerCostUsd: input.providerCostUsd * factor }).marginPct;
  return [
    { label: 'Base', change: {}, marginPct: at(base) },
    { label: 'Prix des modèles +20 %', change: { providerCostFactor: 1.2 }, marginPct: at(base, 1.2) },
    { label: 'Franc −10 % face au dollar (660 FCFA/$)', change: { xafPerUsd: base.xafPerUsd * 1.1 }, marginPct: at({ ...base, xafPerUsd: base.xafPerUsd * 1.1 }) },
    { label: 'Franc +10 % face au dollar (540 FCFA/$)', change: { xafPerUsd: base.xafPerUsd * 0.9 }, marginPct: at({ ...base, xafPerUsd: base.xafPerUsd * 0.9 }) },
    { label: 'Taxe de 19,25 % incluse dans le prix', change: { vatRate: 0.1925 }, marginPct: at({ ...base, vatRate: 0.1925 }) },
    { label: 'Frais de paiement 5 %', change: { paymentFeeRate: 0.05 }, marginPct: at({ ...base, paymentFeeRate: 0.05 }) },
    { label: 'Coût du run ×3 (tâche lourde, plusieurs essais)', change: { providerCostFactor: 3 }, marginPct: at(base, 3) },
  ];
}

/** Cost per successful action once the money spent on failed runs is carried by the successes. */
export function costPerSuccessfulRunUsd(totalProviderCostUsd: number, successfulRuns: number): number | null {
  return successfulRuns > 0 ? round(totalProviderCostUsd / successfulRuns) : null;
}
