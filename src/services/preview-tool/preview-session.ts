/**
 * One browser, on the user's own preview, held open for one run.
 *
 * The check that runs after every round (sandbox/live-smoke.ts) opens a browser,
 * looks once and closes it. An agent that fixes a bug or builds a journey needs
 * to stay: look, click, look again. This is that browser, under the same
 * isolation the smoke check has — the app's own origin and the public font CDNs,
 * nothing else — with no cookies or storage carried in, no service workers, no
 * permissions, no downloads, and third-party calls blocked (so a payment, an
 * email or an SMS in the app can never reach a real provider from here).
 *
 * Everything it returns is plain data; the tool around it decides what the
 * agent is allowed to ask for (preview-policy.ts).
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';

const ALLOWED_EXTERNAL_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export const VIEWPORT_PRESETS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 800 },
} as const;
export type ViewportName = keyof typeof VIEWPORT_PRESETS;

export type PreviewEvent = { kind: 'error' | 'warning' | 'pageerror' | 'http' | 'blocked' | 'failed'; text: string; at: number };

export type CaptureResult = { dataUrl: string; width: number; height: number; bytes: number; viewport: string; theme: string; url: string; title: string };

export type ElementInfo = {
  found: boolean;
  tag?: string;
  role?: string | null;
  name?: string;
  text?: string;
  box?: { x: number; y: number; width: number; height: number };
  styles?: Record<string, string>;
  attributes?: Record<string, string>;
  component?: string | null;
  fiberSource?: { file: string; line: number } | null;
  selector?: string;
};

export type Vitals = { lcpMs: number | null; cls: number | null; domContentLoadedMs: number | null; loadMs: number | null; longTasks: number; transferKb: number | null };

export type PreviewSessionOptions = {
  /** The app's address, from the project's registered process — never from the agent. */
  appUrl: URL;
  signal?: AbortSignal;
  /** How long an unused session stays open. */
  idleMs?: number;
};

/** Injected before any page script: it measures what a visitor would feel. */
const VITALS_SCRIPT = `
(() => {
  const state = { lcp: null, cls: 0, longTasks: 0 };
  window.__codenVitals = state;
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) state.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) state.cls += entry.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver(list => { state.longTasks += list.getEntries().length; }).observe({ type: 'longtask', buffered: true }); } catch {}
})();
`;

export class PreviewSession {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private readonly appUrl: URL;
  private readonly signal?: AbortSignal;
  private readonly idleMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private events: PreviewEvent[] = [];
  private cursor = 0;
  private captures: Array<{ buffer: Buffer; label: string }> = [];
  private viewportName: string = 'desktop';
  private theme: 'light' | 'dark' = 'light';
  private loadedAt = 0;
  private launching: Promise<Page> | undefined;

  constructor(options: PreviewSessionOptions) {
    this.appUrl = options.appUrl;
    this.signal = options.signal;
    this.idleMs = options.idleMs ?? 5 * 60_000;
    options.signal?.addEventListener('abort', () => { void this.dispose(); }, { once: true });
  }

