import type { ExecutionContract } from './execution-contract.ts';
import { normalizeExecutionText } from './execution-contract.ts';

export type DurableRunPhase =
  | 'idle'
  | 'queued'
  | 'deciding'
  | 'planning'
  | 'generating'
  | 'building'
  | 'testing'
  | 'fixing'
  | 'retesting'
  | 'saving'
  | 'ready'
  | 'needs_fix'
  | 'blocked'
  | 'stopped';

export type DurableRunStopReason =
  | 'credits_insufficient'
  | 'user_cancelled'
  | 'critical_confirmation_required'
  | 'security_block'
  | 'missing_required_info'
  | 'provider_unavailable_no_fallback'
  | 'manual_admin_stop';

export type DurableRunAction =
  | 'continue'
  | 'retry_provider'
  | 'fallback_model'
  | 'auto_fix'
  | 'retest'
  | 'save_recoverable_draft'
  | 'ask_user'
  | 'stop';

export type DurableRunContract = {
  version: 'durable-agent-run/v1';
  enabled: boolean;
  mode: ExecutionContract['mode'];
  action: ExecutionContract['action'];
  resumable: boolean;
  worker_owned: boolean;
  phase_plan: DurableRunPhase[];
  checkpoint_after: DurableRunPhase[];
  terminal_success: DurableRunPhase[];
  terminal_recoverable: DurableRunPhase[];
  allowed_stop_reasons: DurableRunStopReason[];
  max_provider_retries: number;
  max_autofix_attempts: number;
  only_user_visible_stop_without_credit: false;
  no_work_loss: true;
  public_rule: string;
};

export type DurableRunCheckpoint = {
  version: 'durable-agent-run/v1';
  run_id?: string | null;
  project_id?: string | null;
  request_id?: string | null;
  phase: DurableRunPhase;
  status: 'active' | 'ready' | 'needs_fix' | 'blocked' | 'stopped';
  resumable: boolean;
  can_continue_without_user: boolean;
  attempt: number;
  max_attempts: number;
  next_phase?: DurableRunPhase | null;
  stop_reason?: DurableRunStopReason | null;
  public_message: string;
  evidence: Record<string, unknown>;
  updated_at: string;
};

export type DurableRunContinuationInput = {
  hasCredits?: boolean;
  userCancelled?: boolean;
  criticalConfirmationRequired?: boolean;
  securityBlocked?: boolean;
  missingRequiredInfo?: boolean;
  providerError?: boolean;
  providerFallbackAvailable?: boolean;
  transientError?: boolean;
  reliabilityStatus?: 'passed' | 'warning' | 'failed' | string | null;
  previewStatus?: 'ready' | 'building' | 'failed' | 'needs_fix' | 'idle' | string | null;
  autoFixAttempts?: number;
  maxAutoFixAttempts?: number;
};

export type DurableRunContinuationDecision = {
  action: DurableRunAction;
  phase: DurableRunPhase;
  stop_reason: DurableRunStopReason | null;
  terminal: boolean;
  recoverable: boolean;
  should_checkpoint: true;
  public_message: string;
};

const MUTATING_PHASES: DurableRunPhase[] = [
  'queued',
  'deciding',
  'planning',
  'generating',
  'building',
  'testing',
  'fixing',
  'retesting',
  'saving',
  'ready',
];

const ANSWER_PHASES: DurableRunPhase[] = ['queued', 'deciding', 'ready'];

const ALLOWED_STOP_REASONS: DurableRunStopReason[] = [
  'credits_insufficient',
  'user_cancelled',
  'critical_confirmation_required',
  'security_block',
  'missing_required_info',
  'provider_unavailable_no_fallback',
  'manual_admin_stop',
];

