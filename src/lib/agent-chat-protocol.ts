export type FileAction = 'read' | 'search' | 'create' | 'edit' | 'delete';

export type DecisionOption = { id: string; label: string; description?: string; recommended?: boolean };
export type ChatEvent =
  | { type: 'run_started'; messageId: string }
  | { type: 'activity'; label: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'text_end' }
  | { type: 'files_touched'; action: FileAction; paths: string[] }
  | { type: 'decision_required'; decisionId: string; question: string; options: DecisionOption[]; allowFreeText: boolean }
  | { type: 'artifact_ready'; artifactId: string; artifactType: 'plan' | 'report' | 'diff' | 'screenshot'; title: string; version: number }
  | { type: 'cost_checkpoint'; checkpointId: string; creditsUsed: number; nextThreshold: number; completed: string; next: string; estimatedRemaining?: number }
  | { type: 'run_paused'; reason: 'decision' | 'cost' | 'user' | 'provider' }
  | { type: 'run_resumed' }
  | { type: 'run_finished'; reason: 'completed' | 'cancelled' }
  | { type: 'run_failed'; message: string; diagnosticCode?: string; recoverable?: boolean }
  | { type: 'run_cancelled'; message?: string }
  | { type: 'heartbeat' };

export type WorkspaceEvent =
  | { type: 'file_start'; path: string; action: Exclude<FileAction, 'read' | 'search'> }
  | { type: 'file_delta'; path: string; delta: string }
  | { type: 'file_end'; path: string; sha256?: string }
  | { type: 'file_deleted'; path: string }
  | { type: 'command_started'; commandId: string; command: string }
  | { type: 'command_output'; commandId: string; stream: 'stdout' | 'stderr'; delta: string }
  | { type: 'command_finished'; commandId: string; exitCode: number; durationMs?: number }
  | { type: 'dependency_progress'; phase: string; current?: number; total?: number }
  | { type: 'build_started'; buildId: string }
  | { type: 'build_finished'; buildId: string; success: boolean; durationMs?: number }
  | { type: 'test_started'; testId: string; title: string }
  | { type: 'test_finished'; testId: string; success: boolean; evidence?: string }
  | { type: 'preview_state'; status: string; url?: string; diagnosticCode?: string }
  | { type: 'browser_qa_result'; success: boolean; scenarioId: string; evidence: Record<string, unknown> }
  | { type: 'deployment_state'; status: string; deploymentId?: string; url?: string }
  | { type: 'workspace_error'; message: string; diagnosticCode: string; recoverable: boolean }
  | { type: 'result'; result: unknown }
  | { type: 'preview_ready'; projectId?: string; url: string; status?: string; port?: number }
  | { type: 'run_acknowledged'; threadId: string; turnId: string; runId: string }
  | { type: 'narration_failed'; code: string }
  | { type: 'sandbox_writing'; files: number }
  | { type: 'sandbox_installing' }
  | { type: 'sandbox_installed'; durationMs: number }
  | { type: 'sandbox_starting' }
  | { type: 'sandbox_failed'; stage: 'install' | 'start'; message: string; logs: string[] }
  | { type: 'repair_round_started'; round: number; errors: number }
  | { type: 'repair_round_finished'; round: number; errorsBefore: number; errorsAfter: number; filesTouched: string[] }
  | { type: 'repair_finished'; ok: boolean; rounds: number; reason: 'fixed' | 'no_progress' | 'round_limit' | 'no_errors' };

type AgentEnvelopeBase = {
  runId: string;
  messageId: string;
  seq: number;
  timestamp: number;
  /** Deprecated wire alias accepted during V3 replay. */
  ts?: number;
  type: string;
};

export type AgentEnvelope = AgentEnvelopeBase & (
  | { channel: 'chat'; payload: ChatEvent }
  | { channel: 'workspace'; payload: WorkspaceEvent }
);

export class AgentStreamInterruptedError extends Error {
  constructor(public readonly lastSequence: number, public readonly runId: string) {
    super('Connexion interrompue avant la fin de la génération. Les fichiers déjà enregistrés sont conservés.');
    this.name = 'AgentStreamInterruptedError';
  }
}

export type ConsumeAgentStreamOptions = {
  afterSequence?: number;
  expectedRunId?: string;
  requireResult?: boolean;
};

type LegacyEnvelope = {
  runId?: unknown; messageId?: unknown; seq?: unknown; timestamp?: unknown; ts?: unknown;
  type?: unknown; channel?: unknown; payload?: unknown;
};

function normalizeEnvelope(value: LegacyEnvelope): AgentEnvelope {
  if (!Number.isSafeInteger(value.seq) || !value.runId || !value.payload || !['chat', 'workspace'].includes(String(value.channel))) {
    throw new Error('Événement serveur invalide.');
  }
  const payload = value.payload as { type?: unknown };
  if (!payload || typeof payload.type !== 'string' || !payload.type) throw new Error('Événement serveur invalide.');
  const timestamp = Number(value.timestamp ?? value.ts);
  if (!Number.isFinite(timestamp)) throw new Error('Événement serveur invalide.');
  return {
    runId: String(value.runId),
    messageId: String(value.messageId || (payload.type === 'run_started' && (payload as any).messageId) || value.runId),
    seq: Number(value.seq),
    timestamp,
    ts: Number(value.ts ?? timestamp),
    type: String(value.type || payload.type),
    channel: value.channel as 'chat' | 'workspace',
    payload,
  } as AgentEnvelope;
}

/** Incremental SSE framing, including CRLF, multiline data and split UTF-8. */
export async function consumeAgentStream(response: Response, onEvent: (event: AgentEnvelope) => void, options: ConsumeAgentStreamOptions = {}): Promise<any> {
  if (!response.body) throw new Error('Le serveur a renvoyé un flux vide.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let sequence = Number.isSafeInteger(options.afterSequence) ? Number(options.afterSequence) : -1; let runId = options.expectedRunId || ''; let terminal = false;
  let result: unknown; let hasResult = false;
  const frame = (raw: string) => {
    const data = raw.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const event = normalizeEnvelope(JSON.parse(data) as LegacyEnvelope);
    if (runId && event.runId !== runId) throw new Error('Le flux a changé de mission.');
    runId = event.runId;
    if (event.seq <= sequence) return;
    sequence = event.seq;
    if (terminal) return;
    if (event.channel === 'workspace' && event.payload.type === 'result') { result = event.payload.result; hasResult = true; }
    if (event.channel === 'chat' && ['run_finished', 'run_failed', 'run_cancelled'].includes(event.payload.type)) terminal = true;
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
    if (!terminal || ((options.requireResult ?? true) && !hasResult)) throw new AgentStreamInterruptedError(sequence, runId);
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
