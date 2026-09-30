import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aggregateRoutingEvents } from './services/routing-stats';

describe('the admin routing view', () => {
  const source = readFileSync('src/admin-live.ts', 'utf8');

  it('reads the routing overview with the rest of the admin data and renders it in the models tab', () => {
    expect(source).toMatch(/safeAdminFetch\('\/api\/admin\/routing\/overview\?days=7'/);
    expect(source).toMatch(/renderRoutingOverview\(root\);/);
  });

  it('escapes every value it prints', () => {
    const body = source.slice(source.indexOf('function renderRoutingOverview'), source.indexOf('function renderModels'));
    expect(body).toMatch(/escapeHtml\(row\.model\)/);
    expect(body).toMatch(/escapeHtml\(label\(row\)\)/);
    expect(body).not.toMatch(/innerHTML = `[^`]*\$\{row\./);
  });

  it('the shape it reads is the one the aggregation produces', () => {
    const overview = aggregateRoutingEvents([
      { kind: 'initial', run_id: 'r1', to_model: 'm/a', task: 'code_generation', mode: 'balanced', policy: 'scored', arm: 'control' } as any,
      { kind: 'summary', run_id: 'r1', to_model: 'm/a', ok: true, cost_usd: 0.12, latency_ms: 42_000, prompt_tokens: 1000, cached_tokens: 400, mode: 'balanced', arm: 'control' } as any,
    ]);
    for (const key of ['runs', 'okRate', 'costUsdTotal', 'decisionMsP95', 'models', 'modes', 'arms', 'switching', 'fallbacks', 'supervisorActions', 'costliestRuns']) expect(overview).toHaveProperty(key);
    expect(overview.models[0]).toMatchObject({ model: 'm/a', runs: 1, okRate: 1 });
    for (const key of ['switchRate', 'okRateAfterSwitch', 'okRateWithoutSwitch']) expect(overview.switching).toHaveProperty(key);
  });
});