export function buildDurableRunContract(input: {
  contract: ExecutionContract;
  maxAutoFixAttempts?: number;
}): DurableRunContract {
  const mutating = input.contract.can_mutate_files;
  return {
    version: 'durable-agent-run/v1',
    enabled: mutating || input.contract.mode === 'verify' || input.contract.mode === 'critical_action',
    mode: input.contract.mode,
    action: input.contract.action,
    resumable: mutating || input.contract.mode === 'verify',
    worker_owned: mutating,
    phase_plan: mutating ? MUTATING_PHASES : ANSWER_PHASES,
    checkpoint_after: mutating
      ? ['queued', 'planning', 'generating', 'building', 'testing', 'fixing', 'retesting', 'saving', 'needs_fix', 'ready']
      : ['queued', 'ready'],
    terminal_success: ['ready'],
    terminal_recoverable: mutating ? ['needs_fix'] : [],
    allowed_stop_reasons: ALLOWED_STOP_REASONS,
    max_provider_retries: mutating ? 2 : 1,
    max_autofix_attempts: Math.max(1, Number(input.maxAutoFixAttempts || 3)),
    only_user_visible_stop_without_credit: false,
    no_work_loss: true,
    public_rule: mutating
      ? 'Coden continues through retry, fallback, auto-fix, retest or recoverable draft. It stops only for credits, user stop, safety, missing required input or no compatible provider.'
      : 'Coden answers directly and does not start project work.',
  };
}

export function durablePhaseForEvent(eventType: string): DurableRunPhase | null {
  const event = String(eventType || '').toLowerCase();
  if (['run_started', 'queued'].includes(event)) return 'queued';
  if (['intent_detected', 'routing', 'understanding'].includes(event)) return 'deciding';
  if (['planning', 'plan_ready'].includes(event)) return 'planning';
  if (['model_started', 'model_streaming', 'files_changed', 'file_edit', 'file_stream_completed'].includes(event)) return 'generating';
  if (['build_started', 'preview_skeleton_started', 'preview_building'].includes(event)) return 'building';
  if (event.includes('runner_started') || event.includes('verification_started') || event.includes('quality_gate_started') || event.includes('check_started')) return 'testing';
  if (['auto_fix_started', 'patch_applied'].includes(event)) return 'fixing';
  if (['retest_started', 'runner_passed', 'runner_failed', 'quality_checked'].includes(event)) return 'retesting';
  if (['memory_updated', 'final_summary'].includes(event)) return 'saving';
  if (['preview_ready', 'done'].includes(event)) return 'ready';
  if (event === 'cancelled') return 'stopped';
  if (event === 'credits_insufficient' || event === 'external_api_keys_required') return 'blocked';
  if (event === 'error') return 'needs_fix';
  return null;
}

export function nextDurablePhase(current: DurableRunPhase, eventType: string): DurableRunPhase {
  const mapped = durablePhaseForEvent(eventType);
  if (!mapped) return current;
  if (current === 'ready' || current === 'stopped') return current;
  if (current === 'needs_fix' && mapped !== 'ready') return current;
  return mapped;
}

export function decideDurableRunContinuation(input: DurableRunContinuationInput): DurableRunContinuationDecision {
  if (input.hasCredits === false) {
    return decision('stop', 'blocked', 'credits_insufficient', true, false, 'Credits are required before Coden can continue.');
  }
  if (input.userCancelled) {
    return decision('stop', 'stopped', 'user_cancelled', true, false, 'The run was stopped by the user.');
  }
  if (input.criticalConfirmationRequired) {
    return decision('ask_user', 'blocked', 'critical_confirmation_required', true, true, 'Confirmation is required before this sensitive action can continue.');
  }
  if (input.securityBlocked) {
    return decision('stop', 'blocked', 'security_block', true, true, 'A safety check blocked the run before risky changes could continue.');
  }
  if (input.missingRequiredInfo) {
    return decision('ask_user', 'blocked', 'missing_required_info', true, true, 'One required detail is missing. Coden should ask only for that detail, then resume.');
  }
  if (input.providerError && input.providerFallbackAvailable) {
    return decision('fallback_model', 'generating', null, false, true, 'The selected provider failed, so Coden should continue with a compatible fallback model.');
  }
  if (input.providerError && !input.providerFallbackAvailable) {
    return decision('save_recoverable_draft', 'needs_fix', 'provider_unavailable_no_fallback', true, true, 'No compatible provider is available. Coden should save a recoverable draft and resume when a provider is available.');
  }
  if (input.transientError) {
    return decision('retry_provider', 'generating', null, false, true, 'The error looks temporary. Coden should retry before asking the user.');
  }
  if (String(input.reliabilityStatus || '').toLowerCase() === 'failed' || String(input.previewStatus || '').toLowerCase() === 'failed') {
    const attempt = Math.max(0, Number(input.autoFixAttempts || 0));
    const max = Math.max(1, Number(input.maxAutoFixAttempts || 3));
    if (attempt < max) {
      return decision('auto_fix', attempt > 0 ? 'retesting' : 'fixing', null, false, true, 'Blocking checks remain. Coden should auto-fix and retest.');
    }
    return decision('save_recoverable_draft', 'needs_fix', null, true, true, 'Blocking checks remain after auto-fix. Coden should save a recoverable draft, not lose work.');
  }
  if (String(input.previewStatus || '').toLowerCase() === 'needs_fix') {
    return decision('save_recoverable_draft', 'needs_fix', null, true, true, 'The preview still needs a fix. Coden should keep a recoverable draft.');
  }
  if (String(input.previewStatus || '').toLowerCase() === 'ready') {
    return decision('continue', 'ready', null, true, false, 'The run can finish because preview evidence is ready.');
  }
  return decision('continue', 'testing', null, false, true, 'Coden should continue until checks, save and preview evidence are complete.');
}

