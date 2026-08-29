import type { CodenStreamEvent } from '../lib/stream-protocol';

export type AgentMode = 'auto' | 'build' | 'plan' | 'ask' | 'fix' | 'review' | 'research';

export type AgentPublicPhase =
  | 'understanding'
  | 'inspecting'
  | 'researching'
  | 'planning'
  | 'building'
  | 'connecting_backend'
  | 'integrating'
  | 'testing'
  | 'checking_preview'
  | 'fixing'
  | 'preparing_deployment'
  | 'deploying';

export type InlineUserDecision =
  | { type: 'clarification'; question: string; choices?: string[] }
  | { type: 'confirmation'; action: string; summary: string; confirmLabel: string; cancelLabel: string }
  | { type: 'missing_integration'; integration: string; requiredEnvironmentVariables: string[] };

export type AgentResolvedAction =
  | 'answer'
  | 'clarify'
  | 'plan'
  | 'build'
  | 'edit'
  | 'debug'
  | 'verify'
  | 'review'
  | 'research'
  | 'confirm'
  | 'blocked';

export type AgentRunStatus =
  | 'idle'
  | 'submitting'
  | 'understanding'
  | 'clarifying'
  | 'planning'
  | 'awaiting_confirmation'
  | 'executing'
  | 'verifying'
  | 'completed'
  | 'needs_fix'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'blocked';

export type AgentCreditPolicy = 'free' | 'plan-reduced' | 'build' | 'metered';

export type AgentObjective = {
  summary: string;
  requirements: string[];
  included?: string[];
  excluded?: string[];
  constraints?: string[];
  assumptions?: string[];
  confidence?: number;
};

export type AgentPlanStep = {
  id: string;
  title: string;
  kind?: 'create' | 'edit' | 'delete' | 'task';
  path?: string;
  state?: 'pending' | 'active' | 'done' | 'failed';
};

export type AgentPlan = {
  planId: string;
  title?: string;
  objective?: string;
  steps: AgentPlanStep[];
  files?: string[];
  risks?: string[];
  acceptanceCriteria?: string[];
  contextHash?: string;
  status: 'draft' | 'ready' | 'approved' | 'expired' | 'obsolete' | 'failed';
  estimatedCredits?: number;
  estimatedDurationMs?: number;
};

export type VerificationCheck = {
  id: string;
  label: string;
  status: 'running' | 'passed' | 'failed' | 'skipped';
  detail?: string;
  evidence?: string;
};

export type VerificationSummary = {
  status: 'unknown' | 'running' | 'verified' | 'needs_fix' | 'failed' | 'cancelled';
  checks: VerificationCheck[];
};

export type AgentRunContract = {
  version: 'agent-run/v2';
  runId: string;
  projectId?: string;
  requestedMode: AgentMode;
  resolvedAction?: AgentResolvedAction;
  status: AgentRunStatus;
  prompt: string;
  language: 'fr' | 'en';
  model: string;
  planId?: string;
  contextHash?: string;
  canMutateFiles: boolean;
  requiresConfirmation: boolean;
  creditPolicy: AgentCreditPolicy;
  objective?: AgentObjective;
  plan?: AgentPlan;
  verification?: VerificationSummary;
  assistantText: string;
  hasFinal: boolean;
  terminalSequence?: number;
};

export const AGENT_TERMINAL_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'needs_fix',
  'failed',
  'cancelled',
  'incomplete',
  'blocked',
];

export function isAgentTerminalStatus(status: AgentRunStatus) {
  return AGENT_TERMINAL_STATUSES.includes(status);
}

export function normalizeAgentMode(value: unknown): AgentMode {
  return value === 'build' || value === 'plan' || value === 'ask' || value === 'fix' || value === 'review' || value === 'research' ? value : 'auto';
}

export function modeLabel(mode: AgentMode, locale: 'fr' | 'en' = 'fr') {
  const labels = locale === 'fr'
    ? { auto: 'Auto', build: 'Build', plan: 'Plan', ask: 'Ask', fix: 'Fix', review: 'Review', research: 'Research' }
    : { auto: 'Auto', build: 'Build', plan: 'Plan', ask: 'Ask', fix: 'Fix', review: 'Review', research: 'Research' };
  return labels[mode];
}

