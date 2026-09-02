import type { CodenStreamEvent } from '../lib/stream-protocol';
import {
  canTransitionAgentRun,
  creditPolicyFor,
  statusFromStreamEvent,
  type AgentMode,
  type AgentPlan,
  type AgentRunContract,
  type AgentRunStatus,
  type AgentPublicPhase,
  type InlineUserDecision,
  type VerificationCheck,
} from './agent-run-contract.ts';

export type AgentActivityItem = {
  id: string;
  label: string;
  status: 'active' | 'done' | 'failed' | 'muted';
  detail?: string;
  evidence?: string;
};

export type AgentProgressNote = {
  id: string;
  phase: AgentPublicPhase;
  content: string;
  evidence: string[];
  nextAction?: string;
  sequence: number;
};

export type AgentRunViewModel = AgentRunContract & {
  activities: AgentActivityItem[];
  clarification?: { question: string; options?: string[] };
  files: string[];
  checks: VerificationCheck[];
  error?: string;
  warnings: string[];
  progressNotes: AgentProgressNote[];
  publicActivity?: { phase: AgentPublicPhase; message: string; active: boolean; sequence: number };
  lastAssistantSequence: number;
  decision?: InlineUserDecision;
};

export function createAgentRunViewModel(input: Partial<AgentRunContract> & { runId: string; prompt: string; requestedMode?: AgentMode }): AgentRunViewModel {
  const requestedMode = input.requestedMode || 'auto';
  return {
    version: 'agent-run/v2',
    runId: input.runId,
    projectId: input.projectId,
    requestedMode,
    resolvedAction: input.resolvedAction,
    status: input.status || 'submitting',
    prompt: input.prompt,
    language: input.language || 'fr',
    model: input.model || 'unknown',
    planId: input.planId,
    contextHash: input.contextHash,
    canMutateFiles: input.canMutateFiles ?? (requestedMode === 'auto' || requestedMode === 'build' || requestedMode === 'fix'),
    requiresConfirmation: Boolean(input.requiresConfirmation),
    creditPolicy: input.creditPolicy || creditPolicyFor(requestedMode),
    objective: input.objective,
    plan: input.plan,
    verification: input.verification || { status: 'unknown', checks: [] },
    assistantText: input.assistantText || '',
    hasFinal: Boolean(input.hasFinal),
    terminalSequence: input.terminalSequence,
    activities: [],
    files: [],
    checks: input.verification?.checks || [],
    warnings: [],
    progressNotes: [],
    lastAssistantSequence: 0,
  };
}

function addActivity(state: AgentRunViewModel, item: AgentActivityItem) {
  const existing = state.activities.find((activity) => activity.id === item.id);
  if (existing) {
    Object.assign(existing, item);
    return;
  }
  state.activities.push(item);
  if (state.activities.length > 40) state.activities.splice(0, state.activities.length - 40);
}

function applyStatus(state: AgentRunViewModel, next: AgentRunStatus) {
  if (canTransitionAgentRun(state.status, next)) state.status = next;
}

function upsertCheck(state: AgentRunViewModel, check: VerificationCheck) {
  const index = state.checks.findIndex((item) => item.id === check.id);
  if (index === -1) state.checks.push(check);
  else state.checks[index] = { ...state.checks[index], ...check };
  state.verification = {
    status: state.checks.some((item) => item.status === 'failed') ? 'needs_fix' : state.verification?.status || 'running',
    checks: state.checks,
  };
}

function phaseForLegacyEvent(event: CodenStreamEvent): AgentPublicPhase | null {
  if (event.type === 'status') {
    const message = event.message.toLowerCase();
    if (/deploy|publication/.test(message)) return 'deploying';
    if (/preview/.test(message)) return 'checking_preview';
    if (/test|verif|vérif|check/.test(message)) return 'testing';
    if (/fix|corr|répar|repair/.test(message)) return 'fixing';
    if (/build|génér|gener|constru|cod/.test(message)) return 'building';
    if (/plan|architect/.test(message)) return 'planning';
    if (/inspect|analys/.test(message)) return 'inspecting';
    return 'understanding';
  }
  if (event.type === 'understanding') return 'understanding';
  if (event.type === 'verification_started' || event.type === 'check') return 'testing';
  if (event.type === 'file_start' || event.type === 'file_delta' || event.type === 'file_done') return 'building';
  if (event.type === 'milestone') {
    return ({ understanding: 'understanding', inspecting: 'inspecting', planning: 'planning', generating: 'building', checking: 'testing', fixing: 'fixing', preview_ready: 'checking_preview' } as const)[event.milestone];
  }
  if (event.type === 'phase') {
    return ({ understand: 'understanding', decide: 'understanding', plan: 'planning', reason: 'planning', build: 'building', verify: 'testing', fix: 'fixing', recap: 'checking_preview' } as const)[event.phase];
  }
  return null;
}

