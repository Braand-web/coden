import assert from 'node:assert/strict';
import { capSubagentCount, getCodenSkillBudget, getCodenSkill, isCriticalCodenAction, readCodenSkillFeatureFlags, resolveCodenSkill } from './src/services/coden-skills.ts';

assert.equal(resolveCodenSkill({ prompt: 'corrige le bug de preview', intent: 'debug_fix' }).skill.id, 'debug');
assert.equal(resolveCodenSkill({ prompt: 'fais un audit de sécurité avec RLS', intent: 'review' }).skill.id, 'security');
assert.equal(resolveCodenSkill({ prompt: 'publie cette application', intent: 'deploy' }).requiresConfirmation, true);
assert.equal(isCriticalCodenAction('push to git'), true);
assert.equal(isCriticalCodenAction('change the button color'), false);
assert.equal(getCodenSkill('build')?.allowedTools.includes('write_file'), true);
assert.equal(getCodenSkill('review')?.allowedTools.includes('write_file'), false);
assert.ok(getCodenSkillBudget(getCodenSkill('build')!, 'free').maxTokens < getCodenSkillBudget(getCodenSkill('build')!, 'scale').maxTokens);
assert.equal(capSubagentCount(10), 3);
assert.equal(capSubagentCount(10, { skills: true, workflows: true, subagents: false, scheduledRuns: false }), 0);
assert.deepEqual(readCodenSkillFeatureFlags({ CODEN_SKILLS_ENABLED: 'false', CODEN_SCHEDULED_RUNS_ENABLED: 'true' }), { skills: false, workflows: true, subagents: true, scheduledRuns: true });
/*
 * A build must be governed by the build skill.
 *
 * It was not. `'build'` contains `'ui'`, `'ui'` is one of the review skill's
 * intent tokens, and the matcher used plain `includes` — so both skills scored
 * 4, the tie broke on PRIORITY where `build` sits last and `review` fifth, and
 * every build in production came back `matched_review` at 87% confidence.
 *
 * The consequence is not cosmetic: `review` is read-only, sets
 * `requiresVerification: false`, and grants one repair retry where `build`
 * grants three. 33 of 46 recorded runs — the product's main path — ran under
 * a third of their repair budget.
 */
for (const prompt of [
  'cree une mini app web de to do list',
  'fais moi une landing page pour vendre un produit',
  'construis une interface ui propre et responsive',
  'build me a calculator',
]) {
  const resolution = resolveCodenSkill({ prompt, intent: 'build', requestedMode: 'auto' });
  assert.equal(resolution.skill.id, 'build', `a build must not be run as ${resolution.skill.id}: ${prompt}`);
  assert.equal(resolution.skill.budget.maxRetries, 3, 'a build keeps its three repair rounds');
  assert.equal(resolution.skill.requiresVerification, true, 'a build must be verified');
}

// The declared intent decides; prompt wording only breaks ties it leaves open.
assert.equal(resolveCodenSkill({ prompt: 'change la couleur du bouton', intent: 'edit' }).skill.id, 'build');
assert.equal(resolveCodenSkill({ prompt: 'revois l ux de mon application', intent: 'review' }).skill.id, 'review');
assert.equal(resolveCodenSkill({ prompt: 'regarde le bug du preview', intent: 'debug_fix' }).skill.id, 'debug');
assert.equal(resolveCodenSkill({ prompt: 'publie en production', intent: 'deploy' }).skill.id, 'release');
// Asking to build something that has authentication is still a build, not an audit.
assert.equal(resolveCodenSkill({ prompt: 'ajoute une authentification avec RLS', intent: 'build' }).skill.id, 'build');

// A token must match a word, never a fragment of one.
assert.notEqual(resolveCodenSkill({ prompt: 'aujourd hui je veux un produit qui construit vite', intent: 'build' }).skill.id, 'review');

console.log('coden skills tests passed');
