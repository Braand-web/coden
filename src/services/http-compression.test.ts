import http from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { responseCompression } from './http-compression.ts';

let server: http.Server;
let base = '';
const big = 'x'.repeat(20_000);

beforeAll(async () => {
  const app = express();
  app.use(responseCompression());
  app.get('/api/data', (_req, res) => { res.json({ big }); });
  app.get('/api/stream', (_req, res) => {
    res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    res.write(`data: ${big}\n\n`);
    setTimeout(() => res.end(), 20);
  });
  app.get('/preview/token/app.js', (_req, res) => { res.type('application/javascript').send(big); });
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterAll(() => { server.close(); });

const encodingOf = (path: string, accept = '*/*') => new Promise<string | undefined>((resolve, reject) => {
  http.get(`${base}${path}`, { headers: { 'Accept-Encoding': 'br, gzip', Accept: accept } }, res => {
    res.resume();
    resolve(res.headers['content-encoding']);
  }).on('error', reject);
});

describe('response compression', () => {
  it('compresses ordinary responses', async () => {
    expect(await encodingOf('/api/data')).toBe('br');
  });
  it('never compresses an event stream, which would buffer it', async () => {
    expect(await encodingOf('/api/stream', 'text/event-stream')).toBeUndefined();
    expect(await encodingOf('/api/stream')).toBeUndefined();
  });
  it('leaves the proxied preview alone', async () => {
    expect(await encodingOf('/preview/token/app.js')).toBeUndefined();
  });
});
