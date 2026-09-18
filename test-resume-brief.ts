/*
 * Re-entry after a run dies.
 *
 * 35 of 144 turns carry a checkpoint and not one of them failed: `afterRound`
 * fires once a round completes, so the runs that most need a resume point —
 * the ones that died mid-round — are exactly the ones that never wrote one.
 */
import assert from 'node:assert/strict';
import {
  buildResumeBrief,
  isResumableCheckpoint,
  isResumableFailure,
  type ResumeCheckpoint,
} from './src/services/resume-brief.ts';

const base: ResumeCheckpoint = {
  turnId: 'turn_1',
  prompt: 'Crée un tableau de bord analytique avec authentification',
  round: 8,
  planSummary: 'Un tableau de bord protégé par Supabase Auth.',
  planSteps: [{ path: 'src/App.tsx', action: 'edit', rationale: 'Monter les routes' }],
  files: ['src/App.tsx', 'src/lib/supabase.ts'],
  verified: ['build', 'typecheck'],
  outstanding: ['browser_smoke'],
  failure: { code: 'PROVIDER_TIMEOUT', message: 'the provider did not answer' },
  modelId: 'anthropic/claude-sonnet-5',
};

/* Which failures a resume can actually help with. */
{
  for (const code of ['RUN_INTERRUPTED', 'PROVIDER_TIMEOUT', 'run_interrupted', 'SANDBOX_START_FAILED']) {
    assert.ok(isResumableFailure(code), `${code} is a run that was working when it stopped`);
  }
  // Repeating these costs the same and fails the same way: the request is what
  // has to change, not the number of attempts.
  for (const code of ['MODEL_CAPABILITY_UNAVAILABLE', 'PROJECT_BUILD_FORBIDDEN', 'AGENT_CONFIRMATION_REQUIRED', '', null]) {
    assert.ok(!isResumableFailure(code), `${code} cannot be fixed by running it again`);
  }
}

/* A checkpoint has to name its turn and the request, or it cannot be used. */
{
  assert.ok(isResumableCheckpoint(base));
  assert.ok(!isResumableCheckpoint({ ...base, turnId: '' }), 'a checkpoint without a turn cannot be spent once');
  assert.ok(!isResumableCheckpoint({ ...base, prompt: '  ' }), 'a brief with no request instructs nothing');
  assert.ok(!isResumableCheckpoint(null));
  assert.ok(!isResumableCheckpoint('turn_1'));
}

/* The brief carries what a resumed run needs and says the one thing it gets wrong alone. */
{
  const brief = buildResumeBrief(base);
  assert.match(brief, /RESUMING AN INTERRUPTED RUN/);
  assert.match(brief, /do not start over/i, 'the failure mode of a resume is rebuilding what exists');
  assert.match(brief, /Crée un tableau de bord analytique/, 'the original request survives');
  assert.match(brief, /completed 8 rounds/);
  assert.match(brief, /src\/lib\/supabase\.ts/, 'existing files are named so they are not recreated');
  assert.match(brief, /Already verified[\s\S]*build/, 'verified work is not redone');
  assert.match(brief, /Still outstanding[\s\S]*browser_smoke/);
  assert.match(brief, /PROVIDER_TIMEOUT — the provider did not answer/);
}

/* A run that died before its first round says so rather than implying progress. */
{
  const brief = buildResumeBrief({ turnId: 't', prompt: 'Fais une landing', round: 0 });
  assert.match(brief, /stopped before completing a single round/);
  assert.doesNotMatch(brief, /completed 0 rounds/);
}

/* A long file list is bounded: a brief that costs as much as a transcript defeats its purpose. */
{
  const many = Array.from({ length: 120 }, (_, i) => `src/component-${i}.tsx`);
  const brief = buildResumeBrief({ ...base, files: many });
  assert.match(brief, /… and 80 more/, 'the list is truncated with its remainder stated');
  assert.ok(brief.length < 6000, `a brief must stay small, got ${brief.length} characters`);
}

/* Optional sections stay absent rather than appearing empty. */
{
  const brief = buildResumeBrief({ turnId: 't', prompt: 'Ajoute un bouton', round: 2 });
  assert.doesNotMatch(brief, /Already verified/);
  assert.doesNotMatch(brief, /Still outstanding/);
  assert.doesNotMatch(brief, /Why it stopped/);
  assert.match(brief, /Finish what is outstanding/);
}

console.log('resume brief tests passed');

/*
 * And the wiring, asserted on the source: a resume that is written but never
 * read, or read but never spent, is the shape this feature already had —
 * `saveDurableRunCheckpoint` has sat in `server.ts` unreferenced since it was
 * written.
 */
{
  const server = await import('node:fs').then(fs => fs.readFileSync('server.ts', 'utf8'));

  assert.match(server, /await saveResumeCheckpointForTurn\(\{/,
    'a run that dies leaves a resume point — `afterRound` only fires when a round succeeds');
  assert.match(server, /const resumeFrom = await consumeResumeCheckpoint\(/,
    'the next run reads it');
  assert.match(server, /prompt: pipelinePrompt,/,
    'and the brief actually reaches the model');
  assert.match(server, /const \{ resume: _spent, \.\.\.rest \} = metadata;/,
    'the brief is spent as it is read, so it cannot be replayed into a second run');
  assert.match(server, /if \(resume\.turnId === currentTurnId\) return null;/,
    'a turn never resumes from itself');

  const pipelineCall = server.slice(server.indexOf('const outcome = await runMultiAgentPipeline({'));
  assert.ok(
    pipelineCall.indexOf('prompt: pipelinePrompt') < pipelineCall.indexOf('});'),
    'the resumed prompt is the one passed to the pipeline',
  );
}

console.log('resume wiring tests passed');
