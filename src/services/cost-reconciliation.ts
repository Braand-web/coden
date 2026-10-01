/**
 * Does the cost ledger match what OpenRouter says it charged?
 *
 * OpenRouter exposes a cumulative `total_usage` (token spend, no purchase fee). Once a day the delta since the previous
 * snapshot is written as an import (`provider_invoice_imports`) and compared with what the ledger recorded for the same
 * period (`provider_reconciliations`). The ledger holds the cost WITH the 5.5 % purchase fee (see `withProviderPurchaseFee`),
 * so the fee is taken out before comparing: otherwise every period would show a 5 % gap that is not one.
 *
 * Read-only toward the provider. A gap above the tolerance is flagged for a person; nothing is corrected automatically.
 */

export const RECONCILIATION_TOLERANCE = 0.05;
export const RECONCILIATION_MIN_PERIOD_MS = 23 * 3_600_000;

export type UsageSnapshot = { at: string; totalUsageUsd: number };

export type ReconciliationPlan = {
  periodStart: string;
  periodEnd: string;
  invoicedUsd: number;
  meteredUsd: number;
  varianceUsd: number;
  variancePct: number | null;
  status: 'matched' | 'investigate';
};

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

/** The comparison for one period. Pure. */
export function planReconciliation(input: {
  previous: UsageSnapshot;
  current: UsageSnapshot;
  /** Ledger cost recorded for the period, purchase fee included. */
  ledgerCostUsd: number;
  feeRate: number;
  tolerance?: number;
}): ReconciliationPlan {
  const invoicedUsd = Math.max(0, round(input.current.totalUsageUsd - input.previous.totalUsageUsd));
  const meteredUsd = Math.max(0, round(input.ledgerCostUsd / (1 + Math.max(0, input.feeRate))));
  const varianceUsd = round(meteredUsd - invoicedUsd);
  const variancePct = invoicedUsd > 0 ? round((varianceUsd / invoicedUsd) * 100, 2) : null;
  const tolerance = input.tolerance ?? RECONCILIATION_TOLERANCE;
  // Two quiet days (a few cents on each side) are not worth a person's time; an unmetered dollar is.
  const absoluteSlackUsd = 0.05;
  const matched = Math.abs(varianceUsd) <= absoluteSlackUsd
    || (invoicedUsd > 0 && Math.abs(varianceUsd) / invoicedUsd <= tolerance);
  return {
    periodStart: input.previous.at,
    periodEnd: input.current.at,
    invoicedUsd,
    meteredUsd,
    varianceUsd,
    variancePct,
    status: matched ? 'matched' : 'investigate',
  };
}

type Client = { from: (table: string) => any };

export type ReconcileOutcome =
  | { action: 'baseline' }
  | { action: 'skipped'; reason: 'too_soon' | 'usage_went_down' }
  | { action: 'reconciled'; plan: ReconciliationPlan };

/** One daily step: write the baseline on the first run, then one import and one reconciliation per period. */
export async function reconcileOpenRouterUsage(client: Client, current: UsageSnapshot, deps: { feeRate: number; now?: Date }): Promise<ReconcileOutcome> {
  const last = await client.from('provider_invoice_imports')
    .select('period_end,metadata')
    .eq('provider', 'openrouter')
    .order('period_end', { ascending: false })
    .limit(1);
  if (last.error) throw new Error(`Reconciliation could not read the last import: ${last.error.message}`);
  const row = (last.data || [])[0] as { period_end: string; metadata?: { total_usage_usd?: number } } | undefined;
  const previousUsage = Number(row?.metadata?.total_usage_usd);

  if (!row || !Number.isFinite(previousUsage)) {
    const inserted = await client.from('provider_invoice_imports').insert({
      provider: 'openrouter', period_start: current.at, period_end: current.at, amount_usd: 0,
      source_reference: `openrouter:baseline:${current.at}`,
      metadata: { total_usage_usd: current.totalUsageUsd, kind: 'baseline' },
    });
    if (inserted.error) throw new Error(`Reconciliation baseline could not be saved: ${inserted.error.message}`);
    return { action: 'baseline' };
  }

  const previous: UsageSnapshot = { at: row.period_end, totalUsageUsd: previousUsage };
  if (Date.parse(current.at) - Date.parse(previous.at) < RECONCILIATION_MIN_PERIOD_MS) return { action: 'skipped', reason: 'too_soon' };
  // A smaller cumulative figure means the account changed: never invent a negative invoice.
  if (current.totalUsageUsd < previous.totalUsageUsd) return { action: 'skipped', reason: 'usage_went_down' };

  const ledger = await client.from('usage_events')
    .select('provider_cost_usd')
    .eq('provider', 'openrouter')
    .gt('created_at', previous.at)
    .lte('created_at', current.at)
    .limit(50_000);
  if (ledger.error) throw new Error(`Reconciliation could not read the ledger: ${ledger.error.message}`);
  const ledgerCostUsd = ((ledger.data || []) as Array<{ provider_cost_usd?: number | string | null }>)
    .reduce((sum, event) => sum + Math.max(0, Number(event.provider_cost_usd) || 0), 0);

  const plan = planReconciliation({ previous, current, ledgerCostUsd, feeRate: deps.feeRate });
  const imported = await client.from('provider_invoice_imports').insert({
    provider: 'openrouter', period_start: plan.periodStart, period_end: plan.periodEnd, amount_usd: plan.invoicedUsd,
    source_reference: `openrouter:credits:${plan.periodEnd}`,
    metadata: { total_usage_usd: current.totalUsageUsd, kind: 'credits_delta', fee_rate: deps.feeRate },
  }).select('id').maybeSingle();
  if (imported.error || !imported.data?.id) throw new Error(`Reconciliation import could not be saved: ${imported.error?.message || 'no id'}`);
  const saved = await client.from('provider_reconciliations').insert({
    invoice_import_id: imported.data.id,
    metered_cost_usd: plan.meteredUsd,
    invoiced_cost_usd: plan.invoicedUsd,
    variance_usd: plan.varianceUsd,
    status: plan.status,
  });
  if (saved.error) throw new Error(`Reconciliation could not be saved: ${saved.error.message}`);
  return { action: 'reconciled', plan };
}

export function costReconcileEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CODEN_COST_RECONCILE ?? '1').trim() !== '0';
}

export function reconciliationAlertMessage(plan: ReconciliationPlan): string {
  const gap = `${plan.varianceUsd >= 0 ? '+' : '−'}${Math.abs(plan.varianceUsd).toFixed(2)} $`;
  const pct = plan.variancePct === null ? '' : ` (${plan.variancePct > 0 ? '+' : ''}${plan.variancePct} %)`;
  return plan.varianceUsd < 0
    ? `Rapprochement OpenRouter : ${plan.invoicedUsd.toFixed(2)} $ facturés contre ${plan.meteredUsd.toFixed(2)} $ enregistrés, écart ${gap}${pct}. Du coût n'est pas dans le registre.`
    : `Rapprochement OpenRouter : ${plan.meteredUsd.toFixed(2)} $ enregistrés contre ${plan.invoicedUsd.toFixed(2)} $ facturés, écart ${gap}${pct}. Le registre compte plus que la facture.`;
}
