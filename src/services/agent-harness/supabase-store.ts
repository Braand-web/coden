import type {
  CreateThreadInput,
  CreateTurnInput,
  HarnessEvent,
  HarnessInstruction,
  HarnessItem,
  HarnessThread,
  HarnessTurn,
} from './contracts.ts';
import { harnessId, isTerminalTurnStatus, nowIso } from './contracts.ts';
import type { AgentHarnessStore } from './store.ts';

type SupabaseResult<T = any> = PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>;
type SupabaseClientLike = {
  from(table: string): any;
  rpc(name: string, args: Record<string, unknown>): SupabaseResult<any>;
};

function assertResult<T>(result: { data: T; error: { message?: string; code?: string } | null }, operation: string) {
  if (result.error) throw new Error(`${operation}: ${result.error.message || 'Supabase request failed.'}`);
  return result.data;
}

function mapThread(row: any): HarnessThread {
  return {
    id: row.id,
    version: 'coden-harness/v3',
    organizationId: row.organization_id,
    projectId: row.project_id,
    userId: row.user_id,
    status: row.status,
    title: row.title,
    activeTurnId: row.active_turn_id || undefined,
    nextSequence: Number(row.next_sequence || 1),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTurn(row: any): HarnessTurn {
  return {
    id: row.id,
    threadId: row.thread_id,
    parentTurnId: row.parent_turn_id || undefined,
    userId: row.user_id,
    status: row.status,
    requestedMode: row.requested_mode,
    resolvedAction: row.resolved_action || undefined,
    prompt: row.prompt,
    idempotencyKey: row.idempotency_key,
    definitionOfDone: row.definition_of_done || [],
    budget: row.budget || {},
    budgetUsed: row.budget_used || { toolCalls: 0, subagents: 0, repairAttempts: 0, credits: 0 },
    checkpoint: row.checkpoint || undefined,
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapItem(row: any): HarnessItem {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    parentItemId: row.parent_item_id || undefined,
    kind: row.kind,
    role: row.role,
    status: row.status,
    title: row.title || undefined,
    content: row.content || undefined,
    resourceKeys: row.resource_keys || [],
    payload: row.payload || {},
    startedAt: row.started_at || undefined,
    completedAt: row.completed_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: any): HarnessEvent {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id || undefined,
    itemId: row.item_id || undefined,
    sequence: Number(row.sequence),
    type: row.event_type,
    visibility: row.visibility,
    payload: row.payload || {},
    createdAt: row.created_at,
  };
}

function mapInstruction(row: any): HarnessInstruction {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    userId: row.user_id,
    text: row.instruction,
    status: row.status,
    applyAt: row.apply_at,
    createdAt: row.created_at,
    appliedAt: row.applied_at || undefined,
  };
}

function threadPatch(patch: Partial<HarnessThread>) {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.title !== undefined) row.title = patch.title;
  if ('activeTurnId' in patch) row.active_turn_id = patch.activeTurnId || null;
  if (patch.nextSequence !== undefined) row.next_sequence = patch.nextSequence;
  if (patch.metadata !== undefined) row.metadata = patch.metadata;
  row.updated_at = nowIso();
  return row;
}

function turnPatch(patch: Partial<HarnessTurn>) {
  const row: Record<string, unknown> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.resolvedAction !== undefined) row.resolved_action = patch.resolvedAction;
  if (patch.definitionOfDone !== undefined) row.definition_of_done = patch.definitionOfDone;
  if (patch.budget !== undefined) row.budget = patch.budget;
  if (patch.budgetUsed !== undefined) row.budget_used = patch.budgetUsed;
  if (patch.checkpoint !== undefined) row.checkpoint = patch.checkpoint;
  if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
  if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
  row.updated_at = nowIso();
  return row;
}

export class SupabaseAgentHarnessStore implements AgentHarnessStore {
  private readonly client: SupabaseClientLike;

  constructor(client: SupabaseClientLike) {
    this.client = client;
  }

