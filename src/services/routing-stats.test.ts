import { describe, expect, it } from 'vitest';
import { aggregateRoutingEvents, percentile, type RoutingRow } from './routing-stats';

const row = (patch: Partial<RoutingRow>): RoutingRow => ({
  kind: 'summary', run_id: null, task: 'code_generation', mode: 'balanced', policy: 'scored', from_model: null, to_model: 'openai/gpt-6-luna',
  signal: null, action: null, decision_ms: null, ok: true, cost_usd: 0.1, latency_ms: 10_000, prompt_tokens: 1_000, cached_tokens: 0, escalations: 0, ...patch,
});

describe('routing statistics', () => {
  it('computes percentiles the way a dashboard expects', () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 50)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95)).toBe(100);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
  });

  it('reports cost, latency, success and cache hits per model', () => {
    const overview = aggregateRoutingEvents([
      row({ run_id: 'a', cost_usd: 0.2, latency_ms: 8_000, cached_tokens: 600, prompt_tokens: 1_000 }),
      row({ run_id: 'b', cost_usd: 0.4, latency_ms: 20_000, cached_tokens: 200, prompt_tokens: 1_000, ok: false }),
      row({ run_id: 'c', to_model: 'anthropic/claude-sonnet-5', cost_usd: 1.5, latency_ms: 30_000 }),
    ]);
    expect(overview.runs).toBe(3);
    expect(overview.costUsdTotal).toBeCloseTo(2.1, 4);
    const luna = overview.models.find(model => model.model === 'openai/gpt-6-luna')!;
    expect(luna).toMatchObject({ runs: 2, okRate: 0.5, costUsdPerRun: 0.3, latencyMsP50: 8_000, latencyMsP95: 20_000, cacheHitRate: 0.4 });
    // Sorted by what costs the most.
    expect(overview.models[0].model).toBe('anthropic/claude-sonnet-5');
    expect(overview.costliestRuns[0]).toMatchObject({ runId: 'c', costUsd: 1.5 });
  });

  it('measures how often a run changed model and how those runs ended', () => {
    const overview = aggregateRoutingEvents([
      row({ run_id: 'switched', ok: true }),
      row({ run_id: 'switched2', ok: false }),
      row({ run_id: 'plain1', ok: true }),
      row({ run_id: 'plain2', ok: true }),
      row({ kind: 'supervision', run_id: 'switched', action: 'escalate_model', signal: 'no_progress' }),
      row({ kind: 'supervision', run_id: 'switched2', action: 'switch_family', signal: 'provider_failure' }),
      // A correction is not a switch.
      row({ kind: 'supervision', run_id: 'plain1', action: 'retry_with_correction', signal: 'no_progress' }),
    ]);
    expect(overview.switching).toEqual({ runsWithSwitch: 2, switchRate: 0.5, okRateAfterSwitch: 0.5, okRateWithoutSwitch: 1 });
    expect(overview.supervisorActions.map(item => item.action).sort()).toEqual(['escalate_model', 'retry_with_correction', 'switch_family']);
  });

  it('counts gateway fallbacks per run and by reason', () => {
    const overview = aggregateRoutingEvents([
      row({ run_id: 'a' }), row({ run_id: 'b' }),
      row({ kind: 'fallback', run_id: 'a', signal: 'provider_failure', action: 'switch_family' }),
      row({ kind: 'fallback', run_id: 'b', signal: 'PROVIDER_TIMEOUT' }),
      row({ kind: 'fallback', run_id: 'b', signal: 'provider_failure' }),
    ]);
    expect(overview.fallbacks.count).toBe(3);
    expect(overview.fallbacks.perRun).toBe(1.5);
    expect(overview.fallbacks.byReason[0]).toEqual({ reason: 'provider_failure', count: 2 });
  });

  it('splits runs by the mode and the experiment arm they started in', () => {
    const overview = aggregateRoutingEvents([
      row({ kind: 'initial', run_id: 'a', mode: 'economy', arm: 'control', decision_ms: 3 }),
      row({ kind: 'initial', run_id: 'b', mode: 'performance', arm: 'treatment', decision_ms: 9 }),
      row({ run_id: 'a', cost_usd: 0.05, escalations: 0, mode: null }),
      row({ run_id: 'b', cost_usd: 0.6, escalations: 2, mode: null }),
    ]);
    expect(overview.modes.find(item => item.mode === 'economy')).toMatchObject({ runs: 1, costUsdPerRun: 0.05 });
    expect(overview.modes.find(item => item.mode === 'performance')).toMatchObject({ runs: 1, costUsdPerRun: 0.6 });
    expect(overview.arms.find(item => item.arm === 'treatment')).toMatchObject({ runs: 1, escalationsPerRun: 2 });
    expect(overview.decisionMsP95).toBe(9);
  });

  it('is empty and calm on no data', () => {
    const overview = aggregateRoutingEvents([]);
    expect(overview).toMatchObject({ runs: 0, okRate: null, models: [], costliestRuns: [] });
    expect(overview.switching.switchRate).toBeNull();
  });
});
