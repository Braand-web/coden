import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployDirectory, verifyCloudflareDeployment, type PublishResult } from './publish-cloudflare.ts';
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
      return Response.json({success:true,result:{id:'release',url:'https://release.pages.dev',latest_stage:{status:'success'}}});
    });
    vi.stubGlobal('fetch', fetchMock);
    try { expect(await deployDirectory('coden-demo', directory)).toEqual({id:'release',url:'https://release.pages.dev'}); }
    finally { fs.rmSync(directory, {recursive:true,force:true}); }
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
