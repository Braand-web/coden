import { DEFAULT_AGENT_LOOP_BUDGET, type AgentLoopBudget } from './llm-tool-loop.ts';
import type { ReasoningLevel } from './openrouter-request.ts';

/*
 * Effort, and what it actually buys.
 *
 * The composer offers three levels beside the prompt. A control like that is
 * only worth having if it changes something real: a label that reads "Max
 * Effort" while the run does exactly what "Low" does is a promise the product
 * cannot keep, and the customer discovers it by paying for it.
 *
 * So the three levels map onto `AgentLoopBudget`, which is what genuinely
 * bounds a run — the loop counts the user's time and tool calls, not
 * iterations. Medium IS the existing default, unchanged, so today's behaviour
 * keeps its exact shape and the other two move away from it in one direction
 * each.
 */
export const AGENT_EFFORT_LEVELS = ['None', 'Low', 'Medium', 'High', 'Ultra'] as const;

export type AgentEffort = (typeof AGENT_EFFORT_LEVELS)[number];

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'Medium';

/** What the composer shows. The values above are the wire format. */
export const AGENT_EFFORT_LABELS: Record<AgentEffort, string> = {
  None: 'Aucun',
  Low: 'Bas',
  Medium: 'Moyen',
  High: 'Élevé',
  Ultra: 'Maximum',
};

/**
 * The reasoning a level sends to the model, through OpenRouter's unified
 * `reasoning` parameter: nothing, `effort` low/medium/high, or — at Maximum —
 * an explicit `max_tokens` budget at the model's own ceiling.
 */
export const EFFORT_REASONING_LEVELS: Record<AgentEffort, ReasoningLevel> = {
  None: 'none',
  Low: 'low',
  Medium: 'medium',
  High: 'high',
  Ultra: 'max',
};

export function reasoningLevelForEffort(effort: unknown): ReasoningLevel {
  return EFFORT_REASONING_LEVELS[normalizeAgentEffort(effort)];
}

/*
 * `Max Effort` was the old top level and cost 2.5x Medium. `High` costs the
 * same 2.5x, so a stored preference lands on the level the user was actually
 * paying for rather than being promoted into Ultra — which costs twice again —
 * by a rename they did not ask for.
 */
const LEGACY_EFFORT_ALIASES: Record<string, AgentEffort> = {
  'Max Effort': 'High',
  max_effort: 'High',
};

export function normalizeAgentEffort(value: unknown): AgentEffort {
  const raw = String(value ?? '').trim();
  if ((AGENT_EFFORT_LEVELS as readonly string[]).includes(raw)) return raw as AgentEffort;
  return LEGACY_EFFORT_ALIASES[raw] || DEFAULT_AGENT_EFFORT;
}

/*
 * Low is a third of the default's time and a third of its tool calls — enough
 * for a question or a one-file edit, and short enough that a user who picked
 * it is not surprised by the bill. Max Effort is 2.5x on both, with the
 * compaction threshold raised to match: a longer run that keeps the same
 * transcript ceiling just digests its own history sooner, which buys nothing.
 *
 * `maxSteps` moves least. It is a backstop against a model that loops without
 * progressing, not the thing that ends a healthy run, so it does not need to
 * scale with the time budget.
 */
const EFFORT_BUDGETS: Record<AgentEffort, AgentLoopBudget> = {
  // No reasoning is not less work: the loop gets the same room as Low.
  None: {
    maxSteps: 24,
    maxToolCalls: 64,
    maxDurationMs: 4 * 60_000,
    compactAboveChars: 120_000,
  },
  Low: {
    maxSteps: 24,
    maxToolCalls: 64,
    maxDurationMs: 4 * 60_000,
    compactAboveChars: 120_000,
  },
  Medium: { ...DEFAULT_AGENT_LOOP_BUDGET },
  High: {
    maxSteps: 120,
    maxToolCalls: 500,
    maxDurationMs: 30 * 60_000,
    compactAboveChars: 480_000,
  },
  /*
   * Ultra is the level where the model is allowed to think, not just to work
   * longer — the reasoning budget is what separates it from High, and that is
   * billed at the output rate. Its loop budget grows less than its price does
   * for that reason: doubling the wall clock is cheap, and letting a frontier
   * model reason for 48k tokens a call is not.
   */
  Ultra: {
    maxSteps: 200,
    maxToolCalls: 900,
    maxDurationMs: 60 * 60_000,
    compactAboveChars: 720_000,
  },
};

