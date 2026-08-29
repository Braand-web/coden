import assert from 'node:assert/strict';
import { validateAllowedModel, ForbiddenModelError } from './src/services/ai-validator.ts';
import { AI_ALLOWED_MODELS } from './src/config/ai-models.ts';
import {
  buildWorldClassUiPolicy,
  buildGeneratedDesignBrief,
  chooseDesignDirection,
  classifyGeneratedAppType,
  getPlatformIntelligence,
} from './src/services/design-generation-policy.ts';

const EXPECTED_ALLOWED_MODELS = [
  'openai/gpt-5.6-luna',
  'google/gemini-3.7-flash',
  'deepseek/deepseek-v4-pro-0813',
  'openai/gpt-5.6-terra',
  'qwen/qwen3.8-27b',
  'z-ai/glm-5.3',
  'anthropic/claude-sonnet-5',
  'x-ai/grok-4.6',
  'openai/gpt-5.6-sol',
  'anthropic/claude-opus-5',
  'anthropic/claude-fable-5',
] as const;

async function runTests() {
  console.log('Starting AI Policy Tests...');

  // Test 1: Allowed model
  const model = AI_ALLOWED_MODELS[0];
  validateAllowedModel(model);
  assert.ok(model);
  assert.deepEqual([...AI_ALLOWED_MODELS].sort(), [...EXPECTED_ALLOWED_MODELS].sort());
  EXPECTED_ALLOWED_MODELS.forEach(validateAllowedModel);
  [
    'google/gemini-2.5-flash',
    'openai/gpt-5-mini',
    'openai/gpt-4o',
    'meta-llama/llama-4-maverick',
    'mistralai/codestral-2501',
    'x-ai/grok-3',
  ].forEach(disallowed => assert.ok(!AI_ALLOWED_MODELS.includes(disallowed as any), `${disallowed} must not be allowed`));
  console.log(`Success: Strict allowed model registry has ${AI_ALLOWED_MODELS.length} approved models only.`);

  // Test 2: Forbidden model
  assert.throws(
    () => validateAllowedModel('openai/gpt-4-total-garbage'),
    ForbiddenModelError,
    'Forbidden model should be blocked',
  );
  console.log('Success: Forbidden model correctly blocked.');

  // Test 3: Arbitrary string
  assert.throws(
    () => validateAllowedModel('"><script>alert(1)</script>'),
    ForbiddenModelError,
    'Malicious model ID should be blocked',
  );
  console.log('Success: Malicious model ID blocked.');

  // Test 4: Auto is a UI routing mode, never a provider model ID.
  assert.throws(
    () => validateAllowedModel('auto'),
    ForbiddenModelError,
    'Auto should not be sent to provider model validation',
  );
  console.log('Success: Auto is not accepted as a provider model.');

  // Test 5: UI generation policy adapts to the requested app type.
  assert.equal(
    classifyGeneratedAppType('Create a conversion landing page for an AI code assistant'),
    'landing_page',
  );
  assert.equal(
    classifyGeneratedAppType('Create a restaurant app with menu, reservation and reviews'),
    'restaurant',
  );
  assert.equal(
    classifyGeneratedAppType('Create an analytics dashboard with charts and KPI filters'),
    'analytics_dashboard',
  );
  assert.equal(
    classifyGeneratedAppType('Create an ecommerce shop with cart, products and checkout'),
    'ecommerce',
  );
  assert.equal(
    classifyGeneratedAppType('Cree une app fintech avec wallet, credits, facturation et historique de paiements'),
    'fintech_billing',
  );
  assert.equal(
    classifyGeneratedAppType('Cree un outil IA avec prompt, streaming, preview et historique'),
    'ai_tool',
  );
  assert.equal(
    classifyGeneratedAppType('Cree une app mobile PWA avec bottom nav et swipe'),
    'mobile_first_app',
  );

  // Test 6: The world-class protocol rejects generic AI design and carries app-specific rules.
  const landingPolicy = buildWorldClassUiPolicy({
    prompt: 'Create a landing page for a developer AI tool',
  });
  assert.equal(landingPolicy.appType, 'landing_page');
  assert.equal(landingPolicy.designDirection, 'cinematic_landing');
  assert.ok(landingPolicy.systemPrompt.includes('Never produce UI that looks AI-generated'));
  assert.ok(landingPolicy.systemPrompt.includes('Break the generic hero pattern'));
  assert.ok(landingPolicy.systemPrompt.includes('Functional quality gate'));
  assert.ok(landingPolicy.userContext.designBrief.required_components.includes('hero'));
  assert.ok(landingPolicy.userContext.platformIntelligence.functionalRules.length > 0);

  const dashboardPolicy = buildWorldClassUiPolicy({
    prompt: 'Create a dashboard for monitoring API usage and billing metrics',
  });
  assert.equal(dashboardPolicy.appType, 'analytics_dashboard');
  assert.equal(chooseDesignDirection(dashboardPolicy.appType, 'dashboard'), 'data_operational');
  assert.ok(dashboardPolicy.systemPrompt.includes('Never use a marketing hero'));

  const restaurantBrief = buildGeneratedDesignBrief({
    prompt: 'restaurant app with menu and reservations',
    appType: 'restaurant',
    designDirection: 'hospitality_warm',
  });
  assert.ok(restaurantBrief.required_components.includes('menu'));
  assert.ok(restaurantBrief.required_interactions.includes('reservation validation'));

  const fintechIntel = getPlatformIntelligence('fintech_billing');
  assert.equal(fintechIntel.trustLevel, 'critical');
  assert.ok(fintechIntel.requiredComponents.includes('transactions'));

  // v26: classification is a hint, and the generic path is the richest fallback.
  assert.ok(landingPolicy.systemPrompt.includes('CLASSIFICATION IS A HINT, NOT A CAGE'), 'design prompt must frame the platform type as a hint');
  const genericPolicy = buildWorldClassUiPolicy({ prompt: 'build me something useful for my niche workflow' });
  assert.equal(genericPolicy.appType, 'generic_web_app');
  assert.ok(genericPolicy.systemPrompt.includes('GENERIC PRODUCT PATH'), 'generic apps must use the rich generic product path');

  // v26 step 5: exactly the matching few-shot example is injected (not all of them).
  assert.ok(genericPolicy.systemPrompt.includes('Reference example for an out-of-category product'), 'generic apps must get the generic few-shot example');
  assert.ok(!genericPolicy.systemPrompt.includes('Reference example for commerce'), 'few-shot injection must be scoped to the resolved type, not all families');
  assert.ok(dashboardPolicy.systemPrompt.includes('Reference example for an operational dashboard'), 'dashboards must get the dashboard few-shot example');

  console.log('Success: Adaptive world-class UI generation policy passed validation.');
  console.log('Tests completed.');
}

runTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
