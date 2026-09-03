import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { ProviderGateway } from './src/services/provider-gateway.ts';
import { runMultiAgentPipeline } from './src/services/multi-agent-pipeline.ts';
import { blendedCost } from './src/services/model-selection.ts';
import { CodenAgentHarness } from './src/services/agent-harness/harness.ts';
import { InMemoryAgentHarnessStore } from './src/services/agent-harness/store.ts';
import type { AllowedModelId } from './src/config/ai-models.ts';

/**
 * The pipeline that replaces the JSON-blob generator, composed and driven
 * against real infrastructure: a real sandbox, a real filesystem, a real
 * `npm install`. Only the model turn is stubbed — the planner's one chat call
 * and the coder's tool-calling steps — because what is under test is Coden's
 * own composition (route -> maybe plan -> sandbox -> build -> read files
 * back), not a language model's judgement.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-multi-agent-pipeline-test-${process.pid}`);
const { sandboxRegistry } = await import('./src/services/sandbox/sandbox-registry.ts');

type ScriptedResponse = { text: string; toolCall?: { name: string; args: Record<string, unknown> } };

/**
 * A provider that plays back a fixed script of responses in order — one per
 * model call, wherever in the pipeline that call comes from. The pipeline's
 * own call order is what determines which response answers which step,
 * exactly as the real provider would see one call at a time.
 *
 * Both `chat` and `streamChat` share the same script and cursor: the
 * planner's one-shot call always goes through `chat`, and the coder loop's
 * steps always go through `streamChat` now that `buildToolLoopTurn` streams
 * unconditionally (its `onToken` always forwards to the pipeline's own event
 * stream). `streamChat` plays its step back as the same events a real
 * provider would emit — one `token` carrying the whole step's text, then
 * `tool_calls` when the step scripts one, then `usage` — so it exercises the
 * exact reassembly `runLlmToolLoop`'s streaming path performs.
 */
function scriptedProvider(script: ScriptedResponse[]) {
  const chatCalls: Array<{ modelId: string }> = [];
  let index = 0;
  const nextStep = () => {
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    return { step, callIndex: index };
  };
  return {
    chatCalls,
    service: {
      async chat(modelId: string) {
        chatCalls.push({ modelId });
        const { step, callIndex } = nextStep();
        return {
          text: step.text,
          model: modelId,
          tool_calls: step.toolCall
            ? [{ id: `call_${callIndex}`, type: 'function' as const, function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) } }]
            : undefined,
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          cost_usd: 0,
        };
      },
      async *streamChat(modelId: string) {
        chatCalls.push({ modelId });
        const { step, callIndex } = nextStep();
        if (step.text) yield { type: 'token' as const, text: step.text, model: modelId };
        if (step.toolCall) {
          yield {
            type: 'tool_calls' as const,
            tool_calls: [{ id: `call_${callIndex}`, type: 'function' as const, function: { name: step.toolCall.name, arguments: JSON.stringify(step.toolCall.args) } }],
            model: modelId,
          };
        }
        yield { type: 'usage' as const, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }, cost_usd: 0, model: modelId };
      },
    } as any,
  };
}

const VALID_PLAN = JSON.stringify({
  summary: 'A single counter page.',
  files: [{ path: 'src/App.tsx', action: 'edit', rationale: 'Render a counter with an increment button.' }],
  risks: [],
});

const COUNTER_APP = 'export default function App() {\n  return <button>Count: 0</button>;\n}\n';

async function cleanup(projectId: string) {
  await sandboxRegistry.peek(projectId)?.destroy().catch(() => null);
}

async function harnessWithTurn() {
  const store = new InMemoryAgentHarnessStore();
  const harness = new CodenAgentHarness(store);
  const thread = await harness.createThread({ organizationId: 'org-1', projectId: 'proj-1', userId: 'user-1' });
  const { turn } = await harness.createTurn({ threadId: thread.id, userId: 'user-1', prompt: 'build it', idempotencyKey: `key-${Math.random()}` });
  return { store, harness, threadId: thread.id, turnId: turn.id };
}

