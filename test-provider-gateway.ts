import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ProviderGateway, ProviderGatewayError } from './src/services/provider-gateway.ts';
import { resolveOpenRouterApiKey, type ChatMessage } from './src/services/openrouter-service.ts';
import { resolveAnthropicApiKey, resolveDirectAnthropicModelId } from './src/services/anthropic-service.ts';

const messages: ChatMessage[] = [{ role: 'user', content: 'hello' }];

{
  const providerFiles = [
    'server.ts',
    'src/services/openrouter-service.ts',
    'src/services/anthropic-service.ts',
    'src/services/web-research-gateway.ts',
  ];
  for (const file of providerFiles) {
    assert.doesNotMatch(
      fs.readFileSync(new URL(file, import.meta.url), 'utf8'),
      /from ['\"]node-fetch['\"]/,
      `${file} must use the Node 22 native fetch implementation.`,
    );
  }
  const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.match(packageJson.engines.node, /^>=22/, 'Production must run Node 22+ for native fetch and current Supabase clients.');
  assert.equal(packageJson.dependencies['node-fetch'], undefined);
  assert.equal(packageJson.dependencies['@types/node-fetch'], undefined);
}

class FakeOpenRouter {
  calls: string[] = [];
  runtimeConfigs: any[] = [];
  failures: Error[] = [];

  async chat(modelId: string, _messages?: ChatMessage[], _attempts?: number, _timeout?: number, runtimeConfig?: any) {
    this.calls.push(modelId);
    this.runtimeConfigs.push(runtimeConfig);
    const failure = this.failures.shift();
    if (failure) throw failure;
    return {
      text: 'ok',
      model: modelId,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0.001,
    };
  }

  async *streamChat(modelId: string): AsyncGenerator<any> {
    this.calls.push(modelId);
    const failure = this.failures.shift();
    if (failure) throw failure;
    yield { type: 'token' as const, text: 'ok', model: modelId };
  }
}

class FakeAnthropic {
  calls: string[] = [];

  isConfigured() {
    return true;
  }

  supportsModel(modelId: string) {
    return modelId.startsWith('anthropic/') || modelId.startsWith('~anthropic/');
  }

  async chat(modelId: string) {
    this.calls.push(modelId);
    return {
      text: 'direct-anthropic-ok',
      model: modelId,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0.001,
    };
  }

  async *streamChat(modelId: string) {
    this.calls.push(modelId);
    yield { type: 'token' as const, text: 'direct-anthropic-ok', model: modelId };
  }
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('OpenRouter HTTP 404: model not available'));
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(() => gateway.chat('anthropic/claude-sonnet-5', messages, {
    maxAttempts: 1,
    allowFallback: false,
    runtimeConfig: { adapter: 'gemini', metadata: { model_id: 'primary' } },
    runtimeConfigForModel: modelId => ({ adapter: modelId.startsWith('anthropic/') ? 'anthropic' : 'gemini', metadata: { model_id: modelId } }),
  }));
  assert.equal(fake.calls.length, 1, 'An explicit pinned model must not switch to another model.');
}

{
  const fake = new FakeOpenRouter();
  fake.streamChat = async function* (modelId: string) {
    this.calls.push(modelId);
    yield { type: 'token' as const, text: '{"files":', model: modelId };
    yield { type: 'token' as const, text: '[]}', model: modelId };
    yield {
      type: 'usage' as const,
      usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
      cost_usd: 0.002,
      model: modelId,
    };
  };
  const gateway = new ProviderGateway(fake as any);
  const result = await gateway.streamingCompletion('openai/gpt-5.6-luna', messages, {
    allowFallback: false,
    validateResult: candidate => assert.equal(candidate.text, '{"files":[]}'),
  });
  assert.equal(result.text, '{"files":[]}');
  assert.equal(result.usage.total_tokens, 4);
  assert.equal(result.cost_usd, 0.002);
}

