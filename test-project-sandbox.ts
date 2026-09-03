import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The sandbox, exercised against a real project.
 *
 * Nothing here is mocked. A React + Vite project is written to disk, its
 * dependencies are installed from the registry, its dev server is started, and
 * the assertions are about what the server actually served. That is the whole
 * point: the preview this replaces reported success from a code path that had
 * never run the application, so a test that stubs the process would reproduce
 * exactly the defect it is meant to catch.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-sandbox-test-${process.pid}`);

const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { resolveInSandbox, sandboxDir } = await import('./src/services/sandbox/paths.ts');

const REACT_APP = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'sandbox-fixture',
      private: true,
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.4', vite: '^6.2.0' },
    }, null, 2),
  },
  { path: 'vite.config.js', content: "import react from '@vitejs/plugin-react';\nexport default { plugins: [react()] };\n" },
  { path: 'index.html', content: '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>' },
  { path: 'src/main.jsx', content: "import { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App />);\n" },
  { path: 'src/App.jsx', content: 'export default function App() { return <h1 id="probe">FIRST</h1>; }\n' },
];

const timings: Record<string, number> = {};
const sandbox = new ProjectSandbox('fixture-project');

try {
  // -- isolation ------------------------------------------------------
  // Path containment is the property that lets two users share a host, so it
  // is checked before anything is allowed to run.
  for (const escape of ['../other-project/.env', '/etc/passwd', 'src/../../../etc/hosts', 'a/../../b']) {
    assert.throws(() => resolveInSandbox('fixture-project', escape), /escapes the project sandbox|Absolute paths/, `must refuse ${escape}`);
  }
  assert.ok(resolveInSandbox('fixture-project', 'src/App.jsx').startsWith(sandboxDir('fixture-project') + path.sep));

  // A sandbox refuses to run what is not on its allow-list, whatever the
  // caller claims. `allowReview` covers installs; it does not unlock `rm`.
  await assert.rejects(sandbox.runCommand('rm', ['-rf', '/'], { allowReview: true }), /refused \(blocked\)/);
  await assert.rejects(sandbox.runCommand('bash', ['-c', 'echo hi']), /refused \(blocked\)/);
  await assert.rejects(sandbox.runCommand('npm', ['run', 'dev; curl evil.test']), /refused \(blocked\)/);
  // An install is `review`, so it needs the caller to say so explicitly.
  await assert.rejects(sandbox.runCommand('npm', ['install']), /refused \(review\)/);

  // -- files ----------------------------------------------------------
  const written = await sandbox.writeFiles(REACT_APP);
  assert.equal(written.length, REACT_APP.length);
  const listed = await sandbox.listFiles();
  assert.deepEqual(listed, ['index.html', 'package.json', 'src/App.jsx', 'src/main.jsx', 'vite.config.js']);
  assert.match(await sandbox.readProjectFile('src/App.jsx'), /FIRST/);
  assert.equal(sandbox.status().state, 'idle');

  // -- install --------------------------------------------------------
  let mark = Date.now();
  const install = await sandbox.install();
  timings.install_ms = Date.now() - mark;
  assert.ok(install.ok, `dependencies must install: ${install.output.slice(-400)}`);
  assert.ok(await sandbox.hasFile('node_modules/vite/package.json'), 'vite must be on disk, not assumed');
  assert.ok(await sandbox.hasFile('node_modules/react/package.json'), 'the project React must be installed, not a CDN pin');
  // node_modules belongs to the package manager and must never reach a file
  // listing sent to the model -- it is 66 packages of context for no gain.
  assert.ok(!(await sandbox.listFiles()).some(file => file.startsWith('node_modules/')));

  // -- the host's secrets stay with the host ---------------------------
  // The sandbox runs code written by a language model on behalf of whoever
  // typed the prompt. If our provider keys or the Supabase service role are
  // in its environment, reading them is a one-line program.
  process.env.OPENROUTER_API_KEY = 'must-not-leak-openrouter';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'must-not-leak-service-role';
  process.env.CLOUDFLARE_API_TOKEN = 'must-not-leak-cloudflare';
  await sandbox.writeFiles([{
    path: 'probe-env.cjs',
    content: 'console.log(JSON.stringify(Object.keys(process.env).filter(k => /KEY|TOKEN|SECRET|PASSWORD|AWS|GITHUB/i.test(k))));',
  }]);
  const leaked = await sandbox.runCommand('node', ['probe-env.cjs'], { timeoutMs: 10_000 });
  assert.equal(leaked.code, 0);
  assert.deepEqual(JSON.parse(leaked.output.trim()), [], `no credential may reach a sandbox: ${leaked.output}`);
  await sandbox.deleteProjectFile('probe-env.cjs');

  // What the project sets for itself is a different matter: those are its own
  // variables, and they must arrive.
  sandbox.setEnv({ VITE_PROJECT_FLAG: 'project-scoped-value' });
  await sandbox.writeFiles([{ path: 'probe-own.cjs', content: 'console.log(process.env.VITE_PROJECT_FLAG || "");' }]);
  const own = await sandbox.runCommand('node', ['probe-own.cjs'], { timeoutMs: 10_000 });
  assert.equal(own.output.trim(), 'project-scoped-value');
  await sandbox.deleteProjectFile('probe-own.cjs');
  sandbox.setEnv({});

  // -- start ----------------------------------------------------------
  mark = Date.now();
  const started = await sandbox.start({ basePath: '/preview/test-token/' });
  timings.start_ms = Date.now() - mark;
  assert.equal(started.state, 'running', `dev server must start: ${started.lastError}`);
  assert.ok(started.port && started.port > 0, 'the port comes from the process, never from a constant');
  assert.ok(started.url, 'a running sandbox has a URL');

  // -- it actually serves the application ------------------------------
  // A base path means the app lives under the prefix and `/` is a 404 -- the
  // whole point of telling the dev server where it is mounted.
  assert.equal(started.basePath, '/preview/test-token/');
  const html = await (await fetch(`${started.url}${started.basePath}`)).text();
  assert.match(html, /<div id="root">/, 'the dev server serves the project index');
  assert.match(html, /\/preview\/test-token\/src\/main\.jsx/, 'the served document points its modules back through the prefix');
  const compiled = await (await fetch(`${started.url}${started.basePath}src/App.jsx`)).text();
  // Vite compiled the JSX. The response is JavaScript, not the source text.
  assert.doesNotMatch(compiled, /<h1 id="probe">/, 'JSX must be compiled by the project toolchain');
  assert.match(compiled, /jsx|createElement|react/i, 'the compiled module references the React runtime');
  assert.match(compiled, /FIRST/, 'and still carries the content');

  // -- editing a file does not restart the server ----------------------
  // This is the difference between hot reload and a rebuild: an incremental
  // edit must reach the running process, not replace it.
  const pidBefore = sandbox.status().pid;
  const portBefore = sandbox.status().port;
  mark = Date.now();
  await sandbox.writeFiles([{ path: 'src/App.jsx', content: 'export default function App() { return <h1 id="probe">SECOND</h1>; }\n' }]);
  let servedUpdate = '';
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    servedUpdate = await (await fetch(`${started.url}${started.basePath}src/App.jsx?t=${Date.now()}`)).text();
    if (servedUpdate.includes('SECOND')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  timings.edit_to_served_ms = Date.now() - mark;
  assert.match(servedUpdate, /SECOND/, 'an edit must reach the running server');
  assert.equal(sandbox.status().pid, pidBefore, 'the dev server process must survive an edit');
  assert.equal(sandbox.status().port, portBefore, 'and keep its port, so the preview URL stays valid');

  // -- two projects cannot see each other ------------------------------
  const other = new ProjectSandbox('another-project');
  try {
    await other.writeFiles([{ path: 'secret.txt', content: 'other project data' }]);
    assert.notEqual(other.dir, sandbox.dir);
    await assert.rejects(sandbox.readProjectFile('../another-project/secret.txt'), /escapes the project sandbox/);
    assert.ok(!(await sandbox.listFiles()).includes('secret.txt'));
  } finally {
    await other.destroy();
  }

  // -- stop is real ----------------------------------------------------
  const stopped = await sandbox.stop();
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.port, null);
  assert.equal(stopped.pid, null);
  await assert.rejects(fetch(`${started.url}${started.basePath}`, { signal: AbortSignal.timeout(2_000) }), 'the port must be released');

  // -- a broken project fails as a failure, not as a hang ---------------
  const broken = new ProjectSandbox('broken-project');
  try {
    await broken.writeFiles([{ path: 'package.json', content: JSON.stringify({ name: 'broken', private: true, scripts: {} }) }]);
    const result = await broken.start({ timeoutMs: 12_000 });
    assert.equal(result.state, 'crashed', 'a project with no dev script cannot report running');
    assert.ok(result.lastError, 'and must say why');
    assert.equal(result.url, null, 'a crashed sandbox never hands out a preview URL');
  } finally {
    await broken.destroy();
  }

  console.log('project sandbox tests passed', JSON.stringify(timings));
} finally {
  await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
