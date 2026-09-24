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
