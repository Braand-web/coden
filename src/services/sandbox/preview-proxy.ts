/**
 * The bridge between a dev server on a loopback port and an iframe in the
 * builder.
 *
 * A generated project's dev server binds 127.0.0.1 and nothing else, so it is
 * unreachable from a browser by design -- exposing it directly would put an
 * unauthenticated dev server, with its filesystem-backed module graph, on a
 * public interface. Everything reaches it through here instead, after the
 * caller has decided the request is allowed to.
 *
 * Two transports, because a modern dev server needs both:
 *
 *   HTTP       the document, its modules, its assets
 *   WebSocket  hot module reload
 *
 * Proxying the first and forgetting the second is the classic failure: the
 * app loads once and then never updates, and the console fills with failed
 * reconnects. The upgrade handler here is what makes an edit appear.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import type { Duplex } from 'node:stream';

/** Hop-by-hop headers. Forwarding these breaks keep-alive and upgrades. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function forwardableHeaders(headers: IncomingMessage['headers'], host: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    const name = key.toLowerCase();
    if (HOP_BY_HOP.has(name)) continue;
    // The dev server is entitled to know which host it is answering; it uses
    // this to build its own client URLs.
    if (name === 'host') continue;
    out[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  out.host = host;
  return out;
}

export type ProxyTarget = { port: number };

/**
 * Proxy one HTTP request to the project's dev server.
 *
 * `basePath` is the prefix the browser sees (`/preview/<id>`); it is stripped
 * before the request reaches the dev server, which believes it is mounted at
 * the root -- which it is, on its own port.
 */
export function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  target: ProxyTarget,
  basePath: string,
  onError?: (error: Error) => void,
): void {
  const url = stripBase(req.url || '/', basePath);
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: target.port,
      method: req.method,
      path: url,
      headers: forwardableHeaders(req.headers, `127.0.0.1:${target.port}`),
    },
    upstreamRes => {
      const headers: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        headers[key] = value as string | string[];
      }
      // The preview is embedded in the builder, so a dev server that ships a
      // frame-ancestors or X-Frame-Options default would blank the iframe.
      // We are the ones deciding who may embed it, not the sandbox.
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      // COEP is recursive, even for same-origin frames. The isolated Builder
      // cannot embed a document with the default unsafe-none policy: Chromium
      // replaces an otherwise healthy HTTP 200 app with its refused frame page.
      headers['cross-origin-embedder-policy'] = 'credentialless';
      headers['cross-origin-resource-policy'] = 'same-origin';
      headers['content-security-policy'] = "frame-ancestors 'self'";
      res.removeHeader('X-Frame-Options');
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', error => {
    // The caller owns the consequence: this is how a sandbox that still
    // reports "running" learns that its port answers nothing, so the next
    // status read can send the client to a restart instead of back here.
    onError?.(error as Error);
    if (res.headersSent) { res.destroy(); return; }
    // This response is rendered inside an iframe, so it is a document rather
    // than JSON. A raw `{"error":…}` body is what a user reads as "the app it
    // generated is broken" — the failure is the sandbox's, but the unstyled
    // JSON is what they see and what they judge the product by.
    // The reason stays machine-readable in a header: the document is for the
    // person looking at the iframe, the header for anything that has to act
    // on the failure rather than read it.
    res.writeHead(502, {
      'content-type': 'text/html; charset=utf-8',
      'cross-origin-embedder-policy': 'credentialless',
      'x-coden-preview-error': 'preview_unavailable',
    });
    res.end(previewErrorDocument(
      'Aperçu indisponible',
      'Le serveur de développement de ce projet ne répond plus. Il va redémarrer automatiquement.',
      String((error as any)?.message || error),
    ));
  });
  req.pipe(upstream);
}

/**
 * Proxy a WebSocket upgrade to the dev server. This is hot reload's channel.
 *
 * Written against raw sockets rather than a WebSocket library because nothing
 * here needs to understand frames: once both sides have shaken hands, the two
 * sockets are simply piped together.
 */
export function proxyUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: ProxyTarget,
  basePath: string,
): void {
  const url = stripBase(req.url || '/', basePath);
  const upstream = http.request({
    host: '127.0.0.1',
    port: target.port,
    method: req.method,
    path: url,
    headers: { ...forwardableHeaders(req.headers, `127.0.0.1:${target.port}`), connection: 'Upgrade', upgrade: String(req.headers.upgrade || 'websocket') },
  });

  upstream.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`];
    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      for (const item of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${item}`);
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    // Each side's leftover bytes go back into the stream they arrived on, so
    // the pipes carry them to the other end. Putting the upstream's leftovers
    // into the client's readable stream instead makes them look like data the
    // browser sent: the server then reads an unmasked frame and kills the
    // connection with WS_ERR_EXPECTED_MASK, which presents as hot reload
    // simply never connecting.
    if (upstreamHead?.length) upstreamSocket.unshift(upstreamHead);
    if (head?.length) socket.unshift(head);
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
    const close = () => { upstreamSocket.destroy(); socket.destroy(); };
    upstreamSocket.on('error', close);
    socket.on('error', close);
    socket.on('close', () => upstreamSocket.destroy());
  });

  // A dev server that is restarting refuses the upgrade. Closing the client
  // socket lets its reconnect loop do its job instead of hanging on a
  // half-open connection.
  upstream.on('response', () => socket.destroy());
  upstream.on('error', () => socket.destroy());
  upstream.end();
}

/**
 * What the user sees when the preview cannot be served.
 *
 * It is shown inside the builder's iframe, so it has to be a document that
 * reads as an explanation rather than a payload. The technical detail is kept,
 * because it is the line that names the failing package or port — but it is
 * placed under the sentence a non-technical user can act on, not above it.
 */
export function previewErrorDocument(title: string, message: string, detail = ''): string {
  const escape = (value: string) => value.replace(/[&<>"]/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] as string);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
    font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:#0b0d12; color:#e6e8ee; }
  @media (prefers-color-scheme: light) { body { background:#f7f8fa; color:#1a1d24; } }
  .card { max-width:34rem; text-align:center; }
  h1 { margin:0 0 .5rem; font-size:1.05rem; font-weight:600; }
  p { margin:0; opacity:.72; }
  code { display:block; margin-top:1rem; padding:.6rem .75rem; border-radius:8px;
    background:rgba(127,127,127,.14); font-size:12px; text-align:left;
    word-break:break-word; opacity:.8; }
  .dot { width:8px; height:8px; border-radius:50%; background:#d97706;
    display:inline-block; margin-right:.5rem; vertical-align:middle; }
</style></head><body><div class="card">
<h1><span class="dot"></span>${escape(title)}</h1>
<p>${escape(message)}</p>
${detail ? `<code>${escape(detail)}</code>` : ''}
</div></body></html>`;
}

/** `/preview/abc/src/App.tsx` under base `/preview/abc` becomes `/src/App.tsx`. */
export function stripBase(url: string, basePath: string): string {
  if (!basePath || basePath === '/') return url || '/';
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (url === base) return '/';
  if (url.startsWith(base + '/')) return url.slice(base.length) || '/';
  if (url.startsWith(base + '?')) return '/' + url.slice(base.length);
  return url || '/';
}
