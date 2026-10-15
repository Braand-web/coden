import { describe, expect, it } from 'vitest';
import {
  CloudflarePublicationProvider, cloudflarePublicationWorkerName, createCloudflarePublicationProvider,
  serializeBuiltArtifact, deserializeBuiltArtifact,
  type BuiltPublicationArtifact, type CloudflarePublicationProviderOptions,
  type PublicationProviderPolicy, type StagePublicationInput,
} from './cloudflare-provider.ts';
import { createPublicationGateway, PUBLICATION_PROVIDER_VERSION, PUBLICATION_VERIFY_PATH, PUBLICATION_PROBE_PATH, type PublicationGatewayConfig } from './worker-gateway.ts';
import type { PublicationSnapshot, PublicationState } from './model.ts';

const bytes = (value: string) => new TextEncoder().encode(value);
const policy: PublicationProviderPolicy = { revision: 'policy-2', primaryHost: 'app.coden.fun', allowedHosts: ['app.coden.fun'] };
const artifact: BuiltPublicationArtifact = { runtime: 'static-assets', assets: [
  { path: '/index.html', bytes: bytes('<meta name="coden-release" content="release-2"><h1>private</h1>'), contentType: 'text/html; charset=utf-8' },
  { path: '/assets/app.js', bytes: bytes('private js'), contentType: 'application/javascript' },
], notFoundHandling: 'single-page-application' };
const input: StagePublicationInput = { projectId: 'project-1', releaseId: 'release-2', policy, artifact };
const artifactForRelease = (releaseId: string): BuiltPublicationArtifact => ({ ...artifact, assets: artifact.assets!.map(asset => asset.path === '/index.html'
  ? { ...asset, bytes: bytes(`<meta name="coden-release" content="${releaseId}"><h1>private</h1>`) } : asset) });
type Upload = { name: string; metadata: any; parts: Map<string, { type: string; text: string }> };

