/**
 * The live preview, loaded the way the builder loads it.
 *
 * The builder embeds the preview in `sandbox="allow-scripts allow-forms"`, so
 * the app's document has an opaque origin and every module script it loads is
 * a cross-origin CORS request. Vite 6 answers CORS for localhost only: through
 * the proxy, `@vite/client` and `src/main` were refused, and the preview was
 * a white page while the dev server, the browser checks (which open the dev
 * server directly) and the logs all said it was fine.
 *
 * This runs a real Vite dev server behind the real proxy, in a sandboxed
 * frame, and requires the app to render and hot reload to reach it.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { proxyHttp, proxyUpgrade } from './src/services/sandbox/preview-proxy.ts';

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  (await import('playwright')).chromium.executablePath(),
  '/opt/pw-browsers/chromium',
].filter(Boolean).find(candidate => existsSync(candidate as string));

if (!executablePath) {
  console.warn('sandboxed preview frame check skipped: no Chromium available in this environment');
} else {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const root = await mkdtemp(path.join(os.tmpdir(), 'coden-frame-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="/preview/tok/icon.svg"></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>');
  await writeFile(path.join(root, 'src/main.ts'), "import './style.css';\nimport { label } from './label';\ndocument.getElementById('root')!.textContent = label;\n");
  await writeFile(path.join(root, 'src/label.ts'), "export const label = 'Rendered in the frame';\n");
  await writeFile(path.join(root, 'src/style.css'), 'body { background: rgb(1, 2, 3); }\n');

  const vite = await createServer({ root, configFile: false, base: '/preview/tok/', logLevel: 'silent', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const vitePort = (vite.httpServer!.address() as any).port as number;
  const coden = http.createServer((req, res) => {
    if (req.url === '/builder') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><iframe sandbox="allow-scripts allow-forms" src="/preview/tok/" style="width:600px;height:400px"></iframe>');
      return;
    }
    if (req.url?.startsWith('/preview/tok')) { proxyHttp(req, res, { port: vitePort }, ''); return; }
    res.statusCode = 404;
    res.end();
  });
  coden.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket as any, head, { port: vitePort }, ''));
  await new Promise<void>(resolve => coden.listen(0, '127.0.0.1', resolve));
  const codenPort = (coden.address() as any).port as number;

  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    const refused: string[] = [];
    page.on('console', message => { if (/CORS|blocked/i.test(message.text())) refused.push(message.text()); });
    await page.goto(`http://127.0.0.1:${codenPort}/builder`);
    const frame = () => page.frames().find(candidate => candidate.url().includes('/preview/tok'))!;
    const text = () => frame().evaluate(() => document.body.innerText).catch(() => '');
    const deadline = Date.now() + 15_000;
    while (!(await text()).includes('Rendered in the frame') && Date.now() < deadline) await page.waitForTimeout(100);
    assert.equal(await text(), 'Rendered in the frame', `the app did not render in the sandboxed frame${refused.length ? `: ${refused[0]}` : ''}`);
    assert.equal(await frame().evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)', 'the stylesheet module did not apply');
    assert.deepEqual(refused, [], 'no request from the frame may be refused');

    // Hot reload through the proxied socket.
    await writeFile(path.join(root, 'src/label.ts'), "export const label = 'Edited while open';\n");
    const hmrDeadline = Date.now() + 15_000;
    while (!(await text()).includes('Edited while open') && Date.now() < hmrDeadline) await page.waitForTimeout(100);
    assert.equal(await text(), 'Edited while open', 'an edit did not reach the sandboxed frame');
    console.log('sandboxed preview frame: renders, applies styles and hot reloads through the proxy');
  } finally {
    await browser.close();
    await vite.close();
    coden.close();
    await rm(root, { recursive: true, force: true });
  }
}
