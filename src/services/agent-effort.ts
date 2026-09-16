import { DEFAULT_AGENT_LOOP_BUDGET, type AgentLoopBudget } from './llm-tool-loop.ts';

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
export const AGENT_EFFORT_LEVELS = ['Low', 'Medium', 'Max Effort'] as const;

export type AgentEffort = (typeof AGENT_EFFORT_LEVELS)[number];

export const DEFAULT_AGENT_EFFORT: AgentEffort = 'Medium';

export function normalizeAgentEffort(value: unknown): AgentEffort {
  const raw = String(value ?? '').trim();
  return (AGENT_EFFORT_LEVELS as readonly string[]).includes(raw) ? (raw as AgentEffort) : DEFAULT_AGENT_EFFORT;
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
  Low: {
    maxSteps: 24,
    maxToolCalls: 64,
    maxDurationMs: 4 * 60_000,
    compactAboveChars: 120_000,
  },
  Medium: { ...DEFAULT_AGENT_LOOP_BUDGET },
  'Max Effort': {
    maxSteps: 120,
    maxToolCalls: 500,
    maxDurationMs: 30 * 60_000,
    compactAboveChars: 480_000,
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
  if (level === 'Low') return 0.6;
  if (level === 'Max Effort') return 2.5;
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
export function scaleRouteBudgetForEffort<
  T extends { maxRounds: number; maxToolCallsPerRound: number; maxStalledRounds: number; runDeadlineMs: number },
>(budget: T, effort: unknown): T {
  const level = normalizeAgentEffort(effort);
  if (level === 'Medium') return budget;
  const factor = level === 'Low' ? 0.5 : 2;
  return {
    ...budget,
    maxRounds: Math.max(1, Math.round(budget.maxRounds * (level === 'Low' ? 0.7 : 1.5))),
    maxToolCallsPerRound: Math.max(6, Math.round(budget.maxToolCallsPerRound * factor)),
    runDeadlineMs: Math.max(60_000, Math.round(budget.runDeadlineMs * factor)),
  };
}
