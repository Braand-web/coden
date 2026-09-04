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
    if (res.headersSent) { res.destroy(); return; }
    res.writeHead(502, { 'content-type': 'application/json', 'cross-origin-embedder-policy': 'credentialless' });
    // The dev server being down is a state the interface has to show, not an
    // opaque failure, so the reason travels with the status.
    res.end(JSON.stringify({ error: 'preview_unavailable', message: String((error as any)?.message || error) }));
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

/** `/preview/abc/src/App.tsx` under base `/preview/abc` becomes `/src/App.tsx`. */
export function stripBase(url: string, basePath: string): string {
  if (!basePath || basePath === '/') return url || '/';
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (url === base) return '/';
  if (url.startsWith(base + '/')) return url.slice(base.length) || '/';
  if (url.startsWith(base + '?')) return '/' + url.slice(base.length);
  return url || '/';
}
