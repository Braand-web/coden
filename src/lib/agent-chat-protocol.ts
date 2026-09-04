export type FileAction = 'read' | 'search' | 'create' | 'edit' | 'delete';
export type ChatEvent =
  | { type: 'run_started'; messageId: string }
  | { type: 'activity'; label: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end' }
  | { type: 'files_touched'; action: FileAction; paths: string[] }
  | { type: 'run_finished'; reason: 'completed' | 'cancelled' }
  | { type: 'run_failed'; message: string }
  | { type: 'heartbeat' };
export type AgentEnvelope = {
  seq: number; runId: string; ts: number;
} & ({ channel: 'chat'; payload: ChatEvent } | { channel: 'workspace'; payload: { type: string; [key: string]: unknown } });

/** Incremental SSE framing, including CRLF, multiline data and split UTF-8. */
export async function consumeAgentStream(response: Response, onEvent: (event: AgentEnvelope) => void): Promise<any> {
  if (!response.body) throw new Error('Le serveur a renvoyé un flux vide.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let sequence = -1; let runId = ''; let terminal = false;
  let result: unknown; let hasResult = false;
  const frame = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const event = JSON.parse(data) as AgentEnvelope;
    if (!Number.isSafeInteger(event.seq) || !event.runId || !event.payload || !['chat', 'workspace'].includes(event.channel)) throw new Error('Événement serveur invalide.');
    if (runId && event.runId !== runId) throw new Error('Le flux a changé de mission.');
    runId = event.runId;
    if (event.seq <= sequence) return;
    sequence = event.seq;
    if (terminal) return;
    if (event.channel === 'workspace' && event.payload.type === 'result') { result = event.payload.result; hasResult = true; }
    if (event.channel === 'chat' && ['run_finished', 'run_failed'].includes(event.payload.type)) terminal = true;
    onEvent(event);
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
      if (buffer.length > 32 * 1024 * 1024) throw new Error('Événement serveur trop volumineux.');
      if (chunk.done) break;
    }
    if (buffer.trim()) frame(buffer);
    if (!terminal || !hasResult) throw new Error('Connexion interrompue avant la fin de la génération. Les fichiers déjà enregistrés sont conservés.');
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
