/**
 * Deciding whether what the coder wrote actually works, and fixing it if not.
 *
 * This is deliberately thin. `validateProject` already asks the project's own
 * toolchain rather than guessing, and `runCoderLoop` already knows how to
 * repair what that toolchain complains about, in mode `'repair'`, with its
 * own bounded rounds and no-progress stop. The reviewer's job is to call
 * those two in order and say what happened — not to reimplement either.
 *
 * The one thing genuinely new here is persistence: each repair round the
 * coder loop reports through its `onEvent` callback becomes a real
 * `HarnessItem`, nested under one `HarnessItem` for the review as a whole.
 * Before this, the only harness activity in a generation was a passive SSE
 * mirror; a Thread's Turn now has an honest record of what a review actually
 * found and did about it, queryable independently of any UI. `harnessContext`
 * is optional so the module still works — inert, but working — when a caller
 * has no harness thread to write into.
 */

import type { ProjectSandbox } from './sandbox/project-sandbox.ts';
import { validateProject, type ValidationReport } from './sandbox/validate.ts';
import { runCoderLoop, type RepairEvent, type RepairOutcome, type RepairTurn } from './sandbox/repair-loop.ts';
import type { CodenAgentHarness } from './agent-harness/harness.ts';

export type ReviewerHarnessContext = {
  harness: CodenAgentHarness;
  threadId: string;
  turnId: string;
};

export type ReviewOutcome = {
  ok: boolean;
  finalReport: ValidationReport;
  repaired: boolean;
  repairOutcome?: RepairOutcome;
};

export async function runReviewerAgent(input: {
  sandbox: ProjectSandbox;
  turn: RepairTurn;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  harnessContext?: ReviewerHarnessContext;
}): Promise<ReviewOutcome> {
  const report = await validateProject(input.sandbox, { skipBuild: true });
  if (report.ok) return { ok: true, finalReport: report, repaired: false };

  // A harness write can fail on its own terms — an unknown turn, a store
  // outage — and none of those are reasons to skip actually reviewing and
  // repairing a broken project. Every write below is best-effort for exactly
  // that reason: recording is degraded, not the review.
  const ctx = input.harnessContext;
  const reviewItem = ctx
    ? await ctx.harness.spawnSubagent({
        turnId: ctx.turnId,
        role: 'reviewer',
        title: 'Review and repair',
        context: { errors: report.problems.length },
      }).catch(() => null)
    : null;

  // Persisted as the loop reports it, not reconstructed afterward from the
  // final outcome alone — a round that regressed and a round that made no
  // difference look identical in a summary but are different facts about
  // what the model tried.
  const onEvent = (event: RepairEvent) => {
    if (!ctx || !reviewItem || event.type !== 'repair_round_finished') return;
    ctx.harness.createItem({
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      parentItemId: reviewItem.id,
      kind: 'verification',
      role: 'reviewer',
      status: event.errorsAfter === 0 ? 'completed' : 'failed',
      title: `Repair round ${event.round}`,
      payload: { errorsBefore: event.errorsBefore, errorsAfter: event.errorsAfter, filesTouched: event.filesTouched },
    }).catch(() => {});
  };

  const repairOutcome = await runCoderLoop({
    sandbox: input.sandbox,
    mode: 'repair',
    initialReport: report,
    turn: input.turn,
    maxRounds: input.maxRounds,
    maxToolCallsPerRound: input.maxToolCallsPerRound,
    onEvent,
  });

  if (ctx && reviewItem) {
    if (repairOutcome.ok) {
      const filesTouched = [...new Set(repairOutcome.rounds.flatMap(round => round.filesTouched))];
      await ctx.harness.completeSubagent(reviewItem.id, `Fixed in ${repairOutcome.rounds.length} round(s).`, filesTouched).catch(() => {});
    } else {
      await ctx.harness.transitionItem(reviewItem.id, 'failed', { reason: repairOutcome.stoppedBecause, rounds: repairOutcome.rounds.length }).catch(() => {});
    }
  }

  return { ok: repairOutcome.ok, finalReport: repairOutcome.finalReport, repaired: true, repairOutcome };
}
