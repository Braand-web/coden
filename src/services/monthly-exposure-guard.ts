// Monthly exposure guard — Step 6 of the margin-protection plan.
//
// Each plan declares a maximum monthly AI+Cloud cost exposure we are willing to
// absorb for one organization (PLAN_ECONOMICS_GUARDRAILS.maxMonthlyAiCloudExposureUsd).
// This module is the PURE decision core: given a plan's cap and the org's
// month-to-date real USD cost, decide whether the next action would push the org
// past its cap. The server reads the actual numbers and calls evaluateExposure;
// no I/O lives here so the rule is unit-tested deterministically.
//
// A null cap means "unlimited" (enterprise) — always allowed.

export type ExposureEvaluation = {
  allowed: boolean;
  /** null = unlimited. */
  capUsd: number | null;
  monthToDateUsd: number;
  pendingUsd: number;
  projectedUsd: number;
  remainingUsd: number | null;
  /** 0..1 fraction of the cap already consumed (null when unlimited). */
  utilization: number | null;
};

export type EvaluateExposureInput = {
  /** Plan cap in USD, or null for unlimited. */
  capUsd: number | null;
  /** Real provider USD cost already incurred this billing month. */
  monthToDateUsd: number;
  /** Estimated real USD cost of the action about to run. */
  pendingUsd: number;
};

function sanitize(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Decide whether an action may proceed without exceeding the plan's monthly
 * exposure cap. Pure and total: never throws, clamps negatives to 0.
 */
export function evaluateExposure(input: EvaluateExposureInput): ExposureEvaluation {
  const monthToDateUsd = sanitize(input.monthToDateUsd);
  const pendingUsd = sanitize(input.pendingUsd);
  const projectedUsd = monthToDateUsd + pendingUsd;
  const capUsd = input.capUsd != null && Number.isFinite(input.capUsd) && input.capUsd > 0 ? input.capUsd : input.capUsd === null ? null : 0;

  // Unlimited.
  if (capUsd === null) {
    return {
      allowed: true,
      capUsd: null,
      monthToDateUsd,
      pendingUsd,
      projectedUsd,
      remainingUsd: null,
      utilization: null,
    };
  }

  const remainingUsd = Math.max(0, capUsd - monthToDateUsd);
  // Allowed only if the projected total stays at or under the cap.
  const allowed = projectedUsd <= capUsd + 1e-9;
  const utilization = capUsd > 0 ? Math.min(1, monthToDateUsd / capUsd) : 1;

  return {
    allowed,
    capUsd,
    monthToDateUsd,
    pendingUsd,
    projectedUsd,
    remainingUsd,
    utilization,
  };
}

/** True when the org is already at/over its cap (before the pending action). */
export function isOverExposureCap(capUsd: number | null, monthToDateUsd: number): boolean {
  if (capUsd === null) return false;
  const cap = capUsd > 0 ? capUsd : 0;
  return sanitize(monthToDateUsd) >= cap;
}

/** A user-facing, secret-free reason string for a blocked action. */
export function exposureBlockReason(evaluation: ExposureEvaluation): string {
  if (evaluation.allowed) return '';
  if (evaluation.capUsd === null) return '';
  return `Monthly usage limit reached for this plan (cap $${evaluation.capUsd.toFixed(2)}). Upgrade your plan or wait for the next cycle to continue.`;
}
