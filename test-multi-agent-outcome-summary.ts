import assert from 'node:assert/strict';
import { summarizePipelineOutcome } from './src/services/multi-agent-pipeline.ts';

/**
 * The exact bug this pins: the pipeline's response never carried a `summary`
 * (or `text`/`message`) field, so the client's own contract check —
 * `src/builder-live.ts`, `if (!finalText) throw new Error('The selected AI
 * model did not return a usable final summary.')` — fired on every single
 * generation once the pipeline went live. This asserts the function that now
 * fills that field never returns an empty string, for every outcome shape
 * the pipeline can produce.
 */

const emptyDiff = { created: [], modified: [], deleted: [] };

// -- ok, with a plan (new_project / large_change) --------------------------
{
  const summary = summarizePipelineOutcome({
    plan: { summary: 'A single counter page.', files: [], risks: [] },
    ok: true,
    route: 'new_project',
    diff: { created: ['src/App.tsx', 'package.json'], modified: [], deleted: [] },
    stoppedBecause: 'no_errors',
    prompt: 'build a counter app',
  });
  assert.ok(summary.trim().length > 0, 'must never be empty when the plan carries a summary');
  assert.match(summary, /A single counter page\./, 'the planner\'s own real text must lead the message');
  assert.match(summary, /2 file\(s\) created/, 'a factual diff recap must be appended');
}

// -- ok, no plan (small_edit) ------------------------------------------------
{
  const summary = summarizePipelineOutcome({
    plan: undefined,
    ok: true,
    route: 'small_edit',
    diff: { created: [], modified: ['src/App.tsx'], deleted: [] },
    stoppedBecause: 'no_errors',
    prompt: 'change the button color to blue',
  });
  assert.ok(summary.trim().length > 0, 'a small edit with no plan must still produce a usable summary');
  assert.match(summary, /1 modified/);
}

// -- not ok: round limit ------------------------------------------------------
{
  const summary = summarizePipelineOutcome({
    plan: { summary: 'A dashboard.', files: [], risks: [] },
    ok: false,
    route: 'large_change',
    diff: emptyDiff,
    stoppedBecause: 'round_limit',
    prompt: 'build a dashboard',
  });
  assert.ok(summary.trim().length > 0, 'a failed run must still produce a usable summary, never throw the client into the empty-text error');
  assert.match(summary, /maximum number of repair rounds/i);
}

// -- not ok: no progress -------------------------------------------------------
{
  const summary = summarizePipelineOutcome({
    plan: undefined,
    ok: false,
    route: 'small_edit',
    diff: emptyDiff,
    stoppedBecause: 'no_progress',
    prompt: 'corrige le bouton',
  });
  assert.ok(summary.trim().length > 0);
  assert.match(summary, /progressé/, 'French prompts must get a French summary, matching the rest of the app\'s bilingual convention');
}

console.log('multi-agent outcome summary tests passed');
