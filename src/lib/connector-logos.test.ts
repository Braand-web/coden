import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { connectorLogoCandidates, localConnectorLogo } from './connector-logos';

describe('connector logos', () => {
  it('resolves Composio slugs and Coden aliases to a shipped file', () => {
    for (const slug of ['supabase', 'github', 'stripe', 'notion', 'gmail', 'googlesheets', 'google-sheets', 'google_calendar', 'twitter', 'perplexityai']) {
      const logo = localConnectorLogo(slug);
      expect(logo, slug).toMatch(/^\/connector-logos\/[a-z0-9]+\.svg$/);
      expect(existsSync(`public${logo}`), logo).toBe(true);
    }
    expect(localConnectorLogo('unknown-service')).toBe('');
  });

  it('prefers the logo Composio sends, and falls back to Coden\'s copy', () => {
    expect(connectorLogoCandidates('supabase', 'https://logos.composio.dev/api/supabase')).toEqual(['https://logos.composio.dev/api/supabase', '/connector-logos/supabase.svg']);
    expect(connectorLogoCandidates('supabase', 'javascript:alert(1)')).toEqual(['/connector-logos/supabase.svg']);
    expect(connectorLogoCandidates('unknown')).toEqual([]);
  });
});
