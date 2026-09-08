import type { Response } from 'express';
import type { AgentEnvelope, ChatEvent, WorkspaceEvent } from '../lib/agent-chat-protocol.ts';

export type AgentEventStreamOptions = {
  messageId?: string;
  initialSequence?: number;
  /** Called serially before the envelope is written to the client. */
  persist?: (envelope: AgentEnvelope) => Promise<void>;
  persistAttempts?: number;
  retryDelayMs?: number;
};

/** One transport, two logical channels. The terminal result stays authoritative. */
export function createAgentEventStream(res: Response, runId: string, options: AgentEventStreamOptions = {}) {
  let seq = Math.max(0, Math.floor(options.initialSequence || 0));
  let finalized = false; let closing = false; let transportOpen = true; let textOpen = false;
  let pending: Promise<void> = Promise.resolve();
  let textBuffer = '';
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  const messageId = options.messageId || runId;
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders();

  const send = (channel: AgentEnvelope['channel'], payload: ChatEvent | WorkspaceEvent) => {
    if (finalized) return;
    const nextSequence = ++seq;
    const timestamp = Date.now();
    const envelope = { runId, messageId, seq: nextSequence, timestamp, ts: timestamp, channel, type: payload.type, payload } as AgentEnvelope;
    pending = pending.then(async () => {
      const attempts = Math.max(1, Math.min(3, options.persistAttempts ?? 3));
      for (let attempt = 0; attempt < attempts; attempt++) {
        try { await options.persist?.(envelope); break; }
        catch (error) {
          if (attempt === attempts - 1) throw error;
          await new Promise(resolve => setTimeout(resolve, (options.retryDelayMs ?? 100) * (attempt + 1)));
        }
      }
      if (!transportOpen || res.destroyed || res.writableEnded) return;
      if (res.writableLength > 8 * 1024 * 1024) throw new Error('AGENT_STREAM_BACKPRESSURE_LIMIT');
      res.write(`id: ${envelope.seq}\ndata: ${JSON.stringify(envelope)}\n\n`);
    });
    // Observe a rejection immediately; drain/finish still receive the original failure.
    void pending.catch(() => undefined);
  };
  const flushText = () => {
    if (textTimer) clearTimeout(textTimer);
    textTimer = undefined;
    if (!textBuffer) return;
    const delta = textBuffer; textBuffer = '';
    send('chat', { type: 'text_delta', delta });
  };
  const endText = () => { flushText(); if (textOpen) { send('chat', { type: 'text_end' }); textOpen = false; } };
  const chat = (event: ChatEvent) => {
    if (finalized) return;
    if (event.type !== 'text_delta' && event.type !== 'heartbeat') endText();
    if (event.type === 'text_delta') {
      textOpen = true; textBuffer += event.delta;
      if (textBuffer.length >= 12000) flushText();
      else if (!textTimer) textTimer = setTimeout(flushText, 40);
      return;
    }
    flushText();
    send('chat', event);
  };
  const workspace = (payload: WorkspaceEvent) => { flushText(); send('workspace', payload); };
  const heartbeat = setInterval(() => chat({ type: 'heartbeat' }), 15_000);
  heartbeat.unref();
  const cleanup = () => { finalized = true; transportOpen = false; clearInterval(heartbeat); if (textTimer) clearTimeout(textTimer); textBuffer = ''; };
  res.once('close', () => { transportOpen = false; });
  res.once('finish', () => { transportOpen = false; });

  return {
    chat,
    workspace,
    drain: () => { flushText(); return pending; },
    get lastSequence() { return seq; },
    async finish(payload: any, status: number) {
      if (finalized || closing) return;
      closing = true;
      endText();
      workspace({ type: 'result', result: { ...payload, status_code: status } });
      const answer = [payload.summary, payload.text, payload.message].find(value => typeof value === 'string' && value.trim());
      if (answer && payload.assistant_source === 'model' && !payload.assistant_streamed) { chat({ type: 'text_delta', delta: answer }); endText(); }
      chat(status === 499
        ? { type: 'run_cancelled', message: String(payload.message || '') || undefined }
        : status >= 400 || payload.success === false
          ? { type: 'run_failed', message: String(payload.error || payload.message || 'La génération nécessite une correction. Les résultats disponibles sont conservés.'), diagnosticCode: payload.diagnostic_code, recoverable: Boolean(payload.recoverable) }
          : { type: 'run_finished', reason: 'completed' });
      try {
        await pending;
        if (transportOpen && !res.destroyed && !res.writableEnded) res.end();
        cleanup();
      } catch (error) {
        cleanup();
        res.destroy(error as Error);
        throw error;
      }
    },
  };
}