  get origin() { return this.appUrl.origin; }
  get loadedAtMs() { return this.loadedAt; }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { void this.dispose(); }, this.idleMs);
    this.idleTimer.unref?.();
  }

  private record(kind: PreviewEvent['kind'], text: string) {
    this.events.push({ kind, text: text.slice(0, 400), at: Date.now() });
    if (this.events.length > 120) { this.events.shift(); this.cursor = Math.max(0, this.cursor - 1); }
  }

  /** The page, opening the browser on first use. */
  async ensure(): Promise<Page> {
    this.signal?.throwIfAborted();
    this.touch();
    if (this.page && !this.page.isClosed()) return this.page;
    this.launching ??= this.launch().finally(() => { this.launching = undefined; });
    return this.launching;
  }

  private async launch(): Promise<Page> {
    this.browser = await chromium.launch({
      headless: true,
      timeout: 20_000,
      args: ['--disable-dev-shm-usage'],
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
    });
    this.context = await this.browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
      colorScheme: this.theme,
      viewport: VIEWPORT_PRESETS.desktop,
    });
    await this.context.addInitScript(VITALS_SCRIPT);
    const origin = this.appUrl.origin;
    await this.context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      if (ALLOWED_EXTERNAL_HOSTS.has(url.hostname)) return route.continue().catch(() => route.abort('blockedbyclient'));
      // A third party the app tried to reach: a payment, an email, an analytics beacon.
      this.record('blocked', `blocked call to ${url.hostname}`);
      return route.abort('blockedbyclient');
    });
    const page = await this.context.newPage();
    page.on('pageerror', error => this.record('pageerror', error.message));
    page.on('console', message => {
      const type = message.type();
      if (type !== 'error' && type !== 'warning') return;
      const text = message.text();
      if (/^Failed to load resource/.test(text)) return;
      this.record(type === 'error' ? 'error' : 'warning', text);
    });
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).origin === origin) this.record('http', `HTTP ${response.status()} ${new URL(response.url()).pathname}`);
    });
    page.on('requestfailed', request => {
      if (/^https?:/i.test(request.url()) && new URL(request.url()).origin === origin) this.record('failed', `request failed ${new URL(request.url()).pathname}`);
    });
    this.page = page;
    await this.open(new URL(this.appUrl.pathname || '/', this.appUrl.origin));
    return page;
  }

  /** Opens an address of the app and waits until the page has stopped changing. */
  async open(target: URL): Promise<{ status: number; url: string; title: string }> {
    const page = this.page ?? await this.ensure();
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
    this.loadedAt = Date.now();
    await this.settle();
    return { status: response?.status() ?? 0, url: page.url(), title: await page.title().catch(() => '') };
  }

  /**
   * Waits for a stable page: fonts loaded, the network quiet, and no change to
   * the document for a beat. A screenshot taken before that is a screenshot of
   * a page halfway to being drawn.
   */
  async settle(maxMs = 5_000): Promise<{ stable: boolean; waitedMs: number }> {
    const page = this.page;
    if (!page) return { stable: false, waitedMs: 0 };
    const started = Date.now();
    await page.evaluate(() => document.fonts.ready).catch(() => undefined);
    const stable = await page.evaluate((limit: number) => new Promise<boolean>(resolve => {
      let timer: ReturnType<typeof setTimeout>;
      const done = (value: boolean) => { observer.disconnect(); clearTimeout(timer); clearTimeout(hard); resolve(value); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => done(true), 400); });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      timer = setTimeout(() => done(true), 400);
      const hard = setTimeout(() => done(false), limit);
    }), maxMs).catch(() => false);
    await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);
    return { stable, waitedMs: Date.now() - started };
  }

  async resize(size: ViewportName | { width: number; height: number }) {
    const page = await this.ensure();
    const viewport = typeof size === 'string' ? VIEWPORT_PRESETS[size] : { width: Math.max(280, Math.min(2_000, Math.round(size.width))), height: Math.max(360, Math.min(2_000, Math.round(size.height))) };
    await page.setViewportSize(viewport);
    this.viewportName = typeof size === 'string' ? size : `${viewport.width}x${viewport.height}`;
    await this.settle(2_000);
    return { viewport: this.viewportName, ...viewport };
  }

  async setTheme(scheme: 'light' | 'dark') {
    const page = await this.ensure();
    this.theme = scheme;
    await page.emulateMedia({ colorScheme: scheme });
    await this.settle(2_000);
    return { theme: scheme };
  }

  /**
   * A screenshot sized for reading, not for archiving: JPEG, at most 1 800 px
   * tall in full-page mode, so a capture costs a model a few hundred tokens
   * rather than a few thousand.
   */
  async capture(options: { fullPage?: boolean; label?: string } = {}): Promise<CaptureResult> {
    const page = await this.ensure();
    await this.settle(3_000);
    const viewport = page.viewportSize() || VIEWPORT_PRESETS.desktop;
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height);
    const height = options.fullPage ? Math.min(scrollHeight, 1_800) : viewport.height;
    const buffer = await page.screenshot({ type: 'jpeg', quality: 62, fullPage: Boolean(options.fullPage), ...(options.fullPage ? { clip: { x: 0, y: 0, width: viewport.width, height } } : {}) });
    this.captures.push({ buffer, label: options.label || `${this.viewportName}/${this.theme}` });
    if (this.captures.length > 6) this.captures.shift();
    return {
      dataUrl: `data:image/jpeg;base64,${buffer.toString('base64')}`,
      width: viewport.width,
      height,
      bytes: buffer.length,
      viewport: this.viewportName,
      theme: this.theme,
      url: page.url(),
      title: await page.title().catch(() => ''),
    };
  }

  /** Console, page and network errors since the last call. */
  drainEvents(): PreviewEvent[] {
    const fresh = this.events.slice(this.cursor);
    this.cursor = this.events.length;
    return fresh;
  }

  /** The page as a reader — or a screen reader — would meet it. */
  async read(): Promise<{ url: string; title: string; headings: string[]; outline: string; controls: Array<{ kind: string; label: string; disabled: boolean }>; textLength: number }> {
    const page = await this.ensure();
    const outline = await page.locator('body').ariaSnapshot({ timeout: 4_000 }).catch(() => '');
    const facts = await page.evaluate(() => {
      const label = (element: Element) => ((element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.getAttribute('placeholder') || element.getAttribute('name') || element.tagName) || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const headings = Array.from(document.querySelectorAll('h1,h2,h3')).filter(visible).slice(0, 20).map(element => `${element.tagName.toLowerCase()}: ${label(element)}`);
      const controls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"]')).filter(visible).slice(0, 40)
        .map(element => ({ kind: element.tagName === 'A' ? 'link' : element.tagName.toLowerCase(), label: label(element), disabled: (element as HTMLButtonElement).disabled === true }));
      return { headings, controls, textLength: (document.body.innerText || '').length };
    });
    return { url: page.url(), title: await page.title().catch(() => ''), outline: outline.slice(0, 6_000), ...facts };
  }

  /** What one element is, how it looks, and where in the source it most likely lives. */
  async inspect(target: { selector?: string; text?: string; x?: number; y?: number }): Promise<ElementInfo> {
    const page = await this.ensure();
    const handle = target.selector
      ? await page.locator(target.selector.slice(0, 200)).first().elementHandle({ timeout: 2_000 }).catch(() => null)
      : target.text
        ? await page.getByText(target.text.slice(0, 120), { exact: false }).first().elementHandle({ timeout: 2_000 }).catch(() => null)
        : Number.isFinite(target.x) && Number.isFinite(target.y)
          ? (await page.evaluateHandle(({ x, y }) => document.elementFromPoint(x as number, y as number), { x: target.x, y: target.y })).asElement()
          : null;
    if (!handle) return { found: false };
    return (handle as import('playwright').ElementHandle<Element>).evaluate((element: Element): ElementInfo => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const attributes: Record<string, string> = {};
      for (const attribute of Array.from(element.attributes)) {
        if (/^(id|class|role|type|href|name|placeholder|aria-|data-)/.test(attribute.name)) attributes[attribute.name] = attribute.value.slice(0, 120);
      }
      // React (development) keeps the component and, in 18, the file and line on the element's fibre.
      let component: string | null = null;
      let fiberSource: { file: string; line: number } | null = null;
      const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
      if (key) {
        let fiber: any = (element as any)[key];
        for (let depth = 0; fiber && depth < 30; depth += 1, fiber = fiber.return) {
          if (!fiberSource && fiber._debugSource?.fileName) fiberSource = { file: String(fiber._debugSource.fileName), line: Number(fiber._debugSource.lineNumber) || 0 };
          if (!component && typeof fiber.type === 'function') component = fiber.type.displayName || fiber.type.name || null;
          if (component && fiberSource) break;
        }
      }
      const id = element.getAttribute('id');
      const classes = (element.getAttribute('class') || '').split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return {
        found: true,
        tag: element.tagName.toLowerCase(),
        role: element.getAttribute('role'),
        name: (element.getAttribute('aria-label') || '').slice(0, 80),
        text: ((element as HTMLElement).innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        box: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        styles: {
          color: style.color, background: style.backgroundColor, fontFamily: style.fontFamily.slice(0, 60), fontSize: style.fontSize, fontWeight: style.fontWeight,
          padding: style.padding, margin: style.margin, borderRadius: style.borderRadius, display: style.display,
        },
        attributes,
        component,
        fiberSource,
        selector: id ? `${element.tagName.toLowerCase()}#${id}` : classes ? `${element.tagName.toLowerCase()}.${classes}` : element.tagName.toLowerCase(),
      };
    });
  }

  /** The label a click would act on, before it acts — so consequential controls can be held for a go-ahead. */
  async labelOf(target: { selector?: string; text?: string; role?: string; name?: string }): Promise<{ label: string; external: boolean } | null> {
    const page = await this.ensure();
    const locator = this.locate(page, target);
    const handle = await locator.elementHandle({ timeout: 2_000 }).catch(() => null);
    if (!handle) return null;
    return handle.evaluate((element: Element, origin: string) => {
      const label = ((element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.getAttribute('value') || element.getAttribute('title') || '') as string).replace(/\s+/g, ' ').trim();
      const anchor = element.closest('a[href]') as HTMLAnchorElement | null;
      let external = false;
      if (anchor) { try { const url = new URL(anchor.href, location.href); external = /^https?:$/.test(url.protocol) && url.origin !== origin; } catch { external = true; } }
      return { label, external };
    }, this.appUrl.origin);
  }

  private locate(page: Page, target: { selector?: string; text?: string; role?: string; name?: string }) {
    if (target.selector) return page.locator(target.selector.slice(0, 200)).first();
    if (target.role) return page.getByRole(target.role as any, target.name ? { name: target.name.slice(0, 120) } : undefined).first();
    return page.getByText(String(target.text || '').slice(0, 120), { exact: false }).first();
  }

  async click(target: { selector?: string; text?: string; role?: string; name?: string }) {
    const page = await this.ensure();
    const before = await this.fingerprint();
    const urlBefore = page.url();
    await this.locate(page, target).click({ timeout: 4_000 });
    await this.settle(3_000);
    const after = await this.fingerprint();
    return { changed: before !== after, urlBefore, urlAfter: page.url(), title: await page.title().catch(() => '') };
  }

  async type(target: { selector?: string; label?: string; text: string; submit?: boolean }) {
    const page = await this.ensure();
    const field = target.selector ? page.locator(target.selector.slice(0, 200)).first() : page.getByLabel(String(target.label || ''), { exact: false }).first();
    await field.fill(target.text.slice(0, 400), { timeout: 4_000 });
    if (target.submit) await field.press('Enter', { timeout: 2_000 });
    await this.settle(3_000);
    return { typed: true, submitted: Boolean(target.submit), url: page.url() };
  }

  async scroll(target: { y?: number; to?: 'top' | 'bottom'; selector?: string }) {
    const page = await this.ensure();
    if (target.selector) await page.locator(target.selector.slice(0, 200)).first().scrollIntoViewIfNeeded({ timeout: 3_000 });
    else if (target.to === 'bottom') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    else if (target.to === 'top') await page.evaluate(() => window.scrollTo(0, 0));
    else await page.evaluate((y: number) => window.scrollBy(0, y), Math.max(-5_000, Math.min(5_000, Math.round(target.y ?? 600))));
    await this.settle(1_500);
    return { scrollY: await page.evaluate(() => Math.round(window.scrollY)) };
  }

  async vitals(): Promise<Vitals> {
    const page = await this.ensure();
    await this.settle(3_000);
    const measured = await page.evaluate(() => {
      const state = (window as any).__codenVitals || { lcp: null, cls: 0, longTasks: 0 };
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const transfer = performance.getEntriesByType('resource').reduce((sum, entry) => sum + ((entry as PerformanceResourceTiming).transferSize || 0), 0) + (navigation?.transferSize || 0);
      return {
        lcpMs: state.lcp === null ? null : Math.round(state.lcp),
        cls: Math.round(state.cls * 1000) / 1000,
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
        loadMs: navigation ? Math.round(navigation.loadEventEnd) : null,
        longTasks: state.longTasks,
        transferKb: transfer ? Math.round(transfer / 1024) : null,
      };
    });
    return measured;
  }

  /**
   * How much two captures differ, and where: the average per-pixel difference,
   * the share of pixels that changed visibly, and which tile of a 4×4 grid
   * changed most. Enough to say "the header moved" or "nothing changed".
   */
  async compare(): Promise<{ ok: boolean; reason?: string; labels?: [string, string]; changedPercent?: number; meanDifference?: number; sameSize?: boolean; mostChangedTile?: { row: number; column: number; changedPercent: number } }> {
    if (this.captures.length < 2) return { ok: false, reason: 'Two captures are needed: take one before the change and one after.' };
    const [a, b] = this.captures.slice(-2);
    const size = 320;
    const load = async (buffer: Buffer) => sharp(buffer).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const [left, right] = await Promise.all([load(a.buffer), load(b.buffer)]);
    const metaA = await sharp(a.buffer).metadata();
    const metaB = await sharp(b.buffer).metadata();
    let total = 0;
    let changed = 0;
    const tiles = Array.from({ length: 16 }, () => ({ changed: 0, count: 0 }));
    for (let pixel = 0; pixel < size * size; pixel += 1) {
      const offset = pixel * 3;
      const difference = (Math.abs(left[offset] - right[offset]) + Math.abs(left[offset + 1] - right[offset + 1]) + Math.abs(left[offset + 2] - right[offset + 2])) / 3;
      total += difference;
      const tile = tiles[Math.floor((pixel / size) / (size / 4)) * 4 + Math.floor((pixel % size) / (size / 4))];
      tile.count += 1;
      if (difference > 24) { changed += 1; tile.changed += 1; }
    }
    const worst = tiles.map((tile, index) => ({ index, share: tile.changed / Math.max(1, tile.count) })).sort((x, y) => y.share - x.share)[0];
    return {
      ok: true,
      labels: [a.label, b.label],
      changedPercent: Math.round((changed / (size * size)) * 1000) / 10,
      meanDifference: Math.round((total / (size * size)) * 10) / 10,
      sameSize: metaA.width === metaB.width && metaA.height === metaB.height,
      mostChangedTile: { row: Math.floor(worst.index / 4), column: worst.index % 4, changedPercent: Math.round(worst.share * 1000) / 10 },
    };
  }

  private async fingerprint(): Promise<string> {
    const page = this.page;
    if (!page) return '';
    return page.evaluate(() => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4_000);
      return `${location.pathname}|${document.querySelectorAll('*').length}|${text.length}|${text.slice(0, 200)}|${text.slice(-200)}`;
    }).catch(() => '');
  }

  async dispose() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const browser = this.browser;
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
    await browser?.close().catch(() => undefined);
  }
}
