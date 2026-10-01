import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildPublicationInMicroVM, publicationRelativePath, validatePublicationAssets, type PublishBuildSandbox } from './publish-isolated-build.ts';

let dir = '';
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; vi.unstubAllEnvs(); });
const source = { files: { 'package.json': { content: '{"scripts":{"build":"vite build"}}' }, 'src/app.ts': { content: 'app' } } };
const binary = Uint8Array.from([0, 255, 128, 42]);
const outputs = { 'index.html': Buffer.from('<html><body>Hello</body></html>'), 'assets/logo.png': Buffer.from(binary) };
const assets = Object.entries(outputs).map(([path, bytes]) => ({ path, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
async function fixture(fail = false, corrupt = false) {
  dir = await mkdtemp(path.join(os.tmpdir(), 'coden-publication-test-'));
  const run = vi.fn(async (command: string) => {
    if (fail) throw new Error('private provider error');
    return { exitCode: 0, stdout: command.startsWith('node -e') ? JSON.stringify(assets) : '' };
  });
  const vm: PublishBuildSandbox = {
    sandboxId: 'test-build',
    files: {
      write: vi.fn(async () => undefined), remove: vi.fn(async () => undefined),
      read: vi.fn(async (file: string) => new ReadableStream({ start(c) {
        const key = file.replace('/home/user/app/dist/', '') as keyof typeof outputs;
        c.enqueue(corrupt ? new Uint8Array([1, 2]) : outputs[key]); c.close();
      } })),
    },
    commands: { run }, getHost: () => '', setTimeout: async () => undefined,
    kill: vi.fn(async () => true),
  };
  const factory = vi.fn(async () => vm);
  const options = { slug: 'test', projectId: 'project-test', workDir: dir, publicEnv: { VITE_THEME: 'blue', VITE_SERVICE_ROLE: 'secret', OPENROUTER_API_KEY: 'secret' } };
  const deps = { factory, env: { E2B_API_KEY: 'control-plane-only', CLOUDFLARE_API_TOKEN: 'hosting-only', SUPABASE_SERVICE_ROLE_KEY: 'server-only' } };
  return { vm, run, factory, options, deps };
}

describe('isolated publication builds', () => {
  it('builds only in the VM and transfers binary files losslessly', async () => {
    const f = await fixture();
    const dist = await buildPublicationInMicroVM(source, f.options, f.deps);
    expect(await readFile(path.join(dist, 'assets/logo.png'))).toEqual(Buffer.from(binary));
    expect(await readFile(path.join(dist, 'index.html'), 'utf8')).toContain('Hello');
    expect(f.run.mock.calls[0][0]).toContain('--ignore-scripts --include=dev');
    expect(f.run.mock.calls[1][0]).toBe('npm run build');
    expect(f.vm.kill).toHaveBeenCalledOnce();
  });
  it('never sends platform credentials or forbidden public names to the VM', async () => {
    vi.stubEnv('RESEND_API_KEY', 'private'); vi.stubEnv('CLOUDFLARE_API_TOKEN', 'private');
    const f = await fixture();
    await buildPublicationInMicroVM(source, f.options, f.deps);
    const options = (f.factory.mock.calls as any)[0][0];
    expect(options.envs).toMatchObject({ VITE_THEME: 'blue', NODE_ENV: 'production' });
    for (const name of ['E2B_API_KEY', 'CLOUDFLARE_API_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'OPENROUTER_API_KEY', 'VITE_SERVICE_ROLE']) expect(options.envs[name]).toBeUndefined();
  });
  it('kills the VM on build failure and does not forward its raw exception', async () => {
    const f = await fixture(true);
    await expect(buildPublicationInMicroVM(source, f.options, f.deps)).rejects.toThrow('ISOLATED_PUBLICATION_BUILD_FAILED');
    expect(f.vm.kill).toHaveBeenCalledOnce();
  });
  it('refuses missing isolation rather than executing a host fallback', async () => {
    const f = await fixture();
    await expect(buildPublicationInMicroVM(source, f.options, { ...f.deps, env: {} })).rejects.toThrow('ISOLATED_BUILD_UNAVAILABLE');
    expect(f.factory).not.toHaveBeenCalled();
  });
  it('rejects changed or oversized transferred bytes', async () => {
    const f = await fixture(false, true);
    await expect(buildPublicationInMicroVM(source, f.options, f.deps)).rejects.toThrow('BUILD_ARTIFACT_CHANGED');
    expect(f.vm.kill).toHaveBeenCalledOnce();
  });
  it.each(['../outside', '/absolute', 'C:/outside', 'a\\b', 'a/../b', 'a//b', 'nul.txt', 'a.'])('rejects unsafe paths: %s', value => {
    expect(() => publicationRelativePath(value)).toThrow('INVALID_PUBLICATION_PATH');
  });
  it('rejects case collisions, missing index, secrets and executable Worker output', () => {
    for (const extra of ['INDEX.HTML', '.env', '_worker.js']) expect(() => validatePublicationAssets([...assets, { ...assets[0], path: extra }])).toThrow();
    expect(() => validatePublicationAssets(assets.slice(1))).toThrow('BUILD_INDEX_MISSING');
    expect(() => validatePublicationAssets([{ ...assets[0], size: 30 * 1024 * 1024 }])).toThrow();
  });
});
