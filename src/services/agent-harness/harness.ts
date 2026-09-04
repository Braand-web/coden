import {
  canTransitionItem,
  canTransitionTurn,
  harnessId,
  isTerminalTurnStatus,
  nowIso,
  type CreateThreadInput,
  type CreateTurnInput,
  type HarnessAgentRole,
  type HarnessEvent,
  type HarnessInstruction,
  type HarnessItem,
  type HarnessItemKind,
  type HarnessItemStatus,
  type HarnessTurn,
  type HarnessTurnStatus,
} from './contracts.ts';
import { type AgentHarnessStore, itemEventTypeForStatus, turnEventTypeForStatus } from './store.ts';
import { HarnessToolRegistry } from './tools.ts';

export class CodenAgentHarness {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly resourceOwners = new Map<string, string>();
  readonly store: AgentHarnessStore;
  readonly tools: HarnessToolRegistry;

  constructor(store: AgentHarnessStore, tools = new HarnessToolRegistry()) {
    this.store = store;
    this.tools = tools;
  }

  async createThread(input: CreateThreadInput) {
    const thread = await this.store.createThread(input);
    await this.store.appendEvent({ threadId: thread.id, type: 'thread.created', visibility: 'technical', payload: { title: thread.title, projectId: thread.projectId } });
    return thread;
  }

  async createTurn(input: CreateTurnInput) {
    const result = await this.store.createTurn(input);
    if (!result.created) return result;
    const userItem = await this.createItem({
      threadId: result.turn.threadId,
      turnId: result.turn.id,
      kind: 'user_message',
      role: 'user',
      status: 'completed',
      content: result.turn.prompt,
      resourceKeys: [],
      payload: { requestedMode: result.turn.requestedMode },
    });
    await this.store.appendEvent({ threadId: result.turn.threadId, turnId: result.turn.id, itemId: userItem.id, type: 'turn.created', visibility: 'public', payload: { requestedMode: result.turn.requestedMode } });
    this.abortControllers.set(result.turn.id, new AbortController());
    return result;
  }

  signalForTurn(turnId: string) {
    if (!this.abortControllers.has(turnId)) this.abortControllers.set(turnId, new AbortController());
    return this.abortControllers.get(turnId)!.signal;
  }

  async transitionTurn(turnId: string, status: HarnessTurnStatus, payload: Record<string, unknown> = {}) {
    const turn = await this.requiredTurn(turnId);
    // A cancelled run whose in-flight work then rejects reports its failure
    // after the outcome is already recorded. That is a race, not a programming
    // error, and throwing on it lost the whole event — production saw
    // "Invalid harness turn transition: cancelled -> failed" instead of the
    // failure detail. The first terminal status stands, because it is the one
    // that actually ended the turn; the late one is kept in the log.
    if (isTerminalTurnStatus(turn.status) && isTerminalTurnStatus(status) && turn.status !== status) {
      await this.store.appendEvent({
        threadId: turn.threadId,
        turnId,
        type: turnEventTypeForStatus(status),
        visibility: 'technical',
        payload: { ...payload, late_status: status, recorded_status: turn.status },
      });
      return turn;
    }
    if (!canTransitionTurn(turn.status, status)) {
      throw new Error(`Invalid harness turn transition: ${turn.status} -> ${status}`);
    }
    const patch: Partial<HarnessTurn> = { status };
    if (status === 'running' && !turn.startedAt) patch.startedAt = nowIso();
    if (isTerminalTurnStatus(status)) patch.completedAt = nowIso();
    const next = await this.store.updateTurn(turnId, patch);
    await this.store.appendEvent({ threadId: next.threadId, turnId, type: turnEventTypeForStatus(status), visibility: status === 'running' ? 'technical' : 'public', payload });
    if (isTerminalTurnStatus(status)) this.abortControllers.delete(turnId);
    return next;
  }

