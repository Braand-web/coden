import { describe, expect, it } from 'vitest';
import {
  answerDecision, answerDecisionWithText, cancelDecision, createPendingDecision,
  DECISION_TTL_MS, DecisionRequiredError, isDecisionOpen, isDecisionRecord,
  isDecisionRequiredError, readDecisionRequest, settleDecision,
} from './agent-decision';
import type { DecisionQuestion } from '../lib/agent-chat-protocol';

const T0 = Date.parse('2026-09-19T10:00:00.000Z');
const questions: DecisionQuestion[] = [
  { q: 'Quelle base de données ?', type: 'radio', options: ['Supabase', 'SQLite'] },
];
const pending = (now = T0) => createPendingDecision({ id: 'd1', turnId: 't1', questions, reason: 'bloqué', now });

describe('reading what the agent asked', () => {
  it('accepts a request the card can actually draw', () => {
    expect(readDecisionRequest({ questions, reason: 'Je ne peux pas choisir seul.' }))
      .toEqual({ questions, reason: 'Je ne peux pas choisir seul.' });
  });

  it('refuses anything that is not an answerable question', () => {
    // Tool arguments are model output: unvalidated by construction. Stopping a
    // run to show an empty box is worse than carrying on.
    for (const args of [null, {}, { questions: [] }, { questions: [{ q: 'Et ?', options: [] }] }, { questions: 'oui' }]) {
      expect(readDecisionRequest(args)).toBeNull();
    }
  });
});

describe('the error that escapes the tool loop', () => {
  it('is recognisable after crossing a boundary that loses the prototype', () => {
    const error = new DecisionRequiredError(questions, 'bloqué');
    expect(isDecisionRequiredError(error)).toBe(true);
    expect(isDecisionRequiredError({ name: 'DecisionRequiredError' })).toBe(true);
    expect(isDecisionRequiredError(new Error('boom'))).toBe(false);
  });
});

describe('a decision waiting to be answered', () => {
  it('is open while it is pending and not past its deadline', () => {
    expect(isDecisionOpen(pending(), T0 + 1000)).toBe(true);
    expect(isDecisionOpen(pending(), T0 + DECISION_TTL_MS + 1)).toBe(false);
  });

  it('expires by being read, because nothing runs while a thread sits idle', () => {
    expect(settleDecision(pending(), T0 + DECISION_TTL_MS + 1).status).toBe('expired');
    expect(settleDecision(pending(), T0 + 1000).status).toBe('pending');
  });

  it('survives a round trip through storage', () => {
    expect(isDecisionRecord(JSON.parse(JSON.stringify(pending())))).toBe(true);
    expect(isDecisionRecord({ id: 'x' })).toBe(false);
    expect(isDecisionRecord(null)).toBe(false);
  });
});

describe('answering', () => {
  it('turns the choices into the instruction the resumed run reads', () => {
    const { record, changed } = answerDecision(pending(), { 0: { selected: [0] } }, T0 + 5000);
    expect(changed).toBe(true);
    expect(record.status).toBe('resolved');
    expect(record.answer).toContain('Supabase');
    expect(record.answeredAt).toBe(new Date(T0 + 5000).toISOString());
  });

  /*
   * The double answer is the normal case, not the exception: a person
   * double-clicks, a reconnecting tab replays its last send, a second device
   * answers the same card. Only the first may resume the run.
   */
  it('keeps the first answer and reports that later ones changed nothing', () => {
    const first = answerDecision(pending(), { 0: { selected: [0] } }, T0 + 5000);
    const second = answerDecision(first.record, { 0: { selected: [1] } }, T0 + 6000);
    expect(second.changed).toBe(false);
    expect(second.record.answer).toBe(first.record.answer);
    expect(second.record.answeredAt).toBe(first.record.answeredAt);
  });

  /*
   * Skipping every question is an answer, not the absence of one: it says
   * "decide for yourself", and the card's Skip button produces exactly this.
   * Treating it as empty would leave the run stranded on the one action a
   * person takes when they do not care which way it goes.
   */
  it('treats skipping everything as an answer, so Skip cannot strand the run', () => {
    const { record, changed } = answerDecision(pending(), {}, T0 + 1000);
    expect(changed).toBe(true);
    expect(record.status).toBe('resolved');
    expect(record.answer).toContain('sans réponse');
  });

  it('refuses prose that is only whitespace', () => {
    expect(answerDecisionWithText(pending(), '   ', T0 + 1000).changed).toBe(false);
  });

  it('accepts prose, which is what the composer sends', () => {
    const { record, changed } = answerDecisionWithText(pending(), 'Prends Supabase', T0 + 1000);
    expect(changed).toBe(true);
    expect(record.answer).toBe('Prends Supabase');
  });

  it('cannot be answered once it has expired', () => {
    const late = answerDecision(pending(), { 0: { selected: [0] } }, T0 + DECISION_TTL_MS + 1);
    expect(late.changed).toBe(false);
    expect(late.record.status).toBe('expired');
  });

  it('cannot be answered once it was cancelled', () => {
    const cancelled = cancelDecision(pending(), T0 + 1000);
    expect(cancelled.status).toBe('cancelled');
    expect(answerDecision(cancelled, { 0: { selected: [0] } }, T0 + 2000).changed).toBe(false);
  });
});
