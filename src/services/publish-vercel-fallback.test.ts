import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateVercelPublication, type VercelPublishResult } from './publish-vercel.ts';

const staged: VercelPublishResult = {
  provider: 'vercel', runtime: 'static-assets', projectName: 'coden-mon-app', projectId: 'prj_1', defaultUrl: 'https://staged.vercel.app',
  codenUrl: null, deploymentId: 'dpl_staged', deploymentUrl: 'https://staged.vercel.app', customDomain: null, customDomainVerified: false, customDomainVerification: [],
};

const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });

describe('activating a verified deployment', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('redeploys the same artifact as production when Vercel refuses to promote it', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: Array<{ method: string; url: string; body: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
      const url = String(input);
      const method = String(init.method || 'GET');
      calls.push({ method, url, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
      if (url.includes('/promote/')) return json(422, { error: { message: 'Resource cannot be processed.' } });
      if (method === 'POST' && /\/v13\/deployments(\?|$)/.test(url)) return json(200, { id: 'dpl_prod', url: 'prod.vercel.app' });
      if (url.includes('/v13/deployments/dpl_prod')) return json(200, { id: 'dpl_prod', url: 'prod.vercel.app', readyState: 'READY', projectId: 'prj_1' });
      if (url.includes('/domains')) return json(200, { verified: true, verification: [] });
      return json(200, {});
    }));
    const activated = await activateVercelPublication(staged, 'mon-app');
    const redeploy = calls.find(call => call.method === 'POST' && /\/v13\/deployments(\?|$)/.test(call.url));
    expect(redeploy?.body).toMatchObject({ name: 'coden-mon-app', deploymentId: 'dpl_staged', target: 'production' });
    expect(activated.deploymentId).toBe('dpl_prod');
    expect(activated.deploymentUrl).toBe('https://prod.vercel.app');
  });

  it('keeps the promoted deployment when promotion works', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'test-token');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init: any = {}) => {
      const url = String(input);
      calls.push(`${init.method || 'GET'} ${url}`);
      if (url.includes('/domains')) return json(200, { verified: true, verification: [] });
      return json(200, {});
    }));
    const activated = await activateVercelPublication(staged, 'mon-app');
    expect(activated.deploymentId).toBe('dpl_staged');
    expect(calls.some(call => /POST .*\/v13\/deployments(\?|$)/.test(call))).toBe(false);
  });
});
