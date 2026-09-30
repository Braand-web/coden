import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandboxTools } from './sandbox-tools.ts';
import { ProjectSandbox } from './project-sandbox.ts';

let root = '';
beforeAll(() => { root = mkdtempSync(path.join(os.tmpdir(), 'coden-design-')); process.env.CODEN_SANDBOX_ROOT = root; });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

const CSS = ':root { --color-bg: #fff; --color-accent: #3366ff; }\n.card { padding: 8px; }\n';

describe('edit_file', () => {
  it('writes the replacement literally — `$&` and `$1` are code, not patterns', async () => {
    const sandbox = new ProjectSandbox('edit-literal');
    await sandbox.writeFiles([{ path: 'src/price.ts', content: 'export const label = "PLACEHOLDER";\n' }]);
    const tools = createSandboxTools('edit-literal', { sandbox });
    expect((await tools.call('edit_file', { path: 'src/price.ts', find: 'PLACEHOLDER', replace: 'cost: $& / $1 / $$ / $`' })).ok).toBe(true);
    expect(await sandbox.readProjectFile('src/price.ts')).toBe('export const label = "cost: $& / $1 / $$ / $`";\n');
  });
});

describe('the design guard on the real sandbox tools', () => {
  it('refuses to delete the stylesheet, and lets an unrelated file go', async () => {
    const sandbox = new ProjectSandbox('delete-guard');
    await sandbox.writeFiles([{ path: 'src/index.css', content: CSS }, { path: 'src/old.ts', content: 'export {};\n' }]);
    const tools = createSandboxTools('delete-guard', { sandbox, design: { allowValueChanges: true } });
    const refused = await tools.call('delete_file', { path: 'src/index.css' }) as any;
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('design layer');
    expect(await sandbox.hasFile('src/index.css')).toBe(true);
    expect((await tools.call('delete_file', { path: 'src/old.ts' })).ok).toBe(true);
  });

  it('is invisible when no guard is given, so callers that never asked for it behave as before', async () => {
    const sandbox = new ProjectSandbox('no-guard');
    await sandbox.writeFiles([{ path: 'src/index.css', content: CSS }]);
    const tools = createSandboxTools('no-guard', { sandbox });
    expect((await tools.call('write_file', { path: 'src/index.css', content: '.x{}' })).ok).toBe(true);
  });
});

describe('scaffold files the tools may not replace whole', () => {
  it('refuses a whole-file rewrite of package.json but lets edit_file change one line', async () => {
    const sandbox = new ProjectSandbox('scaffold-guard');
    await sandbox.writeFiles([{ path: 'package.json', content: '{\n  "name": "app",\n  "scripts": { "build": "vite build" }\n}\n' }, { path: 'src/App.tsx', content: 'export default () => null;\n' }]);
    const tools = createSandboxTools('scaffold-guard', { sandbox, design: { allowValueChanges: false, replaceProtected: ['package.json'] } });
    const refused = await tools.call('write_file', { path: 'package.json', content: '{ "name": "app" }' }) as any;
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('scaffold');
    expect(refused.hint).toContain('edit_file');
    expect((await tools.call('edit_file', { path: 'package.json', find: '"name": "app"', replace: '"name": "client-flow"' })).ok).toBe(true);
    // Ordinary files, and creating a protected one that is missing, are not affected.
    expect((await tools.call('write_file', { path: 'src/App.tsx', content: 'export default () => 1;\n' })).ok).toBe(true);
    expect((await tools.call('write_file', { path: 'vite.config.ts', content: 'export default {};\n' })).ok).toBe(true);
  });
});

describe('replaceProjectFiles', () => {
  it('makes the sandbox the saved project, dropping what an abandoned attempt left', async () => {
    const sandbox = new ProjectSandbox('replace-exact');
    await sandbox.writeFiles([
      { path: 'src/App.tsx', content: 'new' }, { path: 'src/Leftover.tsx', content: 'from a failed run' },
      { path: 'package-lock.json', content: '{}' }, { path: '.env.local', content: 'K=1' },
    ]);
    const result = await sandbox.replaceProjectFiles([{ path: 'src/App.tsx', content: 'saved' }, { path: 'src/index.css', content: CSS }]);
    expect(result.removed).toEqual(['src/Leftover.tsx']);
    expect(await sandbox.readProjectFile('src/App.tsx')).toBe('saved');
    expect(await sandbox.hasFile('package-lock.json')).toBe(true);
    expect(await sandbox.hasFile('.env.local')).toBe(true);
  });

  it('treats an empty set as a missing answer, never as "delete the project"', async () => {
    const sandbox = new ProjectSandbox('replace-empty');
    await sandbox.writeFiles([{ path: 'src/App.tsx', content: 'keep' }]);
    expect(await sandbox.replaceProjectFiles([])).toEqual({ written: [], removed: [] });
    expect(await sandbox.hasFile('src/App.tsx')).toBe(true);
  });
});
