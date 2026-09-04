import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { proxyHttp, proxyUpgrade, stripBase } from './src/services/sandbox/preview-proxy.ts';

/**
 * The proxy that puts a loopback dev server inside the builder's iframe.
 *
 * Tested against a real HTTP + WebSocket server rather than a stub, because
 * the two failures this code exists to prevent are both protocol-level: an
 * upgrade that is proxied as a plain request (hot reload silently never
 * connects, and the app freezes at its first render), and a frame-blocking
 * header forwarded verbatim (the iframe renders nothing at all, with the
 * reason only in the browser's console).
 */

// -- path rewriting ----------------------------------------------------
// The browser addresses `/preview/<id>/...`; the dev server believes it owns
// the root. Every asset, module and HMR URL depends on this being exact.
assert.equal(stripBase('/preview/abc', '/preview/abc'), '/');
assert.equal(stripBase('/preview/abc/', '/preview/abc'), '/');
assert.equal(stripBase('/preview/abc/src/App.tsx', '/preview/abc'), '/src/App.tsx');
assert.equal(stripBase('/preview/abc?t=1', '/preview/abc'), '/?t=1');
assert.equal(stripBase('/preview/abc/@vite/client', '/preview/abc'), '/@vite/client');
// A path that merely starts with the same characters is a different path.
assert.equal(stripBase('/preview/abcdef/x', '/preview/abc'), '/preview/abcdef/x');
assert.equal(stripBase('/elsewhere', '/preview/abc'), '/elsewhere');

/** A stand-in for a dev server: serves a document, and speaks WebSocket. */
function startUpstream() {
  const server = http.createServer((req, res) => {
    if (req.url === '/echo-headers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ url: req.url, host: req.headers.host }));
      return;
    }
    // A dev server commonly ships these; both would blank an iframe.
    res.writeHead(200, {
      'content-type': 'text/html',
      'x-frame-options': 'DENY',
      'content-security-policy': "frame-ancestors 'none'",
      'x-dev-server': 'yes',
    });
    res.end(`<!doctype html><html><body>served ${req.url}</body></html>`);
  });
  const wss = new WebSocketServer({ server, path: '/hmr' });
  wss.on('connection', socket => {
    socket.on('message', data => socket.send(`echo:${data}`));
    socket.send('hmr:connected');
  });
  return new Promise<{ port: number; close: () => Promise<void> }>(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({
        port,
        close: () => new Promise<void>(done => { wss.close(); server.close(() => done()); }),
      });
    });
  });
}

const upstream = await startUpstream();
const BASE = '/preview/proj-1';

// The proxy, mounted the way the server mounts it.
const edge = http.createServer((req, res) => proxyHttp(req, res, { port: upstream.port }, BASE));
edge.on('upgrade', (req, socket, head) => proxyUpgrade(req, socket, head, { port: upstream.port }, BASE));
await new Promise<void>(resolve => edge.listen(0, '127.0.0.1', () => resolve()));
const edgePort = (edge.address() as any).port;
const edgeUrl = `http://127.0.0.1:${edgePort}`;

try {
  // -- documents and assets --------------------------------------------
  const page = await fetch(`${edgeUrl}${BASE}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /served \//, 'the base path is stripped before the dev server sees it');

  const asset = await fetch(`${edgeUrl}${BASE}/src/App.tsx`);
  assert.match(await asset.text(), /served \/src\/App\.tsx/, 'nested asset paths survive the rewrite');

  const echoed = await (await fetch(`${edgeUrl}${BASE}/echo-headers`)).json() as any;
  assert.equal(echoed.url, '/echo-headers');
  assert.equal(echoed.host, `127.0.0.1:${upstream.port}`, 'the dev server is told which host it answers');

  // -- the iframe must not be blocked -----------------------------------
  assert.equal(page.headers.get('x-frame-options'), null, 'X-Frame-Options must not reach the browser');
  assert.equal(page.headers.get('content-security-policy'), "frame-ancestors 'self'", 'only the Builder origin may embed the preview');
  assert.equal(page.headers.get('cross-origin-embedder-policy'), 'credentialless', 'preview documents must match the isolated Builder COEP');
  assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(asset.headers.get('cross-origin-embedder-policy'), 'credentialless', 'assets preserve the embedding policy too');
  assert.equal(page.headers.get('x-dev-server'), 'yes', 'other headers still pass through');

  // -- hot module reload -------------------------------------------------
  // The assertion that matters: an upgrade proxied as a plain request leaves
  // the app loading once and never updating.
  const socket = new WebSocket(`ws://127.0.0.1:${edgePort}${BASE}/hmr`);
  const messages: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the WebSocket upgrade never completed through the proxy')), 8_000);
    socket.on('message', data => {
      messages.push(String(data));
      if (messages.length === 1) socket.send('ping');
      if (messages.length === 2) { clearTimeout(timer); resolve(); }
    });
    socket.on('error', error => { clearTimeout(timer); reject(error); });
  });
  socket.close();
  assert.deepEqual(messages, ['hmr:connected', 'echo:ping'], 'traffic flows both ways over the proxied socket');

  // -- a dead dev server is a state, not a hang --------------------------
  await upstream.close();
  const down = await fetch(`${edgeUrl}${BASE}/`);
  assert.equal(down.status, 502);
  const body = await down.json() as any;
  assert.equal(body.error, 'preview_unavailable', 'the interface can tell the user why the preview is blank');

  console.log('preview proxy tests passed');
} finally {
  await new Promise<void>(resolve => edge.close(() => resolve()));
  await upstream.close().catch(() => null);
}
