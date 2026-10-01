import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { proxyHttp } from './preview-proxy';
import { INSPECTOR_MARKER } from './preview-inspector-script';

/*
 * The document of a preview gets the inspector; nothing else does. Real servers on loopback ports, so the length,
 * the encoding and the pass-through of everything else are what the browser would see.
 */
const servers: http.Server[] = [];
afterEach(() => { servers.splice(0).forEach(server => server.close()); });

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as any).port as number;
}

async function through(upstream: http.RequestListener, path: string, headers: Record<string, string> = { accept: 'text/html' }) {
  const upstreamPort = await listen(upstream);
  const front = await listen((req, res) => proxyHttp(req, res, { port: upstreamPort }, '', () => undefined));
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: front, path, headers }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body }));
    }).on('error', reject);
  });
}

describe('the preview document', () => {
  it('is given the inspector, with a length that matches what is sent', async () => {
    const html = '<!doctype html><html><body><div id="root"></div><script src="/src/main.tsx"></script></body></html>';
    const result = await through((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(Buffer.byteLength(html)), etag: 'W/"x"' }); res.end(html); }, '/');
    expect(result.status).toBe(200);
    expect(result.body).toContain(INSPECTOR_MARKER);
    expect(result.body.indexOf('src="/src/main.tsx"')).toBeLessThan(result.body.indexOf(INSPECTOR_MARKER));
    expect(Number(result.headers['content-length'])).toBe(Buffer.byteLength(result.body));
    expect(result.headers.etag).toBeUndefined();
  });

  it('asks the dev server not to compress it, so it can be read', async () => {
    let seen = '';
    await through((req, res) => { seen = String(req.headers['accept-encoding'] || ''); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<body></body>'); }, '/');
    expect(seen).toBe('identity');
  });

  it('keeps accented text intact', async () => {
    const result = await through((_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<body><h1>Crème brûlée à 4 €</h1></body>'); }, '/');
    expect(result.body).toContain('Crème brûlée à 4 €');
  });
});

describe('everything else is left exactly as it was', () => {
  it('modules and assets get no inspector and keep their own headers', async () => {
    const result = await through((_req, res) => { res.writeHead(200, { 'content-type': 'application/javascript', 'content-length': '20' }); res.end('export const a = 1;\n\n'); }, '/src/main.tsx', { accept: '*/*' });
    expect(result.body).not.toContain(INSPECTOR_MARKER);
    expect(result.headers['content-length']).toBe('20');
  });

  it('a redirect, an error page and a compressed document pass through untouched', async () => {
    const redirect = await through((_req, res) => { res.writeHead(302, { location: '/x', 'content-type': 'text/html' }); res.end('<body>moved</body>'); }, '/');
    expect(redirect.status).toBe(302);
    expect(redirect.body).not.toContain(INSPECTOR_MARKER);
    const compressed = await through((_req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'identity-x' }); res.end('<body>zz</body>'); }, '/');
    expect(compressed.body).not.toContain(INSPECTOR_MARKER);
  });

  it('a POST to an html route is not touched', async () => {
    const upstreamPort = await listen((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<body>ok</body>'); });
    const front = await listen((req, res) => proxyHttp(req, res, { port: upstreamPort }, '', () => undefined));
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: front, method: 'POST', headers: { accept: 'text/html' } }, res => { let out = ''; res.on('data', c => { out += c; }); res.on('end', () => resolve(out)); });
      req.on('error', reject); req.end();
    });
    expect(body).not.toContain(INSPECTOR_MARKER);
  });
});
