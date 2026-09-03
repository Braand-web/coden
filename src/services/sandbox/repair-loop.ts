/**
 * Repairing a broken project with tools instead of regenerating it.
 *
 * When validation fails, the generation path's answer was to ask the model for
 * the whole application again. That is expensive, slow, and unsafe: a
 * regeneration is a fresh chance to lose a file the previous one got right,
 * and it fixes a missing import by rewriting forty files.
 *
 * Here the model is given the compiler's own errors and the tools to act on
 * them: read the file the error names, edit the line, install the package that
 * is missing. Then the project's toolchain is asked again. That loop either
 * converges or it does not, and both are reported honestly.
 *
 * Three limits, each for a failure this would otherwise have:
 *
 * - A bounded number of rounds, because a model that cannot fix an error will
 *   keep not fixing it, and an unbounded loop turns one bad generation into a
 *   sustained cost.
 * - No progress, no continue. If a round leaves the same number of errors, the
 *   next round has nothing new to work with; going again is spending money to
 *   watch the model rephrase itself.
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

const DEFAULT_MAX_ROUNDS = 3;
const DEFAULT_MAX_TOOL_CALLS = 12;

function countErrors(report: ValidationReport): number {
  return report.problems.filter(problem => problem.severity === 'error').length;
}

export async function runRepairLoop(input: {
  sandbox: ProjectSandbox;
  turn: RepairTurn;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
  onEvent?: (event: RepairEvent) => void;
  /** Validation already run by the caller, so the first round costs nothing extra. */
  initialReport?: ValidationReport;
}): Promise<RepairOutcome> {
  const emit = input.onEvent || (() => {});
  const maxRounds = input.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCalls = input.maxToolCallsPerRound ?? DEFAULT_MAX_TOOL_CALLS;
  const rounds: RepairRound[] = [];

  let report = input.initialReport ?? await validateProject(input.sandbox, { skipBuild: true });
  if (report.ok) {
    emit({ type: 'repair_finished', ok: true, rounds: 0, reason: 'no_errors' });
    return { ok: true, rounds, finalReport: report, stoppedBecause: 'no_errors' };
  }

  const finish = (reason: RepairOutcome['stoppedBecause']): RepairOutcome => {
    emit({ type: 'repair_finished', ok: report.ok, rounds: rounds.length, reason });
    return { ok: report.ok, rounds, finalReport: report, stoppedBecause: reason };
  };

  for (let round = 1; round <= maxRounds; round += 1) {
    const errorsBefore = countErrors(report);
    emit({ type: 'repair_round_started', round, errors: errorsBefore });

    const touched = new Set<string>();
    let restartRequired = false;
    const tools = createSandboxTools(input.sandbox.projectId, {
      onChange: paths => paths.forEach(path => touched.add(path)),
    });

    let calls = 0;
    const guardedCall = async (name: string, args: Record<string, unknown>) => {
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

    await input.turn({
      instruction: buildRepairInstruction(report),
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

    report = await validateProject(input.sandbox, { skipBuild: true });
    const errorsAfter = countErrors(report);
    const filesTouched = [...touched];
    rounds.push({ round, errorsBefore, errorsAfter, toolCalls: calls, filesTouched, restarted: restartRequired });
    emit({ type: 'repair_round_finished', round, errorsBefore, errorsAfter, filesTouched });

    if (report.ok) return finish('fixed');
    // Fewer errors is progress even without a clean result — the next round
    // gets a shorter list. The same count or worse means the round taught the
    // model nothing, and another one will teach it the same.
    if (errorsAfter >= errorsBefore) return finish('no_progress');
  }

  return finish('round_limit');
}
