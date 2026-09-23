import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_ALLOWED_MODELS, MODEL_REGISTRY, type AllowedModelId } from './src/config/ai-models.ts';
import {
  buildAIModelRuntimeConfig,
  getAIModelCapabilityProfile,
  getAllAIModelCapabilityProfiles,
} from './src/services/ai-model-runtime.ts';
import { buildProviderRequestConfig } from './src/services/provider-adapters.ts';
import { ModelRouter } from './src/services/model-router.ts';

const profiles = getAllAIModelCapabilityProfiles();

assert.equal(profiles.length, MODEL_REGISTRY.length, 'Every allowed model should have a runtime profile.');
for (const modelId of AI_ALLOWED_MODELS) {
  const profile = getAIModelCapabilityProfile(modelId);
  assert.equal(profile.id, modelId);
  assert.ok(profile.displayName);
  assert.ok(profile.bestUse.length > 0);
  assert.ok(profile.recommended.maxTokens >= 3000);
  assert.ok(profile.recommended.timeoutMs >= 12_000);
  if (profile.fallbackPrimary) {
    assert.ok(
      AI_ALLOWED_MODELS.includes(profile.fallbackPrimary),
      'An Auto recovery candidate must be an allowed model.',
    );
    assert.notEqual(profile.fallbackPrimary, modelId, 'A recovery candidate cannot point back to itself.');
  }
}

{
  const luna = getAIModelCapabilityProfile('openai/gpt-5.6-luna-pro');
  assert.equal(
    luna.fallbackPrimary,
    'openai/gpt-5.6-luna',
    'The capability registry must expose Luna Pro’s interactive Auto recovery candidate.',
  );
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'openai/gpt-5.6-luna-pro',
    task: 'conversation',
    stream: true,
  });
  assert.equal(runtime.task, 'conversation');
  assert.equal(runtime.stream, true);
  assert.equal(runtime.responseFormat.type, 'text');
  assert.equal(runtime.tools.length, 0, 'Simple conversation must not force tool calling.');
  assert.equal((runtime as any).temperature, undefined, 'No layer forces a temperature: the provider default applies.');
  assert.equal(runtime.reasoningLevel, 'medium', 'Reasoning is on by default.');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'anthropic/claude-opus-5',
    task: 'backend_generation',
    stream: false,
    estimatedInputTokens: 160_000,
  });
  assert.equal(runtime.longContext.enabled, true);
  assert.ok(runtime.tools.length > 0, 'Agentic build tasks should enable tools when the model supports them.');
  assert.equal((runtime as any).maxTokens, undefined, 'No fixed output cap: the request uses the model ceiling.');
  assert.equal(runtime.profile.recommended.maxTokens, MODEL_REGISTRY.find(model => model.id === 'anthropic/claude-opus-5')!.maxOutputTokens, 'The profile reports the model ceiling, not a tier.');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'anthropic/claude-sonnet-5',
    task: 'intent',
  });
  assert.notEqual(runtime.responseFormat.type, 'text', 'Intent routing should request structured output when supported.');
  const providerConfig = buildProviderRequestConfig(runtime);
  assert.equal(providerConfig.adapter, 'anthropic');
  // Every model is reached through OpenRouter's OpenAI-compatible API.
  assert.equal((providerConfig.responseFormat as any)?.type, 'json_schema');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'google/gemini-3.8-flash:batch',
    task: 'backend_generation',
    allowTools: false,
  });
  assert.equal(runtime.responseFormat.type, 'json_object', 'Fullstack generation must request structured JSON output.');
  assert.deepEqual(runtime.tools, [], 'Monolithic file generation must not expose tool calls that its stream cannot consume.');
  assert.equal(runtime.toolChoice, 'none');
  assert.equal(runtime.reasoningLevel, 'medium', 'Reasoning is not switched off to save output room: max_tokens is the model ceiling.');
}

