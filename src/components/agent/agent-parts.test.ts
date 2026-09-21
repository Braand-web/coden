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
