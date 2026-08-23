import assert from 'node:assert/strict';
import {
  canTransitionAgentRun,
  creditPolicyFor,
  normalizeAgentMode,
  runStatusLabel,
} from './src/services/agent-run-contract.ts';

assert.equal(normalizeAgentMode('plan'), 'plan');
assert.equal(normalizeAgentMode('unknown'), 'auto');
assert.equal(creditPolicyFor('plan'), 'plan-reduced');
assert.equal(creditPolicyFor('build'), 'build');
assert.equal(runStatusLabel('awaiting_confirmation', 'fr'), 'Confirmation requise');
assert.equal(canTransitionAgentRun('planning', 'awaiting_confirmation'), true);
assert.equal(canTransitionAgentRun('awaiting_confirmation', 'executing'), true);
assert.equal(canTransitionAgentRun('completed', 'executing'), false);
assert.equal(canTransitionAgentRun('cancelled', 'completed'), false);

console.log('agent mode contract tests passed');
