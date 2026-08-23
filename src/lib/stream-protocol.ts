/**
 * Coden Stream Protocol v2
 *
 * Typed SSE event contract shared by the server (producer) and the
 * frontend stream client (consumer). Every event is emitted as:
 *
 *   id: <sequence>\n
 *   event: <type>\n
 *   data: <JSON of the full event object>\n\n
 *
 * The numeric `id` mirrors the SSE `id:` field so clients can resume a
 * dropped connection with the `Last-Event-ID` header.
 */

export const CODEN_STREAM_PROTOCOL_VERSION = 'coden-stream-v2' as const;

export const CODEN_SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;

/** SSE comment line used as keepalive. Parsers must skip it. */
export const CODEN_SSE_HEARTBEAT = ': keepalive\n\n';
export const CODEN_SSE_HEARTBEAT_INTERVAL_MS = 15_000;

export type CodenStreamMilestone =
  | 'understanding'
  | 'inspecting'
  | 'planning'
  | 'generating'
  | 'checking'
  | 'fixing'
  | 'preview_ready';

/**
 * Reasoning phases the agent walks through, in order. These power the new
 * transparent pipeline UI (understand → decide → plan → reason → build →
 * verify → fix → recap) so the user sees the agent *think*, never guess.
 */
export type CodenReasoningPhase =
  | 'understand'
  | 'decide'
  | 'plan'
  | 'reason'
  | 'build'
  | 'verify'
  | 'fix'
  | 'recap';

export const CODEN_REASONING_PHASE_ORDER: readonly CodenReasoningPhase[] = [
  'understand',
  'decide',
  'plan',
  'reason',
  'build',
  'verify',
  'fix',
  'recap',
];

/** A single actionable step in the agent's plan, shown as a live checklist. */
export type CodenPlanStep = {
  id: string;
  title: string;
  /** What the step does to the workspace. */
  kind: 'create' | 'edit' | 'delete' | 'task';
  path?: string;
};

export type CodenStreamEventType =
  | 'mode_requested'
  | 'mode_resolved'
  | 'status'
  | 'milestone'
  | 'phase'
  | 'understanding'
  | 'assumption'
  | 'clarification'
  | 'plan'
  | 'plan_step'
  | 'reasoning_delta'
  | 'assistant_delta'
  | 'file_start'
  | 'file_delta'
  | 'file_done'
  | 'check'
  | 'warning'
  | 'error'
  | 'done'
  | 'tool_call'
  | 'tool_result'
  | 'source'
  | 'citation'
  | 'attachment'
  | 'skill_resolved'
  | 'skill_started'
  | 'skill_budget_exhausted'
  | 'approval_requested'
  | 'verification_started'
  | 'verification_completed';

const EVENT_TYPES: readonly CodenStreamEventType[] = [
  'mode_requested',
  'mode_resolved',
  'status',
  'milestone',
  'phase',
  'understanding',
  'assumption',
  'clarification',
  'plan',
  'plan_step',
  'reasoning_delta',
  'assistant_delta',
  'file_start',
  'file_delta',
  'file_done',
  'check',
  'warning',
  'error',
  'done',
  'tool_call',
  'tool_result',
  'source',
  'citation',
  'attachment',
  'skill_resolved',
  'skill_started',
  'skill_budget_exhausted',
  'approval_requested',
  'verification_started',
  'verification_completed',
];

interface CodenStreamEventBase {
  v: typeof CODEN_STREAM_PROTOCOL_VERSION;
  /** Stable run identity when the server persists/replays events. */
  runId?: string;
  /** Monotonic sequence number, mirrored in the SSE `id:` field. */
  id: number;
  /** v2 name for the same monotonic sequence. Kept alongside id during migration. */
  sequence?: number;
  /** Epoch milliseconds at emission time. */
  ts: number;
  type: CodenStreamEventType;
}

export interface CodenStatusEvent extends CodenStreamEventBase {
  type: 'status';
  /** Short user-facing status line in the user language. */
  message: string;
}

export interface CodenMilestoneEvent extends CodenStreamEventBase {
  type: 'milestone';
  milestone: CodenStreamMilestone;
  state: 'active' | 'done';
  /** Optional user-facing label override. */
  label?: string;
}

/**
 * Phase transition. Drives the transparent pipeline timeline. `state: 'active'`
 * highlights the phase; earlier active phases auto-complete on the client.
 */