  async createThread(input: CreateThreadInput) {
    const now = nowIso();
    const row = {
      id: input.id || harnessId('thread'),
      organization_id: input.organizationId,
      project_id: input.projectId,
      user_id: input.userId,
      status: 'active',
      title: input.title?.trim() || 'Coden mission',
      next_sequence: 1,
      metadata: input.metadata || {},
      created_at: now,
      updated_at: now,
    };
    const result = await this.client.from('agent_threads').insert([row]).select('*').single();
    return mapThread(assertResult(result, 'Create harness thread'));
  }

  async getThread(threadId: string) {
    const result = await this.client.from('agent_threads').select('*').eq('id', threadId).maybeSingle();
    return assertResult(result, 'Load harness thread') ? mapThread(result.data) : null;
  }

  async findActiveThread(projectId: string, userId: string) {
    const result = await this.client.from('agent_threads').select('*').eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    const row = assertResult(result, 'Find active harness thread');
    return row ? mapThread(row) : null;
  }

  async listThreads(projectId: string, userId: string, limit = 20) {
    const result = await this.client.from('agent_threads').select('*').eq('project_id', projectId).eq('user_id', userId).order('updated_at', { ascending: false }).limit(Math.max(1, Math.min(limit, 100)));
    return ((assertResult(result, 'List harness threads') || []) as any[]).map(mapThread);
  }

  async updateThread(threadId: string, patch: Partial<HarnessThread>) {
    const result = await this.client.from('agent_threads').update(threadPatch(patch)).eq('id', threadId).select('*').single();
    return mapThread(assertResult(result, 'Update harness thread'));
  }

  async createTurn(input: CreateTurnInput) {
    const existing = await this.client.from('agent_turns').select('*').eq('thread_id', input.threadId).eq('idempotency_key', input.idempotencyKey).maybeSingle();
    const existingRow = assertResult(existing, 'Check harness turn idempotency');
    if (existingRow) return { turn: mapTurn(existingRow), created: false };

    const thread = await this.getThread(input.threadId);
    if (!thread || thread.userId !== input.userId) throw new Error('Harness thread not found or ownership mismatch.');
    if (thread.activeTurnId) {
      const active = await this.getTurn(thread.activeTurnId);
      if (active && !isTerminalTurnStatus(active.status)) throw new Error('A harness thread can only have one active turn. Steer the active turn instead.');
    }
    const now = nowIso();
    const row = {
      id: input.id || harnessId('turn'),
      thread_id: input.threadId,
      parent_turn_id: input.parentTurnId || null,
      user_id: input.userId,
      status: 'queued',
      requested_mode: input.requestedMode || 'auto',
      prompt: input.prompt,
      idempotency_key: input.idempotencyKey,
      definition_of_done: input.definitionOfDone || [],
      budget: { maxToolCalls: 48, maxSubagents: 6, maxRepairAttempts: 3, maxDurationMs: 30 * 60_000, ...input.budget },
      budget_used: { toolCalls: 0, subagents: 0, repairAttempts: 0, credits: 0 },
      created_at: now,
      updated_at: now,
    };
    const result = await this.client.from('agent_turns').insert([row]).select('*').single();
    if (result.error?.code === '23505') {
      const raced = await this.client.from('agent_turns').select('*').eq('thread_id', input.threadId).eq('idempotency_key', input.idempotencyKey).maybeSingle();
      const racedRow = assertResult(raced, 'Recover harness turn idempotency race');
      if (racedRow) return { turn: mapTurn(racedRow), created: false };
    }
    const turn = mapTurn(assertResult(result, 'Create harness turn'));
    await this.updateThread(input.threadId, { activeTurnId: turn.id });
    return { turn, created: true };
  }

  async getTurn(turnId: string) {
    const result = await this.client.from('agent_turns').select('*').eq('id', turnId).maybeSingle();
    const row = assertResult(result, 'Load harness turn');
    return row ? mapTurn(row) : null;
  }

