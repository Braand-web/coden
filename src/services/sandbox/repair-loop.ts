/**
 * Building or repairing a project with tools, in the same loop.
 *
 * The old generation path asked the model for the whole application as one
 * JSON document, parsed it, and — on failure — asked for the whole thing
 * again. That is expensive, slow, and unsafe: a regeneration is a fresh
 * chance to lose a file the previous attempt got right, and it fixes a
 * missing import by rewriting forty files.
 *
 * Here the model is given tools instead: read the file an error names, edit
 * the line, install the package that is missing. Then the project's own
 * toolchain is asked again. That loop either converges or it does not, and
 * both are reported honestly.
 *
 * Building and repairing are the same mechanism wearing different framing.
 * Building is "here is what to write" for round one, followed by rounds of
 * "here is what is still broken" until the toolchain is happy — which is
 * exactly what repair already was. `mode` selects only the first round's
 * instruction; the loop, its limits and its stopping rules do not change.
 *
 * Three limits, each for a failure this would otherwise have:
 *
 * - A bounded number of rounds, because a model that cannot fix an error will
 *   keep not fixing it, and an unbounded loop turns one bad generation into a
 *   sustained cost.
 * - No progress, no continue. If a round leaves the same number of errors, the
 *   next round has nothing new to work with; going again is spending money to
 *   watch the model rephrase itself. The exception is a build's first round:
 *   there is no earlier attempt at the same task to compare it against, only
 *   the empty scaffold it started from, so that comparison would end every
 *   build whose first pass introduces any error at all.
 * - A bounded number of tool calls per round, so a single round cannot become
 *   the unbounded loop the round limit was meant to prevent.
 */

import type { ProjectSandbox } from './project-sandbox.ts';
import { createSandboxTools, SANDBOX_TOOL_SCHEMAS } from './sandbox-tools.ts';
import { validateProject, buildRepairInstruction, type ValidationReport } from './validate.ts';

export type RepairRound = {
  round: number;
  errorsBefore: number;
  errorsAfter: number;
  toolCalls: number;
  filesTouched: string[];
  restarted: boolean;
};

export type RepairOutcome = {
  ok: boolean;
  rounds: RepairRound[];
  finalReport: ValidationReport;
  /** Why the loop stopped, in terms a caller can report to a user. */
  stoppedBecause: 'fixed' | 'no_progress' | 'round_limit' | 'no_errors';
};

/**
 * What the caller supplies: one turn of the model, already wired to whatever
 * provider and model the run chose.
 *
 * Deliberately not a provider client. This module's job is the loop and its
 * limits; which model runs it, at what temperature, with what budget, is the
 * orchestrator's decision and changes independently.
 */
export type RepairTurn = (input: {
  instruction: string;
  tools: typeof SANDBOX_TOOL_SCHEMAS;
  call: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxToolCalls: number;
}) => Promise<{ toolCalls: number }>;

export type RepairEvent =
  | { type: 'repair_round_started'; round: number; errors: number }
  | { type: 'repair_round_finished'; round: number; errorsBefore: number; errorsAfter: number; filesTouched: string[] }
  | { type: 'repair_finished'; ok: boolean; rounds: number; reason: RepairOutcome['stoppedBecause'] };

/** Forward-facing names for callers that are building, not only repairing. */
export type CoderLoopRound = RepairRound;
export type CoderLoopOutcome = RepairOutcome;
export type CoderLoopTurn = RepairTurn;
export type CoderLoopEvent = RepairEvent;

/*
 * How much work one run is allowed to be.
 *
 * Three rounds of twelve calls is about thirty-six tool calls for an entire
 * application, and the recorded runs show exactly that shape: a median build
 * finishing in 65 seconds, because it was not permitted to do more. Reading
 * four files, writing six and installing a dependency spends the round.
 *
 * The ceilings are raised and, more importantly, they are no longer what ends
 * a normal run — a wall clock is. `runLlmToolLoop` counts elapsed time and
 * stops on it, so these remain what they should always have been: backstops
 * against a model that loops without progressing, not the budget itself. The
 * loop also stops early on its own no-progress rule, which is what keeps the
 * higher ceiling from turning a hopeless run into a long hopeless run.
 */
