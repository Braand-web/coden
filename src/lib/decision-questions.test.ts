import { describe, expect, it } from 'vitest';
import { composeDecisionInstruction, normalizeDecisionQuestions } from './decision-questions';
import type { DecisionQuestion } from './agent-chat-protocol';

describe('normalizeDecisionQuestions', () => {
  it('keeps well-formed questions and defaults the type to single choice', () => {
    expect(normalizeDecisionQuestions([
      { q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] },
      { q: 'Quelles pages ?', type: 'check', options: ['Accueil', 'Tarifs'] },
      { q: 'Quelle langue ?', options: ['Français'] },
    ])).toEqual([
      { q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] },
      { q: 'Quelles pages ?', type: 'check', options: ['Accueil', 'Tarifs'] },
      { q: 'Quelle langue ?', type: 'radio', options: ['Français'] },
    ]);
  });

  it('drops a question the card could not draw', () => {
    // No options means no rows, and the card is made of rows.
    expect(normalizeDecisionQuestions([{ q: 'Et ensuite ?', type: 'radio', options: [] }])).toEqual([]);
    expect(normalizeDecisionQuestions([{ q: '   ', type: 'radio', options: ['Oui'] }])).toEqual([]);
    expect(normalizeDecisionQuestions([{ q: 'Oui ?', type: 'radio', options: ['', '  '] }])).toEqual([]);
  });

  it('treats anything that is not a list of questions as no questionnaire at all', () => {
    for (const value of [undefined, null, 'questions', 42, {}, [null], ['a']]) {
      expect(normalizeDecisionQuestions(value)).toEqual([]);
    }
  });
});

describe('composeDecisionInstruction', () => {
  const questions: DecisionQuestion[] = [
    { q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] },
    { q: 'Quelles pages ?', type: 'check', options: ['Accueil', 'Tarifs', 'Blog'] },
    { q: 'Quelle langue ?', type: 'radio', options: ['Français', 'Anglais'] },
  ];

  it('sends every answer in one instruction', () => {
    const instruction = composeDecisionInstruction(questions, {
      0: { selected: [0] },
      1: { selected: [0, 2] },
      2: { selected: [], custom: 'Les deux' },
    });
    expect(instruction).toBe([
      'Mes réponses :',
      '',
      '1. Quel style ?',
      '   → Minimal',
      '2. Quelles pages ?',
      '   → Accueil, Blog',
      '3. Quelle langue ?',
      '   → Les deux',
    ].join('\n'));
  });

  it('says a question was skipped rather than leaving it out', () => {
    // Two answers to three questions otherwise reads as a question never
    // asked, which calls for asking again — the opposite of what was meant.
    expect(composeDecisionInstruction(questions, { 0: { selected: [1] } })).toContain('2. Quelles pages ?\n   → (sans réponse — décide toi-même)');
  });

  it('keeps a chosen option and the free text beside it', () => {
    expect(composeDecisionInstruction(questions, { 1: { selected: [1], custom: 'et une page contact' } }))
      .toContain('2. Quelles pages ?\n   → Tarifs\n   → et une page contact');
  });

  it('ignores an option index that does not exist', () => {
    expect(composeDecisionInstruction(questions, { 0: { selected: [7] } })).toContain('1. Quel style ?\n   → (sans réponse');
  });

  it('is empty when there is nothing to send', () => {
    expect(composeDecisionInstruction([], {})).toBe('');
  });
});