  async updateTurn(turnId: string, patch: Partial<HarnessTurn>) {
    const result = await this.client.from('agent_turns').update(turnPatch(patch)).eq('id', turnId).select('*').single();
    const turn = mapTurn(assertResult(result, 'Update harness turn'));
    if (isTerminalTurnStatus(turn.status)) {
      await this.client.from('agent_threads').update({ active_turn_id: null, updated_at: nowIso() }).eq('id', turn.threadId).eq('active_turn_id', turn.id);
    }
    return turn;
  }

  async createItem(input: Omit<HarnessItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    const now = nowIso();
    const row = {
      id: input.id || harnessId('item'), thread_id: input.threadId, turn_id: input.turnId,
      parent_item_id: input.parentItemId || null, kind: input.kind, role: input.role, status: input.status,
      title: input.title || null, content: input.content || null, resource_keys: input.resourceKeys,
      payload: input.payload, started_at: input.startedAt || null, completed_at: input.completedAt || null,
      created_at: now, updated_at: now,
    };
    const result = await this.client.from('agent_items').insert([row]).select('*').single();
    return mapItem(assertResult(result, 'Create harness item'));
  }

  async getItem(itemId: string) {
    const result = await this.client.from('agent_items').select('*').eq('id', itemId).maybeSingle();
    const row = assertResult(result, 'Load harness item');
    return row ? mapItem(row) : null;
  }

  async updateItem(itemId: string, patch: Partial<HarnessItem>) {
    const row: Record<string, unknown> = { updated_at: nowIso() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.content !== undefined) row.content = patch.content;
    if (patch.resourceKeys !== undefined) row.resource_keys = patch.resourceKeys;
    if (patch.payload !== undefined) row.payload = patch.payload;
    if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
    if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
    const result = await this.client.from('agent_items').update(row).eq('id', itemId).select('*').single();
    return mapItem(assertResult(result, 'Update harness item'));
  }

  async appendEvent(input: Omit<HarnessEvent, 'id' | 'sequence' | 'createdAt'>) {
    const result = await this.client.rpc('append_agent_harness_event', {
      p_thread_id: input.threadId,
      p_turn_id: input.turnId || null,
      p_item_id: input.itemId || null,
      p_event_type: input.type,
      p_visibility: input.visibility,
      p_payload: input.payload,
    });
    const data = assertResult(result, 'Append harness event');
    const row = Array.isArray(data) ? data[0] : data;
    return mapEvent(row);
  }

  async listEvents(threadId: string, afterSequence = 0, limit = 500) {
    const result = await this.client.from('agent_harness_events').select('*').eq('thread_id', threadId).gt('sequence', afterSequence).order('sequence', { ascending: true }).limit(Math.max(1, Math.min(limit, 2_000)));
    return ((assertResult(result, 'List harness events') || []) as any[]).map(mapEvent);
  }

  async addInstruction(input: Omit<HarnessInstruction, 'id' | 'createdAt' | 'status'>) {
    const row = {
      id: harnessId('instruction'), thread_id: input.threadId, turn_id: input.turnId, user_id: input.userId,
      instruction: input.text, status: 'pending', apply_at: input.applyAt, created_at: nowIso(),
    };
    const result = await this.client.from('agent_instructions').insert([row]).select('*').single();
    return mapInstruction(assertResult(result, 'Create harness instruction'));
  }

  async listPendingInstructions(turnId: string) {
    const result = await this.client.from('agent_instructions').select('*').eq('turn_id', turnId).eq('status', 'pending').order('created_at', { ascending: true });
    return ((assertResult(result, 'List harness instructions') || []) as any[]).map(mapInstruction);
  }

  async updateInstruction(instructionId: string, patch: Partial<HarnessInstruction>) {
    const row: Record<string, unknown> = {};
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.applyAt !== undefined) row.apply_at = patch.applyAt;
    if (patch.appliedAt !== undefined) row.applied_at = patch.appliedAt;
    const result = await this.client.from('agent_instructions').update(row).eq('id', instructionId).select('*').single();
    return mapInstruction(assertResult(result, 'Update harness instruction'));
  }
}
