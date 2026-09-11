import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Response } from '../ui/response';
import { AgentThinkingLine } from './agent-thinking-line';
import { COMPOSER_AGENT_MODES } from './agent-mode-composer';
import { normalizeAgentMode } from '../../services/agent-mode';
import { ConversationDecision, normalizeConversationBlock } from '../../builder-conversation-island';

/**
 * What survived the streaming removal: the markdown response renderer and the
 * composer's mode surface. The rest of this file tested the run view model,
 * the activity shimmer and the progress notes, all of which existed only to
 * draw a live stream and went with it.
 */

describe('agent conversation UI', () => {
  it('shows the cursor only when a response is still being written', () => {
    expect(renderToStaticMarkup(React.createElement(Response, { isStreaming: false }, 'Réponse incomplète'))).not.toContain('coden-response-cursor');
    expect(renderToStaticMarkup(React.createElement(Response, { isStreaming: true }, 'Réponse terminée.'))).toContain('coden-response-cursor');
  });

  it('filters dangerous link protocols without rendering raw HTML', () => {
    const html = renderToStaticMarkup(React.createElement(Response, null, '[danger](javascript:alert(1)) <script>alert(2)</script>'));
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps the composer minimal while Auto routes advanced intents internally', () => {
    expect(COMPOSER_AGENT_MODES).toEqual(['auto', 'plan']);
    expect(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research'].map(normalizeAgentMode)).toEqual(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research']);
    expect(normalizeAgentMode('fix')).toBe('fix');
    expect(normalizeAgentMode('research')).toBe('research');
  });

  /*
   * The thinking line changes phrase the way a phrase changes, not the way a
   * variable does.
   *
   * `AnimatePresence` only animates a mount or an unmount, and the thinking
   * line was keyed on the constant string 'activity'. So every step of a run —
   * "prépare le plan", "installe les dépendances", "construit l'application" —
   * reused the same element: no exit, no entrance, the text replaced in place
   * mid-shimmer. Keying on the label is what makes each one a real transition,
   * and `mode="wait"` is what keeps two of them off the same line at once.
   */
  it('gives each activity label its own mount, so the shimmer crossfades', () => {
    const source = readFileSync(new URL('./agent-message.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/<AnimatePresence mode="wait">/);
    expect(source).toMatch(/key=\{state\.activity \|\| 'thinking'\}/);
    expect(source).not.toMatch(/key="activity"/);
  });

  it('shows the real activity label rather than an invented one', () => {
    // The labels come from boundaries the run actually crossed, so there is
    // nothing to cycle on a timer: a rotating list of generic phrases would be
    // progress the run never made.
    const html = renderToStaticMarkup(React.createElement(AgentThinkingLine, { label: 'Coden installe les dépendances…' }));
    expect(html).toContain('Coden installe les dépendances…');
    expect(html).toContain('role="status"');
    expect(renderToStaticMarkup(React.createElement(AgentThinkingLine, { label: null }))).not.toContain('undefined');
  });

  it('keeps a structured decision interactive instead of flattening it into prose', () => {
    const block = normalizeConversationBlock({
      type: 'confirmation',
      title: 'Confirmation nécessaire',
      body: 'Vérifiez la publication avant de continuer.',
      state: 'approval-requested',
    });
    expect(block).toBeTruthy();
    const html = renderToStaticMarkup(React.createElement(ConversationDecision, {
      block: block!,
      actions: [{ id: 'continue', label: 'Continuer', onClick: () => undefined }],
    }));
    expect(html).toContain('coden-decision-card');
    expect(html).toContain('Décision requise');
    expect(html).toContain('<button');
    expect(html).toContain('Continuer');
  });

  it('renders a structured plan as a readable review card', () => {
    const block = normalizeConversationBlock({
      type: 'plan',
      title: 'Plan de conception',
      summary: 'Une application de tâches sera créée sans modifier le projet avant validation.',
      sections: [{
        id: 'features',
        label: 'Fonctionnalités prévues',
        items: ['Ajout rapide de tâches', 'Filtrage par statut'],
      }],
    });
    const html = renderToStaticMarkup(React.createElement(ConversationDecision, {
      block: block!,
      actions: [{ id: 'build', label: 'Construire ce plan', onClick: () => undefined }],
    }));
    expect(html).toContain('coden-plan-card');
    expect(html).toContain('Fonctionnalités prévues');
    expect(html).toContain('Construire ce plan');
  });

  /*
   * The plan asks one question — build this or not — and the summary answers
   * it. The card used to lay everything flat: title, summary, then every
   * section expanded, so six features and three architecture lines stood
   * between the reader and the button that mattered.
   *
   * Title and summary stay visible; the detail folds behind a trigger.
   */
  it('keeps the plan decidable at a glance, with the detail one click away', () => {
    const block = normalizeConversationBlock({
      type: 'plan',
      title: 'Plan de conception',
      summary: 'Une application de tâches sera créée sans modifier le projet avant validation.',
      sections: [{ id: 'features', label: 'Fonctionnalités prévues', items: ['Ajout rapide de tâches'] }],
    });
    const html = renderToStaticMarkup(React.createElement(ConversationDecision, {
      block: block!,
      actions: [{ id: 'build', label: 'Construire ce plan', onClick: () => undefined }],
    }));

    // What decides is always on screen.
    expect(html).toContain('Plan de conception');
    expect(html).toContain('sans modifier le projet avant validation');

    // The detail is collapsed, and collapsed properly: `hidden` keeps it out
    // of the tab order and out of a screen reader's way, not merely unpainted.
    expect(html).toMatch(/class="coden-plan-content"[^>]*data-open="false"[^>]*hidden/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="coden-plan-[^"]+"/);

    /*
     * The shortcut hint is only honest if the key is bound. `⌘↩` next to a
     * button that answers to nothing but a click is the interface telling a
     * small lie, so the hint and the listener ship together.
     */
    expect(html).toMatch(/<kbd>(⌘|Ctrl)↩<\/kbd>/);
    const source = readFileSync(new URL('../../builder-conversation-island.tsx', import.meta.url), 'utf8');
    const card = source.slice(source.indexOf('function ConversationPlan('), source.indexOf('function MessageView('));
    expect(card).toMatch(/event\.key !== "Enter" \|\| !\(event\.metaKey \|\| event\.ctrlKey\)/);
    expect(card).toMatch(/primaryAction\.onClick\(\)/);
    // Only the last actionable plan answers, so an older one further up the
    // conversation cannot approve the one the user is looking at.
    expect(card).toMatch(/actionable\[actionable\.length - 1\] !== cardRef\.current/);
  });

  it('renders no shortcut hint when there is no action to trigger', () => {
    const block = normalizeConversationBlock({
      type: 'plan',
      title: 'Plan de conception',
      summary: 'Un résumé.',
      sections: [{ id: 'features', label: 'Fonctionnalités', items: ['Une chose'] }],
    });
    const html = renderToStaticMarkup(React.createElement(ConversationDecision, { block: block!, actions: [] }));
    expect(html).not.toContain('<kbd>');
    expect(html).toContain('data-actionable="false"');
  });
});
