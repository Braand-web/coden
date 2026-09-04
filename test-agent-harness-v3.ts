import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CodenAgentHarness,
  HarnessToolRegistry,
  InMemoryAgentHarnessStore,
  buildDefinitionOfDone,
  createHarnessTurnIdempotencyKey,
} from './src/services/agent-harness/index.ts';

const store = new InMemoryAgentHarnessStore();
const harness = new CodenAgentHarness(store, new HarnessToolRegistry());

const thread = await harness.createThread({ organizationId: 'org_1', projectId: 'project_1', userId: 'user_1', title: 'CRM mission' });
assert.equal(thread.status, 'active');

const idempotencyKey = createHarnessTurnIdempotencyKey({ userId: 'user_1', projectId: 'project_1', requestId: 'request_1' });
const first = await harness.createTurn({
  threadId: thread.id,
  userId: 'user_1',
  prompt: 'Crée un CRM full-stack avec pipeline et import CSV.',
  requestedMode: 'build',
  idempotencyKey,
});
assert.equal(first.created, true);
const duplicate = await harness.createTurn({
  threadId: thread.id,
  userId: 'user_1',
  prompt: 'This duplicate must not create a second turn.',
  requestedMode: 'build',
  idempotencyKey,
});
assert.equal(duplicate.created, false);
assert.equal(duplicate.turn.id, first.turn.id);

await harness.transitionTurn(first.turn.id, 'running');
const instruction = await harness.steer({ turnId: first.turn.id, userId: 'user_1', text: 'Ajoute aussi un import CSV.' });
assert.equal(instruction.status, 'pending');
assert.deepEqual((await harness.consumePendingInstructions(first.turn.id)).map(item => item.text), ['Ajoute aussi un import CSV.']);
assert.equal((await store.listPendingInstructions(first.turn.id)).length, 0);

const reader = await harness.startTool({ turnId: first.turn.id, role: 'explorer', toolName: 'workspace.read' });
await harness.completeTool(reader.id, { files: 12 });
const writer = await harness.startTool({ turnId: first.turn.id, role: 'frontend', toolName: 'workspace.patch', resourceKeys: ['src/App.tsx'] });
await assert.rejects(
  harness.startTool({ turnId: first.turn.id, role: 'backend', toolName: 'workspace.patch', resourceKeys: ['src/App.tsx'] }),
  /already owned/,
);
await harness.completeTool(writer.id, { patchHash: 'sha256:test' });
const nextWriter = await harness.startTool({ turnId: first.turn.id, role: 'backend', toolName: 'workspace.patch', resourceKeys: ['src/App.tsx'] });
await harness.completeTool(nextWriter.id);

await assert.rejects(harness.startTool({ turnId: first.turn.id, role: 'explorer', toolName: 'deployment.publish' }), /cannot use/);
await assert.rejects(harness.startTool({ turnId: first.turn.id, role: 'orchestrator', toolName: 'deployment.publish' }), /requires explicit approval/);
const approval = await harness.requestApproval(first.turn.id, 'deployment.publish', 'Publish the verified artifact.');
assert.equal((await store.getTurn(first.turn.id))?.status, 'waiting_for_user');
await harness.resolveApproval(approval.id, true, 'user_1');
assert.equal((await store.getTurn(first.turn.id))?.status, 'running');
const publish = await harness.startTool({ turnId: first.turn.id, role: 'orchestrator', toolName: 'deployment.publish', approvalGranted: true });
await harness.completeTool(publish.id, { deploymentId: 'deployment_1' });

// The log is a sequence, not a bag: a replay that arrives out of order
// replays a different run. This used to be asserted through the public stream
// event API, which went with the streaming; the ordering guarantee it was
// really checking belongs to every event the harness records.
const logged = await store.listEvents(thread.id);
assert.ok(logged.length > 0, 'the run so far must have left a trail');
assert.deepEqual(logged.map(event => event.sequence), [...logged.map(event => event.sequence)].sort((a, b) => a - b));

