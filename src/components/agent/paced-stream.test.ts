// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBuilderConversation } from '../../builder-conversation-island';
import type { AgentEnvelope, ChatEvent } from '../../lib/agent-chat-protocol';

/**
 * The paced path, which only exists where there is a scheduler.
 *
 * The node suite exercises the fallback — no `window`, so nothing is queued.
 * This is the branch that actually runs in a browser, and the thing it must
 * never do is lose a character or reorder the message.
 */

let host: HTMLElement;
let api: ReturnType<typeof mountBuilderConversation>;

const envelope = (seq: number, payload: ChatEvent): AgentEnvelope => ({
  runId: 'run-1', messageId: 'm1', seq, timestamp: seq, type: payload.type, channel: 'chat', payload,
});

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  api = mountBuilderConversation(host, {});
});

afterEach(() => {
  api.clear();
  host.remove();
  vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTime(5000);

describe('paced streaming', () => {
  it('delivers every character it was sent', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    const chunks = ['Bonjour, ', 'je vais créer ', 'ton application de tâches.'];
    chunks.forEach((delta, index) => api.applyChatEvent(id, envelope(index + 1, { type: 'text_delta', delta })));

    // Held back at first — that is the point.
    expect(api.messages()[0].content.length).toBeLessThan(chunks.join('').length);

    settle();
    expect(api.messages()[0].content).toBe(chunks.join(''));
  });

  it('never lets a tool line overtake the sentence it came after', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'Je regarde les fichiers concernés. '.repeat(4) }));
    api.applyChatEvent(id, envelope(2, { type: 'files_touched', action: 'read', paths: ['src/App.tsx'] }));

    const partsNow = api.messages()[0].liveRun?.chat?.parts ?? [];
    expect(partsNow.some(part => part.type === 'tool')).toBe(false);

    settle();
    const parts = api.messages()[0].liveRun?.chat?.parts ?? [];
    expect(parts.map(part => part.type)).toEqual(['text', 'tool']);
    expect((parts[0] as any).text).toContain('Je regarde les fichiers concernés.');
  });

  it('shows the rest at once when the run ends, rather than typing on after it', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'x'.repeat(800) }));
    api.applyChatEvent(id, envelope(2, { type: 'run_finished', reason: 'completed' }));

    // Synchronously, without waiting for a single further tick.
    expect(api.messages()[0].content).toBe('x'.repeat(800));
    expect(api.messages()[0].liveRun?.chat?.status).toBe('done');
  });

  it('ignores a sequence it has already taken, so a replay cannot duplicate text', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'une fois' }));
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'une fois' }));
    settle();
    expect(api.messages()[0].content).toBe('une fois');
  });

  it('records what arrived, not what has been drawn, so a reconnect resumes from the right place', () => {
    // `Last-Event-ID` replays from this. Advancing it only as the pacer
    // releases would have the server resend everything still queued.
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(7, { type: 'text_delta', delta: 'y'.repeat(600) }));
    expect(api.messages()[0].liveRun?.lastSequence).toBe(7);
    expect(api.messages()[0].content.length).toBeLessThan(600);
  });
});
