import { runInNewContext } from 'node:vm';
import { deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  buildPublicationGatewayModule, createPublicationGateway, PUBLICATION_EXCHANGE_PATH,
  PUBLICATION_PROVIDER_VERSION, PUBLICATION_SESSION_COOKIE, PUBLICATION_VERIFY_PATH,
  PUBLICATION_PROBE_PATH,
  type PublicationAccessResponse, type PublicationGatewayConfig, type PublicationGatewayEnv,
} from './worker-gateway.ts';

const config: PublicationGatewayConfig = {
  providerVersion: PUBLICATION_PROVIDER_VERSION, projectId: 'project-1', releaseId: 'release-2',
  policyRevision: 'policy-current', artifactDigest: 'digest', platformOrigin: 'https://coden.example',
  primaryHost: 'app.coden.fun', allowedHosts: ['app.coden.fun', 'custom.example'], mode: 'active',
};
function setup(decision: Partial<PublicationAccessResponse> = {}, override: Partial<PublicationGatewayConfig> = {}) {
  const backend = vi.fn(async (_input?: unknown, _init?: RequestInit) => Response.json({ allowed: true, release_id: config.releaseId, return_path: '/', ...decision }));
  const content = vi.fn(async (_request: Request) => new Response('private application', {
    headers: { 'Cache-Control': 'public, max-age=86400', 'CDN-Cache-Control': 'public', 'Surrogate-Control': 'max-age=99' },
  }));
  const env: PublicationGatewayEnv = { CODEN_PLATFORM_SECRET: 'platform-secret', CODEN_VERIFY_SECRET: 'verify-secret', CONTENT: { fetch: content } };
  const gateway = createPublicationGateway({ ...config, ...override }, backend as typeof fetch);
  return { backend, content, env, gateway, request: (path = '/', init?: RequestInit) => gateway.fetch(new Request(`https://app.coden.fun${path}`, init), env) };
}