function publicMessageForPhase(phase: AgentPublicPhase, language: 'fr' | 'en') {
  const fr: Record<AgentPublicPhase, string> = {
    understanding: 'Coden analyse votre demande…',
    inspecting: 'Coden inspecte le projet…',
    researching: 'Coden vérifie les sources utiles…',
    planning: 'Coden prépare l’architecture…',
    building: 'Coden construit l’application…',
    connecting_backend: 'Coden connecte le backend…',
    integrating: 'Coden assemble les composants…',
    testing: 'Coden lance les tests…',
    checking_preview: 'Coden vérifie la preview…',
    fixing: 'Coden corrige les derniers problèmes…',
    preparing_deployment: 'Coden prépare le déploiement…',
    deploying: 'Coden déploie l’application…',
  };
  const en: Record<AgentPublicPhase, string> = {
    understanding: 'Coden is analyzing your request…',
    inspecting: 'Coden is inspecting the project…',
    researching: 'Coden is checking relevant sources…',
    planning: 'Coden is preparing the architecture…',
    building: 'Coden is building the application…',
    connecting_backend: 'Coden is connecting the backend…',
    integrating: 'Coden is integrating the components…',
    testing: 'Coden is running tests…',
    checking_preview: 'Coden is checking the preview…',
    fixing: 'Coden is fixing the remaining issues…',
    preparing_deployment: 'Coden is preparing the deployment…',
    deploying: 'Coden is deploying the application…',
  };
  return (language === 'fr' ? fr : en)[phase];
}

