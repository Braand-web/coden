import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentStream } from './agent-stream';

/**
 * `AgentStream` is the one slot `AgentActivityShimmer` and `AgentResponse`
 * used to occupy as two separate, sequential blocks. Real content must
 * always win the slot — a shimmer masking text that has already arrived
 * would be exactly the fake-progress feel this rebuild exists to remove.
 */

describe('agent stream', () => {
  it('renders the shimmer while there is nothing to show yet', () => {
    const html = renderToStaticMarkup(React.createElement(AgentStream, {
      runId: 'run_1',
      activity: { phase: 'building', message: 'Coden construit l’application…', active: true, sequence: 1 },
      showActivity: true,
      content: '',
      streaming: false,
    }));
    expect(html).toContain('Coden construit l’application…');
    expect(html).not.toContain('coden-response');
  });

  it('lets real content win the slot even while an activity would otherwise show', () => {
    const html = renderToStaticMarkup(React.createElement(AgentStream, {
      runId: 'run_1',
      activity: { phase: 'building', message: 'Coden construit l’application…', active: true, sequence: 1 },
      showActivity: true,
      content: 'Voici le début de la réponse',
      streaming: true,
    }));
    expect(html).toContain('Voici le début de la réponse');
    expect(html).not.toContain('Coden construit l’application…');
    expect(html).toContain('coden-response-cursor');
  });

  it('renders nothing when there is neither an activity nor content', () => {
    const html = renderToStaticMarkup(React.createElement(AgentStream, {
      runId: 'run_1',
      activity: null,
      showActivity: false,
      content: '',
      streaming: false,
    }));
    expect(html).toBe('');
  });
});
