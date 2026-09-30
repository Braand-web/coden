import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_MESSAGE, reduceAgentMessage, type AgentMessageState } from './agent-parts';
import { AgentMessage } from './agent-message';
import type { ChatEvent } from '../../lib/agent-chat-protocol';

const run = (events: ChatEvent[]): AgentMessageState => events.reduce((state, event, index) => reduceAgentMessage(state, event, index + 1), { ...EMPTY_MESSAGE });
const html = (state: AgentMessageState) => renderToStaticMarkup(<AgentMessage state={state} />);

const initial: ChatEvent = { type: 'model_selected', modelId: 'openai/gpt-6-luna', label: 'GPT-6 Luna', reasoningLevel: 'medium', reason: 'initial', mode: 'balanced' };

describe('which model is working, and when it changed', () => {
  it('shows one quiet line with the mode, the model and the reasoning', () => {
    const markup = html(run([initial]));
    expect(markup).toContain('Auto · Équilibré · GPT-6 Luna · raisonnement moyen');
    expect(markup).not.toContain('<details');
  });

  it('opens to say what changed and why when the supervisor moved to another model', () => {
    const markup = html(run([
      initial,
      { type: 'model_selected', modelId: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', reasoningLevel: 'high', reason: 'supervision', from: 'openai/gpt-6-luna', fromLabel: 'GPT-6 Luna', detail: 'Le modèle bloque sur cette étape : je passe à un modèle plus puissant.' },
    ]));
    expect(markup).toContain('<details');
    expect(markup).toContain('Auto · Équilibré · Sonnet 5 · raisonnement élevé · a changé de modèle');
    expect(markup).toContain('Changement de modèle : GPT-6 Luna → Sonnet 5 · raison : Le modèle bloque sur cette étape : je passe à un modèle plus puissant.');
  });

  it('says when only the effort was raised, not the model', () => {
    const markup = html(run([
      initial,
      { type: 'model_selected', modelId: 'openai/gpt-6-luna', label: 'GPT-6 Luna', reasoningLevel: 'high', reason: 'supervision', from: 'openai/gpt-6-luna', fromLabel: 'GPT-6 Luna', detail: 'La correction n’aboutit pas : le modèle réfléchit davantage.' },
    ]));
    expect(markup).toContain('Raisonnement renforcé (élevé) · raison : La correction n’aboutit pas');
    expect(markup).not.toContain('Changement de modèle');
    expect(markup).toContain('renforcé');
  });

  it('lists each of several changes in order, and counts them', () => {
    const markup = html(run([
      initial,
      { type: 'model_selected', modelId: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', reasoningLevel: 'high', reason: 'fallback', from: 'openai/gpt-6-luna', fromLabel: 'GPT-6 Luna', detail: 'GPT-6 Luna n’a pas pu répondre (PROVIDER_TIMEOUT) : Sonnet 5 prend le relais.' },
      { type: 'model_selected', modelId: 'openai/gpt-6-sol', label: 'GPT-6 Sol', reasoningLevel: 'high', reason: 'supervision', from: 'anthropic/claude-sonnet-5', fromLabel: 'Sonnet 5', detail: 'Un modèle plus puissant n’est pas disponible : j’essaie un modèle d’une autre famille.' },
    ]));
    expect(markup).toContain('2 changements de modèle');
    expect(markup.indexOf('GPT-6 Luna → Sonnet 5')).toBeLessThan(markup.indexOf('Sonnet 5 → GPT-6 Sol'));
  });

  it('keeps the relay line and the previous escalation readable', () => {
    expect(html(run([initial, { type: 'model_selected', modelId: 'openai/gpt-6-sol', label: 'GPT-6 Sol', reasoningLevel: 'high', reason: 'substitution' }])))
      .toContain('Relais : GPT-6 Sol · le modèle choisi a refusé cette étape');
    expect(html(run([initial, { type: 'model_selected', modelId: 'openai/gpt-6-sol', label: 'GPT-6 Sol', reasoningLevel: 'high', reason: 'escalation' }])))
      .toContain('Renforcé : GPT-6 Sol · raisonnement élevé');
  });

  it('only suggests, when the person chose the model and it is stuck', () => {
    const markup = html(run([{ type: 'model_selected', modelId: 'openai/gpt-6-luna', label: 'GPT-6 Luna', reasoningLevel: 'medium', reason: 'suggestion', detail: 'Ce modèle bloque sur cette étape. Vous l’avez choisi, je le garde : passez en Auto pour laisser Coden en essayer un autre.' }]));
    expect(markup).toContain('passez en Auto');
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain('<details');
  });
});