await harness.saveCheckpoint(first.turn.id, { phase: 'testing', artifactHash: 'sha256:artifact' });
await harness.transitionTurn(first.turn.id, 'verifying');
await harness.transitionTurn(first.turn.id, 'completed', { verified: true });
assert.equal((await store.getThread(thread.id))?.activeTurnId, undefined);
await assert.rejects(harness.transitionTurn(first.turn.id, 'running'), /Invalid harness turn transition/);

// `buildDefinitionOfDone` is the one export of orchestrator.ts that is
// actually wired into production (server.ts, feeding harness.createTurn) —
// the DAG execution engine that used to sit alongside it never had a caller
// outside this file's own removed assertions.
const definitionOfDone = buildDefinitionOfDone({ prompt: 'Build a CRM', mode: 'build', hasBackend: true, hasDatabase: true });
assert.ok(definitionOfDone.some(item => item.id === 'backend_health'));
assert.ok(definitionOfDone.some(item => item.id === 'database'));
assert.deepEqual(buildDefinitionOfDone({ prompt: 'What does this do?', mode: 'ask' }).map(item => item.id), ['answer_complete']);

const cancelThread = await harness.createThread({ organizationId: 'org_1', projectId: 'project_2', userId: 'user_1' });
const cancelTurn = await harness.createTurn({ threadId: cancelThread.id, userId: 'user_1', prompt: 'Build', idempotencyKey: 'cancel_1' });
await harness.transitionTurn(cancelTurn.turn.id, 'running');
const signal = harness.signalForTurn(cancelTurn.turn.id);
await harness.cancelTurn(cancelTurn.turn.id, 'user_1');
assert.equal(signal.aborted, true);
assert.equal((await store.getTurn(cancelTurn.turn.id))?.status, 'cancelled');

// A cancelled run whose in-flight work rejects afterwards reports its failure
// late. Throwing on that race lost the event entirely — production logged
// "Invalid harness turn transition: cancelled -> failed" and nothing about the
// actual failure. The recorded outcome stands and the late one is kept.
const eventsBefore = (await store.listEvents(cancelThread.id)).length;
const afterLateFailure = await harness.transitionTurn(cancelTurn.turn.id, 'failed', { message: 'provider timed out' });
assert.equal(afterLateFailure.status, 'cancelled', 'the status that ended the turn must stand');
assert.equal((await store.getTurn(cancelTurn.turn.id))?.status, 'cancelled');
const eventsAfter = await store.listEvents(cancelThread.id);
assert.equal(eventsAfter.length, eventsBefore + 1, 'the late failure must still reach the log');
const late = eventsAfter[eventsAfter.length - 1];
assert.equal((late.payload as any)?.late_status, 'failed');
assert.equal((late.payload as any)?.recorded_status, 'cancelled');
assert.equal((late.payload as any)?.message, 'provider timed out');
assert.equal(late.visibility, 'technical', 'a late outcome is diagnostic, not user-facing');

// A genuinely invalid transition is still a programming error.
await assert.rejects(harness.transitionTurn(cancelTurn.turn.id, 'running'), /Invalid harness turn transition/);

const migration = fs.readFileSync(new URL('./supabase/migrations/20260831090000_coden_agent_harness_v3.sql', import.meta.url), 'utf8');
for (const table of ['agent_threads', 'agent_turns', 'agent_items', 'agent_harness_events', 'agent_instructions']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`, 'i'));
}
assert.match(migration, /grant select on table public\.agent_harness_events to authenticated/i);
assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on table public\.agent_harness_events to authenticated/i);
assert.match(migration, /kind in \('user_message', 'assistant_message', 'plan', 'approval'\)/i);
assert.match(migration, /visibility = 'public'/i);
assert.match(migration, /security invoker/i);
assert.match(migration, /unique \(thread_id, sequence\)/i);

console.log('agent harness v3 tests passed');
