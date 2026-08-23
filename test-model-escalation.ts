import assert from 'node:assert/strict';
import { ModelRouter, type RoutingContext } from './src/services/model-router.ts';
import { MODEL_ACTION_CREDIT_FLOORS } from './src/config/ai-models.ts';

const router = new ModelRouter();

// Predicate logic.
assert.equal(router.shouldEscalateToFrontier({}), false);
assert.equal(router.shouldEscalateToFrontier({ autofixFailures: 1 }), false);
assert.equal(router.shouldEscalateToFrontier({ autofixFailures: 2 }), true);
assert.equal(router.shouldEscalateToFrontier({ heavyBuild: true }), true);
assert.equal(router.shouldEscalateToFrontier({ complexAppType: true }), true);

const base: RoutingContext = {
  plan: 'scale',
  mode: 'Auto',
  userCredits: 100000,
  taskComplexity: 'simple',
};

// No signal → identical to plain selectModel (default routing untouched).
{
  const plain = await router.selectModel(base);
  const escalated = await router.selectModelEscalated(base, {});
  assert.equal(escalated, plain, 'no signal must not change the default routing');
}

// Hard signal → escalates toward a frontier (>= cost) model on a capable plan.
{
  const plain = await router.selectModel(base);
  const escalated = await router.selectModelEscalated(base, { heavyBuild: true });
  assert.notEqual(escalated, plain, 'a heavy build must escalate away from the cheap default');
  assert.ok(
    MODEL_ACTION_CREDIT_FLOORS[escalated] >= MODEL_ACTION_CREDIT_FLOORS[plain],
    'escalated model should be at least as capable/costly as the default',
  );
}

// Repeated auto-debug failures also escalate.
{
  const plain = await router.selectModel(base);
  const escalated = await router.selectModelEscalated(base, { autofixFailures: 2 });
  assert.notEqual(escalated, plain, 'repeated auto-debug failures must escalate');
}

// Custom mode is never silently escalated.
{
  const custom: RoutingContext = { ...base, mode: 'Custom' };
  const escalated = await router.selectModelEscalated(custom, { heavyBuild: true }, 'anthropic/claude-sonnet-5');
  assert.equal(escalated, 'anthropic/claude-sonnet-5', 'custom choice must be respected, not escalated over');
}

// Guardrail: a constrained plan/credit budget cannot be pushed past what it affords.
{
  const free: RoutingContext = { plan: 'free', mode: 'Auto', userCredits: 5, taskComplexity: 'simple' };
  const escalated = await router.selectModelEscalated(free, { heavyBuild: true });
  assert.ok(MODEL_ACTION_CREDIT_FLOORS[escalated] <= 5, 'escalation must still respect the credit floor');
}

console.log('test-model-escalation passed');