  async createItem(input: {
    threadId: string;
    turnId: string;
    parentItemId?: string;
    kind: HarnessItemKind;
    role: HarnessAgentRole | 'user' | 'assistant' | 'system';
    status?: HarnessItemStatus;
    title?: string;
    content?: string;
    resourceKeys?: string[];
    payload?: Record<string, unknown>;
  }) {
    const item = await this.store.createItem({
      ...input,
      status: input.status || 'pending',
      resourceKeys: input.resourceKeys || [],
      payload: input.payload || {},
      startedAt: input.status === 'running' ? nowIso() : undefined,
      completedAt: input.status === 'completed' ? nowIso() : undefined,
    });
    await this.store.appendEvent({ threadId: item.threadId, turnId: item.turnId, itemId: item.id, type: itemEventTypeForStatus(item.status), visibility: item.kind === 'assistant_message' || item.kind === 'approval' ? 'public' : 'technical', payload: { kind: item.kind, role: item.role, title: item.title } });
    return item;
  }

  async transitionItem(itemId: string, status: HarnessItemStatus, payload: Record<string, unknown> = {}) {
    const item = await this.requiredItem(itemId);
    if (!canTransitionItem(item.status, status)) {
      throw new Error(`Invalid harness item transition: ${item.status} -> ${status}`);
    }
    const patch: Partial<HarnessItem> = { status };
    if (status === 'running' && !item.startedAt) patch.startedAt = nowIso();
    if (['completed', 'failed', 'cancelled', 'blocked'].includes(status)) patch.completedAt = nowIso();
    const next = await this.store.updateItem(itemId, patch);
    await this.store.appendEvent({ threadId: next.threadId, turnId: next.turnId, itemId, type: itemEventTypeForStatus(status), visibility: next.kind === 'assistant_message' || next.kind === 'approval' ? 'public' : 'technical', payload });
    if (['completed', 'failed', 'cancelled', 'blocked'].includes(status)) this.releaseResources(itemId);
    return next;
  }

  async startTool(input: {
    turnId: string;
    role: HarnessAgentRole;
    toolName: string;
    resourceKeys?: string[];
    approvalGranted?: boolean;
    payload?: Record<string, unknown>;
  }) {
    const turn = await this.requiredTurn(input.turnId);
    if (isTerminalTurnStatus(turn.status)) throw new Error('Cannot start a tool on a terminal harness turn.');
    if (turn.budgetUsed.toolCalls >= turn.budget.maxToolCalls) throw new Error('Harness tool-call budget exhausted.');
    const definition = this.tools.assertAllowed(input.toolName, input.role, input.approvalGranted);
    const resourceKeys = [...new Set(input.resourceKeys || [])];
    const reservation = `reservation:${turn.id}:${harnessId('item')}`;
    if (definition.mutatesWorkspace) {
      this.claimResources(resourceKeys, input.turnId);
      for (const key of resourceKeys) this.resourceOwners.set(key, reservation);
    }
    let item: HarnessItem;
    try {
      item = await this.createItem({
        threadId: turn.threadId,
        turnId: turn.id,
        kind: 'tool_call',
        role: input.role,
        status: 'running',
        title: input.toolName,
        resourceKeys,
        payload: input.payload,
      });
    } catch (error) {
      for (const [key, owner] of this.resourceOwners) if (owner === reservation) this.resourceOwners.delete(key);
      throw error;
    }
    if (definition.mutatesWorkspace) for (const key of resourceKeys) this.resourceOwners.set(key, item.id);
    await this.store.updateTurn(turn.id, { budgetUsed: { ...turn.budgetUsed, toolCalls: turn.budgetUsed.toolCalls + 1 } });
    await this.store.appendEvent({ threadId: turn.threadId, turnId: turn.id, itemId: item.id, type: 'tool.started', visibility: 'technical', payload: { name: input.toolName, role: input.role, resourceKeys } });
    return item;
  }

