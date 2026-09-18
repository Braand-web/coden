import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentThinkingLine, THINKING_LABEL } from './agent-thinking-line';
import { AgentMessage } from './agent-message';
import { EMPTY_MESSAGE, type AgentMessageState } from './agent-parts';

/**
 * The seconds before the run says anything are still working seconds.
 *
 * Auth, the project lookup, the harness turn and the intent round all run
 * before the first `activity` event. That gap used to draw three static
 * bullets; it now shimmers the same sentence the server is about to send.
 */
const thinking = (activity: string | null): AgentMessageState => ({
  ...EMPTY_MESSAGE,
  status: 'streaming',
  thinking: true,
  activity,
});

describe('AgentThinkingLine', () => {
  it('shimmers a label when the run has not named its work yet', () => {
    const html = renderToStaticMarkup(React.createElement(AgentThinkingLine, {}));
    expect(html).toContain(THINKING_LABEL);
    expect(html).toContain('coden-shimmer-text');
    expect(html).not.toContain('•••');
  });

  it('shimmers the real label once one arrives', () => {
    const html = renderToStaticMarkup(React.createElement(AgentThinkingLine, { label: 'installe les dépendances' }));
    expect(html).toContain('installe les dépendances');
    expect(html).toContain('coden-shimmer-text');
    expect(html).not.toContain(THINKING_LABEL);
  });

  it('treats a blank label as no label rather than as an empty line', () => {
    expect(renderToStaticMarkup(React.createElement(AgentThinkingLine, { label: '   ' }))).toContain(THINKING_LABEL);
  });
});

describe('AgentMessage while thinking', () => {
  it('draws the placeholder before the first activity event', () => {
    const html = renderToStaticMarkup(React.createElement(AgentMessage, { state: thinking(null) }));
    expect(html).toContain(THINKING_LABEL);
    expect(html).not.toContain('•••');
  });

  /*
   * The server's own first label is this exact string. Keying on the raw
   * activity flipped the key from 'thinking' to that text and crossfaded the
   * line into an identical copy of itself; keying on the text shown means the
   * two renders are indistinguishable, which is what makes the handover
   * invisible.
   */
  it('renders identically either side of the first activity event', () => {
    const before = renderToStaticMarkup(React.createElement(AgentMessage, { state: thinking(null) }));
    const after = renderToStaticMarkup(React.createElement(AgentMessage, { state: thinking(THINKING_LABEL) }));
    expect(after).toBe(before);
  });
});
