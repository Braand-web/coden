import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  GENERATION_PHASE_ORDER,
  GenerationPhaseTracker,
  generationPhaseLabel,
  type GenerationPhase,
  type GenerationPhaseState,
} from './src/services/generation-phases.ts';

type Emitted = { phase: GenerationPhase; state: GenerationPhaseState; label: string };

function tracker(language: 'fr' | 'en' = 'fr') {
  const events: Emitted[] = [];
  const t = new GenerationPhaseTracker((phase, state, label) => { events.push({ phase, state, label }); }, language);
  return { t, events, trace: () => events.map(e => `${e.phase}:${e.state}`) };
}

// Exactly one phase runs at a time. Starting the next one closes the previous,
// so no step is left spinning because an early return skipped its completion —
// which is how the ad-hoc version left the stream frozen mid-run.
{
  const { t, trace } = tracker();
  t.start('understand');
  t.start('decide');
  t.start('build');
  t.finish('done');
  assert.deepEqual(trace(), [
    'understand:active', 'understand:done',
    'decide:active', 'decide:done',
    'build:active', 'build:done',
  ]);
}

// A failed phase does not end the run: later phases still report. This is the
// difference between "the verification failed" and "the product went silent".
{
  const { t, trace } = tracker();
  t.start('verify');
  t.fail('verify');
  t.start('fix');
  t.done('fix');
  t.start('recap');
  t.finish('done');
  assert.deepEqual(trace(), [
    'verify:active', 'verify:failed',
    'fix:active', 'fix:done',
    'recap:active', 'recap:done',
  ]);
  assert.deepEqual(
    new GenerationPhaseTracker(() => {}).snapshot(),
    [],
    'a run that never started reports nothing',
  );
}

// One outcome per visit. A second report is ignored rather than overwriting what
// the user already saw, so a step can never show both failed and done at once.
{
  const { t, trace } = tracker();
  t.start('build');
  t.done('build');
  t.done('build');
  t.fail('build');
  assert.deepEqual(trace(), ['build:active', 'build:done']);
}

// The correction loop is the point of the machine: a run verifies, finds a
// blocker, repairs, and verifies again. Reopening a stage is that loop working,
// not a contradiction — and the final outcome is the one that sticks.
{
  const { t, trace } = tracker();
  t.start('verify');
  t.fail('verify');
  t.start('fix');
  t.done('fix');
  t.start('verify');
  t.done('verify');
  t.start('recap');
  t.finish('done');
  assert.deepEqual(trace(), [
    'verify:active', 'verify:failed',
    'fix:active', 'fix:done',
    'verify:active', 'verify:done',
    'recap:active', 'recap:done',
  ]);
  assert.deepEqual(t.snapshot(), [
    { phase: 'verify', state: 'done' },
    { phase: 'fix', state: 'done' },
    { phase: 'recap', state: 'done' },
  ], 'the snapshot carries the latest state of each stage');
}

// has() lets the route close a stage only when the run actually entered it, so
// a clean run shows no repair step.
{
  const { t, trace } = tracker();
  assert.equal(t.has('fix'), false);
  t.start('verify');
  t.done('verify');
  assert.equal(t.has('fix'), false, 'a run with no repair never reports one');
  assert.equal(t.has('verify'), true);
  assert.deepEqual(trace(), ['verify:active', 'verify:done']);
}

// Starting the phase that is already running does not re-announce it.
{
  const { t, trace } = tracker();
  t.start('build');
  t.start('build');
  assert.deepEqual(trace(), ['build:active']);
}

// A phase can be closed without being started — a step that was skipped but
// whose outcome is known still belongs in the list.
{
  const { t, trace } = tracker();
  t.done('plan');
  t.start('build');
  t.finish('done');
  assert.deepEqual(trace(), ['plan:done', 'build:active', 'build:done']);
}

// A run that ends badly closes its open phase as failed, not as done.
{
  const { t, trace } = tracker();
  t.start('understand');
  t.start('build');
  t.finish('failed');
  assert.deepEqual(trace(), ['understand:active', 'understand:done', 'build:active', 'build:failed']);
}

