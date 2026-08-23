import assert from 'node:assert/strict';
import { ModelRouter } from './src/services/model-router.ts';

const router = new ModelRouter();

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

assert.equal(
  await router.selectModel({
    plan: 'pro',
    mode: 'Auto',
    userCredits: 80,
    taskComplexity: 'complex',
  }),
  'anthropic/claude-sonnet-5',
  'Auto complex tasks should upgrade to a strong agentic coding model when plan and credits allow it.',
);

assert.equal(
  await router.selectModel({
    plan: 'scale',
    mode: 'Auto',
    userCredits: 120,
    taskComplexity: 'extreme',
  }),
  'openai/gpt-5.6-sol',
  'Auto extreme Scale tasks should use Sol without exposing Enterprise-only Fable.',
);

assert.equal(
  await router.selectModel({
    plan: 'enterprise',
    mode: 'Custom',
    userCredits: 120,
    taskComplexity: 'extreme',
  }, 'anthropic/claude-fable-5'),
  'anthropic/claude-fable-5',
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
