import { describe, expect, it } from 'vitest';
import { CodenAgentHarness } from './harness.ts';
import { InMemoryAgentHarnessStore } from './store.ts';

describe('turn activity lookups', () => {
  it('finds where a turn starts in its thread and when it last recorded anything', async () => {
    const store = new InMemoryAgentHarnessStore();
    const harness = new CodenAgentHarness(store);
    const thread = await harness.createThread({ organizationId: 'org', projectId: 'project', userId: 'user' });
    const first = await harness.createTurn({ threadId: thread.id, userId: 'user', prompt: 'one', idempotencyKey: 'a' });
    await harness.transitionTurn(first.turn.id, 'running');
    await harness.transitionTurn(first.turn.id, 'failed', { diagnostic_code: 'X' });
    const second = await harness.createTurn({ threadId: thread.id, userId: 'user', prompt: 'two', idempotencyKey: 'b' });
    await store.appendEvent({ threadId: thread.id, turnId: second.turn.id, type: 'public.stream', visibility: 'public', payload: { seq: 1 } });

    const events = await store.listEvents(thread.id, 0, 500);
    const secondStart = events.find(event => event.turnId === second.turn.id)!.sequence;
    expect(await store.firstSequenceForTurn(thread.id, second.turn.id)).toBe(secondStart);
    expect(await store.firstSequenceForTurn(thread.id, 'turn_missing')).toBeNull();
    expect(await store.lastEventAtForTurn(thread.id, second.turn.id)).toBe(events.filter(event => event.turnId === second.turn.id).at(-1)!.createdAt);
    expect(await store.lastEventAtForTurn(thread.id, 'turn_missing')).toBeNull();
  });
});
