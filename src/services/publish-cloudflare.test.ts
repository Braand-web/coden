import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployDirectory, ensurePagesProject, pagesProjectFromDeploymentUrl, removePagesPublication, upsertCnameOnCodenFun, verifyCloudflareDeployment, type PublishResult } from './publish-cloudflare.ts';
import { cloudflareDeploymentVersions, cloudflareWorkerNameForSlug } from './publish-cloudflare-workers.ts';

const result: PublishResult = {
  provider: 'cloudflare-workers',
  runtime: 'static-assets',
  cfName: 'coden-demo',
  subdomain: 'demo.coden.fun',
  defaultUrl: 'https://demo.coden.fun',
  codenUrl: 'https://demo.coden.fun',
  deploymentId: 'deployment-1',
  deploymentUrl: 'https://demo.coden.fun',
};

describe('Cloudflare deployment verification', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('only probes the Coden domain and ignores network-path routes', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('ok'));
    await verifyCloudflareDeployment({...result, deploymentUrl:'https://provider.pages.dev'}, ['//evil.test', '/\\evil.test'], fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://demo.coden.fun/');
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('manual');
  });
  it('rejects a public URL outside Coden before fetching', async () => {
    const fetchMock = vi.fn();
    await expect(verifyCloudflareDeployment({...result, codenUrl:'https://evil.test'}, ['/'], fetchMock)).rejects.toThrow('Invalid Coden');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uploads assets with the JWT and the Pages array payload', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account');
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'server-token');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-upload-test-'));
    fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Hello</h1>');
    fs.writeFileSync(path.join(directory, '_headers'), '/*\n  X-Test: preserved\n');
    fs.writeFileSync(path.join(directory, '_redirects'), '/old / 301\n');
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/upload-token')) return Response.json({success:true,result:{jwt:'upload-jwt'}});
      if (url.endsWith('/check-missing')) {
        expect((init?.headers as any).Authorization).toBe('Bearer upload-jwt');
        return Response.json({success:true,result:JSON.parse(String(init?.body)).hashes});
      }
      if (url.endsWith('/assets/upload')) {
        const batch = JSON.parse(String(init?.body));
        expect(Array.isArray(batch)).toBe(true);
        expect(batch[0].key).toMatch(/^[a-f0-9]{32}$/);
        expect(batch[0].base64).toBe(true);
        return Response.json({success:true,result:{}});
      }
      if (url.endsWith('/deployments')) {
        const form = init?.body as FormData;
        expect(JSON.parse(String(form.get('manifest')))).not.toHaveProperty('/_headers');
        expect(await (form.get('_headers') as Blob).text()).toContain('X-Test: preserved');
        expect(await (form.get('_redirects') as Blob).text()).toContain('/old / 301');
      }
      return Response.json({success:true,result:{id:'release',url:'https://release.pages.dev',latest_stage:{status:'success'}}});
    });
    vi.stubGlobal('fetch', fetchMock);
    try { expect(await deployDirectory('coden-demo', directory)).toEqual({id:'release',url:'https://release.pages.dev'}); }
    finally { fs.rmSync(directory, {recursive:true,force:true}); }
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/assets/upsert-hashes'))).toBe(true);
  });
  it('requires every selected route to answer successfully', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch;
    const verification = await verifyCloudflareDeployment(result, ['/', '/pricing'], fetchMock);
    expect(verification.verified).toBe(true);
    expect(verification.checks).toHaveLength(2);
  });

  it('does not accept a failed deployment check', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('error', { status: 503 })) as unknown as typeof fetch;
    const promise = verifyCloudflareDeployment(result, ['/'], fetchMock);
    await vi.runAllTimersAsync();
    const verification = await promise;
    expect(verification.verified).toBe(false);
    vi.useRealTimers();
  });
});

describe('Pages ownership and provider responses', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('creates a missing project for Cloudflare HTTP 400/code 8000007, not on access denial', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account'); vi.stubEnv('CLOUDFLARE_API_TOKEN', 'server-token');
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? Response.json({success: true, result: {name: 'coden-new', subdomain: 'coden-new.pages.dev'}})
      : Response.json({success: false, errors: [{code: 8000007, message: 'not found'}]}, {status: 400}));
    vi.stubGlobal('fetch', fetcher);
    expect(await ensurePagesProject('coden-new')).toMatchObject({name: 'coden-new'});
    fetcher.mockImplementation(async () => Response.json({success: false, errors: [{code: 10000, message: 'denied'}]}, {status: 403}));
    fetcher.mockClear();
    await expect(ensurePagesProject('coden-other')).rejects.toThrow('denied');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('does not overwrite unrelated DNS, and unpublishes only its own matching CNAME', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'account'); vi.stubEnv('CLOUDFLARE_API_TOKEN', 'server-token'); vi.stubEnv('CLOUDFLARE_ZONE_ID_CODEN_FUN', 'zone');
    const fetcher = vi.fn(async (url: string) => Response.json({success: true, result: url.includes('dns_records?') ? [{id: 'unrelated', type: 'TXT', content: 'keep-me'}, {id: 'ours', type: 'CNAME', content: 'coden-test.pages.dev'}] : {}}));
    vi.stubGlobal('fetch', fetcher);
    await expect(upsertCnameOnCodenFun('test', 'coden-test.pages.dev')).rejects.toThrow('DNS_CONFLICT');
    expect(fetcher).toHaveBeenCalledOnce();
    fetcher.mockClear();
    await removePagesPublication('coden-test', 'test');
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/dns_records/ours'))).toBe(true);
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/dns_records/unrelated'))).toBe(false);
  });
  it('loads the provider identity only from a Coden Pages URL', () => {
    expect(pagesProjectFromDeploymentUrl('https://abc.coden-test.pages.dev/')).toBe('coden-test');
    for (const url of ['https://evil.test/', 'http://coden-test.pages.dev', 'https://user:pass@coden-test.pages.dev', 'https://other.pages.dev']) expect(() => pagesProjectFromDeploymentUrl(url)).toThrow();
  });
});

describe('Cloudflare Worker release identity', () => {
  it('uses one deterministic worker name for publish, domains and rollback', () => {
    expect(cloudflareWorkerNameForSlug('My Project / Demo')).toBe('coden-my-project-demo');
    expect(cloudflareWorkerNameForSlug('x'.repeat(100))).toHaveLength(57);
  });

  it('preserves the exact version weights of a historical deployment', () => {
    expect(cloudflareDeploymentVersions({
      versions: [
        { version_id: 'version-a', percentage: 90 },
        { version_id: 'version-b', percentage: 10 },
        { version_id: '', percentage: 100 },
      ],
    })).toEqual([
      { version_id: 'version-a', percentage: 90 },
      { version_id: 'version-b', percentage: 10 },
    ]);
  });
});
