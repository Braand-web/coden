import assert from 'node:assert/strict';
import { applyExecutionContractToDecision, buildExecutionContract } from './src/services/execution-contract.ts';

function legacy(overrides: Record<string, unknown> = {}) {
  return {
    intent: 'conversation',
    confidence: 0.72,
    requestedMode: 'auto',
    requiresFileChanges: false,
    requiresPreviewRebuild: false,
    requiresCredits: false,
    userVisibleReason: 'legacy fallback',
    ...overrides,
  } as any;
}

{
  const contract = buildExecutionContract({ prompt: 'bonjour', legacyDecision: legacy() });
  assert.equal(contract.mode, 'chat');
  assert.equal(contract.can_mutate_files, false);
  assert.equal(contract.should_touch_preview, false);
}

{
  const contract = buildExecutionContract({ prompt: 'genere', legacyDecision: legacy({ intent: 'plan' }) });
  assert.equal(contract.mode, 'clarify');
  assert.equal(contract.can_mutate_files, false);
  assert.ok(contract.clarification?.question);
}

{
  const prompt = `Agis en tant qu'expert en developpement web. Je souhaite creer une mini-application de "To Do List" interactive et moderne.
Fonctionnalites indispensables: Ajout, Suppression, Marquage terminee, Filtres Toutes Actives Termineees, Sauvegarde LocalStorage.`;
  const contract = buildExecutionContract({ prompt, legacyDecision: legacy({ intent: 'plan' }) });
  assert.equal(contract.mode, 'build');
  assert.equal(contract.can_mutate_files, true);
  assert.equal(contract.should_touch_preview, true);
  assert.equal(contract.requires_runner, true);
  const decision = applyExecutionContractToDecision(legacy({ intent: 'plan' }), contract);
  assert.equal(decision.intent, 'build');
  assert.equal(decision.requiresFileChanges, true);
  assert.equal(decision.nextAction, 'build');
}

{
  const contract = buildExecutionContract({ prompt: 'genere une mini app de pomodero', legacyDecision: legacy({ intent: 'conversation' }) });
  assert.equal(contract.mode, 'build');
  assert.equal(contract.can_mutate_files, true);
  assert.equal(contract.target_kind, 'app');
}

{
  const contract = buildExecutionContract({ prompt: 'crée une application web de calculatrice scientifique avec historique', legacyDecision: legacy({ intent: 'conversation' }) });
  assert.equal(contract.mode, 'build');
  assert.equal(contract.can_mutate_files, true);
  assert.equal(contract.target_kind, 'app');
}

{
  const contract = buildExecutionContract({ prompt: "dis moi c'est quoi lovable.dev", legacyDecision: legacy({ intent: 'build', requiresFileChanges: true }) });
  assert.equal(contract.mode, 'chat');
  assert.equal(contract.can_mutate_files, false);
}

{
  const contract = buildExecutionContract({
    prompt: 'corrige le bug preview blanche: index.html should load /src/main.tsx as a module',
    hasFiles: true,
    legacyDecision: legacy({ intent: 'conversation' }),
  });
  assert.equal(contract.mode, 'debug');
  assert.equal(contract.can_mutate_files, true);
  assert.equal(contract.target_kind, 'bug');
}

{
  const contract = buildExecutionContract({
    prompt: 'corrige le blocage restant',
    hasFiles: true,
    legacyDecision: legacy({ intent: 'conversation' }),
  });
  assert.equal(contract.mode, 'debug');
  assert.equal(contract.can_mutate_files, true);
  assert.equal(contract.should_touch_preview, true);
  const decision = applyExecutionContractToDecision(legacy({ intent: 'conversation' }), contract);
  assert.equal(decision.intent, 'debug_fix');
  assert.equal(decision.nextAction, 'debug_fix');
}

{
  const contract = buildExecutionContract({ prompt: 'publie maintenant', hasFiles: true, legacyDecision: legacy({ intent: 'build' }) });
  assert.equal(contract.mode, 'critical_action');
  assert.equal(contract.requires_confirmation, true);
  const decision = applyExecutionContractToDecision(legacy({ intent: 'build', requiresFileChanges: true }), contract);
  assert.equal(decision.intent, 'clarification_required');
  assert.equal(decision.requiresFileChanges, false);
}

{
  const contract = buildExecutionContract({
    prompt: 'ok implemente tout',
    hasFiles: true,
    hasLastPlan: true,
    legacyDecision: legacy({ intent: 'conversation' }),
  });
  assert.equal(contract.mode, 'edit');
  assert.equal(contract.can_mutate_files, true);
}

console.log('Execution contract tests passed');
