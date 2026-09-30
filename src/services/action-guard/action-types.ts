/**
 * What the action guard reasons about.
 *
 * An action is a tool call, seen from the outside: which tool and which
 * parameters — nothing the agent says about why. The guard never receives the
 * agent's reasoning, its justifications, or any tool result; that is what
 * keeps it from being talked into anything.
 */

export type ActionCategory =
  | 'read'             // looking: files, logs, search, a public documentation page
  | 'project_write'    // changing the user's own project files
  | 'mass_delete'      // many files at once
  | 'install'          // adding a dependency
  | 'shell'            // running a command
  | 'network'          // reaching a page or service outside the project
  | 'third_party'      // acting on a connected service, as the user
  | 'deploy'           // putting the site online
  | 'database'         // migrations, deletions, SQL
  | 'email'            // a real e-mail
  | 'sms'              // a real text message
  | 'payment'          // money
  | 'secrets'          // environment variables, keys
  | 'permissions'      // access rights
  | 'outside_project'  // writing or reading beyond the project
  | 'ui_action'        // a consequential click in the running app
  | 'delegation'       // an instruction handed to a sub-agent
  | 'shared_content';  // a skill or agent that would be shared

/** 1: passes untouched. 2: light automatic check. 3: judged. */
export type ActionTier = 1 | 2 | 3;

export type ToolAction = { tool: string; args: Record<string, unknown> };

export type GuardActor = 'agent' | 'subagent';

export type GuardContext = {
  /** What the person wrote in this conversation, oldest first. The only source of authorisation. */
  userMessages: string[];
  /** The person's and the project's own rules, in their words. */
  rules: string[];
  projectId: string;
  userId?: string;
  organizationId?: string;
  actor?: GuardActor;
};

export type GuardDecisionKind = 'allow' | 'block' | 'ask' | 'pause';

export type GuardStage = 'tier' | 'hard_rule' | 'light_check' | 'fast' | 'model' | 'fallback' | 'cache' | 'mode';

export type GuardDecision = {
  decision: GuardDecisionKind;
  category: ActionCategory;
  tier: ActionTier;
  stage: GuardStage;
  /** One sentence, for the agent (block) or the log. */
  reason: string;
  /** For `ask` and `pause`: the question, in plain words, with no jargon. */
  question?: string;
  /** The rule that decided, when a deterministic one did. */
  rule?: string;
  latencyMs: number;
  cached?: boolean;
  /** What the model would have decided, when it ran in shadow. */
  shadow?: { decision: GuardDecisionKind; reason: string };
};

export type GuardMode = 'off' | 'shadow' | 'enforce';

/** Reads `CODEN_ACTION_GUARD` (off | shadow | enforce). Enforced unless said otherwise; `0` is off. */
export function guardModeFromEnv(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): GuardMode {
  const value = String(env.CODEN_ACTION_GUARD ?? 'enforce').trim().toLowerCase();
  if (value === '0' || value === 'off' || value === 'false') return 'off';
  if (value === 'shadow') return 'shadow';
  return 'enforce';
}

/** `CODEN_ACTION_GUARD_LLM`: the model stage. Shadow (logged, not applied) until it has been watched on real traffic. */
export function guardModelModeFromEnv(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): GuardMode {
  const value = String(env.CODEN_ACTION_GUARD_LLM ?? 'shadow').trim().toLowerCase();
  if (value === '0' || value === 'off' || value === 'false') return 'off';
  if (value === 'enforce' || value === '1') return 'enforce';
  return 'shadow';
}
