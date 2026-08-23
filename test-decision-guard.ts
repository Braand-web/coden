import assert from 'node:assert/strict';
import { decideCodenAction, type CodenDecision } from './src/services/decision-core.ts';
import { guardDecision, isActionableWithoutUser } from './src/services/decision-guard.ts';

// Healthy decisions from the core must pass the guard unchanged.
for (const sample of [
  { prompt: 'bonjour', project: {} },
  { prompt: 'ajoute un bouton', project: { hasFiles: true } },
  { prompt: 'crée une landing page', project: {} },
  { prompt: 'publie en prod', project: { hasFiles: true } },
  { prompt: 'corrige', project: { hasFiles: false } },
]) {
  const decision = decideCodenAction(sample);
  const guarded = guardDecision(decision, sample.project);
  assert.equal(guarded.violations.filter(v => v.severity === 'fix').length, 0, `core decision for "${sample.prompt}" should already be coherent (${guarded.violations.map(v => v.code).join(',')})`);
}

function base(overrides: Partial<CodenDecision>): CodenDecision {
  const seed = decideCodenAction({ prompt: 'bonjour' });
  return { ...seed, ...overrides };
}

// 1. Critical action missing confirmation → fixed.
let g = guardDecision(base({ action: 'critical_action', needs_confirmation: false, confidence: 0.9, band: 'act' }));
assert.equal(g.decision.needs_confirmation, true);
assert.ok(g.violations.some(v => v.code === 'critical_needs_confirmation'));
assert.equal(g.changed, true);

// 2. Non-mutating action wrongly marked mutating → fixed.
g = guardDecision(base({ action: 'chat', mutates_files: true, confidence: 0.9, band: 'act' }));
assert.equal(g.decision.mutates_files, false);
assert.equal(g.decision.credit_policy, 'free');
assert.ok(g.violations.some(v => v.code === 'non_mutating_marked_mutating'));

// 3. Edit/debug without a project → downgraded to clarify with a question.
g = guardDecision(base({ action: 'edit', mutates_files: true, confidence: 0.85, band: 'act' }), { hasFiles: false });
assert.equal(g.decision.action, 'clarify');
assert.equal(g.decision.mutates_files, false);
assert.ok(g.decision.clarifying_question && g.decision.clarifying_question.length > 0);
assert.ok(g.violations.some(v => v.code === 'edit_without_project'));

g = guardDecision(base({ action: 'debug', mutates_files: true, confidence: 0.85, band: 'act' }), { fileCount: 3 });
assert.equal(g.decision.action, 'debug', 'debug is allowed when a project exists');

// 4. Clarify without a question → filled.
g = guardDecision(base({ action: 'clarify', clarifying_question: undefined, confidence: 0.4, band: 'clarify' }));
assert.ok(g.decision.clarifying_question);
assert.ok(g.violations.some(v => v.code === 'clarify_without_question'));

// 5. Confidence out of range → clamped, band recomputed.
g = guardDecision(base({ action: 'build', confidence: 1.7, band: 'act', mutates_files: true }));
assert.ok(g.decision.confidence <= 1 && g.decision.confidence >= 0);
assert.ok(g.violations.some(v => v.code === 'confidence_out_of_range'));

// 6. Band mismatch → corrected to match confidence.
g = guardDecision(base({ action: 'build', confidence: 0.6, band: 'act', mutates_files: true }));
assert.equal(g.decision.band, 'act_with_assumptions');
assert.ok(g.violations.some(v => v.code === 'band_mismatch'));

// 7. Assumptions outside medium band → stripped.
g = guardDecision(base({ action: 'build', confidence: 0.95, band: 'act', assumptions: ['x'], mutates_files: true }));
assert.equal(g.decision.assumptions.length, 0);
assert.ok(g.violations.some(v => v.code === 'assumptions_outside_band'));

// isActionableWithoutUser
assert.equal(isActionableWithoutUser(base({ action: 'build' })), true);
assert.equal(isActionableWithoutUser(base({ action: 'clarify' })), false);
assert.equal(isActionableWithoutUser(base({ action: 'critical_action' })), false);
assert.equal(isActionableWithoutUser(base({ action: 'refuse_redirect' })), false);

console.log('test-decision-guard passed');
