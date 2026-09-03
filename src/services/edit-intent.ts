/**
 * Which of three shapes a request is, and what each needs.
 *
 * The old generation path had one shape: ask for the whole application again,
 * whether the request was "build me a CRM" or "make the button blue." A small
 * edit paid the same JSON-blob cost as a new project, and carried the same
 * risk of losing an unrelated file the previous attempt got right.
 *
 * This does not re-derive intent from the prompt text — the existing
 * classifier in `server.ts` already does that well, with heuristics tuned
 * against real traffic (`wantsComplexWork`, `nextAction`, `hasFiles`). What
 * was missing was translating its answer into a pipeline shape: whether a
 * planner runs at all, and if not, what instruction a direct edit gets in its
 * place. `PipelineRouteInput` is a deliberately small structural subset of
 * the real `IntentDecision` — server.ts is an entrypoint script, not a
 * module, so nothing here imports its types; TypeScript's structural typing
 * lets the real decision object satisfy this shape without either file
 * knowing about the other.
 */

import type { TaskKind } from './model-selection.ts';

export type PipelineRoute = 'new_project' | 'small_edit' | 'large_change';

export type PipelineRouteInput = {
  /** The classifier's resolved intent — only some of these write code at all. */
  intent: string;
  /** The classifier's next action, when it already decided one is required. */
  nextAction?: string;
  /** Whether the project has files to edit, as opposed to nothing yet. */
  hasFiles: boolean;
};

/** Intents that reach the coder loop at all. Everything else — conversation, verify, deploy guidance, a clarifying question — never touches a sandbox. */
const CODE_INTENTS = new Set(['build', 'edit', 'debug_fix']);

/** `nextAction` values that mean the existing classifier already asked for a plan. */
const PLAN_REQUIRED_ACTIONS = new Set(['plan_then_build', 'plan_only']);

/**
 * Which pipeline shape a request needs, or `null` when it needs none.
 *
 * The rule is two facts, not a re-reading of the prompt: is there anything to
 * edit, and did the classifier already decide this needs a plan. A project
 * with no files cannot be "edited" regardless of how simple the request
 * sounds, so it always takes the planner; a project with files skips the
 * planner only when the classifier itself judged the change simple enough not
 * to need one.
 */
export function resolvePipelineRoute(input: PipelineRouteInput): PipelineRoute | null {
  if (!CODE_INTENTS.has(input.intent)) return null;
  if (!input.hasFiles) return 'new_project';
  if (input.nextAction && PLAN_REQUIRED_ACTIONS.has(input.nextAction)) return 'large_change';
  return 'small_edit';
}

/**
 * The task a route implies, for `selectModelForAgent`.
 *
 * This is the other half of "a small edit is cheap": `code_edit` carries a
 * lower competence bar than `code_generation` in the selector's table, so a
 * button-colour change is routed to whichever model is cheapest that can
 * still make a correct one-file change, not whichever model the same request
 * would need if it were building the file from nothing.
 */
export function taskKindForRoute(route: PipelineRoute): TaskKind {
  return route === 'small_edit' ? 'code_edit' : 'code_generation';
}

/**
 * The first round's instruction for a direct edit.
 *
 * `new_project` and `large_change` get their first-round instruction from the
 * planner's approved `BuildPlan`; `small_edit` skips the planner entirely, so
 * something still has to tell the coder loop what to do. This is that
 * instruction — biased explicitly toward `edit_file` over `write_file` and
 * toward touching nothing the request did not ask for, because those are
 * exactly the two ways a "small edit" quietly becomes a regeneration.
 */
export function buildEditInstruction(prompt: string): string {
  return [
    'This is a small, targeted change to an existing, working application. Make exactly the change requested — nothing more.',
    'Read the file the request implies before changing it. Prefer edit_file over write_file for an existing file: replacing only the part that needs to change is what keeps this a small edit instead of a rewrite.',
    'Do not touch any file the request does not require. Touching an unrelated file is this task failing at the one thing it exists to do.',
    '',
    `Request: ${String(prompt || '').trim()}`,
  ].join('\n');
}