export function runStatusLabel(status: AgentRunStatus, locale: 'fr' | 'en' = 'fr') {
  const fr: Record<AgentRunStatus, string> = {
    idle: 'Prêt',
    submitting: 'Envoi',
    understanding: 'Compréhension',
    clarifying: 'Clarification',
    planning: 'Planification',
    awaiting_confirmation: 'Confirmation requise',
    executing: 'Exécution',
    verifying: 'Vérification',
    completed: 'Terminé',
    needs_fix: 'À corriger',
    failed: 'Erreur',
    cancelled: 'Annulé',
    incomplete: 'Flux interrompu',
    blocked: 'Bloqué',
  };
  const en: Record<AgentRunStatus, string> = {
    idle: 'Ready',
    submitting: 'Sending',
    understanding: 'Understanding',
    clarifying: 'Clarification',
    planning: 'Planning',
    awaiting_confirmation: 'Confirmation required',
    executing: 'Executing',
    verifying: 'Verifying',
    completed: 'Completed',
    needs_fix: 'Needs fix',
    failed: 'Error',
    cancelled: 'Cancelled',
    incomplete: 'Stream interrupted',
    blocked: 'Blocked',
  };
  return (locale === 'fr' ? fr : en)[status];
}

export function creditPolicyFor(mode: AgentMode): AgentCreditPolicy {
  if (mode === 'plan') return 'plan-reduced';
  if (mode === 'build' || mode === 'fix') return 'build';
  return 'metered';
}

export function statusFromStreamEvent(event: CodenStreamEvent, current: AgentRunStatus): AgentRunStatus {
  switch (event.type) {
    case 'understanding': return 'understanding';
    case 'activity_changed':
      if (!event.active) return current;
      if (event.phase === 'planning') return 'planning';
      if (event.phase === 'testing' || event.phase === 'checking_preview') return 'verifying';
      if (event.phase === 'understanding' || event.phase === 'inspecting' || event.phase === 'researching') return 'understanding';
      return 'executing';
    case 'clarification': return 'clarifying';
    case 'plan': return 'planning';
    case 'verification_started': return 'verifying';
    case 'verification_completed': return event.status === 'pass' ? 'completed' : event.status === 'fail' ? 'needs_fix' : 'incomplete';
    case 'approval_requested': return 'awaiting_confirmation';
    case 'error': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'blocked': return 'blocked';
    case 'done': return current === 'failed' || current === 'needs_fix' ? current : 'completed';
    case 'assistant_delta': return current === 'idle' || current === 'submitting' || current === 'understanding' ? 'executing' : current;
    case 'file_start':
    case 'file_delta':
    case 'file_done':
    case 'tool_call':
    case 'tool_result': return 'executing';
    default: return current;
  }
}

export function canTransitionAgentRun(from: AgentRunStatus, to: AgentRunStatus) {
  if (from === to) return true;
  if (isAgentTerminalStatus(from)) return false;
  if (to === 'cancelled') return true;
  if (from === 'idle') return to === 'submitting';
  if (from === 'submitting') return ['understanding', 'clarifying', 'planning', 'executing', 'blocked', 'failed'].includes(to);
  if (from === 'understanding') return ['clarifying', 'planning', 'executing', 'awaiting_confirmation', 'blocked', 'failed'].includes(to);
  if (from === 'clarifying') return ['submitting', 'failed', 'blocked'].includes(to);
  if (from === 'planning') return ['awaiting_confirmation', 'executing', 'verifying', 'completed', 'failed', 'blocked'].includes(to);
  if (from === 'awaiting_confirmation') return ['executing', 'failed', 'blocked'].includes(to);
  if (from === 'executing') return ['verifying', 'completed', 'needs_fix', 'failed', 'blocked'].includes(to);
  if (from === 'verifying') return ['completed', 'needs_fix', 'failed', 'blocked'].includes(to);
  return false;
}