{
  const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(serverSource, /modelRouter\.selectJudgeModel\(/, 'Generation must not silently switch to a judge model.');
  assert.match(
    serverSource,
    /providerGateway\.streamingCompletion\(selectedModel,/,
    'Generation must privately aggregate the selected model stream into one atomic project artifact.',
  );
  assert.doesNotMatch(
    serverSource,
    /Math\.min\(runtimeOptions\?\.runtime\.timeoutMs \|\| 120_000, 75_000\)/,
    'Auto generation must not reintroduce the 75-second monolithic artifact timeout.',
  );
  assert.match(
    serverSource,
    /allowModelFallback: requestedModelSelection === 'auto'/,
    'Only an Auto generation run may use a bounded compatible-model recovery.',
  );
  assert.match(
    serverSource,
    /validateResult: input\.allowModelFallback/,
    'Auto recovery must reject an unusable generated project before showing it to the user.',
  );
  assert.match(
    serverSource,
    /providerGateway\.chat\(repairModel,/,
    'Malformed generation repair must use the effective model from the latest attempt.',
  );
  assert.doesNotMatch(
    serverSource,
    /input\.onEvent\?\.\(\{ type: 'token'/,
    'Raw generation JSON and source code must never be streamed as assistant prose.',
  );
  assert.doesNotMatch(
    serverSource,
    /providerGateway\.streamChat\(currentGenerationModel/,
    'Full project JSON must use an atomic structured provider response.',
  );
  assert.match(
    serverSource,
    /input\.existingFiles\.length > 0/,
    'Fresh projects must not spend their generation budget on edit-oriented subagents.',
  );
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'openai/gpt-5.6-luna-pro',
    task: 'intent',
  });
  assert.equal(runtime.responseFormat.type, 'json_schema');
  if (runtime.responseFormat.type !== 'json_schema') throw new Error('Intent routing must use a JSON schema.');
  const schema = runtime.responseFormat.schema as any;
  const required = new Set(schema.required || []);
  for (const field of [
    'intent', 'confidence', 'auto_plan_required', 'selected_model_policy',
    'reason', 'user_visible_reason', 'normalized_prompt', 'required_capabilities',
    'objective', 'clarification',
  ]) {
    assert.equal(required.has(field), true, `Intent JSON schema must require ${field}.`);
  }
  assert.ok(schema.properties.objective, 'Intent JSON schema must describe the validated objective contract.');
  assert.ok(schema.properties.clarification, 'Intent JSON schema must describe the clarification contract.');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'moonshotai/kimi-k3',
    task: 'intent',
  });
  const providerConfig = buildProviderRequestConfig(runtime);
  const extras = providerConfig;
  // Moonshot has no first-party integration here, so it is reached through
  // OpenRouter like any other model without one. The adapter is a transport
  // choice, not a capability claim: structured output still has to work.
  assert.equal(providerConfig.adapter, 'openrouter');
  assert.equal((extras.responseFormat as any)?.type, 'json_schema', 'Kimi K3 supports structured output.');
}

{
  const openAiRuntime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra-pro', task: 'security' });
  const anthropicRuntime = buildAIModelRuntimeConfig({ modelId: 'anthropic/claude-sonnet-5', task: 'security' });
  const openAiConfig = buildProviderRequestConfig(openAiRuntime);
  const anthropicConfig = buildProviderRequestConfig(anthropicRuntime);
  assert.notDeepEqual(openAiConfig, anthropicConfig, 'Provider adapters must not produce one generic request shape.');
}

{
  const router = new ModelRouter();
  const selected = await router.selectModel({
    plan: 'scale',
    mode: 'Custom',
    userCredits: 100,
    taskComplexity: 'extreme',
  }, 'anthropic/claude-opus-5');
  assert.equal(selected, 'anthropic/claude-opus-5', 'Manual model selection must be respected when allowed.');
}

{
  const router = new ModelRouter();
  const selected = await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 100,
    taskComplexity: 'extreme',
    requiredCapabilities: {
      reasoning: true,
      code: true,
      agentic: true,
      structuredOutput: true,
      longContext: true,
    },
  });
  const profile = getAIModelCapabilityProfile(selected as AllowedModelId);
  assert.notEqual(profile.reasoning, 'low');
  assert.notEqual(profile.code, 'low');
  assert.equal(profile.supports.longContext, true);
}

// Reasoning levels: the user's level reaches the runtime exactly
{
  for (const [effort, level] of [['None', 'none'], ['Low', 'low'], ['Medium', 'medium'], ['High', 'high'], ['Ultra', 'max']] as const) {
    const runtime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra-pro', task: 'security', effort });
    assert.equal(runtime.reasoningLevel, level, `${effort} maps to ${level}, with no task floor overriding it`);
    assert.equal(buildProviderRequestConfig(runtime).reasoningLevel, level);
  }
  const explicit = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra-pro', task: 'conversation', effort: 'Low', reasoningLevel: 'max' });
  assert.equal(explicit.reasoningLevel, 'max', 'An explicit level (Auto) wins over the effort control.');
}

// Expanded reasoning control detection
{
  const fableProfile = getAIModelCapabilityProfile('anthropic/claude-fable-5.1:batch');
  assert.equal(fableProfile.reasoning, 'frontier', 'Claude Fable 5 should be treated as a frontier reasoning model');
  assert.equal(fableProfile.code, 'frontier', 'Claude Fable 5 should be treated as a frontier coding model');
  assert.equal(fableProfile.supports.reasoningControl, true, 'Claude Fable 5 should support reasoning control');
  assert.equal(fableProfile.supports.longContext, true, 'Claude Fable 5 should expose its 1M context capability');
}

{
  const latestFableProfile = getAIModelCapabilityProfile('anthropic/claude-fable-5.1:batch');
  assert.equal(latestFableProfile.supports.toolCalling, true, 'Latest Fable alias should support tool calling');
  assert.equal(latestFableProfile.supports.structuredOutput, true, 'Latest Fable alias should support structured output');
}

{
  const solProfile = getAIModelCapabilityProfile('openai/gpt-5.6-sol-pro');
  assert.equal(solProfile.adapter, 'openai');
  assert.equal(solProfile.code, 'frontier');
  assert.equal(solProfile.supports.vision, true);
  assert.equal(solProfile.supports.toolCalling, true);
}

{
  const anthropicProfile = getAIModelCapabilityProfile('anthropic/claude-opus-5');
  assert.equal(anthropicProfile.supports.reasoningControl, true, 'Claude Opus should support reasoning control');
}

{
  const anthropicSonnetProfile = getAIModelCapabilityProfile('anthropic/claude-sonnet-5');
  assert.equal(anthropicSonnetProfile.supports.reasoningControl, true, 'Claude Sonnet 5 should support reasoning control');
}

// No sampling or size limits leave the runtime layer
{
  const runtime = buildAIModelRuntimeConfig({ modelId: 'anthropic/claude-opus-5', task: 'security', stream: true });
  const providerConfig = buildProviderRequestConfig(runtime) as Record<string, unknown>;
  for (const key of ['temperature', 'top_p', 'maxTokens', 'thinking_budget', 'reasoningEffort']) {
    assert.equal(providerConfig[key], undefined, `${key} is not decided outside buildOpenRouterRequest`);
  }
}
console.log('ai-model-runtime tests passed');

