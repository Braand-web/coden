// Decision Bridge — adapts a unified CodenDecision (decision-core.ts) into the
// LegacyDecision shape that the existing buildExecutionContract() pipeline in
// server.ts already consumes. This is the integration seam: wiring DecisionCore
// into the runtime becomes a one-liner
//
//   buildExecutionContract({ prompt, hasFiles, hasLastPlan, requestedMode,
//                            legacyDecision: decisionToLegacyDecision(decision) })
//
// instead of ad-hoc edits scattered across the monolith.

import type { CodenDecision, CodenDecisionAction } from './decision-core.ts';
import type { UserIntentCategory } from './intent-understanding.ts';

// Maps a DecisionCore action to the legacy intent strings selectMode() keys on.
const ACTION_TO_LEGACY_INTENT: Record<CodenDecisionAction, string> = {
  chat: 'conversation',
  clarify: 'clarification_required',
  plan: 'plan',
  build: 'build',
  edit: 'edit',
  debug: 'debug_fix',
  critical_action: 'critical_action',
  refuse_redirect: 'refuse',
};

export type LegacyDecisionShape = {
  intent: string;
  confidence: number;
  understandingCategory: UserIntentCategory;
  intentUnderstanding: {
    category: UserIntentCategory;
    action: 'answer' | 'clarify' | 'file_action';
    confidence: number;
    allowsFileAction: boolean;
    needsClarification: boolean;
    reason: string;
    signals: string[];
  };
  requiresFileChanges: boolean;
  requiresPreviewRebuild: boolean;
  requiresCredits: boolean;
  userVisibleReason: string;
  reason: string;
};

export function decisionToLegacyDecision(decision: CodenDecision): LegacyDecisionShape {
  const intent = decision.intent;
  return {
    intent: ACTION_TO_LEGACY_INTENT[decision.action] || 'conversation',
    confidence: decision.confidence,
    understandingCategory: intent.category,
    intentUnderstanding: {
      category: intent.category,
      action: intent.action,
      confidence: intent.confidence,
      allowsFileAction: intent.allowsFileAction,
      needsClarification: intent.needsClarification,
      reason: intent.reason,
      signals: intent.signals,
    },
    requiresFileChanges: decision.mutates_files,
    requiresPreviewRebuild: decision.mutates_files,
    requiresCredits: decision.credit_policy !== 'free',
    userVisibleReason: decision.rationale,
    reason: decision.decision_path,
  };
}
