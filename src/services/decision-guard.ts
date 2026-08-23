// Decision Guard — self-monitoring layer for the autonomous DecisionCore.
//
// After Coden decides (decision-core.ts) and before it acts, this guard checks
// the decision against hard invariants and the real project state, then returns
// a corrected decision plus the list of violations it repaired. This is the
// "self-consistency / verify" step from the enhancement plan: defense in depth
// so a mis-fired heuristic can never, e.g., mutate files with no project, skip
// confirmation on a critical action, or ask to clarify without a question.

import {
  confidenceBand,
  type DecisionProjectState,
  type CodenDecision,
  type CodenDecisionAction,
} from './decision-core.ts';

export type DecisionViolation = {
  code: string;
  message: string;
  severity: 'fix' | 'warn';
};

export type GuardResult = {
  decision: CodenDecision;
  violations: DecisionViolation[];
  changed: boolean;
};

const FILE_MUTATING: CodenDecisionAction[] = ['build', 'edit', 'debug'];

function creditPolicyFor(action: CodenDecisionAction): CodenDecision['credit_policy'] {
  if (action === 'build' || action === 'debug') return 'build';
  if (action === 'edit' || action === 'plan') return 'metered';
  return 'free';
}

function reshape(decision: CodenDecision, action: CodenDecisionAction, patch: Partial<CodenDecision> = {}): CodenDecision {
  const mutates = FILE_MUTATING.includes(action);
  return {
    ...decision,
    action,
    mutates_files: mutates,
    credit_policy: creditPolicyFor(action),
    needs_confirmation: action === 'critical_action' ? true : (patch.needs_confirmation ?? decision.needs_confirmation),
    ...patch,
  };
}

export function guardDecision(decision: CodenDecision, project: DecisionProjectState = {}): GuardResult {
  const violations: DecisionViolation[] = [];
  let next = decision;
  const hasFiles = Boolean(project.hasFiles || (project.fileCount || 0) > 0);

  // 1. Critical actions must always require confirmation.
  if (next.action === 'critical_action' && !next.needs_confirmation) {
    violations.push({ code: 'critical_needs_confirmation', message: 'Critical action must request confirmation.', severity: 'fix' });
    next = { ...next, needs_confirmation: true };
  }

  // 2. refuse_redirect and chat/clarify/plan must never mutate files.
  if (!FILE_MUTATING.includes(next.action) && next.mutates_files) {
    violations.push({ code: 'non_mutating_marked_mutating', message: `Action "${next.action}" must not mutate files.`, severity: 'fix' });
    next = { ...next, mutates_files: false, credit_policy: creditPolicyFor(next.action) };
  }

  // 3. Edit / debug require an existing project; otherwise they cannot act.
  if ((next.action === 'edit' || next.action === 'debug') && !hasFiles) {
    violations.push({
      code: 'edit_without_project',
      message: `"${next.action}" needs an existing project but none is present — downgraded to clarify.`,
      severity: 'fix',
    });
    next = reshape(next, 'clarify', {
      confidence: Math.min(next.confidence, 0.45),
      clarifying_question:
        next.clarifying_question ||
        'Il n’y a pas encore de projet à modifier — veux-tu que je crée une nouvelle app ?',
      rationale: 'No project exists to edit or debug, so Coden asks one focused question instead.',
    });
  }

  // 4. Clarify must carry exactly one question.
  if (next.action === 'clarify' && !next.clarifying_question) {
    violations.push({ code: 'clarify_without_question', message: 'Clarify must include one question.', severity: 'fix' });
    next = { ...next, clarifying_question: 'Peux-tu préciser ce que tu veux que je fasse ?' };
  }

  // 6. Confidence must be in [0,1] and the band must match.
  if (next.confidence < 0 || next.confidence > 1) {
    violations.push({ code: 'confidence_out_of_range', message: 'Confidence must be within [0,1].', severity: 'fix' });
    next = { ...next, confidence: Math.max(0, Math.min(1, next.confidence)) };
  }
  const expectedBand = next.action === 'clarify' ? 'clarify' : confidenceBand(next.confidence);
  if (next.band !== expectedBand) {
    violations.push({ code: 'band_mismatch', message: 'Confidence band does not match confidence.', severity: 'fix' });
    next = { ...next, band: expectedBand, assumptions: expectedBand === 'act_with_assumptions' ? next.assumptions : [] };
  }

  // 7. Assumptions only belong to the medium band.
  if (next.band !== 'act_with_assumptions' && next.assumptions.length > 0) {
    violations.push({ code: 'assumptions_outside_band', message: 'Assumptions only apply in the act-with-assumptions band.', severity: 'warn' });
    next = { ...next, assumptions: [] };
  }

  return { decision: next, violations, changed: next !== decision };
}

/** Convenience: decide-then-guard in one call once both modules are wired. */
export function isActionableWithoutUser(decision: CodenDecision): boolean {
  return (
    decision.action !== 'clarify' &&
    decision.action !== 'critical_action' &&
    decision.action !== 'refuse_redirect'
  );
}
