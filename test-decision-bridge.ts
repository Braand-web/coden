import assert from 'node:assert/strict';
import { decideCodenAction } from './src/services/decision-core.ts';
import { decisionToLegacyDecision } from './src/services/decision-bridge.ts';
import { buildExecutionContract } from './src/services/execution-contract.ts';

// ── Field mapping ───────────────────────────────────────────────────────────
const editDecision = decideCodenAction({ prompt: 'ajoute un bouton de déconnexion', project: { hasFiles: true } });
const legacy = decisionToLegacyDecision(editDecision);
assert.equal(legacy.intent, 'edit');
assert.equal(legacy.requiresFileChanges, true);
assert.equal(legacy.requiresPreviewRebuild, true);
assert.equal(legacy.requiresCredits, true);
assert.equal(legacy.understandingCategory, editDecision.intent.category);
assert.equal(legacy.userVisibleReason, editDecision.rationale);
assert.equal(legacy.reason, editDecision.decision_path);

const chatDecision = decideCodenAction({ prompt: 'bonjour' });
const chatLegacy = decisionToLegacyDecision(chatDecision);
assert.equal(chatLegacy.intent, 'conversation');
assert.equal(chatLegacy.requiresFileChanges, false);
assert.equal(chatLegacy.requiresCredits, false);

// ── End-to-end: decision-core → bridge → execution-contract ─────────────────
function contractFor(prompt: string, project: { hasFiles?: boolean; hasLastPlan?: boolean } = {}, requestedMode?: string) {
  const decision = decideCodenAction({ prompt, project, requestedMode });
  const contract = buildExecutionContract({
    prompt,
    requestedMode,
    hasFiles: project.hasFiles,
    hasLastPlan: project.hasLastPlan,
    legacyDecision: decisionToLegacyDecision(decision),
  });
  return { decision, contract };
}

// Greeting → chat on both layers.
let r = contractFor('bonjour');
assert.equal(r.decision.action, 'chat');
assert.equal(r.contract.mode, 'chat');
assert.equal(r.contract.can_mutate_files, false);

// New build → build, mutating, blocking quality gate.
r = contractFor('crée une landing page pour mon café', { hasFiles: false });
assert.equal(r.decision.action, 'build');
assert.equal(r.contract.mode, 'build');
assert.equal(r.contract.can_mutate_files, true);
assert.equal(r.contract.quality_gate, 'blocking');

// Targeted edit on existing project → edit.
r = contractFor('ajoute un bouton de déconnexion dans le header', { hasFiles: true });
assert.equal(r.decision.action, 'edit');
assert.equal(r.contract.mode, 'edit');
assert.equal(r.contract.can_mutate_files, true);

// Critical action → contract requires confirmation.
r = contractFor('publie le projet en production', { hasFiles: true });
assert.equal(r.decision.action, 'critical_action');
assert.equal(r.contract.mode, 'critical_action');
assert.equal(r.contract.requires_confirmation, true);

// Bare action with no project → clarify on both layers.
r = contractFor('corrige', { hasFiles: false });
assert.equal(r.decision.action, 'clarify');
assert.equal(r.contract.mode, 'clarify');
assert.equal(r.contract.requires_clarification, true);
assert.equal(r.contract.can_mutate_files, false);

// Confidence carried through into the contract.
r = contractFor('crée une landing page pour mon café', { hasFiles: false });
assert.ok(r.contract.confidence > 0 && r.contract.confidence <= 1);

console.log('test-decision-bridge passed');
