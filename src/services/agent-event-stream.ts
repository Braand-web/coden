import type { Response } from 'express';
import type { AgentEnvelope, ChatEvent } from '../lib/agent-chat-protocol.ts';

/** One transport, two logical channels. The terminal result stays authoritative. */
export function createAgentEventStream(res: Response, runId: string) {
  let seq = 0; let closed = false; let textOpen = false;
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event: Omit<AgentEnvelope, 'seq' | 'runId' | 'ts'>) => {
    if (closed || res.destroyed || res.writableEnded) return;
    if (res.writableLength > 8 * 1024 * 1024) { res.destroy(); return; }
    const envelope = { ...event, seq: ++seq, runId, ts: Date.now() };
    res.write(`id: ${seq}\ndata: ${JSON.stringify(envelope)}\n\n`);
  };
  const endText = () => { if (textOpen) { send({ channel: 'chat', payload: { type: 'text_end' } }); textOpen = false; } };
  const chat = (event: ChatEvent) => {
    if (event.type !== 'text_delta' && event.type !== 'heartbeat') endText();
    if (event.type === 'text_delta') textOpen = true;
    send({ channel: 'chat', payload: event });
  };
  const heartbeat = setInterval(() => chat({ type: 'heartbeat' }), 15_000);
  heartbeat.unref();
  const cleanup = () => { closed = true; clearInterval(heartbeat); };
  res.once('close', cleanup); res.once('finish', cleanup);
  return {
    chat,
    workspace: (payload: { type: string; [key: string]: unknown }) => send({ channel: 'workspace', payload }),
    finish(payload: any, status: number) {
      if (closed) return;
      endText();
      send({ channel: 'workspace', payload: { type: 'result', result: { ...payload, status_code: status } } });
      const answer = [payload.summary, payload.text, payload.message].find(value => typeof value === 'string' && value.trim());
      if (answer && payload.assistant_source === 'model' && !payload.assistant_streamed) { chat({ type: 'text_delta', delta: answer }); endText(); }
      chat(status === 499 ? {type:'run_finished',reason:'cancelled'} : status >= 400 || payload.success === false
        ? { type: 'run_failed', message: String(payload.error || payload.message || 'La génération nécessite une correction. Les résultats disponibles sont conservés.') }
        : { type: 'run_finished', reason: 'completed' });
      cleanup(); res.end();
    },
  };
}
