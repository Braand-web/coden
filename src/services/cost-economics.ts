/** Observation only: never used to set prices, credits or execution limits. */
export type MarginScenario = {
  grossRevenueXaf: number; creditsIssued: number; creditsConsumed: number;
  vatRate: number | null; paymentFeeRate: number | null; paymentFixedXaf: number | null;
  refundsXaf: number | null; disputesXaf: number | null; xafPerUsd: number | null;
  aiCostUsd: number | null; infrastructureCostUsd: number | null; servicesCostUsd: number | null;
  acquisitionFeeRate: number | null; fixedCostsXaf?: number;
};
const required = ['vatRate','paymentFeeRate','paymentFixedXaf','refundsXaf','disputesXaf','xafPerUsd','aiCostUsd','infrastructureCostUsd','servicesCostUsd','acquisitionFeeRate'] as const;
export function marginScenario(s: MarginScenario) {
  const missing = required.filter(key => s[key] === null || s[key] === undefined);
  if (missing.length) return { available: false as const, missing };
  const all = [s.grossRevenueXaf,s.creditsIssued,s.creditsConsumed,...required.map(k=>s[k]!)];
  if (all.some(v=>!Number.isFinite(v)||v<0) || s.xafPerUsd! <= 0 || s.vatRate! > 1 || s.paymentFeeRate! > 1 || s.acquisitionFeeRate! > 1) throw new Error('Invalid economic scenario');
  const fees = s.grossRevenueXaf * s.paymentFeeRate! + s.paymentFixedXaf!;
  const net = s.grossRevenueXaf / (1+s.vatRate!) - fees - s.refundsXaf! - s.disputesXaf!;
  const direct = (s.aiCostUsd! * (1+s.acquisitionFeeRate!) + s.infrastructureCostUsd! + s.servicesCostUsd!) * s.xafPerUsd!;
  const margin = net > 0 ? (net-direct)/net : null;
  const contribution = net-direct;
  return { available: true as const, netRevenueXaf: net, directCostXaf: direct, contributionXaf: contribution, grossMargin: margin,
    revenuePerIssuedCreditXaf: s.creditsIssued>0 ? net/s.creditsIssued : null,
    revenuePerConsumedCreditXaf: s.creditsConsumed>0 ? net/s.creditsConsumed : null,
    costPerConsumedCreditXaf: s.creditsConsumed>0 ? direct/s.creditsConsumed : null,
    breakEvenAccounts: contribution>0 && Number.isFinite(s.fixedCostsXaf) ? Math.ceil(Math.max(0,s.fixedCostsXaf!)/contribution) : null,
  };
}
export function invoiceReconciliation(ledgerUsd: number | null, invoiceUsageUsd: number | null, explainedAdjustmentsUsd = 0) {
  if (ledgerUsd===null || invoiceUsageUsd===null) return { available: false as const, matched: false, reason: 'matching_period_invoice_required' };
  if ([ledgerUsd,invoiceUsageUsd].some(n=>!Number.isFinite(n)||n<0) || !Number.isFinite(explainedAdjustmentsUsd)) throw new Error('Invalid reconciliation');
  const delta = ledgerUsd + explainedAdjustmentsUsd - invoiceUsageUsd;
  const ratio = invoiceUsageUsd>0 ? Math.abs(delta)/invoiceUsageUsd : delta===0 ? 0 : Infinity;
  return { available: true as const, matched: ratio < .05 || delta===0, discrepancyUsd: delta, discrepancyRatio: ratio };
}
