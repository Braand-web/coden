import { chromium } from 'playwright';
import type { ProjectSandbox } from './project-sandbox.ts';
import type { ValidationReport } from './validate.ts';
import { exploreApplication, runAcceptanceScenarios, type AcceptanceScenario } from './acceptance.ts';

/*
 * Public, credential-free font CDNs the scaffold's own index.html loads.
 * Everything else external stays blocked: the smoke test must never call a
 * production API with the host's identity.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export type LivePreviewOptions = {
  /** Journeys to execute, from the plan. */
  scenarios?: AcceptanceScenario[];
  /** Follow internal links and click visible buttons. */
  explore?: boolean;
  /** Capture desktop and mobile screenshots for the design review. */
  capture?: boolean;
};

/**
 * Page-side: what text is hard to read against its background, and the page's own background.
 * Contrast is the WCAG ratio; large text needs 3:1, the rest 4.5:1. The background is the nearest opaque
 * one behind the text, so a card on a dark page is judged against the card.
 */
const READABILITY_PROBE = () => {
  const parse = (value: string) => { const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a] = m[1].split(',').map(part => parseFloat(part)); return { r, g, b, a: a === undefined ? 1 : a }; };
  const channel = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const luminance = (c: { r: number; g: number; b: number }) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const backgroundOf = (element: Element | null) => {
    for (let node = element; node; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.95) return c;
    }
    const canvas = parse(getComputedStyle(document.documentElement).backgroundColor);
    return canvas && canvas.a > 0.95 ? canvas : (matchMedia('(prefers-color-scheme: dark)').matches ? { r: 18, g: 18, b: 18, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
  };
  const page = backgroundOf(document.body);
  const low: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let checked = 0;
  while (walker.nextNode() && checked < 500) {
    const node = walker.currentNode;
    const text = (node.textContent || '').trim();
    const parent = node.parentElement;
    if (!parent || text.length < 2) continue;
    const box = parent.getBoundingClientRect();
    const style = getComputedStyle(parent);
    if (!box.width || !box.height || style.visibility === 'hidden' || style.display === 'none' || parseFloat(style.opacity) < 0.05) continue;
    checked += 1;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = backgroundOf(parent);
    const l1 = luminance(fg) * fg.a + luminance(bg) * (1 - fg.a);
    const l2 = luminance(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    if (ratio < (large ? 3 : 4.5)) low.push(`${text.slice(0, 30)} (${ratio.toFixed(1)}:1)`);
  }
  return { pageLuminance: luminance(page), low: [...new Set(low)].slice(0, 8), lowCount: low.length };
};

const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

/** Read-only render check of the running app, never setContent or a fabricated preview. */
export async function verifyLivePreview(sandbox: ProjectSandbox, signal?: AbortSignal, options: LivePreviewOptions = {}): Promise<ValidationReport> {
  const started = Date.now();
  const report: ValidationReport = { ok:false, problems:[], ran:{devServer:false,typecheck:false,build:false,browser:false}, durationMs:0, evidence:{ responsiveViewports:[] } };
  const fail = (message: string) => report.problems.push({ source:'runtime', severity:'error', message:message.slice(0,500) });
  const warn = (message: string) => report.problems.push({ source:'runtime', severity:'warning', message:message.slice(0,500) });
  const state = sandbox.status();
  if (state.state !== 'running' || !state.port) {
    fail('PREVIEW_NOT_RUNNING'); return report;
  }
  // The address comes only from this project's registered process, never user input.
  // A VM-hosted server has its own HTTPS origin; a local one lives on loopback.
  const origin = state.origin || `http://127.0.0.1:${state.port}`;
  const url = new URL(state.basePath || '/', origin);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { void browser?.close().catch(() => {}); };
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless:true, timeout:20_000, args:['--disable-dev-shm-usage'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    // Scenarios and exploration take longer than a render check; the ceiling
    // grows with what was asked, and still ends the browser if the app hangs.
    timeout = setTimeout(stop, 35_000 + (options.scenarios?.length || 0) * 15_000 + (options.explore ? 30_000 : 0));
    signal?.addEventListener('abort', stop, { once:true });
    signal?.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers:'block' });
    const policyBlocked = new Set<string>();
    const tolerated = (address: string) => {
      try {
        const parsed = new URL(address);
        return policyBlocked.has(address) || ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname) || /\/favicon\.ico$/.test(parsed.pathname);
      } catch { return false; }
    };
    // No credentials or production API calls. Unsupported external integrations
    // are reported as unverified rather than probed with the host's identity.
    await context.route('**/*', route => {
      const request = new URL(route.request().url());
      if (request.origin === origin || ['data:','blob:'].includes(request.protocol)) return route.continue();
      if (ALLOWED_EXTERNAL_HOSTS.has(request.hostname)) return route.continue().catch(() => route.abort('blockedbyclient'));
      policyBlocked.add(route.request().url());
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => fail(`Browser exception: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // A resource the policy blocked, a font CDN that is unreachable from the
      // sandbox or a missing favicon is the network's story, not the app's.
      const location = message.location()?.url || '';
      if (/^Failed to load resource/.test(message.text()) && (!location || tolerated(location))) return;
      // The browser declining to hand mailto:/tel: to a mail or phone app.
      if (/(?:Not allowed|Failed) to launch '(?:mailto|tel|sms|callto|geo|maps):/i.test(message.text())) return;
      fail(`Console exception: ${message.text()}`);
    });
    page.on('response', response => {
      if (response.status() >= 400 && ['document','script','stylesheet','fetch','xhr'].includes(response.request().resourceType()) && !tolerated(response.url())) fail(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
    });
    page.on('requestfailed', request => {
      // mailto:, tel:, sms: — handed to another application, never loaded
      // here. A click on "Nous écrire" is not a resource that failed.
      if (!/^https?:/i.test(request.url())) return;
      if (tolerated(request.url())) {
        if (policyBlocked.has(request.url())) report.problems.push({ source: 'runtime', severity: 'warning', message: `EXTERNAL_DEPENDENCY_UNVERIFIED: ${new URL(request.url()).hostname}` });
        return;
      }
      if (['document','script','stylesheet','fetch','xhr'].includes(request.resourceType())) fail(`Resource unavailable: ${new URL(request.url()).pathname}`);
    });
    const screenshots: Array<{ width: number; dataUrl: string; scheme?: 'dark' }> = [];
    for (const viewport of VIEWPORTS) {
      const width = viewport.width;
      await page.setViewportSize(viewport);
      const response = await page.goto(url.href, { waitUntil:'domcontentloaded', timeout:15_000 });
      if (!response?.ok()) fail(`Preview document HTTP ${response?.status() ?? 0}`);
      await page.waitForFunction(() => {
        const root = document.querySelector('#root,#app') || document.body;
        return (root.textContent?.trim().length || 0) > 0 || !!root.querySelector('canvas,img,svg,video');
      }, undefined, { timeout:8_000 });
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(() => {
        const root = document.querySelector('#root,#app') || document.body;
        const box = root.getBoundingClientRect();
        return { visible:box.width > 0 && box.height > 0 && getComputedStyle(root).visibility !== 'hidden', overflow:document.documentElement.scrollWidth > innerWidth + 4, overlay:!!document.querySelector('vite-error-overlay'), scaffold:/^Building[.…\s]*$/i.test((root.textContent || '').trim()) };
      });
      if (!result.visible || result.overlay) fail(`Preview is blank or displays a build overlay at ${width}px.`);
      if (result.scaffold) fail('Preview still renders the Building scaffold. Implement the requested application in its actual entrypoint; a compiling placeholder is not a completed application.');
      if (result.overflow) fail(`Horizontal overflow at ${width}px.`);
      if (result.visible && !result.overlay && !result.overflow) report.evidence?.responsiveViewports?.push(width);
      if (width === 390) {
        /*
         * What a thumb and an eye meet on a phone. Reported as warnings: they
         * reach the design review and the next round's instruction, but never
         * fail a run that works.
         */
        const layout = await page.evaluate(() => {
          const small: string[] = [];
          for (const element of Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]'))) {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight * 3) continue;
            // A text link inside a sentence is sized by the sentence.
            if (element.tagName === 'A' && element.closest('p, li') && getComputedStyle(element).display === 'inline') continue;
            if (rect.height < 32 || rect.width < 32) small.push(((element.getAttribute('aria-label') || (element as HTMLElement).innerText || element.tagName).trim().slice(0, 40)) || element.tagName);
          }
          let smallText = 0;
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            const parent = node.parentElement;
            if (!parent || !(node.textContent || '').trim()) continue;
            const size = parseFloat(getComputedStyle(parent).fontSize);
            if (size && size < 12 && parent.getBoundingClientRect().width > 0) smallText += 1;
          }
          return { smallTapTargets: [...new Set(small)].slice(0, 12), smallText };
        });
        report.evidence!.layout = layout;
        if (layout.smallTapTargets.length) warn(`Touch targets under 32px on mobile: ${layout.smallTapTargets.slice(0, 6).join(', ')}. Give controls at least 44px of height or padding.`);
        if (layout.smallText > 6) warn(`${layout.smallText} text elements are under 12px on mobile; keep body text at 14px or more.`);
      }
      if (options.capture && (width === 1280 || width === 390)) {
        await page.waitForTimeout(600);
        const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight).catch(() => viewport.height), width === 390 ? 2200 : 1800);
        const image = await page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width, height }, fullPage: true }).catch(() => null);
        if (image) screenshots.push({ width, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}` });
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    if (options.capture && process.env.CODEN_DARK_QA === '1') {
      /*
       * Off unless CODEN_DARK_QA=1. It reloads the page twice before the browser journeys and the control probes run,
       * and it adds seconds to every check; until it runs after them, on a page of its own, it stays out of the way.
       *
       * The same screen in the system's dark scheme.
       *
       * The review only ever saw the light version, so an app that half-supports dark mode — a white card
       * left on a dark page, grey text that vanishes — passed. An app that does not react to the scheme at
       * all is not at fault and is left alone; one that does is held to the same standard as its light self.
       */
      try {
        await page.emulateMedia({ colorScheme: 'light' });
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.waitForTimeout(400);
        const light = await page.evaluate(READABILITY_PROBE);
        await page.emulateMedia({ colorScheme: 'dark' });
        await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 15_000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        const dark = await page.evaluate(READABILITY_PROBE);
        const supported = Math.abs(dark.pageLuminance - light.pageLuminance) > 0.2;
        report.evidence!.darkMode = { supported, lowContrast: supported ? dark.low : [] };
        if (light.lowCount >= 3) warn(`${light.lowCount} text elements are hard to read (contrast under 4.5:1): ${light.low.slice(0, 4).join('; ')}. Raise the contrast of text on its background.`);
        if (supported) {
          if (dark.lowCount >= 3) warn(`Dark mode: ${dark.lowCount} text elements are hard to read (contrast under 4.5:1): ${dark.low.slice(0, 4).join('; ')}. Use the theme's text and surface tokens so both schemes stay readable.`);
          const height = Math.min(await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 800), 1800);
          const image = await page.screenshot({ type: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: 1280, height }, fullPage: true }).catch(() => null);
          if (image) screenshots.push({ width: 1280, dataUrl: `data:image/jpeg;base64,${image.toString('base64')}`, scheme: 'dark' });
        }
      } catch { /* the dark pass is a bonus: a failure here never fails a run that works */ }
      finally { await page.emulateMedia({ colorScheme: 'light' }).catch(() => undefined); }
    }
    if (options.explore) {
      const explored = await exploreApplication(page, url).catch(() => null);
      if (explored) {
        report.evidence!.routes = explored.routes;
        report.evidence!.interactions = { attempted: explored.buttons.attempted, changed: explored.buttons.changed };
        for (const route of explored.routes.filter(route => !route.ok)) fail(`FUNCTIONALITY dead link: ${route.path} ${route.reason}. Every link in the navigation must lead to a real page.`);
        if (explored.deadAnchors.length) warn(`Links point to sections that do not exist: ${explored.deadAnchors.slice(0, 6).join(', ')}.`);
        // One inert control can be a legitimate no-op; a pattern of them is an
        // interface that was drawn and never wired.
        const deadShare = explored.buttons.attempted ? explored.buttons.dead.length / explored.buttons.attempted : 0;
        if (explored.buttons.dead.length >= 2 && deadShare >= 0.4) fail(`FUNCTIONALITY controls with no effect: ${explored.buttons.dead.slice(0, 6).map(label => `"${label}"`).join(', ')}. Clicking them changes nothing on screen; wire each one to its action or remove it.`);
        else if (explored.buttons.dead.length) warn(`Controls with no visible effect: ${explored.buttons.dead.slice(0, 6).map(label => `"${label}"`).join(', ')}.`);
      }
    }
    if (options.scenarios?.length) {
      const results = await runAcceptanceScenarios(page, url, options.scenarios);
      report.evidence!.scenarios = results;
      for (const result of results.filter(result => !result.ok)) {
        fail(`SCENARIO "${result.name}" failed at step ${result.failedStep ?? '?'} — ${result.error}. Make this journey work for a real user (or, if the labels differ, use the labels the scenario expects).`);
      }
    }
    if (screenshots.length) report.evidence!.screenshots = screenshots;
    report.ran.browser = true;
    report.ok = report.problems.every(problem => problem.severity !== 'error');
  } catch (error) {
    signal?.throwIfAborted();
    fail(`PREVIEW_BROWSER_CHECK_FAILED: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
    await browser?.close().catch(() => {});
    report.durationMs = Date.now()-started;
  }
  return report;
}
