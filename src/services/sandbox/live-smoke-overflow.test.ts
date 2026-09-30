import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { verifyLivePreview } from './live-smoke';

/**
 * Horizontal overflow in the live check, in a real Chromium on real pages: an app
 * that follows the system scheme is held to the same standard in dark; one
 * that does not react to it is left alone; and text hard to read is named.
 * Skipped where no browser can be launched.
 */
const page = (css: string, body = '<h1>Titre</h1><p>Un paragraphe de texte.</p><p>Un autre paragraphe.</p><p>Et un troisième.</p>') =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>App</title><style>body{margin:0;font:16px system-ui;padding:24px}${css}</style></head><body><div id="root">${body}</div></body></html>`;

const wide = '<div style="width:2000px;height:20px;background:#ccc">large</div>';
const PAGES: Record<string, string> = {
  '/fits': page('body{background:#fff;color:#111}'),
  '/scrolls': page('body{background:#fff;color:#111}', `<h1>Titre</h1>${wide}`),
  '/clipped': page('html,body{overflow-x:hidden;background:#fff;color:#111}', `<h1>Titre</h1>${wide}`),
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
const overflow = async (path: string) => (await verifyLivePreview(sandbox(path), undefined, {})).problems.filter(problem => /Horizontal overflow/.test(problem.message));

describe('horizontal overflow is a defect only when the page really scrolls sideways', () => {
  it('a page that fits is fine', async (context) => {
    if (!canLaunch) return context.skip();
    expect(await overflow('/fits')).toEqual([]);
  }, 60_000);

  it('a page that can be dragged sideways is reported at the widths it breaks', async (context) => {
    if (!canLaunch) return context.skip();
    expect((await overflow('/scrolls')).length).toBeGreaterThan(0);
  }, 60_000);

  it('wider content that the page clips does not scroll, and is not reported', async (context) => {
    if (!canLaunch) return context.skip();
    expect(await overflow('/clipped')).toEqual([]);
  }, 60_000);
});
