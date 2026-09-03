import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The whole preview chain, end to end, with nothing stubbed.
 *
 * A React project is written to disk, its dependencies come from the
 * registry, Vite serves it, an Express server proxies it behind a signed
 * token, and a real browser loads the result and waits for a hot update.
 *
 * Every one of those seams has failed here at least once while this was being
 * written -- an env allow-list that starved npm of its CA bundle, a SIGTERM
 * that killed the launcher and orphaned the server, upgrade bytes unshifted
 * into the wrong side of the tunnel -- and none of them would have been
 * caught by a test that mocked the layer below it.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-e2e-${process.pid}`);
process.env.CODEN_PREVIEW_TOKEN_SECRET = 'e2e-secret';

const { sandboxRegistry } = await import('./src/services/sandbox/sandbox-registry.ts');
const { proxyHttp, proxyUpgrade } = await import('./src/services/sandbox/preview-proxy.ts');
const { issuePreviewToken, readPreviewToken } = await import('./src/services/sandbox/preview-token.ts');

const PROJECT_ID = 'e2e-project';
const APP = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'e2e', private: true, type: 'module',
      scripts: { dev: 'vite' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.2.0' },
    }),
  },
  { path: 'vite.config.js', content: "import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n" },
  { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>' },
  { path: 'src/main.jsx', content: "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);\n" },
  { path: 'src/App.jsx', content: 'export default function App() { return <main><h1 id="title">Version un</h1></main>; }\n' },
];

/** The routes as server.ts mounts them, including the upgrade handler. */
function buildEdge() {
  const app = express();
  app.all(/^\/preview\/([^/]+)(\/.*)?$/, (req: any, res: any) => {
    const token = req.params[0];
    const grant = readPreviewToken(token);
    if (!grant) return res.status(401).json({ error: 'preview_token_invalid' });
    const sandbox = sandboxRegistry.peek(grant.projectId);
    const port = sandbox?.status().port;
    if (!port) return res.status(503).json({ error: 'preview_not_running' });
    sandbox!.lastUsedAt = Date.now();
    // The dev server was started with this prefix as its base, so it owns
            // the whole path and nothing is stripped.
    proxyHttp(req, res, { port }, sandbox!.status().basePath ? '' : `/preview/${token}`);
  });
  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const match = /^\/preview\/([^/?]+)(\/[^?]*)?/.exec(String(req.url || ''));
    if (!match) return;
    const grant = readPreviewToken(match[1]);
    const port = grant ? sandboxRegistry.peek(grant.projectId)?.status().port : null;
    if (!port) { socket.destroy(); return; }
    const base = sandboxRegistry.peek(grant!.projectId)?.status().basePath;
    proxyUpgrade(req, socket, head, { port }, base ? '' : `/preview/${match[1]}`);
  });
  return server;
}

const timings: Record<string, number> = {};
const edge = buildEdge();
await new Promise<void>(resolve => edge.listen(0, '127.0.0.1', () => resolve()));
const edgeUrl = `http://127.0.0.1:${(edge.address() as any).port}`;
const token = issuePreviewToken({ projectId: PROJECT_ID, userId: 'user-1' });
const previewUrl = `${edgeUrl}/preview/${token}/`;

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({
  executablePath: process.env.CODEN_TEST_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

try {
  // -- an unstarted project is a state, not a crash -----------------------
  assert.equal((await fetch(previewUrl)).status, 503, 'a project with no dev server yet reports it');
  assert.equal((await fetch(`${edgeUrl}/preview/forged-token/`)).status, 401, 'an unsigned token reaches nothing');

  // -- bring the sandbox up ----------------------------------------------
  const sandbox = sandboxRegistry.get(PROJECT_ID);
  await sandbox.writeFiles(APP);
  let mark = Date.now();
  const install = await sandbox.install();
  timings.install_ms = Date.now() - mark;
  assert.ok(install.ok, `install must succeed: ${install.output.slice(-300)}`);
  mark = Date.now();
  const started = await sandbox.start({ basePath: `/preview/${token}/` });
  timings.dev_server_ms = Date.now() - mark;
  assert.equal(started.state, 'running', started.lastError || '');
  assert.equal(started.basePath, `/preview/${token}/`, 'the server serves the prefix the proxy mounts');

  // -- another user's token must not open this preview --------------------
  const foreign = issuePreviewToken({ projectId: 'not-this-project', userId: 'user-1' });
  assert.equal((await fetch(`${edgeUrl}/preview/${foreign}/`)).status, 503, 'a token scoped elsewhere reaches no sandbox');

  // -- the browser gets the real application ------------------------------
  const page = await (await browser.newContext()).newPage();
  const consoleErrors: string[] = [];
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
  // A bare "Failed to load resource" says nothing about which resource, so the
  // response listener names it. Everything the app needs must arrive; the
  // favicon a browser asks for unprompted is not part of the application.
  page.on('response', response => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    if (url.pathname.endsWith('/favicon.ico')) return;
    consoleErrors.push(`${response.status()} ${url.pathname}`);
  });
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname.endsWith('/favicon.ico')) return;
    consoleErrors.push(`failed ${request.url()}`);
  });

  mark = Date.now();
  await page.goto(previewUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#title');
  timings.first_paint_ms = Date.now() - mark;
  assert.equal(await page.textContent('#title'), 'Version un', 'React rendered through the proxy');
  assert.deepEqual(consoleErrors, [], 'a live preview starts with a clean console');

  // The proxy must not have handed the browser a header that forbids framing,
  // or the same page inside the builder's iframe would be blank.
  const headers = (await page.goto(previewUrl))!.headers();
  assert.equal(headers['x-frame-options'], undefined);
  assert.equal(headers['content-security-policy'], undefined);
  await page.waitForSelector('#title');

  // -- hot module reload, through the proxy, in a real browser -------------
  // The assertion this whole file exists for: an edit reaches the running
  // page without a reload and without a restart.
  const pidBefore = sandbox.status().pid;
  await page.evaluate(() => { (window as any).__reloadProbe = 'still-here'; });
  mark = Date.now();
  await sandbox.writeFiles([{ path: 'src/App.jsx', content: 'export default function App() { return <main><h1 id="title">Version deux</h1></main>; }\n' }]);
  await page.waitForFunction(() => document.querySelector('#title')?.textContent === 'Version deux', { timeout: 20_000 });
  timings.hmr_ms = Date.now() - mark;
  assert.equal(
    await page.evaluate(() => (window as any).__reloadProbe),
    'still-here',
    'the page must be hot-updated, not reloaded — a reload loses component state',
  );
  assert.equal(sandbox.status().pid, pidBefore, 'the dev server process survives an edit');
  assert.deepEqual(consoleErrors, [], 'hot reload leaves no console errors');

  // -- stopping releases everything ----------------------------------------
  const port = started.port!;
  await sandbox.stop();
  assert.equal((await fetch(previewUrl)).status, 503, 'a stopped sandbox serves nothing');
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2_500) }),
    'the dev server port must be released, including the process npm spawned',
  );

  console.log('live preview e2e passed', JSON.stringify(timings));
} finally {
  await browser.close().catch(() => null);
  await sandboxRegistry.destroy(PROJECT_ID).catch(() => null);
  await sandboxRegistry.stopAll().catch(() => null);
  await new Promise<void>(resolve => edge.close(() => resolve()));
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
