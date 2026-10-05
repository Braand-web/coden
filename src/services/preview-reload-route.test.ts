import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { loadGenerationFiles } from './project-file-recovery';

// Execute the registered production route, not a second implementation of it.
const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const routeSource = server.slice(server.indexOf("app.post('/api/projects/:id/sandbox/start'"), server.indexOf("app.get('/api/projects/:id/sandbox/status'"));
const code = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const committed = [{ path: 'index.html', content: '<main>Last saved app</main>' }, { path: 'src/index.css', content: '.app{color:#abc}' }];
const checkpoint = [{ path: 'index.html', content: '<main>Recoverable first build</main>' }, { path: 'src/index.css', content: '.app{color:#def}' }];

function fixture() {
  let handler!: (req: any, res: any) => Promise<unknown>;
  let state = { state: 'idle', basePath: '', port: 3100, lastError: null as string | null };
  const release = vi.fn();
  const sandbox = {
    replaceProjectFiles: vi.fn(async (_files: unknown[]) => undefined),
    setEnv: vi.fn(), hasFile: vi.fn(async () => true),
    install: vi.fn(async () => ({ ok: true, durationMs: 1 })),
    start: vi.fn(async ({ basePath }: { basePath: string }) => (state = { ...state, state: 'running', basePath })),
    getLogs: vi.fn(() => []),
  };
  const deps = {
    app: { post: (_path: string, _auth: unknown, route: typeof handler) => { handler = route; } },
    requireAuth: vi.fn(), requireLiveSandbox: vi.fn(() => true),
    getRequiredAuth: vi.fn(() => ({ userId: 'viewer' })),
    loadProject: vi.fn(async () => ({ id: 'app-a', owner_id: 'owner-a' })),
    requireProjectCapability: vi.fn(() => true),
    sandboxRegistry: {
      peek: vi.fn(() => ({ status: () => state })), get: vi.fn(() => sandbox),
      reserveRun: vi.fn(() => release), makeRoomFor: vi.fn(async () => []),
    },
    loadGenerationFiles,
    loadProjectFiles: vi.fn(async () => committed),
    loadDurableProjectSnapshot: vi.fn(async () => ({ files_snapshot: checkpoint })),
    normalizeGeneratedFiles: (files: unknown[]) => files,
    getSupabase: vi.fn(() => ({})),
    loadProjectBackendEnv: vi.fn(async () => ({ VITE_SUPABASE_URL: 'https://app-a.example.test', VITE_SUPABASE_ANON_KEY: 'public-test-key' })),
    loadProjectServerSecrets: vi.fn(async () => ({ EXAMPLE_SERVER_SECRET: 'not-a-real-secret' })),
    issuePreviewToken: vi.fn(() => 'test-token'),
  };
  new Function(...Object.keys(deps), code)(...Object.values(deps));
  const res = {
    statusCode: 200, body: undefined as any,
    status(value: number) { this.statusCode = value; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  return { deps, sandbox, res, release, setState: (value: typeof state) => { state = value; }, run: () => handler({ params: { id: 'app-a' } }, res) };
}

describe('production preview restart route', () => {
  it('restores the entire saved app and original per-app environment', async () => {
    const f = fixture();
    await f.run();
    expect(f.sandbox.replaceProjectFiles).toHaveBeenCalledWith(committed);
    expect(f.deps.loadDurableProjectSnapshot).not.toHaveBeenCalled();
    expect(f.sandbox.setEnv).toHaveBeenCalledWith({ EXAMPLE_SERVER_SECRET: 'not-a-real-secret', VITE_SUPABASE_URL: 'https://app-a.example.test', VITE_SUPABASE_ANON_KEY: 'public-test-key' });
    expect(f.res.body.preview_url).toBe('/preview/test-token/');
    expect(JSON.stringify(f.res.body)).not.toContain('not-a-real-secret');
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('restarts an interrupted first build from its owner-scoped checkpoint', async () => {
    const f = fixture();
    f.deps.loadProjectFiles.mockResolvedValueOnce([]);
    await f.run();
    expect(f.deps.loadDurableProjectSnapshot).toHaveBeenCalledWith('app-a', 'owner-a');
    expect(f.sandbox.replaceProjectFiles).toHaveBeenCalledWith(checkpoint);
    expect(f.res.statusCode).toBe(200);
  });
  it('reuses a live app without replacing files or restarting its process', async () => {
    const f = fixture();
    f.setState({ state: 'running', basePath: '/preview/already-running/', port: 3100, lastError: null });
    await f.run();
    expect(f.res.body.preview_url).toBe('/preview/already-running/');
    expect(f.sandbox.replaceProjectFiles).not.toHaveBeenCalled();
    expect(f.sandbox.start).not.toHaveBeenCalled();
    expect(f.deps.sandboxRegistry.reserveRun).not.toHaveBeenCalled();
  });
  it('does not overwrite an active generation or a concurrent restart', async () => {
    const f = fixture();
    f.deps.sandboxRegistry.reserveRun.mockImplementationOnce(() => { throw Object.assign(new Error('busy'), { diagnosticCode: 'PROJECT_RUN_ACTIVE' }); });
    await f.run();
    expect(f.res.statusCode).toBe(202);
    expect(f.res.body.state).toBe('starting');
    expect(f.deps.loadProjectFiles).not.toHaveBeenCalled();
    expect(f.sandbox.replaceProjectFiles).not.toHaveBeenCalled();
    expect(f.sandbox.start).not.toHaveBeenCalled();
  });
  it('fails closed on a database read error and releases the writer lease', async () => {
    const f = fixture();
    f.deps.loadProjectFiles.mockRejectedValueOnce(new Error('database offline'));
    await f.run();
    expect(f.res.statusCode).toBe(500);
    expect(f.deps.loadDurableProjectSnapshot).not.toHaveBeenCalled();
    expect(f.sandbox.replaceProjectFiles).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('does not start anything when the caller lacks project view permission', async () => {
    const f = fixture();
    f.deps.requireProjectCapability.mockReturnValueOnce(false);
    await f.run();
    expect(f.deps.loadProjectFiles).not.toHaveBeenCalled();
    expect(f.deps.loadProjectBackendEnv).not.toHaveBeenCalled();
    expect(f.deps.sandboxRegistry.reserveRun).not.toHaveBeenCalled();
  });
});
