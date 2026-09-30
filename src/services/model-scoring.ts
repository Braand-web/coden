/**
 * How the eligible models are ranked.
 *
 * The gates in `model-selection.ts` say what a model may not do (plan, credits,
 * capability, context). Among the models that pass, this says which one is the
 * best value *for this request, in this mode*: how far above the bar it is on
 * the dimension that decides the task, what it costs at its real live price,
 * how fast it answers, how well it has actually done on this kind of task, and
 * whether it is the role model the router was tuned around.
 *
 * It is a pure function of its inputs, so a decision can be replayed and
 * explained: the parts of every score travel with the choice.
 */
import type { ModelStrength } from '../config/ai-models.ts';
import type { PolicyComplexity, RoutingMode, RoutingPolicy } from './routing-policy.ts';

export const STRENGTH_RANK: Record<ModelStrength, number> = { low: 0, medium: 1, high: 2, frontier: 3 };

export type ScoreInput = {
  modelId: string;
  /** Strength on the dimension that decides this task, and on the four others. */
  deciding: ModelStrength;
  others: ModelStrength[];
  /** The strength the task needs (0–3): every candidate here already clears it. */
  required: number;
  complexity: PolicyComplexity;
  mode: RoutingMode;
  speed: 'fast' | 'balanced' | 'deliberate';
  reliability: 'standard' | 'high' | 'experimental';
  /** The model's real blended price, USD per million tokens (live when known). */
  costPerMillion: number;
  /** The role model the router was built around for this task. */
  preferred: boolean;
  /** An experiment's push toward this model (0 outside an experiment arm). */
  boost?: number;
  /** Someone is waiting on the answer. */
  interactive: boolean;
  /** Success-rate advantage over its peers on this task, −1…+1, 0 without evidence. */
  learnedDelta: number;
  /** Few credits left: price counts for more. */
  lowCredits: boolean;
};

export type ScoreParts = { quality: number; cost: number; speed: number; role: number; learned: number };
export type Scored = { modelId: string; score: number; parts: ScoreParts };

const SPEED_BONUS = { fast: 1, balanced: 0, deliberate: -1 } as const;
const RELIABILITY_BONUS = { high: 0.3, standard: 0, experimental: -0.6 } as const;

export function scoreModel(input: ScoreInput, policy: RoutingPolicy): Scored {
  const weights = policy.modes[input.mode];
  const over = Math.max(0, STRENGTH_RANK[input.deciding] - input.required);
  const otherMean = input.others.length ? input.others.reduce((sum, strength) => sum + STRENGTH_RANK[strength], 0) / input.others.length : 0;
  // Strength beyond the bar is worth more the harder the task is, and the
  // other dimensions and the track record only break ties between equals.
  const total = STRENGTH_RANK[input.deciding] + input.others.reduce((sum, strength) => sum + STRENGTH_RANK[strength], 0);
  const quality = weights.quality * (over * policy.overshoot[input.complexity] + otherMean * 0.3 + total * policy.headroom[input.complexity] + RELIABILITY_BONUS[input.reliability]);
  // Price on a log scale: 0.95 → 12 $/M is a real step, 12 → 30 is a smaller one.
  const hardness = { simple: 0.7, medium: 1, complex: 1.25, extreme: 1.6 }[input.complexity];
  const logCost = Math.log10(1 + Math.max(0, input.costPerMillion));
  // The hardest work, outside Économique, goes to the strongest model and — among
  // equally strong ones — the one that costs the most, as it always has; unless
  // credits are running low, when price counts again.
  const seeksBest = policy.extremePrefersStrongest && input.complexity === 'extreme' && input.mode !== 'economy' && !input.lowCredits;
  const cost = seeksBest
    ? 0.2 * logCost
    : -weights.cost * logCost * (input.lowCredits ? policy.lowCreditCostMultiplier : 1) / hardness;
  const speed = input.interactive ? weights.speed * SPEED_BONUS[input.speed] : 0;
  const role = (input.preferred ? 0.4 : 0) + (input.boost || 0);
  const learned = input.learnedDelta * policy.learnedWeight;
  const parts: ScoreParts = { quality, cost, speed, role, learned };
  return { modelId: input.modelId, score: quality + cost + speed + role + learned, parts };
}

/** Best first; ties fall to the cheaper model, then the id, so the order never flickers. */
export function rankScored(scored: Scored[], cost: (modelId: string) => number): Scored[] {
  return [...scored].sort((a, b) => b.score - a.score || cost(a.modelId) - cost(b.modelId) || a.modelId.localeCompare(b.modelId));
}
