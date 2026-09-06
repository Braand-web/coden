import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { consumeAgentStream, type AgentEnvelope } from './agent-chat-protocol';
import { createAgentEventStream } from '../services/agent-event-stream';
import { EMPTY_MESSAGE, reduceAgentMessage } from '../components/agent/agent-parts';
import { createNarrationFilter } from '../services/narration-filter';

function response(text: string, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
    controller.close();
  } }));
}
function encode(seq: number, channel: string, payload: unknown) {
  return `id: ${seq}\r\ndata: ${JSON.stringify({ seq, runId: 'run-1', ts: 1, channel, payload })}\r\n\r\n`;
}
describe('agent streaming protocol', () => {
  it('decodes split UTF-8 and CRLF, ignores replayed sequence, returns only the authoritative result', async () => {
    const events: AgentEnvelope[] = [];
    const text = encode(1, 'chat', { type: 'text_delta', delta: 'Création 🌍' });
    const result = await consumeAgentStream(response(text + text + encode(2, 'workspace', { type: 'result', result: { success: true, files: [] } }) + encode(3, 'chat', { type: 'run_finished', reason: 'completed' })), e => events.push(e));
    expect(events).toHaveLength(3); expect(events[0].payload).toEqual({ type: 'text_delta', delta: 'Création 🌍' }); expect(result.success).toBe(true);
  });
  it('does not silently complete on a disconnected stream', async () => {
    await expect(consumeAgentStream(response(encode(1, 'chat', { type: 'activity', label: 'Test' })), () => {})).rejects.toThrow('interrompue');
  });
  it('rejects malformed events and run changes', async () => {
    await expect(consumeAgentStream(response('data: {broken}\n\n'), () => {})).rejects.toThrow();
    const a = encode(1, 'chat', { type: 'heartbeat' });
    await expect(consumeAgentStream(response(a + a.replace('run-1', 'run-2')), () => {})).rejects.toThrow('mission');
  });
  it('preserves partial prose and stops the caret on error/cancellation', () => {
    const partial = reduceAgentMessage(EMPTY_MESSAGE, { type: 'text_delta', delta: 'Je vérifie.' }, 1);
    const failed = reduceAgentMessage(partial, { type: 'run_failed', message: 'Échec du build' }, 2);
    expect(failed.status).toBe('error'); expect(failed.parts[0]).toMatchObject({ text: 'Je vérifie.', done: true }); expect(failed.thinking).toBe(false);
    expect(reduceAgentMessage(failed, { type: 'activity', label: 'late' }, 3)).toBe(failed);
    expect(reduceAgentMessage(partial, { type: 'run_finished', reason: 'cancelled' }, 2).status).toBe('cancelled');
  });
  /*
   * The thinking line only animates while `thinking` holds a label, and only
   * `activity` sets one. Nothing emitted `activity`, so the shimmer had no
   * text and went silent on the first token — for the whole of the install,
   * the tool calls and the verification.
   */
  it('re-enters thinking with a label whenever a new phase starts', () => {
    const started = reduceAgentMessage(EMPTY_MESSAGE, { type: 'run_started', messageId: 'm1' }, 1);
    expect(started.thinking).toBe(true);

    const planning = reduceAgentMessage(started, { type: 'activity', label: 'Coden prépare le plan…' }, 2);
    expect(planning).toMatchObject({ thinking: true, activity: 'Coden prépare le plan…' });

    // Prose replaces the line: the run is saying something concrete.
    const speaking = reduceAgentMessage(planning, { type: 'text_delta', delta: 'Je crée la page.' }, 3);
    expect(speaking).toMatchObject({ thinking: false, activity: null });

    // Tools now run, which is the longest silence of a step.
    const working = reduceAgentMessage(speaking, { type: 'activity', label: 'Coden applique les changements…' }, 4);
    expect(working).toMatchObject({ thinking: true, activity: 'Coden applique les changements…' });
    expect(working.parts.at(-1)).toMatchObject({ type: 'text', text: 'Je crée la page.', done: true });
  });

  it('filters split code fences but preserves prose and inline code', () => {
    const filter = createNarrationFilter();
    expect(['Je lis `App`.', '\n``', '`tsx\nsecret code', '\n```', '\nTerminé.'].map(filter).join('')).toBe('Je lis `App`.\n\nTerminé.');
    const tildes = createNarrationFilter();
    expect(['avant\n~~', '~js\ncode', '\n~~~', '\naprès'].map(tildes).join('')).toBe('avant\n\naprès');
  });
  it('emits text_end before tools, monotonic ids and exactly one terminal result', async () => {
    const res = new EventEmitter() as any; let wire = '';
    res.status = () => res; res.set = () => res; res.flushHeaders = () => {}; res.write = (s: string) => { wire += s; return true; }; res.end = () => { res.writableEnded = true; res.emit('finish'); };
    const stream = createAgentEventStream(res, 'run-1');
    stream.chat({ type: 'text_delta', delta: 'Je modifie.' });
    stream.chat({ type: 'files_touched', action: 'edit', paths: ['src/App.tsx'] });
    await stream.finish({ success: true, summary: 'Build vérifié.', assistant_source:'model' }, 200);
    await stream.finish({ success: true }, 200);
    const events: AgentEnvelope[] = []; await consumeAgentStream(response(wire, 17), e => events.push(e));
    expect(events.map(e => e.payload.type)).toEqual(['text_delta', 'text_end', 'files_touched', 'result', 'text_delta', 'text_end', 'run_finished']);
    expect(events.map(e => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.every(e => e.messageId === 'run-1' && e.type === e.payload.type && Number.isFinite(e.timestamp))).toBe(true);
  });
  it('returns recoverable files even when the run reports failure', async () => {
    const result = { success: false, needs_fix: true, files: [{ path: 'index.html' }] };
    expect(await consumeAgentStream(response(encode(1, 'workspace', { type: 'result', result }) + encode(2, 'chat', { type: 'run_failed', message: 'Build failed' })), () => {})).toEqual(result);
  });
  it('never promotes a technical summary to model narration', async () => {
    const res = new EventEmitter() as any; let wire = '';
    res.status = () => res; res.set = () => res; res.flushHeaders = () => {}; res.write = (s:string) => { wire += s; }; res.end = () => res.emit('finish');
    const stream = createAgentEventStream(res,'run-1');
    await stream.finish({success:true,summary:'Generated internal summary'},200);
    expect(wire).not.toContain('text_delta');
  });

  it('persists every envelope before broadcasting and preserves sequence order', async () => {
    const res = new EventEmitter() as any; const order: string[] = [];
    res.status = () => res; res.set = () => res; res.flushHeaders = () => {};
    res.write = (s:string) => { order.push(`write:${JSON.parse(s.split('data: ')[1]).seq}`); };
    res.end = () => res.emit('finish');
    const stream = createAgentEventStream(res, 'run-1', { messageId: 'message-1', persist: async event => { order.push(`persist:${event.seq}`); } });
    stream.chat({ type: 'activity', label: 'Lecture des fichiers' });
    stream.workspace({ type: 'build_started', buildId: 'build-1' });
    await stream.finish({ success: true }, 200);
    expect(order).toEqual(['persist:1','write:1','persist:2','write:2','persist:3','write:3','persist:4','write:4']);
  });

  it('keeps persisting a durable run after the browser transport disconnects', async () => {
    const res = new EventEmitter() as any; const persisted: number[] = []; let wire = '';
    res.status = () => res; res.set = () => res; res.flushHeaders = () => {};
    res.write = (value: string) => { wire += value; return true; };
    res.end = () => { res.writableEnded = true; res.emit('finish'); };
    const stream = createAgentEventStream(res, 'run-1', { persist: async event => { persisted.push(event.seq); } });
    stream.chat({ type: 'activity', label: 'Inspection' });
    await stream.drain();
    res.emit('close');
    stream.workspace({ type: 'build_started', buildId: 'build-1' });
    await stream.finish({ success: true }, 200);
    expect(persisted).toEqual([1, 2, 3, 4]);
    expect((wire.match(/data:/g) || [])).toHaveLength(1);
  });

  it('can consume a replay after an existing cursor without requiring a repeated result', async () => {
    const seen: number[] = [];
    await consumeAgentStream(response(encode(4, 'chat', { type: 'text_delta', delta: 'suite' }) + encode(5, 'chat', { type: 'run_finished', reason: 'completed' })), event => seen.push(event.seq), {
      afterSequence: 3,
      expectedRunId: 'run-1',
      requireResult: false,
    });
    expect(seen).toEqual([4, 5]);
  });
});
