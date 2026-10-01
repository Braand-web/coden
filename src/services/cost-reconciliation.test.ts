import { describe, expect, it } from 'vitest';
import { costReconcileEnabled, planReconciliation, reconcileOpenRouterUsage, reconciliationAlertMessage } from './cost-reconciliation.ts';

const day1 = { at: '2026-10-02T00:00:00.000Z', totalUsageUsd: 100 };
const day2 = { at: '2026-10-03T00:30:00.000Z', totalUsageUsd: 103 };

describe('planReconciliation', () => {
  it('takes the purchase fee out of the ledger before comparing (hand-checked case)', () => {
    // OpenRouter charged 3.00 $; the ledger recorded 3.00 × 1.055 = 3.165 $ with the fee: they match.
    const plan = planReconciliation({ previous: day1, current: day2, ledgerCostUsd: 3.165, feeRate: 0.055 });
    expect(plan).toMatchObject({ invoicedUsd: 3, meteredUsd: 3, varianceUsd: 0, status: 'matched' });
  });

  it('flags money the ledger does not hold (only 2 $ recorded of 3 $ charged)', () => {
    const plan = planReconciliation({ previous: day1, current: day2, ledgerCostUsd: 2 * 1.055, feeRate: 0.055 });
    expect(plan.status).toBe('investigate');
    expect(plan.varianceUsd).toBe(-1);
    expect(plan.variancePct).toBe(-33.33);
  });

  it('accepts a gap within 5 % and tolerates cents on a quiet day', () => {
    expect(planReconciliation({ previous: day1, current: day2, ledgerCostUsd: 2.9 * 1.055, feeRate: 0.055 }).status).toBe('matched');
    const quiet = planReconciliation({ previous: day1, current: { ...day2, totalUsageUsd: 100.04 }, ledgerCostUsd: 0, feeRate: 0.055 });
    expect(quiet.status).toBe('matched');
  });
});

const fakeClient = (state: { imports: any[]; reconciliations: any[]; events: any[] }) => ({
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: any = {
      select: () => builder,
      eq: () => builder, order: () => builder, gt: () => builder, lte: () => builder,
      limit: () => Promise.resolve({ data: table === 'provider_invoice_imports' ? state.imports.slice(-1) : state.events, error: null }),
      insert: (row: any) => {
        if (table === 'provider_invoice_imports') { const saved = { id: `imp_${state.imports.length + 1}`, ...row }; state.imports.push(saved); return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: saved.id }, error: null }) }), then: (resolve: any) => resolve({ error: null }) }; }
        state.reconciliations.push(row);
        return Promise.resolve({ error: null });
      },
      filters,
    };
    return builder;
  },
});

describe('the daily step', () => {
  it('writes a baseline on the first run, then waits for a full period', async () => {
    const state = { imports: [] as any[], reconciliations: [] as any[], events: [] as any[] };
    expect(await reconcileOpenRouterUsage(fakeClient(state), day1, { feeRate: 0.055 })).toEqual({ action: 'baseline' });
    expect(state.imports).toHaveLength(1);
    expect(await reconcileOpenRouterUsage(fakeClient(state), { at: '2026-10-02T06:00:00.000Z', totalUsageUsd: 101 }, { feeRate: 0.055 })).toEqual({ action: 'skipped', reason: 'too_soon' });
    expect(state.reconciliations).toHaveLength(0);
  });

  it('reconciles after a full period and records the import and the comparison', async () => {
    const state = { imports: [{ id: 'imp_0', period_end: day1.at, metadata: { total_usage_usd: 100 } }] as any[], reconciliations: [] as any[], events: [{ provider_cost_usd: 1.055 }, { provider_cost_usd: 2.11 }] };
    const outcome = await reconcileOpenRouterUsage(fakeClient(state), day2, { feeRate: 0.055 });
    expect(outcome.action).toBe('reconciled');
    expect(state.reconciliations[0]).toMatchObject({ invoiced_cost_usd: 3, metered_cost_usd: 3, variance_usd: 0, status: 'matched' });
  });

  it('never invents a negative invoice when the cumulative figure goes down', async () => {
    const state = { imports: [{ id: 'imp_0', period_end: day1.at, metadata: { total_usage_usd: 100 } }] as any[], reconciliations: [] as any[], events: [] as any[] };
    expect(await reconcileOpenRouterUsage(fakeClient(state), { at: day2.at, totalUsageUsd: 50 }, { feeRate: 0.055 })).toEqual({ action: 'skipped', reason: 'usage_went_down' });
  });
});

describe('the switch and the message', () => {
  it('is on unless CODEN_COST_RECONCILE=0', () => {
    expect(costReconcileEnabled({})).toBe(true);
    expect(costReconcileEnabled({ CODEN_COST_RECONCILE: '0' })).toBe(false);
  });

  it('says in words which side is missing', () => {
    const missing = planReconciliation({ previous: day1, current: day2, ledgerCostUsd: 2 * 1.055, feeRate: 0.055 });
    expect(reconciliationAlertMessage(missing)).toContain('pas dans le registre');
    const extra = planReconciliation({ previous: day1, current: day2, ledgerCostUsd: 5 * 1.055, feeRate: 0.055 });
    expect(reconciliationAlertMessage(extra)).toContain('compte plus que la facture');
  });
});
