import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { monetizationEnabled } from './product-access';

describe('production credit enforcement', () => {
  it.each([undefined, '0', '1', 'false', ''])('enforces production quotas with flag %s', flag => {
    expect(monetizationEnabled({ NODE_ENV: 'production', CODEN_MONETIZATION_V2_ENABLED: flag })).toBe(true);
  });
  it('recognizes Railway production even without NODE_ENV', () => {
    expect(monetizationEnabled({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true);
    expect(monetizationEnabled({ RAILWAY_ENVIRONMENT_NAME: 'Production', CODEN_MONETIZATION_V2_ENABLED: '0' })).toBe(true);
  });
  it('retains explicit local metering and test shadow mode', () => {
    expect(monetizationEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(monetizationEnabled({ NODE_ENV: 'development', CODEN_MONETIZATION_V2_ENABLED: '1' })).toBe(true);
  });
  it('does not authorize model access from the customer-supplied plan', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const route = server.slice(server.indexOf("app.post('/api/projects/:id/messages'"));
    const routing = route.slice(0, route.indexOf('const targetModel'));
    expect(routing).toContain('await getOrganizationPlan(orgId)');
    expect(routing).not.toContain('req.body.plan');
    expect(server).toContain('const FALLBACK_WALLET_CREDITS = 0;');
    expect(server).toContain('billing_mode: CODEN_PUBLIC_ACCESS.key');
  });
  it('never downgrades an existing workspace when creating or resuming a project', () => {
    const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const bootstrap = server.slice(server.indexOf('async function ensurePersonalOrganization('), server.indexOf('type ProjectRole'));
    expect(bootstrap).toContain("{ onConflict: 'id', ignoreDuplicates: true }");
  });
});
