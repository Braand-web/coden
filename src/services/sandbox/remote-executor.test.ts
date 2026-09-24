import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteExecutor, imageTreeCheck, remoteEnv, remoteSandboxConfigured, setRemoteSandboxFactory, shellQuote, type RemoteSandboxClient } from './remote-executor';

/** An in-memory VM: files, commands and a dev server that prints its URL. */
function fakeVm(options: { failCommand?: RegExp; devOutput?: string } = {}) {
  const files = new Map<string, string>();
  const commands: Array<{ cmd: string; opts: any }> = [];
  let killed = false;
  let serverKilled = false;
  const client: RemoteSandboxClient = {
    sandboxId: 'sbx_test',
    files: {
      async write(entries) { for (const entry of entries) files.set(entry.path, Buffer.from(entry.data as ArrayBuffer).toString('utf8')); },
      async remove(p) { files.delete(p); },
    },
    commands: {
      async run(cmd, opts: any) {
        commands.push({ cmd, opts });
        if (opts.background) {
          setTimeout(() => opts.onStdout?.(options.devOutput ?? '  ➜  Local:   http://localhost:5173/preview/tok/\n'), 5);
          return { pid: 1, kill: async () => { serverKilled = true; return true; }, wait: () => new Promise(() => {}) };
        }
        opts.onStdout?.(`ran ${cmd}\n`);
        if (options.failCommand?.test(cmd)) throw Object.assign(new Error('exit 2'), { exitCode: 2, stdout: '', stderr: 'boom' });
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    },
    getHost: port => `${port}-sbx_test.e2b.app`,
    setTimeout: async () => {},
    kill: async () => { killed = true; return true; },
  };
  return { client, files, commands, get killed() { return killed; }, get serverKilled() { return serverKilled; } };
}

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

async function projectDir(tree: Record<string, string>) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'coden-remote-'));
  for (const [rel, content] of Object.entries(tree)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  }
  return dir;
}