  async completeTool(itemId: string, output: Record<string, unknown> = {}) {
    const item = await this.requiredItem(itemId);
    await this.store.appendEvent({ threadId: item.threadId, turnId: item.turnId, itemId, type: 'tool.completed', visibility: 'technical', payload: output });
    return this.transitionItem(itemId, 'completed', output);
  }

  async failTool(itemId: string, error: string) {
    const item = await this.requiredItem(itemId);
    await this.store.appendEvent({ threadId: item.threadId, turnId: item.turnId, itemId, type: 'tool.failed', visibility: 'technical', payload: { error } });
    return this.transitionItem(itemId, 'failed', { error });
  }

  async spawnSubagent(input: { turnId: string; role: HarnessAgentRole; title: string; parentItemId?: string; context: Record<string, unknown> }) {
    const turn = await this.requiredTurn(input.turnId);
    if (turn.budgetUsed.subagents >= turn.budget.maxSubagents) throw new Error('Harness subagent budget exhausted.');
    const item = await this.createItem({ threadId: turn.threadId, turnId: turn.id, parentItemId: input.parentItemId, kind: 'subagent', role: input.role, status: 'running', title: input.title, payload: { context: input.context } });
    await this.store.updateTurn(turn.id, { budgetUsed: { ...turn.budgetUsed, subagents: turn.budgetUsed.subagents + 1 } });
    await this.store.appendEvent({ threadId: turn.threadId, turnId: turn.id, itemId: item.id, type: 'subagent.spawned', visibility: 'technical', payload: { role: input.role, title: input.title } });
    return item;
  }

  /**
   * Close the run's own criteria against what was actually observed.
   *
   * `buildDefinitionOfDone` writes them at the start of every turn — the
   * behaviour is implemented, the project builds, the preview renders, the
   * browser journey completes — and until now nothing ever marked one. All 56
   * recorded turns finished with every criterion still `pending`, including
   * the ones that completed successfully. A definition of done that is never
   * settled is a checklist nobody ticks: it cannot gate anything, and it tells
   * the user nothing about what was really verified.
   *
   * `verdicts` carries only the criteria the caller has evidence for. One it
   * says nothing about stays `pending`, which is the honest answer for a check
   * that did not run — never `passed`.
   */
  async settleDefinitionOfDone(turnId: string, verdicts: Record<string, { status: 'passed' | 'failed' | 'blocked'; evidence?: string }>) {
    const turn = await this.requiredTurn(turnId);
    if (!turn.definitionOfDone.length) return turn;
    const definitionOfDone = turn.definitionOfDone.map(criterion => {
      const verdict = verdicts[criterion.id];
      if (!verdict) return criterion;
      return { ...criterion, status: verdict.status, ...(verdict.evidence ? { evidence: verdict.evidence.slice(0, 400) } : {}) };
    });
    const next = await this.store.updateTurn(turnId, { definitionOfDone });
    await this.store.appendEvent({
      threadId: turn.threadId,
      turnId,
      type: 'turn.definition_of_done',
      visibility: 'public',
      payload: {
        passed: definitionOfDone.filter(item => item.status === 'passed').map(item => item.id),
        failed: definitionOfDone.filter(item => item.status === 'failed').map(item => item.id),
        pending: definitionOfDone.filter(item => item.status === 'pending').map(item => item.id),
      },
    });
    return next;
  }

  async completeSubagent(itemId: string, summary: string, artifacts: string[] = []) {
    const item = await this.requiredItem(itemId);
    await this.store.appendEvent({ threadId: item.threadId, turnId: item.turnId, itemId, type: 'subagent.completed', visibility: 'technical', payload: { summary, artifacts } });
    return this.transitionItem(itemId, 'completed', { summary, artifacts });
  }

