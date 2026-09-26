import { describe, expect, it } from 'vitest';
import { aggregateCosts, evaluateCostAlerts, type UsageEventRow } from './admin-costs';

const now = new Date('2026-09-25T12:00:00Z');
const rows: UsageEventRow[] = [
  { organization_id: 'alice', model: 'openai/gpt-6-luna', provider_cost_usd: 0.5, provider_payload: { prompt_tokens: 1000, completion_tokens: 200 }, created_at: '2026-09-25T09:00:00Z' },
  { organization_id: 'alice', model_used: 'moonshotai/kimi-k3', cost_usd: '0.25', created_at: '2026-09-24T09:00:00Z' },
  { organization_id: 'bob', model: 'openai/gpt-6-luna', complete_cost_usd: 1, provider_payload: { prompt_tokens: 50, completion_tokens: 10, reasoning_tokens: 5 }, created_at: '2026-08-30T09:00:00Z' },
];

describe('admin OpenRouter costs', () => {
  it('sums per user, per model and per day from measured usage', () => {
    const costs = aggregateCosts(rows, { days: 3, now });
    expect(costs.totals).toMatchObject({ cost_usd: 1.75, requests: 3, prompt_tokens: 1050, completion_tokens: 215, today_usd: 0.5, month_usd: 0.75 });
    expect(costs.by_user.map(bucket => [bucket.key, bucket.cost_usd])).toEqual([['bob', 1], ['alice', 0.75]]);
    expect(costs.by_model[0]).toMatchObject({ key: 'openai/gpt-6-luna', cost_usd: 1.5, requests: 2 });
    expect(costs.by_day.map(day => day.key)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
    expect(costs.by_day[2].cost_usd).toBe(0.5);
    expect(costs.month_by_user.map(bucket => bucket.key)).toEqual(['alice']);
  });

  it('warns from 80 % of a monthly budget and flags an overrun', () => {
    const costs = aggregateCosts(rows, { days: 30, now });
    const alerts = evaluateCostAlerts([
      { id: 'g', scope: 'global', target_id: null, monthly_budget_usd: 0.9, enabled: true },
      { id: 'a', scope: 'user', target_id: 'alice', monthly_budget_usd: 0.5, enabled: true },
      { id: 'b', scope: 'user', target_id: 'bob', monthly_budget_usd: 0.5, enabled: true },
      { id: 'off', scope: 'global', target_id: null, monthly_budget_usd: 0.01, enabled: false },
    ], { total: costs.totals.month_usd, byUser: costs.month_by_user, byModel: costs.month_by_model });
    expect(alerts.map(alert => [alert.rule_id, alert.level])).toEqual([['a', 'exceeded'], ['g', 'warning']]);
  });
});

describe('margins, hard caps and alert messages', () => {
  it('computes each user margin from settled revenue against every provider cost', async () => {
    const { aggregateMargins } = await import('./admin-costs');
    const margins = aggregateMargins(
      [{ id: 'e1', organization_id: 'alice', provider_cost_usd: 0.1 }, { id: 'e2', organization_id: 'alice', provider_cost_usd: 0.05 }, { id: 'e3', organization_id: 'bob', provider_cost_usd: 0.2 }],
      [{ usage_event_id: 'e1', realized_revenue_usd: 0.5, credits_charged: 2 }, { usage_event_id: 'ghost', realized_revenue_usd: 9 }],
    );
    expect(margins.find(row => row.key === 'alice')).toMatchObject({ revenue_usd: 0.5, cost_usd: 0.15, margin_usd: 0.35, margin_pct: 70, credits_charged: 2 });
    expect(margins[0]).toMatchObject({ key: 'bob', revenue_usd: 0, margin_usd: -0.2, margin_pct: null });
  });

  it('stops paid work only on an enabled hard budget that is reached', async () => {
    const { hardCapReached } = await import('./admin-costs');
    const rules = [
      { id: 'soft', scope: 'user' as const, target_id: 'alice', monthly_budget_usd: 1, enabled: true, hard_limit: false },
      { id: 'hard', scope: 'user' as const, target_id: 'alice', monthly_budget_usd: 5, enabled: true, hard_limit: true },
      { id: 'global', scope: 'global' as const, target_id: null, monthly_budget_usd: 100, enabled: true, hard_limit: true },
    ];
    expect(hardCapReached(rules, 'alice', { account: 4.99, global: 50 })).toBeNull();
    expect(hardCapReached(rules, 'alice', { account: 5, global: 50 })).toMatchObject({ scope: 'user', budget_usd: 5 });
    expect(hardCapReached(rules, 'bob', { account: 99, global: 100 })).toMatchObject({ scope: 'global' });
    expect(hardCapReached(rules.map(rule => ({ ...rule, enabled: false })), 'alice', { account: 99, global: 999 })).toBeNull();
  });

  it('masks addresses sent to outside channels', async () => {
    const { alertMessage, maskEmail } = await import('./admin-costs');
    expect(maskEmail('awa.kone@boutique.ci')).toBe('a***@boutique.ci');
    expect(alertMessage({ rule_id: 'r', scope: 'user', target_id: 'u', budget_usd: 10, spent_usd: 11.4, ratio: 1.14, level: 'exceeded' }, 'a***@boutique.ci')).toBe('Budget OpenRouter dépassé pour l’utilisateur a***@boutique.ci : 11.40 $ dépensés ce mois sur 10.00 $ (114 %).');
  });
});
