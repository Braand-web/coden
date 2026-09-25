import { afterEach, describe, expect, it, vi } from 'vitest';
import { composioConfigured, composioUserId, createConnectLink, disconnect, isOutwardTool, listConnections, normalizeToolkitSlug, SERVICE_CHOICES } from './composio';

const USER = '5e06550b-bc24-4a36-93f3-1b91fae68f1f';

describe('composio', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPOSIO_API_KEY;
  });

  it('maps each Coden account to its own Composio user and refuses anything else', () => {
    expect(composioUserId(USER)).toBe(`coden_${USER}`);
    expect(() => composioUserId('')).toThrow();
    expect(() => composioUserId('../other')).toThrow();
  });

  it('only lets clean toolkit slugs reach the API', () => {
    expect(normalizeToolkitSlug('Supabase')).toBe('supabase');
    expect(normalizeToolkitSlug('google-sheets')).toBe('google-sheets');
    expect(normalizeToolkitSlug('../auth_configs')).toBe('');
  });

  it('marks tools that act on the outside world', () => {
    expect(isOutwardTool('GMAIL_SEND_EMAIL')).toBe(true);
    expect(isOutwardTool('STRIPE_CREATE_PAYMENT_INTENT')).toBe(true);
    expect(isOutwardTool('STRIPE_LIST_CUSTOMERS')).toBe(false);
    expect(isOutwardTool('STRIPE_CREATE_CHARGE')).toBe(true);
    expect(isOutwardTool('GITHUB_LIST_REPOSITORIES')).toBe(false);
    expect(isOutwardTool('SUPABASE_DELETE_A_BRANCH')).toBe(true);
  });

  it('offers Coden Cloud first for a database and a toolkit per external option', () => {
    const database = SERVICE_CHOICES.database.options;
    expect(database[0]).toEqual({ label: 'Coden Cloud', kind: 'coden_cloud' });
    expect(database.some(option => option.toolkit === 'supabase')).toBe(true);
  });

  it('keeps the API key on the server and scopes calls to the account', async () => {
    expect(composioConfigured()).toBe(false);
    await expect(listConnections(USER)).rejects.toThrow(/not configured/);
    process.env.COMPOSIO_API_KEY = 'ak_test_key';
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      const path = new URL(String(url)).pathname;
      if (path === '/api/v3.1/auth_configs' && init.method === 'GET') return new Response(JSON.stringify({ items: [] }));
      if (path === '/api/v3.1/auth_configs') return new Response(JSON.stringify({ auth_config: { id: 'ac_1' } }));
      if (path === '/api/v3.1/connected_accounts/link') return new Response(JSON.stringify({ redirect_url: 'https://connect.composio.dev/x', connected_account_id: 'ca_1' }));
      if (path === '/api/v3.1/connected_accounts/ca_other') return new Response(JSON.stringify({ id: 'ca_other', user_id: 'coden_someone-else-0000' }));
      return new Response(JSON.stringify({ items: [{ id: 'ca_1', status: 'ACTIVE', toolkit: { slug: 'supabase' } }] }));
    });
    const link = await createConnectLink({ codenUserId: USER, toolkit: 'supabase', callbackUrl: 'https://www.coden.fun/integrations/callback?toolkit=supabase' });
    expect(link.redirectUrl).toBe('https://connect.composio.dev/x');
    const linkCall = calls.find(call => call.url.endsWith('/connected_accounts/link'))!;
    expect(JSON.parse(String(linkCall.init.body))).toMatchObject({ auth_config_id: 'ac_1', user_id: `coden_${USER}` });
    expect((linkCall.init.headers as Record<string, string>)['x-api-key']).toBe('ak_test_key');

    const connections = await listConnections(USER);
    expect(connections).toEqual([{ id: 'ca_1', toolkit: 'supabase', status: 'ACTIVE', createdAt: null, updatedAt: null }]);
    expect(calls.at(-1)!.url).toContain(`user_ids=coden_${USER}`);

    await expect(disconnect(USER, 'ca_other')).rejects.toThrow(/Unknown connection/);
    expect(calls.some(call => call.init.method === 'DELETE')).toBe(false);
  });
});
