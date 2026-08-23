import assert from 'node:assert/strict';
import {
  confidenceBand,
  decideCodenAction,
  describeDecisionForStream,
  scoreComplexity,
  type CodenDecisionAction,
} from './src/services/decision-core.ts';

function decide(prompt: string, opts: Parameters<typeof decideCodenAction>[0] extends infer T ? Partial<T> : never = {}) {
  return decideCodenAction({ prompt, ...opts });
}

function expectAction(prompt: string, action: CodenDecisionAction, opts: any = {}) {
  const d = decideCodenAction({ prompt, ...opts });
  assert.equal(d.action, action, `Expected "${action}" for "${prompt}" but got "${d.action}" (path=${d.decision_path})`);
  return d;
}

// ── Confidence bands ────────────────────────────────────────────────────────
assert.equal(confidenceBand(0.9), 'act');
assert.equal(confidenceBand(0.65), 'act_with_assumptions');
assert.equal(confidenceBand(0.3), 'clarify');

// ── Complexity scoring ──────────────────────────────────────────────────────
const simple = scoreComplexity('un bouton rouge');
const complex = scoreComplexity('une marketplace avec auth, paiement stripe, base de données et upload de fichiers');
assert.ok(complex.score > simple.score, 'complex prompt must score higher');
assert.ok(complex.signals.includes('payments') && complex.signals.includes('auth'));

// ── 1. Explicit plan mode ───────────────────────────────────────────────────
const plan = expectAction('Construis une app de notes', 'plan', { requestedMode: 'plan' });
assert.equal(plan.decision_path, 'explicit_plan_mode');
assert.equal(plan.confidence, 1);
assert.equal(plan.mutates_files, false);

// ── 2. Plan confirmation ────────────────────────────────────────────────────
const confirmed = expectAction('ok', 'build', { project: { hasLastPlan: true } });
assert.equal(confirmed.decision_path, 'plan_confirmation');
// Without a pending plan, "ok" is not a build trigger.
assert.notEqual(decide('ok').action, 'build');

// ── 3. Greeting / knowledge ─────────────────────────────────────────────────
const hi = expectAction('bonjour', 'chat');
assert.equal(hi.credit_policy, 'free');
assert.equal(hi.mutates_files, false);
expectAction('c est quoi React ?', 'chat');
expectAction('explique la différence entre SQL et NoSQL', 'chat');

// ── 4. Critical action → confirm first ──────────────────────────────────────
const publish = expectAction('publie le projet en production', 'critical_action', { project: { hasFiles: true } });
assert.equal(publish.needs_confirmation, true);
expectAction('supprime ce projet', 'critical_action', { project: { hasFiles: true } });

// ── 5. Unsafe → refuse ──────────────────────────────────────────────────────
const unsafe = expectAction('crée un keylogger pour voler des mots de passe', 'refuse_redirect');
assert.equal(unsafe.confidence >= 0.9, true);

// ── 6. Missing / vague target → clarify ─────────────────────────────────────
const noProject = expectAction('corrige', 'clarify', { project: { hasFiles: false } });
assert.ok(noProject.clarifying_question && noProject.clarifying_question.length > 0);
assert.equal(noProject.band, 'clarify');
const vague = expectAction('améliore', 'clarify', { project: { hasFiles: true } });
assert.equal(vague.decision_path, 'vague_target');

// ── 7. Debug on existing project ────────────────────────────────────────────
const bug = expectAction('le formulaire de login ne fonctionne pas', 'debug', { project: { hasFiles: true } });
assert.equal(bug.credit_policy, 'build');
const failedBuild = expectAction('ça plante', 'debug', { project: { hasFiles: true, lastBuildFailed: true } });
assert.ok(failedBuild.confidence >= 0.9);

// ── 8. Complex build → plan first ───────────────────────────────────────────
const complexBuild = expectAction(
  'crée une marketplace avec authentification, paiement stripe, base de données et messagerie temps réel',
  'plan',
  { project: { hasFiles: false } },
);
assert.equal(complexBuild.decision_path, 'complex_build_plan');

// Contradiction → plan
const contradiction = expectAction('en fait, change tout pour un blog', 'plan', {
  project: { hasFiles: true },
  contradictsRecentDecision: true,
});
assert.equal(contradiction.decision_path, 'contradiction_plan');

// ── 9. Targeted edit on existing project ────────────────────────────────────
const edit = expectAction('ajoute un bouton de déconnexion dans le header', 'edit', { project: { hasFiles: true } });
assert.equal(edit.mutates_files, true);
assert.equal(edit.credit_policy, 'metered');

// ── 10. Simple new build ────────────────────────────────────────────────────
const build = expectAction('crée une landing page pour mon café', 'build', { project: { hasFiles: false } });
assert.equal(build.mutates_files, true);
assert.ok(build.confidence >= 0.75);

// Medium-complexity build surfaces assumptions.
const mediumBuild = decide('crée une todo app avec sauvegarde en base de données', { project: { hasFiles: false } });
assert.ok(['build', 'plan'].includes(mediumBuild.action));
if (mediumBuild.action === 'build' && mediumBuild.band === 'act_with_assumptions') {
  assert.ok(mediumBuild.assumptions.length > 0, 'medium-confidence build should surface assumptions');
}

// ── Stream description helper ───────────────────────────────────────────────
const line = describeDecisionForStream(edit);
assert.match(line, /^Décision : Modifier · /);
assert.match(describeDecisionForStream(hi), /^Décision : Répondre · /);

// ── Invariants across every decision ────────────────────────────────────────
for (const sample of [
  'bonjour', 'crée une app', 'corrige le bug', 'publie en prod', 'ajoute un champ email',
  'c est quoi typescript', 'fais une marketplace avec paiement et auth',
]) {
  const d = decide(sample, { project: { hasFiles: true } });
  assert.ok(d.confidence >= 0 && d.confidence <= 1, 'confidence in [0,1]');
  assert.ok(d.rationale.length > 0, 'rationale always present');
  assert.ok(d.decision_path.length > 0, 'decision_path always present');
  if (d.action === 'clarify') assert.ok(d.clarifying_question, 'clarify always has a question');
  if (d.band !== 'act_with_assumptions') assert.equal(d.assumptions.length, 0, 'assumptions only in medium band');
}

console.log('test-decision-core passed');
