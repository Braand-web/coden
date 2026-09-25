import { describe, expect, it } from 'vitest';
import { composeDecisionInstruction, normalizeDecisionQuestions } from './decision-questions';

describe('connection questions', () => {
  const raw = [{
    q: 'Ton app a besoin d’une base de données. Que veux-tu utiliser ?',
    type: 'radio',
    options: ['Coden Cloud', 'Supabase', 'Autre base de données'],
    connect: { need: 'database', choices: [{ kind: 'coden_cloud' }, { kind: 'toolkit', toolkit: 'supabase' }, { kind: 'browse', search: 'database' }] },
  }];

  it('survive the wire with one action per option', () => {
    const [question] = normalizeDecisionQuestions(raw);
    expect(question.connect?.choices).toEqual([{ kind: 'coden_cloud' }, { kind: 'toolkit', toolkit: 'supabase' }, { kind: 'browse', search: 'database' }]);
  });

  it('lose their actions, not the question, when the actions are malformed', () => {
    const [mismatched] = normalizeDecisionQuestions([{ ...raw[0], connect: { need: 'database', choices: [{ kind: 'coden_cloud' }] } }]);
    expect(mismatched.connect).toBeUndefined();
    expect(mismatched.options).toHaveLength(3);
    const [unsafe] = normalizeDecisionQuestions([{ ...raw[0], connect: { need: 'database', choices: [{ kind: 'coden_cloud' }, { kind: 'toolkit', toolkit: 'javascript:alert(1)' }, { kind: 'browse' }] } }]);
    expect(unsafe.connect).toBeUndefined();
  });

  it('answer the run with what actually happened', () => {
    const questions = normalizeDecisionQuestions(raw);
    const instruction = composeDecisionInstruction(questions, { 0: { selected: [1], custom: 'Supabase est maintenant connecté via Composio.' } });
    expect(instruction).toContain('→ Supabase');
    expect(instruction).toContain('connecté via Composio');
  });
});
