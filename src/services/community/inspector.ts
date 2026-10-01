/**
 * Looks at a published app the way a stranger would: logged out, in a fresh browser, from its public address.
 *
 * It returns the facts the checks need (`PageSignals`), the files the browser actually received (to scan for secrets in
 * what is delivered, not only in the source), and a 16/10 WebP thumbnail taken from that same public view. Before the
 * screenshot, e-mail addresses and phone numbers visible on the page are blurred, so a thumbnail never publishes them.
 *
 * Safety: the page is someone else's code running in a browser on Coden's network. The browser starts with no cookies,
 * no permissions and no service workers, and every request to a private or internal address is aborted, so the page
 * cannot reach anything of Coden's.
 */
import type { PageSignals, SourceFile } from './checks.ts';

export type Inspection = {
  signals: PageSignals;
  delivered: SourceFile[];
  thumbnail: Buffer | null;
  /** Emails and phones that were visible on the page (blurred in the thumbnail). */
  blurred: number;
};

const PRIVATE_HOST = /^(?:localhost|.*\.local|.*\.internal|.*\.railway\.internal|metadata\.google\.internal)$/i;

export function isPrivateAddress(hostname: string): boolean {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || PRIVATE_HOST.test(host)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (host.includes(':')) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80') || host.startsWith('::ffff:');
  // Decimal / hex IP tricks (2130706433, 0x7f000001) are never a real public host name.
  return /^(?:0x[0-9a-f]+|\d+)$/i.test(host);
}

/** Only an https address on a real host: the public address of a published app. */
export function inspectableUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || isPrivateAddress(url.hostname) || url.username || url.password) return null;
    return url;
  } catch { return null; }
}

/* Runs inside the page: serialised by Playwright, so it must stay self-contained. */
function collect() {
  const clean = (value: string | null | undefined) => String(value || '').replace(/\s+/g, ' ').trim();
  const body = document.body;
  const text = clean(body?.innerText || '');
  const sheets = Array.from(document.styleSheets);
  let cssVariables = 0;
  let mediaQueries = 0;
  const seenVars = new Set<string>();
  const walk = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSMediaRule) { if (/(?:min|max)-width/.test(rule.conditionText)) mediaQueries += 1; walk(rule.cssRules); continue; }
      const style = (rule as CSSStyleRule).style;
      if (style) for (let index = 0; index < style.length; index += 1) { const name = style[index]; if (name.startsWith('--') && !seenVars.has(name)) { seenVars.add(name); cssVariables += 1; } }
    }
  };
  for (const sheet of sheets) { try { walk(sheet.cssRules); } catch { /* a cross-origin sheet cannot be read */ } }
  const families = new Set<string>();
  for (const element of Array.from(body?.querySelectorAll('h1,h2,h3,p,a,button,li') || []).slice(0, 200)) {
    const family = getComputedStyle(element).fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
    if (family) families.add(family);
  }
  const images = Array.from(document.images);
  const inputs = body?.querySelectorAll('input:not([type=hidden]), textarea, select').length || 0;
  const password = Boolean(body?.querySelector('input[type=password]'));
  return {
    text: text.slice(0, 8000),
    textLength: text.length,
    title: document.title,
    lang: document.documentElement.lang || '',
    hasViewportMeta: Boolean(document.querySelector('meta[name=viewport]')),
    hasMetaDescription: Boolean(document.querySelector('meta[name=description][content]')),
    h1Count: document.querySelectorAll('h1').length,
    imageCount: images.length,
    imagesWithoutAlt: images.filter(image => !image.hasAttribute('alt')).length,
    canvasCount: document.querySelectorAll('canvas').length,
    landmarkCount: document.querySelectorAll('header,nav,main,footer,aside,[role=banner],[role=navigation],[role=main],[role=contentinfo]').length,
    sectionCount: document.querySelectorAll('section,article,[class*=section]').length,
    cssVariableCount: cssVariables,
    mediaQueryCount: mediaQueries,
    fontFamilyCount: families.size,
    hasPasswordField: password,
    loginOnly: password && text.length < 700 && inputs <= 4,
    scripts: Array.from(document.scripts).map(script => script.src).filter(Boolean),
    styles: Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(link => (link as HTMLLinkElement).href).filter(Boolean),
    html: document.documentElement.outerHTML.slice(0, 400_000),
  };
}