{
  const fake = new FakeOpenRouter();
  fake.streamChat = async function* (modelId: string) {
    this.calls.push(modelId);
    yield {
      type: 'token' as const,
      text: this.calls.length === 1 ? 'malformed' : '{"files":[]}',
      model: modelId,
    };
  };
  const transitions: Array<{ from: string; to: string; reason: string }> = [];
  const gateway = new ProviderGateway(fake as any);
  const result = await gateway.streamingCompletion('openai/gpt-5.6-luna', messages, {
    allowFallback: true,
    validateResult: candidate => {
      if (candidate.text === 'malformed') {
        const error: any = new Error('Generated project JSON is invalid.');
        error.diagnosticCode = 'MODEL_OUTPUT_PARSE_FAILED';
        throw error;
      }
    },
    onFallback: transition => transitions.push(transition),
  });
  assert.equal(result.text, '{"files":[]}');
  assert.deepEqual(fake.calls, ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash']);
  assert.equal(transitions[0]?.reason, 'MODEL_OUTPUT_PARSE_FAILED');
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('AbortError: provider timeout'));
  const gateway = new ProviderGateway(fake as any);
  const transitions: Array<{ from: string; to: string; reason: string }> = [];
  const result = await gateway.chat('openai/gpt-5.6-luna', messages, {
    maxAttempts: 1,
    allowFallback: true,
    onFallback: transition => transitions.push(transition),
  });
  assert.equal(result.text, 'ok');
  assert.deepEqual(fake.calls, ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash']);
  assert.deepEqual(transitions, [{
    from: 'openai/gpt-5.6-luna',
    to: 'google/gemini-3.7-flash',
    reason: 'PROVIDER_TIMEOUT',
  }]);
}

{
  const fake = new FakeOpenRouter();
  fake.chat = async (modelId: string) => {
    fake.calls.push(modelId);
    return {
      text: fake.calls.length === 1 ? 'malformed-project-artifact' : 'valid-project-artifact',
      model: modelId,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      cost_usd: 0.001,
    };
  };
  const gateway = new ProviderGateway(fake as any);
  const result = await gateway.chat('openai/gpt-5.6-luna', messages, {
    maxAttempts: 1,
    allowFallback: true,
    validateResult: candidate => {
      if (candidate.text !== 'malformed-project-artifact') return;
      const error: any = new Error('Generated project JSON is invalid.');
      error.diagnosticCode = 'MODEL_OUTPUT_PARSE_FAILED';
      throw error;
    },
  });
  assert.equal(result.text, 'valid-project-artifact');
  assert.deepEqual(
    fake.calls,
    ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash'],
    'Auto recovery must retry a malformed artifact with the configured compatible model.',
  );
}

{
  assert.equal(resolveOpenRouterApiKey({ OPEN_ROUTER_API_KEY: '  sk-or-alias\n' }), 'sk-or-alias');
  assert.equal(resolveOpenRouterApiKey({ OPENROUTER_API_KEY: '***redacted***', OPENROUTER_TOKEN: ' sk-or-token ' }), 'sk-or-token');
  assert.equal(resolveOpenRouterApiKey({ OPENROUTER_API_KEY: '***redacted***' }), '');
}

{
  assert.equal(resolveAnthropicApiKey({ ANTHROPIC_API_KEY: '  sk-ant-direct\n' }), 'sk-ant-direct');
  assert.equal(resolveDirectAnthropicModelId('anthropic/claude-sonnet-5'), 'claude-sonnet-5');
  assert.equal(resolveDirectAnthropicModelId('anthropic/claude-opus-5'), 'claude-opus-5');
  assert.equal(resolveDirectAnthropicModelId('openai/gpt-5.6-luna'), null);
}

{
  const fakeOpenRouter = new FakeOpenRouter();
  const fakeAnthropic = new FakeAnthropic();
  const gateway = new ProviderGateway(fakeOpenRouter as any, { anthropic: fakeAnthropic as any });
  const result = await gateway.chat('anthropic/claude-sonnet-5', messages);
  assert.equal(result.text, 'ok');
  assert.deepEqual(fakeAnthropic.calls, []);
  assert.deepEqual(fakeOpenRouter.calls, ['anthropic/claude-sonnet-5'], 'All text models must use OpenRouter.');
}

{
  const fakeOpenRouter = new FakeOpenRouter();
  fakeOpenRouter.failures.push(...Array.from({ length: 10 }, () => new Error('OpenRouter HTTP 402: insufficient credits')));
  const fakeAnthropic = new FakeAnthropic();
  const gateway = new ProviderGateway(fakeOpenRouter as any, { anthropic: fakeAnthropic as any });
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 1 }));
  assert.deepEqual(fakeAnthropic.calls, [], 'Quota errors must not trigger a hidden provider or model fallback.');
}

{
  const fake = new FakeOpenRouter();
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(() => gateway.chat('auto', messages), (error: any) => {
    assert.ok(error instanceof ProviderGatewayError);
    assert.equal(error.diagnosticCode, 'AUTO_MODEL_NOT_RESOLVED');
    return true;
  });
  assert.equal(fake.calls.length, 0);
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('OpenRouter HTTP 500: upstream unavailable'));
  const gateway = new ProviderGateway(fake as any);
  const result = await gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 2 });
  assert.equal(result.text, 'ok');
  assert.equal(fake.calls.length, 2);
  const metrics = gateway.getRuntimeMetricsSnapshot();
  assert.ok(metrics.some(item => item.model_id === 'openai/gpt-5.6-luna' && item.requests >= 2 && item.successes === 1 && item.retries >= 1));
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('OpenRouter HTTP 401: invalid api key'));
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna', messages), (error: any) => {
    assert.equal(error.diagnosticCode, 'OPENROUTER_KEY_INVALID');
    assert.equal(error.retryable, false);
    return true;
  });
  assert.equal(fake.calls.length, 1);
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('OpenRouter HTTP 404: model not available'));
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(() => gateway.chat('anthropic/claude-sonnet-5', messages, { maxAttempts: 1 }));
  assert.equal(fake.calls[0], 'anthropic/claude-sonnet-5');
  assert.equal(fake.calls.length, 1);
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(...Array.from({ length: 20 }, () => new Error('AbortError: aborted')));
  const gateway = new ProviderGateway(fake as any, { failureThreshold: 50 });
  await assert.rejects(() => gateway.chat('anthropic/claude-sonnet-5', messages, { maxAttempts: 1 }), (error: any) => {
    assert.ok(error instanceof ProviderGatewayError);
    assert.equal(error.diagnosticCode, 'PROVIDER_TIMEOUT');
    assert.equal(error.retryable, true);
    assert.match(error.message, /did not answer in time/i);
    return true;
  });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls.includes('auto'), false);
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(...Array.from({ length: 12 }, () => new Error('OpenRouter HTTP 500: upstream unavailable')));
  const gateway = new ProviderGateway(fake as any, { failureThreshold: 2, breakerMs: 60_000 });
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 1 }));
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 1 }));
  const snapshot = gateway.getCircuitSnapshot();
  assert.ok(snapshot.some(item => item.model_id === 'openai/gpt-5.6-luna' && item.blocked));
}

console.log('test-provider-gateway passed');