// finish() on a settled run adds nothing, so a route that closes twice is safe.
{
  const { t, trace } = tracker();
  t.start('recap');
  t.done('recap');
  t.finish('done');
  t.finish('failed');
  assert.deepEqual(trace(), ['recap:active', 'recap:done']);
}

// The snapshot reads in run order, whatever order the phases were reported in.
{
  const { t } = tracker();
  t.done('recap');
  t.fail('verify');
  t.done('understand');
  assert.deepEqual(t.snapshot(), [
    { phase: 'understand', state: 'done' },
    { phase: 'verify', state: 'failed' },
    { phase: 'recap', state: 'done' },
  ]);
}

// Progress reporting may never fail a run that is otherwise fine.
{
  const t = new GenerationPhaseTracker(() => { throw new Error('stream closed'); });
  assert.doesNotThrow(() => {
    t.start('build');
    t.fail('build');
    t.finish('failed');
  });
  assert.deepEqual(t.snapshot(), [{ phase: 'build', state: 'failed' }]);
}

// Labels are outcomes in the user's language, never internal mechanics.
for (const phase of GENERATION_PHASE_ORDER) {
  for (const language of ['fr', 'en'] as const) {
    const label = generationPhaseLabel(phase, language);
    assert.ok(label.trim().length > 3, `${phase} needs a real ${language} label`);
    for (const internal of ['prompt', 'token', 'model', 'modèle', 'fallback', 'router', 'babel', 'openrouter']) {
      assert.ok(!label.toLowerCase().includes(internal), `label must not expose "${internal}": ${label}`);
    }
  }
  assert.notEqual(
    generationPhaseLabel(phase, 'fr'),
    generationPhaseLabel(phase, 'en'),
    `${phase} must be translated, not duplicated`,
  );
}

// The default label is used when the caller does not override it.
{
  const { t, events } = tracker('en');
  t.start('build');
  assert.equal(events[0].label, 'Building the application');
  t.done('build', 'Built 12 files');
  assert.equal(events[1].label, 'Built 12 files');
}

// The machine is worth nothing unwired. These assertions are why the eight
// phases were declared for months without a single one ever reaching a user:
// nothing failed when the server stopped emitting them.
const server = fs.readFileSync(new URL('./server.ts', import.meta.url), 'utf8');

assert.ok(
  /streamV2\.emit\('phase', \{ phase, state, label \}\)/.test(server),
  'the generation route must publish phase events on the stream',
);

// Every stage the run passes through has to be reported, not just the happy path.
for (const phase of ['understand', 'decide', 'build', 'verify', 'fix', 'recap'] as const) {
  assert.ok(
    new RegExp(`phases\\.(start|done|fail)\\('${phase}'\\)`).test(server),
    `the route must report the "${phase}" stage`,
  );
}

// Both ends of the run close the machine, so no step can be left spinning when
// the route stops — including the credit gate and every other early return,
// which all funnel through respondJson.
assert.ok(/phases\.finish\('failed'\)/.test(server), 'a failed run must close its open step as failed');
assert.ok(
  /const respondJson[\s\S]{0,600}?phases\.finish\(/.test(server),
  'the shared response funnel must close the machine',
);

// The tracker has to exist before the funnel that calls it, or an early return
// would throw a ReferenceError instead of answering the request.
assert.ok(
  server.indexOf('const phases = new GenerationPhaseTracker') < server.indexOf('const respondJson'),
  'the tracker must be created before the response funnel references it',
);

// The frontend has to turn a phase into a step in the list. Without this the
// events only moved the single current-activity indicator, so the user could
// see what was happening now but never what had already run or failed.
const runStore = fs.readFileSync(new URL('./src/services/agent-run-store.ts', import.meta.url), 'utf8');
assert.ok(/case 'phase':/.test(runStore), 'the run store must reduce phase events into the step list');
assert.ok(
  /case 'phase':[\s\S]{0,400}?addActivity\(/.test(runStore),
  'a phase must become an entry in the step list, not only the current activity',
);
assert.ok(
  /case 'phase':[\s\S]{0,400}?event\.state === 'failed' \? 'failed'/.test(runStore),
  'a failed phase must render as failed',
);

console.log('generation phases tests passed');