export interface CodenPhaseEvent extends CodenStreamEventBase {
  type: 'phase';
  phase: CodenReasoningPhase;
  state: 'active' | 'done' | 'failed';
  /** Optional user-facing label override. */
  label?: string;
}

/** What the agent understood from the request — shown before it acts. */
export interface CodenUnderstandingEvent extends CodenStreamEventBase {
  type: 'understanding';
  /** One-sentence restatement of the goal, in the user's language. */
  summary: string;
  /** Detected project kind, e.g. "calculatrice React". */
  projectType?: string;
  /** Concrete requirements the agent extracted. */
  requirements: string[];
  /** Calibrated confidence 0–1 from the decision core. */
  confidence?: number;
}

/** An explicit assumption surfaced when acting at medium confidence. */
export interface CodenAssumptionEvent extends CodenStreamEventBase {
  type: 'assumption';
  text: string;
}

/**
 * The agent stops and asks ONE focused question instead of guessing.
 * Optional `options` render as quick-reply chips.
 */
export interface CodenClarificationEvent extends CodenStreamEventBase {
  type: 'clarification';
  question: string;
  options?: string[];
}

/** The full plan, emitted once as a checklist the build phase ticks off. */
export interface CodenPlanEvent extends CodenStreamEventBase {
  type: 'plan';
  steps: CodenPlanStep[];
  planId?: string;
  title?: string;
  objective?: string;
  files?: string[];
  risks?: string[];
  acceptanceCriteria?: string[];
}

/** A plan step changing state (the live checklist tick). */
export interface CodenPlanStepEvent extends CodenStreamEventBase {
  type: 'plan_step';
  stepId: string;
  state: 'active' | 'done' | 'failed';
}

/**
 * Incremental reasoning text — the agent thinking out loud. Rendered in a
 * collapsible "Réflexion" panel, separate from the assistant's final answer.
 */
export interface CodenReasoningDeltaEvent extends CodenStreamEventBase {
  type: 'reasoning_delta';
  text: string;
}

export interface CodenAssistantDeltaEvent extends CodenStreamEventBase {
  type: 'assistant_delta';
  /** Incremental assistant text chunk for fluid rendering. */
  text: string;
}

export interface CodenFileStartEvent extends CodenStreamEventBase {
  type: 'file_start';
  path: string;
  language?: string;
  index?: number;
  total?: number;
}

export interface CodenFileDeltaEvent extends CodenStreamEventBase {
  type: 'file_delta';
  path: string;
  /** Number of characters generated so far for this file. */
  chars: number;
}

export interface CodenFileDoneEvent extends CodenStreamEventBase {
  type: 'file_done';
  path: string;
  bytes?: number;
  additions?: number;
  deletions?: number;
}

export interface CodenCheckEvent extends CodenStreamEventBase {
  type: 'check';
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail?: string;
}

export interface CodenWarningEvent extends CodenStreamEventBase {
  type: 'warning';
  message: string;
}

export interface CodenErrorEvent extends CodenStreamEventBase {
  type: 'error';
  message: string;
  recoverable: boolean;
  diagnostic_code?: string;
}

export interface CodenDoneEvent extends CodenStreamEventBase {
  type: 'done';
  /** Final response payload (same shape as the non-streaming JSON response). */
  payload: unknown;
}

/** A tool invocation initiated by the agent (input streaming or available). */
export interface CodenToolCallEvent extends CodenStreamEventBase {
  type: 'tool_call';
  callId: string;
  name: string;
  input?: unknown;
  state?: 'input-streaming' | 'input-available';
}

/** The result of a tool invocation. */
export interface CodenToolResultEvent extends CodenStreamEventBase {
  type: 'tool_result';
  callId: string;
  name?: string;
  output?: unknown;
  error?: string;
}

/** A web/source the agent consulted, surfaced as a citation chip. */
export interface CodenSourceEvent extends CodenStreamEventBase {
  type: 'source';
  url: string;
  title?: string;
}

/** An inline citation tied to streamed text. */
export interface CodenCitationEvent extends CodenStreamEventBase {
  type: 'citation';
  url: string;
  title?: string;
  snippet?: string;
}

/** A file/image attachment surfaced in the assistant message. */
export interface CodenAttachmentEvent extends CodenStreamEventBase {
  type: 'attachment';
  name: string;
  mediaType?: string;
  url?: string;
  size?: number;
}

