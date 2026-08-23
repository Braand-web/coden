import type { CodenStreamEvent } from '../lib/stream-protocol';
import {
  canTransitionAgentRun,
  creditPolicyFor,
  statusFromStreamEvent,
  type AgentMode,
  type AgentPlan,
  type AgentRunContract,
  type AgentRunStatus,
  type VerificationCheck,
} from './agent-run-contract.ts';

export type AgentActivityItem = {
  id: string;
  label: string;
  status: 'active' | 'done' | 'failed' | 'muted';
  detail?: string;
  evidence?: string;
};

export type AgentRunViewModel = AgentRunContract & {
  activities: AgentActivityItem[];
  clarification?: { question: string; options?: string[] };
  files: string[];
  checks: VerificationCheck[];
  error?: string;
  warnings: string[];
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
    canMutateFiles: input.canMutateFiles ?? requestedMode !== 'plan',
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

export function applyAgentStreamEvent(previous: AgentRunViewModel, event: CodenStreamEvent): AgentRunViewModel {
  if (event.runId && event.runId !== previous.runId) return previous;
  const state: AgentRunViewModel = {
    ...previous,
    objective: previous.objective ? { ...previous.objective } : undefined,
    plan: previous.plan ? { ...previous.plan, steps: previous.plan.steps.map((step) => ({ ...step })) } : undefined,
    verification: previous.verification ? { ...previous.verification, checks: previous.verification.checks.map((check) => ({ ...check })) } : undefined,
    activities: previous.activities.map((item) => ({ ...item })),
    files: [...previous.files],
    checks: previous.checks.map((check) => ({ ...check })),
    warnings: [...previous.warnings],
  };

  applyStatus(state, statusFromStreamEvent(event, state.status));

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
      addActivity(state, { id: 'approval', label: event.summary, status: 'active' });
      break;
    case 'done':
      state.hasFinal = true;
      state.terminalSequence = event.id;
      if (state.status !== 'failed' && state.status !== 'needs_fix') applyStatus(state, 'completed');
      break;
    default:
      break;
  }

  return state;
}
