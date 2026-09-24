import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { previewErrorDocument, proxyHttp } from './preview-proxy';

describe('preview recovery', () => {
  it('the unavailable page asks the builder for a restart and reloads itself', () => {
    const page = previewErrorDocument('Aperçu indisponible', 'x');
    expect(page).toContain("type: 'coden-preview-unavailable'");
    expect(page).toMatch(/location\.reload\(\)/);
  });

  it('a VM edge that answers 502 is a dead dev server, reported and replaced by the recovery page', async () => {
    const upstream = http.createServer((_req, res) => { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('sandbox not found'); });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as any).port;
    const errors: string[] = [];
    const front = http.createServer((req, res) => proxyHttp(req, res, { origin: `http://127.0.0.1:${upstreamPort}` }, '', error => errors.push(error.message)));
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
    const frontPort = (front.address() as any).port;
    try {
      const { status, header, body } = await new Promise<{ status: number; header: string; body: string }>((resolve, reject) => {
        http.get(`http://127.0.0.1:${frontPort}/`, res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode || 0, header: String(res.headers['x-coden-preview-error'] || ''), body }));
        }).on('error', reject);
      });
      expect(status).toBe(502);
      expect(header).toBe('preview_unavailable');
      expect(body).toContain('coden-preview-unavailable');
      expect(errors[0]).toMatch(/answered 502/);
    } finally {
      upstream.close();
      front.close();
    }
  });
});

describe('preview in the sandboxed builder frame', () => {
  const request = (port: number, options: http.RequestOptions) => new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, ...options }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers })); });
    req.on('error', reject);
    req.end();
  });

  it('lets the frame\'s null origin load modules, whatever CORS the dev server answers', async () => {
    // Vite 6: CORS for localhost only, so no allow-origin for `null`.
    const upstream = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/javascript', 'access-control-allow-origin': 'http://localhost:5173', 'cross-origin-resource-policy': 'same-origin' }); res.end('export {}'); });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const front = http.createServer((req, res) => proxyHttp(req, res, { port: (upstream.address() as any).port }, ''));
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
    try {
      const { status, headers } = await request((front.address() as any).port, { path: '/preview/tok/src/main.tsx', headers: { origin: 'null' } });
      expect(status).toBe(200);
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(headers['content-security-policy']).toBe("frame-ancestors 'self'");
    } finally {
      upstream.close();
      front.close();
    }
  });

  it('answers a preflight from the frame itself', async () => {
    let reached = false;
    const upstream = http.createServer((_req, res) => { reached = true; res.writeHead(204); res.end(); });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const front = http.createServer((req, res) => proxyHttp(req, res, { port: (upstream.address() as any).port }, ''));
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
    try {
      const { status, headers } = await request((front.address() as any).port, {
        method: 'OPTIONS',
        path: '/preview/tok/api/items',
        headers: { origin: 'null', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      });
      expect(status).toBe(204);
      expect(headers['access-control-allow-origin']).toBe('*');
      expect(headers['access-control-allow-headers']).toBe('content-type');
      expect(reached).toBe(false);
    } finally {
      upstream.close();
      front.close();
    }
  });

  it('the unavailable page is readable without the app\'s design tokens', () => {
    expect(previewErrorDocument('Aperçu indisponible', 'x')).not.toMatch(/var\(--/);
  });
});
