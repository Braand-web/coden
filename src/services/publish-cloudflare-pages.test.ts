import { describe, expect, it, vi } from 'vitest';
import { publishProviderChoice, publishStaticAppToCloudflarePages, upgradeToCodenAddress, type CloudflarePagesDeps } from './publish-cloudflare-pages.ts';

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
