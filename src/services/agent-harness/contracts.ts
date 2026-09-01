import { randomUUID } from 'node:crypto';

export const CODEN_HARNESS_VERSION = 'coden-harness/v3' as const;

export type HarnessThreadStatus = 'active' | 'archived' | 'completed';
export type HarnessTurnStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';
export type HarnessItemStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
export type HarnessItemKind =
  | 'user_message'
  | 'assistant_message'
  | 'plan'
  | 'tool_call'
  | 'tool_result'
  | 'command'
  | 'patch'
  | 'subagent'
  | 'verification'
  | 'approval'
  | 'checkpoint';

export type HarnessAgentRole =
  | 'orchestrator'
  | 'explorer'
  | 'planner'
  | 'researcher'
  | 'frontend'
  | 'backend'
  | 'database'
  | 'integrator'
  | 'tester'
  | 'reviewer'
  | 'security'
  | 'visual_qa';

export type HarnessEventType =
  | 'thread.created'
  | 'thread.updated'
  | 'turn.created'
  | 'turn.started'
  | 'turn.steered'
  | 'turn.waiting_for_user'
  | 'turn.verifying'
  | 'turn.completed'
  | 'turn.failed'
  | 'turn.cancelled'
  | 'turn.blocked'
  | 'item.created'
  | 'item.started'
  | 'item.delta'
  | 'item.completed'
  | 'item.failed'
  | 'item.cancelled'
  | 'approval.requested'
  | 'approval.resolved'
  | 'checkpoint.saved'
  | 'subagent.spawned'
  | 'subagent.completed'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'verification.started'
  | 'verification.completed'
  | 'public.stream';

export type DefinitionOfDoneCriterion = {
  id: string;
  label: string;
  required: boolean;
  status: 'pending' | 'passed' | 'failed' | 'blocked';
  evidence?: string;
};

export type HarnessBudget = {
  maxToolCalls: number;
  maxSubagents: number;
  maxRepairAttempts: number;
  maxDurationMs: number;
  maxCredits?: number;
};

export type HarnessThread = {
  id: string;
  version: typeof CODEN_HARNESS_VERSION;
  organizationId: string;
  projectId: string;
  userId: string;
  status: HarnessThreadStatus;
  title: string;
  activeTurnId?: string;
  nextSequence: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type HarnessTurn = {
  id: string;
  threadId: string;
  parentTurnId?: string;
  userId: string;
  status: HarnessTurnStatus;
  requestedMode: string;
  resolvedAction?: string;
  prompt: string;
  idempotencyKey: string;
  definitionOfDone: DefinitionOfDoneCriterion[];
  budget: HarnessBudget;
  budgetUsed: {
    toolCalls: number;
    subagents: number;
    repairAttempts: number;
    credits: number;
  };
  checkpoint?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type HarnessItem = {
  id: string;
  threadId: string;
  turnId: string;
  parentItemId?: string;
  kind: HarnessItemKind;
  role: HarnessAgentRole | 'user' | 'assistant' | 'system';
  status: HarnessItemStatus;
  title?: string;
  content?: string;
  resourceKeys: string[];
  payload: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type HarnessEvent = {
  id: string;
  threadId: string;
  turnId?: string;
  itemId?: string;
  sequence: number;
  type: HarnessEventType;
  visibility: 'public' | 'technical' | 'private';
  payload: Record<string, unknown>;
  createdAt: string;
};

export type HarnessInstruction = {
  id: string;
  threadId: string;
  turnId: string;
  userId: string;
  text: string;
  status: 'pending' | 'applied' | 'rejected' | 'superseded';
  applyAt: 'next_safe_checkpoint' | 'immediate';
  createdAt: string;
  appliedAt?: string;
};

export type CreateThreadInput = Pick<HarnessThread, 'organizationId' | 'projectId' | 'userId'> & {
  title?: string;
  metadata?: Record<string, unknown>;
  id?: string;
};

export type CreateTurnInput = {
  threadId: string;
  userId: string;
  prompt: string;
  requestedMode?: string;
  idempotencyKey: string;
  parentTurnId?: string;
  definitionOfDone?: DefinitionOfDoneCriterion[];
  budget?: Partial<HarnessBudget>;
  id?: string;
};

export const DEFAULT_HARNESS_BUDGET: HarnessBudget = {
  maxToolCalls: 48,
  maxSubagents: 6,
  maxRepairAttempts: 3,
  maxDurationMs: 30 * 60_000,
};

export function harnessId(prefix: 'thread' | 'turn' | 'item' | 'event' | 'instruction') {
  return `${prefix}_${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

const TERMINAL_TURN_STATUSES = new Set<HarnessTurnStatus>(['completed', 'failed', 'cancelled', 'blocked']);

export function isTerminalTurnStatus(status: HarnessTurnStatus) {
  return TERMINAL_TURN_STATUSES.has(status);
}

export function canTransitionTurn(from: HarnessTurnStatus, to: HarnessTurnStatus) {
  if (from === to) return true;
  if (isTerminalTurnStatus(from)) return false;
  if (to === 'cancelled') return true;
  const transitions: Record<HarnessTurnStatus, HarnessTurnStatus[]> = {
    queued: ['running', 'cancelled', 'blocked', 'failed'],
    running: ['waiting_for_user', 'verifying', 'completed', 'failed', 'cancelled', 'blocked'],
    waiting_for_user: ['running', 'cancelled', 'blocked', 'failed'],
    verifying: ['running', 'completed', 'failed', 'cancelled', 'blocked'],
    completed: [],
    failed: [],
    cancelled: [],
    blocked: [],
  };
  return transitions[from].includes(to);
}

export function canTransitionItem(from: HarnessItemStatus, to: HarnessItemStatus) {
  if (from === to) return true;
  if (['completed', 'failed', 'cancelled', 'blocked'].includes(from)) return false;
  if (from === 'pending') return ['running', 'completed', 'failed', 'cancelled', 'blocked'].includes(to);
  return ['completed', 'failed', 'cancelled', 'blocked'].includes(to);
}
