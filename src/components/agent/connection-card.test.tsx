import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentMessage } from './agent-message';
import { EMPTY_MESSAGE, reduceAgentMessage } from './agent-parts';

/**
 * The app needs a service: the chat asks with one button per way to get it,
 * and a way to put it off — not a generic questionnaire.
 */
describe('a connection question', () => {
  const state = reduceAgentMessage({ ...EMPTY_MESSAGE, status: 'streaming' }, {
    type: 'decision_required',
    decisionId: 'd1',
    question: 'Ton app a besoin d’une base de données. Que veux-tu utiliser ?',
    options: [],
    allowFreeText: false,
    questions: [{
      q: 'Ton app a besoin d’une base de données. Que veux-tu utiliser ?',
      type: 'radio',
      options: ['Coden Cloud', 'Supabase', 'Autre base de données'],
      connect: { need: 'database', choices: [{ kind: 'coden_cloud' }, { kind: 'toolkit', toolkit: 'supabase' }, { kind: 'browse', search: 'database' }] },
    }],
  });

  it('shows the choices as buttons and offers to do it later', () => {
    const html = renderToStaticMarkup(React.createElement(AgentMessage, { state, onDecisionAnswers: () => undefined }));
    expect(html).toContain('Connexion requise');
    expect(html).toContain('Ton app a besoin d’une base de données');
    for (const label of ['Coden Cloud', 'Supabase', 'Autre base de données', 'Plus tard']) expect(html).toContain(`>${label}<`);
  });

  it('shows each service with its real logo', () => {
    const html = renderToStaticMarkup(React.createElement(AgentMessage, { state, onDecisionAnswers: () => undefined }));
    expect(html).toContain('data-coden-logo="mark"');
    expect(html).toContain('src="/connector-logos/supabase.svg"');
  });

  it('keeps an ordinary questionnaire for questions without connection actions', () => {
    const plain = reduceAgentMessage({ ...EMPTY_MESSAGE, status: 'streaming' }, {
      type: 'decision_required', decisionId: 'd2', question: 'Laquelle ?', options: [], allowFreeText: true,
      questions: [{ q: 'Laquelle ?', type: 'radio', options: ['A', 'B'] }],
    });
    const html = renderToStaticMarkup(React.createElement(AgentMessage, { state: plain, onDecisionAnswers: () => undefined }));
    expect(html).not.toContain('Connexion requise');
  });
});
