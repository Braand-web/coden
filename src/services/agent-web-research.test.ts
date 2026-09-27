import { describe, expect, it, vi } from 'vitest';
import { collectAgentWebResearch, publicResearchUrl } from './agent-web-research.ts';

const found = (query: string) => ({
  status: 'completed' as const,
  query,
  provider: 'firecrawl' as const,
  message: 'ok',
  results: [{ title: 'Documentation officielle', url: 'https://docs.example.test/guide?token=private#part', snippet: 'Version 2 disponible.' }],
});

describe('agent web research', () => {
  it('skips greetings without calling an external service', async () => {
    const search = vi.fn(async (query: string) => found(query));
    const answer = await collectAgentWebResearch({ prompt: 'bonjour' }, { gateway: { isConfigured: () => true, search } });
    expect(answer).toEqual({ attempted: false, context: '', sources: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it('searches and reads one source, preserving citations but not internal provider labels or URL secrets', async () => {
    const search = vi.fn(async (query: string) => found(query));
    const readPage = vi.fn(async (url: string) => ({ ...found(url), results: [{ title: 'Documentation officielle', url, snippet: 'Exemple complet de la version 2.' }] }));
    const stages: string[] = [];
    const answer = await collectAgentWebResearch({ prompt: 'Quelle est la dernière version de cette API ?', onStage: stage => stages.push(stage) }, { gateway: { isConfigured: () => true, search }, readPage });
    expect(search).toHaveBeenCalledOnce();
    expect(readPage).toHaveBeenCalledWith('https://docs.example.test/guide');
    expect(stages).toEqual(['searching', 'reading']);
    expect(answer.sources).toEqual([{ title: 'Documentation officielle', url: 'https://docs.example.test/guide' }]);
    expect(answer.context).toContain('Exemple complet de la version 2.');
    expect(answer.context).not.toContain('firecrawl');
    expect(answer.context).not.toContain('token=private');
  });

  it('marks failed research as unverified and filters private sources', async () => {
    const failure = await collectAgentWebResearch({ prompt: 'Recherche web sur la dernière API' }, { gateway: { isConfigured: () => true, search: async () => { throw new Error('failure'); } } });
    expect(failure).toMatchObject({ attempted: true, sources: [] });
    expect(failure.context).toContain('could not be verified');
    const readPage = vi.fn();
    const privateResult = await collectAgentWebResearch({ prompt: 'Recherche web sur la dernière API' }, { gateway: { isConfigured: () => true, search: async query => ({ ...found(query), results: [{ title: 'Private', url: 'http://127.0.0.1/admin', snippet: 'No' }] }) }, readPage });
    expect(privateResult.sources).toEqual([]);
    expect(readPage).not.toHaveBeenCalled();
    expect(publicResearchUrl('https://docs.example.test/page?key=secret#fragment')).toBe('https://docs.example.test/page');
    expect(publicResearchUrl('file:///etc/passwd')).toBe('');
  });

  it('opens an explicitly supplied URL through the guarded reader, without searching it first', async () => {
    const search = vi.fn(async (query: string) => found(query));
    const readPage = vi.fn(async (url: string) => found(url));
    const outcome = await collectAgentWebResearch({ prompt: 'Analyse ce site https://docs.example.test/guide?token=private' }, { gateway: { isConfigured: () => true, search }, readPage });
    expect(search).not.toHaveBeenCalled();
    expect(readPage).toHaveBeenCalledWith('https://docs.example.test/guide');
    expect(outcome.sources).toHaveLength(1);
  });
});
