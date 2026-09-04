import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Response } from '../ui/response';
import { COMPOSER_AGENT_MODES } from './agent-mode-composer';
import { normalizeAgentMode } from '../../services/agent-mode';

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
    expect(COMPOSER_AGENT_MODES).toEqual(['auto', 'build', 'plan']);
    expect(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research'].map(normalizeAgentMode)).toEqual(['auto', 'build', 'plan', 'ask', 'fix', 'review', 'research']);
    expect(normalizeAgentMode('fix')).toBe('fix');
    expect(normalizeAgentMode('research')).toBe('research');
  });
});
