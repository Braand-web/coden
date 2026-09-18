import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentMessage } from './agent-message';
import { EMPTY_MESSAGE, reduceAgentMessage, type AgentMessageState } from './agent-parts';

/**
 * What a person is told when a run dies, and whether they are given a way out.
 *
 * The failure seen in production said, in English, under a French heading,
 * that the work was kept and could be retried — and offered no way to retry
 * it. Three separate faults, one panel.
 */
const failed = (message: string, diagnosticCode?: string): AgentMessageState =>
  reduceAgentMessage({ ...EMPTY_MESSAGE, status: 'streaming' }, { type: 'run_failed', message, diagnosticCode });

const panel = (state: AgentMessageState) => renderToStaticMarkup(React.createElement(AgentMessage, { state }));

describe('a run that failed', () => {
  it('keeps the diagnostic, so the client can phrase the failure itself', () => {
    expect(failed('boom', 'PROVIDER_TIMEOUT').diagnosticCode).toBe('PROVIDER_TIMEOUT');
  });

  it('speaks the language of the interface, not of the prompt', () => {
    // The server picks its language from the prompt text, so a short or
    // English-looking request produced English copy under a French heading.
    const html = panel(failed('The model is taking longer than expected. Your request is kept.', 'PROVIDER_TIMEOUT'));
    expect(html).toContain('Le modèle prend plus de temps que prévu');
    expect(html).not.toContain('taking longer than expected');
  });

  it('does not repeat an English fallback it was handed without a code', () => {
    const html = panel(failed('The request cannot be completed right now. Your work is kept and you can retry it.'));
    expect(html).not.toContain('Your work is kept');
    expect(html).toContain('Votre travail est conservé');
  });

  it('still says something useful for a failure that carries no code at all', () => {
    // A container replaced mid-stream produces exactly this: a dead run and
    // nothing to classify it by.
    const html = panel(failed(''));
    expect(html).toContain('La génération');
    expect(html).not.toContain('undefined');
  });

  it('keeps a message the server wrote in French', () => {
    expect(panel(failed('Le sandbox n’a pas démarré.'))).toContain('Le sandbox n’a pas démarré.');
  });
});

describe('the recovery card', () => {
  const source = readFileSync(new URL('../../builder-live.ts', import.meta.url), 'utf8');

  /*
   * `getRuntimeRecoveryPresentation` only answers for diagnostics it knows.
   * Returning early on the others drew the panel with no actions at all — it
   * promised a retry and gave nothing to retry with, on exactly the failures
   * nobody foresaw.
   */
  it('offers a way out of a failure nobody foresaw, not only of the known ones', () => {
    expect(source).not.toMatch(/const recovery = getRuntimeRecoveryPresentation\([^)]*\);\s*\n\s*if \(!recovery\) return false;/);
    expect(source).toMatch(/getRuntimeRecoveryPresentation\(diagnostic, UI_LOCALE\) \?\?/);
    expect(source).toMatch(/canRetry: true/);
  });

  it('labels its buttons in the language of the interface', () => {
    expect(source).toContain("addInlineAction(card, 'Réessayer', actions.retry)");
    expect(source).not.toMatch(/speaksFrench \? 'Réessayer' : 'Retry'/);
  });
});