try {
  // -- new_project: the planner runs first, the scaffold comes from the starter
  {
    const provider = scriptedProvider([
      { text: VALID_PLAN }, // planner
      { text: '', toolCall: { name: 'write_file', args: { path: 'src/App.tsx', content: COUNTER_APP } } }, // coder step 1
      { text: 'Done.' }, // coder step 2: no tool call, ends the round
    ]);
    const gateway = new ProviderGateway(provider.service);
    const outcome = await runMultiAgentPipeline({
      gateway,
      projectId: 'pipeline-new-project',
      userId: 'user-1',
      prompt: 'build a counter app',
      route: 'new_project',
      existingFiles: [],
      userPlan: 'pro',
    });
    await cleanup('pipeline-new-project');

    assert.equal(outcome.started, true);
    assert.ok(outcome.started);
    assert.equal(outcome.route, 'new_project');
    assert.ok(outcome.plan, 'a new project must go through the planner');
    assert.equal(outcome.plan!.summary, 'A single counter page.');
    assert.ok(outcome.files.some(file => file.path === 'package.json'), 'the starter scaffold must back a new project');
    assert.ok(outcome.files.some(file => file.path === 'src/App.tsx' && file.content === COUNTER_APP), 'the coder\'s write must reach the returned files');
    assert.equal(outcome.ok, true);
    assert.equal(provider.chatCalls.length, 3, 'one planner call plus the two-step tool loop, no more');
  }

  // -- small_edit: no planner call, exactly the one file is touched ---------
  {
    const provider = scriptedProvider([
      { text: '', toolCall: { name: 'edit_file', args: { path: 'src/App.tsx', find: 'Count: 0', replace: 'Count: 1' } } },
      { text: 'Done.' },
    ]);
    const gateway = new ProviderGateway(provider.service);
    const outcome = await runMultiAgentPipeline({
      gateway,
      projectId: 'pipeline-small-edit',
      userId: 'user-1',
      prompt: 'change the counter to start at 1',
      route: 'small_edit',
      existingFiles: [
        { path: 'package.json', content: JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }) },
        { path: 'src/App.tsx', content: COUNTER_APP },
      ],
      userPlan: 'free',
    }).catch(async (error) => { await cleanup('pipeline-small-edit'); throw error; });
    await cleanup('pipeline-small-edit');

    assert.equal(outcome.started, true);
    assert.ok(outcome.started);
    assert.equal(outcome.plan, undefined, 'a small edit must not invoke the planner at all');
    assert.equal(provider.chatCalls.length, 2, 'no planner call means the script starts directly on the coder\'s steps');
    const app = outcome.files.find(file => file.path === 'src/App.tsx');
    assert.match(app?.content || '', /Count: 1/);
  }

  // -- the sandbox failing to start is reported, not thrown -----------------
  // A malformed package.json fails npm install near-instantly, with no
  // network round trip — a fast, deterministic way to exercise this path.
  {
    const provider = scriptedProvider([{ text: VALID_PLAN }]);
    const gateway = new ProviderGateway(provider.service);
    const outcome = await runMultiAgentPipeline({
      gateway,
      projectId: 'pipeline-bad-install',
      userId: 'user-1',
      prompt: 'add a feature',
      route: 'large_change',
      existingFiles: [{ path: 'package.json', content: '{not valid json' }],
      userPlan: 'pro',
    });
    await cleanup('pipeline-bad-install');

    assert.equal(outcome.started, false);
    assert.ok(!outcome.started);
    assert.ok(outcome.startError, 'the caller needs a reason to log, even though it will fall back silently to the user');
    // The planner still ran — planning costs nothing extra and happens before
    // the sandbox — so its output is preserved even though the build never got
    // the chance to use it.
    assert.ok(outcome.plan);
  }

  // -- harness persistence: the build is recorded as its own subagent -------
  {
    const provider = scriptedProvider([
      { text: '', toolCall: { name: 'write_file', args: { path: 'src/App.tsx', content: COUNTER_APP } } },
      { text: 'Done.' },
    ]);
    const gateway = new ProviderGateway(provider.service);
    const { store, harness, threadId, turnId } = await harnessWithTurn();
    const outcome = await runMultiAgentPipeline({
      gateway,
      projectId: 'pipeline-harness',
      userId: 'user-1',
      prompt: 'change something',
      route: 'small_edit',
      existingFiles: [
        { path: 'package.json', content: JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }) },
        { path: 'src/App.tsx', content: COUNTER_APP },
      ],
      userPlan: 'free',
      harnessContext: { harness, threadId, turnId },
    });
    await cleanup('pipeline-harness');

    assert.equal(outcome.started, true);
    const turn = await store.getTurn(turnId);
    assert.equal(turn?.budgetUsed.subagents, 1, 'the build must be recorded as one harness subagent');
    const events = await store.listEvents(threadId);
    const spawned = events.find(event => event.type === 'subagent.spawned');
    assert.equal((spawned?.payload as any)?.role, 'integrator');
    assert.ok(events.some(event => event.type === 'subagent.completed'), 'a successful build must be closed out, not left open');
  }

  /**
   * The model actually chosen differs by route, not just its label.
   *
   * `small_edit` carries the `code_edit` task, `large_change` carries
   * `code_generation` — and per model-selection.ts's own table, the code
   * competence floor for `code_generation` is strictly higher, so on the same
   * plan and credits the two routes are not free to land on the same model
   * unless a small edit genuinely needs that much. This is the actual saving
   * "real incremental edits" is supposed to produce, not merely a label.
   */
  {
    const editProvider = scriptedProvider([
      { text: '', toolCall: { name: 'edit_file', args: { path: 'src/App.tsx', find: 'Count: 0', replace: 'Count: 9' } } },
      { text: 'Done.' },
    ]);
    const editOutcome = await runMultiAgentPipeline({
      gateway: new ProviderGateway(editProvider.service),
      projectId: 'pipeline-cost-edit',
      userId: 'user-1',
      prompt: 'bump the counter',
      route: 'small_edit',
      existingFiles: [
        { path: 'package.json', content: JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }) },
        { path: 'src/App.tsx', content: COUNTER_APP },
      ],
      userPlan: 'enterprise',
      credits: 99_999,
    });
    await cleanup('pipeline-cost-edit');

    const buildProvider = scriptedProvider([
      { text: VALID_PLAN },
      { text: '', toolCall: { name: 'write_file', args: { path: 'src/App.tsx', content: COUNTER_APP } } },
      { text: 'Done.' },
    ]);
    const buildOutcome = await runMultiAgentPipeline({
      gateway: new ProviderGateway(buildProvider.service),
      projectId: 'pipeline-cost-build',
      userId: 'user-1',
      prompt: 'build a whole new dashboard',
      route: 'large_change',
      existingFiles: [
        { path: 'package.json', content: JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }) },
        { path: 'src/App.tsx', content: COUNTER_APP },
      ],
      userPlan: 'enterprise',
      credits: 99_999,
    });
    await cleanup('pipeline-cost-build');

    assert.equal(editOutcome.started, true);
    assert.equal(buildOutcome.started, true);
    if (editOutcome.started && buildOutcome.started) {
      assert.ok(
        blendedCost(editOutcome.modelId) <= blendedCost(buildOutcome.modelId as AllowedModelId),
        `a small edit must not be routed to a pricier model than a full build: ${editOutcome.modelId} vs ${buildOutcome.modelId}`,
      );
    }
  }

  // -- the coder's own prose streams token by token, live -------------------
  // Real per-token forwarding is the whole point of switching the coder loop
  // to `streamChat`: the model's own explanatory text ("Done.", etc.) must
  // reach the caller as it is produced, not only once the whole run ends.
  {
    const provider = scriptedProvider([
      { text: 'Writing the counter component now.', toolCall: { name: 'write_file', args: { path: 'src/App.tsx', content: COUNTER_APP } } },
      { text: 'Done.' },
    ]);
    const tokenEvents: string[] = [];
    const outcome = await runMultiAgentPipeline({
      gateway: new ProviderGateway(provider.service),
      projectId: 'pipeline-token-stream',
      userId: 'user-1',
      prompt: 'change the counter to start at 1',
      route: 'small_edit',
      existingFiles: [
        { path: 'package.json', content: JSON.stringify({ name: 'app', private: true, scripts: { dev: 'vite' }, dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }) },
        { path: 'src/App.tsx', content: COUNTER_APP },
      ],
      userPlan: 'free',
      onCoderEvent: event => { if ((event as any).type === 'token') tokenEvents.push((event as any).text); },
    });
    await cleanup('pipeline-token-stream');

    assert.equal(outcome.started, true);
    assert.deepEqual(tokenEvents, ['Writing the counter component now.', 'Done.'], 'each step\'s own text must be relayed as its own token event, in call order');
  }

  console.log('multi-agent pipeline tests passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
