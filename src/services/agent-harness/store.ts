import {
  canTransitionItem,
  canTransitionTurn,
  harnessId,
  isTerminalTurnStatus,
  nowIso,
  type CreateThreadInput,
  type CreateTurnInput,
  type HarnessEvent,
  type HarnessEventType,
  type HarnessInstruction,
  type HarnessItem,
  type HarnessItemStatus,
  type HarnessThread,
  type HarnessTurn,
  type HarnessTurnStatus,
} from './contracts.ts';

export interface AgentHarnessStore {
  createThread(input: CreateThreadInput): Promise<HarnessThread>;
  getThread(threadId: string): Promise<HarnessThread | null>;
  findActiveThread(projectId: string, userId: string): Promise<HarnessThread | null>;
  listThreads(projectId: string, userId: string, limit?: number): Promise<HarnessThread[]>;
  updateThread(threadId: string, patch: Partial<HarnessThread>): Promise<HarnessThread>;
  createTurn(input: CreateTurnInput): Promise<{ turn: HarnessTurn; created: boolean }>;
  getTurn(turnId: string): Promise<HarnessTurn | null>;
  updateTurn(turnId: string, patch: Partial<HarnessTurn>): Promise<HarnessTurn>;
  createItem(input: Omit<HarnessItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<HarnessItem>;
  getItem(itemId: string): Promise<HarnessItem | null>;
  updateItem(itemId: string, patch: Partial<HarnessItem>): Promise<HarnessItem>;
  appendEvent(input: Omit<HarnessEvent, 'id' | 'sequence' | 'createdAt'>): Promise<HarnessEvent>;
  listEvents(threadId: string, afterSequence?: number, limit?: number): Promise<HarnessEvent[]>;
  addInstruction(input: Omit<HarnessInstruction, 'id' | 'createdAt' | 'status'>): Promise<HarnessInstruction>;
  listPendingInstructions(turnId: string): Promise<HarnessInstruction[]>;
  updateInstruction(instructionId: string, patch: Partial<HarnessInstruction>): Promise<HarnessInstruction>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryAgentHarnessStore implements AgentHarnessStore {
  private readonly threads = new Map<string, HarnessThread>();
  private readonly turns = new Map<string, HarnessTurn>();
  private readonly items = new Map<string, HarnessItem>();
  private readonly events = new Map<string, HarnessEvent[]>();
  private readonly instructions = new Map<string, HarnessInstruction>();
  private readonly turnIdempotency = new Map<string, string>();
  private readonly threadLocks = new Map<string, Promise<void>>();

  async createThread(input: CreateThreadInput) {
    const now = nowIso();
    const thread: HarnessThread = {
      id: input.id || harnessId('thread'),
      version: 'coden-harness/v3',
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      status: 'active',
      title: input.title?.trim() || 'Coden mission',
      nextSequence: 1,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    };
    if (this.threads.has(thread.id)) throw new Error(`Harness thread already exists: ${thread.id}`);
    this.threads.set(thread.id, thread);
    this.events.set(thread.id, []);
    return clone(thread);
  }

  async getThread(threadId: string) {
    const thread = this.threads.get(threadId);
    return thread ? clone(thread) : null;
  }

  async findActiveThread(projectId: string, userId: string) {
    const thread = [...this.threads.values()]
      .filter(item => item.projectId === projectId && item.userId === userId && item.status === 'active')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return thread ? clone(thread) : null;
  }

  async listThreads(projectId: string, userId: string, limit = 20) {
    return clone([...this.threads.values()]
      .filter(item => item.projectId === projectId && item.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(limit, 100))));
  }

  async updateThread(threadId: string, patch: Partial<HarnessThread>) {
    const current = this.threads.get(threadId);
    if (!current) throw new Error(`Harness thread not found: ${threadId}`);
    const next = { ...current, ...patch, id: current.id, updatedAt: nowIso() };
    this.threads.set(threadId, next);
    return clone(next);
  }

  async createTurn(input: CreateTurnInput) {
    const key = `${input.threadId}:${input.idempotencyKey}`;
    const existingId = this.turnIdempotency.get(key);
    if (existingId) return { turn: clone(this.turns.get(existingId)!), created: false };
    const thread = this.threads.get(input.threadId);
    if (!thread) throw new Error(`Harness thread not found: ${input.threadId}`);
    if (thread.userId !== input.userId) throw new Error('Harness thread ownership mismatch.');
    if (thread.activeTurnId) {
      const activeTurn = this.turns.get(thread.activeTurnId);
      if (activeTurn && !isTerminalTurnStatus(activeTurn.status)) {
        throw new Error('A harness thread can only have one active turn. Steer the active turn instead.');
      }
    }
    const now = nowIso();
    const turn: HarnessTurn = {
      id: input.id || harnessId('turn'),
      threadId: input.threadId,
      parentTurnId: input.parentTurnId,
      userId: input.userId,
      status: 'queued',
      requestedMode: input.requestedMode || 'auto',
      prompt: input.prompt,
      idempotencyKey: input.idempotencyKey,
      definitionOfDone: input.definitionOfDone || [],
      budget: { maxToolCalls: 48, maxSubagents: 6, maxRepairAttempts: 3, maxDurationMs: 30 * 60_000, ...input.budget },
      budgetUsed: { toolCalls: 0, subagents: 0, repairAttempts: 0, credits: 0 },
      createdAt: now,
      updatedAt: now,
    };
    this.turns.set(turn.id, turn);
    this.turnIdempotency.set(key, turn.id);
    this.threads.set(thread.id, { ...thread, activeTurnId: turn.id, updatedAt: now });
    return { turn: clone(turn), created: true };
  }

  async getTurn(turnId: string) {
    const turn = this.turns.get(turnId);
    return turn ? clone(turn) : null;
  }

  async updateTurn(turnId: string, patch: Partial<HarnessTurn>) {
    const current = this.turns.get(turnId);
    if (!current) throw new Error(`Harness turn not found: ${turnId}`);
    if (patch.status && !canTransitionTurn(current.status, patch.status)) {
      throw new Error(`Invalid harness turn transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, id: current.id, threadId: current.threadId, updatedAt: nowIso() };
    this.turns.set(turnId, next);
    if (isTerminalTurnStatus(next.status)) {
      const thread = this.threads.get(next.threadId);
      if (thread?.activeTurnId === turnId) this.threads.set(thread.id, { ...thread, activeTurnId: undefined, updatedAt: nowIso() });
    }
    return clone(next);
  }

  async createItem(input: Omit<HarnessItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    if (!this.turns.has(input.turnId)) throw new Error(`Harness turn not found: ${input.turnId}`);
    const now = nowIso();
    const item: HarnessItem = { ...input, id: input.id || harnessId('item'), createdAt: now, updatedAt: now };
    this.items.set(item.id, item);
    return clone(item);
  }

  async getItem(itemId: string) {
    const item = this.items.get(itemId);
    return item ? clone(item) : null;
  }

  async updateItem(itemId: string, patch: Partial<HarnessItem>) {
    const current = this.items.get(itemId);
    if (!current) throw new Error(`Harness item not found: ${itemId}`);
    if (patch.status && !canTransitionItem(current.status, patch.status)) {
      throw new Error(`Invalid harness item transition: ${current.status} -> ${patch.status}`);
    }
    const next = { ...current, ...patch, id: current.id, turnId: current.turnId, threadId: current.threadId, updatedAt: nowIso() };
    this.items.set(itemId, next);
    return clone(next);
  }

  async appendEvent(input: Omit<HarnessEvent, 'id' | 'sequence' | 'createdAt'>) {
    return this.withThreadLock(input.threadId, async () => {
      const thread = this.threads.get(input.threadId);
      if (!thread) throw new Error(`Harness thread not found: ${input.threadId}`);
      const event: HarnessEvent = {
        ...input,
        id: harnessId('event'),
        sequence: thread.nextSequence,
        createdAt: nowIso(),
      };
      this.events.get(input.threadId)!.push(event);
      this.threads.set(thread.id, { ...thread, nextSequence: thread.nextSequence + 1, updatedAt: event.createdAt });
      return clone(event);
    });
  }

  async listEvents(threadId: string, afterSequence = 0, limit = 500) {
    return clone((this.events.get(threadId) || []).filter(event => event.sequence > afterSequence).slice(0, Math.max(1, Math.min(limit, 2_000))));
  }

  async addInstruction(input: Omit<HarnessInstruction, 'id' | 'createdAt' | 'status'>) {
    const turn = this.turns.get(input.turnId);
    if (!turn || turn.threadId !== input.threadId) throw new Error('Harness turn not found for instruction.');
    if (isTerminalTurnStatus(turn.status)) throw new Error('Cannot steer a terminal harness turn.');
    const instruction: HarnessInstruction = { ...input, id: harnessId('instruction'), status: 'pending', createdAt: nowIso() };
    this.instructions.set(instruction.id, instruction);
    return clone(instruction);
  }

  async listPendingInstructions(turnId: string) {
    return clone([...this.instructions.values()].filter(item => item.turnId === turnId && item.status === 'pending'));
  }

  async updateInstruction(instructionId: string, patch: Partial<HarnessInstruction>) {
    const current = this.instructions.get(instructionId);
    if (!current) throw new Error(`Harness instruction not found: ${instructionId}`);
    const next = { ...current, ...patch, id: current.id };
    this.instructions.set(instructionId, next);
    return clone(next);
  }

  private async withThreadLock<T>(threadId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.threadLocks.get(threadId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.threadLocks.set(threadId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.threadLocks.get(threadId) === queued) this.threadLocks.delete(threadId);
    }
  }
}

export function turnEventTypeForStatus(status: HarnessTurnStatus): HarnessEventType {
  const map: Record<HarnessTurnStatus, HarnessEventType> = {
    queued: 'turn.created',
    running: 'turn.started',
    waiting_for_user: 'turn.waiting_for_user',
    verifying: 'turn.verifying',
    completed: 'turn.completed',
    failed: 'turn.failed',
    cancelled: 'turn.cancelled',
    blocked: 'turn.blocked',
  };
  return map[status];
}

export function itemEventTypeForStatus(status: HarnessItemStatus): HarnessEventType {
  const map: Record<HarnessItemStatus, HarnessEventType> = {
    pending: 'item.created',
    running: 'item.started',
    completed: 'item.completed',
    failed: 'item.failed',
    cancelled: 'item.cancelled',
    blocked: 'item.failed',
  };
  return map[status];
}
