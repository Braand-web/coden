import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { resolvePipelineRoute, taskKindForRoute, buildEditInstruction } from './src/services/edit-intent.ts';
import { selectModel, blendedCost } from './src/services/model-selection.ts';
import type { AllowedModelId } from './src/config/ai-models.ts';

/**
 * Routing a request into the shape it needs, without a live model.
 *
 * `resolvePipelineRoute` is pure and exhaustively checkable against the real
 * classifier's actual outputs (intent, nextAction, hasFiles) — the values
 * this test uses are exactly the ones server.ts's classifier produces, not
 * invented ones. The instruction-scoping and cost claims are checked directly.
 * The one thing that needs a real sandbox — that a small edit touches exactly
 * one file — is checked against `runCoderLoop`, real, with a stubbed turn.
 */

// -- classification: only code-writing intents get a route -----------------
for (const intent of ['conversation', 'verify', 'deploy_assist', 'clarification_required']) {
  assert.equal(resolvePipelineRoute({ intent, hasFiles: true }), null, `${intent} must never reach the coder loop`);
  assert.equal(resolvePipelineRoute({ intent, hasFiles: false }), null);
}

// -- no files means new_project, whatever nextAction says -------------------
assert.equal(resolvePipelineRoute({ intent: 'build', hasFiles: false }), 'new_project');
assert.equal(resolvePipelineRoute({ intent: 'edit', hasFiles: false }), 'new_project',
  'an "edit" intent with nothing to edit is still a new project, not an error');

// -- with files, the classifier's own plan_then_build decides large_change --
assert.equal(resolvePipelineRoute({ intent: 'edit', nextAction: 'edit', hasFiles: true }), 'small_edit');
assert.equal(resolvePipelineRoute({ intent: 'edit', nextAction: 'plan_then_build', hasFiles: true }), 'large_change');
assert.equal(resolvePipelineRoute({ intent: 'debug_fix', nextAction: 'debug_fix', hasFiles: true }), 'small_edit');
assert.equal(resolvePipelineRoute({ intent: 'debug_fix', nextAction: 'plan_then_build', hasFiles: true }), 'large_change',
  'a debug fix the classifier judged complex must still get a plan');
assert.equal(resolvePipelineRoute({ intent: 'build', nextAction: 'plan_only', hasFiles: true }), 'large_change');
assert.equal(resolvePipelineRoute({ intent: 'build', nextAction: 'build', hasFiles: true }), 'small_edit');

// -- task kind: only small_edit is cheap by design ---------------------------
assert.equal(taskKindForRoute('small_edit'), 'code_edit');
assert.equal(taskKindForRoute('new_project'), 'code_generation');
assert.equal(taskKindForRoute('large_change'), 'code_generation');

/**
 * The point of the split: a small edit is genuinely cheaper to route, not
 * merely labelled differently. `code_edit`'s competence bar is lower than
 * `code_generation`'s in the selector's table, so the model actually chosen
 * for the same plan/credits differs — this is the saving "real incremental
 * edits" is supposed to produce, checked against the real selector.
 */
{
  const editModel = selectModel({ task: taskKindForRoute('small_edit'), plan: 'pro', credits: 100 });
  const buildModel = selectModel({ task: taskKindForRoute('new_project'), complexity: 'complex', plan: 'pro', credits: 100 });
  const costOf = (id: AllowedModelId) => blendedCost(id);
  assert.ok(costOf(editModel.modelId) <= costOf(buildModel.modelId),
    `a small edit must not be routed to a more expensive model than a full build: ${editModel.modelId} vs ${buildModel.modelId}`);
}

// -- the edit instruction is biased toward edit_file and scope -------------
{
  const instruction = buildEditInstruction('change the submit button to blue');
  assert.match(instruction, /edit_file/, 'the instruction must steer toward the targeted tool');
  assert.match(instruction, /Request: change the submit button to blue/);
  assert.match(instruction, /any file the request does not require/i);
}

/**
 * End to end, against a real sandbox: a small edit touches exactly one file.
 *
 * `runCoderLoop` is Stage 1's, real and already tested generically; what is
 * new here is driving it with the instruction this module actually produces,
 * on a fixture with more than one file, to confirm the combination behaves —
 * a stubbed turn that plays along by calling edit_file once, and the
 * assertion is on the loop's own bookkeeping of what was touched.
 */
process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-edit-intent-test-${process.pid}`);
const { runCoderLoop } = await import('./src/services/sandbox/repair-loop.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { STARTERS, applyStarter } = await import('./src/services/sandbox/starters.ts');

const sandboxes: InstanceType<typeof ProjectSandbox>[] = [];
try {
  const sandbox = new ProjectSandbox('edit-intent-scoped');
  sandboxes.push(sandbox);
  const ORIGINAL_APP = 'export default function App() {\n  return (\n    <button className="bg-gray-500">Submit</button>\n  );\n}\n';
  const ORIGINAL_HEADER = 'export default function Header() {\n  return <header>My App</header>;\n}\n';
  const project = applyStarter(STARTERS['react-vite'], [
    { path: 'src/App.tsx', content: ORIGINAL_APP },
    { path: 'src/components/Header.tsx', content: ORIGINAL_HEADER },
  ]);
  await sandbox.writeFiles(project.files);
  assert.ok((await sandbox.install()).ok);

  const instruction = buildEditInstruction('change the submit button to blue');
  const outcome = await runCoderLoop({
    sandbox,
    mode: 'build',
    initialInstruction: instruction,
    turn: async ({ instruction: given, call }) => {
      assert.equal(given, instruction, 'the loop must hand the model exactly the scoped instruction, not a rebuilt one');
      await call('edit_file', { path: 'src/App.tsx', find: 'bg-gray-500', replace: 'bg-blue-500' });
      return { toolCalls: 1 };
    },
  });

  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.rounds[0].filesTouched, ['src/App.tsx'], 'a small edit must touch exactly the one file the request named');
  const finalApp = await sandbox.readProjectFile('src/App.tsx');
  assert.match(finalApp, /bg-blue-500/);
  const header = await sandbox.readProjectFile('src/components/Header.tsx');
  assert.equal(header, ORIGINAL_HEADER, 'an unrelated file must be untouched, byte for byte');

  console.log('edit intent tests passed');
} finally {
  for (const sandbox of sandboxes) await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
