import assert from 'node:assert/strict';
import { buildExecutionContract } from './src/services/execution-contract.ts';
import { buildInternalExecutionPlan } from './src/services/agent-execution-os.ts';
import { buildAIModelRuntimeConfig } from './src/services/ai-model-runtime.ts';
import {
  buildProductionReliabilityPlan,
  PRODUCTION_GOLDEN_PROMPTS,
  validateProductionReliability,
} from './src/services/production-reliability-harness.ts';

{
  const contract = buildExecutionContract({ prompt: 'bonjour', hasFiles: true });
  const plan = buildProductionReliabilityPlan({ contract });
  assert.equal(plan.deliveryPolicy, 'plain_answer');
  assert.equal(plan.userVisibleSurface, 'plain_chat');
  assert.equal(plan.goldenPromptsRequired, false);

  const validation = validateProductionReliability({
    contract,
    evidence: {
      intentDecided: true,
      executionContractBuilt: true,
      modelRuntimeConfigured: true,
      selectedModelRespected: true,
      languageMatched: true,
      noRawJsonDisplayed: true,
      observabilityRecorded: true,
    },
  });
  assert.equal(validation.status, 'passed');
  assert.equal(validation.nextAction, 'deliver');
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une mini app todo avec ajout, suppression, filtres et localStorage',
    hasFiles: false,
  });
  const runtime = buildAIModelRuntimeConfig({
    modelId: 'openai/gpt-5.6-sol-pro',
    task: 'frontend_generation',
    stream: false,
    estimatedInputTokens: 24_000,
  });
  const validation = validateProductionReliability({
    contract,
    modelRuntime: runtime,
    evidence: {
      intentDecided: true,
      executionContractBuilt: true,
      languageMatched: true,
      noRawJsonDisplayed: true,
      noCodeInChat: true,
      plannerInternal: true,
      toolLoopTrace: true,
      filesChanged: true,
      diffReady: true,
      runnerChecked: true,
      runnerStatus: 'passed',
      browserChecked: true,
      browserStatus: 'passed',
      visualChecked: true,
      visualStatus: 'passed',
      cleanChecks: true,
      previewReady: true,
      previewStatus: 'ready',
      versionSaved: true,
      recoveryAvailable: true,
      journalPersisted: true,
      securityChecked: true,
      securityStatus: 'passed',
      memoryUpdated: true,
      observabilityRecorded: true,
      goldenPromptCovered: true,
      structuredOutputConfigured: true,
    },
  });
  assert.equal(validation.status, 'passed');
  assert.equal(validation.nextAction, 'deliver');
}

{
  const contract = buildExecutionContract({
    prompt: 'corrige preview blanche: index.html should load /src/main.tsx as a module',
    hasFiles: true,
  });
  const validation = validateProductionReliability({
    contract,
    evidence: {
      intentDecided: true,
      executionContractBuilt: true,
      modelRuntimeConfigured: true,
      selectedModelRespected: true,
      languageMatched: true,
      noRawJsonDisplayed: true,
      noCodeInChat: true,
      plannerInternal: true,
      toolLoopTrace: true,
      filesChanged: true,
      diffReady: true,
      runnerChecked: true,
      runnerStatus: 'failed',
      browserChecked: true,
      browserStatus: 'failed',
      visualChecked: true,
      visualStatus: 'failed',
      cleanChecks: false,
      previewReady: false,
      previewStatus: 'needs_fix',
      draftSaved: true,
      recoveryAvailable: true,
      journalPersisted: true,
      securityChecked: true,
      securityStatus: 'passed',
      observabilityRecorded: true,
      goldenPromptCovered: true,
    },
  });
  assert.equal(validation.status, 'needs_fix');
  assert.equal(validation.nextAction, 'save_recoverable_draft');
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une app SaaS avec auth Supabase, base de donnees et RLS',
    hasFiles: false,
  });
  const missing = validateProductionReliability({
    contract,
    evidence: {
      intentDecided: true,
      executionContractBuilt: true,
      modelRuntimeConfigured: true,
      selectedModelRespected: true,
      languageMatched: true,
      noRawJsonDisplayed: true,
      noCodeInChat: true,
      plannerInternal: true,
      toolLoopTrace: true,
      filesChanged: true,
      diffReady: true,
      runnerChecked: true,
      browserChecked: true,
      visualChecked: true,
      cleanChecks: true,
      previewReady: true,
      previewStatus: 'ready',
      versionSaved: true,
      recoveryAvailable: true,
      journalPersisted: true,
      securityChecked: true,
      noSecrets: true,
      observabilityRecorded: true,
      goldenPromptCovered: true,
    },
  });
  assert.equal(missing.status, 'failed');
  assert.ok(missing.missingBlockers.includes('rls_enabled'));
  assert.ok(missing.missingBlockers.includes('policies_generated'));
  assert.ok(missing.missingBlockers.includes('validation_layer'));
}

{
  const contract = buildExecutionContract({ prompt: 'publie maintenant', hasFiles: true });
  const validation = validateProductionReliability({
    contract,
    evidence: {
      intentDecided: true,
      executionContractBuilt: true,
      modelRuntimeConfigured: true,
      selectedModelRespected: true,
      languageMatched: true,
      noRawJsonDisplayed: true,
      confirmationRequested: true,
      liveUrlPersisted: true,
      liveVerified: false,
      securityChecked: true,
      observabilityRecorded: true,
    },
  });
  assert.equal(validation.status, 'failed');
  assert.ok(validation.missingBlockers.includes('live_verified'));
}

{
  const contract = buildExecutionContract({
    prompt: 'cree une app SaaS avec auth Supabase et billing Stripe',
    hasFiles: false,
  });
  const plan = buildInternalExecutionPlan({ contract, prompt: 'x', hasExistingFiles: false });
  assert.equal(plan.production_reliability_plan.version, 'production-reliability-harness/v1');
  assert.equal(plan.delivery_policy, 'verified_project');
  assert.ok(plan.production_requirements.includes('schema_generated'));
  assert.ok(plan.production_requirements.includes('browser_test'));
}

assert.ok(PRODUCTION_GOLDEN_PROMPTS.includes('cree une mini app todo avec ajout, suppression, filtres et localStorage'));
console.log('production reliability harness tests passed');
