import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { verifyLivePreview } from './live-smoke';

/**
 * The dark pass of the live check, in a real Chromium on real pages: an app
 * that follows the system scheme is held to the same standard in dark; one
 * that does not react to it is left alone; and text hard to read is named.
 * Skipped where no browser can be launched.
 */
const page = (css: string, body = '<h1>Titre</h1><p>Un paragraphe de texte.</p><p>Un autre paragraphe.</p><p>Et un troisième.</p>') =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>App</title><style>body{margin:0;font:16px system-ui;padding:24px}${css}</style></head><body><div id="root">${body}</div></body></html>`;

const PAGES: Record<string, string> = {
  '/good': page('body{background:#fff;color:#111}@media (prefers-color-scheme:dark){body{background:#0b1020;color:#f4f4f5}}'),
  '/half': page('body{background:#fff;color:#111}p{color:#555}@media (prefers-color-scheme:dark){body{background:#0b1020;color:#f4f4f5}p{color:#2a2f45}}'),
  '/light-only': page('body{background:#fff;color:#111}'),
  '/faint': page('body{background:#fff;color:#111}p{color:#c8c8c8}'),
};

let server: http.Server;
let base = '';
let canLaunch = false;

beforeAll(async () => {
  server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end(PAGES[request.url || ''] || '<!doctype html><title>404</title>'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const executablePath of [undefined, process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, '/opt/pw-browsers/chromium'].filter((value, index) => index === 0 || (value && existsSync(value)))) {
    try {
      const browser = await chromium.launch({ headless: true, timeout: 15_000, args: ['--disable-dev-shm-usage'], ...(executablePath ? { executablePath } : {}) });
      await browser.close();
      if (executablePath) process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = executablePath;
      canLaunch = true;
      break;
    } catch { canLaunch = false; }
  }
}, 30_000);

afterAll(() => { server?.close(); });

const sandbox = (path: string) => ({ status: () => ({ state: 'running', port: Number(new URL(base).port), basePath: path, origin: null }) as any }) as any;
const check = (path: string) => verifyLivePreview(sandbox(path), undefined, { capture: true });
const warnings = (report: Awaited<ReturnType<typeof check>>) => report.problems.filter(problem => problem.severity === 'warning').map(problem => problem.message);

describe('the dark pass of the live check', () => {
  it('sees an app that follows the system scheme, captures it, and finds nothing wrong with a good one', async (context) => {
    if (!canLaunch) return context.skip();
    const report = await check('/good');
    expect(report.evidence?.darkMode).toEqual({ supported: true, lowContrast: [] });
    expect(report.evidence?.screenshots?.some(shot => shot.scheme === 'dark' && shot.width === 1280)).toBe(true);
    expect(warnings(report).filter(message => /Dark mode|hard to read/.test(message))).toEqual([]);
  }, 60_000);

  it('names the text that disappears in dark mode when the app half-supports it', async (context) => {
    if (!canLaunch) return context.skip();
    const report = await check('/half');
    expect(report.evidence?.darkMode?.supported).toBe(true);
    expect(report.evidence?.darkMode?.lowContrast.length).toBeGreaterThan(0);
    expect(warnings(report).join(' ')).toMatch(/Dark mode: \d+ text elements are hard to read/);
  }, 60_000);

  it('leaves an app that does not react to the scheme alone: no dark capture, no warning', async (context) => {
    if (!canLaunch) return context.skip();
    const report = await check('/light-only');
    expect(report.evidence?.darkMode).toEqual({ supported: false, lowContrast: [] });
    expect(report.evidence?.screenshots?.some(shot => shot.scheme === 'dark')).toBe(false);
    expect(warnings(report).join(' ')).not.toMatch(/Dark mode/);
  }, 60_000);

  it('flags faint text in the light version too', async (context) => {
    if (!canLaunch) return context.skip();
    const report = await check('/faint');
    expect(warnings(report).join(' ')).toMatch(/hard to read \(contrast under 4\.5:1\)/);
  }, 60_000);

  it('costs a couple of seconds, not more, and only when a review will look at the screenshots', async (context) => {
    if (!canLaunch) return context.skip();
    const withoutCapture = await verifyLivePreview(sandbox('/good'), undefined, {});
    const withCapture = await check('/good');
    expect(withoutCapture.evidence?.darkMode).toBeUndefined();
    expect(withCapture.durationMs - withoutCapture.durationMs).toBeLessThan(4_500);
  }, 90_000);
});
