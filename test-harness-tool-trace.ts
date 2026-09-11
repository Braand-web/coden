import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  harnessToolForSandboxTool,
  recordToolCall,
  resourceKeysForSandboxTool,
} from './src/services/agent-harness/sandbox-tool-map.ts';
import { DEFAULT_HARNESS_BUDGET } from './src/services/agent-harness/contracts.ts';

/*
 * The harness knows what the agent did, not only that it ran.
 *
 * `startTool`, `completeTool` and `failTool` have been complete since the
 * harness was written and were called from nowhere. Production holds 112
 * `user_message` items, 56 `assistant_message`, 37 `subagent` and 36
 * `verification` — and zero `tool_call`, ever. The record could say a subagent
 * ran and never what it did: no trace to resume from, none to explain a run
 * with, none to debug one from.
 *
 * What kept them apart is vocabulary. The sandbox offers `read_file` and
 * `install_package`; the harness reasons about `workspace.read` and
 * `shell.exec` — categories carrying risk, roles and approval. Wiring them
 * directly would have thrown `Unknown harness tool: read_file` on the first
 * call of every run.
 */

// Every sandbox tool lands in the category that describes what it does.
{
  assert.equal(harnessToolForSandboxTool('read_file'), 'workspace.read');
  assert.equal(harnessToolForSandboxTool('list_files'), 'workspace.read');
  assert.equal(harnessToolForSandboxTool('search_files'), 'workspace.search');
  assert.equal(harnessToolForSandboxTool('write_file'), 'workspace.patch');
  assert.equal(harnessToolForSandboxTool('edit_file'), 'workspace.patch');
  assert.equal(harnessToolForSandboxTool('delete_file'), 'workspace.patch');
  assert.equal(harnessToolForSandboxTool('run_command'), 'shell.exec');
  assert.equal(harnessToolForSandboxTool('install_package'), 'shell.exec');
  assert.equal(harnessToolForSandboxTool('get_logs'), 'browser.inspect');

  // An unmapped tool records nothing rather than being guessed into a
  // category: calling a write a read would defeat the locking this exists for.
  assert.equal(harnessToolForSandboxTool('some_future_tool'), null);
}

/*
 * Only a write claims a file.
 *
 * A read that claimed its file would block the write that follows it, and
 * reading before writing is the behaviour worth encouraging.
 */
{
  assert.deepEqual(resourceKeysForSandboxTool('write_file', { path: 'src/App.tsx' }), ['file:src/App.tsx']);
  assert.deepEqual(resourceKeysForSandboxTool('edit_file', { path: 'src/App.tsx' }), ['file:src/App.tsx']);
  assert.deepEqual(resourceKeysForSandboxTool('read_file', { path: 'src/App.tsx' }), []);
  assert.deepEqual(resourceKeysForSandboxTool('run_command', { command: 'npm' }), []);
}

/** A harness double that records what it was asked, and can be made to fail. */
function fakeHarness(options: { failStart?: boolean } = {}) {
  const calls: Array<{ op: string; toolName?: string; resourceKeys?: string[]; payload?: any; error?: string; output?: any }> = [];
  let n = 0;
  return {
    calls,
    harness: {
      async startTool(input: any) {
        if (options.failStart) throw new Error('Harness tool-call budget exhausted.');
        calls.push({ op: 'start', toolName: input.toolName, resourceKeys: input.resourceKeys, payload: input.payload });
        return { id: `item_${++n}` };
      },
      async completeTool(itemId: string, output: any) { calls.push({ op: 'complete', output }); return itemId; },
      async failTool(itemId: string, error: string) { calls.push({ op: 'fail', error }); return itemId; },
    },
  };
}

const CTX = { turnId: 'turn_1', role: 'integrator' as const };

// A successful call opens an item and closes it.
{
  const { harness, calls } = fakeHarness();
  const result = await recordToolCall(harness as any, CTX, { name: 'write_file', args: { path: 'src/App.tsx' } }, async () => ({ ok: true }));
  assert.deepEqual(result, { ok: true });
  assert.equal(calls[0].op, 'start');
  assert.equal(calls[0].toolName, 'workspace.patch');
  assert.deepEqual(calls[0].resourceKeys, ['file:src/App.tsx']);
  // The category says a file changed; the concrete tool says how, and a trace
  // that cannot tell an edit from a rewrite cannot explain a regression.
  assert.equal(calls[0].payload.sandboxTool, 'write_file');
  assert.equal(calls[1].op, 'complete');
}

