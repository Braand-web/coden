import assert from 'node:assert/strict';
import { understandUserIntent } from './src/services/intent-understanding.ts';
import { applyTypedIntentGate, buildTypedIntentDecision } from './src/services/typed-intent-router.ts';

type TestIntent = {
  intent: string;
  confidence: number;
  requiresFileChanges: boolean;
  requiresPreviewRebuild: boolean;
  requiresCredits: boolean;
  userVisibleReason: string;
  selectedModelPolicy?: string;
  nextAction?: string;
  autoPlanRequired?: boolean;
  routingSource?: string;
  intentUnderstanding?: ReturnType<typeof understandUserIntent>;
  clarification?: { question: string; choices: string[]; recommendation: string };
  // Project state — independent from requiresFileChanges (which is the decision
  // *outcome*, not whether the project already has files). Defaults to false
  // (fresh project) so explicit "create app" prompts route to BUILD.
  hasFiles?: boolean;
};

function baseDecision(prompt: string, patch: Partial<TestIntent> = {}): TestIntent {
  const understanding = understandUserIntent({ prompt, hasFiles: Boolean(patch.hasFiles), requestedMode: 'auto' });
  return {
    intent: 'conversation',
    confidence: 0.86,
    requiresFileChanges: false,
    requiresPreviewRebuild: false,
    requiresCredits: false,
    nextAction: 'answer',
    selectedModelPolicy: 'auto',
    userVisibleReason: 'fallback',
    intentUnderstanding: understanding,
    ...patch,
  };
}

function typed(prompt: string, patch: Partial<TestIntent> = {}) {
  const decision = baseDecision(prompt, patch);
  const typedDecision = buildTypedIntentDecision({ prompt, decision, hasFiles: Boolean(patch.hasFiles) });
  const gated = applyTypedIntentGate(decision, typedDecision);
  return { typedDecision, gated };
}

{
  const { typedDecision, gated } = typed('dis moi c est quoi lovable.dev ?');
  assert.equal(typedDecision.primary_intent, 'CHAT');
  assert.equal(typedDecision.execution_strategy, 'ANSWER_ONLY');
  assert.equal(typedDecision.lifecycle_mode, 'CHAT_MODE');
  assert.deepEqual(typedDecision.lifecycle_steps, ['intent_router', 'chat_response']);
  assert.equal(gated.intent, 'conversation');
  assert.equal(gated.requiresFileChanges, false);
}

{
  // Autonomous edit: short directional feedback on an EXISTING project must
  // become an edit action, not a conversation.
  const autoEdit = typed('non, trop grand, fais plus propre', {
    hasFiles: true,
    requiresFileChanges: true,
  });
  assert.equal(autoEdit.typedDecision.primary_intent, 'EDIT');
  assert.equal(autoEdit.typedDecision.requires_code_changes, true);
  assert.equal(autoEdit.gated.requiresFileChanges, true);
}

{
  // The same feedback with NO existing project must NOT silently build.
  const noProject = typed('non, trop grand, fais plus propre');
  assert.notEqual(noProject.typedDecision.primary_intent, 'EDIT');
}

{
  // A pure thanks on an existing project stays conversation.
  const thanks = typed('merci, parfait', { requiresFileChanges: true });
  assert.equal(thanks.typedDecision.primary_intent, 'CHAT');
}

{
  const { typedDecision, gated } = typed('genere', {
    intent: 'clarification_required',
    confidence: 0.78,
    requiresFileChanges: false,
    requiresPreviewRebuild: false,
    requiresCredits: false,
  });
  assert.equal(typedDecision.primary_intent, 'CLARIFY');
  assert.equal(typedDecision.execution_strategy, 'WAIT_FOR_USER_CONFIRMATION');
  assert.equal(typedDecision.lifecycle_mode, 'CLARIFICATION_MODE');
  assert.equal(typedDecision.sandbox_required, false);
  assert.equal(gated.intent, 'clarification_required');
  assert.equal(gated.requiresFileChanges, false);
  assert.match(gated.clarification?.question || '', /app|écran|composant|bug/i);
}

{
  const { typedDecision, gated } = typed('Ajoute un bouton de contact, mais dis-moi d abord si c est une bonne idee', {
    intent: 'build',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'DISCUSS_FIRST');
  assert.equal(typedDecision.execution_strategy, 'WAIT_FOR_USER_CONFIRMATION');
  assert.equal(typedDecision.lifecycle_mode, 'CHAT_MODE');
  assert.equal(typedDecision.clarification, undefined);
  assert.equal(gated.intent, 'conversation');
  assert.equal(gated.requiresFileChanges, false);
}

{
  const { typedDecision, gated } = typed('cree une vraie todo app avec ajout suppression filtres et etat vide', {
    intent: 'build',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'BUILD');
  assert.equal(typedDecision.execution_strategy, 'RUN_AGENT');
  assert.equal(typedDecision.lifecycle_mode, 'AGENT_BUILD_MODE');
  assert.equal(typedDecision.sandbox_required, true);
  assert.equal(typedDecision.auto_debug_policy, 'compile_signal');
  assert.ok(typedDecision.lifecycle_steps.includes('knowledge_injection'));
  assert.ok(typedDecision.lifecycle_steps.includes('compile_and_test'));
  assert.equal(typedDecision.requires_code_changes, true);
  assert.equal(gated.requiresFileChanges, true);
  assert.ok(typedDecision.target_files.includes('src/App.tsx'));
}

{
  const { typedDecision, gated } = typed('cr\uFFFDe une vraie todo app web avec ajout de t\uFFFDche suppression filtres et \uFFFDtat vide', {
    intent: 'build',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'BUILD');
  assert.equal(typedDecision.execution_strategy, 'RUN_AGENT');
  assert.equal(typedDecision.requires_code_changes, true);
  assert.equal(gated.requiresFileChanges, true);
  assert.ok(typedDecision.target_files.includes('src/App.tsx'));
}

{
  const { typedDecision, gated } = typed('genere une mini app de pomodero', {
    intent: 'build',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'BUILD');
  assert.equal(typedDecision.execution_strategy, 'RUN_AGENT');
  assert.equal(typedDecision.requires_code_changes, true);
  assert.equal(gated.requiresFileChanges, true);
}

{
  const { typedDecision, gated } = typed('preview blanche, index.html should load /src/main.tsx, corrige le probleme', {
    hasFiles: true,
    intent: 'debug_fix',
    requiresFileChanges: true,
    requiresPreviewRebuild: true,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'DEBUG');
  assert.equal(typedDecision.execution_strategy, 'RUN_DEBUG_LOOP');
  assert.equal(typedDecision.lifecycle_mode, 'DEBUG_LOOP_MODE');
  assert.equal(typedDecision.auto_debug_policy, 'runner_signal');
  assert.ok(typedDecision.target_files.includes('index.html'));
  assert.ok(typedDecision.target_files.includes('src/main.tsx'));
  assert.equal(gated.requiresPreviewRebuild, true);
}

{
  const { typedDecision, gated } = typed('publie en production maintenant', {
    intent: 'deploy_assist',
    requiresFileChanges: false,
    requiresPreviewRebuild: false,
    requiresCredits: true,
  });
  assert.equal(typedDecision.primary_intent, 'CRITICAL_ACTION');
  assert.equal(typedDecision.execution_strategy, 'WAIT_FOR_USER_CONFIRMATION');
  assert.equal(gated.intent, 'clarification_required');
  assert.equal(gated.requiresFileChanges, false);
}

console.log('typed intent router ok');
