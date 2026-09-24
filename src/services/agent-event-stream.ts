import type { Response } from 'express';
import type { AgentEnvelope, ChatEvent, WorkspaceEvent } from '../lib/agent-chat-protocol.ts';

export type AgentEventStreamOptions = {
  messageId?: string;
  initialSequence?: number;
  /**
   * Called serially, in order, beside the stream. Consecutive deltas that
   * queue behind a slow write arrive folded into one envelope carrying
   * `segments` ([seq, length] per slice); see `expandPersistedEnvelope`.
   */
  persist?: (envelope: AgentEnvelope) => Promise<void>;
  persistAttempts?: number;
  retryDelayMs?: number;
};

const TERMINAL_EVENTS = new Set(['run_finished', 'run_failed', 'run_cancelled']);
/** A live run records something at least this often, heartbeats included. */
export const LIVENESS_PERSIST_MS = 30_000;

/**
 * A stored envelope back into the envelopes the client originally received.
 *
 * Deltas folded together while the store caught up are split on their
 * recorded segments, so a replay after envelope N resumes exactly at N + 1 —
 * never repeating text the client already shows, never skipping any.
 */
export function expandPersistedEnvelope(envelope: any): any[] {
  const segments = envelope?.payload?.segments;
  const delta = envelope?.payload?.delta;
  if (!Array.isArray(segments) || typeof delta !== 'string') return [envelope];
  let offset = 0;
  return segments.map(([sequence, length]: [number, number]) => {
    const slice = delta.slice(offset, offset + length);
    offset += length;
    return { ...envelope, seq: sequence, payload: { type: envelope.payload.type, delta: slice } };
  });
}

/** One transport, two logical channels. The terminal result stays authoritative. */
export function createAgentEventStream(res: Response, runId: string, options: AgentEventStreamOptions = {}) {
  let seq = Math.max(0, Math.floor(options.initialSequence || 0));
  let finalized = false; let closing = false; let transportOpen = true; let textOpen = false;
  /** Terminal writes only: they wait for persistence to catch up. */
  let pending: Promise<void> = Promise.resolve();
  let terminalQueued = false;
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

  const fail = (error: unknown) => {
    streamFailure = streamFailure || (error instanceof Error ? error : new Error(String(error)));
  };
  const write = (envelope: AgentEnvelope) => {
    if (!transportOpen || res.destroyed || res.writableEnded) return;
    if (res.writableLength > 8 * 1024 * 1024) { fail(new Error('AGENT_STREAM_BACKPRESSURE_LIMIT')); return; }
    res.write(`id: ${envelope.seq}\ndata: ${JSON.stringify(envelope)}\n\n`);
  };

  /*
   * Persistence runs beside the stream, never in front of it.
   *
   * Every envelope used to wait for its own database round trip before it
   * was written to the client. One append is ~170 ms in production, and the
   * text arrives in 40 ms slices, so the answer reached the browser at the
   * database's pace, not the model's: a reply the model had finished in
   * three seconds was still trickling in half a minute later, the backlog
   * growing with every token, and `finish` then waited for the whole backlog
   * before the run could end.
   *
   * Now the client gets each envelope the moment it exists; the store catches
   * up in order, folding the deltas that queued behind a slow write into one
   * row. `segments` records the sequence and length of every slice in the
   * row, so a reconnecting client is replayed exactly the slices it missed.
   * Only the terminal event still waits for the store: a run is not declared
   * finished to the client before its record is.
   */
  const persistQueue: AgentEnvelope[] = [];
  let lastPersistQueuedAt = Date.now();
  let persisting: Promise<void> = Promise.resolve();
  let persistRunning = false;
  const persistOne = async (envelope: AgentEnvelope) => {
    const attempts = Math.max(1, Math.min(3, options.persistAttempts ?? 3));
    for (let attempt = 0; attempt < attempts; attempt++) {
      try { await options.persist?.(envelope); return; }
      catch (error) {
        if (attempt === attempts - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, (options.retryDelayMs ?? 100) * (attempt + 1)));
      }
    }
  };
  const nextBatch = (): AgentEnvelope => {
    const first = persistQueue.shift()!;
    const type = first.payload.type;
    if (type !== 'text_delta' && type !== 'reasoning_delta') return first;
    const parts = [first];
    while (persistQueue.length && persistQueue[0].payload.type === type) parts.push(persistQueue.shift()!);
    if (parts.length === 1) return first;
    const last = parts[parts.length - 1];
    return {
      ...last,
      payload: {
        type,
        delta: parts.map(part => (part.payload as { delta: string }).delta).join(''),
        segments: parts.map(part => [part.seq, (part.payload as { delta: string }).delta.length]),
      },
    } as unknown as AgentEnvelope;
  };
  const pump = () => {
    if (persistRunning || !options.persist || !persistQueue.length) return;
    persistRunning = true;
    persisting = (async () => {
      while (persistQueue.length) {
        /*
         * A failure is remembered, not left in the chain: one slow or failed
         * write must not mute everything after it. The first failure is the
         * one `drain` and `finish` report, so the run is not quietly declared
         * healthy either.
         */
        try { await persistOne(nextBatch()); }
        catch (error) { fail(error); }
      }
      persistRunning = false;
    })();
  };
  const persisted = async () => { while (persistRunning || persistQueue.length) { pump(); await persisting; } };

  const send = (channel: AgentEnvelope['channel'], payload: ChatEvent | WorkspaceEvent) => {
    if (finalized) return;
    const nextSequence = ++seq;
    const timestamp = Date.now();
    const envelope = { runId, messageId, seq: nextSequence, timestamp, ts: timestamp, channel, type: payload.type, payload } as AgentEnvelope;
    /*
     * A heartbeat keeps this connection alive; a replay sends its own. One is
     * still recorded when nothing else has been for a while: that is how a
     * page coming back tells a run that is quietly installing from a run whose
     * process is gone (see the stream replay's liveness check).
     */
    if (options.persist && (payload.type !== 'heartbeat' || timestamp - lastPersistQueuedAt >= LIVENESS_PERSIST_MS)) {
      lastPersistQueuedAt = timestamp;
      persistQueue.push(envelope);
      pump();
    }
    // From the terminal event on, everything waits its turn behind it: the
    // client drops any envelope older than the last it saw, so a heartbeat
    // written ahead of a deferred run_finished would swallow the ending.
    if (terminalQueued || TERMINAL_EVENTS.has(payload.type)) {
      terminalQueued = true;
      pending = pending.then(persisted).then(() => { if (!streamFailure) write(envelope); });
    } else {
      write(envelope);
    }
  };
  const settled = () => pending.then(persisted).then(() => { if (streamFailure) throw streamFailure; });
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
    if (event.type === 'text_end') {
      // `endText` above already closed the open text, if there was one; a
      // second text_end is a duplicate the client renders as a break.
      if (transcript && !transcript.endsWith('\n\n')) transcript += '\n\n';
      return;
    }
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
