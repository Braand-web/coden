/**
 * The web, for the agent, while it works.
 *
 * The coder knew only what its training knew: a library's API as it was a
 * year ago, an error it had never seen, a service whose setup changed last
 * month. Two tools change that, and they are ordinary tools in its loop, used
 * when it decides it needs them:
 *
 *   - `web_search` asks a search provider (Firecrawl, Tavily or Brave when one
 *     is configured, otherwise OpenRouter's own web search) and returns
 *     titles, links and excerpts;
 *   - `fetch_url` reads one page — a documentation page, a changelog, an
 *     issue — as plain text.
 *
 * `fetch_url` runs on the Coden server, so it only goes to the public web:
 * http(s) only, every address the name resolves to must be public (no
 * loopback, private ranges, link-local or cloud metadata), redirects are
 * followed by hand and checked the same way, and size and time are bounded.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { ResearchResult } from './web-research-gateway.ts';

export type AgentWebResult =
  | { ok: true; [key: string]: unknown }
  | { ok: false; error: string; hint?: string };

export type AgentWebProvider = {
  search(query: string): Promise<AgentWebResult>;
  fetch(url: string): Promise<AgentWebResult>;
};

let activeProvider: AgentWebProvider | null = null;
/** Installed once at boot; absent, the tools say so instead of failing. */
export function setAgentWebProvider(provider: AgentWebProvider | null) { activeProvider = provider; }
export function agentWebProvider(): AgentWebProvider | null { return activeProvider; }

const MAX_BYTES = 1_500_000;
const MAX_TEXT = 12_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

/** True for any address that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(ip) === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7));
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(ip);
  }
  return true;
}

type Lookup = (hostname: string) => Promise<Array<{ address: string }>>;
const defaultLookup: Lookup = hostname => dnsLookup(hostname, { all: true, verbatim: true });

async function assertPublicUrl(raw: string, lookup: Lookup): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Not a valid URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https pages can be read.');
  if (url.username || url.password) throw new Error('URLs with credentials are not read.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error('Only public addresses can be read.');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host);
  if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) {
    throw new Error('Only public addresses can be read.');
  }
  return url;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** Readable text out of an HTML page: no scripts, no styles, one line per block. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim();
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre|\/section|\/article|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?[a-z0-9]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32);
      if (key.startsWith('#')) return String.fromCodePoint(Number(key.slice(1)) || 32);
      return match;
    })
    .split('\n')
    .map(line => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title, text: body };
}

/** One public page, as text. */
export async function fetchPublicPage(raw: string, deps: { fetchImpl?: typeof fetch; lookup?: Lookup } = {}): Promise<AgentWebResult> {
  const fetchImpl = deps.fetchImpl || fetch;
  const lookup = deps.lookup || defaultLookup;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let url = await assertPublicUrl(String(raw || '').trim(), lookup);
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetchImpl(url.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'CodenAgent/1.0 (+https://coden.fun)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        url = await assertPublicUrl(new URL(response.headers.get('location')!, url).href, lookup);
        continue;
      }
      break;
    }
    if (!response) return { ok: false, error: 'No response.' };
    if (response.status >= 300 && response.status < 400) return { ok: false, error: 'Too many redirects.' };
    if (!response.ok) return { ok: false, error: `The page answered HTTP ${response.status}.` };
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (type && !/text\/|json|xml|javascript/.test(type)) return { ok: false, error: `Not a text page (${type.split(';')[0]}).` };
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        chunks.push(value);
        if (size >= MAX_BYTES) { await reader.cancel().catch(() => undefined); break; }
      }
    }
    const bodyText = Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
    const page = /html/.test(type) || /<html|<body/i.test(bodyText.slice(0, 2_000)) ? htmlToText(bodyText) : { title: '', text: bodyText };
    const text = page.text.length > MAX_TEXT ? `${page.text.slice(0, MAX_TEXT)}\n…[truncated; ${page.text.length - MAX_TEXT} more characters]` : page.text;
    return { ok: true, url: url.href, title: page.title, text };
  } catch (error: any) {
    const message = controller.signal.aborted ? 'The page took too long to answer.' : String(error?.message || 'The page could not be read.');
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

function fromResearch(result: ResearchResult): AgentWebResult {
  if (result.status !== 'completed') return { ok: false, error: result.message || 'The search did not complete.' };
  return {
    ok: true,
    provider: result.provider,
    results: result.results.map(item => ({ title: item.title, url: item.url, excerpt: item.snippet, date: item.published_at || undefined })),
  };
}

/**
 * The provider Coden installs: a configured search API first, OpenRouter's
 * web search otherwise, and the page reader for `fetch_url`.
 */
export function createAgentWebProvider(deps: {
  research?: { isConfigured(): boolean; search(query: string, options?: { maxResults?: number }): Promise<ResearchResult> };
  /** A model call with web search enabled, returning its answer with sources. */
  modelSearch?: (query: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  lookup?: Lookup;
}): AgentWebProvider {
  return {
    async search(query) {
      const clean = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!clean) return { ok: false, error: 'An empty search.' };
      if (deps.research?.isConfigured()) {
        const result = fromResearch(await deps.research.search(clean, { maxResults: 5 }));
        if (result.ok || !deps.modelSearch) return result;
      }
      if (!deps.modelSearch) return { ok: false, error: 'Web search is not configured on this server.' };
      try {
        const answer = String(await deps.modelSearch(clean) || '').trim();
        return answer ? { ok: true, provider: 'openrouter-web', summary: answer.slice(0, 6_000) } : { ok: false, error: 'The search returned nothing.' };
      } catch (error: any) {
        return { ok: false, error: String(error?.message || 'The search failed.').slice(0, 300) };
      }
    },
    fetch(url) {
      return fetchPublicPage(url, { fetchImpl: deps.fetchImpl, lookup: deps.lookup });
    },
  };
}
