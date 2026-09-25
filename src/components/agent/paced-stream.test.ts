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
  it('restores complete text, reasoning and file steps as a finished chat message', () => {
    const id = api.addMessage({ id: 'persisted-message-1', role: 'assistant', content: 'Le scaffold est léger et fournit une base complète.' });
    api.restoreChat(id, [
      { type: 'run_started', messageId: id },
      { type: 'reasoning_delta', delta: 'Je vérifie les fichiers avant de répondre.' },
      { type: 'text_delta', delta: 'Le scaffold est léger et fournit une base complète.' },
      { type: 'text_end' },
      { type: 'files_touched', action: 'read', paths: ['src/App.tsx', 'package.json'] },
    ], 'done', 'Le scaffold est léger et fournit une base complète.', '', 'run-1');

    const message = api.messages()[0];
    expect(message.id).toBe('persisted-message-1');
    expect(message.working).toBe(false);
    expect(message.liveRun?.chat?.status).toBe('done');
    expect(message.liveRun?.chat?.parts.map(part => part.type)).toEqual(['reasoning', 'text', 'tool']);
    expect((message.liveRun?.chat?.parts[0] as any).text).toBe('Je vérifie les fichiers avant de répondre.');
    expect((message.liveRun?.chat?.parts[1] as any).text).toBe('Le scaffold est léger et fournit une base complète.');
    expect((message.liveRun?.chat?.parts[2] as any).files).toEqual(['src/App.tsx', 'package.json']);
  });

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

  it('types the rest out after the end event, then closes the run', () => {
    // Showing everything at once on `run_finished` drew a run's closing
    // summary in one frame — the burst the pacing exists to remove.
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'x'.repeat(800) }));
    api.applyChatEvent(id, envelope(2, { type: 'run_finished', reason: 'completed' }));

    expect(api.messages()[0].content.length).toBeLessThan(800);
    expect(api.messages()[0].liveRun?.chat?.status).toBe('streaming');

    settle();
    expect(api.messages()[0].content).toBe('x'.repeat(800));
    expect(api.messages()[0].liveRun?.chat?.status).toBe('done');
  });

  it('waits for the typing before the Builder closes the run', () => {
    // `finishLiveRun` arrives the moment the request resolves, often with a
    // second of text still queued. Closing then would have cut it off.
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'Une réponse complète. '.repeat(20) }));
    api.finishLiveRun(id, '');
    expect(api.messages()[0].liveRun?.chat?.status).toBe('streaming');
    settle();
    expect(api.messages()[0].liveRun?.chat?.status).toBe('done');
    expect(api.messages()[0].content).toBe('Une réponse complète. '.repeat(20));
  });

  it('shows everything that arrived when the run fails, then the failure', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'y'.repeat(600) }));
    api.failLiveRun(id, 'Connexion perdue.');
    const chat = api.messages()[0].liveRun?.chat;
    expect(chat?.status).toBe('error');
    expect(chat?.parts.filter(part => part.type === 'text').map(part => (part as any).text).join('')).toBe('y'.repeat(600));
  });

  it('settles a single-block reply on its checked text once typing is done', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'Voici la clé sk-proj-abc' }));
    api.settleText(id, 'Voici la clé [masked-secret]');
    api.applyChatEvent(id, envelope(2, { type: 'run_finished', reason: 'completed' }));
    settle();
    const parts = api.messages()[0].liveRun?.chat?.parts ?? [];
    expect(parts.filter(part => part.type === 'text').map(part => (part as any).text)).toEqual(['Voici la clé [masked-secret]']);
  });

  it('never collapses narration interleaved with tool lines', () => {
    const id = api.addMessage({ role: 'assistant', content: '' });
    api.startLiveRun(id);
    api.applyChatEvent(id, envelope(1, { type: 'text_delta', delta: 'Je lis le fichier.' }));
    api.applyChatEvent(id, envelope(2, { type: 'files_touched', action: 'read', paths: ['src/App.tsx'] }));
    api.applyChatEvent(id, envelope(3, { type: 'text_delta', delta: 'Terminé.' }));
    api.applyChatEvent(id, envelope(4, { type: 'run_finished', reason: 'completed' }));
    api.settleText(id, 'Résumé final.');
    settle();
    const parts = api.messages()[0].liveRun?.chat?.parts ?? [];
    expect(parts.map(part => part.type)).toEqual(['text', 'tool', 'text']);
  });

  it('lights the thinking line from the click and puts it out when work stops', () => {
    const id = api.addMessage({ role: 'assistant', content: '', working: true });
    api.setWorking(id, 'Coden analyse votre demande…');
    expect(api.messages()[0].liveRun?.chat?.thinking).toBe(true);
    api.startLiveRun(id);
    // The phrase already on screen is carried into the run, not reset.
    expect(api.messages()[0].liveRun?.chat?.activity).toBe('Coden analyse votre demande…');
    api.clearWorking(id);
    expect(api.messages()[0].liveRun?.chat?.thinking).toBe(false);
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
