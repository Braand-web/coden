/**
 * The knobs of model routing, as data.
 *
 * Which model Auto picks, and when it changes its mind mid-run, depends on a
 * handful of weights and limits. They used to be constants scattered through
 * the selector and the pipeline (`escalations >= 2`, "cheapest first", …).
 * They live here, once, with bounded overrides from `CODEN_ROUTING_POLICY`
 * (a JSON object) so an operator can retune routing from the environment
 * without a deploy of code — and cannot, by a typo, produce a policy that
 * spends without limit or never escalates: every value is clamped.
 *
 * `CODEN_ROUTER_V2=0` turns the whole redesign off (scored selection, the
 * supervisor, per-role models) and restores the previous behaviour, which is
 * the rollback.
 */

import { normalizeRoutingMode, ROUTING_MODES, ROUTING_MODE_LABELS, type RoutingMode } from '../lib/routing-mode.ts';
export { normalizeRoutingMode, ROUTING_MODES, ROUTING_MODE_LABELS, type RoutingMode };
export type PolicyComplexity = 'simple' | 'medium' | 'complex' | 'extreme';

export type ModeWeights = {
  /** What one step of strength above the bar is worth. */
  quality: number;
  /** What one unit of (log) price costs the score. */
  cost: number;
  /** What a faster model is worth when someone is waiting. */
  speed: number;
};

export type RoutingPolicy = {
  modes: Record<RoutingMode, ModeWeights>;
  /** Value of strength above the bar, by how hard the task is. */
  overshoot: Record<PolicyComplexity, number>;
  /**
   * Value of total capability (all five dimensions), by how hard the task is.
   * Only the deciding dimension counts against the bar; this is what lets the
   * strongest model win an extreme task over an equally-rated cheaper one.
   */
  headroom: Record<PolicyComplexity, number>;
  /**
   * At `extreme` difficulty, outside Économique, price stops counting against a
   * model and the strongest one wins outright — the promise Auto has always
   * made for the hardest work. The plan and the credits still gate who is
   * reachable, and a low balance still steps down.
   */
  extremePrefersStrongest: boolean;
  /** Extra weight on price when the credits left are few (multiplier). */
  lowCreditCostMultiplier: number;
  /** "Few" credits: this many times the model's own per-action floor. */
  lowCreditFloors: number;
  /** Escalations one run may make before Auto stops climbing. */
  maxEscalations: number;
  /** Rounds that must pass after a switch before another is allowed. */
  minRoundsBetweenSwitches: number;
  /** Clean rounds in a row that let Auto step back down to a cheaper model. */
  cleanRoundsToDeescalate: number;
  /** Weight of a measured success rate against the static strengths. */
  learnedWeight: number;
};

export const DEFAULT_ROUTING_POLICY: RoutingPolicy = {
  modes: {
    economy: { quality: 1.0, cost: 3.2, speed: 0.6 },
    balanced: { quality: 1.6, cost: 1.4, speed: 0.5 },
    performance: { quality: 2.6, cost: 0.35, speed: 0.2 },
  },
  overshoot: { simple: 0.15, medium: 0.5, complex: 1.0, extreme: 1.5 },
  headroom: { simple: 0, medium: 0, complex: 0.06, extreme: 0.4 },
  extremePrefersStrongest: true,
  lowCreditCostMultiplier: 2,
  lowCreditFloors: 4,
  maxEscalations: 3,
  minRoundsBetweenSwitches: 1,
  cleanRoundsToDeescalate: 2,
  learnedWeight: 3,
};

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

let cached: { raw: string; policy: RoutingPolicy } | null = null;

/** The policy in force: the defaults, with the environment's validated overrides on top. */
export function loadRoutingPolicy(env: Record<string, string | undefined> = process.env): RoutingPolicy {
  const raw = String(env.CODEN_ROUTING_POLICY || '').trim();
  if (!raw) return DEFAULT_ROUTING_POLICY;
  if (cached?.raw === raw) return cached.policy;
  let policy = DEFAULT_ROUTING_POLICY;
  try {
    const override = JSON.parse(raw) as Partial<RoutingPolicy> & { modes?: Partial<Record<RoutingMode, Partial<ModeWeights>>> };
    const base = DEFAULT_ROUTING_POLICY;
    policy = {
      modes: Object.fromEntries(ROUTING_MODES.map(mode => [mode, {
        quality: clamp(override.modes?.[mode]?.quality, 0, 10, base.modes[mode].quality),
        cost: clamp(override.modes?.[mode]?.cost, 0, 10, base.modes[mode].cost),
        speed: clamp(override.modes?.[mode]?.speed, 0, 5, base.modes[mode].speed),
      }])) as RoutingPolicy['modes'],
      overshoot: Object.fromEntries((Object.keys(base.overshoot) as PolicyComplexity[]).map(level => [level, clamp(override.overshoot?.[level], 0, 4, base.overshoot[level])])) as RoutingPolicy['overshoot'],
      headroom: Object.fromEntries((Object.keys(base.headroom) as PolicyComplexity[]).map(level => [level, clamp(override.headroom?.[level], 0, 2, base.headroom[level])])) as RoutingPolicy['headroom'],
      extremePrefersStrongest: typeof override.extremePrefersStrongest === 'boolean' ? override.extremePrefersStrongest : base.extremePrefersStrongest,
      lowCreditCostMultiplier: clamp(override.lowCreditCostMultiplier, 1, 6, base.lowCreditCostMultiplier),
      lowCreditFloors: clamp(override.lowCreditFloors, 1, 50, base.lowCreditFloors),
      // Bounded so a typo cannot make a run climb, or refuse to climb, without limit.
      maxEscalations: Math.round(clamp(override.maxEscalations, 0, 5, base.maxEscalations)),
      minRoundsBetweenSwitches: Math.round(clamp(override.minRoundsBetweenSwitches, 0, 5, base.minRoundsBetweenSwitches)),
      cleanRoundsToDeescalate: Math.round(clamp(override.cleanRoundsToDeescalate, 1, 6, base.cleanRoundsToDeescalate)),
      learnedWeight: clamp(override.learnedWeight, 0, 10, base.learnedWeight),
    };
  } catch {
    console.warn('[coden:routing_policy_invalid]', { action: 'defaults used' });
  }
  cached = { raw, policy };
  return policy;
}

/** The kill switch: `CODEN_ROUTER_V2=0` restores the previous routing everywhere. */
export function routerV2Enabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CODEN_ROUTER_V2 !== '0';
}
