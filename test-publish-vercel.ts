import assert from 'node:assert/strict';
import { vercelCodenHostForSlug, vercelProjectNameForSlug, vercelProjectUrlForSlug, verifyVercelDeployment } from './src/services/publish-vercel.ts';

assert.equal(vercelProjectNameForSlug('My Cool App!'), 'coden-my-cool-app');
assert.equal(vercelProjectUrlForSlug('My Cool App!'), 'https://coden-my-cool-app.vercel.app');
assert.equal(vercelCodenHostForSlug('My Cool App!'), 'my-cool-app.coden.fun');

const urls: string[] = [];
const verification = await verifyVercelDeployment(
  {
    defaultUrl: 'https://coden-my-cool-app.vercel.app',
    deploymentUrl: 'https://coden-my-cool-app-a1b2c3.vercel.app',
    codenUrl: null,
  },
  ['/'],
  (async (input: string | URL) => {
    urls.push(String(input));
    return new Response('<!doctype html><title>Coden app</title>', { status: 200 });
  }) as typeof fetch,
);

assert.equal(verification.verified, true);
assert.ok(urls.every(url => /^https:\/\/.+\.vercel\.app\/$/.test(url)));
console.log('publish Vercel tests passed');
