import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTargetedRepair, failedRunnerOutput } from './src/services/targeted-repair.ts';

/**
 * The repair pass used to send the whole project back with a list of blocker
 * sentences. On the QuickCalc run that second full generation ran from 06:03 to
 * 06:08 and timed out, and the user was told the provider was slow — for a pass
 * rewriting an entire application to fix a compiler error.
 */

const tscOutput = [
  '> quickcalc@1.0.0 build',
  '> vite build && tsc --noEmit',
  '',
  "src/App.tsx(41,18): error TS2304: Cannot find name 'formatNumber'.",
  "src/App.tsx(58,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/lib/appData.ts(12,3): error TS2554: Expected 1 arguments, but got 0.",
  'Found 3 errors.',
].join('\n');

const check = (output: string, type = 'script_build_exec', status = 'failed') => ({
  check_type: type,
  status,
  message: 'build exited with code 2.',
  public_payload: { output },
});

// A real tsc failure names the files and the lines. The repair aims at those.
{
  const repair = buildTargetedRepair([check(tscOutput)]);
  assert.equal(repair.targeted, true);
  assert.deepEqual(repair.files, ['src/App.tsx', 'src/lib/appData.ts'], 'ordered by how often the compiler blamed each file');
  assert.ok(repair.instruction.includes('Change only src/App.tsx, src/lib/appData.ts'));
  assert.ok(repair.instruction.includes('Return every other file unchanged'));
  assert.ok(repair.instruction.includes("src/App.tsx:41 [TS2304] Cannot find name 'formatNumber'."));
  assert.ok(repair.instruction.includes('src/lib/appData.ts:12'));
}

// Only checks that actually failed contribute. A passing build must not send
// its own output into a repair prompt.
{
  assert.equal(failedRunnerOutput([check(tscOutput, 'script_build_exec', 'passed')]), '');
  assert.equal(buildTargetedRepair([check(tscOutput, 'script_build_exec', 'passed')]).targeted, false);
  assert.equal(failedRunnerOutput([check(tscOutput, 'browser_no_runtime_errors')]), '', 'only script executions carry build output');
}

// Nothing to aim at is reported honestly, so the caller keeps its broad repair
// instead of pointing the model at a file the compiler never mentioned.
for (const [label, checks] of [
  ['no checks', []],
  ['no output', [check('')]],
  ['prose only', [check('Build failed.\nSomething went wrong.')]],
  ['warnings only', [check("src/App.tsx(3,1): warning TS6133: 'x' is declared but never used.")]],
] as const) {
  const repair = buildTargetedRepair(checks as any);
  assert.equal(repair.targeted, false, `${label} must not produce a target`);
  assert.deepEqual(repair.files, []);
  assert.equal(repair.instruction, '');
}

// A vite resolve failure is a build error too, and it names its importer.
{
  const repair = buildTargetedRepair([check([
    '✘ [ERROR] Could not resolve "./missing" (src/main.tsx:3:18)',
    'error during build:',
  ].join('\n'))]);
  assert.equal(repair.targeted, true);
  assert.deepEqual(repair.files, ['src/main.tsx']);
}

// The prompt stays bounded: a failure that touches everything must not send an
// unbounded file list or a wall of errors into the next request.
{
  const many = Array.from({ length: 30 }, (_, i) => `src/f${i}.tsx(1,1): error TS1005: ';' expected.`).join('\n');
  const repair = buildTargetedRepair([check(many)]);
  assert.equal(repair.files.length, 6, 'the file list is capped');
  assert.ok(repair.instruction.split('\n').length <= 23, 'the error list is capped');
}

// Output from several failed scripts is read together — a run can fail lint and
// build in the same pass, and both name files worth fixing.
{
  const repair = buildTargetedRepair([
    check("src/App.tsx(41,18): error TS2304: Cannot find name 'x'.", 'script_build_exec'),
    check("src/router.tsx(9,2): error TS2307: Cannot find module './routeTree.gen'.", 'script_lint_exec'),
  ]);
  assert.deepEqual(repair.files.sort(), ['src/App.tsx', 'src/router.tsx']);
}

// Wiring: the repair path must actually read the runner's output. It was
// captured for months and never used, which is why repairs stayed broad.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');
assert.ok(/buildTargetedRepair\(/.test(server), 'the repair path must build a targeted repair');
assert.ok(
  /targetedRepair\.targeted[\s\S]{0,400}?targetedRepair\.instruction/.test(server),
  'a targeted repair must replace the broad instruction when one is available',
);

console.log('targeted repair tests passed');
