import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The repair loop, driven against a project that is genuinely broken.
 *
 * The model turn is a stub, and deliberately so: what is under test is the
 * loop's judgement, not a language model's. Whether it stops when the project
 * is fixed, whether it stops when a round achieved nothing, whether it enforces
 * its own tool budget when the turn ignores it — those are decisions this code
 * makes, and each of them is a way real money gets spent on nothing.
 *
 * The sandbox, the errors and the repairs are all real.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-repair-test-${process.pid}`);

const { runRepairLoop } = await import('./src/services/sandbox/repair-loop.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { STARTERS, applyStarter } = await import('./src/services/sandbox/starters.ts');
const { validateProject } = await import('./src/services/sandbox/validate.ts');

/** A project importing a package nobody installed — the commonest real failure. */
const BROKEN_APP = "import { create } from 'zustand';\n\nconst useStore = create(() => ({ n: 0 }));\n\nexport default function App() {\n  const { n } = useStore();\n  return <h1 className=\"text-xl\">{n}</h1>;\n}\n";
const FIXED_APP = 'export default function App() {\n  return <h1 className="text-xl">Fixed</h1>;\n}\n';

async function freshSandbox(id: string) {
  const sandbox = new ProjectSandbox(id);
  const project = applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: BROKEN_APP }]);
  await sandbox.writeFiles(project.files);
  const install = await sandbox.install();
  assert.ok(install.ok, `fixture must install: ${install.output.slice(-300)}`);
  return sandbox;
}

const sandboxes: InstanceType<typeof ProjectSandbox>[] = [];
try {
  // -- a round that fixes the project stops the loop ---------------------
  {
    const sandbox = await freshSandbox('repair-fixes');
    sandboxes.push(sandbox);
    const before = await validateProject(sandbox, { skipBuild: true });
    assert.equal(before.ok, false, 'the fixture must actually be broken');
    assert.ok(before.problems.some(problem => problem.missingPackage === 'zustand'), 'and broken in the way we think');

    const events: string[] = [];
    let turns = 0;
    const outcome = await runRepairLoop({
      sandbox,
      initialReport: before,
      onEvent: event => events.push(event.type),
      turn: async ({ instruction, call }) => {
        turns += 1;
        // The instruction is what a model would act on, so it has to carry the
        // evidence: which package, and which file to change.
        assert.match(instruction, /zustand/);
        assert.match(instruction, /src\/App\.tsx/);
        await call('write_file', { path: 'src/App.tsx', content: FIXED_APP });
        return { toolCalls: 1 };
      },
    });

    assert.equal(outcome.ok, true);
    assert.equal(outcome.stoppedBecause, 'fixed');
    assert.equal(turns, 1, 'a fixed project must not be handed to a second round');
    assert.equal(outcome.rounds.length, 1);
    assert.deepEqual(outcome.rounds[0].filesTouched, ['src/App.tsx']);
    assert.ok(outcome.rounds[0].errorsAfter < outcome.rounds[0].errorsBefore);
    assert.deepEqual(events, ['repair_round_started', 'repair_round_finished', 'repair_finished']);
  }

  // -- a round that achieves nothing stops the loop ----------------------
  // The expensive failure this prevents: a model that cannot fix an error will
  // keep not fixing it, and three rounds of that is three times the cost for
  // the same outcome.
  {
    const sandbox = await freshSandbox('repair-stalls');
    sandboxes.push(sandbox);
    let turns = 0;
    const outcome = await runRepairLoop({
      sandbox,
      maxRounds: 3,
      turn: async () => { turns += 1; return { toolCalls: 0 }; },
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.stoppedBecause, 'no_progress');
    assert.equal(turns, 1, 'a round that changed nothing must not be repeated');
  }

  // -- the tool budget is enforced here, not trusted to the model ---------
  {
    const sandbox = await freshSandbox('repair-budget');
    sandboxes.push(sandbox);
    let accepted = 0;
    let refused = 0;
    await runRepairLoop({
      sandbox,
      maxRounds: 1,
      maxToolCallsPerRound: 3,
      turn: async ({ call }) => {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const result: any = await call('list_files', {});
          if (result?.ok) accepted += 1; else refused += 1;
        }
        return { toolCalls: 10 };
      },
    });
    assert.equal(accepted, 3, 'exactly the budget is served');
    assert.equal(refused, 7, 'and the rest are refused with a reason, not thrown');
  }

  // -- a project that already works is not repaired ----------------------
  {
    const sandbox = new ProjectSandbox('repair-healthy');
    sandboxes.push(sandbox);
    await sandbox.writeFiles(applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: FIXED_APP }]).files);
    assert.ok((await sandbox.install()).ok);
    let turns = 0;
    const outcome = await runRepairLoop({ sandbox, turn: async () => { turns += 1; return { toolCalls: 0 }; } });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.stoppedBecause, 'no_errors');
    assert.equal(turns, 0, 'a healthy project costs no model call at all');
  }

  console.log('sandbox repair loop tests passed');
} finally {
  for (const sandbox of sandboxes) await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
