import assert from 'node:assert/strict';
import { settleDefinitionOfDoneFromReport } from './src/services/multi-agent-pipeline.ts';
import { CodenAgentHarness, InMemoryAgentHarnessStore } from './src/services/agent-harness/index.ts';

/*
 * A definition of done that is never settled is a checklist nobody ticks.
 *
 * `buildDefinitionOfDone` writes the criteria at the start of every turn — the
 * behaviour is implemented, the project builds, the preview renders, the
 * browser journey completes — and production shows all 56 recorded turns
 * finishing with every one of them still `pending`, the successful ones
 * included. Nothing could gate on them, and the user was told nothing about
 * what had actually been verified.
 */

// A clean run settles what the report speaks to, and only that.
{
  const verdicts = settleDefinitionOfDoneFromReport({
    ok: true,
    ran: { devServer: true, typecheck: true, build: true, browser: true },
    problems: [],
  });
  assert.equal(verdicts.requested_behavior?.status, 'passed');
  assert.equal(verdicts.build?.status, 'passed');
  assert.equal(verdicts.preview?.status, 'passed');
  assert.equal(verdicts.browser_smoke?.status, 'passed');
  assert.equal(verdicts.console?.status, 'passed');
  // Nothing in a build report proves these, so nothing claims them.
  for (const unproven of ['responsive', 'backend_health', 'database', 'production']) {
    assert.equal(verdicts[unproven], undefined, `${unproven} is not proven by a build report`);
  }
}

// A check that did not run is left pending, never passed by default.
{
  const verdicts = settleDefinitionOfDoneFromReport({
    ok: false,
    ran: { devServer: false, typecheck: false, build: false, browser: false },
    problems: [{ source: 'runtime', severity: 'error', message: 'PREVIEW_NOT_RUNNING' }],
  });
  assert.equal(verdicts.build, undefined, 'a build that never ran cannot be marked either way');
  assert.equal(verdicts.browser_smoke, undefined);
  assert.equal(verdicts.requested_behavior?.status, 'failed');
}

// A failure names its evidence, and only the criteria it belongs to.
{
  const verdicts = settleDefinitionOfDoneFromReport({
    ok: false,
    ran: { devServer: true, typecheck: true, build: true, browser: true },
    problems: [{ source: 'typecheck', severity: 'error', message: "Type 'string' is not assignable to type 'number'." }],
  });
  assert.equal(verdicts.build?.status, 'failed');
  assert.match(String(verdicts.build?.evidence), /not assignable/);
  assert.equal(verdicts.console?.status, 'passed', 'a type error is not a console exception');
}

// The scaffold-placeholder failure lands on the preview criterion.
{
  const verdicts = settleDefinitionOfDoneFromReport({
    ok: false,
    ran: { devServer: true, typecheck: true, build: true, browser: true },
    problems: [{ source: 'runtime', severity: 'error', message: 'src/App.tsx is still the scaffold placeholder rendering "Building…"' }],
  });
  assert.equal(verdicts.preview?.status, 'failed');
  assert.equal(verdicts.requested_behavior?.status, 'failed');
}

// Warnings are not failures.
{
  const verdicts = settleDefinitionOfDoneFromReport({
    ok: true,
    ran: { devServer: true, typecheck: true, build: true, browser: true },
    problems: [{ source: 'runtime', severity: 'warning', message: 'A deprecation notice.' }],
  });
  assert.equal(verdicts.console?.status, 'passed');
}

// And the harness actually writes them back onto the turn.
{
  const harness = new CodenAgentHarness(new InMemoryAgentHarnessStore());
  const thread = await harness.createThread({ organizationId: 'org', projectId: 'project', userId: 'user', title: 'demo' });
  const { turn } = await harness.createTurn({
    threadId: thread.id,
    userId: 'user',
    prompt: 'build a todo list',
    requestedMode: 'auto',
    idempotencyKey: 'test-definition-of-done',
    definitionOfDone: [
      { id: 'requested_behavior', label: 'behaviour', required: true, status: 'pending' },
      { id: 'build', label: 'builds', required: true, status: 'pending' },
      { id: 'responsive', label: 'responsive', required: true, status: 'pending' },
    ],
  });

  const settled = await harness.settleDefinitionOfDone(turn.id, {
    requested_behavior: { status: 'passed' },
    build: { status: 'failed', evidence: 'tsc exited 1' },
  });

  const byId = Object.fromEntries(settled.definitionOfDone.map(item => [item.id, item]));
  assert.equal(byId.requested_behavior.status, 'passed');
  assert.equal(byId.build.status, 'failed');
  assert.equal(byId.build.evidence, 'tsc exited 1');
  assert.equal(byId.responsive.status, 'pending', 'a criterion with no verdict must stay pending');

  const events = await harness.store.listEvents(thread.id);
  assert.ok(
    events.some(event => event.type === 'turn.definition_of_done'),
    'settling the criteria must be recorded, or the user still cannot see what was verified',
  );
}

// The pipeline must call it, not merely export it.
{
  const { readFileSync } = await import('node:fs');
  const pipeline = readFileSync(new URL('./src/services/multi-agent-pipeline.ts', import.meta.url), 'utf8');
  assert.match(pipeline, /ctx\.harness\.settleDefinitionOfDone\(ctx\.turnId, settleDefinitionOfDoneFromReport\(/,
    'the run must settle its own criteria from its verification report');
}

console.log('definition of done tests passed');