const DEFAULT_MAX_ROUNDS = 8;

/**
 * How many rounds in a row may fail to reduce the error count.
 *
 * The rule was one: a single round that did not lower the number ended the
 * run. Its reasoning — the model saw these errors and did not fix them, so it
 * will not fix them next time — holds only while the input is identical, and
 * it stops being true the moment the model is told its last attempt did not
 * help. It is also a poor description of debugging. Fixing one fault
 * routinely uncovers another, a refactor holds the count flat while making the
 * code correct, and a genuine dead end looks the same on round one as a
 * problem that needed two passes.
 *
 * So a stalled round now costs patience rather than the whole run, the model
 * is told plainly that the last attempt changed nothing, and a run that is
 * truly stuck still ends quickly — after this many in a row, or when the run's
 * shared deadline arrives, whichever comes first.
 */
const DEFAULT_MAX_STALLED_ROUNDS = 3;
const DEFAULT_MAX_TOOL_CALLS = 40;

function countErrors(report: ValidationReport): number {
  return report.problems.filter(problem => problem.severity === 'error').length;
}

export async function runCoderLoop(input: {
  sandbox: ProjectSandbox;
  turn: RepairTurn;
  /**
   * `'build'` writes something new; `'repair'` fixes something that already
   * exists. Defaults to `'repair'`, which is every caller before this
   * generalization — their behaviour is unchanged by this parameter existing.
   */
  mode?: 'build' | 'repair';
  /**
   * What to write, for a build's first round — typically the plan the user
   * approved. Required when `mode` is `'build'`: without an instruction the
   * first round would ask the model to write nothing in particular.
   */
  initialInstruction?: string;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  /** Consecutive rounds allowed without reducing the error count. */
  maxStalledRounds?: number;
  onEvent?: (event: RepairEvent) => void;
  /** Validation already run by the caller, so the first round costs nothing extra. */
  initialReport?: ValidationReport;
  signal?: AbortSignal;
  beforeRound?: (round: number) => Promise<string | undefined>;
  afterRound?: (round: RepairRound, report: ValidationReport) => Promise<void>;
  verifyPreview?: () => Promise<ValidationReport>;
}): Promise<RepairOutcome> {
  const mode = input.mode ?? 'repair';
  if (mode === 'build' && !input.initialInstruction) {
    throw new Error('runCoderLoop requires initialInstruction when mode is "build".');
  }

  const emit = input.onEvent || (() => {});
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCalls = input.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS;
  const maxStalledRounds = Math.max(1, input.maxStalledRounds ?? DEFAULT_MAX_STALLED_ROUNDS);
  let stalledRounds = 0;
  const rounds: RepairRound[] = [];

  let report = input.initialReport ?? await validateProject(input.sandbox, { skipBuild: true });
  // A build asked for something that has not been written yet, so an empty,
  // valid scaffold reporting "ok" here is not the outcome — it is the
  // starting line. Exiting on it would report success on an unbuilt project.
  // A repair has nothing to do until something is actually broken.
  if (mode === 'repair' && report.ok) {
    emit({ type: 'repair_finished', ok: true, rounds: 0, reason: 'no_errors' });
    return { ok: true, rounds, finalReport: report, stoppedBecause: 'no_errors' };
  }

  const finish = (reason: RepairOutcome['stoppedBecause']): RepairOutcome => {
    emit({ type: 'repair_finished', ok: report.ok, rounds: rounds.length, reason });
    return { ok: report.ok, rounds, finalReport: report, stoppedBecause: reason };
  };

  for (let round = 1; round <= maxRounds; round += 1) {
    input.signal?.throwIfAborted();
    const steering = await input.beforeRound?.(round);
    const errorsBefore = countErrors(report);
    emit({ type: 'repair_round_started', round, errors: errorsBefore });

    const touched = new Set<string>();
    let restartRequired = false;
    const tools = createSandboxTools(input.sandbox.projectId, {
      onChange: paths => paths.forEach(path => touched.add(path)),
    });

    let calls = 0;
    const guardedCall = async (name: string, args: Record<string, unknown>) => {
      input.signal?.throwIfAborted();
      // The per-round ceiling is enforced here rather than trusted to the
      // model: a run that ignores its budget is exactly the run that needs one.
      if (calls >= maxToolCalls) {
        return { ok: false, error: `Tool budget for this round is spent (${maxToolCalls} calls).`, hint: 'Stop and let the checks run.' };
      }
      calls += 1;
      const result = await tools.call(name, args);
      if ((result as any)?.restartRequired) restartRequired = true;
      return result;
    };

    // Only a build's first round is "write this"; every other round, in
    // either mode, is "here is what the toolchain still does not like" — the
    // one instruction shape a repair has ever had.
    const isBuildRound = mode === 'build' && round === 1;
    /*
     * A stalled round changes what the model is told, not just how many are
     * left. Sending the identical error list again is what made "it will not
     * fix them next time" true; saying the last attempt did not help is new
     * information, and asking for a different approach is the point of another
     * round at all.
     */
    const stallNotice = stalledRounds > 0
      ? `\n\nYour previous ${stalledRounds === 1 ? 'attempt' : `${stalledRounds} attempts`} did not reduce these errors. Do not repeat the same edit. Read the failing file and its imports before changing anything, and fix the cause rather than the symptom.`
      : '';
    const instruction = (isBuildRound ? input.initialInstruction! : buildRepairInstruction(report) + stallNotice)
      + (steering ? `\n\nAdditional user instructions to apply now:\n${steering}` : '');

    await input.turn({
      instruction,
      tools: SANDBOX_TOOL_SCHEMAS,
      call: guardedCall,
      maxToolCalls,
    });

    // A new dependency is not something hot reload can introduce, so the
    // server has to come back before the checks mean anything.
    if (restartRequired && input.sandbox.status().state === 'running') {
      const basePath = input.sandbox.status().basePath || undefined;
      await input.sandbox.stop();
      await input.sandbox.start({ basePath });
    }

    report = await validateProject(input.sandbox);
    input.signal?.throwIfAborted();
    if (report.ok && input.verifyPreview) {
      const preview = await input.verifyPreview();
      report = { ...report, ok:preview.ok, problems:[...report.problems,...preview.problems], ran:{...report.ran,browser:preview.ran.browser}, durationMs:report.durationMs+preview.durationMs };
    }
    const errorsAfter = countErrors(report);
    const filesTouched = [...touched];
    rounds.push({ round, errorsBefore, errorsAfter, toolCalls: calls, filesTouched, restarted: restartRequired });
    await input.afterRound?.(rounds[rounds.length-1], report);
    emit({ type: 'repair_round_finished', round, errorsBefore, errorsAfter, filesTouched });

    if (report.ok) return finish('fixed');
    // Fewer errors is progress even without a clean result — the next round
    // gets a shorter list. Not judged on a build's first round: `errorsBefore`
    // there is the empty scaffold's error count, not an earlier attempt at
    // this task, so it is not a baseline this round can be measured against.
    if (isBuildRound) continue;
    if (errorsAfter < errorsBefore) stalledRounds = 0;
    else if ((stalledRounds += 1) >= maxStalledRounds) return finish('no_progress');
  }

  return finish('round_limit');
}

/**
 * The pre-generalization name, kept for the one caller that has not moved to
 * `runCoderLoop` yet. Behaviour is identical to before this change: `mode`
 * is always `'repair'`, so every branch above that depends on `mode` takes
 * exactly the path it always did.
 */
export function runRepairLoop(
  input: Omit<Parameters<typeof runCoderLoop>[0], 'mode' | 'initialInstruction'>,
): Promise<RepairOutcome> {
  return runCoderLoop({ ...input, mode: 'repair' });
}
