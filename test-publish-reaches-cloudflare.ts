// Historical filename kept so older CI commands still execute the canonical
// Vercel publication contract. Cloudflare is not used by generated apps.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { collectStaticBuildOutput, verifyVercelDeployment } from './src/services/publish-vercel.ts';
import { sanitizePublicBuildEnv } from './src/services/build-runner.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-vercel-output-'));
try {
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<main>Coden app</main>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log("ready")');
  const files = collectStaticBuildOutput(dir);
  const index = files.find(file => file.file === '.vercel/output/static/index.html');
  const config = files.find(file => file.file === '.vercel/output/config.json');
  assert.ok(index && config, 'a static build must become Build Output API v3 files');
  assert.equal(index.sha, createHash('sha1').update(index.data).digest('hex'));
  assert.equal(index.size, index.data.byteLength);
  assert.match(config.data.toString('utf8'), /"version": 3/);
  assert.match(config.data.toString('utf8'), /"handle": "filesystem"/);
  assert.match(config.data.toString('utf8'), /"dest": "\/index.html"/);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const requested: string[] = [];
  const fetchMock = async (input: string | URL | Request) => {
    requested.push(String(input));
    return new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const result = await verifyVercelDeployment({
    codenUrl: 'https://demo.coden.fun',
    defaultUrl: 'https://coden-demo.vercel.app',
    deploymentUrl: 'https://deployment.vercel.app',
  }, ['/', '/dashboard', '//evil.test', '/bad:*'], fetchMock as typeof fetch);
  assert.equal(result.verified, true);
  assert.equal(result.baseUrl, 'https://demo.coden.fun');
  assert.ok(requested.every(url => url.startsWith('https://demo.coden.fun/')));
}

{
  const protectedFetch = async () => new Response('protected', { status: 401 });
  const result = await verifyVercelDeployment({
    codenUrl: null,
    defaultUrl: 'https://coden-demo.vercel.app',
    deploymentUrl: 'https://deployment.vercel.app',
  }, ['/'], protectedFetch as typeof fetch);
  assert.equal(result.verified, false, 'deployment protection is not application readiness');
}

{
  const headersSeen: Headers[] = [];
  const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
    headersSeen.push(new Headers(init?.headers));
    return new Response('ok', { status: String(input).includes('pending.coden.fun') ? 404 : 200, headers: { 'content-type': 'text/html' } });
  };
  const result = await verifyVercelDeployment({
    codenUrl: 'https://pending.coden.fun',
    defaultUrl: 'https://shop-production.vercel.app',
    deploymentUrl: 'https://shop-abc123.vercel.app',
  }, ['/'], fetchMock as typeof fetch);
  assert.equal(result.verified, true);
  assert.equal(result.baseUrl, 'https://shop-production.vercel.app', 'a pending Coden DNS record must fall back to the verified Vercel URL');
  assert.ok(headersSeen.every(headers => !headers.has('x-vercel-protection-bypass')), 'public checks never depend on a private bypass secret');
}

assert.deepEqual(sanitizePublicBuildEnv({
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'publishable',
  VITE_SUPABASE_SERVICE_ROLE_KEY: 'never',
  OPENROUTER_API_KEY: 'never',
  PUBLIC_THEME: 'dark',
}), {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'publishable',
  PUBLIC_THEME: 'dark',
});

console.log('publish reaches Vercel tests passed');
