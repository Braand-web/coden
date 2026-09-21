import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  answerDecisionWithText, createPendingDecision, isDecisionOpen, settleDecision,
} from './agent-decision';
import { SANDBOX_TOOL_SCHEMAS } from './sandbox/sandbox-tools';
import type { DecisionQuestion } from '../lib/agent-chat-protocol';

/**
 * The whole point of the flow, checked where it can be checked without a
 * sandbox and a provider: the tool exists and is described restrictively, the
 * server treats a decision as a pause rather than a failure, and answering
 * twice resumes once.
 */
const server = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const questions: DecisionQuestion[] = [{ q: 'Laquelle ?', type: 'radio', options: ['A', 'B'] }];

describe('the tool the agent stops with', () => {
  const tool = SANDBOX_TOOL_SCHEMAS.find(schema => schema.name === 'request_decision');

  it('is part of the real tool surface, not a second registry', () => {
    expect(tool).toBeTruthy();
    expect(tool?.parameters?.required).toEqual(['reason', 'questions']);
  });

  /*
   * A model's instinct on an under-specified task is to ask. Left to a bare
   * "ask the user" description it would stop on styling and naming, which
   * costs a round trip and reads as an agent that cannot work alone.
   */
  it('spends its description saying when not to call it', () => {
    const description = String(tool?.description || '');
    expect(description).toMatch(/ONLY when/);
    expect(description).toMatch(/Do NOT use it for preferences/);
    expect(description).toMatch(/at most once/);
  });
});

describe('the run that stopped to ask', () => {
  it('is answered successfully rather than reported as a failure', () => {
    // The paused branch must come before the failure handling, or a working
    // product shows the user a red panel.
    const pausedAt = server.indexOf('isDecisionRequiredError(error)');
    const failedAt = server.indexOf("const failureCode = interrupted ? 'RUN_INTERRUPTED'");
    expect(pausedAt).toBeGreaterThan(-1);
    expect(pausedAt).toBeLessThan(failedAt);
    expect(server).toContain("status: 'awaiting_decision'");
  });

  it('writes the decision and the resume point before announcing anything', () => {
    const helper = server.slice(server.indexOf('async function pauseRunForDecision'));
    const savedAt = helper.indexOf('saveResumeCheckpointForTurn');
    const emittedAt = helper.indexOf("type: 'decision_required'");
    expect(savedAt).toBeGreaterThan(-1);
    expect(savedAt).toBeLessThan(emittedAt);
  });

  it('tells the interface it is waiting, not finished', () => {
    const helper = server.slice(server.indexOf('async function pauseRunForDecision'));
    expect(helper).toContain("type: 'run_paused', reason: 'decision'");
  });
});

describe('answering it', () => {
  const T0 = Date.parse('2026-09-19T10:00:00.000Z');

  it('resumes exactly once however many times it is sent', () => {
    const decision = createPendingDecision({ id: 'd', turnId: 't', questions, now: T0 });
    const first = answerDecisionWithText(decision, 'Prends A', T0 + 1000);
    const second = answerDecisionWithText(first.record, 'Prends B', T0 + 2000);
    expect([first.changed, second.changed]).toEqual([true, false]);
    expect(second.record.answer).toBe('Prends A');
  });

  it('is what restarts the run on the client, not a queued instruction', () => {
    const client = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');
    expect(client).toMatch(/if \(response\.resumed && response\.prompt\)/);
    expect(client).toContain('__codenResumedFromDecision');
  });

  it('stops being answerable once it has aged out', () => {
    const decision = createPendingDecision({ id: 'd', turnId: 't', questions, now: T0, ttlMs: 1000 });
    expect(isDecisionOpen(decision, T0 + 2000)).toBe(false);
    expect(settleDecision(decision, T0 + 2000).status).toBe('expired');
  });
});

describe('after a refresh', () => {
  it('can be asked for again, because it lives on the thread', () => {
    expect(server).toContain("app.get('/api/projects/:id/agent/threads/:threadId/decision'");
    const client = readFileSync(new URL('../builder-live.ts', import.meta.url), 'utf8');
    expect(client).toContain('restorePendingDecision');
  });

  it('is cancelled with the turn, so it cannot outlive abandoned work', () => {
    expect(server).toContain('cancelDecision(openDecision, Date.now())');
  });
});
