import { describe, expect, it } from 'vitest';
import { CodenAgentHarness } from './harness';
import { InMemoryAgentHarnessStore } from './store';

async function fixture(budget: Record<string, number> = {}) {
  const store = new InMemoryAgentHarnessStore();
  const harness = new CodenAgentHarness(store);
  const thread = await harness.createThread({ organizationId: 'org', projectId: 'project', userId: 'user' });
  const { turn } = await harness.createTurn({ threadId: thread.id, userId: 'user', prompt: 'build', idempotencyKey: 'run', budget });
  await harness.transitionTurn(turn.id, 'running');
  return { store, harness, turn };
}

describe('concurrent harness accounting', () => {
  it('accumulates concurrent spend without losing counters', async () => {
    const { harness, store, turn } = await fixture();
    await Promise.all(Array.from({ length: 8 }, () => harness.recordSpend(turn.id, { toolCalls: 1, credits: 0.5, costUsd: 0.25 })));
    expect((await store.getTurn(turn.id))?.budgetUsed).toMatchObject({ toolCalls: 8, credits: 4, costUsd: 2 });
  });
  it('does not admit two tools through a one-call budget', async () => {
    const { harness, turn, store } = await fixture({ maxToolCalls: 1 });
    const outcomes = await Promise.allSettled(Array.from({ length: 2 }, () => harness.startTool({ turnId: turn.id, role: 'explorer', toolName: 'workspace.read' })));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((await store.getTurn(turn.id))?.budgetUsed.toolCalls).toBe(1);
  });
  it('does not admit two subagents through a one-agent budget', async () => {
    const { harness, turn, store } = await fixture({ maxSubagents: 1 });
    const outcomes = await Promise.allSettled(Array.from({ length: 2 }, () => harness.spawnSubagent({ turnId: turn.id, role: 'explorer', title: 'read', context: {} })));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect((await store.getTurn(turn.id))?.budgetUsed.subagents).toBe(1);
  });
  it('rejects non-finite spend without poisoning the stored budget', async () => {
    const { harness, turn, store } = await fixture();
    await expect(harness.recordSpend(turn.id, { credits: Infinity })).rejects.toThrow(/finite/i);
    expect((await store.getTurn(turn.id))?.budgetUsed.credits).toBe(0);
  });
  it('cannot spawn new work after cancellation', async () => {
    const { harness, turn } = await fixture();
    await harness.transitionTurn(turn.id, 'cancelled');
    await expect(harness.spawnSubagent({ turnId: turn.id, role: 'explorer', title: 'read', context: {} })).rejects.toThrow(/terminal/i);
  });
});
