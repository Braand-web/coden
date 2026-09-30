import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReliabilityReport } from './services/reliability-metrics';

describe('the admin reliability view', () => {
  const source = readFileSync('src/admin-live.ts', 'utf8');
  const server = readFileSync('server.ts', 'utf8');

  it('is fetched with the rest of the admin data and drawn in the runs tab', () => {
    expect(source).toMatch(/safeAdminFetch\('\/api\/admin\/reliability\?days=14'/);
    expect(source).toMatch(/renderReliability\(root\);/);
  });

  it('escapes every value it prints', () => {
    const body = source.slice(source.indexOf('function renderReliability'), source.indexOf('function averageDuration'));
    expect(body).toMatch(/escapeHtml\(row\.key\)/);
    expect(body).toMatch(/escapeHtml\(day\.day\)/);
    expect(body).not.toMatch(/innerHTML = `[^`]*\$\{(?:row|day)\./);
  });

  it('the endpoint is admin-only, never cached, and its alert can be switched off', () => {
    const route = server.slice(server.indexOf("app.get('/api/admin/reliability'"), server.indexOf('/** Something is wrong now'));
    expect(route).toMatch(/requirePlatformAdmin\(req, res\)/);
    expect(route).toMatch(/no-store/);
    expect(server).toMatch(/reliabilityAlertEnabled\(\)/);
  });

  it('the shape the view reads is the one the report produces', () => {
    const report = buildReliabilityReport([], { days: 3 });
    for (const key of ['totals', 'daily', 'duration', 'byModel', 'byAction']) expect(report).toHaveProperty(key);
    for (const key of ['successRate', 'completed', 'failed', 'cancelled']) expect(report.totals).toHaveProperty(key);
  });
});
