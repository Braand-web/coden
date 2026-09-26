import { describe, expect, it, vi } from 'vitest';
import { runLlmToolLoop } from './llm-tool-loop';
import { createSecretRedactor } from '../lib/project-secrets';

describe('secret values in tool results', () => {
  it('are replaced by their name before the model reads them', async () => {
    const gateway = {
      chat: vi.fn(async () => ({ content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{}' } }] })),
    };
    const result = await runLlmToolLoop({
      gateway: gateway as any,
      modelId: 'test',
      messages: [],
      maxSteps: 1,
      redact: createSecretRedactor({ STRIPE_SECRET_KEY: 'sk_test_51Hsupersecretvalue' }),
      handlers: { run_command: async () => ({ stdout: 'STRIPE_SECRET_KEY=sk_test_51Hsupersecretvalue\nPORT=5173' }) },
    });
    const toolMessage = String(result.messages.find(message => message.role === 'tool')?.content);
    expect(toolMessage).toContain('[secret:STRIPE_SECRET_KEY]');
    expect(toolMessage).not.toContain('supersecret');
    expect(toolMessage).toContain('PORT=5173');
  });
});