function decision(
  action: DurableRunAction,
  phase: DurableRunPhase,
  stopReason: DurableRunStopReason | null,
  terminal: boolean,
  recoverable: boolean,
  publicMessage: string,
): DurableRunContinuationDecision {
  return {
    action,
    phase,
    stop_reason: stopReason,
    terminal,
    recoverable,
    should_checkpoint: true,
    public_message: publicMessage,
  };
}

export function buildDurableCheckpoint(input: {
  contract: DurableRunContract;
  phase: DurableRunPhase;
  runId?: string | null;
  projectId?: string | null;
  requestId?: string | null;
  attempt?: number;
  nextPhase?: DurableRunPhase | null;
  stopReason?: DurableRunStopReason | null;
  message?: string;
  evidence?: Record<string, unknown>;
}): DurableRunCheckpoint {
  const phase = input.phase;
  const status: DurableRunCheckpoint['status'] =
    phase === 'ready' ? 'ready' :
    phase === 'needs_fix' ? 'needs_fix' :
    phase === 'blocked' ? 'blocked' :
    phase === 'stopped' ? 'stopped' :
    'active';
  const canContinueWithoutUser = status === 'active' || status === 'needs_fix';
  return {
    version: 'durable-agent-run/v1',
    run_id: input.runId || null,
    project_id: input.projectId || null,
    request_id: input.requestId || null,
    phase,
    status,
    resumable: input.contract.resumable && status !== 'ready' && status !== 'stopped',
    can_continue_without_user: canContinueWithoutUser && !input.stopReason,
    attempt: Math.max(0, Number(input.attempt || 0)),
    max_attempts: input.contract.max_autofix_attempts,
    next_phase: input.nextPhase || null,
    stop_reason: input.stopReason || null,
    public_message: input.message || defaultCheckpointMessage(phase),
    evidence: input.evidence || {},
    updated_at: new Date().toISOString(),
  };
}

function defaultCheckpointMessage(phase: DurableRunPhase) {
  const messages: Record<DurableRunPhase, string> = {
    idle: 'Run idle.',
    queued: 'Run queued.',
    deciding: 'Understanding the request.',
    planning: 'Planning the work internally.',
    generating: 'Generating files.',
    building: 'Building preview.',
    testing: 'Running checks.',
    fixing: 'Fixing blocking issues.',
    retesting: 'Retesting after fixes.',
    saving: 'Saving project state.',
    ready: 'Run ready.',
    needs_fix: 'Work saved. Preview verification still needs a clean pass.',
    blocked: 'Run blocked until one required action is available.',
    stopped: 'Run stopped.',
  };
  return messages[phase];
}

export function shouldResumeRecoverableDraft(input: {
  prompt: string;
  previewStatus?: string | null;
  lastRunStatus?: string | null;
}) {
  const text = normalizeExecutionText(input.prompt);
  const asksToContinue = /\b(corrige le blocage restant|fix the remaining blocker|continue from draft|reprends|reprendre|continue|corrige ce blocage|corrige les blocages|fix remaining|repair draft|needs fix)\b/.test(text);
  const projectNeedsFix = String(input.previewStatus || '').toLowerCase() === 'needs_fix'
    || String(input.lastRunStatus || '').toLowerCase() === 'needs_fix';
  return asksToContinue && projectNeedsFix;
}

export function buildDurableRunPayload(input: {
  contract: DurableRunContract;
  checkpoint?: DurableRunCheckpoint | null;
  continuation?: DurableRunContinuationDecision | null;
}) {
  return {
    durable_run: {
      contract: input.contract,
      checkpoint: input.checkpoint || null,
      continuation: input.continuation || null,
    },
  };
}
