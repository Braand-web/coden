/**
 * What the routing trace says about how routing is going.
 *
 * Read-only, computed from `model_routing_events` rows — the numbers the admin
 * dashboard shows and the ones an A/B comparison reads: cost per model,
 * median and 95th-percentile latency, how often a run had to change model and
 * how those runs ended, how often the provider's prompt cache was hit, and the
 * costliest tasks. Nothing here changes routing; changing it is the
 * evolution pipeline's job, and it reads these.
 */

export type RoutingRow = {
  kind: 'initial' | 'supervision' | 'fallback' | 'substitution' | 'summary';
  run_id: string | null;
  task: string | null;
  mode: string | null;
  policy: string | null;
  arm?: string | null;
  from_model: string | null;
  to_model: string;
  signal: string | null;
  action: string | null;
  decision_ms: number | null;
  ok: boolean | null;
  cost_usd: number | null;
  latency_ms: number | null;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  escalations: number | null;
  created_at?: string;
};

const SWITCHING_ACTIONS = new Set(['raise_reasoning', 'escalate_model', 'switch_family', 'specialist', 'deescalate']);

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

const round = (value: number | null, digits = 4) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);
const sum = (values: Array<number | null | undefined>) => values.reduce<number>((total, value) => total + (Number(value) || 0), 0);
const rate = (part: number, whole: number) => (whole > 0 ? round(part / whole, 4) : null);

export type ModelStats = {
  model: string;
  runs: number;
  okRate: number | null;
  costUsdTotal: number;
  costUsdPerRun: number | null;
  latencyMsP50: number | null;
  latencyMsP95: number | null;
  cacheHitRate: number | null;
};

export type RoutingOverview = {
  runs: number;
  okRate: number | null;
  costUsdTotal: number;
  decisionMsP95: number | null;
  models: ModelStats[];
  modes: Array<{ mode: string; runs: number; okRate: number | null; costUsdPerRun: number | null }>;
  arms: Array<{ arm: string; runs: number; okRate: number | null; costUsdPerRun: number | null; escalationsPerRun: number | null }>;
  /** Share of runs that changed model or effort at least once, and how those runs ended. */
  switching: { runsWithSwitch: number; switchRate: number | null; okRateAfterSwitch: number | null; okRateWithoutSwitch: number | null };
  fallbacks: { count: number; perRun: number | null; byReason: Array<{ reason: string; count: number }> };
  supervisorActions: Array<{ action: string; count: number }>;
  costliestRuns: Array<{ runId: string | null; task: string | null; model: string; costUsd: number; latencyMs: number | null; ok: boolean | null }>;
};

export function aggregateRoutingEvents(rows: RoutingRow[]): RoutingOverview {
  const summaries = rows.filter(row => row.kind === 'summary');
  const initials = new Map(rows.filter(row => row.kind === 'initial' && row.run_id).map(row => [row.run_id!, row]));
  const switchRuns = new Set(rows.filter(row => row.kind === 'supervision' && row.action && SWITCHING_ACTIONS.has(row.action) && row.run_id).map(row => row.run_id!));
  const fallbackRows = rows.filter(row => row.kind === 'fallback');

  const byModel = new Map<string, RoutingRow[]>();
  for (const row of summaries) byModel.set(row.to_model, [...(byModel.get(row.to_model) || []), row]);
  const models: ModelStats[] = [...byModel.entries()].map(([model, items]) => ({
    model,
    runs: items.length,
    okRate: rate(items.filter(item => item.ok).length, items.length),
    costUsdTotal: round(sum(items.map(item => item.cost_usd)), 4)!,
    costUsdPerRun: items.length ? round(sum(items.map(item => item.cost_usd)) / items.length, 4) : null,
    latencyMsP50: percentile(items.map(item => Number(item.latency_ms)), 50),
    latencyMsP95: percentile(items.map(item => Number(item.latency_ms)), 95),
    cacheHitRate: rate(sum(items.map(item => item.cached_tokens)), sum(items.map(item => item.prompt_tokens))),
  })).sort((a, b) => b.costUsdTotal - a.costUsdTotal);

  const groupBy = <T extends string>(key: (row: RoutingRow) => T | null | undefined) => {
    const groups = new Map<T, RoutingRow[]>();
    for (const row of summaries) {
      const value = key(row);
      if (value) groups.set(value, [...(groups.get(value) || []), row]);
    }
    return groups;
  };
  // A run's mode and arm are decided at its start: read them from its first decision.
  const modes = [...groupBy(row => (initials.get(row.run_id || '')?.mode || row.mode) as string).entries()].map(([mode, items]) => ({
    mode, runs: items.length, okRate: rate(items.filter(item => item.ok).length, items.length), costUsdPerRun: items.length ? round(sum(items.map(item => item.cost_usd)) / items.length, 4) : null,
  }));
  const arms = [...groupBy(row => (initials.get(row.run_id || '')?.arm || row.arm) as string).entries()].map(([arm, items]) => ({
    arm, runs: items.length, okRate: rate(items.filter(item => item.ok).length, items.length), costUsdPerRun: items.length ? round(sum(items.map(item => item.cost_usd)) / items.length, 4) : null,
    escalationsPerRun: items.length ? round(sum(items.map(item => item.escalations)) / items.length, 3) : null,
  }));

  const switched = summaries.filter(row => row.run_id && switchRuns.has(row.run_id));
  const unswitched = summaries.filter(row => !row.run_id || !switchRuns.has(row.run_id));
  const reasons = new Map<string, number>();
  for (const row of fallbackRows) reasons.set(row.signal || row.action || 'unknown', (reasons.get(row.signal || row.action || 'unknown') || 0) + 1);
  const actions = new Map<string, number>();
  for (const row of rows.filter(item => item.kind === 'supervision' && item.action)) actions.set(row.action!, (actions.get(row.action!) || 0) + 1);

  return {
    runs: summaries.length,
    okRate: rate(summaries.filter(row => row.ok).length, summaries.length),
    costUsdTotal: round(sum(summaries.map(row => row.cost_usd)), 4)!,
    decisionMsP95: percentile(rows.filter(row => row.kind === 'initial').map(row => Number(row.decision_ms)), 95),
    models,
    modes,
    arms,
    switching: {
      runsWithSwitch: switched.length,
      switchRate: rate(switched.length, summaries.length),
      okRateAfterSwitch: rate(switched.filter(row => row.ok).length, switched.length),
      okRateWithoutSwitch: rate(unswitched.filter(row => row.ok).length, unswitched.length),
    },
    fallbacks: {
      count: fallbackRows.length,
      perRun: summaries.length ? round(fallbackRows.length / summaries.length, 3) : null,
      byReason: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    },
    supervisorActions: [...actions.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count),
    costliestRuns: [...summaries].sort((a, b) => (Number(b.cost_usd) || 0) - (Number(a.cost_usd) || 0)).slice(0, 5)
      .map(row => ({ runId: row.run_id, task: row.task, model: row.to_model, costUsd: round(Number(row.cost_usd) || 0, 4)!, latencyMs: row.latency_ms, ok: row.ok })),
  };
}
