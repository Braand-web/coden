/**
 * How much verification and polish a run can afford.
 *
 * Every extra step that makes a generated app better costs something: the
 * specialists and the design review are model calls the customer pays for,
 * the browser journeys and the exploration are wall-clock time. Running all
 * of them for someone with three credits left spends their last build on
 * checks; running none of them for someone who asked for Ultra effort hands
 * them a first draft.
 *
 * One decision, taken once per run from what the user has and what they asked
 * for, instead of each step guessing on its own.
 */

import type { AgentEffort } from './agent-effort.ts';
import type { PipelineRoute } from './edit-intent.ts';

export type QualityTier = 'lean' | 'standard' | 'premium';

export type QualityPolicy = {
  tier: QualityTier;
  /** Specialist pre-analysis before planning (model calls). */
  specialists: boolean;
  maxSpecialists: number;
  specialistTimeoutMs: number;
  /** Planner writes acceptance journeys, executed in the browser (no model cost). */
  acceptance: boolean;
  /** Follow internal links and click visible controls (no model cost). */
  explore: boolean;
  /** Screenshot review by a vision model and one polish round (model cost). */
  designReview: boolean;
};

/** Below this balance a run keeps every credit for the build itself. */
export const LEAN_CREDIT_THRESHOLD = 5;
/** From this balance, with a high effort or a business plan, a run gets the full treatment. */
export const PREMIUM_CREDIT_THRESHOLD = 50;

export function resolveQualityPolicy(input: {
  route: PipelineRoute;
  credits?: number;
  effort?: AgentEffort;
  plan?: string;
}): QualityPolicy {
  const credits = typeof input.credits === 'number' && Number.isFinite(input.credits) ? input.credits : undefined;
  const plan = String(input.plan || '').toLowerCase();
  const effort = input.effort || 'Medium';
  const tier: QualityTier = effort === 'Low' || (credits !== undefined && credits < LEAN_CREDIT_THRESHOLD)
    ? 'lean'
    : (effort === 'High' || effort === 'Ultra' || plan === 'business' || plan === 'enterprise') && (credits === undefined || credits >= PREMIUM_CREDIT_THRESHOLD)
      ? 'premium'
      : 'standard';

  // A small edit is a targeted change: no pre-analysis, no journeys, no review.
  if (input.route === 'small_edit') {
    return { tier, specialists: false, maxSpecialists: 0, specialistTimeoutMs: 0, acceptance: false, explore: false, designReview: false };
  }
  const building = input.route === 'new_project';
  if (tier === 'lean') {
    return { tier, specialists: false, maxSpecialists: 0, specialistTimeoutMs: 0, acceptance: true, explore: true, designReview: false };
  }
  if (tier === 'premium') {
    return { tier, specialists: true, maxSpecialists: 5, specialistTimeoutMs: 30_000, acceptance: true, explore: true, designReview: true };
  }
  return {
    tier,
    specialists: building,
    maxSpecialists: 3,
    specialistTimeoutMs: 20_000,
    acceptance: true,
    explore: true,
    designReview: building,
  };
}
