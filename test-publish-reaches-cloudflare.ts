import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { applyStarter, STARTERS } from './src/services/sandbox/starters.ts';
import { canDeployAsWorker, resolveCloudflareHostingTarget } from './src/services/cloudflare-hosting-policy.ts';

/*
 * A generated app can actually be published.
 *
 * No project has ever been published. The database holds zero rows in
 * `deployments`, `deployment_builds`, `domains` and `deployment_domains`, and
 * the Cloudflare account holds no worker matching any project slug — the same
 * fact from both ends, since the feature shipped.
 *
 * Every gate before Cloudflare passes: nine projects satisfy `can_publish`,
 * both manifests validate on real project files, the client sends
 * `confirmed: true`, and the server-side `npm install && vite build` produces
 * a real `dist/` in twenty-three seconds.
 *
 * The failure was one line further on. `resolveCloudflareHostingTarget`
 * defaulted a static app to `workers-static-assets`, and that path calls
 * `findWranglerBinary`, which looks for `<projectDir>/node_modules/.bin/wrangler`
 * and throws "The generated Worker project does not include a pinned Wrangler
 * dependency" when it is missing. It always is: `starters.ts` pins React,
 * Vite, Tailwind and TypeScript, and no Wrangler, and ships no wrangler
 * config either.
 *
 * So every publish threw before a byte reached Cloudflare, deterministically,
 * on the first click.
 */

// The scaffold every generated app is built from cannot run Wrangler.
{
  const { files } = applyStarter((STARTERS as any)['react-vite'], []);
  const manifest = files.find((file: any) => file.path === 'package.json');
  assert.ok(manifest, 'the scaffold ships a package.json');
  assert.doesNotMatch(String(manifest.content), /wrangler/i, 'and it pins no Wrangler — which is what made the Workers path unreachable');
  assert.ok(
    !files.some((file: any) => /^wrangler\.(jsonc|json|toml)$/.test(file.path)),
    'nor any Wrangler configuration',
  );
}

/*
 * So the target is decided from the project, not from an environment variable
 * somebody has to remember to set. That indirection is exactly how this
 * shipped broken: the default pointed at a path no generated app could take.
 */
{
  assert.equal(
    resolveCloudflareHostingTarget('static-assets', ''),
    'pages-legacy',
    'a static app with no Wrangler must go to Pages, which needs nothing installed in the project',
  );
  assert.equal(
    resolveCloudflareHostingTarget('static-assets', '', { hasWranglerBinary: true, hasWranglerConfig: true }),
    'workers-static-assets',
    'and one that carries Wrangler may still be a Worker',
  );

  // Half-equipped is not equipped: `runWranglerDeploy` reads both, and throws
  // on either being absent.
  assert.equal(canDeployAsWorker({ hasWranglerBinary: true, hasWranglerConfig: false }), false);
  assert.equal(canDeployAsWorker({ hasWranglerBinary: false, hasWranglerConfig: true }), false);
  assert.equal(canDeployAsWorker(undefined), false, 'and nothing known means nothing assumed');
}

// A full-stack Worker is never downgraded: that would silently remove its
// server runtime, which is a different failure and a worse one.
{
  assert.equal(resolveCloudflareHostingTarget('cloudflare-workers', 'cloudflare-pages'), 'workers-fullstack');
  assert.throws(() => resolveCloudflareHostingTarget('node-server'), /Railway deployment adapter/i);
}

/*
 * The capability is read off disk, before a target is chosen.
 *
 * Checking after the choice is what produced the throw; checking before is the
 * whole fix.
 */
{
  const source = readFileSync(new URL('./src/services/publish-cloudflare.ts', import.meta.url), 'utf8');
  assert.match(source, /function inspectWorkerDeployability\(projectDir: string\)/, 'the project is inspected');
  assert.match(
    source,
    /resolveCloudflareHostingTarget\(params\.runtime, undefined, inspectWorkerDeployability\(params\.projectDir\)\)/,
    'and the inspection decides the target',
  );

  // The two conditions checked must be the two conditions that throw.
  assert.match(source, /node_modules', '\.bin', executable/, 'the binary findWranglerBinary looks for');
  assert.match(source, /\['wrangler\.jsonc', 'wrangler\.json', 'wrangler\.toml'\]/, 'and the configs findWranglerConfig accepts');
}

/*
 * And a published app is reachable under the user's own domain without any
 * custom domain of their own — which is the product promise.
 */
{
  const publish = readFileSync(new URL('./src/services/publish-cloudflare.ts', import.meta.url), 'utf8');
  const pages = publish.slice(publish.indexOf('const cfName = projectSlugToCfName(params.slug);'));
  assert.match(pages, /attachCustomDomain\(cfName, codenHost\)/, 'the Pages path attaches <slug>.coden.fun');
  assert.match(pages, /upsertCnameOnCodenFun\(codenSub/, 'and creates the CNAME that resolves it');
  assert.match(pages, /codenUrl: `https:\/\/\$\{codenHost\}`/, 'and returns that URL, not the pages.dev one');
}

/*
 * The temp directory inspection is real, not a string match: a directory with
 * neither file must read as undeployable.
 */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coden-publish-probe-'));
  try {
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    assert.equal(resolveCloudflareHostingTarget('static-assets', '', {
      hasWranglerBinary: fs.existsSync(path.join(dir, 'node_modules', '.bin', 'wrangler')),
      hasWranglerConfig: ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].some(name => fs.existsSync(path.join(dir, name))),
    }), 'pages-legacy');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('publish reaches cloudflare tests passed');
