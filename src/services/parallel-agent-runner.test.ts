import { describe, expect, it } from 'vitest';
import { selectAgentsForContext, type ParallelAgentContext } from './parallel-agent-runner';

const context = (overrides: Partial<ParallelAgentContext>): ParallelAgentContext => ({
  projectName: 'Test', userPrompt: '', appType: 'web_app', fileCount: 0,
  files: [], hasAuth: false, hasDatabase: false, hasPayments: false, language: 'fr',
  ...overrides,
});

describe('parallel agent selection', () => {
  it('keeps a local visual edit minimal', () => {
    expect(selectAgentsForContext(context({ userPrompt: 'change le bleu en vert', fileCount: 8, files: [{ path: 'src/App.tsx', content: '' }] })))
      .toEqual(['dependency_analyst']);
  });

  it('parallelizes product and UI analysis for a new application', () => {
    expect(selectAgentsForContext(context({ userPrompt: 'crée une application responsive' })))
      .toEqual(['ui_designer', 'ux_validator']);
  });

  it('adds backend and security specialists only for a risky full-stack request', () => {
    expect(selectAgentsForContext(context({ userPrompt: 'build a Supabase app with auth and RLS', hasAuth: true, hasDatabase: true })))
      .toEqual(expect.arrayContaining(['ui_designer', 'backend_engineer', 'security_auditor', 'ux_validator']));
  });
});
