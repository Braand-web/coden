import { describe, expect, it, vi } from 'vitest';
import { cloudflareConfigurationDiagnostic, cloudflarePublicationSlug, publicationHostingConfigured, malformedCloudflareSettings, missingCloudflareSettings, redactCloudflareCredentials, publishProviderChoice, publishStaticAppToCloudflarePages, upgradeToCodenAddress, type CloudflarePagesDeps } from './publish-cloudflare-pages.ts';

const ok = { verified: true, baseUrl: 'x', checks: [] };
const ko = { verified: false, baseUrl: '', checks: [{ url: 'https://x.pages.dev/', status: 404, ok: false, error: 'HTTP 404' }] };

const makeDeps = (overrides: Partial<CloudflarePagesDeps> = {}): CloudflarePagesDeps => ({
  ensureProject: vi.fn(async (name: string) => ({ name, subdomain: `${name}.pages.dev` })),
  deploy: vi.fn(async () => ({ id: 'dep_1', url: 'https://abc.coden-mon-app.pages.dev' })),
  attachDomain: vi.fn(async () => undefined),
  upsertCname: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
  verify: vi.fn(async () => ok),
  wait: vi.fn(async () => undefined),
  ...overrides,
});

const params = { slug: 'mon-app', distDir: '/tmp/dist', publicRoutes: ['/'] };

