import assert from 'node:assert/strict';
import { applyAgentStreamEvent, createAgentRunViewModel } from './src/services/agent-run-store.ts';
import type { CodenStreamEvent } from './src/lib/stream-protocol.ts';

const event = <T extends CodenStreamEvent>(value: T) => value;
const base = { v: 'coden-stream-v2' as const, runId: 'run_test', ts: Date.now() };
let state = createAgentRunViewModel({ runId: 'run_test', prompt: 'Créer une app', requestedMode: 'plan', model: 'test-model' });

state = applyAgentStreamEvent(state, event({ ...base, id: 1, sequence: 1, type: 'mode_requested', mode: 'plan' }));
state = applyAgentStreamEvent(state, event({ ...base, id: 2, sequence: 2, type: 'mode_resolved', mode: 'plan', action: 'plan', confidence: 0.98 }));
assert.equal(state.resolvedAction, 'plan');

state = applyAgentStreamEvent(state, event({ ...base, id: 3, sequence: 3, type: 'understanding', summary: 'Créer une application', requirements: ['Une page principale'] }));
assert.equal(state.status, 'understanding');
assert.equal(state.objective?.summary, 'Créer une application');

state = applyAgentStreamEvent(state, event({ ...base, id: 4, sequence: 4, type: 'plan', steps: [{ id: 'step-1', title: 'Créer la page', kind: 'create' }] }));
assert.equal(state.status, 'awaiting_confirmation');
assert.equal(state.plan?.status, 'ready');
assert.equal(state.plan?.steps[0]?.state, 'pending');
assert.equal(state.files.length, 0);

state = applyAgentStreamEvent(state, event({ ...base, id: 5, sequence: 5, type: 'assistant_delta', text: 'Résumé généré.' }));
assert.equal(state.assistantText, 'Résumé généré.');

state = applyAgentStreamEvent(state, event({ ...base, id: 6, sequence: 6, type: 'done', payload: { success: true } }));
// A Plan remains awaiting confirmation; a terminal event cannot silently turn
// a non-mutating plan into a completed build.
assert.equal(state.status, 'awaiting_confirmation');
assert.equal(state.hasFinal, true);

console.log('agent run state tests passed');
