import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The reviewer, and what its runs leave behind.
 *
 * The sandbox, the validation and the harness store are all real — only the
 * model turn is stubbed, since what's under test is Coden's own composition
 * (validate -> maybe repair -> record), not a language model's judgement.
 *
 * The harness persistence used to have no writer at all: the harness was
 * instantiated per request only to mirror SSE events into a journal, so a
 * Thread's Turn carried no record of what a review actually found or did.
 * These tests are on that record: a real HarnessItem per repair round,
 * nested under one HarnessItem for the review, using the harness's own
 * bookkeeping methods (spawnSubagent/createItem/completeSubagent) rather
 * than the dead startTool/assertAllowed dispatch layer.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-reviewer-test-${process.pid}`);

const { runReviewerAgent } = await import('./src/services/reviewer-agent.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { STARTERS, applyStarter } = await import('./src/services/sandbox/starters.ts');
const { CodenAgentHarness } = await import('./src/services/agent-harness/harness.ts');
const { InMemoryAgentHarnessStore } = await import('./src/services/agent-harness/store.ts');

const BROKEN_APP = "import { create } from 'zustand';\n\nconst useStore = create(() => ({ n: 0 }));\n\nexport default function App() {\n  const { n } = useStore();\n  return <h1 className=\"text-xl\">{n}</h1>;\n}\n";
const FIXED_APP = 'export default function App() {\n  return <h1 className="text-xl">Fixed</h1>;\n}\n';

async function brokenSandbox(id: string) {
  const sandbox = new ProjectSandbox(id);
  const project = applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: BROKEN_APP }]);
  await sandbox.writeFiles(project.files);
  assert.ok((await sandbox.install()).ok);
  return sandbox;
}

async function harnessWithTurn() {
  const store = new InMemoryAgentHarnessStore();
  const harness = new CodenAgentHarness(store);
  const thread = await harness.createThread({ organizationId: 'org-1', projectId: 'proj-1', userId: 'user-1' });
  const { turn } = await harness.createTurn({ threadId: thread.id, userId: 'user-1', prompt: 'fix it', idempotencyKey: `key-${Math.random()}` });
  return { store, harness, threadId: thread.id, turnId: turn.id };
}

const sandboxes: InstanceType<typeof ProjectSandbox>[] = [];
try {
  // -- a project that already validates is not reviewed further -----------
  {
    const sandbox = new ProjectSandbox('reviewer-healthy');
    sandboxes.push(sandbox);
    await sandbox.writeFiles(applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: FIXED_APP }]).files);
    assert.ok((await sandbox.install()).ok);
    let turns = 0;
    const outcome = await runReviewerAgent({ sandbox, turn: async () => { turns += 1; return { toolCalls: 0 }; } });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.repaired, false);
    assert.equal(turns, 0, 'a healthy project must cost no model call');
  }

  // -- a broken project is repaired, and without a harness context works fine
  {
    const sandbox = await brokenSandbox('reviewer-no-harness');
    sandboxes.push(sandbox);
    const outcome = await runReviewerAgent({
      sandbox,
      turn: async () => { await sandbox.writeFiles([{ path: 'src/App.tsx', content: FIXED_APP }]); return { toolCalls: 1 }; },
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.repaired, true);
    assert.equal(outcome.repairOutcome?.stoppedBecause, 'fixed');
  }

  // -- with a harness context, the review and each round are persisted -----
  {
    const sandbox = await brokenSandbox('reviewer-persists-success');
    sandboxes.push(sandbox);
    const { store, harness, threadId, turnId } = await harnessWithTurn();

    const outcome = await runReviewerAgent({
      sandbox,
      turn: async () => { await sandbox.writeFiles([{ path: 'src/App.tsx', content: FIXED_APP }]); return { toolCalls: 1 }; },
      harnessContext: { harness, threadId, turnId },
    });
    assert.equal(outcome.ok, true);

    const turn = await store.getTurn(turnId);
    assert.equal(turn?.budgetUsed.subagents, 1, 'the review must be recorded as one harness subagent');

    // Find the subagent item and its nested round item directly through the
    // store, independent of any particular reader — this is the point of
    // persisting it: queryable without the UI that happened to be open.
    const events = await store.listEvents(threadId);
    const subagentSpawned = events.find(event => event.type === 'subagent.spawned');
    assert.ok(subagentSpawned, 'a subagent.spawned event must exist');
    assert.equal((subagentSpawned!.payload as any).role, 'reviewer');

    // `harness.createTurn` creates its own 'user_message' item as a side
    // effect, which also satisfies "an item.completed that is not the
    // subagent" — filtering on the round's own kind is what actually
    // isolates it.
    const roundCreated = events.find(event => event.type === 'item.completed' && (event.payload as any)?.kind === 'verification');
    assert.ok(roundCreated, 'the repair round must be recorded as its own item');
    const roundItem = await store.getItem(roundCreated!.itemId!);
    assert.equal(roundItem?.kind, 'verification');
    assert.equal(roundItem?.parentItemId, subagentSpawned!.itemId, 'the round must nest under the review, not float free');
    assert.equal((roundItem?.payload as any).errorsAfter, 0);

    const subagentCompleted = events.find(event => event.type === 'subagent.completed');
    assert.ok(subagentCompleted, 'the review itself must be marked completed, not left running forever');
  }

  // -- and a review that fails to converge is recorded as failed, not silently
  {
    const sandbox = await brokenSandbox('reviewer-persists-failure');
    sandboxes.push(sandbox);
    const { store, harness, threadId, turnId } = await harnessWithTurn();

    const outcome = await runReviewerAgent({
      sandbox,
      maxRounds: 2,
      turn: async () => ({ toolCalls: 0 }), // never actually fixes anything
      harnessContext: { harness, threadId, turnId },
    });
    assert.equal(outcome.ok, false);

    const events = await store.listEvents(threadId);
    const failed = events.find(event => event.type === 'item.failed' && (event.payload as any)?.reason === 'no_progress');
    assert.ok(failed, 'a review that gives up must be recorded as failed, with the real reason');
  }

  // -- a broken harness context must not break the review itself ----------
  // Recording is degraded, never the review: a harness write can fail on its
  // own terms (an unknown turn, a store outage), and none of those are
  // reasons to skip actually fixing the user's broken project.
  {
    const sandbox = await brokenSandbox('reviewer-store-failure-tolerated');
    sandboxes.push(sandbox);
    const { harness, threadId } = await harnessWithTurn();
    // A turnId that does not exist makes spawnSubagent throw internally.
    const outcome = await runReviewerAgent({
      sandbox,
      turn: async () => { await sandbox.writeFiles([{ path: 'src/App.tsx', content: FIXED_APP }]); return { toolCalls: 1 }; },
      harnessContext: { harness, threadId, turnId: 'turn_does_not_exist' },
    });
    assert.equal(outcome.ok, true, 'the repair must succeed even though the harness could not record it');
    assert.equal(outcome.repairOutcome?.stoppedBecause, 'fixed');
  }

  // -- the harness decision this stage made is pinned, not just implied -----
  // `harness.startTool`/`tools.assertAllowed` are the dead dispatch layer
  // Stage 6 retires; recording must go through spawnSubagent/createItem —
  // the harness's own bookkeeping methods — instead.
  const source = (await import('node:fs')).readFileSync('./src/services/reviewer-agent.ts', 'utf8');
  assert.ok(!source.includes('.startTool('), 'the reviewer must not dispatch through the unused tool registry');
  assert.ok(!source.includes('assertAllowed'), 'the reviewer must not depend on the dead enforcement layer');
  assert.match(source, /spawnSubagent/, 'the reviewer must record itself as a harness subagent');

  console.log('reviewer agent tests passed');
} finally {
  for (const sandbox of sandboxes) await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
