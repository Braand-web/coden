/**
 * A web page, read the way a person sees it.
 *
 * `previewLink` is the quick look behind the card under the composer: title,
 * favicon, image, read from the HTML alone. `analyzeLink` is the real read:
 * a headless Chromium renders the page (JavaScript sites included) and Coden
 * keeps its structure, texts, colours, fonts, images and a screenshot, then,
 * when the user asks for it, a few internal pages of the same site.
 *
 * It runs on Coden's server, so it only ever reaches the public web: every
 * address a name resolves to is checked (no localhost, private ranges,
 * link-local or cloud metadata), for the page and for every request the page
 * itself makes. It honours robots.txt, stops at pages that want a login, and
 * is bounded in time and size.
 */
import { assertPublicUrl, isPrivateAddress, type Lookup } from './agent-web.ts';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const LINK_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36 CodenBot/1.0 (+https://coden.fun/bot)';
const BOT_TOKEN = 'codenbot';
const PAGE_TIMEOUT_MS = 20_000;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT = 15_000;
export const MAX_EXPLORED_PAGES = 4;

export type LinkFailureCode = 'invalid_url' | 'private_address' | 'robots' | 'login_required' | 'timeout' | 'too_large' | 'http_error' | 'unreachable' | 'not_html';

export class LinkError extends Error {
  readonly code: LinkFailureCode;
  constructor(code: LinkFailureCode, message: string) { super(message); this.name = 'LinkError'; this.code = code; }
}

export type LinkPreview = { url: string; finalUrl: string; title: string; description: string; siteName: string; favicon: string; image: string };

export type LinkPage = { url: string; title: string; headings: string[]; text: string };

export type LinkAnalysis = LinkPreview & {
  lang: string;
  headings: Array<{ level: number; text: string }>;
  navigation: Array<{ text: string; href: string }>;
  sections: Array<{ tag: string; heading: string; text: string }>;
  ctas: string[];
  images: Array<{ src: string; alt: string; width: number; height: number }>;
  colors: { backgrounds: string[]; texts: string[]; accents: string[]; variables: Record<string, string> };
  fonts: { families: string[]; googleFonts: string[] };
  text: string;
  pages: LinkPage[];
  screenshots: Array<{ role: 'viewport' | 'full'; mime: 'image/jpeg'; data: Uint8Array }>;
};

const defaultLookup: Lookup = hostname => dnsLookup(hostname, { all: true, verbatim: true });

/* ------------------------------------------------------------------------ */
/* Guarded fetch (preview and robots.txt)                                    */
/* ------------------------------------------------------------------------ */

async function guardedFetch(raw: string, options: { maxBytes: number; timeoutMs: number; accept: string; lookup?: Lookup; fetchImpl?: typeof fetch }) {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    let url = await assertPublicUrl(raw, options.lookup || defaultLookup).catch((error: Error) => {
      throw new LinkError(/public/i.test(error.message) ? 'private_address' : 'invalid_url', /public/i.test(error.message) ? 'Cette adresse n’est pas publique : Coden ne lit que des pages du web public.' : 'Ce lien n’est pas une adresse web valide.');
    });
    let response: Response | null = null;
    for (let hop = 0; hop <= 4; hop += 1) {
      response = await fetchImpl(url.href, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': LINK_USER_AGENT, accept: options.accept, 'accept-language': 'fr,en;q=0.8' } });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        url = await assertPublicUrl(new URL(location, url).href, options.lookup || defaultLookup).catch(() => {
          throw new LinkError('private_address', 'Le lien redirige vers une adresse qui n’est pas publique.');
        });
        continue;
      }
      break;
    }
    if (!response) throw new LinkError('unreachable', 'Le site n’a pas répondu.');
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        chunks.push(value);
        if (size >= options.maxBytes) { await reader.cancel().catch(() => undefined); break; }
      }
    }
    return { url, response, body: Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8') };
  } catch (error: any) {
    if (error instanceof LinkError) throw error;
    if (controller.signal.aborted) throw new LinkError('timeout', 'Le site a mis trop de temps à répondre.');
    throw new LinkError('unreachable', 'Le site est injoignable pour le moment.');
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------------ */
/* robots.txt                                                                */
/* ------------------------------------------------------------------------ */

type RobotsRule = { allow: boolean; path: string };

/** The rules that apply to Coden: its own group when there is one, `*` otherwise. */
export function robotsRules(robots: string): RobotsRule[] {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') current.rules.push({ allow: field === 'allow', path: value });
  }
  const own = groups.filter(group => group.agents.some(agent => agent !== '*' && BOT_TOKEN.includes(agent.replace(/\/.*$/, ''))));
  const chosen = own.length ? own : groups.filter(group => group.agents.includes('*'));
  return chosen.flatMap(group => group.rules);
}

function pathMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$');
  const escaped = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/** Longest match wins; on a tie, Allow wins (RFC 9309). An empty Disallow allows everything. */
export function robotsAllows(rules: RobotsRule[], pathAndQuery: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!rule.path) continue;
    if (!pathMatches(rule.path, pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

const robotsCache = new Map<string, { rules: RobotsRule[]; expires: number }>();

export async function isAllowedByRobots(url: URL, deps: { lookup?: Lookup; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const cached = robotsCache.get(url.origin);
  let rules = cached && cached.expires > Date.now() ? cached.rules : null;
  if (!rules) {
    try {
      const { response, body } = await guardedFetch(`${url.origin}/robots.txt`, { maxBytes: 500_000, timeoutMs: 5_000, accept: 'text/plain,*/*;q=0.5', ...deps });
      // 4xx: no rules. 5xx: the site cannot say, so it is treated as a refusal (RFC 9309).
      if (response.status >= 500) rules = [{ allow: false, path: '/' }];
      else rules = response.ok ? robotsRules(body) : [];
    } catch {
      rules = [];
    }
    robotsCache.set(url.origin, { rules, expires: Date.now() + 30 * 60_000 });
  }
  return robotsAllows(rules, `${url.pathname}${url.search}`);
}

/* ------------------------------------------------------------------------ */
/* Preview                                                                   */
/* ------------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (value: string) => value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
  if (entity[0] === '#') {
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[entity.toLowerCase()] ?? whole;
}).replace(/\s+/g, ' ').trim();

function metaContent(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&');
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  const tag = pattern.exec(html)?.[0] || '';
  return decode(/content=["']([^"']*)["']/i.exec(tag)?.[1] || '');
}

export function parsePreview(html: string, pageUrl: URL): Omit<LinkPreview, 'url' | 'finalUrl'> {
  const head = html.slice(0, 400_000);
  const absolute = (value: string) => { try { return value ? new URL(value, pageUrl).href : ''; } catch { return ''; } };
  const iconTag = /<link[^>]+rel=["'][^"']*\bicon\b[^"']*["'][^>]*>/i.exec(head)?.[0] || '';
  const icon = /href=["']([^"']+)["']/i.exec(iconTag)?.[1] || '/favicon.ico';
  return {
    title: metaContent(head, 'og:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || '') || pageUrl.hostname,
    description: metaContent(head, 'og:description') || metaContent(head, 'description'),
    siteName: metaContent(head, 'og:site_name') || pageUrl.hostname.replace(/^www\./, ''),
    favicon: absolute(icon),
    image: absolute(metaContent(head, 'og:image') || metaContent(head, 'twitter:image')),
  };
}

export async function previewLink(raw: string, deps: { lookup?: Lookup; fetchImpl?: typeof fetch } = {}): Promise<LinkPreview> {
  const { url, response, body } = await guardedFetch(raw, { maxBytes: 600_000, timeoutMs: 8_000, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', ...deps });
  if (response.status === 401 || response.status === 403) throw new LinkError('login_required', 'Cette page demande une connexion ou refuse les visites automatiques.');
  if (!response.ok) throw new LinkError('http_error', `Le site a répondu avec une erreur (HTTP ${response.status}).`);
  const type = String(response.headers.get('content-type') || '');
  if (type && !/html|xml/i.test(type)) throw new LinkError('not_html', 'Ce lien ne mène pas à une page web.');
  return { url: raw, finalUrl: url.href, ...parsePreview(body, url) };
}

/* ------------------------------------------------------------------------ */
/* Headless analysis                                                         */
/* ------------------------------------------------------------------------ */

let sharedBrowser: Promise<any> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let activeAnalyses = 0;
const waiting: Array<() => void> = [];

async function acquire() {
  if (activeAnalyses >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  activeAnalyses += 1;
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}
function release() {
  activeAnalyses -= 1;
  waiting.shift()?.();
  if (!activeAnalyses) {
    idleTimer = setTimeout(() => {
      const closing = sharedBrowser;
      sharedBrowser = null;
      void closing?.then(browser => browser.close()).catch(() => undefined);
    }, 120_000);
    idleTimer.unref?.();
  }
}

let extraBrowserArgs: string[] = [];
/** Tests only: map a test host name onto a local server inside Chromium. */
export function setLinkBrowserArgsForTests(args: string[]) { extraBrowserArgs = args; }

async function browser() {
  sharedBrowser ??= import('playwright').then(({ chromium }) => chromium.launch({
    headless: true,
    timeout: 20_000,
    args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions', ...extraBrowserArgs],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  })).catch(error => { sharedBrowser = null; throw error; });
  return sharedBrowser;
}

const LOGIN_PATH = /\/(login|log-in|signin|sign-in|connexion|se-connecter|auth|account\/login|users\/sign_in)(\/|$|\?)/i;

/* Runs inside the page. Kept self-contained: it is serialised by Playwright. */
function collectPage(maxText: number) {
  const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05;
  };
  const toHex = (color: string) => {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(color);
    if (!match || (match[4] !== undefined && Number(match[4]) < 0.4)) return '';
    return `#${[match[1], match[2], match[3]].map(value => Number(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  };
  const tally = (map: Map<string, number>, key: string, weight: number) => { if (key) map.set(key, (map.get(key) || 0) + weight); };
  const top = (map: Map<string, number>, count: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, count).map(entry => entry[0]);

  const backgrounds = new Map<string, number>();
  const texts = new Map<string, number>();
  const accents = new Map<string, number>();
  const families = new Map<string, number>();
  const elements = [document.documentElement, ...(document.body ? [document.body] : []), ...Array.from(document.body?.querySelectorAll('*') || []).slice(0, 2500)];
  for (const element of elements) {
    if (!visible(element)) continue;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    tally(backgrounds, toHex(style.backgroundColor), Math.min(rect.width * rect.height, 2_000_000));
    const ownText = Array.from(element.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent || '').join('').trim();
    if (ownText) {
      tally(texts, toHex(style.color), ownText.length);
      tally(families, style.fontFamily.split(',')[0].replace(/["']/g, '').trim(), ownText.length);
    }
    if (element.matches('a, button, [role="button"], input[type="submit"]')) {
      tally(accents, toHex(style.backgroundColor), 10);
      tally(accents, toHex(style.color), 3);
      tally(accents, toHex(style.borderColor), 1);
    }
  }
  const variables: Record<string, string> = {};
  const rootStyle = getComputedStyle(document.documentElement);
  for (let index = 0; index < rootStyle.length && Object.keys(variables).length < 40; index += 1) {
    const name = rootStyle[index];
    if (!name.startsWith('--')) continue;
    const value = rootStyle.getPropertyValue(name).trim();
    if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i.test(value)) variables[name] = value;
  }
  const googleFonts = Array.from(document.querySelectorAll<HTMLLinkElement>('link[href*="fonts.googleapis.com"]'))
    .flatMap(link => Array.from(new URL(link.href).searchParams.getAll('family')).map(family => family.split(':')[0].replace(/\+/g, ' ')));

  const meta = (key: string) => clean(document.querySelector<HTMLMetaElement>(`meta[property="${key}"], meta[name="${key}"]`)?.content);
  const absolute = (value: string) => { try { return new URL(value, location.href).href; } catch { return ''; } };
  const headings = Array.from(document.querySelectorAll('h1, h2, h3')).filter(visible).slice(0, 50)
    .map(heading => ({ level: Number(heading.tagName[1]), text: clean(heading.textContent).slice(0, 160) })).filter(heading => heading.text);
  const navigation = Array.from(document.querySelectorAll<HTMLAnchorElement>('header a[href], nav a[href]')).filter(visible).slice(0, 30)
    .map(link => ({ text: clean(link.textContent || link.getAttribute('aria-label')).slice(0, 60), href: link.href })).filter(link => link.text);
  const sections = Array.from(document.querySelectorAll('header, main > section, main > div > section, body > section, section, footer')).filter(visible).slice(0, 18)
    .map(section => ({
      tag: section.tagName.toLowerCase(),
      heading: clean(section.querySelector('h1, h2, h3')?.textContent).slice(0, 140),
      text: clean((section as HTMLElement).innerText).slice(0, 500),
    })).filter(section => section.text);
  const ctas = [...new Set(Array.from(document.querySelectorAll('a, button')).filter(visible)
    .filter(element => { const style = getComputedStyle(element); return toHex(style.backgroundColor) !== '' || element.tagName === 'BUTTON'; })
    .map(element => clean(element.textContent).slice(0, 50)).filter(text => text && text.length > 1))].slice(0, 20);
  const images = Array.from(document.images).filter(image => visible(image) && image.naturalWidth >= 80).slice(0, 16)
    .map(image => ({ src: image.currentSrc || image.src, alt: clean(image.alt).slice(0, 120), width: image.naturalWidth, height: image.naturalHeight }));
  const icon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.href || absolute('/favicon.ico');
  const bodyText = clean(document.body?.innerText || '');
  return {
    title: clean(document.title) || meta('og:title'),
    description: meta('og:description') || meta('description'),
    siteName: meta('og:site_name') || location.hostname.replace(/^www\./, ''),
    favicon: icon,
    image: absolute(meta('og:image')),
    lang: document.documentElement.lang || '',
    headings,
    navigation,
    sections,
    ctas,
    images,
    colors: { backgrounds: top(backgrounds, 8), texts: top(texts, 6), accents: top(accents, 6), variables },
    fonts: { families: top(families, 5), googleFonts: [...new Set(googleFonts)] },
    text: bodyText.length > maxText ? `${bodyText.slice(0, maxText)} […]` : bodyText,
    passwordFields: document.querySelectorAll('input[type="password"]').length,
    sameOriginLinks: Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href], header a[href], main a[href], footer a[href]'))
      .map(link => link.href).filter(href => { try { const url = new URL(href); return url.origin === location.origin && !url.hash; } catch { return false; } }),
  };
}

type Collected = ReturnType<typeof collectPage>;

async function isPublicHost(hostname: string, cache: Map<string, boolean>, lookup: Lookup): Promise<boolean> {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (cache.has(host)) return cache.get(host)!;
  let allowed = false;
  if (host && !/^(localhost|.*\.local|.*\.internal)$/.test(host)) {
    try {
      const addresses = isIP(host) ? [{ address: host }] : await lookup(host);
      allowed = addresses.length > 0 && !addresses.some(entry => isPrivateAddress(entry.address));
    } catch { allowed = false; }
  }
  cache.set(host, allowed);
  return allowed;
}

export async function closeLinkBrowser() {
  const closing = sharedBrowser;
  sharedBrowser = null;
  await closing?.then(instance => instance.close()).catch(() => undefined);
}

export async function analyzeLink(raw: string, options: { explore?: boolean; maxPages?: number; lookup?: Lookup; fetchImpl?: typeof fetch } = {}): Promise<LinkAnalysis> {
  const lookup = options.lookup || defaultLookup;
  const start = await assertPublicUrl(raw, lookup).catch((error: Error) => {
    throw new LinkError(/public/i.test(error.message) ? 'private_address' : 'invalid_url', /public/i.test(error.message) ? 'Cette adresse n’est pas publique : Coden ne lit que des pages du web public.' : 'Ce lien n’est pas une adresse web valide.');
  });
  if (!(await isAllowedByRobots(start, { lookup, fetchImpl: options.fetchImpl }))) throw new LinkError('robots', 'Le fichier robots.txt de ce site interdit sa lecture automatique.');

  await acquire();
  const instance = await browser().catch(() => { release(); throw new LinkError('unreachable', 'Le navigateur d’analyse n’a pas pu démarrer.'); });
  const context = await instance.newContext({
    userAgent: LINK_USER_AGENT,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'fr-FR',
    serviceWorkers: 'block',
    acceptDownloads: false,
    javaScriptEnabled: true,
  });
  const hosts = new Map<string, boolean>();
  let transferred = 0;
  try {
    // The collector is compiled on the server; a bundler's name helper must exist in the page too.
    await context.addInitScript({ content: 'globalThis.__name = globalThis.__name || (target => target);' });
    // Every request the page makes goes through the same public-address check.
    await context.route('**/*', async (route: any) => {
      const request = route.request();
      let url: URL;
      try { url = new URL(request.url()); } catch { return route.abort(); }
      if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.abort();
      if (!(await isPublicHost(url.hostname, hosts, lookup))) return route.abort('blockedbyclient');
      if (transferred > MAX_PAGE_BYTES && request.resourceType() !== 'document') return route.abort();
      if (['media', 'websocket', 'eventsource'].includes(request.resourceType())) return route.abort();
      return route.continue();
    });
    context.on('response', (response: any) => {
      const length = Number(response.headers()['content-length'] || 0);
      if (Number.isFinite(length)) transferred += length;
    });

    const page = await context.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    const visit = async (target: string) => {
      let response: any;
      try {
        response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      } catch (error: any) {
        if (/timeout/i.test(String(error?.message))) throw new LinkError('timeout', 'La page a mis plus de 20 secondes à s’afficher.');
        throw new LinkError('unreachable', 'La page n’a pas pu être ouverte (site injoignable ou bloqué).');
      }
      if (!response) throw new LinkError('unreachable', 'La page n’a rien renvoyé.');
      const status = response.status();
      if (status === 401 || status === 403) throw new LinkError('login_required', 'Cette page est privée ou refuse les visites automatiques.');
      if (status >= 400) throw new LinkError('http_error', `Le site a répondu avec une erreur (HTTP ${status}).`);
      const type = String(response.headers()['content-type'] || '');
      if (type && !/html|xml/i.test(type)) throw new LinkError('not_html', 'Ce lien ne mène pas à une page web.');
      const body = await response.body().catch(() => Buffer.alloc(0));
      if (body.length > MAX_DOCUMENT_BYTES) throw new LinkError('too_large', 'La page dépasse 5 Mo : elle est trop lourde pour être analysée.');
      await page.waitForLoadState('networkidle', { timeout: 6_000 }).catch(() => undefined);
      // Lazy sections appear on scroll: one pass down, then back to the top for the screenshot.
      await page.evaluate(async () => {
        for (let y = 0; y < Math.min(document.body.scrollHeight, 12_000); y += 900) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 80)); }
        window.scrollTo(0, 0);
      }).catch(() => undefined);
      await page.waitForTimeout(400);
      const finalUrl = new URL(page.url());
      if (!(await isPublicHost(finalUrl.hostname, hosts, lookup))) throw new LinkError('private_address', 'Le lien redirige vers une adresse qui n’est pas publique.');
      const collected: Collected = await page.evaluate(collectPage, MAX_TEXT);
      const redirectedToLogin = LOGIN_PATH.test(finalUrl.pathname) && !LOGIN_PATH.test(new URL(target).pathname);
      if (redirectedToLogin || (collected.passwordFields > 0 && collected.text.length < 1_500)) {
        throw new LinkError('login_required', 'Cette page demande une connexion : Coden ne lit pas les pages privées.');
      }
      return { finalUrl, collected };
    };

    const first = await visit(start.href);
    const sharp: any = await import('sharp').then(module => module.default || module).catch(() => null);
    const viewportShot: Buffer = await page.screenshot({ type: 'jpeg', quality: 72 });
    const fullHeight = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 6_000));
    let fullShot: Buffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: true, clip: { x: 0, y: 0, width: 1440, height: Math.max(900, fullHeight) } }).catch(() => viewportShot);
    if (sharp) fullShot = await sharp(fullShot).resize({ width: 900 }).jpeg({ quality: 70 }).toBuffer().catch(() => fullShot);

    const pages: LinkPage[] = [];
    if (options.explore) {
      const limit = Math.min(MAX_EXPLORED_PAGES, Math.max(1, options.maxPages || MAX_EXPLORED_PAGES));
      const seen = new Set([first.finalUrl.origin + first.finalUrl.pathname]);
      const candidates = first.collected.sameOriginLinks
        .map(href => new URL(href))
        .filter(url => !/\.(pdf|zip|jpe?g|png|gif|svg|mp4|webp)$/i.test(url.pathname) && !LOGIN_PATH.test(url.pathname) && !/logout|deconnexion|cart|panier|checkout/i.test(url.pathname))
        .filter(url => { const key = url.origin + url.pathname; if (seen.has(key)) return false; seen.add(key); return true; })
        .slice(0, limit);
      for (const candidate of candidates) {
        if (!(await isAllowedByRobots(candidate, { lookup, fetchImpl: options.fetchImpl }))) continue;
        try {
          const next = await visit(candidate.href);
          pages.push({ url: next.finalUrl.href, title: next.collected.title, headings: next.collected.headings.slice(0, 15).map(heading => heading.text), text: next.collected.text.slice(0, 4_000) });
        } catch { /* a page that cannot be read is skipped, not fatal */ }
      }
    }

    const { passwordFields: _passwords, sameOriginLinks: _links, ...collected } = first.collected;
    return {
      url: raw,
      finalUrl: first.finalUrl.href,
      ...collected,
      pages,
      screenshots: [
        { role: 'viewport', mime: 'image/jpeg', data: new Uint8Array(viewportShot) },
        { role: 'full', mime: 'image/jpeg', data: new Uint8Array(fullShot) },
      ],
    };
  } finally {
    await context.close().catch(() => undefined);
    release();
  }
}

/* ------------------------------------------------------------------------ */
/* For the model                                                             */
/* ------------------------------------------------------------------------ */

export function formatLinkForModel(analysis: Omit<LinkAnalysis, 'screenshots'>): string {
  const lines = [
    `Page analysée : ${analysis.title} — ${analysis.finalUrl}`,
    analysis.description ? `Description : ${analysis.description}` : '',
    analysis.lang ? `Langue : ${analysis.lang}` : '',
    analysis.headings.length ? `Structure (titres) :\n${analysis.headings.map(heading => `${'  '.repeat(heading.level - 1)}H${heading.level} ${heading.text}`).join('\n')}` : '',
    analysis.navigation.length ? `Navigation : ${analysis.navigation.map(link => link.text).join(' · ')}` : '',
    analysis.sections.length ? `Sections, dans l’ordre :\n${analysis.sections.map((section, index) => `${index + 1}. <${section.tag}>${section.heading ? ` « ${section.heading} »` : ''} — ${section.text.slice(0, 280)}`).join('\n')}` : '',
    analysis.ctas.length ? `Boutons et appels à l’action : ${analysis.ctas.join(' · ')}` : '',
    `Couleurs — fonds : ${analysis.colors.backgrounds.join(', ') || '—'} ; textes : ${analysis.colors.texts.join(', ') || '—'} ; accents : ${analysis.colors.accents.join(', ') || '—'}`,
    Object.keys(analysis.colors.variables).length ? `Variables CSS de couleur : ${Object.entries(analysis.colors.variables).slice(0, 20).map(([name, value]) => `${name}: ${value}`).join('; ')}` : '',
    `Polices : ${[...analysis.fonts.families, ...analysis.fonts.googleFonts.map(font => `${font} (Google Fonts)`)].filter((value, index, all) => all.indexOf(value) === index).join(', ') || '—'}`,
    analysis.images.length ? `Images visibles : ${analysis.images.slice(0, 10).map(image => `${image.alt || 'sans texte alternatif'} (${image.width}×${image.height})`).join(' ; ')}` : '',
    `Texte de la page :\n${analysis.text}`,
    ...analysis.pages.map(page => `Page interne : ${page.title} — ${page.url}\nTitres : ${page.headings.join(' · ')}\n${page.text}`),
  ];
  return lines.filter(Boolean).join('\n');
}
