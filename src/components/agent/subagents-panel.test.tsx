import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EMPTY_MESSAGE, reduceAgentMessage } from './agent-parts';
import { SubagentsPanel } from './agent-message';

describe('sub-agents in the conversation', () => {
  const agents = [
    { id: 'sub-1', role: 'Expert UI', status: 'running' as const, progress: 0.4, model: 'Luna', scope: ['src/ui/'] },
    { id: 'sub-2', role: 'Testeur', status: 'failed' as const, progress: 1, model: 'Opus', scope: ['tests/'], error: 'délai dépassé' },
    { id: 'sub-3', role: 'Expert données', status: 'done' as const, progress: 1, scope: ['src/lib/'] },
  ];

  it('keeps the latest snapshot of the master’s sub-agents', () => {
    const first = reduceAgentMessage(EMPTY_MESSAGE, { type: 'subagents', agents: agents.map(agent => ({ ...agent, status: 'queued' as const, progress: 0 })) });
    const next = reduceAgentMessage(first, { type: 'subagents', agents });
    expect(next.subagents).toEqual(agents);
    expect(next.thinking).toBe(true);
  });

  it('shows each role, status, model and progress', () => {
    const html = renderToStaticMarkup(<SubagentsPanel agents={agents} />);
    expect(html).toContain('Sous-agents');
    expect(html).toContain('1 actif sur 3');
    expect(html).toContain('Expert UI');
    expect(html).toContain('En cours · Luna');
    expect(html).toContain('Échec · Opus · délai dépassé');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('data-status="done"');
  });
});
