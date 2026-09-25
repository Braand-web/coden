/**
 * What OpenRouter costs, per user, per model and per day, and which budgets
 * are exceeded — from the measured usage ledger (`usage_events`), never from
 * estimates. Pure: the admin routes load rows and call these.
 */

export type UsageEventRow = {
  organization_id?: string | null;
  account_id?: string | null;
  model?: string | null;
  model_used?: string | null;
  category?: string | null;
  provider?: string | null;
  provider_cost_usd?: number | string | null;
  complete_cost_usd?: number | string | null;
  cost_usd?: number | string | null;
  provider_payload?: Record<string, unknown> | null;
  created_at?: string | null;
};

export type CostAlertRule = {
  id: string;
  scope: 'global' | 'user' | 'model';
  target_id: string | null;
  monthly_budget_usd: number | string;
  enabled: boolean;
};

export type CostBucket = { key: string; cost_usd: number; requests: number; prompt_tokens: number; completion_tokens: number };

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

export function eventCostUsd(row: UsageEventRow): number {
  for (const value of [row.provider_cost_usd, row.complete_cost_usd, row.cost_usd]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

export function eventTokens(row: UsageEventRow): { prompt: number; completion: number } {
  const payload = row.provider_payload || {};
  const prompt = Number((payload as any).prompt_tokens || 0);
  const completion = Number((payload as any).completion_tokens || 0) + Number((payload as any).reasoning_tokens || 0);
  return { prompt: Number.isFinite(prompt) ? prompt : 0, completion: Number.isFinite(completion) ? completion : 0 };
}

export function eventUser(row: UsageEventRow): string {
  return String(row.organization_id || row.account_id || 'inconnu');
}

export function eventModel(row: UsageEventRow): string {
  return String(row.model || row.model_used || 'inconnu');
}

function bucketize(rows: UsageEventRow[], keyOf: (row: UsageEventRow) => string): CostBucket[] {
  const buckets = new Map<string, CostBucket>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = buckets.get(key) || { key, cost_usd: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0 };
    const tokens = eventTokens(row);
    bucket.cost_usd += eventCostUsd(row);
    bucket.requests += 1;
    bucket.prompt_tokens += tokens.prompt;
    bucket.completion_tokens += tokens.completion;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].map(bucket => ({ ...bucket, cost_usd: round(bucket.cost_usd) })).sort((a, b) => b.cost_usd - a.cost_usd || b.requests - a.requests);
}

export function startOfMonthUtc(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Cost per day over the window, empty days included, oldest first. */
export function costByDay(rows: UsageEventRow[], days: number, now = new Date()): CostBucket[] {
  const byDay = new Map(bucketize(rows, row => String(row.created_at || '').slice(0, 10)).map(bucket => [bucket.key, bucket]));
  const series: CostBucket[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    series.push(byDay.get(key) || { key, cost_usd: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0 });
  }
  return series;
}

export function aggregateCosts(rows: UsageEventRow[], options: { days: number; now?: Date }) {
  const now = options.now || new Date();
  const monthStart = startOfMonthUtc(now);
  const today = now.toISOString().slice(0, 10);
  const month = rows.filter(row => String(row.created_at || '') >= monthStart);
  const total = bucketize(rows, () => 'total')[0] || { key: 'total', cost_usd: 0, requests: 0, prompt_tokens: 0, completion_tokens: 0 };
  return {
    totals: {
      cost_usd: total.cost_usd,
      requests: total.requests,
      prompt_tokens: total.prompt_tokens,
      completion_tokens: total.completion_tokens,
      today_usd: round(rows.filter(row => String(row.created_at || '').startsWith(today)).reduce((sum, row) => sum + eventCostUsd(row), 0)),
      month_usd: round(month.reduce((sum, row) => sum + eventCostUsd(row), 0)),
    },
    by_user: bucketize(rows, eventUser),
    by_model: bucketize(rows, eventModel),
    by_day: costByDay(rows, options.days, now),
    month_by_user: bucketize(month, eventUser),
    month_by_model: bucketize(month, eventModel),
  };
}

export type TriggeredAlert = { rule_id: string; scope: CostAlertRule['scope']; target_id: string | null; budget_usd: number; spent_usd: number; ratio: number; level: 'warning' | 'exceeded' };

/** Month-to-date spend against each enabled budget: warning from 80 %, exceeded from 100 %. */
export function evaluateCostAlerts(rules: CostAlertRule[], month: { total: number; byUser: CostBucket[]; byModel: CostBucket[] }): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const budget = Number(rule.monthly_budget_usd);
    if (!Number.isFinite(budget) || budget <= 0) continue;
    const spent = rule.scope === 'global'
      ? month.total
      : (rule.scope === 'user' ? month.byUser : month.byModel).find(bucket => bucket.key === rule.target_id)?.cost_usd || 0;
    const ratio = spent / budget;
    if (ratio < 0.8) continue;
    triggered.push({ rule_id: rule.id, scope: rule.scope, target_id: rule.target_id, budget_usd: budget, spent_usd: round(spent), ratio: Math.round(ratio * 100) / 100, level: ratio >= 1 ? 'exceeded' : 'warning' });
  }
  return triggered.sort((a, b) => b.ratio - a.ratio);
}
