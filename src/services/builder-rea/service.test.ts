import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBuilderReaTools } from './service';
import { REA_LIMITS } from './policy';

const evidence = 'ev_' + 'a'.repeat(64);
const folders: string[] = [];
const services: Array<NonNullable<ReturnType<typeof createBuilderReaTools>>> = [];
afterEach(async () => { await Promise.all(services.splice(0).map(s => s.dispose())); await Promise.all(folders.splice(0).map(f => rm(f, { recursive: true, force: true }))); });
async function fixture(projectId = 'project-a', userId = 'owner-a') {
  const dir = await mkdtemp(path.join(tmpdir(), 'coden-rea-test-')); folders.push(dir);
  await mkdir(path.join(dir, 'imported'));
  await writeFile(path.join(dir, 'imported', 'main.js'), "export const route = '/checkout';");
  const client = { close: vi.fn(async () => {}), callTool: vi.fn(async () => ({ structuredContent: { result: { evidence_id: evidence, normalized_result: { modules: ['main.js'] }, confidence: 'observed', limitations: ['Static observations only.'] } } })) };
  const roots: string[] = [];
  const connect = vi.fn(async (root: string) => { roots.push(root); return client; });
  const service = createBuilderReaTools({ projectId, userId, sandbox: { projectId, dir }, connect })!; services.push(service);
  return { dir, client, connect, roots, service };
}
describe('project-scoped Builder REA', () => {
  it('refuses other paths and evidence before launching a worker', async () => {
    const f = await fixture();
    for (const target of ['../project-b', 'C:\\secret', '/etc/passwd', '.env', 'imported/../.ssh']) {
      expect(await f.service.call('rea_analyze_javascript', { path: target })).toMatchObject({ ok: false });
    }
    expect(await f.service.call('rea_read_analysis', { evidence_id: evidence, view: 'summary' })).toMatchObject({ ok: false, error: 'REA_EVIDENCE_NOT_IN_RUN' });
    expect(f.connect).not.toHaveBeenCalled();
  });
  it('copies an immutable bounded artifact while excluding secrets', async () => {
    const f = await fixture();
    await writeFile(path.join(f.dir, 'imported', '.env.local'), 'SECRET=private');
    await writeFile(path.join(f.dir, 'imported', 'secrets.json'), '{"secret":"private"}');
    const result = await f.service.call('rea_analyze_javascript', { path: 'imported' }) as any;
    expect(result).toMatchObject({ ok: true, selection: { files: 1, excludedFiles: 2 }, evidenceIds: [evidence] });
    const snapshot = path.join(f.roots[0], 'artifact-1');
    expect(await readdir(snapshot)).toEqual(['main.js']);
    await writeFile(path.join(f.dir, 'imported', 'main.js'), 'changed');
    expect(await readFile(path.join(snapshot, 'main.js'), 'utf8')).toContain('/checkout');
    expect(f.client.callTool).toHaveBeenCalledWith(expect.objectContaining({ name: 'analyze_javascript_application', arguments: expect.objectContaining({ detail: 'summary', max_heap_mb: REA_LIMITS.heapMb }) }), expect.anything());
    await f.service.dispose();
    await expect(readdir(f.roots[0])).rejects.toThrow();
    expect(f.client.close).toHaveBeenCalledOnce();
  });
  it('never shares evidence handles between owners or projects', async () => {
    const a = await fixture(), b = await fixture('project-b', 'owner-b');
    await a.service.call('rea_analyze_javascript', { path: 'imported' });
    expect(await b.service.call('rea_trace_feature', { evidence_id: evidence, kind: 'module', value: 'main.js', direction: 'outgoing' })).toMatchObject({ ok: false, error: 'REA_EVIDENCE_NOT_IN_RUN' });
    expect(b.connect).not.toHaveBeenCalled();
    expect(await a.service.call('rea_read_analysis', { evidence_id: evidence, view: 'modules', offset: 0 })).toMatchObject({ ok: true });
  });
  it('rejects symbolic artifacts and oversized input', async () => {
    const f = await fixture();
    await symlink(f.dir, path.join(f.dir, 'imported', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await f.service.call('rea_analyze_javascript', { path: 'imported' })).toMatchObject({ ok: false, error: 'REA_SCOPE_DENIED' });
    expect(f.client.callTool).not.toHaveBeenCalled();
    await rm(path.join(f.dir, 'imported', 'escape'));
    await writeFile(path.join(f.dir, 'imported', 'big.js'), 'x'.repeat(REA_LIMITS.fileBytes + 1));
    expect(await f.service.call('rea_analyze_javascript', { path: 'imported' })).toMatchObject({ ok: false, error: 'REA_INPUT_LIMIT' });
  });
  it('bounds analysis attempts, never accepts arbitrary REA operations, and respects rollback', async () => {
    const f = await fixture();
    for (let i = 0; i < REA_LIMITS.analyses; i++) await f.service.call('rea_analyze_javascript', { path: 'imported' });
    expect(await f.service.call('rea_analyze_javascript', { path: 'imported' })).toMatchObject({ error: 'REA_ANALYSIS_LIMIT' });
    expect(await f.service.call('open_binary', { path: f.dir })).toMatchObject({ error: 'REA_TOOL_UNAVAILABLE' });
    expect(createBuilderReaTools({ projectId: 'a', userId: 'b', sandbox: { projectId: 'a', dir: f.dir }, enabled: false })).toBeUndefined();
  });
  it('reuses an identical inventory without repeating the static analysis', async () => {
    const f = await fixture();
    expect(await f.service.call('rea_inspect_artifact', { path: 'imported' })).toMatchObject({ ok: true, selection: { reused: false } });
    expect(await f.service.call('rea_analyze_javascript', { path: 'imported' })).toMatchObject({ ok: true, selection: { reused: true }, evidenceIds: [evidence] });
    expect(f.client.callTool).toHaveBeenCalledOnce();
  });
  it('bounds directory enumeration even when every entry is excluded', async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: REA_LIMITS.entries + 1 }, (_, i) => writeFile(path.join(f.dir, 'imported', `${i}.txt`), 'excluded')));
    expect(await f.service.call('rea_inspect_artifact', { path: 'imported' })).toMatchObject({ ok: false, error: 'REA_INPUT_LIMIT' });
    expect(f.client.callTool).not.toHaveBeenCalled();
  });
  it('reports provider failures without returning their private payload', async () => {
    const f = await fixture();
    f.client.callTool.mockImplementation(async () => ({ structuredContent: { result: { error: { message: f.dir }, ok: false } } }) as any);
    const result = await f.service.call('rea_analyze_javascript', { path: 'imported' });
    expect(result).toMatchObject({ ok: false, error: 'REA_ANALYSIS_FAILED' });
    expect(JSON.stringify(result)).not.toContain(f.dir);
  });
  it('reports incomplete delivery explicitly and strips internal locations', async () => {
    const f = await fixture();
    f.client.callTool.mockImplementation(async () => ({ structuredContent: { result: { evidence_id: evidence, normalized_result: { modules: [f.dir, 'x'.repeat(REA_LIMITS.outputChars + 1)] }, confidence: 'observed', limitations: [] } } }));
    const result = await f.service.call('rea_analyze_javascript', { path: 'imported' }) as any;
    expect(result).toMatchObject({ ok: true, delivery: 'partial', evidenceIds: [evidence] });
    expect(JSON.stringify(result)).not.toContain(f.dir);
    expect(result.result).toBeUndefined();
  });
  it('ends on cancellation without persisting or leaking an error payload', async () => {
    const f = await fixture();
    const controller = new AbortController();
    controller.abort();
    const s = createBuilderReaTools({ projectId: 'project-a', userId: 'owner-a', sandbox: { projectId: 'project-a', dir: f.dir }, signal: controller.signal, connect: f.connect })!; services.push(s);
    await expect(s.call('rea_analyze_javascript', { path: 'imported' })).rejects.toThrow();
    expect(f.connect).not.toHaveBeenCalled();
  });
});
