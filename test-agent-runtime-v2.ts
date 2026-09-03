import assert from 'node:assert/strict';
import {
  appendVerifiedFact,
  assertAgentModelCapabilities,
  canPublishFromVerification,
  createFactLedger,
  finalizeFactLedger,
  responseContradictions,
  validateModelDecision,
} from './src/services/agent-runtime-v2.ts';

const decision = validateModelDecision({
  action: 'build',
  confidence: 0.93,
  requiredCapabilities: ['structuredOutput', 'streaming', 'toolCalling'],
  objective: {
    goal: 'Create the requested application',
    scope: { included: ['the requested screen'], excluded: ['billing'] },
    constraints: ['preserve existing routes'],
    assumptions: ['the current workspace is authoritative'],
    acceptanceCriteria: ['the build must pass'],
    risk: 'medium',
  },
});
assert.equal(decision.action, 'build');
assert.throws(() => validateModelDecision({ action: 'build', confidence: 0.5 }), /objective/i);
assert.throws(() => validateModelDecision({ action: 'build', confidence: 2, objective: {} }), /confidence/i);

const ledger = createFactLedger('run_test');
appendVerifiedFact(ledger, {
  type: 'preview_verified',
  value: { status: 'verified' },
  source: 'preview',
});
assert.equal(canPublishFromVerification(ledger.status), false);
finalizeFactLedger(ledger, 'complete');
assert.equal(canPublishFromVerification('verified'), true);
assert.equal(ledger.facts.length, 1);
const emptyLedger = createFactLedger('run_empty');
assert.deepEqual(responseContradictions('The preview is ready and published online.', emptyLedger), ['preview readiness', 'deployment']);
assert.deepEqual(responseContradictions('The preview is not verified yet.', emptyLedger), []);
assert.deepEqual(responseContradictions("L'application n'est pas publiée.", emptyLedger), []);
assert.deepEqual(responseContradictions('The tests passed.', ledger), ['test success']);

assert.doesNotThrow(() => assertAgentModelCapabilities('anthropic/claude-fable-5.1:batch', { structuredOutput: true }));
assert.throws(() => assertAgentModelCapabilities('not-a-model', { structuredOutput: true }), /not allowed/i);

console.log('agent runtime v2 tests passed');
