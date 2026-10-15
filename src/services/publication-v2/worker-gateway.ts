/** Platform-owned code only. Project modules run in a DIFFERENT Worker/isolate. */
export const PUBLICATION_PROVIDER_VERSION = 'coden-cloudflare-workers/v2' as const;
export const PUBLICATION_VERIFY_PATH = '/_coden/publication/verify';
export const PUBLICATION_PROBE_PATH = '/_coden/publication/probe';
export const PUBLICATION_EXCHANGE_PATH = '/_coden/publication/exchange';
export const PUBLICATION_SESSION_COOKIE = '__Host-coden_publication_session';

/** The access server must bind codes/sessions to project + exact host, consume
 * codes once, and consult CURRENT policy on every call (including public apps).
 * For an allowed response, release_id is required by the gateway. */
export interface PublicationAccessRequest {
  project_id: string;
  host: string;
  session?: string;
  code?: string;
  return_path?: string;
}

export interface PublicationAccessResponse {
  allowed: boolean;
  public?: boolean;
  redirect_url?: string;
  login_url?: string;
  session_token?: string;
  max_age?: number;
  primary_host?: string;
  release_id?: string;
  return_path?: string;
}

export interface PublicationGatewayMetadata {
  title: string;
  description: string;
  favicon: string | null;
  image: string | null;
}

export interface PublicationGatewayConfig {
  providerVersion: typeof PUBLICATION_PROVIDER_VERSION;
  projectId: string;
  releaseId: string;
  policyRevision: string;
  artifactDigest: string;
  platformOrigin: string;
  primaryHost: string;
  allowedHosts: readonly string[];
  mode: 'candidate' | 'active';
  candidateHost?: string;
  /** Current snapshot settings, never recovered from an old content artifact. */
  metadata?: PublicationGatewayMetadata;
}

export interface PublicationGatewayEnv {
  CODEN_PLATFORM_SECRET: string;
  CODEN_VERIFY_SECRET: string;
  CONTENT: { fetch(request: Request): Promise<Response> };
}

/** Self-contained so the SAME tested function can be serialized as a module.
 * There is deliberately no project-code import, shared env, audience snapshot,
 * response cache, preview-host fallback, or browser-visible platform secret. */
