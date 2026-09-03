import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

/**
 * The build side of the generalized loop.
 *
 * `runCoderLoop`'s `mode: 'build'` is what lets generation and repair share
 * one implementation instead of two: round one writes what was asked for,
 * every later round fixes what the toolchain still complains about — the
 * exact shape repair already had. Two things are specific to build mode and
 * worth pinning on their own:
 *
 * 1. The "already ok" fast-exit must not fire. A fresh, valid, empty scaffold
 *    reports zero errors before a single line of the user's request has been
 *    written; exiting there would report success on an unbuilt project.
 * 2. The "no progress" stop must not fire on round one. There is no earlier
 *    attempt at the same task to compare a first build against — only the
 *    empty scaffold's error count, which is not a baseline. Round two onward,
 *    genuinely comparing against a prior attempt, keeps the original rule.
 */

process.env.CODEN_SANDBOX_ROOT = path.join(os.tmpdir(), `coden-coder-loop-test-${process.pid}`);

const { runCoderLoop } = await import('./src/services/sandbox/repair-loop.ts');
const { ProjectSandbox } = await import('./src/services/sandbox/project-sandbox.ts');
const { STARTERS, applyStarter } = await import('./src/services/sandbox/starters.ts');
const { validateProject } = await import('./src/services/sandbox/validate.ts');

const WORKING_APP = 'export default function App() {\n  return <h1 className="text-xl">Hello</h1>;\n}\n';
const BROKEN_APP = "import { create } from 'zustand';\n\nconst useStore = create(() => ({ n: 0 }));\n\nexport default function App() {\n  const { n } = useStore();\n  return <h1 className=\"text-xl\">{n}</h1>;\n}\n";
const FIXED_APP = 'export default function App() {\n  return <h1 className="text-xl">Fixed</h1>;\n}\n';

async function freshScaffold(id: string) {
  const sandbox = new ProjectSandbox(id);
  const project = applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: WORKING_APP }]);
  await sandbox.writeFiles(project.files);
  const install = await sandbox.install();
  assert.ok(install.ok, `fixture must install: ${install.output.slice(-300)}`);
  return sandbox;
}

const sandboxes: InstanceType<typeof ProjectSandbox>[] = [];
try {
  // -- build mode requires an instruction ---------------------------------
  {
    const sandbox = await freshScaffold('coder-loop-needs-instruction');
    sandboxes.push(sandbox);
    await assert.rejects(
      () => runCoderLoop({ sandbox, mode: 'build', turn: async () => ({ toolCalls: 0 }) }),
      /initialInstruction/,
      'a build with nothing to build must fail loudly, not silently no-op',
    );
  }

  // -- the fast-exit does not fire on a clean, unbuilt scaffold ------------
  {
    const sandbox = await freshScaffold('coder-loop-fast-exit');
    sandboxes.push(sandbox);
    const before = await validateProject(sandbox, { skipBuild: true });
    assert.equal(before.ok, true, 'the fixture starts clean, which is exactly the trap');

    let turns = 0;
    const outcome = await runCoderLoop({
      sandbox,
      mode: 'build',
      initialInstruction: 'Write a component that renders "Built".',
      turn: async ({ instruction }) => {
        turns += 1;
        assert.match(instruction, /Write a component/, 'round one must carry the build instruction, not a repair prompt');
        await sandbox.writeFiles([{ path: 'src/App.tsx', content: 'export default function App() {\n  return <h1 className="text-xl">Built</h1>;\n}\n' }]);
        return { toolCalls: 1 };
      },
    });

    assert.equal(turns, 1, 'a clean scaffold must still be handed to the model in build mode');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.rounds.length, 1, 'a build that succeeds first try is one round, not zero');
  }

  // -- round one's errors are not judged as "no progress" ------------------
  // The model's first attempt introduces a real error (a missing package);
  // round one's errorsBefore is the clean scaffold's count (0), so a naive
  // comparison would read any error at all as regression and stop the loop
  // after a single round — before the repair rounds that exist for exactly
  // this ever run.
  {
    const sandbox = await freshScaffold('coder-loop-first-round-forgiven');
    sandboxes.push(sandbox);
    let turns = 0;
    const outcome = await runCoderLoop({
      sandbox,
      mode: 'build',
      initialInstruction: 'Use zustand for state.',
      maxRounds: 3,
      turn: async ({ instruction }) => {
        turns += 1;
        if (turns === 1) {
          assert.match(instruction, /zustand/i, 'round one carries the build instruction');
          await sandbox.writeFiles([{ path: 'src/App.tsx', content: BROKEN_APP }]);
        } else {
          // From round two the loop is repairing, same as ever: the
          // instruction now carries the toolchain's own complaint.
          assert.match(instruction, /zustand/, 'a repair round must name the missing package');
          await sandbox.writeFiles([{ path: 'src/App.tsx', content: FIXED_APP }]);
        }
        return { toolCalls: 1 };
      },
    });

    assert.equal(turns, 2, 'round one introducing an error must not end the loop before a repair round runs');
    assert.equal(outcome.ok, true);
    assert.equal(outcome.stoppedBecause, 'fixed');
    assert.equal(outcome.rounds.length, 2);
    assert.equal(outcome.rounds[0].round, 1);
    assert.ok(outcome.rounds[0].errorsAfter > outcome.rounds[0].errorsBefore, 'round one is exactly the case where errors go up, by construction of this fixture');
  }

  // -- but round two onward keeps the real no-progress rule ----------------
  {
    const sandbox = await freshScaffold('coder-loop-second-round-still-guarded');
    sandboxes.push(sandbox);
    let turns = 0;
    const outcome = await runCoderLoop({
      sandbox,
      mode: 'build',
      initialInstruction: 'Use zustand for state.',
      maxRounds: 3,
      turn: async () => {
        turns += 1;
        if (turns === 1) await sandbox.writeFiles([{ path: 'src/App.tsx', content: BROKEN_APP }]);
        // Every repair round after the first does nothing — the model is
        // stuck. This must still stop the loop, exactly as plain repair does.
        return { toolCalls: turns === 1 ? 1 : 0 };
      },
    });

    assert.equal(outcome.ok, false);
    assert.equal(outcome.stoppedBecause, 'no_progress');
    assert.equal(turns, 2, 'the no-progress rule must still fire on the first *repair* round, round two');
  }

  // -- repair mode is unchanged: the compatibility shim behaves identically -
  {
    const { runRepairLoop } = await import('./src/services/sandbox/repair-loop.ts');
    const sandbox = new ProjectSandbox('coder-loop-repair-shim-unchanged');
    sandboxes.push(sandbox);
    await sandbox.writeFiles(applyStarter(STARTERS['react-vite'], [{ path: 'src/App.tsx', content: FIXED_APP }]).files);
    assert.ok((await sandbox.install()).ok);
    let turns = 0;
    const outcome = await runRepairLoop({ sandbox, turn: async () => { turns += 1; return { toolCalls: 0 }; } });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.stoppedBecause, 'no_errors');
    assert.equal(turns, 0, 'the fast-exit must still fire for the unmigrated repair caller');
  }

  console.log('coder loop build-mode tests passed');
} finally {
  for (const sandbox of sandboxes) await sandbox.destroy().catch(() => null);
  await rm(process.env.CODEN_SANDBOX_ROOT!, { recursive: true, force: true }).catch(() => null);
}
