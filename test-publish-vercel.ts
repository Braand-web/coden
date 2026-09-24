import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVercelFunctionAdapter, prepareVercelSource, publishProjectToVercel, vercelCodenHostForSlug, vercelProjectNameForSlug, vercelProjectUrlForSlug, verifyVercelDeployment } from './src/services/publish-vercel.ts';
import { localBuildAllowed } from './src/services/build-runner.ts';

assert.equal(vercelProjectNameForSlug('My Cool App!'), 'coden-my-cool-app');
assert.equal(vercelProjectUrlForSlug('My Cool App!'), 'https://coden-my-cool-app.vercel.app');
assert.equal(vercelCodenHostForSlug('My Cool App!'), 'my-cool-app.coden.fun');

const adapter = createVercelFunctionAdapter('../server/vercel-entry');
assert.match(adapter, /export default async function handler/);
assert.match(adapter, /typeof app === 'function'/);
assert.match(adapter, /app\.fetch/);

const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-vercel-source-'));
try {
  fs.mkdirSync(path.join(sourceDir, 'server'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'server', 'index.ts'), 'const app = express();\napp.listen(3000);\napp.get("/", handler);\n');
  prepareVercelSource(sourceDir, 'node-server');
  const adapterPath = path.join(sourceDir, 'api', 'index.ts');
  const serverlessSource = fs.readFileSync(path.join(sourceDir, 'server', 'vercel-entry.ts'), 'utf8');
  assert.ok(fs.existsSync(adapterPath));
  assert.doesNotMatch(serverlessSource, /app\.listen/);
  assert.match(serverlessSource, /export default app/);
} finally {
  fs.rmSync(sourceDir, { recursive: true, force: true });
}

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
// Production may not build generated code in the Coden process.
assert.equal(localBuildAllowed({ NODE_ENV: 'production' }), false);
assert.equal(localBuildAllowed({ NODE_ENV: 'production', CODEN_BUILD_RUNNER_ISOLATION: 'container' }), true);
assert.equal(localBuildAllowed({ NODE_ENV: 'development' }), true);

/*
 * There, a static app's source goes to Vercel, which installs and builds it:
 * the upload is the source (never node_modules), declared as a Vite build.
 */
{
  const staticSource = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-vercel-static-'));
  const previousFetch = globalThis.fetch;
  const previousToken = process.env.VERCEL_TOKEN;
  process.env.VERCEL_TOKEN = 'test-token';
  const requests: Array<{ url: string; body?: any }> = [];
  try {
    fs.mkdirSync(path.join(staticSource, 'src'), { recursive: true });
    fs.mkdirSync(path.join(staticSource, 'node_modules', 'left-pad'), { recursive: true });
    fs.writeFileSync(path.join(staticSource, 'package.json'), JSON.stringify({ scripts: { build: 'vite build' } }));
    fs.writeFileSync(path.join(staticSource, 'index.html'), '<div id="root"></div>');
    fs.writeFileSync(path.join(staticSource, 'src', 'main.tsx'), 'console.log(1)');
    fs.writeFileSync(path.join(staticSource, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1');
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ url, body });
      if (url.includes('/v2/files')) return new Response('{}', { status: 200 });
      if (url.includes('/v13/deployments') && init?.method === 'POST') return new Response(JSON.stringify({ id: 'dpl_1', url: 'coden-shop-abc.vercel.app' }), { status: 200 });
      if (url.includes('/v13/deployments/dpl_1')) return new Response(JSON.stringify({ id: 'dpl_1', readyState: 'READY', url: 'coden-shop-abc.vercel.app' }), { status: 200 });
      return new Response(JSON.stringify({ verified: false }), { status: 404 });
    }) as typeof fetch;
    const result = await publishProjectToVercel({ slug: 'shop', distDir: staticSource, sourceDir: staticSource, runtime: 'static-assets', outputDirectory: 'dist', buildOnProvider: true });
    const create = requests.find(request => request.body?.projectSettings);
    assert.ok(create, 'a deployment is created');
    assert.equal(create!.body.projectSettings.framework, 'vite');
    assert.equal(create!.body.projectSettings.outputDirectory, 'dist');
    const uploaded = create!.body.files.map((file: any) => file.file).sort();
    assert.deepEqual(uploaded, ['index.html', 'package.json', 'src/main.tsx'], 'the source goes up, dependencies never do');
    assert.equal(result.deploymentId, 'dpl_1');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousToken === undefined) delete process.env.VERCEL_TOKEN; else process.env.VERCEL_TOKEN = previousToken;
    fs.rmSync(staticSource, { recursive: true, force: true });
  }
}

console.log('publish Vercel tests passed');
