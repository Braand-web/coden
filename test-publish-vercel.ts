import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createVercelFunctionAdapter, prepareVercelSource, vercelCodenHostForSlug, vercelProjectNameForSlug, vercelProjectUrlForSlug, verifyVercelDeployment } from './src/services/publish-vercel.ts';

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
console.log('publish Vercel tests passed');
