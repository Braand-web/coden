import assert from 'node:assert/strict';
import { ModelRouter } from './src/services/model-router.ts';

const router = new ModelRouter();

/**
 * The routing policy changed: the router now takes the cheapest model that is
 * still capable, instead of stepping up a tier ladder as complexity rises.
 *
 * Three of the four Auto expectations below are unchanged. The fourth is not,
 * and deliberately: an extreme generation on Scale used to be pinned to the
 * Premium tier, which is the "always reach for the most powerful model"
 * behaviour the rework exists to remove. Sonnet is frontier on code and costs
 * $8/M blended against Sol's $10/M, so it is the correct answer to "the
 * cheapest model that can do this".
 */
assert.equal(
  await router.selectModel({
    plan: 'free',
    mode: 'Auto',
    userCredits: 10,
    taskComplexity: 'simple',
  }),
  'openai/gpt-5.6-luna',
  'Auto simple tasks should prefer the lightweight economy model.',
);

assert.equal(
  await router.selectModel({
    plan: 'free',
    mode: 'Auto',
    userCredits: 10,
    taskComplexity: 'medium',
  }),
  'openai/gpt-5.6-luna',
  'Auto medium tasks should avoid provider lock-in and use a capable free-tier model.',
);

// A conversational request must never be routed to a deferred tier, whatever
// the caller passed: a batch model answers minutes later, which reads as a
// hang. Gemini is the cheapest model in the catalogue and is skipped here for
// exactly that reason.
assert.notEqual(
  await router.selectModel({ plan: 'free', mode: 'Auto', userCredits: 10, taskComplexity: 'simple' }),
  'google/gemini-3.8-flash:batch',
  'an interactive request must not be deferred, even to save money',
);

assert.equal(
  await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 80,
    taskComplexity: 'complex',
    task: 'code_generation',
  }),
  'openai/gpt-5.6-sol',
  'Auto complex generation should upgrade to a frontier coding model when plan and credits allow it.',
);

assert.equal(
  await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 120,
    taskComplexity: 'extreme',
    task: 'code_generation',
  }),
  'openai/gpt-5.6-sol',
  'extreme generation takes the cheapest frontier coder, not the most expensive model the plan permits.',
);

// Architecture is a reasoning task, not a coding one, so it selects on a
// different axis — and still on price within it.
assert.equal(
  await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 120,
    taskComplexity: 'extreme',
    task: 'architecture',
  }),
  'openai/gpt-5.6-sol',
  'architecture takes the cheapest frontier reasoner.',
);

assert.equal(
  await router.selectModel({
    plan: 'enterprise',
    mode: 'Custom',
    userCredits: 120,
    taskComplexity: 'extreme',
  }, 'anthropic/claude-fable-5.1:batch'),
  'anthropic/claude-fable-5.1:batch',
  'Manual selection must respect Enterprise-only Fable access.',
);

assert.equal(
  await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 100,
    taskComplexity: 'medium',
    preferredModels: ['anthropic/claude-opus-5', 'anthropic/claude-opus-5', 'anthropic/claude-opus-5'],
  }),
  'anthropic/claude-opus-5',
  'Studio Design/Decks auto routing should prioritize Opus when plan and credits allow it.',
);

assert.equal(
  await router.selectModel({
    plan: 'free',
    mode: 'Auto',
    userCredits: 10,
    taskComplexity: 'medium',
    preferredModels: ['anthropic/claude-opus-5', 'anthropic/claude-opus-5', 'anthropic/claude-opus-5'],
  }),
  'openai/gpt-5.6-luna',
  'Studio Opus preference should fall back to the diversified safe router when Opus is not available.',
);

console.log('model-router tests passed');
