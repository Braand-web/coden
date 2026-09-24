import { describe, expect, it } from 'vitest';
import { createAgentWebProvider, fetchPublicPage, htmlToText, isPrivateAddress } from './agent-web.ts';

const publicLookup = async () => [{ address: '93.184.216.34' }];

describe('agent web access', () => {
  it('refuses every address that is not on the public internet', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    expect(isPrivateAddress('93.184.216.34')).toBe(false);
    expect(isPrivateAddress('2606:4700::6810:84e5')).toBe(false);
  });

  it('never fetches a private target, directly or through a redirect', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } });
    }) as unknown as typeof fetch;
    expect((await fetchPublicPage('http://localhost:3000/', { fetchImpl, lookup: publicLookup })).ok).toBe(false);
    expect((await fetchPublicPage('http://10.0.0.5/', { fetchImpl, lookup: publicLookup })).ok).toBe(false);
    expect((await fetchPublicPage('https://internal.example/', { fetchImpl, lookup: async () => [{ address: '10.0.0.9' }] })).ok).toBe(false);
    expect((await fetchPublicPage('file:///etc/passwd', { fetchImpl, lookup: publicLookup })).ok).toBe(false);
    const redirected = await fetchPublicPage('https://docs.example/', { fetchImpl, lookup: publicLookup });
    expect(redirected.ok).toBe(false);
    expect(calls).toEqual(['https://docs.example/']);
  });

  it('reads a public page as text, without scripts or styles', async () => {
    const html = '<html><head><title>Router docs</title><style>.x{}</style></head><body><h1>Loaders</h1><script>alert(1)</script><p>Use &lt;RouterProvider&gt; &amp; loaders.</p><ul><li>one</li></ul></body></html>';
    const fetchImpl = (async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as unknown as typeof fetch;
    const page = await fetchPublicPage('https://docs.example/router', { fetchImpl, lookup: publicLookup });
    expect(page).toMatchObject({ ok: true, title: 'Router docs' });
    expect((page as any).text).toContain('Use <RouterProvider> & loaders.');
    expect((page as any).text).not.toContain('alert');
    expect(htmlToText('<p>a</p><p>b</p>').text).toBe('a\nb');
  });

  it('searches through a configured provider, and falls back to model web search', async () => {
    const research = {
      isConfigured: () => true,
      search: async (query: string) => ({ status: 'completed' as const, query, provider: 'tavily' as const, message: 'ok', results: [{ title: 'Doc', url: 'https://d.example', snippet: 'x' }] }),
    };
    const configured = await createAgentWebProvider({ research }).search('vite env variables');
    expect(configured).toMatchObject({ ok: true, provider: 'tavily' });

    const unconfigured = createAgentWebProvider({ research: { ...research, isConfigured: () => false }, modelSearch: async query => `Sources for ${query}` });
    expect(await unconfigured.search('vite env')).toMatchObject({ ok: true, provider: 'openrouter-web', summary: 'Sources for vite env' });
    expect(await createAgentWebProvider({}).search('x')).toMatchObject({ ok: false });
  });
});
