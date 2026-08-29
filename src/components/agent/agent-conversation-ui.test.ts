import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Response } from '../ui/response';
import { AgentActivityShimmer } from './agent-activity-shimmer';
import { applyAgentStreamEvent, createAgentRunViewModel } from '../../services/agent-run-store';
import { CODEN_STREAM_PROTOCOL_VERSION, type CodenStreamEvent } from '../../lib/stream-protocol';
import { normalizeAgentMode } from '../../services/agent-run-contract';

function event<T extends CodenStreamEvent['type']>(
  value: Omit<Extract<CodenStreamEvent, { type: T }>, 'v' | 'id' | 'sequence' | 'ts'>,
  id = 1,
): Extract<CodenStreamEvent, { type: T }> {
  return { v: CODEN_STREAM_PROTOCOL_VERSION, id, sequence: id, ts: Date.now(), ...value } as Extract<CodenStreamEvent, { type: T }>;
}

describe('minimal real-time agent conversation UI', () => {
  it('shows the cursor only from the real streaming state', () => {
    expect(renderToStaticMarkup(React.createElement(Response, { isStreaming: false }, 'Réponse incomplète'))).not.toContain('coden-response-cursor');
    expect(renderToStaticMarkup(React.createElement(Response, { isStreaming: true }, 'Réponse terminée.'))).toContain('coden-response-cursor');
  });

  it('filters dangerous link protocols without rendering raw HTML', () => {
    const html = renderToStaticMarkup(React.createElement(Response, null, '[danger](javascript:alert(1)) <script>alert(2)</script>'));
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders shimmer only when a real activity is active', () => {
    const active = renderToStaticMarkup(React.createElement(AgentActivityShimmer, { runId: 'run_1', phase: 'testing', message: 'Coden lance les tests…', active: true }));
    const inactive = renderToStaticMarkup(React.createElement(AgentActivityShimmer, { runId: 'run_1', phase: 'testing', message: 'Coden lance les tests…', active: false }));
    expect(active).toContain('Coden lance les tests');
    expect(inactive).not.toContain('Coden lance les tests');
  });

  it('updates public activity only from stream events and supports all modes', () => {
    const initial = createAgentRunViewModel({ runId: 'run_1', prompt: 'Crée un CRM', requestedMode: 'build' });
    expect(initial.publicActivity).toBeUndefined();
    const next = applyAgentStreamEvent(initial, event<'activity_changed'>({ type: 'activity_changed', runId: 'run_1', phase: 'building', message: 'Coden construit le CRM…', active: true }));
    expect(next.publicActivity).toMatchObject({ phase: 'building', message: 'Coden construit le CRM…', active: true });
    expect(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research'].map(normalizeAgentMode)).toEqual(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research']);
  });
});
