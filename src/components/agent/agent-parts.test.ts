import { describe, expect, it } from 'vitest';
import { EMPTY_MESSAGE, reduceAgentMessage, type DecisionNotice } from './agent-parts';

/**
 * A questionnaire arrives over the wire, so the reducer is where it has to be
 * proved usable — the card downstream is made of the options it is given and
 * has nothing to draw without them.
 */
const decisionNotice = (questions: unknown) => {
  const state = reduceAgentMessage({ ...EMPTY_MESSAGE }, {
    type: 'decision_required',
    decisionId: 'd1',
    question: 'On part sur quoi ?',
    options: [{ id: 'a', label: 'Minimal' }, { id: 'b', label: 'Dense' }],
    allowFreeText: true,
    questions,
  } as any, 1);
  return state.notices?.find(notice => notice.type === 'decision') as DecisionNotice;
};

describe('decision_required', () => {
  it('carries a questionnaire when the event has one', () => {
    expect(decisionNotice([{ q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] }]).questions)
      .toEqual([{ q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] }]);
  });

  it('falls back to the single-question notice when the questionnaire is unusable', () => {
    // `questions` left undefined is every decision sent before questionnaires
    // existed, and must keep behaving exactly as it did.
    for (const value of [undefined, [], [{ q: 'Et ?', options: [] }], 'nope']) {
      const notice = decisionNotice(value);
      expect(notice.questions).toBeUndefined();
      expect(notice.question).toBe('On part sur quoi ?');
      expect(notice.options).toHaveLength(2);
    }
  });
});

describe('credits pause', () => {
  it('closes the stream as paused, not failed, and retains the reason', () => {
    const paused = reduceAgentMessage({ ...EMPTY_MESSAGE }, { type: 'run_paused', reason: 'credits' }, 1);
    const finished = reduceAgentMessage(paused, { type: 'run_finished', reason: 'completed' }, 2);

    expect(finished.status).toBe('done');
    expect(finished.pausedReason).toBe('credits');
    expect(finished.error).toBeUndefined();
    expect(finished.thinking).toBe(false);
  });
});

describe('research sources', () => {
  it('retains only a small set of public citations in the message', () => {
    const state = reduceAgentMessage({ ...EMPTY_MESSAGE }, { type: 'research_sources', sources: [
      { title: 'Guide', url: 'https://docs.example/guide' },
      { title: 'Release', url: 'https://docs.example/release' },
    ] }, 1);
    expect(state.researchSources).toHaveLength(2);
    expect(state.researchSources?.[0].url).toBe('https://docs.example/guide');
    const continued = reduceAgentMessage(state, { type: 'research_sources', sources: [{ title: 'Guide', url: 'https://docs.example/guide' }, { title: 'FAQ', url: 'https://docs.example/faq' }] }, 2);
    expect(continued.researchSources?.map(source => source.url)).toEqual(['https://docs.example/guide', 'https://docs.example/release', 'https://docs.example/faq']);
  });
});
