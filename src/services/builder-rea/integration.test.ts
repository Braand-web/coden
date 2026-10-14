import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBuilderReaTools } from './service';
import { connectRea } from './client';
import { buildToolLoopTurn } from '../multi-agent-pipeline';

const parentId = (value: any): string | undefined => {
  if (!value || typeof value !== 'object') return;
  if (typeof value.parent_evidence_id === 'string') return value.parent_evidence_id;
  for (const child of Object.values(value)) { const found = parentId(child); if (found) return found; }
};
describe.runIf(process.env.REA_INTEGRATION === '1')('real REA in the Coden Builder loop', () => {
  it('lets the session model call REA and then reuse real evidence without executing the artifact', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'coden-rea-integration-'));
    await mkdir(path.join(dir, 'imported'));
    await writeFile(path.join(dir, 'imported', 'package.json'), '{"name":"shop-artifact","type":"module","main":"main.js"}');
    await writeFile(path.join(dir, 'imported', 'main.js'), "import { writeFileSync } from 'node:fs'; writeFileSync('EXECUTED', 'unsafe'); export function checkout(){ return fetch('/api/orders'); }");
    const service = createBuilderReaTools({ projectId: 'integration-project', userId: 'integration-owner', sandbox: { projectId: 'integration-project', dir }, deadline: Date.now() + 60_000 })!;
    const results: any[] = [];
    let step = 0;
    const gateway = { chat: vi.fn(async (_model: string, messages: any[], options: any) => {
      expect(options.runtimeConfig.tools.map((tool: any) => tool.function.name)).toContain('rea_analyze_javascript');
      const returned = messages.filter(message => message.role === 'tool').at(-1);
      if (returned) results.push(JSON.parse(returned.content));
      const name = step++ === 0 ? 'rea_analyze_javascript' : step === 2 ? 'rea_read_analysis' : '';
      const id = results.length ? parentId(results.at(-1)?.result) || results.at(-1)?.evidenceIds?.at(-1) : undefined;
      return name ? { text: '', tool_calls: [{ id: 'rea-' + step, function: { name, arguments: JSON.stringify(name === 'rea_analyze_javascript' ? { path: 'imported' } : { evidence_id: id, view: 'summary' }) } }], usage: {}, cost_usd: 0 } : { text: 'Analyse terminée.', tool_calls: [], usage: {}, cost_usd: 0 };
    }) };
    const harness = { startTool: vi.fn(async () => ({ id: 'trace' })), completeTool: vi.fn(async () => {}), failTool: vi.fn(async () => {}) };
    try {
      const turn = buildToolLoopTurn({ gateway: gateway as any, modelId: 'openai/gpt-5.6-luna', sandbox: { listFiles: async () => [] } as any, reaTools: service, harness: harness as any, harnessTurn: { turnId: 'turn', role: 'integrator' }, deadline: Date.now() + 60_000, activityLabel: 'Analyse' });
      await turn({ instruction: 'Analyse l’application importée.', tools: [] as any, call: async () => { throw new Error('Unexpected sandbox call'); }, maxToolCalls: 4 });
      expect(results).toHaveLength(2);
      expect(results.map(result => result.ok)).toEqual([true, true]);
      expect(results[0].evidenceIds.length).toBeGreaterThan(0);
      expect(harness.startTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'artifact.inspect' }));
      expect(harness.completeTool).toHaveBeenCalledWith('trace', expect.objectContaining({ ok: true, evidenceIds: expect.any(Array) }));
      await expect(readFile(path.join(dir, 'EXECUTED'))).rejects.toThrow();
      const id = parentId(results[0].result) || results[0].evidenceIds.at(-1);
      expect(await service.call('rea_trace_feature', { evidence_id: id, kind: 'module', value: 'main.js', direction: 'outgoing' })).toMatchObject({ ok: true });
      expect(await service.call('rea_inspect_artifact', { path: 'imported' })).toMatchObject({ ok: true });
    } finally { await service.dispose(); await rm(dir, { recursive: true, force: true }); }
  }, 90_000);
  it('enforces the worker filesystem boundary even if the adapter path guard is bypassed', async () => {
    const allowed = await mkdtemp(path.join(tmpdir(), 'coden-rea-allowed-'));
    const denied = await mkdtemp(path.join(tmpdir(), 'coden-rea-denied-'));
    await writeFile(path.join(denied, 'main.js'), 'export const secret = 1;');
    let client: Awaited<ReturnType<typeof connectRea>> | undefined;
    try {
      client = await connectRea(allowed);
      const result: any = await client.callTool({ name: 'analyze_javascript_application', arguments: { input_path: denied, detail: 'summary' } }, { timeout: 15_000 }).catch(error => ({ denied: error.message === 'REA_SCOPE_DENIED' }));
      expect(result.denied || /ERR_ACCESS_DENIED|FileSystemRead|Access to this API has been restricted/.test(JSON.stringify(result))).toBeTruthy();
    } finally { await client?.close(); await rm(allowed, { recursive: true, force: true }); await rm(denied, { recursive: true, force: true }); }
  }, 30_000);
});
