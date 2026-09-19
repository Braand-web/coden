import { describe, expect, it, vi } from 'vitest';
import { runLlmToolLoop } from './llm-tool-loop';
import { DecisionRequiredError, isDecisionRequiredError } from './agent-decision';

/**
 * The loop hands an ordinary handler failure back to the model as a tool
 * result, which is right for something it can work around. A decision is not
 * that: fed back, the model reads "tool execution failed", tries something
 * else, and the run carries on past the point it just said it could not pass.
 */
const gatewayCalling = (toolName: string) => ({
  chat: vi.fn(async () => ({
    content: '',
    tool_calls: [{ id: 'c1', type: 'function', function: { name: toolName, arguments: '{}' } }],
  })),
});

describe('a decision leaving the tool loop', () => {
  it('escapes instead of becoming a tool result', async () => {
    const gateway = gatewayCalling('request_decision');
    await expect(runLlmToolLoop({
      gateway: gateway as any,
      modelId: 'test',
      messages: [],
      handlers: {
        request_decision: async () => { throw new DecisionRequiredError([{ q: 'Laquelle ?', type: 'radio', options: ['A', 'B'] }], 'bloqué'); },
      },
    })).rejects.toSatisfy(isDecisionRequiredError);
    // One call: the loop stopped rather than going round again.
    expect(gateway.chat).toHaveBeenCalledTimes(1);
  });

  it('still absorbs an ordinary tool failure, which the model can work around', async () => {
    const gateway = gatewayCalling('read_file');
    const result = await runLlmToolLoop({
      gateway: gateway as any,
      modelId: 'test',
      messages: [],
      maxSteps: 1,
      handlers: { read_file: async () => { throw new Error('disque plein'); } },
    });
    const toolMessage = result.messages.find(message => message.role === 'tool');
    expect(String(toolMessage?.content)).toContain('disque plein');
  });
});