export interface CodenModeRequestedEvent extends CodenStreamEventBase {
  type: 'mode_requested';
  mode: 'auto' | 'build' | 'plan';
}

export interface CodenModeResolvedEvent extends CodenStreamEventBase {
  type: 'mode_resolved';
  mode: 'auto' | 'build' | 'plan';
  action: string;
  confidence?: number;
}

export interface CodenSkillResolvedEvent extends CodenStreamEventBase {
  type: 'skill_resolved';
  skill_id: string;
  skill_version?: string;
  budget?: Record<string, number>;
  reason?: string;
}

export interface CodenSkillStartedEvent extends CodenStreamEventBase {
  type: 'skill_started';
  skill_id: string;
  skill_version?: string;
}

export interface CodenSkillBudgetExhaustedEvent extends CodenStreamEventBase {
  type: 'skill_budget_exhausted';
  skill_id: string;
  skill_version?: string;
  budget?: Record<string, number>;
}

export interface CodenApprovalEvent extends CodenStreamEventBase {
  type: 'approval_requested';
  action: string;
  summary: string;
}

export interface CodenVerificationStartedEvent extends CodenStreamEventBase {
  type: 'verification_started';
}

export interface CodenVerificationCompletedEvent extends CodenStreamEventBase {
  type: 'verification_completed';
  status?: 'pass' | 'fail' | 'incomplete';
  checks?: number;
}

export type CodenStreamEvent =
  | CodenModeRequestedEvent
  | CodenModeResolvedEvent
  | CodenStatusEvent
  | CodenMilestoneEvent
  | CodenPhaseEvent
  | CodenUnderstandingEvent
  | CodenAssumptionEvent
  | CodenClarificationEvent
  | CodenPlanEvent
  | CodenPlanStepEvent
  | CodenReasoningDeltaEvent
  | CodenAssistantDeltaEvent
  | CodenFileStartEvent
  | CodenFileDeltaEvent
  | CodenFileDoneEvent
  | CodenCheckEvent
  | CodenWarningEvent
  | CodenErrorEvent
  | CodenDoneEvent
  | CodenToolCallEvent
  | CodenToolResultEvent
  | CodenSourceEvent
  | CodenCitationEvent
  | CodenAttachmentEvent
  | CodenSkillResolvedEvent
  | CodenSkillStartedEvent
  | CodenSkillBudgetExhaustedEvent
  | CodenApprovalEvent
  | CodenVerificationStartedEvent
  | CodenVerificationCompletedEvent;

export function isCodenStreamEvent(value: unknown): value is CodenStreamEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<CodenStreamEventBase>;
  return (
    record.v === CODEN_STREAM_PROTOCOL_VERSION &&
    typeof record.id === 'number' &&
    typeof record.type === 'string' &&
    (EVENT_TYPES as readonly string[]).includes(record.type)
  );
}

/** Serializes one event into a spec-compliant SSE block. */
export function serializeCodenStreamEvent(event: CodenStreamEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

type CodenStreamEventInput<T extends CodenStreamEventType> = Omit<
  Extract<CodenStreamEvent, { type: T }>,
  'v' | 'id' | 'ts' | 'type'
>;

export interface CodenStreamEmitter {
  emit<T extends CodenStreamEventType>(type: T, body: CodenStreamEventInput<T>): CodenStreamEvent;
  heartbeat(): void;
  readonly lastId: number;
}

/**
 * Server-side helper: creates a sequenced emitter bound to a raw write
 * function (e.g. `res.write` on an Express response).
 *
 *   const stream = createCodenStreamEmitter((chunk) => res.write(chunk));
 *   stream.emit('milestone', { milestone: 'generating', state: 'active' });
 */
export function createCodenStreamEmitter(
  write: (chunk: string) => void,
  startId = 0,
  runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
): CodenStreamEmitter {
  let sequence = startId;
  return {
    emit(type, body) {
      sequence += 1;
      const event = {
        v: CODEN_STREAM_PROTOCOL_VERSION,
        runId,
        id: sequence,
        sequence,
        ts: Date.now(),
        type,
        ...body,
      } as unknown as CodenStreamEvent;
      write(serializeCodenStreamEvent(event));
      return event;
    },
    heartbeat() {
      write(CODEN_SSE_HEARTBEAT);
    },
    get lastId() {
      return sequence;
    },
  };
}