export function applyAgentStreamEvent(previous: AgentRunViewModel, event: CodenStreamEvent): AgentRunViewModel {
  // A client starts with a message-scoped placeholder before the server has
  // acknowledged a run. Adopt the first authoritative run id so its SSE
  // activity and assistant deltas are not silently discarded. Once bound, a
  // different run id still cannot mutate this conversation item.
  const canAdoptServerRunId = Boolean(
    event.runId
    && event.runId !== previous.runId
    && previous.status === 'submitting'
    && previous.lastAssistantSequence === 0
    && !previous.hasFinal
    && /:run$/.test(previous.runId),
  );
  if (event.runId && event.runId !== previous.runId && !canAdoptServerRunId) return previous;
  const state: AgentRunViewModel = {
    ...previous,
    runId: canAdoptServerRunId ? String(event.runId) : previous.runId,
    objective: previous.objective ? { ...previous.objective } : undefined,
    plan: previous.plan ? { ...previous.plan, steps: previous.plan.steps.map((step) => ({ ...step })) } : undefined,
    verification: previous.verification ? { ...previous.verification, checks: previous.verification.checks.map((check) => ({ ...check })) } : undefined,
    activities: previous.activities.map((item) => ({ ...item })),
    files: [...previous.files],
    checks: previous.checks.map((check) => ({ ...check })),
    warnings: [...previous.warnings],
    progressNotes: previous.progressNotes.map((note) => ({ ...note, evidence: [...note.evidence] })),
  };

  applyStatus(state, statusFromStreamEvent(event, state.status));

  const legacyPhase = phaseForLegacyEvent(event);
  if (legacyPhase) {
    const active = event.type === 'milestone' || event.type === 'phase' ? event.state === 'active' : true;
    const explicit = event.type === 'status' ? event.message : event.type === 'milestone' || event.type === 'phase' ? event.label : undefined;
    state.publicActivity = { phase: legacyPhase, message: explicit || publicMessageForPhase(legacyPhase, state.language), active, sequence: event.sequence || event.id };
  }

  switch (event.type) {
    case 'mode_requested':
      state.requestedMode = event.mode;
      addActivity(state, { id: 'mode-requested', label: `Mode demandé : ${event.mode}`, status: 'done' });
      break;
    case 'mode_resolved':
      state.resolvedAction = event.action as AgentRunViewModel['resolvedAction'];
      addActivity(state, { id: 'mode-resolved', label: `Action sélectionnée : ${event.action}`, status: 'done' });
      break;
    case 'understanding':
      state.objective = {
        summary: event.summary,
        requirements: event.requirements || [],
        confidence: event.confidence,
      };
      addActivity(state, { id: 'objective', label: event.summary, status: 'done' });
      break;
    case 'clarification':
      state.clarification = { question: event.question, options: event.options };
      state.decision = { type: 'clarification', question: event.question, choices: event.options };
      addActivity(state, { id: 'clarification', label: event.question, status: 'active' });
      break;
    case 'plan': {
      const planPayload = event as typeof event & { planId?: string; title?: string; objective?: string; files?: string[]; risks?: string[]; acceptanceCriteria?: string[] };
      state.plan = {
        planId: planPayload.planId || state.planId || `plan_${event.id}`,
        title: planPayload.title,
        objective: planPayload.objective,
        steps: event.steps.map((step) => ({ ...step, state: 'pending' })),
        files: planPayload.files || [],
        risks: planPayload.risks || [],
        acceptanceCriteria: planPayload.acceptanceCriteria || [],
        contextHash: state.contextHash,
        status: 'ready',
      };
      state.planId = state.plan.planId;
      // A plan is not an execution result. It remains explicitly actionable
      // until the user approves it or starts a new Build run.
      applyStatus(state, 'awaiting_confirmation');
      addActivity(state, { id: 'plan', label: 'Plan prêt', status: 'done' });
      break;
    }
    case 'plan_step':
      if (state.plan) {
        const step = state.plan.steps.find((item) => item.id === event.stepId);
        if (step) step.state = event.state;
      }
      addActivity(state, { id: `plan_step:${event.stepId}`, label: event.stepId, status: event.state === 'failed' ? 'failed' : event.state === 'active' ? 'active' : 'done' });
      break;
    case 'assistant_delta':
      state.assistantText += event.text;
      state.lastAssistantSequence = event.sequence || event.id;
      break;
    case 'assistant_message_completed':
      state.publicActivity = state.publicActivity ? { ...state.publicActivity, active: false } : undefined;
      break;
    case 'activity_changed':
      state.publicActivity = { phase: event.phase, message: event.message, active: event.active, sequence: event.sequence || event.id };
      break;
    case 'assistant_progress': {
      const sequence = event.sequence || event.id;
      if (!state.progressNotes.some((note) => note.id === event.messageId || note.sequence === sequence)) {
        state.progressNotes.push({
          id: event.messageId,
          phase: event.phase,
          content: event.content,
          evidence: event.evidence || [],
          nextAction: event.nextAction,
          sequence,
        });
        if (state.progressNotes.length > 8) state.progressNotes = state.progressNotes.slice(-8);
      }
      state.publicActivity = state.publicActivity ? { ...state.publicActivity, active: false } : undefined;
      break;
    }
    case 'decision_required':
      state.decision = event.decision;
      break;
    case 'preview_ready':
      state.publicActivity = { phase: 'checking_preview', message: publicMessageForPhase('checking_preview', state.language), active: false, sequence: event.sequence || event.id };
      break;
    case 'deployment_ready':
      state.publicActivity = { phase: 'preparing_deployment', message: publicMessageForPhase('preparing_deployment', state.language), active: false, sequence: event.sequence || event.id };
      break;
    case 'cancelled':
      state.hasFinal = true;
      state.publicActivity = state.publicActivity ? { ...state.publicActivity, active: false } : undefined;
      break;
    case 'blocked':
      state.error = event.message;
      state.hasFinal = true;
      state.publicActivity = state.publicActivity ? { ...state.publicActivity, active: false } : undefined;
      break;
    case 'file_start':
      if (!state.files.includes(event.path)) state.files.push(event.path);
      addActivity(state, { id: `file:${event.path}`, label: event.path, status: 'active' });
      break;
    case 'file_done':
      if (!state.files.includes(event.path)) state.files.push(event.path);
      addActivity(state, { id: `file:${event.path}`, label: event.path, status: 'done' });
      break;
    case 'check':
      upsertCheck(state, { id: event.name, label: event.name, status: event.status === 'pass' ? 'passed' : event.status === 'fail' ? 'failed' : 'skipped', detail: event.detail });
      addActivity(state, { id: `check:${event.name}`, label: event.name, status: event.status === 'fail' ? 'failed' : 'done', detail: event.detail });
      break;
    case 'warning':
      state.warnings.push(event.message);
      addActivity(state, { id: `warning:${event.id}`, label: event.message, status: 'failed' });
      break;
    case 'error':
      state.error = event.message;
      applyStatus(state, 'failed');
      addActivity(state, { id: `error:${event.id}`, label: event.message, status: 'failed' });
      break;
    case 'verification_started':
      state.verification = { status: 'running', checks: state.checks };
      addActivity(state, { id: 'verification', label: 'Vérification', status: 'active' });
      break;
    case 'verification_completed':
      state.verification = { status: event.status === 'pass' ? 'verified' : event.status === 'fail' ? 'needs_fix' : 'failed', checks: state.checks };
      addActivity(state, { id: 'verification', label: 'Vérification', status: event.status === 'pass' ? 'done' : 'failed' });
      break;
    case 'approval_requested':
      state.requiresConfirmation = true;
      state.decision = { type: 'confirmation', action: event.action, summary: event.summary, confirmLabel: state.language === 'fr' ? 'Confirmer' : 'Confirm', cancelLabel: state.language === 'fr' ? 'Annuler' : 'Cancel' };
      addActivity(state, { id: 'approval', label: event.summary, status: 'active' });
      break;
    case 'done':
      state.hasFinal = true;
      state.terminalSequence = event.id;
      if (state.status !== 'failed' && state.status !== 'needs_fix') applyStatus(state, 'completed');
      state.publicActivity = state.publicActivity ? { ...state.publicActivity, active: false } : undefined;
      break;
    default:
      break;
  }

  return state;
}
