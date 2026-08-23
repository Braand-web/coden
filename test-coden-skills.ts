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
console.log('coden skills tests passed');
