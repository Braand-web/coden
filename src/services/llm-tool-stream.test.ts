import { expect, it, vi } from 'vitest';
import { runLlmToolLoop } from './llm-tool-loop';

it('streams actual provider prose, keeps file bodies private and executes the real handler before completion', async () => {
  const order: string[] = [];
  let n = 0;
  const gateway = { streamingCompletion: vi.fn(async (_model, _messages, options) => {
    n++;
    options.onChunk('Je prépare.\n``');
    options.onChunk('Je prépare.\n```tsx\nFILE BODY\n```\n');
    return { text: 'Je prépare.', tool_calls: n === 1 ? [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"src/App.tsx"}' } }] : [], usage: {}, cost_usd: 0 };
  }) };
  const result = await runLlmToolLoop({ gateway: gateway as any, modelId: 'test', messages: [], handlers: { read_file: async () => { order.push('actual read'); return { ok: true }; } }, onTextDelta: delta => order.push(delta), onTextEnd: () => order.push('text end'), onToolsCompleted: () => order.push('tools completed') });
  expect(order.join('')).not.toContain('FILE BODY');
  expect(order.indexOf('text end')).toBeLessThan(order.indexOf('actual read'));
  expect(order.indexOf('actual read')).toBeLessThan(order.indexOf('tools completed'));
  expect(result.toolExecutions[0].ok).toBe(true);
  expect(gateway.streamingCompletion).toHaveBeenCalledTimes(2);
});

it('does not invoke providers after cancellation', async () => {
  const controller = new AbortController(); controller.abort(); const chat = vi.fn();
  await expect(runLlmToolLoop({ gateway: { chat } as any, modelId: 'test', messages: [], handlers: {}, signal: controller.signal })).rejects.toThrow();
  expect(chat).not.toHaveBeenCalled();
});

/*
 * A spent tool budget ends the loop; it does not fail the run.
 *
 * This threw `TOOL_BUDGET_EXCEEDED`, and since the coder loop passes its own
 * per-round budget here, a real build spent it in round one: the throw left
 * the turn, the round and the pipeline, and the route answered the user with
 * that bare string instead of an application.
 */
it('stops at the tool ceiling and returns the work, instead of failing the run', async () => {
  let calls = 0;
  const chat = vi.fn(async () => ({
    text: '',
    tool_calls: [{ id: `c${++calls}`, function: { name: 'write_file', arguments: '{"path":"src/App.tsx"}' } }],
    usage: {},
    cost_usd: 0,
  }));

  const result = await runLlmToolLoop({
    gateway: { chat } as any,
    modelId: 'test',
    messages: [],
    handlers: { write_file: async () => ({ ok: true }) },
    maxToolCalls: 2,
    maxSteps: 6,
  });

  expect(result.toolExecutions).toHaveLength(2);
  expect(result.toolExecutions.every(execution => execution.ok)).toBe(true);
  // The tool results the round did produce must survive for the caller.
  expect(result.messages.some(message => message.role === 'tool')).toBe(true);
});
