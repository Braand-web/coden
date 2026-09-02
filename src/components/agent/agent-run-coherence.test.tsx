import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentRunPanel } from './agent-run-panel';
import { applyAgentStreamEvent, createAgentRunViewModel, type AgentRunViewModel } from '../../services/agent-run-store';
import { CODEN_STREAM_PROTOCOL_VERSION, type CodenStreamEvent } from '../../lib/stream-protocol';

/**
 * The whole chain, replayed: the events the server emits, through the run
 * store, into the rendered panel.
 *
 * Each half of this worked in isolation and disagreed in production. The server
 * declared eight phases and emitted none. The store reduced them into a step
 * list nothing rendered. The repair step and the shimmer carried the same
 * sentence. These assertions are about the seams, not the pieces.
 */

let sequence = 0;
/** One envelope builder for every event kind, so the replay reads as a script. */
function event(value: Record<string, unknown> & { type: CodenStreamEvent['type'] }): CodenStreamEvent {
  sequence += 1;
  return { v: CODEN_STREAM_PROTOCOL_VERSION, id: sequence, sequence, ts: Date.now(), ...value } as CodenStreamEvent;
}

/** A run that finds a blocker, repairs it, and finishes — the interesting shape. */
function replayRepairRun(): AgentRunViewModel {
  let view = createAgentRunViewModel({ runId: 'run_1', prompt: 'Crée une calculatrice', requestedMode: 'build' });
  const steps: CodenStreamEvent[] = [
    event({ type: 'phase', phase: 'understand', state: 'active', label: 'Analyse de votre demande' }),
    event({ type: 'phase', phase: 'understand', state: 'done', label: 'Analyse de votre demande' }),
    event({ type: 'phase', phase: 'build', state: 'active', label: 'Création de l’application' }),
    event({ type: 'file_start', path: 'src/App.tsx' }),
    event({ type: 'file_done', path: 'src/App.tsx' }),
    event({ type: 'phase', phase: 'build', state: 'done', label: 'Création de l’application' }),
    event({ type: 'phase', phase: 'verify', state: 'active', label: 'Vérification de l’application' }),
    event({ type: 'phase', phase: 'verify', state: 'failed', label: 'Vérification de l’application' }),
    event({ type: 'phase', phase: 'fix', state: 'active', label: 'Correction des problèmes détectés' }),
    event({ type: 'activity_changed', phase: 'fixing', message: 'Coden corrige src/App.tsx…', active: true }),
  ];
  for (const streamed of steps) view = applyAgentStreamEvent(view, streamed);
  return view;
}

describe('run panel coherence', () => {
  const view = replayRepairRun();
  const html = renderToStaticMarkup(React.createElement(AgentRunPanel, { view, streamText: 'Je corrige la calculatrice.' }));

  it('turns the phases the server emits into visible steps', () => {
    // The failure this exists for: the events arrived, the store reduced them,
    // and nothing drew them.
    expect(html).toContain('coden-agent-steps');
    expect(html).toContain('Analyse de votre demande');
    expect(html).toContain('Création de l’application');
    expect(html).toContain('Vérification de l’application');
  });

  it('keeps a failed step visible instead of losing it', () => {
    // A failed step ending the run silently is the difference between "the
    // verification failed" and the product going quiet.
    expect(html).toContain('data-status="failed"');
    expect(html).toContain('data-status="active"');
    expect(html).toContain('data-status="done"');
  });

  it('does not put a generated file in the step spine', () => {
    const spine = html.slice(html.indexOf('coden-agent-steps'), html.indexOf('</ol>'));
    expect(spine).not.toContain('src/App.tsx');
  });

  it('says the live detail once, not twice', () => {
    // The shimmer carries "Coden corrige src/App.tsx…"; the step carries the
    // stage. Both carrying the sentence showed the user the same line twice.
    expect((html.match(/Coden corrige src\/App\.tsx/g) || []).length).toBeLessThanOrEqual(1);
  });

  it('reflects the run’s real state in the panel', () => {
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain(`data-run-status="${view.status}"`);
  });

  it('shows the streaming caret while text is still arriving, and not after', () => {
    expect(html).toContain('coden-response-cursor');
    const finished = applyAgentStreamEvent(view, event({ type: 'assistant_message_completed' }));
    const finishedHtml = renderToStaticMarkup(React.createElement(AgentRunPanel, { view: finished }));
    expect(finishedHtml).not.toContain('coden-response-cursor');
  });

  it('shows no spine before the first phase arrives', () => {
    const fresh = createAgentRunViewModel({ runId: 'run_2', prompt: 'Bonjour', requestedMode: 'auto' });
    expect(renderToStaticMarkup(React.createElement(AgentRunPanel, { view: fresh }))).not.toContain('coden-agent-steps');
  });
});
