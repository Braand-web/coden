import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The scaffolds, actually built.
 *
 * A starter's only real claim is that a project made from it installs, type-
 * checks, builds and renders. Asserting on its file list would test that the
 * fixture is the fixture; this runs it, because a scaffold with a Vite version
 * that no longer matches its plugin fails in exactly the same silent way a
 * generated app does, and it fails for every project at once.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-starter-test-${process.pid}`);

const { STARTERS, selectStarter, applyStarter, describeStarter } = await import('./src/services/sandbox/starters.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');

// -- selection ---------------------------------------------------------
// One question, because it is the only one whose answer changes the scaffold.
for (const prompt of [
  'Crée un CRM avec authentification et base de données',
  'A SaaS dashboard with login and subscriptions',
  'Une app avec des utilisateurs et du storage',
]) {
  assert.equal(selectStarter(prompt).id, 'react-supabase', `${prompt} needs a backend`);
}
for (const prompt of [
  'Crée une landing page pour mon restaurant',
  'A todo list with local state',
  'Une calculatrice',
]) {
  assert.equal(selectStarter(prompt).id, 'react-vite', `${prompt} does not need a backend`);
}

// -- merging -----------------------------------------------------------
const starter = STARTERS['react-vite'];
const merged = applyStarter(starter, [
  { path: 'src/App.tsx', content: 'export default function App() { return <h1>Generated</h1>; }' },
  { path: 'src/components/Card.tsx', content: 'export const Card = () => null;' },
  // A model rewriting the build config breaks a project that worked, and the
  // failure shows up as a blank preview rather than a rejected write.
  { path: 'package.json', content: '{"name":"hijacked","dependencies":{"react":"0.1.0"}}' },
  { path: 'vite.config.ts', content: 'export default {};' },
  { path: './src/main.tsx', content: 'throw new Error("replaced entry point");' },
]);
assert.deepEqual(merged.rejected.sort(), ['package.json', 'src/main.tsx', 'vite.config.ts']);
const byPath = new Map(merged.files.map(file => [file.path, file.content]));
assert.match(byPath.get('src/App.tsx')!, /Generated/, 'the placeholder App is what the model replaces');
assert.ok(byPath.has('src/components/Card.tsx'), 'new files are added');
assert.match(byPath.get('package.json')!, /"react": "18\.3\.1"/, 'the scaffold keeps its pinned tree');
assert.doesNotMatch(byPath.get('src/main.tsx')!, /replaced entry point/, 'the entry point is the scaffold’s');

// The description tells the model what exists without shipping it the files.
const described = describeStarter(starter);
assert.match(described, /must not be rewritten/);
assert.match(described, /package\.json/);
assert.ok(described.length < 700, `the scaffold description rides on every prompt, got ${described.length} chars`);

// -- each scaffold actually works --------------------------------------
const timings: Record<string, unknown> = {};
for (const id of Object.keys(STARTERS) as Array<keyof typeof STARTERS>) {
  const sandbox = new ProjectSandbox(`starter-${id}`);
  try {
    const project = applyStarter(STARTERS[id], [
      { path: 'src/App.tsx', content: 'export default function App() { return <h1 id="probe" className="text-xl">Scaffold works</h1>; }\n' },
    ]);
    await sandbox.writeFiles(project.files);

    let mark = Date.now();
    const install = await sandbox.install();
    const installMs = Date.now() - mark;
    assert.ok(install.ok, `${id} must install: ${install.output.slice(-400)}`);

    // A scaffold that installs but does not typecheck hands every generated
    // project a pre-existing error to trip over.
    const typecheck = await sandbox.runCommand('npm', ['run', 'typecheck'], { timeoutMs: 120_000 });
    assert.equal(typecheck.code, 0, `${id} must typecheck clean: ${typecheck.output.slice(-600)}`);

    // And one that typechecks but does not build cannot be published.
    mark = Date.now();
    const build = await sandbox.runCommand('npm', ['run', 'build'], { timeoutMs: 180_000 });
    const buildMs = Date.now() - mark;
    assert.equal(build.code, 0, `${id} must build: ${build.output.slice(-600)}`);
    assert.ok(await sandbox.hasFile('dist/index.html'), `${id} must produce a bundle`);

    // Tailwind has to have actually run: a scaffold where the directives never
    // reach PostCSS ships every generated app with no styling at all, which
    // looks like a design failure rather than a build one.
    // Found through the built index, not a directory listing: `dist` belongs
    // to the bundler and listFiles() deliberately hides it, the same way it
    // hides node_modules.
    const builtIndex = await sandbox.readProjectFile('dist/index.html');
    const cssHref = /href="\/?([^"]+\.css)"/.exec(builtIndex)?.[1];
    assert.ok(cssHref, `${id} must link a stylesheet from its built index`);
    const css = await sandbox.readProjectFile(`dist/${cssHref!.replace(/^\/+/, '')}`);
    assert.doesNotMatch(css, /@tailwind/, 'the Tailwind directives must be compiled, not shipped');
    assert.match(css, /\.text-xl/, 'a class used in the app must survive into the bundle');

    // The dev server renders it.
    mark = Date.now();
    const started = await sandbox.start({ basePath: '/preview/starter/' });
    const startMs = Date.now() - mark;
    assert.equal(started.state, 'running', `${id} dev server: ${started.lastError}`);
    const html = await (await fetch(`${started.url}${started.basePath}`)).text();
    assert.match(html, /<div id="root">/, `${id} serves its document`);

    timings[id] = { installMs, buildMs, startMs };
  } finally {
    await sandbox.destroy().catch(() => null);
  }
}

await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
console.log('starter tests passed', JSON.stringify(timings));
