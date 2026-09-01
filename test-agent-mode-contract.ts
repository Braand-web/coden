import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const serverSource = readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
assert.match(
  serverSource,
  /if \(!agentIntentNeedsAiRouter\(fallback\)\) \{\s*return safeFallback\(/,
  'Explicit Plan mode must resolve through the validated server decision instead of failing on a null AI decision.',
);
assert.match(
  serverSource,
  /\[coden:agent_router_fallback\]/,
  'Intent provider failures must be observable and recover through the guarded server decision.',
);
assert.doesNotMatch(
  serverSource,
  /A live AI provider is required for agent decisions\. No local intent fallback is available\./,
  'A classifier outage must not make every Coden mode unavailable.',
);

console.log('agent mode contract tests passed');
