import {
  MINIMUM_PAID_GROSS_MARGIN,
  TARGET_GROSS_MARGIN,
  type UsageRestriction,
} from '../config/billing-v2.ts';

export type CompleteCost = {
  providerCostUsd: number;
  providerPurchaseFeesUsd?: number;
  allocatedInfrastructureUsd?: number;
  allocatedPaymentFeesUsd?: number;
  refundFraudReserveUsd?: number;
};

export type MeteredProviderUsage = {
  provider: string;
  resource: string;
  category: Exclude<UsageRestriction, 'general'>;
  quantity: number;
  unit: string;
  providerCostUsd: number;
  model?: string | null;
  priceVersionId: string;
  idempotencyKey: string;
};

export type CreditEconomics = {
  netRevenueUsd: number;
  issuedCredits: number;
  targetMargin?: number;
  minimumMargin?: number;
};

const finiteNonNegative = (value: unknown, label: string) => {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} must be a finite non-negative amount.`);
  return amount;
};

export function completeCostUsd(cost: CompleteCost): number {
  return Number((
    finiteNonNegative(cost.providerCostUsd, 'providerCostUsd')
    + finiteNonNegative(cost.providerPurchaseFeesUsd, 'providerPurchaseFeesUsd')
    + finiteNonNegative(cost.allocatedInfrastructureUsd, 'allocatedInfrastructureUsd')
    + finiteNonNegative(cost.allocatedPaymentFeesUsd, 'allocatedPaymentFeesUsd')
    + finiteNonNegative(cost.refundFraudReserveUsd, 'refundFraudReserveUsd')
  ).toFixed(8));
}

export function priceForMargin(costUsd: number, margin: number): number {
  const cost = finiteNonNegative(costUsd, 'costUsd');
  if (!Number.isFinite(margin) || margin < 0 || margin >= 1) throw new Error('margin must be between 0 and 1.');
  return Number((cost / (1 - margin)).toFixed(8));
}

export function calculateCreditCharge(cost: CompleteCost, economics: CreditEconomics) {
  const fullCostUsd = completeCostUsd(cost);
  const credits = finiteNonNegative(economics.issuedCredits, 'issuedCredits');
  const revenue = finiteNonNegative(economics.netRevenueUsd, 'netRevenueUsd');
  if (credits <= 0 || revenue <= 0) throw new Error('A paid grant needs positive credits and net revenue.');

  const revenuePerCreditUsd = revenue / credits;
  const targetMargin = economics.targetMargin ?? TARGET_GROSS_MARGIN;
  const minimumMargin = economics.minimumMargin ?? MINIMUM_PAID_GROSS_MARGIN;
  const targetPriceUsd = priceForMargin(fullCostUsd, targetMargin);
  const floorPriceUsd = priceForMargin(fullCostUsd, minimumMargin);
  const chargedRevenueUsd = Math.max(targetPriceUsd, floorPriceUsd);
  const creditsCharged = Math.ceil((chargedRevenueUsd / revenuePerCreditUsd) * 100) / 100;
  const realizedRevenueUsd = creditsCharged * revenuePerCreditUsd;
  const realizedMargin = realizedRevenueUsd > 0 ? (realizedRevenueUsd - fullCostUsd) / realizedRevenueUsd : 1;

  return {
    fullCostUsd,
    revenuePerCreditUsd: Number(revenuePerCreditUsd.toFixed(8)),
    targetPriceUsd,
    floorPriceUsd,
    creditsCharged,
    realizedRevenueUsd: Number(realizedRevenueUsd.toFixed(8)),
    realizedMargin: Number(realizedMargin.toFixed(6)),
  };
}

export function openRouterTokenCost(input: {
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedReadUsdPerMillion?: number;
  cachedWriteUsdPerMillion?: number;
  providerFeeRate?: number;
}) {
  const inputCost = finiteNonNegative(input.inputTokens, 'inputTokens') * finiteNonNegative(input.inputUsdPerMillion, 'inputUsdPerMillion') / 1_000_000;
  const outputCost = finiteNonNegative(input.outputTokens, 'outputTokens') * finiteNonNegative(input.outputUsdPerMillion, 'outputUsdPerMillion') / 1_000_000;
  const cacheReadCost = finiteNonNegative(input.cachedReadTokens, 'cachedReadTokens') * finiteNonNegative(input.cachedReadUsdPerMillion, 'cachedReadUsdPerMillion') / 1_000_000;
  const cacheWriteCost = finiteNonNegative(input.cachedWriteTokens, 'cachedWriteTokens') * finiteNonNegative(input.cachedWriteUsdPerMillion, 'cachedWriteUsdPerMillion') / 1_000_000;
  const subtotalUsd = inputCost + outputCost + cacheReadCost + cacheWriteCost;
  const providerFeeUsd = subtotalUsd * finiteNonNegative(input.providerFeeRate, 'providerFeeRate');
  return { subtotalUsd: Number(subtotalUsd.toFixed(8)), providerFeeUsd: Number(providerFeeUsd.toFixed(8)), totalUsd: Number((subtotalUsd + providerFeeUsd).toFixed(8)) };
}

export function assertUsageEvent(event: MeteredProviderUsage) {
  if (!event.provider.trim() || !event.resource.trim() || !event.unit.trim()) throw new Error('Provider, resource and unit are required.');
  if (!event.priceVersionId.trim() || !event.idempotencyKey.trim()) throw new Error('Price version and idempotency key are required.');
  finiteNonNegative(event.quantity, 'quantity');
  finiteNonNegative(event.providerCostUsd, 'providerCostUsd');
  return event;
}
