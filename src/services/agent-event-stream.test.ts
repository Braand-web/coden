import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createAgentEventStream, expandPersistedEnvelope } from './agent-event-stream.ts';

class ResponseStub extends EventEmitter {
  destroyed = false; writableEnded = false; writableLength = 0; writes: string[] = [];
  status() { return this; } set() { return this; } flushHeaders() {}
  write(value: string) { this.writes.push(value); return true; }
  end() { this.writableEnded = true; } destroy() { this.destroyed = true; }
}

const envelopes = (response: ResponseStub) => response.writes.map(chunk => JSON.parse(chunk.split('data: ')[1]));
const tick = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('agent event stream', () => {
  it('writes each envelope as it happens, without waiting for the store', async () => {
    const response = new ResponseStub();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const stream = createAgentEventStream(response as any, 'run', { persist: async () => { await gate; } });
    stream.chat({ type: 'activity', label: 'Coden réfléchit…' });
    stream.chat({ type: 'text_delta', delta: 'Bonjour' });
    await tick(60);
    // The store has not answered once, and the client already has both.
    expect(envelopes(response).map(envelope => envelope.type)).toEqual(['activity', 'text_delta']);
    const finished = stream.finish({ success: true, text: 'Bonjour', assistant_source: 'model', assistant_streamed: true }, 200);
    await tick(20);
    // The terminal event alone waits: the run is not declared finished before its record is.
    expect(envelopes(response).some(envelope => envelope.type === 'run_finished')).toBe(false);
    release();
    await finished;
    expect(envelopes(response).at(-1).type).toBe('run_finished');
  });

  it('closes a text once, however many times the producer says so', async () => {
    const response = new ResponseStub();
    const stream = createAgentEventStream(response as any, 'run');
    stream.chat({ type: 'text_delta', delta: 'Plan' });
    stream.chat({ type: 'text_end' });
    stream.chat({ type: 'text_end' });
    await stream.finish({ success: true, assistant_streamed: true }, 200);
    expect(envelopes(response).filter(envelope => envelope.type === 'text_end')).toHaveLength(1);
    expect(stream.transcript).toBe('Plan');
  });

  it('folds deltas that queued behind a slow write, and a replay splits them back exactly', async () => {
    const response = new ResponseStub();
    const stored: any[] = [];
    let calls = 0;
    const stream = createAgentEventStream(response as any, 'run', {
      persist: async envelope => { calls += 1; await tick(calls === 1 ? 120 : 0); stored.push(envelope); },
    });
    stream.chat({ type: 'activity', label: 'start' });
    for (const word of ['Un ', 'deux ', 'trois 👋 ', 'quatre']) { stream.chat({ type: 'text_delta', delta: word }); await tick(50); }
    await stream.finish({ success: true, assistant_streamed: true }, 200);

    const live = envelopes(response);
    const replayed = stored.flatMap(expandPersistedEnvelope);
    // Fewer rows than envelopes: the slow first write let the deltas fold.
    expect(stored.length).toBeLessThan(live.filter(envelope => envelope.type !== 'heartbeat').length);
    expect(replayed.map(envelope => [envelope.seq, envelope.payload.delta ?? envelope.type]))
      .toEqual(live.map(envelope => [envelope.seq, envelope.payload.delta ?? envelope.type]));
    // Resuming after any envelope gives exactly the rest of the text.
    const text = (after: number) => replayed.filter(envelope => envelope.seq > after && envelope.type === 'text_delta').map(envelope => envelope.payload.delta).join('');
    const firstText = live.find(envelope => envelope.type === 'text_delta').seq;
    expect(text(0)).toBe('Un deux trois 👋 quatre');
    expect(text(firstText)).toBe('deux trois 👋 quatre');
  });

  it('keeps the stream going after a failed write, and reports it at the end', async () => {
    const response = new ResponseStub();
    let calls = 0;
    const stream = createAgentEventStream(response as any, 'run', { retryDelayMs: 0, persistAttempts: 1, persist: async () => { calls += 1; if (calls === 1) throw new Error('offline'); } });
    stream.chat({ type: 'activity', label: 'one' });
    stream.chat({ type: 'activity', label: 'two' });
    await expect(stream.finish({ success: true }, 200)).rejects.toThrow('offline');
    expect(calls).toBeGreaterThan(1);
    expect(response.writes.join('')).toContain('two');
    expect(response.writes.join('')).not.toContain('run_finished');
  });
});

describe('agent event stream ordering', () => {
  it('never writes anything ahead of a run_finished that is waiting for the store', async () => {
    const response = new ResponseStub();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const stream = createAgentEventStream(response as any, 'run', { persist: async () => { await gate; } });
    stream.chat({ type: 'text_delta', delta: 'fin' });
    const finished = stream.finish({ success: true, assistant_streamed: true }, 200);
    stream.chat({ type: 'heartbeat' });
    release();
    await finished;
    const sequences = envelopes(response).map(envelope => envelope.seq);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(envelopes(response).some(envelope => envelope.type === 'run_finished')).toBe(true);
  });
});