describe('platform publication gateway', () => {
  it.each(['/index.html', '/assets/app.js', '/favicon.ico', '/api/private', '/deep/spa/path'])('authorizes BEFORE content: %s', async path => {
    const s = setup({ allowed: false });
    expect((await s.request(path)).status).toBe(401);
    expect(s.backend).toHaveBeenCalledTimes(1);
    expect(s.content).not.toHaveBeenCalled();
  });

  it('does not bake public policy into a release, and consults backend on every request', async () => {
    const s = setup({ public: true });
    expect((await s.request('/assets/app.js')).status).toBe(200);
    s.backend.mockResolvedValueOnce(Response.json({ allowed: false, public: false }));
    expect((await s.request('/assets/app.js')).status).toBe(401);
    expect(s.backend).toHaveBeenCalledTimes(2);
    expect(s.content).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://unknown.example/index.html', 'https://app.account.workers.dev/',
    'https://123-app.account.workers.dev/', 'http://app.coden.fun/', 'https://app.coden.fun:8443/',
  ])('rejects unknown/noncanonical entry points before backend or content: %s', async url => {
    const s = setup();
    const response = await s.gateway.fetch(new Request(url, { headers: { 'X-Forwarded-Host': config.primaryHost, Host: config.primaryHost } }), s.env);
    expect(response.status).toBe(421);
    expect(s.backend).not.toHaveBeenCalled();
    expect(s.content).not.toHaveBeenCalled();
  });

  it('refuses a workers.dev host even if accidentally included in the allowlist', async () => {
    const s = setup({}, { allowedHosts: [config.primaryHost, 'oops.account.workers.dev'] });
    expect((await s.gateway.fetch(new Request('https://oops.account.workers.dev/'), s.env)).status).toBe(421);
    expect(s.content).not.toHaveBeenCalled();
  });

  it.each([
    { providerVersion: 'future-provider' }, { mode: 'preview' }, { platformOrigin: 'https://coden.example/extra' },
  ])('fails closed on unrecognized gateway configuration: %j', async override => {
    const s = setup({}, override as Partial<PublicationGatewayConfig>);
    expect((await s.request()).status).toBe(503);
    expect(s.backend).not.toHaveBeenCalled();
  });

  it('sends only the documented server-to-server authorization payload', async () => {
    const s = setup();
    await s.request('/api/query?a=1', { headers: { Cookie: `${PUBLICATION_SESSION_COOKIE}=signed.session; theme=dark`, Authorization: 'Bearer app-token' } });
    const [url, init] = s.backend.mock.calls[0];
    expect(url).toBe('https://coden.example/api/publication-access/authorize');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', cache: 'no-store', headers: { Authorization: 'Bearer platform-secret' } });
    expect(JSON.parse(init!.body as string)).toEqual({ project_id: 'project-1', host: config.primaryHost, session: 'signed.session', return_path: '/api/query?a=1' });
    const forwarded = s.content.mock.calls[0][0];
    expect(forwarded.headers.get('Cookie')).toBe('theme=dark');
    expect(forwarded.headers.get('Authorization')).toBe('Bearer app-token');
    expect(await forwarded.text()).not.toContain('platform-secret');
  });

  it('preserves runtime POST methods, body, and application cookies without platform credentials', async () => {
    const s = setup();
    await s.request('/api/action', { method: 'POST', body: 'runtime body', headers: {
      Cookie: `theme=dark; ${PUBLICATION_SESSION_COOKIE}=signed.session`,
      'X-Coden-Publication-Verification': 'attacker-token', 'X-Coden-Publication-Bypass': 'true',
    } });
    const request = s.content.mock.calls[0][0];
    expect(request.method).toBe('POST');
    expect(await request.text()).toBe('runtime body');
    expect(request.headers.get('Cookie')).toBe('theme=dark');
    expect(request.headers.get('X-Coden-Publication-Verification')).toBeNull();
    expect(request.headers.get('X-Coden-Publication-Bypass')).toBeNull();
  });

  it('does not trust duplicated platform cookies', async () => {
    const s = setup();
    await s.request('/', { headers: { Cookie: `${PUBLICATION_SESSION_COOKIE}=one; ${PUBLICATION_SESSION_COOKIE}=two` } });
    expect(JSON.parse(s.backend.mock.calls[0][1]!.body as string).session).toBeUndefined();
    expect(s.content.mock.calls[0][0].headers.get('Cookie')).toBeNull();
  });

  it('makes every response noncacheable across future audience changes', async () => {
    const s = setup();
    const response = await s.request('/assets/app.js');
    expect(await response.text()).toBe('private application');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Cloudflare-CDN-Cache-Control')).toBe('no-store');
    expect(response.headers.get('Surrogate-Control')).toBeNull();
    expect(response.headers.get('Vary')).toBe('Cookie');
  });

  it('prevents project runtime responses from replacing the platform session cookie', async () => {
    const s = setup();
    s.content.mockResolvedValueOnce(new Response('app', { headers: { 'Set-Cookie': `${PUBLICATION_SESSION_COOKIE}=forged; Path=/` } }));
    expect((await s.request()).headers.get('Set-Cookie')).toBeNull();
  });

  it('redirects HTML navigations only to the Coden handshake with exact host/path', async () => {
    const s = setup({ allowed: false, redirect_url: 'https://evil.example/steal' });
    const response = await s.request('/private?q=hello', { headers: { Accept: 'text/html' } });
    expect(response.status).toBe(302);
    const target = new URL(response.headers.get('Location')!);
    expect(target.origin + target.pathname).toBe('https://coden.example/publication-auth');
    expect(Object.fromEntries(target.searchParams)).toEqual({ project_id: 'project-1', host: config.primaryHost, return_path: '/private?q=hello' });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(s.content).not.toHaveBeenCalled();
  });

  it.each([{ allowed: true }, { allowed: true, release_id: 'old-release' }, { allowed: true, release_id: config.releaseId, primary_host: 'evil.example' }])('rejects stale/missing release binding: %j', async body => {
    const s = setup();
    s.backend.mockResolvedValueOnce(Response.json(body));
    expect((await s.request()).status).toBe(503);
    expect(s.content).not.toHaveBeenCalled();
  });

  it.each([
    () => Response.json({ allowed: 'true' }),
    () => new Response('not json'),
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }),
    () => new Response('secret response', { status: 500 }),
  ])('fails closed for invalid/unavailable authorization responses', async response => {
    const s = setup();
    s.backend.mockResolvedValueOnce(response());
    const result = await s.request();
    expect(result.status).toBe(503);
    expect(await result.text()).toBe('');
    expect(s.content).not.toHaveBeenCalled();
  });

  it('fails closed on backend exceptions or a missing platform secret', async () => {
    const s = setup();
    s.backend.mockRejectedValueOnce(new Error('platform-secret must not appear'));
    expect(await (await s.request()).text()).toBe('');
    s.env.CODEN_PLATFORM_SECRET = '';
    expect((await s.request()).status).toBe(503);
    expect(s.content).not.toHaveBeenCalled();
  });

  it('exchanges a bound one-time code for a host-only HttpOnly session and clean redirect', async () => {
    const s = setup({ session_token: 'signed.session', max_age: 3600, return_path: '/deep?a=1' });
    const response = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one-time&return_path=%2Fdeep%3Fa%3D1`);
    expect(s.backend.mock.calls[0][0]).toBe('https://coden.example/api/publication-access/exchange');
    expect(JSON.parse(s.backend.mock.calls[0][1]!.body as string)).toEqual({ project_id: config.projectId, host: config.primaryHost, code: 'one-time', return_path: '/deep?a=1' });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/deep?a=1');
    expect(response.headers.get('Set-Cookie')).toBe(`${PUBLICATION_SESSION_COOKIE}=signed.session; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600`);
    expect(response.headers.get('Set-Cookie')).not.toContain('Domain=');
    expect(await response.text()).toBe('');
    expect(s.content).not.toHaveBeenCalled();
  });

  it('accepts main exchange response without release_id and uses its stored return_path', async () => {
    const s = setup();
    s.backend.mockResolvedValueOnce(Response.json({ allowed: true, session_token: 'signed', max_age: 3600, return_path: '/stored/path?q=hello%20world' }));
    const response = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one`);
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe('/stored/path?q=hello%20world');
    expect(s.content).not.toHaveBeenCalled();
  });

  it('supports login_url denial responses without trusting arbitrary redirect targets', async () => {
    const s = setup();
    s.backend.mockResolvedValueOnce(Response.json({ allowed: false, login_url: 'https://evil.example/steal' }));
    const response = await s.request('/private', { headers: { Accept: 'text/html' } });
    expect(new URL(response.headers.get('Location')!).origin).toBe(config.platformOrigin);
  });

  it('rejects unsafe stored return paths without minting cookies', async () => {
    const s = setup();
    s.backend.mockResolvedValueOnce(Response.json({ allowed: true, session_token: 'signed', max_age: 3600, return_path: '//evil.example' }));
    const response = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one`);
    expect(response.status).toBe(502);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('never falls back to the caller query when exchange omits its authoritative return_path', async () => {
    const s = setup();
    s.backend.mockResolvedValueOnce(Response.json({ allowed: true, session_token: 'signed', max_age: 3600 }));
    const response = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one&return_path=%2Fattacker-chosen`);
    expect(response.status).toBe(502);
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('live marker probing bypasses only its exact internal path, never content or unknown hosts', async () => {
    const s = setup({ allowed: true, release_id: 'old-release' });
    const headers = { 'X-Coden-Publication-Verification': 'verify-secret' };
    expect((await s.request(PUBLICATION_VERIFY_PATH, { headers })).status).toBe(200);
    expect(s.backend).not.toHaveBeenCalled();
    expect((await s.request('/private.js', { headers })).status).toBe(503);
    expect((await s.request(`${PUBLICATION_VERIFY_PATH}?asset=/private.js`, { headers })).status).toBe(404);
    expect((await s.gateway.fetch(new Request(`https://preview.account.workers.dev${PUBLICATION_VERIFY_PATH}`, { headers }), s.env)).status).toBe(421);
    expect(s.content).not.toHaveBeenCalled();
  });

  it.each(['//evil.example/', '/\\evil.example/', '/%2f%2fevil.example', '/%5cevil.example', '/bad\npath', '/_coden/publication/exchange', 'https://evil.example', '/#fragment'])('rejects unsafe return_path %s before exchange', async path => {
    const s = setup({ session_token: 'signed', max_age: 60 });
    const result = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one&return_path=${encodeURIComponent(path)}`);
    expect(result.status).toBe(400);
    expect(s.backend).not.toHaveBeenCalled();
  });

  it.each([
    { allowed: false }, { session_token: 'bad; injected=true', max_age: 60 },
    { session_token: 'signed', max_age: 0 }, { session_token: 'signed', max_age: 1.5 },
    { session_token: 'signed' }, { session_token: 'signed', max_age: 60, release_id: 'stale' },
  ])('does not mint cookies from invalid exchanges: %j', async decision => {
    const s = setup(decision);
    const response = await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(s.content).not.toHaveBeenCalled();
  });

  it('caps session TTL and refuses POST callbacks/duplicated codes', async () => {
    const s = setup({ session_token: 'signed', max_age: 999999 });
    expect((await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one`)).headers.get('Set-Cookie')).toContain('Max-Age=86400');
    expect((await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one`, { method: 'POST' })).status).toBe(405);
    expect((await s.request(`${PUBLICATION_EXCHANGE_PATH}?code=one&code=two`)).status).toBe(400);
    expect((await s.request(PUBLICATION_EXCHANGE_PATH)).status).toBe(400);
  });

  it('does not allow active verification/reserved routes to reach project content', async () => {
    const s = setup();
    expect((await s.request(PUBLICATION_VERIFY_PATH)).status).toBe(404);
    expect((await s.request('/_coden/publication/anything')).status).toBe(404);
    expect(s.content).not.toHaveBeenCalled();
  });

  it('candidate serves only the secret-protected marker on its exact host', async () => {
    const candidateHost = 'coden-stage-123.account.workers.dev';
    const s = setup({}, { mode: 'candidate', candidateHost });
    const request = (path: string, init?: RequestInit, host = candidateHost) => s.gateway.fetch(new Request(`https://${host}${path}`, init), s.env);
    for (const path of ['/', '/assets/private.js', PUBLICATION_EXCHANGE_PATH, PUBLICATION_VERIFY_PATH]) expect((await request(path)).status).toBe(404);
    const init = { headers: { 'X-Coden-Publication-Verification': 'verify-secret' } };
    expect((await request(PUBLICATION_VERIFY_PATH, init, `preview-${candidateHost}`)).status).toBe(404);
    expect((await request(`${PUBLICATION_VERIFY_PATH}?bypass=true`, init)).status).toBe(404);
    const marker = await request(PUBLICATION_VERIFY_PATH, init);
    expect(marker.status).toBe(200);
    expect(await marker.json()).toEqual({ provider_version: config.providerVersion, project_id: config.projectId,
      release_id: config.releaseId, policy_revision: config.policyRevision, artifact_digest: config.artifactDigest });
    expect(s.backend).not.toHaveBeenCalled();
    expect(s.content).not.toHaveBeenCalled();
  });

  it('protected candidate probe forwards ONLY a fresh fixed-root request without any credentials', async () => {
    const candidateHost = 'coden-stage-123.account.workers.dev';
    const s = setup({}, { mode: 'candidate', candidateHost });
    const headers = { 'X-Coden-Publication-Verification': 'verify-secret', Cookie: 'session=private', Authorization: 'Bearer never-forward' };
    const result = await s.gateway.fetch(new Request(`https://${candidateHost}${PUBLICATION_PROBE_PATH}`, { headers }), s.env);
    expect(result.status).toBe(200);
    expect(result.headers.get('X-Coden-Publication-Release')).toBe(config.releaseId);
    expect(result.headers.get('X-Coden-Publication-Artifact')).toBe(config.artifactDigest);
    expect(await result.text()).toBe('private application');
    const forwarded = s.content.mock.calls[0][0];
    expect(forwarded.url).toBe('https://app.coden.fun/');
    expect(forwarded.method).toBe('GET');
    for (const name of ['Cookie', 'Authorization', 'X-Coden-Publication-Verification']) expect(forwarded.headers.get(name)).toBeNull();
    for (const path of [PUBLICATION_PROBE_PATH, `${PUBLICATION_PROBE_PATH}?url=https://evil.example`, '/private.js']) {
      const response = await s.gateway.fetch(new Request(`https://${candidateHost}${path}`, { headers: path === PUBLICATION_PROBE_PATH ? {} : headers }), s.env);
      expect(response.status).toBe(404);
    }
    expect(s.content).toHaveBeenCalledTimes(1);
    expect(s.backend).not.toHaveBeenCalled();
  });

  it('serializes a standalone executable platform module without any secret values', async () => {
    const source = buildPublicationGatewayModule(config);
    expect(source).not.toContain('platform-secret');
    expect(source).not.toContain('verify-secret');
    const fetcher = vi.fn(async () => Response.json({ allowed: false }));
    const scope = { URL, URLSearchParams, Request, Response, Headers, AbortSignal, fetch: fetcher, gateway: undefined as any };
    runInNewContext(source.replace('export default', 'globalThis.gateway ='), scope);
    expect((await scope.gateway.fetch(new Request('https://app.coden.fun/assets.js'), { CODEN_PLATFORM_SECRET: 'server-only' })).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('bounded platform HTML metadata for static and SSR responses', () => {
  const metadata = {
    title: 'Manual & <title> "quoted"', description: 'Safe "description" & <b>markup</b> \'apostrophe\'',
    favicon: '/icons/manual.svg', image: '/images/social.png',
  };
  const original = '<!doctype html><html><head><meta charset="utf-8"><title>OLD TITLE</title>'
    + '<meta content="OLD DESCRIPTION" name=description><meta property="og:title" content="OLD OG">'
    + '<meta content="OLD IMAGE" property="og:image"><meta property="og:image:width" content="999">'
    + '<link href="/old.ico" rel="shortcut icon"><link href="https://old.example" rel=canonical>'
    + '<meta name="viewport" content="width=device-width"><meta name="coden-release" content="release-2">'
    + '</head><body><h1>SSR body untouched</h1><svg><title>SVG title untouched</title></svg></body></html>';

  it('overrides SSR title/description/favicon/OG with escaped current metadata and canonical platform URLs', async () => {
    const s = setup({}, { metadata });
    s.content.mockResolvedValueOnce(new Response(original, { headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '1', 'Content-Encoding': 'identity',
      ETag: 'old-etag', 'Content-MD5': 'old-md5', Digest: 'old-digest', 'Content-Digest': 'old',
      'Repr-Digest': 'old', 'Accept-Ranges': 'bytes', 'X-App-Header': 'retained',
    } }));
    const response = await s.request('/nested/ssr?x=1', { headers: { 'Accept-Encoding': 'br, gzip', 'If-None-Match': 'old-etag' } });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('<title>Manual &amp; &lt;title&gt; &quot;quoted&quot;</title>');
    expect(body).toContain('content="Safe &quot;description&quot; &amp; &lt;b&gt;markup&lt;/b&gt; &#39;apostrophe&#39;"');
    expect(body).toContain('<meta property="og:title" content="Manual &amp; &lt;title&gt; &quot;quoted&quot;">');
    expect(body).toContain('<meta property="og:description"');
    expect(body).toContain('<meta property="og:image" content="https://app.coden.fun/images/social.png">');
    expect(body).toContain('<meta property="og:url" content="https://app.coden.fun">');
    expect(body).toContain('<link rel="canonical" href="https://app.coden.fun">');
    expect(body).toContain('<link rel="icon" href="/icons/manual.svg">');
    expect(body).not.toMatch(/OLD TITLE|OLD DESCRIPTION|OLD OG|OLD IMAGE|old\.ico|old\.example|og:image:width/);
    expect(body).toContain('<meta name="viewport" content="width=device-width">');
    expect(body).toContain('<meta name="coden-release" content="release-2">');
    expect(body).toContain('<svg><title>SVG title untouched</title></svg>');
    expect(body).toContain('<h1>SSR body untouched</h1>');
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Content-MD5', 'Digest', 'Content-Digest', 'Repr-Digest', 'Accept-Ranges']) expect(response.headers.get(name)).toBeNull();
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('X-App-Header')).toBe('retained');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(s.content.mock.calls[0][0].headers.get('Accept-Encoding')).toBe('identity');
    expect(s.content.mock.calls[0][0].headers.get('If-None-Match')).toBeNull();
    expect(s.backend).toHaveBeenCalledTimes(1); // No metadata asset/URL fetch.
  });

  it('preserves raw hydration JS, styles, comments, template metadata and body titles byte-for-byte', async () => {
    const s = setup({}, { metadata });
    const script = '<script>const html = \'<head><title>hydration title</title><meta name="description" content="JS data"></head>\';</script>';
    const style = '<style>.x::before { content: "<title>CSS title</title>"; }</style>';
    const comment = '<!-- <head><title>comment title</title></head> -->';
    const template = '<template><head><title>template title</title><meta name="description" content="template data"></head></template>';
    s.content.mockResolvedValueOnce(new Response(`<!doctype html><html>${comment}<head>${script}${style}${template}<title>replace me</title></head><body><title>body title</title></body></html>`, { headers: { 'Content-Type': 'text/html' } }));
    const body = await (await s.request()).text();
    for (const chunk of [script, style, comment, template, '<body><title>body title</title></body>']) expect(body).toContain(chunk);
    expect(body).not.toContain('replace me');
  });

  it.each([
    '<!doctype html><html><body><h1>SSR</h1></body></html>',
    '<title>old fragment title</title><meta name="description" content="old"><h1>SSR fragment</h1>',
  ])('adds a head when an HTML document/fragment does not provide one', async html => {
    const s = setup({}, { metadata });
    s.content.mockResolvedValueOnce(new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    const body = await (await s.request()).text();
    expect(body).toContain('<head>');
    expect(body).toContain('<title>Manual &amp;');
    expect(body).not.toContain('old fragment title');
    expect(body).toContain('<h1>SSR');
    if (html.startsWith('<!doctype')) expect(body.startsWith('<!doctype html><html><head>')).toBe(true);
  });

  it('treats null favicon/social image as explicit clearing and escapes attempted element/attribute injection', async () => {
    const s = setup({}, { metadata: { title: '</title><script>alert(1)</script>', description: '" onload="steal', favicon: null, image: null } });
    s.content.mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'text/html' } }));
    const body = await (await s.request()).text();
    expect(body).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('&quot; onload=&quot;steal');
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).not.toMatch(/rel="(?:shortcut )?icon"|property="og:image/);
    expect(s.backend).toHaveBeenCalledTimes(1);
  });

  it.each(['https://external.example/asset.png', '//external.example/asset.png', 'javascript:alert(1)', '/%2f%2fexternal.example/file', '/a/../secret'])('rejects unsafe metadata assets without any external fetch: %s', async path => {
    const s = setup({}, { metadata: { ...metadata, image: path } });
    expect((await s.request()).status).toBe(503);
    expect(s.backend).not.toHaveBeenCalled();
    expect(s.content).not.toHaveBeenCalled();
  });

  it('never reaches/re-writes content before authorization or matching release identity', async () => {
    for (const decision of [{ allowed: false }, { allowed: true, release_id: 'old-release' }]) {
      const s = setup(decision, { metadata });
      const response = await s.request();
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await response.text()).not.toContain(metadata.title);
      expect(s.content).not.toHaveBeenCalled();
    }
  });

  it('does not strip conditional mutation semantics from runtime POST requests', async () => {
    const s = setup({}, { metadata });
    s.content.mockResolvedValueOnce(new Response('{"created":true}', { headers: { 'Content-Type': 'application/json' } }));
    await s.request('/api/create', { method: 'POST', body: 'new data', headers: { 'If-None-Match': '*', 'If-Modified-Since': 'yesterday', 'If-Match': 'revision' } });
    const forwarded = s.content.mock.calls[0][0];
    expect(forwarded.headers.get('If-None-Match')).toBe('*');
    expect(forwarded.headers.get('If-Modified-Since')).toBe('yesterday');
    expect(forwarded.headers.get('If-Match')).toBe('revision');
    expect(await forwarded.text()).toBe('new data');
  });

  it.each(['gzip', 'deflate'] as const)('rewrites bounded %s HTML and drops its old content encoding', async encoding => {
    const s = setup({}, { metadata });
    const compressed = encoding === 'gzip' ? gzipSync(original) : deflateSync(original);
    s.content.mockResolvedValueOnce(new Response(Uint8Array.from(compressed), { headers: { 'Content-Type': 'text/html', 'Content-Encoding': encoding } }));
    const response = await s.request();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Manual &amp;');
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  it('handles an already-decoded Workers HTML stream carrying its original compression header', async () => {
    const s = setup({}, { metadata });
    s.content.mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'br' } }));
    const response = await s.request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Encoding')).toBeNull();
    expect(await response.text()).toContain('Manual &amp;');
  });

  it('cancels oversized HTML without returning partial content or sensitive error details', async () => {
    const s = setup({}, { metadata });
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('<html><head></head><body>'));
      controller.enqueue(new Uint8Array(2 * 1024 * 1024).fill(65));
    }, cancel() { cancelled = true; } });
    s.content.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'text/html' } }));
    const response = await s.request();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
    expect(cancelled).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('bounds decompressed bytes too, not just a small compressed input', async () => {
    const s = setup({}, { metadata });
    const compressed = gzipSync('<html><head></head><body>' + 'x'.repeat(2 * 1024 * 1024) + '</body></html>');
    s.content.mockResolvedValueOnce(new Response(Uint8Array.from(compressed), { headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'gzip' } }));
    expect((await s.request()).status).toBe(503);
  });

  it('does not buffer or rewrite non-HTML runtime data or HTML when no metadata is supplied', async () => {
    for (const contentType of ['application/json', 'application/javascript']) {
      const s = setup({}, { metadata });
      const data = JSON.stringify({ literal: '<title>untouched</title>' });
      s.content.mockResolvedValueOnce(new Response(data, { status: 201, headers: { 'Content-Type': contentType, 'Content-Length': String(data.length), ETag: 'app-etag' } }));
      const response = await s.request('/api/data');
      expect(response.status).toBe(201);
      expect(await response.text()).toBe(data);
      expect(response.headers.get('ETag')).toBe('app-etag');
      expect(response.headers.get('Content-Length')).toBe(String(data.length));
    }
    const s = setup();
    s.content.mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'text/html', ETag: 'unchanged' } }));
    const response = await s.request();
    expect(await response.text()).toBe(original);
    expect(response.headers.get('ETag')).toBe('unchanged');
  });

  it('preserves HEAD semantics without an incorrect old representation length', async () => {
    const s = setup({}, { metadata });
    s.content.mockResolvedValueOnce(new Response(null, { headers: { 'Content-Type': 'text/html', 'Content-Length': '123', 'Content-Encoding': 'gzip', ETag: 'old' } }));
    const response = await s.request('/', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  it.each([
    { status: 206, headers: { 'Content-Type': 'text/html', 'Content-Range': 'bytes 0-4/100' }, body: '<html' },
    { status: 200, headers: { 'Content-Type': 'text/html; charset=shift_jis' }, body: '<html></html>' },
    { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Encoding': 'zstd' }, body: 'opaque encoded bytes' },
    { status: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><head><script>unclosed' },
  ])('fails closed instead of returning unsafe/malformed rewritten HTML: %j', async value => {
    const s = setup({}, { metadata });
    const headers = new Headers();
    for (const [name, headerValue] of Object.entries(value.headers)) {
      if (headerValue !== undefined) headers.set(name, headerValue);
    }
    s.content.mockResolvedValueOnce(new Response(value.body, { status: value.status, headers }));
    const response = await s.request();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('applies the same current metadata to protected root verification without forwarding credentials', async () => {
    const s = setup({}, { metadata, mode: 'candidate', candidateHost: 'candidate.account.workers.dev' });
    s.content.mockResolvedValueOnce(new Response(original, { headers: { 'Content-Type': 'text/html' } }));
    const response = await s.gateway.fetch(new Request(`https://candidate.account.workers.dev${PUBLICATION_PROBE_PATH}`, {
      headers: { 'X-Coden-Publication-Verification': 'verify-secret', Cookie: 'never=forward' },
    }), s.env);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Manual &amp;');
    expect(response.headers.get('X-Coden-Publication-Release')).toBe(config.releaseId);
    expect(s.backend).not.toHaveBeenCalled();
    expect(s.content.mock.calls[0][0].headers.get('Cookie')).toBeNull();
  });

  it('runs metadata rewriting from the exact serialized standalone Worker module in Node', async () => {
    const source = buildPublicationGatewayModule({ ...config, metadata });
    const fetcher = vi.fn(async () => Response.json({ allowed: true, release_id: config.releaseId }));
    const scope = { URL, URLSearchParams, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder,
      Uint8Array, DecompressionStream, fetch: fetcher, gateway: undefined as any };
    runInNewContext(source.replace('export default', 'globalThis.gateway ='), scope);
    const response = await scope.gateway.fetch(new Request('https://app.coden.fun/'), { CODEN_PLATFORM_SECRET: 'server-only', CONTENT: {
      fetch: async () => new Response(original, { headers: { 'Content-Type': 'text/html' } }),
    } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Manual &amp;');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
