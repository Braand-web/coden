import { chromium } from 'playwright';
import type { ProjectSandbox } from './project-sandbox.ts';
import type { ValidationReport } from './validate.ts';

/** Read-only render check of the running app, never setContent or a fabricated preview. */
export async function verifyLivePreview(sandbox: ProjectSandbox, signal?: AbortSignal): Promise<ValidationReport> {
  const started = Date.now();
  const report: ValidationReport = { ok:false, problems:[], ran:{devServer:false,typecheck:false,build:false,browser:false}, durationMs:0 };
  const fail = (message: string) => report.problems.push({ source:'runtime', severity:'error', message:message.slice(0,500) });
  const state = sandbox.status();
  if (state.state !== 'running' || !state.port) {
    fail('PREVIEW_NOT_RUNNING'); return report;
  }
  // The address comes only from this project's registered process, never user input.
  const origin = `http://127.0.0.1:${state.port}`;
  const url = new URL(state.basePath || '/', origin);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { void browser?.close().catch(() => {}); };
  try {
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless:true, timeout:20_000, args:['--disable-dev-shm-usage'], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
    timeout = setTimeout(stop, 35_000);
    signal?.addEventListener('abort', stop, { once:true });
    signal?.throwIfAborted();
    const context = await browser.newContext({ serviceWorkers:'block' });
    // No credentials or production API calls. Unsupported external integrations
    // are reported as unverified rather than probed with the host's identity.
    await context.route('**/*', route => {
      const request = new URL(route.request().url());
      return request.origin === origin || ['data:','blob:'].includes(request.protocol)
        ? route.continue() : route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.on('pageerror', error => fail(`Browser exception: ${error.message}`));
    page.on('response', response => {
      if (response.status() >= 400 && ['document','script','stylesheet','fetch','xhr'].includes(response.request().resourceType())) fail(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`);
    });
    page.on('requestfailed', request => {
      if (['document','script','stylesheet','fetch','xhr'].includes(request.resourceType())) fail(`Resource unavailable: ${new URL(request.url()).pathname}`);
    });
    for (const width of [1280,390]) {
      await page.setViewportSize({ width, height:800 });
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
        return { visible:box.width > 0 && box.height > 0 && getComputedStyle(root).visibility !== 'hidden', overflow:document.documentElement.scrollWidth > innerWidth + 4, overlay:!!document.querySelector('vite-error-overlay'), scaffold:/^Building[.\u2026\s]*$/i.test((root.textContent || '').trim()) };
      });
      if (!result.visible || result.overlay) fail(`Preview is blank or displays a build overlay at ${width}px.`);
      if (result.scaffold) fail('Preview still renders the Building scaffold. Implement the requested application in its actual entrypoint; a compiling placeholder is not a completed application.');
      if (result.overflow) fail(`Horizontal overflow at ${width}px.`);
    }
    report.ran.browser = true;
    report.ok = report.problems.length === 0;
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
