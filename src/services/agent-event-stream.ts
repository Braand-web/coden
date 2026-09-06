import type { Response } from 'express';
import type { AgentEnvelope, ChatEvent, WorkspaceEvent } from '../lib/agent-chat-protocol.ts';

export type AgentEventStreamOptions = {
  messageId?: string;
  initialSequence?: number;
  /** Called serially before the envelope is written to the client. */
  persist?: (envelope: AgentEnvelope) => Promise<void>;
};

/** One transport, two logical channels. The terminal result stays authoritative. */
export function createAgentEventStream(res: Response, runId: string, options: AgentEventStreamOptions = {}) {
  let seq = Math.max(0, Math.floor(options.initialSequence || 0));
  let finalized = false; let closing = false; let transportOpen = true; let textOpen = false;
  let pending: Promise<void> = Promise.resolve();
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
      await options.persist?.(envelope);
      if (!transportOpen || res.destroyed || res.writableEnded) return;
      if (res.writableLength > 8 * 1024 * 1024) throw new Error('AGENT_STREAM_BACKPRESSURE_LIMIT');
      res.write(`id: ${envelope.seq}\ndata: ${JSON.stringify(envelope)}\n\n`);
    });
  };
  const endText = () => { if (textOpen) { send('chat', { type: 'text_end' }); textOpen = false; } };
  const chat = (event: ChatEvent) => {
    if (event.type !== 'text_delta' && event.type !== 'heartbeat') endText();
    if (event.type === 'text_delta') textOpen = true;
    send('chat', event);
  };
  const workspace = (payload: WorkspaceEvent) => send('workspace', payload);
  const heartbeat = setInterval(() => chat({ type: 'heartbeat' }), 15_000);
  heartbeat.unref();
  const cleanup = () => { finalized = true; transportOpen = false; clearInterval(heartbeat); };
  res.once('close', () => { transportOpen = false; });
  res.once('finish', () => { transportOpen = false; });

  return {
    chat,
    workspace,
    drain: () => pending,
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