// A throwing tool closes the item as failed, and the error still reaches the loop.
{
  const { harness, calls } = fakeHarness();
  await assert.rejects(
    () => recordToolCall(harness as any, CTX, { name: 'run_command', args: {} }, async () => { throw new Error('npm exploded'); }),
    /npm exploded/,
    'the failure must still reach the caller that has to handle it',
  );
  assert.equal(calls[1].op, 'fail');
  assert.match(calls[1].error!, /npm exploded/);
}

/*
 * Bookkeeping can never fail the run.
 *
 * `startTool` throws when the turn's budget is spent. Left unguarded that
 * throw escapes the tool handler, fails the round and ends the generation —
 * the record breaking the thing it exists to describe. The run is the product;
 * the trace is how it is explained afterwards, and an explanation is never
 * worth the thing it explains.
 */
{
  const { harness, calls } = fakeHarness({ failStart: true });
  const result = await recordToolCall(harness as any, CTX, { name: 'write_file', args: { path: 'a.ts' } }, async () => ({ ok: true }));
  assert.deepEqual(result, { ok: true }, 'a harness that refuses must not stop the tool');
  assert.equal(calls.length, 0);
}

// With no harness at all the loop behaves exactly as before.
{
  assert.deepEqual(await recordToolCall(null, null, { name: 'read_file', args: {} }, async () => ({ ok: true })), { ok: true });
}

/*
 * The budget describes what the pipeline actually does.
 *
 * 48 was written before `budgetForRoute` existed: `new_project` allows eight
 * rounds of forty calls, so it was not a ceiling but a point a third of the
 * way through a normal build. It never bit because nothing charged it; now
 * that every call is recorded it would, truncating the record of a legitimate
 * run so that it looks like the run stopped.
 */
{
  assert.ok(DEFAULT_HARNESS_BUDGET.maxToolCalls >= 320, 'the ceiling must clear the most generous route (8 rounds x 40 calls)');
  assert.ok(DEFAULT_HARNESS_BUDGET.maxRepairAttempts >= 8, 'and the rounds the coder loop is actually given');
}

/*
 * The plan is recorded as a plan, by the planner.
 *
 * `plan` is a declared item kind that no row has ever carried, and the
 * `planner` role exists in the registry precisely so this step is attributed
 * to something other than the agent that writes the files. Without it the
 * record showed a build appearing out of nothing, though a real model call
 * with its own cost and its own failure mode produced it.
 */
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  const planning = pipeline.slice(pipeline.indexOf('plan = await runPlannerAgent({'), pipeline.indexOf('const launchFiles'));

  assert.match(planning, /kind: 'plan'/, 'the plan must be recorded as a plan');
  assert.match(planning, /role: 'planner'/, 'attributed to the planner, not the agent that writes files');
  assert.match(planning, /payload: \{ files: plan\.files, risks: plan\.risks/, 'with the files and risks it committed to');

  // Recorded after the call, not around it: a harness failure must not cost a
  // plan a model was already paid for.
  assert.match(planning, /\.catch\(\(error: any\) => console\.info\('\[coden:harness_plan_unrecorded\]'/, 'and never at the plan\'s expense');
}

// And it is wired where the tool calls happen.
{
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /const result = await recordToolCall\(/, 'every tool call must pass through the recorder');
  assert.match(pipeline, /harness: ctx\?\.harness/, 'the coder turn must receive the harness');
  assert.match(pipeline, /role: 'integrator' as const/, 'as the role that owns workspace.patch and shell.exec');

  // One source of truth for the budget, so the two stores cannot drift apart
  // from the contract again.
  for (const store of ['./src/services/agent-harness/store.ts', './src/services/agent-harness/supabase-store.ts']) {
    const source = readFileSync(new URL(store, import.meta.url), 'utf8');
    assert.match(source, /budget: \{ \.\.\.DEFAULT_HARNESS_BUDGET, \.\.\.input\.budget \}/, `${store} must not restate the defaults`);
  }
}

console.log('harness tool trace tests passed');