/* Runs inside the page: blurs every email address and phone number in the text, however many a single text holds. */
function blurPersonalData() {
  const pattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|(?<![\w.])(?:\+|00)?\d(?:[\s.\-()]?\d){7,14}(?!\w|\.\d)/g;
  let count = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const value = node.nodeValue || '';
    const parent = node.parentElement;
    if (!parent || /^(?:SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName)) continue;
    const fragment = document.createDocumentFragment();
    let last = 0;
    let found = false;
    for (const match of value.matchAll(pattern)) {
      const text = match[0];
      const digits = text.replace(/\D/g, '');
      const isEmail = text.includes('@');
      // A year range or a plain long number is not a phone: phones have 8 to 15 digits and start with + / 0 or are grouped.
      if (!isEmail && (digits.length < 8 || digits.length > 15 || !(/^[+0]/.test(text) || /[\s.\-()]/.test(text)) || /^(?:19|20)\d{2}[\s.\-]/.test(text))) continue;
      const index = match.index ?? 0;
      if (index > last) fragment.append(value.slice(last, index));
      const span = document.createElement('span');
      span.style.filter = 'blur(7px)';
      span.textContent = text;
      fragment.append(span);
      last = index + text.length;
      found = true;
      count += 1;
    }
    if (!found) continue;
    if (last < value.length) fragment.append(value.slice(last));
    node.replaceWith(fragment);
  }
  for (const link of Array.from(document.querySelectorAll('a[href^="mailto:"], a[href^="tel:"]'))) { (link as HTMLElement).style.filter = 'blur(7px)'; count += 1; }
  return count;
}

const MAX_DELIVERED_FILES = 8;
const MAX_DELIVERED_BYTES = 1_500_000;

/** `testOrigin`: tests and the verification run only — one local origin the browser may reach (never set in production). */
export type InspectOptions = { timeoutMs?: number; testOrigin?: string };

export async function inspectPublicPage(address: string, options: InspectOptions = {}): Promise<Inspection> {
  const url = options.testOrigin && address.startsWith(`${options.testOrigin}/`) ? new URL(address) : inspectableUrl(address);
  const empty: Inspection = { signals: { reachable: false, textLength: 0 }, delivered: [], thumbnail: null, blurred: 0 };
  if (!url) return empty;
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true, timeout: 20_000, args: ['--disable-dev-shm-usage', '--no-first-run', '--disable-extensions'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  });
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  try {
    const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false, permissions: [], viewport: { width: 1280, height: 800 }, colorScheme: 'light', locale: 'fr-FR', javaScriptEnabled: true });
    await context.route('**/*', route => {
      let target: URL;
      try { target = new URL(route.request().url()); } catch { return route.abort('blockedbyclient'); }
      if (['data:', 'blob:'].includes(target.protocol)) return route.continue();
      if (options.testOrigin && target.origin === options.testOrigin) return route.continue();
      if (!['http:', 'https:'].includes(target.protocol) || isPrivateAddress(target.hostname)) return route.abort('blockedbyclient');
      return route.continue();
    });
    const page = await context.newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300)); });
    page.on('pageerror', error => { pageErrors.push(String(error?.message || error).slice(0, 300)); });
    const response = await page.goto(url.href, { waitUntil: 'load', timeout: options.timeoutMs || 20_000 }).catch(() => null);
    if (!response) return empty;
    const status = response.status();
    if (status >= 400) return { ...empty, signals: { reachable: false, textLength: 0, status } };
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
    const facts = await page.evaluate(collect);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2).catch(() => false);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);

    const delivered: SourceFile[] = [{ path: 'index.html', content: facts.html }];
    const origin = new URL(page.url()).origin;
    let budget = MAX_DELIVERED_BYTES;
    for (const asset of [...facts.scripts, ...facts.styles].filter(href => { try { return new URL(href).origin === origin; } catch { return false; } }).slice(0, MAX_DELIVERED_FILES)) {
      if (budget <= 0) break;
      const body = await context.request.get(asset, { timeout: 8_000, maxRedirects: 2 }).then(result => (result.ok() ? result.text() : '')).catch(() => '');
      if (!body) continue;
      budget -= body.length;
      delivered.push({ path: new URL(asset).pathname.replace(/^\//, '') || 'asset.js', content: body.slice(0, MAX_DELIVERED_BYTES) });
    }

    const blurred = await page.evaluate(blurPersonalData).catch(() => 0);
    let thumbnail: Buffer | null = null;
    try {
      const shot = await page.screenshot({ type: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 1280, height: 800 } });
      const sharp: any = await import('sharp').then(module => module.default || module);
      thumbnail = await sharp(shot).resize({ width: 800, height: 500, fit: 'cover', position: 'top' }).webp({ quality: 78 }).toBuffer();
    } catch { thumbnail = null; }

    return {
      signals: {
        reachable: true, status, textLength: facts.textLength, imageCount: facts.imageCount, canvasCount: facts.canvasCount, consoleErrors, pageErrors,
        hasPasswordField: facts.hasPasswordField, loginOnly: facts.loginOnly, visibleText: facts.text, title: facts.title, lang: facts.lang, hasViewportMeta: facts.hasViewportMeta,
        hasMetaDescription: facts.hasMetaDescription, h1Count: facts.h1Count, imagesWithoutAlt: facts.imagesWithoutAlt, landmarkCount: facts.landmarkCount,
        sectionCount: facts.sectionCount, cssVariableCount: facts.cssVariableCount, mediaQueryCount: facts.mediaQueryCount, horizontalOverflowAtMobile: overflow, fontFamilyCount: facts.fontFamilyCount,
      },
      delivered, thumbnail, blurred,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