describe('remote executor (E2B microVM)', () => {
  it('is enabled by E2B_API_KEY only, and can be forced local', () => {
    expect(remoteSandboxConfigured({})).toBe(false);
    expect(remoteSandboxConfigured({ E2B_API_KEY: 'e2b_x' })).toBe(true);
    expect(remoteSandboxConfigured({ E2B_API_KEY: 'e2b_x', CODEN_SANDBOX_PROVIDER: 'local' })).toBe(false);
  });

  it('gives the VM the project environment and nothing of the platform', () => {
    const env = remoteEnv({ VITE_SUPABASE_URL: 'https://x.supabase.co', 'BAD-KEY': 'x', NODE_OPTIONS: '--inspect' });
    expect(env.VITE_SUPABASE_URL).toBe('https://x.supabase.co');
    expect(env['BAD-KEY']).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS).toBe('.e2b.app');
  });

  it('quotes every argument so nothing reaches a shell unquoted', () => {
    expect(shellQuote('install')).toBe('install');
    expect(shellQuote("a b; rm -rf / 'x'")).toBe(`'a b; rm -rf / '\\''x'\\'''`);
  });

  it('pushes only what changed, removes what was deleted, and skips node_modules', async () => {
    const vm = fakeVm();
    const executor = new RemoteExecutor('p1', await projectDir({ 'package.json': '{}', 'src/App.tsx': 'v1', 'node_modules/x/index.js': 'no' }), async () => vm.client);
    expect(await executor.sync()).toEqual({ written: 2, removed: 0 });
    expect([...vm.files.keys()].sort()).toEqual(['/home/user/app/package.json', '/home/user/app/src/App.tsx']);
    expect(await executor.sync()).toEqual({ written: 0, removed: 0 });
    await writeFile(path.join(dir, 'src/App.tsx'), 'v2');
    await rm(path.join(dir, 'package.json'));
    expect(await executor.sync()).toEqual({ written: 1, removed: 1 });
    expect(vm.files.get('/home/user/app/src/App.tsx')).toBe('v2');
    expect(vm.files.has('/home/user/app/package.json')).toBe(false);
  });

  it('runs a command in the VM with current files, and reports a non-zero exit as a result', async () => {
    const vm = fakeVm({ failCommand: /tsc/ });
    const executor = new RemoteExecutor('p1', await projectDir({ 'package.json': '{}' }), async () => vm.client);
    const ok = await executor.run('npm', ['install', '--ignore-scripts'], { timeoutMs: 1000 });
    expect(ok).toMatchObject({ code: 0, timedOut: false });
    expect(vm.commands[0].cmd).toBe('npm install --ignore-scripts');
    expect(vm.commands[0].opts.cwd).toBe('/home/user/app');
    const failed = await executor.run('npx', ['tsc', '--noEmit'], { timeoutMs: 1000 });
    expect(failed.code).toBe(2);
  });

  it('starts the dev server on all interfaces and returns the VM origin', async () => {
    const vm = fakeVm();
    const executor = new RemoteExecutor('p1', await projectDir({ 'package.json': '{}' }), async () => vm.client, { idleReleaseMs: 20 });
    const started = await executor.startServer({ script: 'dev', basePath: '/preview/tok/', timeoutMs: 1000 });
    expect(started).toEqual({ port: 5173, origin: 'https://5173-sbx_test.e2b.app' });
    const cmd = vm.commands.find(c => c.opts.background)!.cmd;
    expect(cmd).toContain('--host 0.0.0.0');
    expect(cmd).toContain('--base=/preview/tok/');
    // Stopped and idle: the VM is released on its own.
    await executor.stopServer();
    expect(vm.serverKilled).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(vm.killed).toBe(true);
    expect(executor.sandboxId).toBeNull();
  });

  it('times out a server that never reports its URL', async () => {
    const vm = fakeVm({ devOutput: 'still compiling…\n' });
    const executor = new RemoteExecutor('p1', await projectDir({ 'package.json': '{}' }), async () => vm.client);
    await expect(executor.startServer({ script: 'dev', basePath: '', timeoutMs: 50 })).rejects.toThrow(/did not report a URL/);
  });

  it('is what ProjectSandbox uses when E2B is configured, and the host never runs the command', async () => {
    // The image's tree is not this project's: the install runs, in the VM.
    const vm = fakeVm({ failCommand: /^node -e / });
    const previous = setRemoteSandboxFactory(async () => vm.client);
    const saved = { key: process.env.E2B_API_KEY, env: process.env.NODE_ENV, root: process.env.CODEN_SANDBOX_ROOT };
    process.env.E2B_API_KEY = 'e2b_test';
    process.env.NODE_ENV = 'production';
    process.env.CODEN_SANDBOX_ROOT = await mkdtemp(path.join(os.tmpdir(), 'coden-root-'));
    try {
      const { ProjectSandbox, hostSandboxExecutionAllowed } = await import('./project-sandbox');
      expect(hostSandboxExecutionAllowed()).toBe(true);
      const sandbox = new ProjectSandbox('remote-project');
      expect(sandbox.isRemote).toBe(true);
      await sandbox.writeFiles([{ path: 'package.json', content: '{"name":"x"}' }]);
      const install = await sandbox.install({ timeoutMs: 1000 });
      expect(install.ok).toBe(true);
      expect(await sandbox.hasDependencies()).toBe(true);
      expect(vm.commands.map(command => command.cmd.split(' ').slice(0, 2).join(' '))).toEqual(expect.arrayContaining(['node -e', 'npm install']));
      await sandbox.destroy();
      expect(vm.killed).toBe(true);

      // Same project on a VM whose image tree already is its own: no install.
      const warm = fakeVm();
      setRemoteSandboxFactory(async () => warm.client);
      const second = new ProjectSandbox('remote-project-warm');
      await second.writeFiles([{ path: 'package.json', content: '{"name":"y"}' }]);
      const skipped = await second.install({ timeoutMs: 1000 });
      expect(skipped.ok).toBe(true);
      expect(skipped.output).toMatch(/already present/);
      expect(await second.hasDependencies()).toBe(true);
      expect(warm.commands.some(command => /^npm /.test(command.cmd))).toBe(false);
      await second.destroy();
    } finally {
      setRemoteSandboxFactory(previous);
      if (saved.key === undefined) delete process.env.E2B_API_KEY; else process.env.E2B_API_KEY = saved.key;
      process.env.NODE_ENV = saved.env;
      if (saved.root === undefined) delete process.env.CODEN_SANDBOX_ROOT; else process.env.CODEN_SANDBOX_ROOT = saved.root;
    }
  });
});

describe('preview proxy to a VM origin', () => {
  it('forwards to the origin with its Host, so the VM routes the request', async () => {
    const http = await import('node:http');
    const { proxyHttp } = await import('./preview-proxy');
    const seen: string[] = [];
    const upstream = http.createServer((req, res) => { seen.push(String(req.headers.host)); res.end(`ok ${req.url}`); });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as any).port;
    const front = http.createServer((req, res) => proxyHttp(req, res, { origin: `http://127.0.0.1:${upstreamPort}` }, ''));
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve));
    try {
      const response = await fetch(`http://127.0.0.1:${(front.address() as any).port}/preview/tok/src/main.tsx`);
      expect(await response.text()).toBe('ok /preview/tok/src/main.tsx');
      expect(seen[0]).toBe(`127.0.0.1:${upstreamPort}`);
      expect(response.headers.get('content-security-policy')).toBe("frame-ancestors 'self'");
    } finally {
      front.close(); upstream.close();
    }
  });
});

