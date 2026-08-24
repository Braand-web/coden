import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_ALLOWED_MODELS, MODEL_REGISTRY, type AllowedModelId } from './src/config/ai-models.ts';
import {
  buildAIModelRuntimeConfig,
  getAIModelCapabilityProfile,
  getAllAIModelCapabilityProfiles,
} from './src/services/ai-model-runtime.ts';
import { buildProviderRequestConfig, toOpenRouterChatPayloadExtras } from './src/services/provider-adapters.ts';
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
  assert.equal(profile.fallbackPrimary, null, 'A run must not switch model silently.');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'openai/gpt-5.6-luna',
    task: 'conversation',
    stream: true,
  });
  assert.equal(runtime.task, 'conversation');
  assert.equal(runtime.stream, true);
  assert.equal(runtime.responseFormat.type, 'text');
  assert.equal(runtime.tools.length, 0, 'Simple conversation must not force tool calling.');
  assert.ok(runtime.temperature > 0.3, 'Conversation should stay warmer than code generation.');
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
  assert.ok(runtime.maxTokens >= 9000, 'Code generation should reserve enough output tokens.');
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'anthropic/claude-sonnet-5',
    task: 'intent',
  });
  assert.notEqual(runtime.responseFormat.type, 'text', 'Intent routing should request structured output when supported.');
  const providerConfig = buildProviderRequestConfig(runtime);
  assert.equal(providerConfig.adapter, 'anthropic');
  assert.deepEqual(providerConfig.responseFormat, { type: 'json_instruction' });
}

{
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'google/gemini-3.7-flash',
    task: 'backend_generation',
    allowTools: false,
  });
  assert.equal(runtime.responseFormat.type, 'json_object', 'Fullstack generation must request structured JSON output.');
  assert.deepEqual(runtime.tools, [], 'Monolithic file generation must not expose tool calls that its stream cannot consume.');
  assert.equal(runtime.toolChoice, 'none');
  assert.equal(runtime.thinking.budgetTokens, 1024, 'Fast fullstack generation must reserve output budget for project files.');
}

{
  const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(serverSource, /modelRouter\.selectJudgeModel\(/, 'Generation must not silently switch to a judge model.');
  assert.match(serverSource, /providerGateway\.chat\(selectedModel,/, 'Generation must use the model selected for this run exactly once.');
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
    modelId: 'openai/gpt-5.6-luna',
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
    modelId: 'deepseek/deepseek-v4-pro',
    task: 'intent',
  });
  const providerConfig = buildProviderRequestConfig(runtime);
  const extras = toOpenRouterChatPayloadExtras(providerConfig);
  assert.equal(providerConfig.adapter, 'deepseek');
  assert.equal((extras.response_format as any)?.type, 'json_schema', 'DeepSeek V4 Pro supports structured output in the verified OpenRouter catalog.');
}

{
  const openAiRuntime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra', task: 'security' });
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

// Thinking/reasoning budget tests
{
  const runtime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra', task: 'security' });
  assert.ok(runtime.thinking, 'Runtime config should include thinking section');
  assert.ok(runtime.thinking.budgetTokens > 0, 'Security task with reasoning model should get a thinking budget');
  assert.equal(runtime.thinking.includeInResponse, false, 'Thinking should not be included in user-facing response');
  assert.equal(runtime.thinking.enabled, true, 'Thinking should be enabled for security task with reasoning model');
}

{
  const runtime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-luna', task: 'conversation' });
  assert.ok('thinking' in runtime, 'All runtime configs should include thinking section');
}

// Expanded reasoning control detection
{
  const fableProfile = getAIModelCapabilityProfile('anthropic/claude-fable-5');
  assert.equal(fableProfile.reasoning, 'frontier', 'Claude Fable 5 should be treated as a frontier reasoning model');
  assert.equal(fableProfile.code, 'frontier', 'Claude Fable 5 should be treated as a frontier coding model');
  assert.equal(fableProfile.supports.reasoningControl, true, 'Claude Fable 5 should support reasoning control');
  assert.equal(fableProfile.supports.longContext, true, 'Claude Fable 5 should expose its 1M context capability');
}

{
  const latestFableProfile = getAIModelCapabilityProfile('anthropic/claude-fable-5');
  assert.equal(latestFableProfile.supports.toolCalling, true, 'Latest Fable alias should support tool calling');
  assert.equal(latestFableProfile.supports.structuredOutput, true, 'Latest Fable alias should support structured output');
}

{
  const solProfile = getAIModelCapabilityProfile('openai/gpt-5.6-sol');
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

// Temperature safety via provider adapters
{
  const runtime = buildAIModelRuntimeConfig({ modelId: 'anthropic/claude-opus-5', task: 'security', stream: true });
  const providerConfig = buildProviderRequestConfig(runtime);
  if (runtime.thinking.enabled) {
    assert.equal(providerConfig.temperature, 1.0, 'Thinking-enabled models should use temperature 1.0 for safety');
    assert.ok(providerConfig.thinking_budget! > 0, 'Provider config should forward thinking budget');
  }
}

// Thinking budget for OpenRouter extras
{
  const runtime = buildAIModelRuntimeConfig({ modelId: 'openai/gpt-5.6-terra', task: 'backend_generation' });
  const providerConfig = buildProviderRequestConfig(runtime);
  const extras = toOpenRouterChatPayloadExtras(providerConfig);
  if (providerConfig.thinking_budget) {
    assert.ok(extras.thinking, 'OpenRouter extras should forward thinking params');
  }
}
console.log('ai-model-runtime tests passed');

