import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODELS_BY_COST, blendedCost, selectModel, selectModelForAgent } from './src/services/model-selection.ts';
import { AI_ALLOWED_MODELS, MODEL_REGISTRY, type AllowedModelId } from './src/config/ai-models.ts';

/**
 * One selection policy, and its rule: the cheapest model that is still good
 * enough for the task.
 *
 * Selection used to live in five hardcoded preference lists inside the router
 * plus a weighted scoring function, all answering the same question and free to
 * disagree — 'Balanced' preferred a model the Auto path of the same complexity
 * ranked fourth. This pins the single policy that replaced them.
 */

const AUTHORISED = [
  'google/gemini-3.8-flash:batch',
  'anthropic/claude-fable-5.1:batch',
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-5.6-luna-pro',
  'moonshotai/kimi-k3',
  'x-ai/grok-4.6',
];

// -- the pool is exactly the authorised nine -------------------------------
assert.deepEqual([...MODELS_BY_COST].sort(), [...AUTHORISED].sort(), 'the selector must draw from the authorised catalogue only');
assert.deepEqual([...AI_ALLOWED_MODELS].sort(), [...AUTHORISED].sort());

// -- and it is walked cheapest first ---------------------------------------
for (let index = 1; index < MODELS_BY_COST.length; index += 1) {
  assert.ok(
    blendedCost(MODELS_BY_COST[index - 1]) <= blendedCost(MODELS_BY_COST[index]),
    `the catalogue must be ordered by cost: ${MODELS_BY_COST[index - 1]} before ${MODELS_BY_COST[index]}`,
  );
}

/**
 * A simple task must not reach for an expensive model.
 *
 * This is the money question. Routing intent classification to a frontier model
 * costs roughly twenty-five times what it needs to and returns the same label.
 */
const cheapest = MODELS_BY_COST[0];
assert.equal(selectModel({ task: 'classification', complexity: 'simple', plan: 'enterprise' }).modelId, cheapest,
  'a trivial task on the richest plan must still take the cheapest model');
assert.equal(selectModel({ task: 'summary', plan: 'enterprise' }).modelId, cheapest);

// Having the budget is not a reason to spend it.
const premiumPlanSimple = selectModel({ task: 'conversation', plan: 'enterprise', credits: 10_000, interactive: true });
assert.ok(blendedCost(premiumPlanSimple.modelId) < 3, `a chat reply must stay cheap, got ${premiumPlanSimple.modelId}`);

/**
 * A hard task must be allowed to reach further, and only as far as it needs.
 *
 * The failure mode on this side is a router that answers "the best model" to
 * every hard question. Architecture needs frontier reasoning; it does not need
 * the most expensive model that happens to have it.
 */
const architecture = selectModel({ task: 'architecture', complexity: 'extreme', plan: 'enterprise', credits: 10_000 });
const architectureCost = blendedCost(architecture.modelId);
const frontierReasoners = MODEL_REGISTRY.filter(model => model.capabilities.reasoningLevel === 'frontier');
assert.ok(frontierReasoners.some(model => model.id === architecture.modelId), 'architecture needs frontier reasoning');
for (const model of frontierReasoners) {
  assert.ok(architectureCost <= blendedCost(model.id as AllowedModelId),
    `${architecture.modelId} must be the cheapest frontier reasoner, but ${model.id} is cheaper`);
}

// A complex generation must clear the code bar, and the cheap models must not.
const generation = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'pro', credits: 500 });
assert.equal(MODEL_REGISTRY.find(m => m.id === generation.modelId)?.capabilities.codeLevel, 'frontier');
assert.ok(generation.rejected.some(entry => entry.modelId === cheapest), 'the cheapest model must have been considered and rejected first');

/**
 * Every decision explains itself.
 *
 * A routing choice nobody can account for is a routing choice nobody can
 * correct, and the previous scoring function produced exactly that: a number.
 */
assert.match(generation.reason, /cheapest model clearing code_generation\/complex/);
for (const entry of generation.rejected) {
  assert.ok(entry.because.length > 5, `${entry.modelId} was rejected without a reason`);
}

// -- gates ----------------------------------------------------------------
// Plan and credits keep a user out of a model they cannot have; the selector
// says so rather than failing.
const free = selectModel({ task: 'architecture', complexity: 'extreme', plan: 'free' });
assert.ok(free.rejected.some(entry => /requires the (pro|scale|enterprise) plan/.test(entry.because)), 'plan gating must be stated');
const broke = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'enterprise', credits: 1 });
assert.ok(broke.rejected.some(entry => /credits/.test(entry.because)), 'credit gating must be stated');

// A deferred tier answers minutes later; that is fine for background work and
// unusable for someone watching the screen.
const interactive = selectModel({ task: 'classification', complexity: 'simple', plan: 'free', interactive: true });
assert.ok(!interactive.modelId.endsWith(':batch'), 'an interactive request must not be routed to a deferred tier');
assert.ok(interactive.rejected.some(entry => /deferred/.test(entry.because)));

// Capability needs are hard filters, not preferences.
const vision = selectModel({ task: 'classification', plan: 'free', needs: { vision: true } });
assert.equal(MODEL_REGISTRY.find(m => m.id === vision.modelId)?.capabilities.supportsVision, true);

/**
 * One call, one model.
 *
 * The pool is nine models; a task uses one of them. A router that consults
 * several to answer a single question multiplies the bill by the number it
 * consulted, which is what "choisir le plus pertinent" exists to prevent.
 */
const decision = selectModel({ task: 'debug', plan: 'pro', credits: 100 });
assert.equal(typeof decision.modelId, 'string');
assert.ok(!Array.isArray((decision as any).modelIds), 'a selection is a single model, never a set to try in parallel');

// -- agents inherit the policy rather than naming models -------------------
assert.equal(selectModelForAgent('router', { plan: 'free' }).modelId, cheapest, 'the intent router is a classification task');
assert.ok(blendedCost(selectModelForAgent('architect', { plan: 'enterprise', credits: 999 }).modelId) > blendedCost(cheapest),
  'the architect must be allowed past the cheapest model');

/**
 * The policy lives in one file.
 *
 * This is the assertion that keeps it that way: no other module may name a
 * model in a preference list, or the duplication this replaced comes back one
 * list at a time.
 */
const router = readFileSync('./src/services/model-router.ts', 'utf8');
const hardcodedLists = router.match(/AllowedModelId\[\]\s*=\s*\[[^\]]*'/g) || [];
assert.equal(hardcodedLists.length, 0, `the router must not carry its own model preference lists: ${hardcodedLists.join(' | ')}`);
assert.match(router, /selectModel\(\{/, 'the router must delegate to the central selector');

/**
 * A deferred tier must never be run as an interactive call.
 *
 * `:batch` names a different execution mode with its own price. Mapping such a
 * model onto a direct provider endpoint, where no batch tier exists, would run
 * a batch selection interactively and bill it at the interactive rate — a
 * silent overcharge with no symptom until the invoice.
 */
const { resolveDirectAnthropicModelId } = await import('./src/services/anthropic-service.ts');
for (const modelId of MODELS_BY_COST.filter(id => id.endsWith(':batch'))) {
  assert.equal(resolveDirectAnthropicModelId(modelId), null,
    `${modelId} is a deferred tier and must not be dispatched to a direct interactive endpoint`);
}
assert.equal(resolveDirectAnthropicModelId('anthropic/claude-sonnet-5'), 'claude-sonnet-5',
  'interactive Anthropic models still take the direct path');

console.log('model selection tests passed');
