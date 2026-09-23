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
  /** The first transport or persistence failure, reported by drain and finish. */
  let streamFailure: Error | null = null;
  let textBuffer = '';
  let transcript = '';
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
    }).catch(error => {
      /*
       * Remember the failure; do not leave it in the chain.
       *
       * `pending` is what every later event chains onto, and `.then()` on a
       * rejected promise never runs its callback — so a single transient
       * persist error or one burst of backpressure silently muted the entire
       * rest of the run. The generation carried on writing files, the client
       * received nothing more, and the stream ended without a terminal event:
       * an interruption caused by one slow database write.
       *
       * The first failure is still the one `drain` and `finish` report, so the
       * run is not quietly declared healthy either.
       */
      streamFailure = streamFailure || (error instanceof Error ? error : new Error(String(error)));
    });
  };
  const settled = () => pending.then(() => { if (streamFailure) throw streamFailure; });
  const flushText = () => {
    if (textTimer) clearTimeout(textTimer);
    textTimer = undefined;
    if (!textBuffer) return;
    const delta = textBuffer; textBuffer = '';
    send('chat', { type: 'text_delta', delta });
  };
  // Reasoning is coalesced the same way, in its own buffer: it arrives in
  // tiny pieces and is shown folded, never mixed into the answer.
  let reasoningBuffer = '';
  let reasoningTimer: ReturnType<typeof setTimeout> | undefined;
  const flushReasoning = () => {
    if (reasoningTimer) clearTimeout(reasoningTimer);
    reasoningTimer = undefined;
    if (!reasoningBuffer) return;
    const delta = reasoningBuffer; reasoningBuffer = '';
    send('chat', { type: 'reasoning_delta', delta });
  };
  const endText = () => { flushReasoning(); flushText(); if (textOpen) { send('chat', { type: 'text_end' }); textOpen = false; } };
  const chat = (event: ChatEvent) => {
    if (finalized) return;
    if (event.type === 'reasoning_delta') {
      flushText();
      reasoningBuffer += event.delta;
      if (reasoningBuffer.length >= 8000) flushReasoning();
      else if (!reasoningTimer) reasoningTimer = setTimeout(flushReasoning, 60);
      return;
    }
    if (event.type !== 'text_delta' && event.type !== 'heartbeat') endText();
    if (event.type === 'text_delta') {
      flushReasoning();
      transcript += event.delta;
      textOpen = true; textBuffer += event.delta;
      if (textBuffer.length >= 12000) flushText();
      else if (!textTimer) textTimer = setTimeout(flushText, 40);
      return;
    }
    if (event.type === 'text_end' && transcript && !transcript.endsWith('\n\n')) transcript += '\n\n';
    flushText();
    send('chat', event);
  };
  const workspace = (payload: WorkspaceEvent) => { flushReasoning(); flushText(); send('workspace', payload); };
  const heartbeat = setInterval(() => chat({ type: 'heartbeat' }), 15_000);
  heartbeat.unref();
  const cleanup = () => { finalized = true; transportOpen = false; clearInterval(heartbeat); if (textTimer) clearTimeout(textTimer); if (reasoningTimer) clearTimeout(reasoningTimer); textBuffer = ''; reasoningBuffer = ''; };
  res.once('close', () => { transportOpen = false; });
  res.once('finish', () => { transportOpen = false; });

  return {
    chat,
    workspace,
    drain: () => { flushReasoning(); flushText(); return settled(); },
    get lastSequence() { return seq; },
    get transcript() { return transcript.trim(); },
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
        await settled();
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
