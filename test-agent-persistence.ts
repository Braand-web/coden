import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAIModelRuntimeConfig } from './src/services/ai-model-runtime.ts';
import { buildProviderRequestConfig } from './src/services/provider-adapters.ts';

/*
 * Two things that capped how well the agent could think, neither of them
 * about the model it runs on.
 */

/*
 * 1. Code generation ran at maximum randomness.
 *
 * `buildAIModelRuntimeConfig` deliberately computes a low temperature for code
 * — 0.1 for debug, 0.2 for planning — and the adapter overwrote it with 1.0 on
 * every request that had thinking enabled, which is every code task. The
 * comment justifying it ("reasoning models often require temperature=1.0") was
 * true when written and is no longer this layer's problem:
 * `enforceModelCapabilities` reads OpenRouter's advertised parameters and
 * strips `temperature` for any model that will not take it, which production
 * logs on every luna call.
 */
{
  // No layer chooses a temperature any more: every model runs at its
  // provider's own defaults, and the request carries only the reasoning level.
  for (const modelId of ['x-ai/grok-4.6', 'openai/gpt-5.6-luna', 'openai/gpt-5.6-sol', 'anthropic/claude-opus-5'] as const) {
    const runtime = buildAIModelRuntimeConfig({ modelId, task: 'debug', allowTools: true, stream: true });
    const config = buildProviderRequestConfig(runtime) as Record<string, unknown>;
    assert.equal(config.temperature, undefined, `${modelId}: no forced temperature`);
    assert.equal(config.maxTokens, undefined, `${modelId}: no fixed output cap`);
    assert.equal(config.reasoningLevel, 'medium', `${modelId}: reasoning is on by default`);
  }
  const adapters = readFileSync(new URL('./src/services/provider-adapters.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(adapters, /temperature\s*:/, 'the adapter layer sets no sampling');
}

/*
 * 2. One flat round ended the whole run.
 *
 * The rule was `errorsAfter >= errorsBefore` -> stop, and its reasoning holds
 * only while the model is handed the identical input again. Debugging is not
 * monotonic: fixing one fault uncovers another, and a refactor holds the count
 * flat while making the code correct. A genuine dead end looked exactly like a
 * problem that needed two passes.
 */
{
  const repair = readFileSync(new URL('./src/services/sandbox/repair-loop.ts', import.meta.url), 'utf8');

  const patience = Number(/const DEFAULT_MAX_STALLED_ROUNDS = (\d+)/.exec(repair)?.[1]);
  assert.ok(patience >= 2, `a single flat round must not end the run (patience is ${patience})`);

  assert.doesNotMatch(
    repair,
    /if \(!isBuildRound && errorsAfter >= errorsBefore\) return finish\('no_progress'\)/,
    'the one-strike rule must not come back',
  );
  assert.match(repair, /stalledRounds \+= 1\) >= maxStalledRounds/, 'stalling must be counted, not fatal on sight');
  assert.match(repair, /if \(errorsAfter < errorsBefore\) stalledRounds = 0;/, 'and progress must reset the count');

  // Patience is only defensible if the next round is told something new.
  assert.match(repair, /did not reduce these errors/, 'a stalled round must tell the model its last attempt did not help');
  assert.match(repair, /Do not repeat the same edit/, 'and ask for a different approach');
  assert.match(repair, /stalledRounds > 0/, 'only when it actually stalled');

  // A build's first round is still exempt: the scaffold's error count is not
  // a baseline an attempt can be judged against.
  assert.match(repair, /if \(isBuildRound( \|\| isPolishRound)?\) continue;/, "a build's first round is not measured against the scaffold");

  // And the run stays bounded: patience must be well under the round ceiling,
  // or it is the same as having no stop rule at all.
  const rounds = Number(/const DEFAULT_MAX_ROUNDS = (\d+)/.exec(repair)?.[1]);
  assert.ok(patience < rounds, 'patience must stop a hopeless run before the round ceiling does');
}

/*
 * 3. Every model was used at a fraction of its capacity.
 *
 * The output tiers sat between 75% and 87% below what each model advertises —
 * 16k for a model offering 128k — and the coder loop hardcoded 16k on top of
 * that. A large component or a migration is what gets truncated by that, and a
 * truncated file is not a soft failure: it is written half finished and the
 * next round has to work out why it will not compile.
 */
{
  const { MODEL_REGISTRY, AI_MODEL_CAPABILITIES } = await import('./src/config/ai-models.ts');
  const { getAIModelCapabilityProfile } = await import('./src/services/ai-model-runtime.ts');

  for (const model of MODEL_REGISTRY) {
    const modelId = model.id as keyof typeof AI_MODEL_CAPABILITIES;
    const profile = getAIModelCapabilityProfile(modelId);
    const advertised = AI_MODEL_CAPABILITIES[modelId].maxOutputTokens;
    assert.ok(profile.recommended.maxTokens <= advertised, `${modelId}: never ask for more than the provider advertises`);
    assert.ok(
      profile.recommended.maxTokens >= Math.min(advertised, 16_000),
      `${modelId}: only ${profile.recommended.maxTokens} of ${advertised} output tokens`,
    );
  }

  // The coder is the call that most needs the room, and must not cap itself.
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  const runtimeFor = pipeline.slice(pipeline.indexOf('const runtimeFor ='));
  assert.doesNotMatch(runtimeFor.slice(0, 700), /maxTokens: \d/, 'the coder must take the model\'s own output allowance');
}

/*
 * 4. And the context window, the same way.
 *
 * A fixed 240k-character compaction threshold is roughly 60k tokens: a quarter
 * of the smallest window in the catalogue and a sixteenth of the largest. A
 * model with a million tokens of context had its history digested long before
 * it needed to be, losing detail it could have kept.
 */
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /function compactionThresholdChars\(/, 'the threshold must come from the model');
  assert.match(pipeline, /compactAboveChars: compactionThresholdChars\(modelId\)/, 'and actually be used, for the model this round runs on');

  const { getAIModelCapabilityProfile } = await import('./src/services/ai-model-runtime.ts');
  const threshold = (id: string) => {
    const context = getAIModelCapabilityProfile(id as any).limits.contextTokens;
    return Math.max(240_000, Math.min(600_000, Math.floor(context * 4 * 0.25)));
  };
  assert.ok(threshold('openai/gpt-5.6-luna') > 240_000, 'a million-token window must not be compacted at 60k tokens');
  assert.ok(threshold('openai/gpt-5.6-luna') <= 600_000, 'but a single request must stay bounded');
  assert.ok(threshold('moonshotai/kimi-k3') >= 240_000, 'a smaller window keeps at least the old behaviour');
}

console.log('agent persistence tests passed');
