/**
 * Routing experiments: a share of runs try a change, the trace says which.
 *
 * Whether a new model earns the role of main executor is a question about
 * outcomes, so it is asked of real runs: a stable share of projects — the same
 * project always lands in the same arm — routes with a push toward the
 * candidate, everyone else routes as before, and every run's trace carries its
 * arm. The dashboard compares the two on success, cost and escalations.
 *
 * Nothing runs unless the model's own flag is on AND a percentage is set, and
 * the push never overrides the gates: plan, credits, capabilities and the
 * pinned choice are all still respected.
 */
import { createHash } from 'node:crypto';

export type ExperimentArm = 'treatment' | 'control';

/** A stable bucket 0–99 for a seed. The same seed never changes arm. */
export function bucketOf(name: string, seed: string): number {
  return createHash('sha256').update(`${name}:${seed}`).digest().readUInt32BE(0) % 100;
}

export function assignArm(name: string, seed: string, percent: number): ExperimentArm {
  const share = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  return bucketOf(name, seed) < share ? 'treatment' : 'control';
}

export const SONNET_55_ID = 'anthropic/claude-sonnet-5.5';
/** Enough to win a close call among the models the plan can reach, never enough to buy a cell the gates refuse. */
export const SONNET_55_BOOST = 2.5;

/**
 * The Sonnet 5.5 experiment for a run: its arm and the push toward the model,
 * or `arm: null` when it is not running (flag off, or 0 %).
 */
export function sonnet55Experiment(env: Record<string, string | undefined>, seed: string): { arm: ExperimentArm | null; boost: Record<string, number> } {
  const percent = Number(env.CODEN_AB_SONNET_55_PERCENT || 0);
  if (env.CODEN_MODEL_SONNET_5_5 !== '1' || !(percent > 0)) return { arm: null, boost: {} };
  const arm = assignArm('sonnet-5.5-main-executor', seed, percent);
  return { arm, boost: arm === 'treatment' ? { [SONNET_55_ID]: SONNET_55_BOOST } : {} };
}