/** The budget a level buys. Always a copy — callers spread it into a loop. */
export function budgetForEffort(effort: unknown): AgentLoopBudget {
  return { ...EFFORT_BUDGETS[normalizeAgentEffort(effort)] };
}

/*
 * What the level costs, relative to Medium.
 *
 * A run that may take 2.5x as long and make 2.5x as many tool calls costs
 * more, and the estimate has to say so before the work starts — otherwise the
 * credit gate approves a Max Effort run against a Medium price and the
 * shortfall surfaces the way it did in September: after the provider was paid.
 *
 * Below one for Low, because a level that costs the same as Medium while doing
 * less is a level nobody should pick.
 */
export function effortCostMultiplier(effort: unknown): number {
  const level = normalizeAgentEffort(effort);
  if (level === 'None') return 0.5;
  if (level === 'Low') return 0.6;
  if (level === 'High') return 2.5;
  /*
   * Ultra is priced at twice High because it buys a different thing.
   *
   * High extends the loop; Ultra also hands the model a reasoning budget, and
   * reasoning is billed at the output rate — 48k tokens on Opus 5 is $1.20 of
   * thinking in a single call, before a word of the answer. The multiplier is
   * an expectation, not the worst case: adaptive thinking spends what the task
   * needs and usually far less than the ceiling, which is why this is 5x and
   * not the 12x a full budget on every call would imply. The measured cost is
   * recorded beside the charge, so the number can be corrected from evidence
   * rather than from this comment.
   */
  if (level === 'Ultra') return 5;
  return 1;
}

/*
 * The same scaling, applied to a route's budget.
 *
 * `budgetForRoute` already gives each route the rounds, tool calls and wall
 * clock it needs; effort widens or narrows that, and does not replace it. A
 * small edit on Max Effort is still a small edit — it gets more room to finish,
 * not the budget of a whole application.
 *
 * Rounds scale least, and never below one: a run that cannot complete a single
 * round cannot produce anything, so "Low" has to mean a shorter run rather
 * than a broken one.
 */
const ROUTE_BUDGET_SCALE: Record<AgentEffort, { rounds: number; toolCalls: number; deadline: number }> = {
  // Less effort is fewer rounds and fewer calls, not less time for the ones
  // it does make: halving the clock cut a Low build off at 5.5 minutes with
  // the app written and a few errors from done.
  None: { rounds: 0.7, toolCalls: 0.5, deadline: 1 },
  Low: { rounds: 0.7, toolCalls: 0.5, deadline: 1 },
  Medium: { rounds: 1, toolCalls: 1, deadline: 1 },
  High: { rounds: 1.5, toolCalls: 2, deadline: 2 },
  // Ultra widens the clock more than the rounds: what it buys is depth per
  // round, which the reasoning budget provides, not more rounds of the same.
  Ultra: { rounds: 2, toolCalls: 3, deadline: 4 },
};

export function scaleRouteBudgetForEffort<
  T extends { maxRounds: number; maxToolCallsPerRound: number; maxStalledRounds: number; runDeadlineMs: number },
>(budget: T, effort: unknown): T {
  const level = normalizeAgentEffort(effort);
  if (level === 'Medium') return budget;
  const scale = ROUTE_BUDGET_SCALE[level];
  return {
    ...budget,
    maxRounds: Math.max(1, Math.round(budget.maxRounds * scale.rounds)),
    maxToolCallsPerRound: Math.max(6, Math.round(budget.maxToolCallsPerRound * scale.toolCalls)),
    runDeadlineMs: Math.max(60_000, Math.round(budget.runDeadlineMs * scale.deadline)),
  };
}
