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

export type SettlementRow = {
  usage_event_id?: string | null;
  credits_charged?: number | string | null;
  realized_revenue_usd?: number | string | null;
  complete_cost_usd?: number | string | null;
};

export type MarginBucket = { key: string; revenue_usd: number; cost_usd: number; margin_usd: number; margin_pct: number | null; credits_charged: number };

/**
 * Revenue against cost, per user: what the settled credits brought in
 * (`usage_settlements.realized_revenue_usd`) against everything the provider
 * charged for that user — settled or not, since a failed run that was never
 * billed still cost money.
 */
export function aggregateMargins(events: Array<UsageEventRow & { id?: string | null }>, settlements: SettlementRow[]): MarginBucket[] {
  const ownerOf = new Map<string, string>();
  const buckets = new Map<string, MarginBucket>();
  const bucket = (key: string) => {
    let entry = buckets.get(key);
    if (!entry) { entry = { key, revenue_usd: 0, cost_usd: 0, margin_usd: 0, margin_pct: null, credits_charged: 0 }; buckets.set(key, entry); }
    return entry;
  };
  for (const event of events) {
    const owner = eventUser(event);
    if (event.id) ownerOf.set(String(event.id), owner);
    bucket(owner).cost_usd += eventCostUsd(event);
  }
  for (const settlement of settlements) {
    const owner = settlement.usage_event_id ? ownerOf.get(String(settlement.usage_event_id)) : undefined;
    if (!owner) continue;
    const entry = bucket(owner);
    entry.revenue_usd += Math.max(0, Number(settlement.realized_revenue_usd || 0));
    entry.credits_charged += Math.max(0, Number(settlement.credits_charged || 0));
  }
  return [...buckets.values()].map(entry => {
    const margin = entry.revenue_usd - entry.cost_usd;
    return {
      ...entry,
      revenue_usd: round(entry.revenue_usd),
      cost_usd: round(entry.cost_usd),
      credits_charged: round(entry.credits_charged, 2),
      margin_usd: round(margin),
      margin_pct: entry.revenue_usd > 0 ? Math.round((margin / entry.revenue_usd) * 1000) / 10 : null,
    };
  }).sort((a, b) => a.margin_usd - b.margin_usd);
}

export type HardCapRule = CostAlertRule & { hard_limit?: boolean };

/**
 * Whether paid work must stop for this account: an enabled hard budget on
 * the user, or on the whole platform, is reached for the current month.
 */
export function hardCapReached(rules: HardCapRule[], accountId: string, spend: { account: number; global: number }): { scope: 'user' | 'global'; budget_usd: number; spent_usd: number } | null {
  for (const rule of rules) {
    if (!rule.enabled || !rule.hard_limit) continue;
    const budget = Number(rule.monthly_budget_usd);
    if (!Number.isFinite(budget) || budget <= 0) continue;
    if (rule.scope === 'user' && rule.target_id === accountId && spend.account >= budget) return { scope: 'user', budget_usd: budget, spent_usd: round(spend.account) };
    if (rule.scope === 'global' && spend.global >= budget) return { scope: 'global', budget_usd: budget, spent_usd: round(spend.global) };
  }
  return null;
}

/** An address shown to a third-party channel keeps its domain and its first letter only. */
export function maskEmail(email: string | null | undefined): string {
  const text = String(email || '');
  const at = text.indexOf('@');
  if (at < 1) return text ? `${text.slice(0, 1)}***` : 'utilisateur inconnu';
  return `${text.slice(0, 1)}***${text.slice(at)}`;
}

export function alertMessage(alert: TriggeredAlert, label: string): string {
  const percent = Math.round(alert.ratio * 100);
  const head = alert.level === 'exceeded' ? 'Budget OpenRouter dépassé' : 'Budget OpenRouter bientôt atteint';
  const scope = alert.scope === 'global' ? 'toute la plateforme' : alert.scope === 'user' ? `l’utilisateur ${label}` : `le modèle ${label}`;
  return `${head} pour ${scope} : ${alert.spent_usd.toFixed(2)} $ dépensés ce mois sur ${alert.budget_usd.toFixed(2)} $ (${percent} %).`;
}
