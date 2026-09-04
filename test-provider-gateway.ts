import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ProviderGateway, ProviderGatewayError } from './src/services/provider-gateway.ts';
import { resolveOpenRouterApiKey, type ChatMessage } from './src/services/openrouter-service.ts';
import { resolveAnthropicApiKey, resolveDirectAnthropicModelId } from './src/services/anthropic-service.ts';
import { ProviderHttpError } from './src/services/provider-errors.ts';

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
  const result = await gateway.streamingCompletion('openai/gpt-5.6-luna-pro', messages, {
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
  const result = await gateway.streamingCompletion('openai/gpt-5.6-luna-pro', messages, {
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
  assert.deepEqual(fake.calls, ['openai/gpt-5.6-luna-pro', 'google/gemini-3.8-flash:batch']);
  assert.equal(transitions[0]?.reason, 'MODEL_OUTPUT_PARSE_FAILED');
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('AbortError: provider timeout'));
  const gateway = new ProviderGateway(fake as any);
  const transitions: Array<{ from: string; to: string; reason: string }> = [];
  const result = await gateway.chat('openai/gpt-5.6-luna-pro', messages, {
    maxAttempts: 1,
    allowFallback: true,
    onFallback: transition => transitions.push(transition),
  });
  assert.equal(result.text, 'ok');
  assert.deepEqual(fake.calls, ['openai/gpt-5.6-luna-pro', 'google/gemini-3.8-flash:batch']);
  assert.deepEqual(transitions, [{
    from: 'openai/gpt-5.6-luna-pro',
    to: 'google/gemini-3.8-flash:batch',
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
  const result = await gateway.chat('openai/gpt-5.6-luna-pro', messages, {
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
    ['openai/gpt-5.6-luna-pro', 'google/gemini-3.8-flash:batch'],
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
  assert.equal(resolveDirectAnthropicModelId('openai/gpt-5.6-luna-pro'), null);
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
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna-pro', messages, { maxAttempts: 1 }));
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
  const result = await gateway.chat('openai/gpt-5.6-luna-pro', messages, { maxAttempts: 2 });
  assert.equal(result.text, 'ok');
  assert.equal(fake.calls.length, 2);
  const metrics = gateway.getRuntimeMetricsSnapshot();
  assert.ok(metrics.some(item => item.model_id === 'openai/gpt-5.6-luna-pro' && item.requests >= 2 && item.successes === 1 && item.retries >= 1));
}

{
  const fake = new FakeOpenRouter();
  fake.failures.push(new Error('OpenRouter HTTP 401: invalid api key'));
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna-pro', messages), (error: any) => {
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
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna-pro', messages, { maxAttempts: 1 }));
  await assert.rejects(() => gateway.chat('openai/gpt-5.6-luna-pro', messages, { maxAttempts: 1 }));
  const snapshot = gateway.getCircuitSnapshot();
  assert.ok(snapshot.some(item => item.model_id === 'openai/gpt-5.6-luna-pro' && item.blocked));
}

console.log('test-provider-gateway passed');

/*
 * The model's own deadline must reach the provider.
 *
 * `buildAIModelRuntimeConfig` derives a timeout from the model's speed — 45s
 * for a fast one, up to 240s for a streaming frontier model — and that number
 * used to die in `buildProviderRequestConfig`, which carried no field for it.
 * Every caller then supplied a constant instead: 45s in the planner, 60s in
 * the coder loop, whatever model the router had picked.
 *
 * Production paid for it. Thirteen of the twenty-two recorded run failures
 * were PROVIDER_TIMEOUT, every one of them on a deliberate or balanced model
 * and none on the fast one, while successful runs on that same deliberate
 * model averaged 301s and reached 546s. The user waited five and a half
 * minutes — one attempt and its fallbacks, each hitting the same wall — to be
 * told the provider had not answered.
 */
{
  class TimeoutRecorder extends FakeOpenRouter {
    timeouts: (number | undefined)[] = [];
    async chat(modelId: string, _messages?: ChatMessage[], _attempts?: number, timeout?: number, runtimeConfig?: any) {
      this.timeouts.push(timeout);
      return super.chat(modelId, _messages, _attempts, timeout, runtimeConfig);
    }
    async *streamChat(modelId: string, _messages?: ChatMessage[], timeout?: number): AsyncGenerator<any> {
      this.timeouts.push(timeout);
      yield { type: 'token' as const, text: 'ok', model: modelId };
    }
  }

  const fake = new TimeoutRecorder();
  const gateway = new ProviderGateway(fake as any);
  const runtimeConfig = { adapter: 'openrouter' as const, timeoutMs: 180_000 };

  await gateway.chat('openai/gpt-5.6-luna', messages, { allowFallback: false, runtimeConfig });
  assert.equal(fake.timeouts.at(-1), 180_000, "chat must wait as long as the model's own profile says, not 45s.");

  await gateway.streamingCompletion('openai/gpt-5.6-luna', messages, { allowFallback: false, runtimeConfig });
  assert.equal(fake.timeouts.at(-1), 180_000, "a streamed completion must use the model's own deadline, not 90s.");

  for await (const _event of gateway.streamChat('openai/gpt-5.6-luna', messages, { allowFallback: false, runtimeConfig })) { /* drain */ }
  assert.equal(fake.timeouts.at(-1), 180_000, "streamChat must use the model's own deadline too.");

  // A caller that named a deadline still owns it.
  await gateway.chat('openai/gpt-5.6-luna', messages, { allowFallback: false, runtimeConfig, timeoutMs: 5_000 });
  assert.equal(fake.timeouts.at(-1), 5_000, 'an explicit caller deadline must win over the profile.');

  // And a call made without any runtime config keeps the old constant.
  await gateway.chat('openai/gpt-5.6-luna', messages, { allowFallback: false });
  assert.equal(fake.timeouts.at(-1), 45_000, 'with no runtime config the documented default must still apply.');
}

/*
 * A fallback model answers on its own clock.
 *
 * Recovery routes to a different model, so reusing the primary's deadline
 * would give a slow recovery model the fast model's allowance — the same
 * mistake one level down, and precisely the case where it hurts most.
 */
{
  class TimeoutRecorder extends FakeOpenRouter {
    timeouts: (number | undefined)[] = [];
    async chat(modelId: string, _messages?: ChatMessage[], _attempts?: number, timeout?: number, runtimeConfig?: any) {
      this.timeouts.push(timeout);
      return super.chat(modelId, _messages, _attempts, timeout, runtimeConfig);
    }
  }
  const fake = new TimeoutRecorder();
  fake.failures.push(new ProviderHttpError('OpenRouter', 503, 'temporarily unavailable'));
  const gateway = new ProviderGateway(fake as any);
  await gateway.chat('openai/gpt-5.6-luna', messages, {
    maxAttempts: 1,
    allowFallback: true,
    runtimeConfigForModel: modelId => ({
      adapter: 'openrouter' as const,
      timeoutMs: modelId === 'openai/gpt-5.6-luna' ? 45_000 : 180_000,
    }),
  });
  assert.deepEqual(fake.timeouts, [45_000, 180_000], 'each candidate must be given its own model timeout.');
}

/*
 * And no caller may quietly reintroduce a constant on the two paths that
 * carry a whole build: the planner and the coder loop.
 */
{
  for (const file of ['src/services/planner-agent.ts', 'src/services/multi-agent-pipeline.ts']) {
    assert.doesNotMatch(
      fs.readFileSync(new URL(file, import.meta.url), 'utf8'),
      /timeoutMs:\s*\d/,
      `${file} must let the model's runtime profile set the deadline.`,
    );
  }
}

/*
 * A model that cannot do the work hands over to one that can.
 *
 * `retryable` answers "try this model again", and the loop used it to answer a
 * second question it does not fit: "try another model". So a capability the
 * model does not advertise threw immediately and the configured fallback was
 * never reached. Production failed a request that way at 16:37, in seven
 * seconds, having written nothing.
 */
{
  class CapabilityFailure extends Error {
    diagnosticCode = 'MODEL_CAPABILITY_UNAVAILABLE';
  }
  const fake = new FakeOpenRouter();
  fake.failures.push(new CapabilityFailure('primary does not advertise tools'));
  const gateway = new ProviderGateway(fake as any);
  const result = await gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 2, allowFallback: true });
  assert.equal(result.text, 'ok', 'the fallback must answer');
  assert.equal(fake.calls.length, 2, 'the incapable model is tried once, then handed over — not retried');
  assert.notEqual(fake.calls[1], fake.calls[0], 'and handed to a different model');
}

// Pinned to one model, the same failure is still the answer the user needs.
{
  class CapabilityFailure extends Error {
    diagnosticCode = 'MODEL_MODALITY_UNAVAILABLE';
  }
  const fake = new FakeOpenRouter();
  fake.failures.push(new CapabilityFailure('cannot accept image input'));
  const gateway = new ProviderGateway(fake as any);
  await assert.rejects(
    () => gateway.chat('openai/gpt-5.6-luna', messages, { maxAttempts: 2, allowFallback: false }),
    (error: any) => error.diagnosticCode === 'MODEL_MODALITY_UNAVAILABLE',
  );
  assert.equal(fake.calls.length, 1, 'and it is not retried against itself');
}

/*
 * Reasoning is a quality setting, not a contract. Refusing a whole run because
 * a model will not take it sacrifices the answer for a nicety; tools and
 * response_format stay fatal, because a coder with no tools cannot write a
 * file and a caller parsing JSON cannot use prose.
 */
{
  const { enforceModelCapabilities } = await import('./src/services/openrouter-capabilities.ts');
  const model = { id: 'm', context_length: 100_000, supported_parameters: ['tools'], top_provider: {} } as any;
  const payload = enforceModelCapabilities(model, { tools: [{}], reasoning: { effort: 'high' }, max_tokens: 100 });
  assert.equal(payload.reasoning, undefined, 'unadvertised reasoning is dropped, not fatal');
  assert.deepEqual(payload.tools, [{}], 'and what the request needs survives');
  assert.throws(() => enforceModelCapabilities({ ...model, supported_parameters: [] }, { tools: [{}] }), /tools/);
}
