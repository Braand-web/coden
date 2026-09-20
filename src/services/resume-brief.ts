/**
 * Re-entering a run that died, from what survived it.
 *
 * A run that fails at round eight of twelve loses nothing it wrote — the files
 * are on disk and in `project_files`, saved by `onSnapshot` after every round.
 * What it loses is the conversation: `runLlmToolLoop` holds its `messages` in
 * memory and nothing is written between steps.
 *
 * Replaying that conversation is not an option here and would not be the right
 * one anyway. The journal records `tool_call` items with no results and
 * `assistant_message` items with no content — 144 of them, none carrying a
 * single character — so there is nothing to replay from. Building that would
 * mean persisting a full transcript on every step, at a cost paid by every run
 * to serve the few that fail.
 *
 * A brief is cheaper and stronger. It says what the plan was, what exists now,
 * what has been verified and what went wrong, in a few thousand tokens instead
 * of the hundreds of thousands a transcript costs. And because it is ordinary
 * text rather than provider-specific blocks, it survives a change of model —
 * which is the same problem seen from the other side, and the reason one design
 * answers both.
 *
 * Pure by construction: it reads a checkpoint and returns a prompt. Everything
 * that touches a database or a sandbox stays with its caller.
 */

export type ResumePlanStep = {
  path: string;
  action?: string;
  rationale?: string;
};

export type ResumeCheckpoint = {
  /** The turn this checkpoint belongs to, so a brief cannot be used twice. */
  turnId: string;
  /** What the user asked for in the first place. */
  prompt: string;
  /** The last round that completed. Zero means the run died before any did. */
  round: number;
  /** The plan the run was following, when it had one. */
  planSummary?: string;
  planSteps?: ResumePlanStep[];
  /** Files that exist right now, as the sandbox and `project_files` hold them. */
  files?: string[];
  /** Checks that passed on the last completed round. */
  verified?: string[];
  /** Checks that failed or never ran. */
  outstanding?: string[];
  /** Why the run stopped. */
  failure?: { code?: string; message?: string };
  modelId?: string;
};

/** A checkpoint worth resuming from: it names its turn and the request. */
export function isResumableCheckpoint(value: unknown): value is ResumeCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ResumeCheckpoint>;
  return Boolean(
    typeof candidate.turnId === 'string' && candidate.turnId.trim()
    && typeof candidate.prompt === 'string' && candidate.prompt.trim(),
  );
}

/**
 * Failures a resume can actually help with.
 *
 * An interrupted connection or a provider timeout stopped a run that was
 * working; re-entering it continues that work. A capability or plan refusal
 * stopped a run that could never have succeeded as asked, and resuming it
 * would fail the same way at the same cost — those are answered by fixing the
 * request, not by repeating it.
 */
const RESUMABLE_FAILURES = new Set([
  'RUN_INTERRUPTED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_REQUEST_FAILED',
  'PROVIDER_CIRCUIT_OPEN',
  'AGENT_EXECUTION_FAILED',
  'SANDBOX_START_FAILED',
]);

export function isResumableFailure(diagnosticCode: unknown): boolean {
  return RESUMABLE_FAILURES.has(String(diagnosticCode || '').trim().toUpperCase());
}

const MAX_FILES_LISTED = 40;
const MAX_STEPS_LISTED = 20;

function bullets(items: readonly string[], limit: number): string {
  const shown = items.slice(0, limit).map(item => `- ${item}`);
  if (items.length > limit) shown.push(`- … and ${items.length - limit} more`);
  return shown.join('\n');
}

/**
 * The brief handed to the model that picks the run back up.
 *
 * Written as instructions rather than as a transcript, and explicit about the
 * one thing a resumed run gets wrong on its own: rebuilding what already
 * exists. The files are listed for that reason — not as context to read, but
 * as work not to repeat.
 */
export function buildResumeBrief(checkpoint: ResumeCheckpoint): string {
  const sections: string[] = [];

  sections.push(
    'RESUMING AN INTERRUPTED RUN.',
    '',
    'A previous run on this project stopped before it finished. Its files were saved and are already in the workspace. Continue that work — do not start over, and do not recreate files that already exist.',
    '',
    `Original request: ${checkpoint.prompt.trim()}`,
  );

  if (checkpoint.round > 0) {
    sections.push('', `It completed ${checkpoint.round} round${checkpoint.round === 1 ? '' : 's'} before stopping.`);
  } else {
    sections.push('', 'It stopped before completing a single round, so little or nothing may have been written yet.');
  }

  if (checkpoint.planSummary?.trim()) {
    sections.push('', 'The plan it was following:', checkpoint.planSummary.trim());
  }

  if (checkpoint.planSteps?.length) {
    sections.push('', 'Planned changes:', bullets(
      checkpoint.planSteps.map(step => [step.path, step.action && `(${step.action})`, step.rationale && `— ${step.rationale}`].filter(Boolean).join(' ')),
      MAX_STEPS_LISTED,
    ));
  }

  if (checkpoint.files?.length) {
    sections.push('', 'Files that already exist — read them before changing them, and never rewrite one wholesale that is already correct:', bullets(checkpoint.files, MAX_FILES_LISTED));
  }

  if (checkpoint.verified?.length) {
    sections.push('', 'Already verified, so do not redo:', bullets(checkpoint.verified, MAX_STEPS_LISTED));
  }

  if (checkpoint.outstanding?.length) {
    sections.push('', 'Still outstanding:', bullets(checkpoint.outstanding, MAX_STEPS_LISTED));
  }

  const failureMessage = checkpoint.failure?.message?.trim();
  const failureCode = checkpoint.failure?.code?.trim();
  if (failureMessage || failureCode) {
    sections.push('', `Why it stopped: ${[failureCode, failureMessage].filter(Boolean).join(' — ')}`);
    sections.push('If that failure came from the environment rather than from the code, carry on; if the code caused it, fix that first.');
  }

  sections.push('', 'Finish what is outstanding and verify it, then stop.');
  return sections.join('\n');
}
