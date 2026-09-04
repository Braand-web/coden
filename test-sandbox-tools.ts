import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The agent's hands.
 *
 * These are tested against a real sandbox because the interesting cases are
 * all failures, and a failure is only useful if the model can act on it: a
 * missing file that names the files that exist, an ambiguous edit that is
 * refused rather than applied to the wrong occurrence, a blocked command that
 * says what to use instead. A mocked filesystem would let all three pass while
 * returning nothing a model could recover from.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-tools-test-${process.pid}`);

const { createSandboxTools, SANDBOX_TOOL_SCHEMAS, isPersistentPreviewCommand } = await import('./src/services/sandbox/sandbox-tools.ts');
const { sandboxRegistry } = await import('./src/services/sandbox/sandbox-registry.ts');

const PROJECT = 'tools-project';
const changes: string[][] = [];
const tools = createSandboxTools(PROJECT, { onChange: paths => changes.push(paths) });

try {
  // -- the surface the model is given ----------------------------------
  const names = SANDBOX_TOOL_SCHEMAS.map(tool => tool.name);
  assert.deepEqual(names, [
    'list_files', 'read_file', 'search_files', 'write_file', 'edit_file',
    'delete_file', 'install_package', 'run_command', 'get_logs', 'restart_server',
  ]);
  for (const schema of SANDBOX_TOOL_SCHEMAS) {
    assert.ok(schema.description.length > 30, `${schema.name} must tell the model when to use it`);
    assert.equal(schema.parameters.type, 'object');
  }

  // -- writing and reading ---------------------------------------------
  assert.deepEqual(await tools.call('list_files'), { ok: true, files: [], count: 0 });

  const written = await tools.call('write_file', { path: 'src/App.tsx', content: 'export default function App() {\n  return <h1>Hello</h1>;\n}\n' });
  assert.equal(written.ok, true);
  assert.deepEqual(changes.at(-1), ['src/App.tsx'], 'a write reports what changed, so the caller can decide about restarting');

  const read = await tools.call('read_file', { path: 'src/App.tsx' });
  assert.equal(read.ok, true);
  assert.match(String((read as any).content), /Hello/);

  // A miss names the alternatives. A model told only "not found" invents a
  // path; one handed the listing corrects itself.
  const missing = await tools.call('read_file', { path: 'src/Missing.tsx' });
  assert.equal(missing.ok, false);
  assert.match(String((missing as any).hint), /src\/App\.tsx/);

  // -- searching --------------------------------------------------------
  await tools.call('write_file', { path: 'src/components/Button.tsx', content: 'export const Button = () => <button className="bg-blue-500">Go</button>;\n' });
  const found = await tools.call('search_files', { query: 'bg-blue-500' });
  assert.equal(found.ok, true);
  assert.equal((found as any).count, 1);
  assert.equal((found as any).matches[0].path, 'src/components/Button.tsx');
  assert.equal((found as any).matches[0].line, 1);

  // -- editing ----------------------------------------------------------
  const edited = await tools.call('edit_file', { path: 'src/components/Button.tsx', find: 'bg-blue-500', replace: 'bg-black' });
  assert.equal(edited.ok, true);
  assert.match(String((await tools.call('read_file', { path: 'src/components/Button.tsx' }) as any).content), /bg-black/);

  // A snippet that is gone is a correction, not a crash.
  const stale = await tools.call('edit_file', { path: 'src/components/Button.tsx', find: 'bg-blue-500', replace: 'x' });
  assert.equal(stale.ok, false);
  assert.match(String((stale as any).hint), /Read the file again/);

  // An ambiguous edit is refused rather than applied to the wrong one: this
  // is the failure a model cannot see, because the write reports success.
  await tools.call('write_file', { path: 'src/Repeated.tsx', content: 'const a = 1;\nconst a2 = 1;\nconst a3 = 1;\n' });
  const ambiguous = await tools.call('edit_file', { path: 'src/Repeated.tsx', find: '= 1;', replace: '= 2;' });
  assert.equal(ambiguous.ok, false);
  assert.match(String((ambiguous as any).error), /appears 3 times/);
  assert.match(String((await tools.call('read_file', { path: 'src/Repeated.tsx' }) as any).content), /const a = 1;/, 'and nothing was changed');

  // -- deleting ---------------------------------------------------------
  assert.equal((await tools.call('delete_file', { path: 'src/Repeated.tsx' })).ok, true);
  assert.ok(!((await tools.call('list_files') as any).files.includes('src/Repeated.tsx')));

  // -- containment holds through the tools -------------------------------
  // The tools are the model's only reach into the host, so the path checks
  // have to survive being called through them.
  for (const escape of ['../other/.env', '/etc/passwd', 'src/../../../etc/hosts']) {
    const result = await tools.call('write_file', { path: escape, content: 'x' });
    assert.equal(result.ok, false, `write_file must refuse ${escape}`);
    assert.equal((await tools.call('read_file', { path: escape })).ok, false, `read_file must refuse ${escape}`);
  }

  // -- commands ----------------------------------------------------------
  const blocked = await tools.call('run_command', { command: 'rm', args: ['-rf', '/'] });
  assert.equal(blocked.ok, false);
  assert.match(String((blocked as any).error), /allow-list/);

  // An install is not reachable through run_command, and the refusal says
  // which tool is.
  const sneaky = await tools.call('run_command', { command: 'npm', args: ['install', 'left-pad'] });
  assert.equal(sneaky.ok, false);
  for (const command of [
    { command: 'npm', args: ['run', 'dev'] },
    { command: 'npm', args: ['start'] },
    { command: 'pnpm', args: ['preview'] },
    { command: 'yarn', args: ['run', 'serve'] },
    { command: 'bun', args: ['run', 'start'] },
    { command: 'vite', args: [] },
    { command: 'npx', args: ['vite', 'preview'] },
    { command: 'bunx', args: ['vite'] },
  ]) {
    const persistent = await tools.call('run_command', command);
    assert.equal(persistent.ok, false, `${command.command} ${command.args.join(' ')} must not occupy a finite check slot until timeout`);
    assert.match(String((persistent as any).hint || ''), /existing dev server/i);
  }
  assert.equal(isPersistentPreviewCommand('vite', ['build']), false, 'a finite Vite build remains available');
  assert.match(String((sneaky as any).hint), /install_package/);

  // A package name is validated before npm sees it.
  for (const bad of ['', '--force', 'http://evil.test/x.tgz', '; rm -rf /']) {
    const result = await tools.call('install_package', { name: bad });
    assert.equal(result.ok, false, `install_package must refuse ${JSON.stringify(bad)}`);
  }

  // -- unknown tools -----------------------------------------------------
  const unknown = await tools.call('deploy_to_production', {});
  assert.equal(unknown.ok, false);
  assert.match(String((unknown as any).hint), /list_files/);

  // -- logs and restart on a project that never started -------------------
  assert.equal((await tools.call('get_logs')).ok, true, 'logs are readable before anything runs');
  const restart = await tools.call('restart_server');
  assert.equal(restart.ok, false, 'a project with no dev script cannot report a restart');
  assert.ok((restart as any).error, 'and says why');

  console.log('sandbox tool tests passed');
} finally {
  await sandboxRegistry.destroy(PROJECT).catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