describe('remote executor VM lifetime', () => {
  it('keeps a watched VM alive, and replaces one that expired instead of reusing it', async () => {
    const root = await projectDir({ 'package.json': '{"scripts":{"dev":"vite"}}' });
    const first = fakeVm();
    const second = fakeVm();
    let extended = 0;
    let gone = false;
    first.client.setTimeout = async () => {
      if (gone) throw new Error('Sandbox sbx_test not found');
      extended += 1;
    };
    const vms = [first.client, second.client];
    const executor = new RemoteExecutor('p1', root, async () => vms.shift()!);
    await executor.run('node', ['-v'], { timeoutMs: 1_000 });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      // Viewing the preview extends the VM, at most once a minute.
      clock.mockReturnValue(now + 61_000);
      expect(await executor.keepAlive()).toBe(true);
      expect(await executor.keepAlive()).toBe(true);
      expect(extended).toBe(1);

      // The VM expires: it is forgotten, and the next command gets a new one.
      gone = true;
      clock.mockReturnValue(now + 130_000);
      expect(await executor.keepAlive()).toBe(false);
      await executor.run('node', ['-v'], { timeoutMs: 1_000 });
      expect(second.commands.some(entry => entry.cmd.includes('node'))).toBe(true);
      expect(executor.sandboxId).toBe('sbx_test');
    } finally {
      clock.mockRestore();
    }
  });
});

describe('dependencies already in the VM image', () => {
  let root = '';
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = ''; });

  async function layout(project: Record<string, string>, installed: Record<string, string>) {
    root = await mkdtemp(path.join(os.tmpdir(), 'coden-image-'));
    const image = path.join(root, 'image');
    const app = path.join(root, 'app');
    await mkdir(image, { recursive: true });
    await writeFile(path.join(image, 'package.json'), JSON.stringify({ dependencies: { react: '18.3.1', clsx: '^2.1.0' }, devDependencies: { vite: '6.2.0' } }));
    await writeFile(path.join(image, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/react': { version: '18.3.1' }, 'node_modules/clsx': { version: '2.1.1' }, 'node_modules/vite': { version: '6.2.0' } } }));
    await mkdir(app, { recursive: true });
    await writeFile(path.join(app, 'package.json'), JSON.stringify({ dependencies: project }));
    for (const [name, version] of Object.entries(installed)) {
      await mkdir(path.join(app, 'node_modules', name), { recursive: true });
      await writeFile(path.join(app, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
    }
    return { image, app };
  }
  const satisfied = (image: string, app: string) => {
    try { execFileSync(process.execPath, ['-e', imageTreeCheck(image)], { cwd: app, stdio: 'ignore' }); return true; } catch { return false; }
  };

  it('skips the install when every dependency is the image\'s own', async () => {
    const { image, app } = await layout({ react: '18.3.1', clsx: '^2.1.0' }, { react: '18.3.1', clsx: '2.1.1' });
    expect(satisfied(image, app)).toBe(true);
  });

  it('installs when a package is new, at another version, or not from the registry', async () => {
    let dirs = await layout({ react: '18.3.1', recharts: '2.15.0' }, { react: '18.3.1' });
    expect(satisfied(dirs.image, dirs.app)).toBe(false);
    await rm(root, { recursive: true, force: true });
    dirs = await layout({ react: '19.0.0' }, { react: '18.3.1' });
    expect(satisfied(dirs.image, dirs.app)).toBe(false);
    await rm(root, { recursive: true, force: true });
    dirs = await layout({ clsx: '^2.0.0' }, { clsx: '2.1.1' });
    expect(satisfied(dirs.image, dirs.app)).toBe(false);
    await rm(root, { recursive: true, force: true });
    dirs = await layout({ react: 'github:facebook/react' }, { react: '18.3.1' });
    expect(satisfied(dirs.image, dirs.app)).toBe(false);
  });

  it('asks the VM, and a failing check means install', async () => {
    const ok = fakeVm();
    const executor = new RemoteExecutor('p1', await projectDir({ 'package.json': '{}' }), async () => ok.client);
    expect(await executor.imageSatisfiesDependencies()).toBe(true);
    expect(ok.commands.some(command => /^node -e /.test(command.cmd))).toBe(true);
    const failing = fakeVm({ failCommand: /^node -e / });
    const other = new RemoteExecutor('p2', dir, async () => failing.client);
    expect(await other.imageSatisfiesDependencies()).toBe(false);
  });
});