  async steer(input: { turnId: string; userId: string; text: string; applyAt?: HarnessInstruction['applyAt'] }) {
    const turn = await this.requiredTurn(input.turnId);
    if (turn.userId !== input.userId) throw new Error('Harness turn ownership mismatch.');
    const instruction = await this.store.addInstruction({ threadId: turn.threadId, turnId: turn.id, userId: input.userId, text: input.text.trim(), applyAt: input.applyAt || 'next_safe_checkpoint' });
    await this.store.appendEvent({ threadId: turn.threadId, turnId: turn.id, type: 'turn.steered', visibility: 'public', payload: { instructionId: instruction.id, applyAt: instruction.applyAt } });
    return instruction;
  }

  async consumePendingInstructions(turnId: string) {
    const instructions = await this.store.listPendingInstructions(turnId);
    for (const instruction of instructions) {
      await this.store.updateInstruction(instruction.id, { status: 'applied', appliedAt: nowIso() });
    }
    return instructions;
  }

  async saveCheckpoint(turnId: string, checkpoint: Record<string, unknown>) {
    const turn = await this.requiredTurn(turnId);
    await this.store.updateTurn(turnId, { checkpoint });
    return this.store.appendEvent({ threadId: turn.threadId, turnId, type: 'checkpoint.saved', visibility: 'technical', payload: checkpoint });
  }

  async requestApproval(turnId: string, action: string, summary: string) {
    const turn = await this.requiredTurn(turnId);
    const item = await this.createItem({ threadId: turn.threadId, turnId, kind: 'approval', role: 'orchestrator', status: 'pending', title: action, payload: { action, summary } });
    await this.store.appendEvent({ threadId: turn.threadId, turnId, itemId: item.id, type: 'approval.requested', visibility: 'public', payload: { action, summary } });
    await this.transitionTurn(turnId, 'waiting_for_user', { action });
    return item;
  }

  async resolveApproval(itemId: string, approved: boolean, userId: string) {
    const item = await this.requiredItem(itemId);
    const turn = await this.requiredTurn(item.turnId);
    if (turn.userId !== userId || item.kind !== 'approval') throw new Error('Invalid harness approval.');
    await this.store.appendEvent({ threadId: item.threadId, turnId: item.turnId, itemId, type: 'approval.resolved', visibility: 'public', payload: { approved } });
    await this.transitionItem(itemId, approved ? 'completed' : 'cancelled', { approved });
    if (approved) await this.transitionTurn(turn.id, 'running', { resumedAfterApproval: true });
    else await this.transitionTurn(turn.id, 'cancelled', { reason: 'approval_declined' });
    return { approved };
  }

  async cancelTurn(turnId: string, userId: string, reason = 'cancelled_by_user') {
    const turn = await this.requiredTurn(turnId);
    if (turn.userId !== userId) throw new Error('Harness turn ownership mismatch.');
    if (isTerminalTurnStatus(turn.status)) return turn;
    this.abortControllers.get(turnId)?.abort(reason);
    return this.transitionTurn(turnId, 'cancelled', { reason });
  }

  private claimResources(resourceKeys: string[], turnId: string) {
    for (const key of resourceKeys) {
      const owner = this.resourceOwners.get(key);
      if (owner) throw new Error(`Harness resource is already owned: ${key} (${owner}, turn ${turnId}).`);
    }
  }

  private releaseResources(itemId: string) {
    for (const [key, owner] of this.resourceOwners) if (owner === itemId) this.resourceOwners.delete(key);
  }

  private async requiredTurn(turnId: string) {
    const turn = await this.store.getTurn(turnId);
    if (!turn) throw new Error(`Harness turn not found: ${turnId}`);
    return turn;
  }

  private async requiredItem(itemId: string) {
    const item = await this.store.getItem(itemId);
    if (!item) throw new Error(`Harness item not found: ${itemId}`);
    return item;
  }
}

export function createHarnessTurnIdempotencyKey(input: { userId: string; projectId: string; requestId?: string; clientMessageId?: string }) {
  return [input.userId, input.projectId, input.clientMessageId || input.requestId || harnessId('turn')].join(':');
}