describe('publishing a static app on Cloudflare Pages', () => {
  it('gives the Coden address when it already answers', async () => {
    const deps = makeDeps();
    const phases: string[] = [];
    const result = await publishStaticAppToCloudflarePages({ ...params, onPhase: phase => phases.push(phase) }, deps);
    expect(result).toMatchObject({ provider: 'cloudflare-pages', projectName: 'coden-mon-app', deploymentId: 'dep_1', publicUrl: 'https://mon-app.coden.fun', customDomain: 'mon-app.coden.fun' });
    expect(deps.attachDomain).toHaveBeenCalledWith('coden-mon-app', 'mon-app.coden.fun');
    expect(deps.upsertCname).toHaveBeenCalledWith('mon-app', 'coden-mon-app.pages.dev');
    expect(phases).toEqual(expect.arrayContaining(['cloudflare_deployed', 'verified', 'domain_attached', 'coden_address_live']));
  });

  it('records the deployment before verifying it', async () => {
    const order: string[] = [];
    const deps = makeDeps({ verify: vi.fn(async () => { order.push('verify'); return ok; }) });
    await publishStaticAppToCloudflarePages({ ...params, onDeployed: async () => { order.push('recorded'); } }, deps);
    expect(order[0]).toBe('recorded');
  });

  it('restores the previous live version when saving the candidate fails', async () => {
    const deps = makeDeps();
    await expect(publishStaticAppToCloudflarePages({ ...params, previousDeploymentId: 'dep_0', onDeployed: async () => { throw new Error('database unavailable'); } }, deps)).rejects.toThrow('database unavailable');
    expect(deps.rollback).toHaveBeenCalledWith('coden-mon-app', 'dep_0');
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it('falls back to the pages.dev address, without failing, when the Coden address does not answer yet', async () => {
    const verify = vi.fn(async (targets: any) => (targets.codenUrl ? ko : ok));
    const result = await publishStaticAppToCloudflarePages(params, makeDeps({ verify }));
    expect(result.publicUrl).toBe('https://coden-mon-app.pages.dev');
    expect(result.codenUrl).toBeNull();
    expect(result.customDomain).toBeNull();
  });

  it('does not fail a live site because the domain could not be attached', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await publishStaticAppToCloudflarePages(params, makeDeps({ attachDomain: vi.fn(async () => { throw new Error('zone not found'); }) }));
    expect(result.publicUrl).toBe('https://coden-mon-app.pages.dev');
  });

  it('puts the previous deployment back and fails when the new one does not answer', async () => {
    const deps = makeDeps({ verify: vi.fn(async () => ko) });
    await expect(publishStaticAppToCloudflarePages({ ...params, previousDeploymentId: 'dep_0' }, deps)).rejects.toThrow(/deployment could not be verified \(.*404/);
    expect(deps.rollback).toHaveBeenCalledWith('coden-mon-app', 'dep_0');
    expect(deps.attachDomain).not.toHaveBeenCalled();
  });

  it('fails without a rollback on a first publication', async () => {
    const deps = makeDeps({ verify: vi.fn(async () => ko) });
    await expect(publishStaticAppToCloudflarePages(params, deps)).rejects.toThrow(/could not be verified/);
    expect(deps.rollback).not.toHaveBeenCalled();
  });
});

describe('the Coden address upgrade and the provider choice', () => {
  it('returns the Coden address only when it answers', async () => {
    expect(await upgradeToCodenAddress('mon-app', ['/'], { verify: async () => ok })).toBe('https://mon-app.coden.fun');
    expect(await upgradeToCodenAddress('mon-app', ['/'], { verify: async () => ko })).toBeNull();
  });

  it('hosts on Cloudflare unless the variable explicitly asks for Vercel', () => {
    expect(publishProviderChoice({})).toBe('cloudflare');
    expect(publishProviderChoice({ CODEN_PUBLISH_PROVIDER: 'cloudflare' })).toBe('cloudflare');
    expect(publishProviderChoice({ CODEN_PUBLISH_PROVIDER: 'vercel' })).toBe('vercel');
    expect(publishProviderChoice({ CODEN_PUBLISH_PROVIDER: 'nonsense' })).toBe('cloudflare');
  });
});

describe('Cloudflare settings', () => {
  it('uses globally unique stable app identities, not owner-scoped project names', () => {
    const a = cloudflarePublicationSlug('11111111-1111-4111-8111-111111111111');
    const b = cloudflarePublicationSlug('22222222-2222-4222-8222-222222222222');
    expect(a).not.toBe(b); expect(a.length).toBeLessThan(53);
    expect(() => cloudflarePublicationSlug('../other')).toThrow();
  });
  it('requires Cloudflare and production isolation, not Vercel, for the publish button', () => {
    const env = { NODE_ENV: 'production', E2B_API_KEY: 'isolated', CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_ZONE_ID_CODEN_FUN: 'b'.repeat(32), CLOUDFLARE_API_TOKEN: 'x'.repeat(40) };
    expect(publicationHostingConfigured(env)).toBe(true);
    expect(publicationHostingConfigured({ ...env, E2B_API_KEY: '' })).toBe(false);
    expect(publicationHostingConfigured({ ...env, CLOUDFLARE_API_TOKEN: '' })).toBe(false);
    expect(publicationHostingConfigured({ CODEN_PUBLISH_PROVIDER: 'vercel', VERCEL_TOKEN: 'existing' })).toBe(true);
  });
  it('checks the immutable deployment alone before looking at production', async () => {
    const deps = makeDeps();
    await publishStaticAppToCloudflarePages(params, deps);
    expect(deps.verify).toHaveBeenNthCalledWith(1, expect.objectContaining({ defaultUrl: '', deploymentUrl: 'https://abc.coden-mon-app.pages.dev' }), ['/']);
    expect(deps.verify).toHaveBeenNthCalledWith(2, expect.objectContaining({ defaultUrl: 'https://coden-mon-app.pages.dev', deploymentUrl: '' }), ['/']);
  });
  it('names the missing settings without reading their values', () => {
    expect(missingCloudflareSettings({})).toEqual(['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID_CODEN_FUN']);
    expect(missingCloudflareSettings({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: ' ', CLOUDFLARE_ZONE_ID_CODEN_FUN: 'z' })).toEqual(['CLOUDFLARE_API_TOKEN']);
    expect(missingCloudflareSettings({ CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ZONE_ID_CODEN_FUN: 'z' })).toEqual([]);
  });

  it('reports a missing Cloudflare setting as such, not as a Vercel one', () => {
    expect(cloudflareConfigurationDiagnostic('Missing environment variable CLOUDFLARE_ACCOUNT_ID')).toMatchObject({ diagnostic_code: 'CLOUDFLARE_NOT_CONFIGURED', status: 503 });
    expect(cloudflareConfigurationDiagnostic('Missing VERCEL_TOKEN')).toBeNull();
  });
});

describe('a Cloudflare setting that is present but wrong', () => {
  const good = { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_ZONE_ID_CODEN_FUN: 'b'.repeat(32), CLOUDFLARE_API_TOKEN: 'cfut_' + 'x'.repeat(40) };

  it('accepts well-formed settings', () => {
    expect(malformedCloudflareSettings(good)).toEqual([]);
  });

  it('flags a token pasted together with the whole curl test command', () => {
    const pasted = 'curl "https://api.cloudflare.com/client/v4/user/tokens/verify" \\\n  -H "Authorization: Bearer cfut_' + 'x'.repeat(40) + '"';
    expect(malformedCloudflareSettings({ ...good, CLOUDFLARE_API_TOKEN: pasted })).toEqual(['CLOUDFLARE_API_TOKEN']);
  });

  it('flags ids of the wrong shape, and ignores absent ones (reported as missing instead)', () => {
    expect(malformedCloudflareSettings({ ...good, CLOUDFLARE_ACCOUNT_ID: 'not-an-id' })).toEqual(['CLOUDFLARE_ACCOUNT_ID']);
    expect(malformedCloudflareSettings({ ...good, CLOUDFLARE_ZONE_ID_CODEN_FUN: '' })).toEqual([]);
  });

  it('removes credentials from any text before it is logged', () => {
    const text = 'Headers.append: "Bearer cfut_' + 'k'.repeat(40) + '" is an invalid header value; also cfut_' + 'z'.repeat(30);
    const clean = redactCloudflareCredentials(text);
    expect(clean).not.toMatch(/cfut_[A-Za-z0-9]{10,}/);
    expect(clean).toContain('[redacted]');
  });
});

describe('the Cloudflare access report', () => {
  it('tells which right is missing without exposing any value', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'a'.repeat(32));
    vi.stubEnv('CLOUDFLARE_ZONE_ID_CODEN_FUN', 'b'.repeat(32));
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'cfut_' + 'x'.repeat(40));
    vi.stubGlobal('fetch', vi.fn(async (input: any) => {
      const url = String(input);
      const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/user/tokens/verify')) return answer(200, { success: true, result: { id: 't', status: 'active' } });
      if (url.includes('/pages/projects')) return answer(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] });
      if (url.includes('/dns_records')) return answer(200, { success: true, result: [] });
      return answer(200, { success: true, result: { id: 'z' } });
    }));
    const { cloudflareAccessReport } = await import('./publish-cloudflare.ts');
    const report = await cloudflareAccessReport();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    expect(report).toEqual({ token: 'ok', pages: '403 (code 10000)', zone: 'ok', dns: 'ok' });
    expect(JSON.stringify(report)).not.toContain('cfut_');
  });
});