export function createPublicationGateway(config: PublicationGatewayConfig, fetcher: typeof fetch = fetch) {
  const cookieName = '__Host-coden_publication_session';
  const prefix = '/_coden/publication/';
  const denyHeaders = {
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Cloudflare-CDN-Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Cookie',
  };
  function reply(status: number, text = '', extra: Record<string, string> = {}) {
    return new Response(text || null, { status, headers: { ...denyHeaders, ...extra } });
  }
  function validMetadata() {
    const m = config.metadata;
    if (m === undefined) return true;
    const asset = (value: unknown) => value === null || (typeof value === 'string' && value.length <= 512
      && /^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(value) && !/(?:%2e|%2f|%5c|\.\.)/i.test(value));
    return Boolean(m && typeof m === 'object' && typeof m.title === 'string' && m.title.trim() && m.title.length <= 120
      && typeof m.description === 'string' && m.description.length <= 320 && asset(m.favicon) && asset(m.image));
  }
  function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }
  function rewriteHtml(html: string) {
    const metadata = config.metadata!;
    const origin = `https://${config.primaryHost}`;
    const tags = [
      `<title>${escapeHtml(metadata.title)}</title>`,
      `<meta name="description" content="${escapeHtml(metadata.description)}">`,
      `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
      `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
      `<meta property="og:url" content="${escapeHtml(origin)}">`,
      `<link rel="canonical" href="${escapeHtml(origin)}">`,
      ...(metadata.favicon ? [`<link rel="icon" href="${escapeHtml(metadata.favicon)}">`] : []),
      ...(metadata.image ? [`<meta property="og:image" content="${escapeHtml(new URL(metadata.image, origin).href)}">`] : []),
    ].join('\n');
    // Tokenize tags with quoted attributes. Skip raw-text elements entirely,
    // and ignore inert templates, so hydration JS/CSS/comments/body SVG titles
    // cannot be mistaken for document-head metadata. No project code executes.
    const pattern = /<!--(?:[\s\S]*?-->)|<![^>]*>|<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;
    const tokens: Array<{ start: number; end: number; name: string; closing: boolean; tag: string; depth: number }> = [];
    let templateDepth = 0;
    for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
      const parsed = /^<(\/)?([a-zA-Z][a-zA-Z0-9:-]*)\b/.exec(match[0]);
      if (!parsed) continue;
      const name = parsed[2].toLowerCase();
      const closing = Boolean(parsed[1]);
      if (closing && name === 'template') templateDepth = Math.max(0, templateDepth - 1);
      let end = pattern.lastIndex;
      if (!closing && ['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes'].includes(name)) {
        const close = new RegExp(`</${name}\\s*>`, 'gi');
        close.lastIndex = end;
        const found = close.exec(html);
        if (!found) throw new Error('Unclosed HTML raw-text element');
        end = close.lastIndex;
        pattern.lastIndex = end;
      }
      tokens.push({ start: match.index, end, name, closing, tag: match[0], depth: templateDepth });
      if (tokens.length > 20_000) throw new Error('HTML head exceeds rewrite complexity limit');
      if (templateDepth === 0 && (name === 'body' || (name === 'head' && closing))) break;
      if (templateDepth === 0 && !closing && !['html', 'head', 'title', 'base', 'link', 'meta', 'noscript', 'script', 'style', 'template'].includes(name)) break;
      if (!closing && name === 'template') templateDepth++;
    }
    const visible = tokens.filter(token => token.depth === 0);
    const head = visible.find(token => token.name === 'head' && !token.closing);
    const htmlTag = visible.find(token => token.name === 'html' && !token.closing);
    const headEnd = head ? visible.find(token => token.start >= head.end && token.name === 'head' && token.closing)?.start : undefined;
    if (head && headEnd === undefined) throw new Error('Unclosed HTML head');
    const insert = head?.end ?? htmlTag?.end ?? (/^\s*<!doctype\b[^>]*>/i.exec(html)?.[0].length || 0);
    const end = headEnd ?? visible.find(token => token.start >= insert && !token.closing
      && !['html', 'head', 'title', 'base', 'link', 'meta', 'noscript', 'script', 'style', 'template'].includes(token.name))?.start ?? html.length;
    function attributes(tag: string) {
      const result: Record<string, string> = {};
      const source = tag.replace(/^<\/?[a-zA-Z][a-zA-Z0-9:-]*/, '').replace(/\/?\s*>$/, '');
      for (const match of source.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        // Numeric references cover generated/escaped attribute names without
        // interpreting content as HTML or fetching any metadata asset.
        const value = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&#(x[0-9a-f]+|\d+);?/gi, (_all, code: string) => {
          const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
          return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
        });
        result[match[1].toLowerCase()] = value;
      }
      return result;
    }
    const remove = visible.filter(token => {
      if (token.closing || token.start < insert || token.end > end) return false;
      if (token.name === 'title') return true;
      if (token.name !== 'meta' && token.name !== 'link') return false;
      const attr = attributes(token.tag);
      const property = (attr.property || attr.name || '').toLowerCase();
      return token.name === 'meta'
        ? property === 'description' || ['og:title', 'og:description', 'og:url', 'og:image'].includes(property) || property.startsWith('og:image:')
        : (attr.rel || '').toLowerCase().split(/\s+/).some(rel => rel === 'canonical' || rel === 'icon');
    });
    let rewritten = html.slice(0, insert) + (head ? `\n${tags}\n` : `<head>\n${tags}\n</head>`);
    let cursor = insert;
    for (const token of remove) { rewritten += html.slice(cursor, token.start); cursor = token.end; }
    return rewritten + html.slice(cursor);
  }
  async function boundedBytes(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('HTML exceeds metadata rewrite limit'); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async function metadataBody(response: Response, output: Headers, method: string) {
    if (!config.metadata || !/^text\/html(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')
      || [101, 204, 205].includes(response.status)) return response.body;
    if (response.status === 206 || response.status === 304 || response.headers.has('Content-Range')) throw new Error('Partial HTML cannot be rewritten');
    // Body length, encoding and validators describe the OLD representation.
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Content-MD5', 'Digest', 'Content-Digest', 'Repr-Digest', 'Accept-Ranges']) output.delete(name);
    output.set('Content-Type', 'text/html; charset=utf-8');
    if (method === 'HEAD') return null;
    if (!response.body) return null;
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(response.headers.get('Content-Type') || '')?.[1].toLowerCase();
    if (charset && !['utf-8', 'utf8', 'us-ascii'].includes(charset)) throw new Error('Unsupported HTML charset');
    let bytes = await boundedBytes(response.body);
    const encoding = (response.headers.get('Content-Encoding') || 'identity').trim().toLowerCase();
    const gzip = encoding === 'gzip' && bytes[0] === 0x1f && bytes[1] === 0x8b;
    const deflate = encoding === 'deflate' && (bytes[0] & 15) === 8 && ((bytes[0] << 8) + bytes[1]) % 31 === 0;
    if (gzip || deflate) {
      bytes = await boundedBytes(new Response(bytes).body!.pipeThrough(new DecompressionStream(gzip ? 'gzip' : 'deflate')));
    } else if (encoding !== 'identity') {
      // Workers may expose an already-decoded body with its original encoding
      // header. Accept only recognizable decoded HTML; never relabel encoded
      // brotli/unknown binary as text. Upstream is requested with identity.
      if (!['gzip', 'deflate', 'br'].includes(encoding)
        || !new TextDecoder('utf-8', { fatal: true }).decode(bytes).trimStart().startsWith('<')) throw new Error('Unsupported encoded HTML');
    }
    const result = rewriteHtml(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (new TextEncoder().encode(result).byteLength > 2 * 1024 * 1024) throw new Error('Rewritten HTML exceeds limit');
    return result;
  }
  function safePath(value: string | null): string | null {
    if (!value || value.length > 4096 || !value.startsWith('/')) return null;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)
        || decoded.startsWith(prefix) || decoded.startsWith('/__coden/access/') || value.includes('#')) return null;
      const parsed = new URL(value, 'https://return.invalid');
      return parsed.origin === 'https://return.invalid' ? value : null;
    } catch { return null; }
  }
  function session(request: Request): string | undefined {
    const values = (request.headers.get('Cookie') || '').split(';')
      .map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
    if (values.length !== 1) return undefined;
    const value = values[0].slice(cookieName.length + 1);
    return /^[A-Za-z0-9._~-]{1,4096}$/.test(value) ? value : undefined;
  }
  function validDecision(value: unknown): value is PublicationAccessResponse {
    return Boolean(value && typeof value === 'object'
      && typeof (value as PublicationAccessResponse).allowed === 'boolean');
  }
  async function access(endpoint: 'authorize' | 'exchange', body: PublicationAccessRequest, secret: string) {
    const response = await fetcher(`${config.platformOrigin}/api/publication-access/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok || response.redirected) throw new Error('Access unavailable');
    const decision: unknown = await response.json();
    if (!validDecision(decision)) throw new Error('Invalid access response');
    return decision;
  }
  function matchesRelease(decision: PublicationAccessResponse) {
    return decision.release_id === config.releaseId
      && (decision.primary_host === undefined || decision.primary_host === config.primaryHost);
  }
  function marker() {
    return reply(200, JSON.stringify({
      provider_version: config.providerVersion, project_id: config.projectId,
      release_id: config.releaseId, policy_revision: config.policyRevision, artifact_digest: config.artifactDigest,
    }), { 'Content-Type': 'application/json' });
  }
  async function contentProbe(env: PublicationGatewayEnv) {
    // Fixed origin/path, fresh request, and NO incoming cookies, authorization,
    // verification secret, or arbitrary URL/query forwarded to project code.
    const response = await env.CONTENT.fetch(new Request(`https://${config.primaryHost}/`, {
      method: 'GET', headers: { Accept: 'text/html, application/json;q=0.9', 'Accept-Encoding': 'identity' }, redirect: 'manual',
    }));
    const output = new Headers({
      ...denyHeaders,
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'X-Coden-Publication-Release': config.releaseId,
      'X-Coden-Publication-Artifact': config.artifactDigest,
      'X-Coden-Publication-Provider': config.providerVersion,
    });
    const body = await metadataBody(response, output, 'GET');
    return new Response(body, { status: response.status, headers: output });
  }
  return {
    async fetch(request: Request, env: PublicationGatewayEnv): Promise<Response> {
      try {
        if (config.providerVersion !== 'coden-cloudflare-workers/v2'
          || !['candidate', 'active'].includes(config.mode)
          || new URL(config.platformOrigin).origin !== config.platformOrigin
          || !config.platformOrigin.startsWith('https://') || !validMetadata()) return reply(503);
        const url = new URL(request.url);
        if (url.protocol !== 'https:' || url.port || url.username || url.password) return reply(421);
        if (config.mode === 'candidate') {
          // Ordinary staging URLs never serve content. The narrow protected
          // probe can fetch ONLY root for preactivation content verification.
          if (url.hostname !== config.candidateHost || request.method !== 'GET'
            || ![`${prefix}verify`, `${prefix}probe`].includes(url.pathname) || url.search
            || !env.CODEN_VERIFY_SECRET
            || request.headers.get('X-Coden-Publication-Verification') !== env.CODEN_VERIFY_SECRET) return reply(404);
          return url.pathname === `${prefix}verify` ? marker() : await contentProbe(env);
        }
        if (!config.allowedHosts.includes(url.hostname) || url.hostname.endsWith('.workers.dev')
          || !config.allowedHosts.includes(config.primaryHost)) return reply(421);
        // Live probing happens BEFORE the database flips release_id. The only
        // bypasses are marker identity and a fixed-root secret-only probe.
        if ([`${prefix}verify`, `${prefix}probe`].includes(url.pathname)) {
          return request.method === 'GET' && !url.search && env.CODEN_VERIFY_SECRET
            && request.headers.get('X-Coden-Publication-Verification') === env.CODEN_VERIFY_SECRET
            ? url.pathname === `${prefix}verify` ? marker() : await contentProbe(env) : reply(404);
        }
        if (!env.CODEN_PLATFORM_SECRET) return reply(503);
        if (url.pathname === `${prefix}exchange`) {
          if (request.method !== 'GET') return reply(405, '', { Allow: 'GET' });
          const code = url.searchParams.get('code');
          const returnPath = safePath(url.searchParams.get('return_path') || '/');
          if (!code || code.length > 4096 || !returnPath
            || url.searchParams.getAll('code').length !== 1
            || url.searchParams.getAll('return_path').length > 1) return reply(400);
          const decision = await access('exchange', {
            project_id: config.projectId, host: url.hostname, code, return_path: returnPath,
          }, env.CODEN_PLATFORM_SECRET);
          // Exchange mints no application response. Main's one-time-code store
          // owns the return path; all content is separately release-authorized.
          if (!decision.allowed || (decision.release_id !== undefined && !matchesRelease(decision))
            || (decision.primary_host !== undefined && decision.primary_host !== config.primaryHost)) return reply(403);
          const destination = typeof decision.return_path === 'string' ? safePath(decision.return_path) : null;
          if (!destination) return reply(502);
          if (typeof decision.session_token !== 'string'
            || !/^[A-Za-z0-9._~-]{1,4096}$/.test(decision.session_token)
            || !Number.isSafeInteger(decision.max_age) || decision.max_age! <= 0) return reply(502);
          const maxAge = Math.min(decision.max_age!, 86400);
          return reply(303, '', {
            Location: destination,
            'Set-Cookie': `${cookieName}=${decision.session_token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`,
          });
        }
        if (url.pathname.startsWith(prefix) || url.pathname.startsWith('/__coden/access/')) return reply(404);
        const returnPath = safePath(url.pathname + url.search) || '/';
        const decision = await access('authorize', {
          project_id: config.projectId, host: url.hostname, session: session(request), return_path: returnPath,
        }, env.CODEN_PLATFORM_SECRET);
        if (!decision.allowed) {
          if (request.method === 'GET' && request.headers.get('Accept')?.includes('text/html')) {
            // Both login_url (current access API) and redirect_url (older
            // adapters) are advisory. Canonicalize to the known handshake;
            // neither field can introduce an open redirect or different host.
            const target = new URL('/publication-auth', config.platformOrigin);
            target.search = new URLSearchParams({ project_id: config.projectId, host: url.hostname, return_path: returnPath }).toString();
            return reply(302, '', { Location: target.href });
          }
          return reply(401);
        }
        if (!matchesRelease(decision)) return reply(503);
        const headers = new Headers(request.headers);
        // Never disclose the HttpOnly gateway session or verification capability
        // to application runtime code. Leave unrelated application cookies intact.
        const cookies = (headers.get('Cookie') || '').split(';').map(p => p.trim())
          .filter(p => p && p.split('=', 1)[0] !== cookieName).join('; ');
        if (cookies) headers.set('Cookie', cookies); else headers.delete('Cookie');
        for (const key of Array.from(headers.keys())) {
          if (key.toLowerCase().startsWith('x-coden-publication-')) headers.delete(key);
        }
        if (config.metadata) {
          headers.set('Accept-Encoding', 'identity');
          if (request.method === 'GET' || request.method === 'HEAD') {
            headers.delete('If-None-Match'); headers.delete('If-Modified-Since');
            if (headers.get('Accept')?.toLowerCase().includes('text/html')) { headers.delete('Range'); headers.delete('If-Range'); }
          }
        }
        const response = await env.CONTENT.fetch(new Request(request, { headers, redirect: 'manual' }));
        const output = new Headers(response.headers);
        for (const [key, value] of Object.entries(denyHeaders)) output.set(key, value);
        output.delete('Surrogate-Control');
        // A project cannot replace the platform's host-only session cookie.
        if (output.get('Set-Cookie')?.includes(cookieName)) output.delete('Set-Cookie');
        // Preserve Worker WebSocket upgrades, which carry no cacheable body.
        const upgrade = (response as Response & { webSocket?: unknown }).webSocket;
        const body = await metadataBody(response, output, request.method);
        return new Response(body, {
          status: response.status, statusText: response.statusText, headers: output,
          ...(upgrade ? { webSocket: upgrade } : {}),
        });
      } catch {
        // No error body can contain provider/backend responses or secrets.
        return reply(503);
      }
    },
  };
}

export function buildPublicationGatewayModule(config: PublicationGatewayConfig): string {
  return `const createGateway = ${createPublicationGateway.toString()};\nexport default createGateway(${JSON.stringify(config)});\n`;
}
