import { describe, expect, it, vi } from 'vitest';
import { runLlmToolLoop, raceAbort } from './llm-tool-loop';
import { DecisionRequiredError } from './agent-decision';

/**
 * The loop under failure: a cancel while a call hangs, a call that throws, a
 * decision that must stop the run, and reads started together. What matters is
 * that nothing hangs, nothing is swallowed, and nothing is reported twice.
 */
const oneCall = (name: string, args: unknown = {}, id = 'c1') => ({ text: '', tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }], usage: {}, cost_usd: 0 });
const done = { text: 'fini', tool_calls: [], usage: {}, cost_usd: 0 };
const scripted = (...steps: any[]) => ({ chat: vi.fn(async () => steps.shift() ?? done) });
const hangs = () => new Promise<never>(() => undefined);

describe('cancelling while a tool call hangs', () => {
  it('ends the run at once instead of waiting for a call that never answers', async () => {
    const controller = new AbortController();
    const gateway = scripted(oneCall('fetch_url', { url: 'https://slow.example' }));
    const running = runLlmToolLoop({ gateway: gateway as any, modelId: 'm', messages: [], handlers: { fetch_url: hangs }, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const started = Date.now();
    await expect(running).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(400);
  });

  it('does the same for reads started together, and reports no unhandled rejection from the abandoned ones', async () => {
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', listener);
    const controller = new AbortController();
    const gateway = { chat: vi.fn(async () => ({ text: '', tool_calls: [1, 2, 3].map(n => ({ id: `r${n}`, function: { name: 'read_file', arguments: JSON.stringify({ path: `src/${n}.ts` }) } })), usage: {}, cost_usd: 0 })) };
    const running = runLlmToolLoop({
      gateway: gateway as any, modelId: 'm', messages: [],
      handlers: { read_file: (args: any) => (String(args.path).includes('2') ? new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 120)) : hangs()) },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 20);
    await expect(running).rejects.toBeTruthy();
    await new Promise(resolve => setTimeout(resolve, 250));
    process.off('unhandledRejection', listener);
    expect(unhandled).toEqual([]);
  });

  it('raceAbort passes a result through untouched when nothing is cancelled', async () => {
    expect(await raceAbort(Promise.resolve(7), new AbortController().signal)).toBe(7);
    expect(await raceAbort(Promise.resolve(8))).toBe(8);
    const controller = new AbortController();
    controller.abort();
    await expect(raceAbort(Promise.resolve(9), controller.signal)).rejects.toBeTruthy();
  });
});

describe('failures inside a tool', () => {
  it('a throwing tool becomes a result the model can act on, and the run goes on', async () => {
    const gateway = scripted(oneCall('read_file', { path: 'a.ts' }), done);
    const result = await runLlmToolLoop({ gateway: gateway as any, modelId: 'm', messages: [], handlers: { read_file: async () => { throw new Error('disk on fire'); } } });
    expect(result.toolExecutions[0].ok).toBe(false);
    expect(result.messages.some(message => message.role === 'tool' && /disk on fire/.test(String(message.content)))).toBe(true);
    expect(result.result.text).toBe('fini');
  });

  it('a decision request is never swallowed into "the tool failed": it stops the run', async () => {
    const gateway = scripted(oneCall('run_integration_tool', { tool: 'GMAIL_SEND_EMAIL' }));
    const decision = new DecisionRequiredError([{ q: 'Je vais envoyer un vrai e-mail. Confirmer ?', type: 'radio', options: ['Oui, envoie cet e-mail', 'Non, n’envoie rien'] }], 'not asked');
    await expect(runLlmToolLoop({ gateway: gateway as any, modelId: 'm', messages: [], handlers: { run_integration_tool: async () => { throw decision; } } })).rejects.toBe(decision);
  });

  it('the same holds when the decision comes from a read started early with the others', async () => {
    const gateway = { chat: vi.fn(async () => ({ text: '', tool_calls: [
      { id: 'a', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
      { id: 'b', function: { name: 'read_file', arguments: '{"path":"b.ts"}' } },
    ], usage: {}, cost_usd: 0 })) };
    const decision = new DecisionRequiredError([{ q: 'Continuer ?', type: 'radio', options: ['Oui', 'Non'] }], 'x');
    await expect(runLlmToolLoop({ gateway: gateway as any, modelId: 'm', messages: [], handlers: { read_file: async (args: any) => { if (String(args.path).startsWith('b')) throw decision; return { ok: true }; } } })).rejects.toBe(decision);
  });
});

describe('reads together', () => {
  it('six reads take about as long as the slowest, not their sum, and come back in order', async () => {
    const gateway = { chat: vi.fn()
      .mockResolvedValueOnce({ text: '', tool_calls: Array.from({ length: 6 }, (_, n) => ({ id: `r${n}`, function: { name: 'read_file', arguments: JSON.stringify({ path: `f${n}.ts` }) } })), usage: {}, cost_usd: 0 })
      .mockResolvedValue(done) };
    const started = Date.now();
    const result = await runLlmToolLoop({ gateway: gateway as any, modelId: 'm', messages: [], handlers: { read_file: async (args: any) => { await new Promise(resolve => setTimeout(resolve, 60)); return { ok: true, path: args.path }; } } });
    expect(Date.now() - started).toBeLessThan(240);
    expect(result.messages.filter(message => message.role === 'tool').map(message => JSON.parse(String(message.content)).path)).toEqual(['f0.ts', 'f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts']);
  });
});