/** Strict fake: an unexpected URL throws instead of falling back to the network. */
function fakeCloudflare() {
  const calls: Array<{ url: URL; init: RequestInit; upload?: Upload }> = [];
  const scripts = new Map<string, { tags: string[]; latest?: Upload }>();
  const uploads: Upload[] = [];
  const domains = new Map<string, string>();
  const deployments = new Map<string, any>();
  const manifests = new Map<string, Record<string, { hash: string }>>();
  const storedAssets = new Map<string, { bytes: Uint8Array; type: string }>();
  let markerMismatch = false;
  let refusePrivacy = false;
  let emptyCompletion = false;
  let cachedAssets = false;
  let unknownBucket = false;
  let existingDomainService = '';
  let failDeploy = false;
  let loseDeployResponse = false;
  let loseStageResponse = false;
  let sequence = 0;
  let backendReleaseId = 'old-release';
  let backendCalls = 0;
  let contentCalls = 0;
  let unhealthyBody: string | undefined;
  let unhealthyStatus = 200;
  let runtimeHtml: string | undefined;
  const success = (result: unknown) => Response.json({ success: true, result });
  const fetcher: typeof fetch = async (raw, init = {}) => {
    const url = new URL(String(raw));
    const call: typeof calls[number] = { url, init };
    calls.push(call);
    if (url.hostname.endsWith('.workers.dev') || domains.has(url.hostname)) {
      const name = domains.get(url.hostname) || url.hostname.split('.')[0];
      const upload = scripts.get(name)?.latest;
      if (!upload) throw new Error('Unexpected candidate');
      const source = upload.parts.get('gateway.mjs')!.text;
      const prefix = '\nexport default createGateway(';
      const config = JSON.parse(source.slice(source.lastIndexOf(prefix) + prefix.length, source.lastIndexOf(');'))) as PublicationGatewayConfig;
      const env = Object.fromEntries(upload.metadata.bindings.map((binding: any) => [binding.name, binding.text]));
      const gateway = createPublicationGateway(config, async raw => {
        expect(String(raw)).toBe('https://coden.example/api/publication-access/authorize');
        backendCalls++;
        return Response.json({ allowed: true, release_id: backendReleaseId });
      });
      const response = await gateway.fetch(new Request(url, init), { ...env, CONTENT: { fetch: async (request: Request) => {
        contentCalls++;
        if (unhealthyBody !== undefined) return new Response(unhealthyBody, { status: unhealthyStatus });
        const service = upload.metadata.bindings.find((binding: any) => binding.name === 'CONTENT').service;
        const target = scripts.get(service)!.latest!;
        if (target.metadata.main_module !== 'static.mjs') return runtimeHtml === undefined ? new Response('simulated runtime response')
          : new Response(runtimeHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        const asset = manifests.get(service)?.[new URL(request.url).pathname === '/' ? '/index.html' : new URL(request.url).pathname];
        const stored = asset && storedAssets.get(asset.hash);
        return stored ? new Response(Uint8Array.from(stored.bytes), { headers: { 'Content-Type': stored.type } }) : new Response('not found', { status: 404 });
      } } } as any);
      if (!markerMismatch || response.status !== 200) return response;
      return Response.json({ ...await response.json(), artifact_digest: 'WRONG' });
    }
    if (url.origin !== 'https://api.cloudflare.com') throw new Error(`Unexpected network origin ${url.origin}`);
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const match = url.pathname.match(/\/workers\/scripts\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const [, name, operation] = match;
      if (operation === 'settings') return scripts.has(name) ? success({ tags: scripts.get(name)!.tags }) : Response.json({ success: false }, { status: 404 });
      if (operation === 'subdomain') {
        const settings = JSON.parse(init.body as string);
        expect(settings.previews_enabled).toBe(false);
        if (settings.enabled && loseStageResponse) { loseStageResponse = false; throw new Error('Accepted stage response lost'); }
        return success({ ...settings, ...(refusePrivacy ? { previews_enabled: true } : {}) });
      }
      if (!operation || operation === 'versions') {
        if (init.method === 'DELETE') { scripts.delete(name); return success(null); }
        expect(init.body).toBeInstanceOf(FormData);
        const form = init.body as FormData;
        const metadata = JSON.parse(await (form.get('metadata') as Blob).text());
        const parts = new Map<string, { type: string; text: string }>();
        for (const [key, value] of form.entries()) if (key !== 'metadata') {
          const blob = value as Blob;
          parts.set(key, { type: blob.type, text: await blob.text() });
        }
        const upload = { name, metadata, parts };
        uploads.push(upload); call.upload = upload;
        if (!operation) scripts.set(name, { tags: metadata.tags || [], latest: upload });
        else scripts.get(name)!.latest = upload;
        return success({ id: `version-${++sequence}` });
      }
      if (operation === 'deployments') {
        if (!init.method || init.method === 'GET') return success({ deployments: deployments.has(name) ? [deployments.get(name)] : [] });
        if (failDeploy && name.startsWith('coden-pub-')) throw new Error('Ambiguous deployment failure');
        const body = JSON.parse(init.body as string);
        expect(body.versions).toHaveLength(1);
        expect(body.versions[0].percentage).toBe(100);
        const deployed = { id: `deployment-${++sequence}`, versions: body.versions, annotations: body.annotations };
        deployments.set(name, deployed);
        if (name.startsWith('coden-pub-') && loseDeployResponse) { loseDeployResponse = false; throw new Error('Accepted activation response lost'); }
        return success(deployed);
      }
      if (operation === 'assets-upload-session') {
        const { manifest } = JSON.parse(init.body as string);
        manifests.set(name, manifest);
        const hashes = Object.values(manifest).map((entry: any) => entry.hash);
        expect(hashes.every(hash => /^[a-f0-9]{32}$/.test(hash))).toBe(true);
        return success({ jwt: cachedAssets ? 'cached-completion' : 'upload-jwt', buckets: cachedAssets ? [] : unknownBucket ? [['unknown-hash']] : hashes.map(hash => [hash]) });
      }
    }
    if (url.pathname.endsWith('/workers/assets/upload')) {
      expect(url.search).toBe('?base64=true');
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer upload-jwt');
      expect(Array.from((init.body as FormData).keys())).toHaveLength(1); // exact server buckets
      for (const [key, raw] of (init.body as FormData).entries()) {
        const blob = raw as Blob;
        storedAssets.set(key, { bytes: Uint8Array.from(Buffer.from(await blob.text(), 'base64')), type: blob.type });
      }
      return success(emptyCompletion ? {} : { jwt: 'completion-jwt' });
    }
    if (url.pathname.endsWith('/workers/domains')) {
      if (init.method === 'PUT') { const body = JSON.parse(init.body as string); expect(body.enabled).toBe(true); expect(body.previews_enabled).toBe(false); expect(body.environment).toBeUndefined(); domains.set(body.hostname, body.service); return success({ id: 'domain-id', ...body }); }
      const hostname = url.searchParams.get('hostname')!;
      return success(existingDomainService ? [{ id: 'foreign-id', hostname, service: existingDomainService }] : domains.has(hostname) ? [{ id: hostname.replaceAll('.', '-'), hostname, service: domains.get(hostname), enabled: true, previews_enabled: false }] : []);
    }
    if (url.pathname.includes('/workers/domains/') && init.method === 'DELETE') {
      for (const hostname of domains.keys()) if (hostname.replaceAll('.', '-') === url.pathname.split('/').at(-1)) domains.delete(hostname);
      return success(null);
    }
    throw new Error(`Unexpected fake Cloudflare request: ${url.pathname}`);
  };
  const options: CloudflarePublicationProviderOptions = { enabled: true, accountId: 'account-id', apiToken: 'cloudflare-secret',
    workersSubdomain: 'platform-account', platformOrigin: 'https://coden.example', platformSecret: 'platform-auth-secret', compatibilityDate: '2026-10-15', fetch: fetcher };
  return {
    calls, uploads, scripts, options, provider: new CloudflarePublicationProvider(options),
    mismatchMarker: () => { markerMismatch = true; }, refusePrivacy: () => { refusePrivacy = true; },
    noCompletion: () => { emptyCompletion = true; }, cachedAssets: () => { cachedAssets = true; },
    unknownBucket: () => { unknownBucket = true; }, occupiedDomain: () => { existingDomainService = 'foreign-worker'; },
    failDeployment: () => { failDeploy = true; },
    setBackendRelease: (release: string) => { backendReleaseId = release; },
    counters: () => ({ backendCalls, contentCalls }), fetcher, domains,
    unhealthy: (body: string, status = 200) => { unhealthyBody = body; unhealthyStatus = status; },
    loseActivationResponse: () => { loseDeployResponse = true; },
    loseStagingResponse: () => { loseStageResponse = true; },
    setRuntimeHtml: (value: string) => { runtimeHtml = value; },
  };
}

describe('guarded Cloudflare publication provider', () => {
  it('is default-off and makes zero provider calls when disabled', async () => {
    const f = fakeCloudflare();
    const provider = new CloudflarePublicationProvider({ ...f.options, enabled: undefined });
    await expect(provider.stage(input)).rejects.toThrow(/disabled/);
    expect(f.calls).toHaveLength(0);
  });

  it('derives stable hosting identity from project ID, never a mutable subdomain', () => {
    expect(cloudflarePublicationWorkerName('project-1')).toBe(cloudflarePublicationWorkerName('project-1'));
    expect(cloudflarePublicationWorkerName('project-1')).not.toBe(cloudflarePublicationWorkerName('project-2'));
    expect(cloudflarePublicationWorkerName('project-1')).toMatch(/^coden-pub-[a-f0-9]{32}$/);
  });

  it('stages private content and a marker-only candidate, then verifies BEFORE activation', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    expect(staged.workerName).toBe(cloudflarePublicationWorkerName(input.projectId));
    expect(staged.candidateUrl).toBe(`https://${staged.candidateWorkerName}.platform-account.workers.dev`);
    expect(Object.isFrozen(staged)).toBe(true);
    expect(JSON.stringify(staged)).not.toMatch(/platform-auth-secret|cloudflare-secret|verification/i);
    expect(f.calls.some(c => c.url.pathname.includes('/workers/domains') || c.url.pathname.includes(`/scripts/${staged.workerName}`))).toBe(false);
    const verified = await f.provider.verify(staged);
    const result = await f.provider.activate(verified, policy);
    expect(result).toMatchObject({ providerVersion: PUBLICATION_PROVIDER_VERSION, releaseId: input.releaseId,
      publicUrl: 'https://app.coden.fun', runtime: 'static-assets', workerName: staged.workerName });
    const markerIndex = f.calls.findIndex(c => c.url.hostname.endsWith('.workers.dev'));
    const firstProductionIndex = f.calls.findIndex(c => c.url.pathname.includes(`/scripts/${staged.workerName}`));
    const attachIndex = f.calls.findIndex(c => c.url.pathname.endsWith('/workers/domains') && c.init.method === 'PUT');
    expect(firstProductionIndex).toBeGreaterThan(markerIndex);
    expect(attachIndex).toBeGreaterThan(firstProductionIndex);
    expect(f.calls.filter(c => c.url.pathname.endsWith('/subdomain') && JSON.parse(c.init.body as string).enabled).map(c => c.url.pathname)).toEqual([`/client/v4/accounts/account-id/workers/scripts/${staged.candidateWorkerName}/subdomain`]);
  });

  it('disables BOTH direct and preview content routes before uploading ANY app bytes', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const privacy = f.calls.findIndex(c => c.url.pathname.includes(staged.contentWorkerName) && c.url.pathname.endsWith('/subdomain'));
    const assets = f.calls.findIndex(c => c.url.pathname.endsWith('/assets-upload-session'));
    const source = f.calls.findIndex(c => c.url.pathname.includes(staged.contentWorkerName) && c.url.pathname.endsWith('/versions'));
    expect(privacy).toBeGreaterThan(-1);
    expect(assets).toBeGreaterThan(privacy);
    expect(source).toBeGreaterThan(privacy);
    expect(JSON.parse(f.calls[privacy].init.body as string)).toEqual({ enabled: false, previews_enabled: false });
    const bootstrap = f.uploads.find(u => u.name === staged.contentWorkerName)!;
    expect(bootstrap.metadata.assets).toBeUndefined();
    expect(bootstrap.parts.get('deny.mjs')!.text).not.toContain('private');
  });

  it('uses documented multipart asset metadata/config and base64 uploads with exact server buckets', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const upload = f.uploads.find(u => u.name === staged.contentWorkerName && u.metadata.assets)!;
    expect(upload.metadata).toMatchObject({ main_module: 'static.mjs', assets: { jwt: 'completion-jwt', config: { run_worker_first: true, not_found_handling: 'single-page-application' } }, bindings: [{ name: 'ASSETS', type: 'assets' }] });
    expect(upload.metadata.assets.run_worker_first).toBeUndefined();
    expect(upload.parts.get('static.mjs')!.type).toBe('application/javascript+module');
    const batches = f.calls.filter(c => c.url.pathname.endsWith('/workers/assets/upload'));
    expect(batches).toHaveLength(2);
    const contents = await Promise.all(batches.map(async call => Buffer.from(await (Array.from((call.init.body as FormData).values())[0] as Blob).text(), 'base64').toString()));
    expect(contents.sort()).toEqual(artifact.assets!.map(asset => new TextDecoder().decode(asset.bytes)).sort());
  });

  it('supports cached assets without fabricating an upload/completion token', async () => {
    const f = fakeCloudflare(); f.cachedAssets();
    await f.provider.stage(input);
    expect(f.calls.some(c => c.url.pathname.endsWith('/workers/assets/upload'))).toBe(false);
    expect(f.uploads.find(u => u.metadata.assets)!.metadata.assets.jwt).toBe('cached-completion');
  });

  it.each(['completion', 'bucket', 'privacy'])('aborts on unsafe/incomplete upload state: %s', async mode => {
    const f = fakeCloudflare();
    if (mode === 'completion') f.noCompletion();
    if (mode === 'bucket') f.unknownBucket();
    if (mode === 'privacy') f.refusePrivacy();
    await expect(f.provider.stage(input)).rejects.toThrow();
    expect(f.uploads.some(u => u.metadata.assets)).toBe(false);
    expect(f.calls.some(c => c.url.pathname.includes('/workers/domains'))).toBe(false);
  });

  it('preserves executable module graph and assets, WITHOUT executing builder/project code centrally', async () => {
    const f = fakeCloudflare();
    const main = 'import { answer } from "./lib.mjs"; export default {fetch(request, env) { return new Response("SSR " + answer); }};';
    const runtime: BuiltPublicationArtifact = { runtime: 'cloudflare-workers', mainModule: 'entry.mjs', compatibilityFlags: ['nodejs_compat'],
      modules: [{ name: 'entry.mjs', type: 'esm', bytes: bytes(main) }, { name: 'lib.mjs', type: 'esm', bytes: bytes('export const answer = 42;') },
        { name: 'image.bin', type: 'data', bytes: bytes('binary') }], assets: artifact.assets, assetsBinding: 'PUBLIC_FILES' };
    const staged = await f.provider.stage({ ...input, artifact: runtime });
    expect(staged.runtime).toBe('cloudflare-workers');
    const upload = f.uploads.find(u => u.name === staged.contentWorkerName && u.metadata.main_module === 'entry.mjs')!;
    expect(upload.parts.get('entry.mjs')!.text).toBe(main);
    expect(upload.parts.has('lib.mjs')).toBe(true);
    expect(upload.parts.get('image.bin')!.type).toBe('application/octet-stream');
    expect(upload.metadata.compatibility_flags).toEqual(['nodejs_compat']);
    expect(upload.metadata.bindings).toEqual([{ name: 'PUBLIC_FILES', type: 'assets' }]);
    expect(JSON.stringify(upload.metadata)).not.toContain('platform-auth-secret');
    const gateway = f.uploads.find(u => u.parts.has('gateway.mjs'))!;
    expect(gateway.metadata.bindings).toContainEqual({ name: 'CONTENT', type: 'service', service: staged.contentWorkerName });
    expect(gateway.metadata.bindings).toContainEqual({ name: 'CODEN_PLATFORM_SECRET', type: 'secret_text', text: 'platform-auth-secret' });
    expect(gateway.parts.get('gateway.mjs')!.text).not.toContain('platform-auth-secret');
    expect(gateway.parts.has('entry.mjs')).toBe(false);
    expect(gateway.metadata.assets).toBeUndefined();
  });

  it('supports runtime-only Workers without adding a static fallback or asset binding', async () => {
    const f = fakeCloudflare();
    const runtime: BuiltPublicationArtifact = { runtime: 'cloudflare-workers', mainModule: 'server.mjs', modules: [{ name: 'server.mjs', type: 'esm', bytes: bytes('throw new Error("must not run on central server");') }] };
    const staged = await f.provider.stage({ ...input, artifact: runtime });
    const upload = f.uploads.find(u => u.name === staged.contentWorkerName && u.parts.has('server.mjs'))!;
    expect(upload.metadata.assets).toBeUndefined();
    expect(upload.metadata.bindings).toEqual([]);
    expect(f.calls.some(c => c.url.pathname.endsWith('assets-upload-session'))).toBe(false);
  });

  it('includes content type in asset identity to avoid hash deduplication changing MIME types', async () => {
    const f = fakeCloudflare();
    await f.provider.stage({ ...input, artifact: { runtime: 'static-assets', assets: [
      { path: '/same.txt', bytes: bytes('same'), contentType: 'text/plain' },
      { path: '/same.js', bytes: bytes('same'), contentType: 'application/javascript' },
    ] } });
    const manifestCall = f.calls.find(c => c.url.pathname.endsWith('/assets-upload-session'))!;
    const { manifest } = JSON.parse(manifestCall.init.body as string);
    expect(manifest['/same.txt'].hash).not.toBe(manifest['/same.js'].hash);
  });

  it('cannot activate an unverified or copied/forged candidate', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const count = f.calls.length;
    await expect(f.provider.activate({ ...staged, verified: true }, policy)).rejects.toThrow(/Unrecognized/);
    await expect(f.provider.verify({ ...staged })).rejects.toThrow(/Unrecognized/);
    expect(f.calls).toHaveLength(count);
  });

  it('rehydrates signed candidate checkpoints across processes/JSONB key ordering without storing secrets', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const checkpoint = f.provider.checkpoint(staged);
    expect(JSON.stringify(checkpoint)).not.toContain('platform-auth-secret');
    const reorder = (value: any): any => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reorder(entry)])) : value;
    const persisted = reorder(JSON.parse(JSON.stringify(checkpoint)));
    const restarted = new CloudflarePublicationProvider(f.options);
    const resumed = restarted.resume(persisted);
    const verified = await restarted.verify(resumed);
    await restarted.activate(verified, policy);
    await restarted.verifyLive(verified);
    expect(f.counters()).toEqual({ backendCalls: 0, contentCalls: 2 });
    await expect(restarted.verify({ ...resumed })).rejects.toThrow(/Unrecognized/);
    expect(() => restarted.resume({ ...persisted, candidate: { ...persisted.candidate, workerName: 'foreign-worker' } })).toThrow(/altered/);
    const rotated = new CloudflarePublicationProvider({ ...f.options, platformSecret: 'rotated-secret' });
    expect(() => rotated.resume(persisted)).toThrow(/altered/);
  });

  it('supports narrow live marker verification BEFORE DB release activation but denies all new content until matching release', async () => {
    const f = fakeCloudflare();
    const verified = await f.provider.verify(await f.provider.stage(input));
    await f.provider.activate(verified, policy);
    await f.provider.verifyLive(verified);
    expect(f.counters()).toEqual({ backendCalls: 0, contentCalls: 2 });
    expect((await f.fetcher('https://app.coden.fun/index.html')).status).toBe(503);
    expect(f.counters().contentCalls).toBe(2);
    f.setBackendRelease(input.releaseId); // Simulate main's atomic DB activation.
    expect((await f.fetcher('https://app.coden.fun/index.html')).status).toBe(200);
    expect(f.counters().contentCalls).toBe(3);
    const liveProbe = f.calls.find(c => c.url.hostname === policy.primaryHost && c.url.pathname === PUBLICATION_VERIFY_PATH)!;
    expect((await f.fetcher('https://app.coden.fun/assets/app.js', { headers: liveProbe.init.headers })).status).toBe(200);
    // The secret does NOT bypass the release gate on arbitrary asset paths.
    f.setBackendRelease('old-release');
    expect((await f.fetcher('https://app.coden.fun/assets/private.js', { headers: liveProbe.init.headers })).status).toBe(503);
    expect((await f.fetcher('https://app.coden.fun/_coden/publication/verify?asset=/private.js', { headers: liveProbe.init.headers })).status).toBe(404);
  });

  it('rejects marker mismatches without any production activation', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input); f.mismatchMarker();
    await expect(f.provider.verify(staged)).rejects.toThrow(/marker verification failed/);
    expect(f.calls.some(c => c.url.pathname.includes(`/scripts/${staged.workerName}`))).toBe(false);
  });

  it('requires the same current policy at activation; a policy change requires restaging', async () => {
    const f = fakeCloudflare();
    const verified = await f.provider.verify(await f.provider.stage(input));
    const count = f.calls.length;
    await expect(f.provider.activate(verified, { ...policy, revision: 'new-policy' })).rejects.toThrow(/policy changed/);
    await expect(f.provider.activate(verified, { ...policy, primaryHost: 'new.coden.fun', allowedHosts: ['new.coden.fun'] })).rejects.toThrow(/policy changed/);
    expect(f.calls).toHaveLength(count);
  });

  it('refuses unrecognized existing provider Workers/versions', async () => {
    const f = fakeCloudflare();
    const verified = await f.provider.verify(await f.provider.stage(input));
    f.scripts.set(verified.workerName, { tags: ['old-or-foreign-provider'] });
    await expect(f.provider.activate(verified, policy)).rejects.toThrow(/Unrecognized provider Worker/);
    expect(f.uploads.some(u => u.name === verified.workerName)).toBe(false);
  });

  it('refuses host takeover before changing the production Worker', async () => {
    const f = fakeCloudflare();
    const verified = await f.provider.verify(await f.provider.stage(input)); f.occupiedDomain();
    await expect(f.provider.activate(verified, policy)).rejects.toThrow(/another Worker/);
    expect(f.calls.some(c => c.url.pathname.includes(`/scripts/${verified.workerName}`))).toBe(false);
  });

  it('does not retry an ambiguous activation or allow a verified handle to be reused', async () => {
    const f = fakeCloudflare();
    const verified = await f.provider.verify(await f.provider.stage(input)); f.failDeployment();
    await expect(f.provider.activate(verified, policy)).rejects.toThrow(/request failed/);
    const count = f.calls.length;
    await expect(f.provider.activate(verified, policy)).rejects.toThrow(/consumed/);
    expect(f.calls).toHaveLength(count);
  });

  it('reuses deterministic exact tagged/stamped staging after an accepted response was lost', async () => {
    const f = fakeCloudflare(); f.loseStagingResponse();
    await expect(f.provider.stage(input)).rejects.toThrow(/request failed/);
    const uploads = f.uploads.length;
    const sessions = f.calls.filter(c => c.url.pathname.endsWith('/assets-upload-session')).length;
    const staged = await new CloudflarePublicationProvider(f.options).stage(input);
    expect(f.uploads).toHaveLength(uploads);
    expect(f.calls.filter(c => c.url.pathname.endsWith('/assets-upload-session'))).toHaveLength(sessions);
    const next = await f.provider.stage(input);
    expect(next).toEqual(staged);
    expect(f.uploads).toHaveLength(uploads);
    expect(f.scripts.get(staged.contentWorkerName)!.tags).toContain(`coden-artifact:${staged.artifactDigest}`);
  });

  it('explicit resume adopts an already accepted exact deployment without a second version/deploy', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const checkpoint = JSON.parse(JSON.stringify(f.provider.checkpoint(staged)));
    const verified = await f.provider.verify(staged); f.loseActivationResponse();
    await expect(f.provider.activate(verified, policy)).rejects.toThrow(/request failed/);
    const stableWrites = () => f.calls.filter(c => c.url.pathname.includes(`/scripts/${staged.workerName}/`) && ['versions', 'deployments'].includes(c.url.pathname.split('/').at(-1)!) && c.init.method === 'POST');
    const before = stableWrites().length;
    const resumed = new CloudflarePublicationProvider(f.options);
    const resumedVerified = await resumed.verify(resumed.resume(checkpoint));
    const adopted = await resumed.activate(resumedVerified, policy);
    expect(stableWrites()).toHaveLength(before);
    expect(adopted.deploymentId).toBeTruthy();
    expect(f.domains.get(policy.primaryHost)).toBe(staged.workerName);
    await resumed.verifyLive(resumedVerified);
    expect((await f.fetcher('https://app.coden.fun/index.html')).status).toBe(503); // DB is still old.
    const resumedAgain = new CloudflarePublicationProvider(f.options);
    const again = await resumedAgain.verify(resumedAgain.resume(checkpoint));
    const aliasWrites = f.calls.filter(c => c.url.pathname.endsWith('/workers/domains') && c.init.method === 'PUT').length;
    const result = await resumedAgain.activate(again, policy);
    expect(result.deploymentId).toBe(adopted.deploymentId);
    expect(result.versionId).toBe(adopted.versionId);
    expect(stableWrites()).toHaveLength(before);
    expect(f.calls.filter(c => c.url.pathname.endsWith('/workers/domains') && c.init.method === 'PUT')).toHaveLength(aliasWrites);
  });

  it('does not redeploy after an ambiguous exact-live probe failure on explicit resume', async () => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input);
    const checkpoint = f.provider.checkpoint(staged);
    await f.provider.activate(await f.provider.verify(staged), policy);
    const resumed = new CloudflarePublicationProvider(f.options);
    const verified = await resumed.verify(resumed.resume(checkpoint));
    const before = f.uploads.length;
    f.unhealthy('broken', 503);
    await expect(resumed.activate(verified, policy)).rejects.toThrow(/probe/);
    expect(f.uploads).toHaveLength(before);
  });

  it.each([
    ['missing', '<h1>old content</h1>', 200],
    ['stale', '<meta name="coden-release" content="old-release">', 200],
    ['duplicate', '<meta name="coden-release" content="release-2"><meta name="coden-release" content="old">', 200],
    ['error', 'application failed', 500], ['empty', '', 200],
  ])('rejects real content verification failure %s before production activation', async (_name, body, status) => {
    const f = fakeCloudflare();
    const staged = await f.provider.stage(input); f.unhealthy(body as string, status as number);
    await expect(f.provider.verify(staged)).rejects.toThrow(/content/);
    expect(f.calls.some(c => c.url.pathname.includes(`/scripts/${staged.workerName}`))).toBe(false);
    expect(f.counters().contentCalls).toBe(1); // Root was actually requested from the fake content binding.
  });

  it('rolls old content forward under a fresh release/current policy; never restores an old gateway version', async () => {
    const f = fakeCloudflare();
    const current = { revision: 'current-private-policy', primaryHost: 'new.coden.fun', allowedHosts: ['new.coden.fun'] };
    const staged = await f.provider.stageRollback({ ...input, artifact: artifactForRelease('rollback-new'), releaseId: 'rollback-new', restoredFromReleaseId: 'old-public-release', policy: current });
    const verified = await f.provider.verify(staged);
    const result = await f.provider.activate(verified, current);
    expect(result.policyRevision).toBe('current-private-policy');
    expect(result.releaseId).toBe('rollback-new');
    expect(result.publicUrl).toBe('https://new.coden.fun');
    const source = f.uploads.filter(u => u.parts.has('gateway.mjs')).at(-1)!.parts.get('gateway.mjs')!.text;
    expect(source).toContain('current-private-policy');
    expect(source).not.toContain('old-public-release');
    expect(f.calls.some(c => /\/deployments\//.test(c.url.pathname))).toBe(false);
    await expect(f.provider.stageRollback({ ...input, restoredFromReleaseId: input.releaseId })).rejects.toThrow(/new release ID/);
  });

  it('uses CURRENT policy metadata when rolling back retained runtime content with old SSR metadata', async () => {
    const f = fakeCloudflare();
    f.setRuntimeHtml('<html><head><title>OLD SSR TITLE</title><meta name="description" content="OLD SSR DESCRIPTION"><meta property="og:image" content="https://old.example/image"></head><body>Retained runtime body</body></html>');
    const retained: BuiltPublicationArtifact = { runtime: 'cloudflare-workers', mainModule: 'retained.mjs', modules: [{ name: 'retained.mjs', type: 'esm', bytes: bytes('export default {fetch() { return new Response("old runtime"); }}') }] };
    const current = { ...policy, revision: 'current-policy', metadata: { title: 'Current title', description: 'Current description', favicon: '/current.ico', image: '/current.png' } };
    const staged = await f.provider.stageRollback({ ...input, releaseId: 'rollback-runtime', restoredFromReleaseId: 'old-runtime-release', artifact: retained, policy: current });
    const verified = await f.provider.verify(staged);
    await f.provider.activate(verified, current);
    f.setBackendRelease('rollback-runtime');
    const response = await f.fetcher('https://app.coden.fun/');
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<title>Current title</title>');
    expect(body).toContain('content="Current description"');
    expect(body).toContain('href="/current.ico"');
    expect(body).toContain('https://app.coden.fun/current.png');
    expect(body).toContain('Retained runtime body');
    expect(body).not.toMatch(/OLD SSR|old\.example/);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('snapshots metadata immutably and rejects changing it after candidate verification', async () => {
    const f = fakeCloudflare();
    const metadata = { title: 'Captured title', description: 'Captured description', favicon: null, image: null };
    const capturedPolicy = { ...policy, metadata };
    const staged = await f.provider.stage({ ...input, policy: capturedPolicy });
    const checkpoint = f.provider.checkpoint(staged);
    metadata.title = 'Changed after stage';
    expect(checkpoint.policy.metadata?.title).toBe('Captured title');
    expect(Object.isFrozen(checkpoint.policy.metadata)).toBe(true);
    const verified = await f.provider.verify(staged);
    const count = f.calls.length;
    await expect(f.provider.activate(verified, capturedPolicy)).rejects.toThrow(/policy changed/);
    expect(f.calls).toHaveLength(count);
  });

  it.each(['https://external.example/image', '//external.example/image', '/a/../secret', '/%5csecret'])('rejects unsafe policy metadata before provider calls: %s', async image => {
    const f = fakeCloudflare();
    await expect(f.provider.stage({ ...input, policy: { ...policy, metadata: { title: 'Title', description: '', favicon: null, image } } })).rejects.toThrow(/metadata/);
    expect(f.calls).toHaveLength(0);
  });

  it.each(['preview.account.workers.dev', 'preview.pages.dev', 'App.coden.fun', 'app.coden.fun:8443', '*.coden.fun', 'app.coden.fun/path'])('rejects invalid/unrecognized policy hosts before network access: %s', async primaryHost => {
    const f = fakeCloudflare();
    await expect(f.provider.stage({ ...input, policy: { ...policy, primaryHost, allowedHosts: [primaryHost] } })).rejects.toThrow(/host/);
    expect(f.calls).toHaveLength(0);
  });

  it.each(['/../secret', '/a//b', '/a%2fb', '/a\\b', '/a?query'])('rejects unsafe asset paths before provider access: %s', async path => {
    const f = fakeCloudflare();
    await expect(f.provider.stage({ ...input, artifact: { runtime: 'static-assets', assets: [{ path, bytes: bytes('x'), contentType: 'text/plain' }] } })).rejects.toThrow(/path/);
    expect(f.calls).toHaveLength(0);
  });

  it('rejects nonexecutable runtime graphs instead of downgrading to static', async () => {
    const f = fakeCloudflare();
    await expect(f.provider.stage({ ...input, artifact: { runtime: 'cloudflare-workers', mainModule: 'missing.mjs', modules: [] } })).rejects.toThrow(/executable/);
    expect(f.calls).toHaveLength(0);
  });
});

describe('PublicationService provider port bridge', () => {
  const snapshot: PublicationSnapshot = {
    id: 'snapshot-release', project_id: 'project-1', actor_id: 'actor-1', fingerprint: 'captured-policy-fingerprint',
    files: [], manifest: { runtime: 'static-assets' }, public_env: {},
    settings: { subdomain: 'app', audience: 'invite_only', invitations: ['allowed@example.com'], metadata: { title: 'Private', description: '', favicon: null, image: null } },
  };
  const state: PublicationState = { project_id: snapshot.project_id, hosting_id: 'coden-project1', draft: snapshot.settings,
    effective: snapshot.settings, release_id: 'old-release', fingerprint: 'old', enabled: true };
  it('exports JSON-safe round-trip helpers for raw static and executable runtime bytes', () => {
    const runtime: BuiltPublicationArtifact = { runtime: 'cloudflare-workers', mainModule: 'main.mjs', modules: [{ name: 'main.mjs', type: 'esm', bytes: bytes('SSR') }], assets: artifact.assets };
    for (const built of [artifact, runtime]) {
      const stored = JSON.parse(JSON.stringify(serializeBuiltArtifact(built)));
      expect(stored.version).toBe(1);
      expect(stored.assets[0].bytes).toBeUndefined();
      const restored = deserializeBuiltArtifact(stored);
      expect(restored.runtime).toBe(built.runtime);
      expect(restored.assets![0].bytes).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(restored.assets![0].bytes).toString()).toBe(Buffer.from(built.assets![0].bytes).toString());
      if (restored.runtime === 'cloudflare-workers') expect(Buffer.from(restored.modules[0].bytes).toString()).toBe('SSR');
    }
    expect(() => deserializeBuiltArtifact({ runtime: 'static-assets', assets: [] })).toThrow(/Unrecognized/);
    expect(() => deserializeBuiltArtifact({ version: 1, runtime: 'static-assets', assets: [{ path: '/x', contentType: 'text/plain', base64: 'invalid!' }] })).toThrow(/encoding/);
  });

  it('implements build/stage/verify(false)/activate/verify(true)/remove using durable JSON checkpoints', async () => {
    const f = fakeCloudflare();
    let buildCalls = 0;
    const options = { ...f.options, rootDomain: 'coden.fun', isolatedBuilder: { build: async (captured: PublicationSnapshot) => {
      expect(captured).toBe(snapshot); buildCalls++; return artifactForRelease(snapshot.id);
    } } };
    const initial = createCloudflarePublicationProvider(options);
    const built = JSON.parse(JSON.stringify(await initial.build(snapshot)));
    const candidate: any = JSON.parse(JSON.stringify(await initial.stage(snapshot, built, state.hosting_id)));
    expect(candidate.candidate.workerName).toBe(state.hosting_id);
    expect(candidate.policy.metadata).toEqual(snapshot.settings.metadata);
    const restarted = createCloudflarePublicationProvider(options);
    await restarted.verify(snapshot, candidate, false);
    await restarted.activate(snapshot, candidate, state, ['app.coden.fun', 'old.coden.fun']);
    await restarted.verify(snapshot, candidate, true);
    expect(f.counters()).toEqual({ backendCalls: 0, contentCalls: 2 });
    expect(buildCalls).toBe(1);
    expect((await f.fetcher('https://app.coden.fun/index.html')).status).toBe(503);
    f.setBackendRelease(snapshot.id);
    expect((await f.fetcher('https://app.coden.fun/index.html')).status).toBe(200);
    await restarted.remove(state, ['app.coden.fun', 'old.coden.fun']);
    expect(f.scripts.has(state.hosting_id)).toBe(false);
    expect(f.domains.size).toBe(0);
    expect(f.scripts.has(candidate.candidate.contentWorkerName)).toBe(true); // retained PRIVATE content
  });

  it('does not invoke the isolated builder while feature flag is off', async () => {
    const f = fakeCloudflare();
    const port = createCloudflarePublicationProvider({ ...f.options, enabled: false, rootDomain: 'coden.fun', isolatedBuilder: { build: async () => { throw new Error('must not build'); } } });
    await expect(port.build(snapshot)).rejects.toThrow(/disabled/);
    expect(f.calls).toHaveLength(0);
  });

  it('captures manual snapshot metadata in a resumable runtime gateway and rewrites simulated SSR content', async () => {
    const f = fakeCloudflare();
    f.setRuntimeHtml('<!doctype html><html><head><title>Old generated title</title></head><body>SSR content</body></html>');
    const captured = { ...snapshot, manifest: { runtime: 'cloudflare-workers' }, settings: { ...snapshot.settings,
      metadata: { title: 'Manual current title', description: 'Manual current description', favicon: '/manual.ico', image: '/manual.png' },
    } };
    const runtime: BuiltPublicationArtifact = { runtime: 'cloudflare-workers', mainModule: 'ssr.mjs', modules: [{ name: 'ssr.mjs', type: 'esm', bytes: bytes('export default { fetch() { return new Response("SSR"); } };') }] };
    const options = { ...f.options, rootDomain: 'coden.fun', isolatedBuilder: { build: async () => runtime } };
    const port = createCloudflarePublicationProvider(options);
    const candidate: any = JSON.parse(JSON.stringify(await port.stage(captured, await port.build(captured), state.hosting_id)));
    expect(candidate.policy.metadata).toEqual(captured.settings.metadata);
    const resumed = createCloudflarePublicationProvider(options);
    await resumed.verify(captured, candidate, false);
    const probe = f.calls.find(call => call.url.pathname === PUBLICATION_PROBE_PATH)!;
    const response = await f.fetcher(probe.url, probe.init);
    const html = await response.text();
    expect(html).toContain('<title>Manual current title</title>');
    expect(html).toContain('Manual current description');
    expect(html).toContain('/manual.ico');
    expect(html).not.toContain('Old generated title');
    expect(html).toContain('SSR content');
  });

  it('rejects changed snapshots, unverified checkpoints, and foreign hosting state', async () => {
    const f = fakeCloudflare();
    const port = createCloudflarePublicationProvider({ ...f.options, rootDomain: 'coden.fun', isolatedBuilder: { build: async () => artifactForRelease(snapshot.id) } });
    const candidate = await port.stage(snapshot, await port.build(snapshot), state.hosting_id);
    await expect(port.activate(snapshot, candidate, state, [])).rejects.toThrow(/verification/);
    await expect(port.verify({ ...snapshot, fingerprint: 'changed' }, candidate, false)).rejects.toThrow(/snapshot/);
    await port.verify(snapshot, candidate, false);
    await expect(port.activate(snapshot, candidate, { ...state, project_id: 'foreign-project' }, [])).rejects.toThrow(/does not own/);
    await expect(port.stage(snapshot, await port.build(snapshot), 'user-controlled-subdomain')).rejects.toThrow(/hosting identity/);
  });
});
