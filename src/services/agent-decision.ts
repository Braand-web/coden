/**
 * A decision the run cannot take on its own.
 *
 * Not a question — a stop. The agent reaches a point where continuing would
 * mean guessing at something only the person can settle, so the run puts down
 * what it knows and waits. Everything here is about making that wait survivable:
 * a page refresh, a dropped connection, a container replaced mid-stream.
 *
 * The state is deliberately small and explicit. A decision is `pending` until
 * it is answered, and then it is `resolved` forever — answering twice is the
 * normal case, not the exception, because a person double-clicks and a tab
 * reconnects. `expired` exists so a decision nobody answered stops holding a
 * conversation open, and `cancelled` so leaving is a real outcome rather than
 * an abandoned record.
 *
 * Pure and clock-injected: `now` is a parameter, so none of this needs a timer
 * or a database to be tested.
 */

import type { DecisionAnswer, DecisionQuestion } from '../lib/agent-chat-protocol.ts';
import { composeDecisionInstruction, normalizeDecisionQuestions } from '../lib/decision-questions.ts';

export type DecisionStatus = 'pending' | 'resolved' | 'cancelled' | 'expired';

export type DecisionRecord = {
  id: string;
  turnId: string;
  questions: DecisionQuestion[];
  /** Why the run says it cannot continue. Shown to nobody; kept for the logs. */
  reason: string;
  status: DecisionStatus;
  createdAt: string;
  expiresAt: string;
  answeredAt?: string;
  /** The instruction the answers became, replayed into the resumed run. */
  answer?: string;
};

/**
 * A decision left unanswered stops holding the conversation after this.
 *
 * Long enough to survive a night — somebody closing their laptop mid-build
 * should find the question waiting — and short enough that a thread does not
 * stay half-open forever.
 */
export const DECISION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Raised by the tool, re-thrown by the loop, caught by the run.
 *
 * It is not a failure: the run stops having done everything it could, with its
 * work saved, and resumes when the answer arrives. Carrying a distinct type is
 * what lets the tool loop tell it apart from a tool that merely broke — that
 * loop feeds ordinary handler errors back to the model, which would turn a
 * stop into one more thing for the model to work around.
 */
export class DecisionRequiredError extends Error {
  /*
   * Fields assigned in the body, not declared as constructor parameters.
   *
   * Node's `--experimental-strip-types` erases annotations without running a
   * compiler, and a parameter property is not an annotation — it emits an
   * assignment. Written the short way, every one of the 117 suites that runs
   * under that flag and transitively reaches this file dies on
   * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX before its first assertion.
   */
  readonly questions: DecisionQuestion[];
  readonly reason: string;

  constructor(questions: DecisionQuestion[], reason: string) {
    super('The run needs a decision from the user before it can continue.');
    this.name = 'DecisionRequiredError';
    this.questions = questions;
    this.reason = reason;
  }
}

export function isDecisionRequiredError(value: unknown): value is DecisionRequiredError {
  return value instanceof DecisionRequiredError
    || (Boolean(value) && typeof value === 'object' && (value as { name?: string }).name === 'DecisionRequiredError');
}

const MAX_REASON = 300;

/**
 * What the agent asked for, if it asked for something answerable.
 *
 * A tool call is model output, so it arrives unvalidated: the questions may be
 * missing, empty, or carry no options to choose between. Anything the card
 * could not draw is not a decision, and the run is better off carrying on than
 * stopping to show an empty box.
 */
export function readDecisionRequest(args: unknown): { questions: DecisionQuestion[]; reason: string } | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as { questions?: unknown; reason?: unknown };
  const questions = normalizeDecisionQuestions(record.questions);
  if (!questions.length) return null;
  const reason = typeof record.reason === 'string' ? record.reason.trim().slice(0, MAX_REASON) : '';
  return { questions, reason };
}

export function createPendingDecision(input: {
  id: string;
  turnId: string;
  questions: DecisionQuestion[];
  reason?: string;
  now: number;
  ttlMs?: number;
}): DecisionRecord {
  return {
    id: input.id,
    turnId: input.turnId,
    questions: input.questions,
    reason: input.reason || '',
    status: 'pending',
    createdAt: new Date(input.now).toISOString(),
    expiresAt: new Date(input.now + (input.ttlMs ?? DECISION_TTL_MS)).toISOString(),
  };
}

/** A decision still worth showing: pending, and not past its deadline. */
export function isDecisionOpen(record: DecisionRecord | null | undefined, now: number): boolean {
  if (!record || record.status !== 'pending') return false;
  return Date.parse(record.expiresAt) > now;
}

/**
 * The record as it stands at `now`, which may be later than it was written.
 *
 * Expiry is a fact about time, not an event anybody fires: nothing runs while a
 * conversation sits idle, so a decision becomes expired by being read after its
 * deadline rather than by being marked.
 */
export function settleDecision(record: DecisionRecord, now: number): DecisionRecord {
  if (record.status !== 'pending') return record;
  if (Date.parse(record.expiresAt) > now) return record;
  return { ...record, status: 'expired' };
}

/**
 * Answering, once.
 *
 * A person double-clicks, a reconnecting tab replays its last send, two devices
 * answer the same card. The first answer wins and every later one returns the
 * record unchanged, so the run is resumed exactly once — `changed` is what the
 * caller keys that off, rather than comparing records.
 */
export function answerDecision(
  record: DecisionRecord,
  answers: Record<number, DecisionAnswer>,
  now: number,
): { record: DecisionRecord; changed: boolean } {
  const settled = settleDecision(record, now);
  if (settled.status !== 'pending') return { record: settled, changed: false };
  const answer = composeDecisionInstruction(settled.questions, answers);
  if (!answer) return { record: settled, changed: false };
  return {
    record: { ...settled, status: 'resolved', answeredAt: new Date(now).toISOString(), answer },
    changed: true,
  };
}

/** Answering in prose, which is what the composer sends. */
export function answerDecisionWithText(
  record: DecisionRecord,
  text: string,
  now: number,
): { record: DecisionRecord; changed: boolean } {
  const settled = settleDecision(record, now);
  if (settled.status !== 'pending') return { record: settled, changed: false };
  const answer = String(text || '').trim();
  if (!answer) return { record: settled, changed: false };
  return {
    record: { ...settled, status: 'resolved', answeredAt: new Date(now).toISOString(), answer },
    changed: true,
  };
}

export function cancelDecision(record: DecisionRecord, now: number): DecisionRecord {
  if (record.status !== 'pending') return settleDecision(record, now);
  return { ...record, status: 'cancelled' };
}

/** A stored value that is actually a decision, whatever else is on the thread. */
export function isDecisionRecord(value: unknown): value is DecisionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DecisionRecord>;
  return typeof record.id === 'string' && Boolean(record.id)
    && typeof record.turnId === 'string'
    && Array.isArray(record.questions)
    && typeof record.expiresAt === 'string'
    && ['pending', 'resolved', 'cancelled', 'expired'].includes(String(record.status));
}
