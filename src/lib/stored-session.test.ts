import { describe, expect, it } from 'vitest';
import { hasStoredSession, signedInDestination } from './stored-session';

function storage(entries: Record<string, string>) {
  const keys = Object.keys(entries);
  return { getItem: (key: string) => entries[key] ?? null, key: (index: number) => keys[index] ?? null, length: keys.length };
}

describe('stored session', () => {
  it('sees the session Supabase persisted, under Coden\'s key or a legacy one', () => {
    const session = JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: 'u1' } });
    expect(hasStoredSession(storage({ 'coden.auth.session.v2': session }))).toBe(true);
    expect(hasStoredSession(storage({ 'sb-ftmbiocvslxctldfihcp-auth-token': session }))).toBe(true);
  });

  it('is signed out with nothing stored, a signed-out marker or garbage', () => {
    expect(hasStoredSession(storage({}))).toBe(false);
    expect(hasStoredSession(storage({ 'coden.auth.session.v2': 'null' }))).toBe(false);
    expect(hasStoredSession(storage({ 'coden.auth.session.v2': '{not json' }))).toBe(false);
    expect(hasStoredSession(storage({ 'coden.auth.session.v2': JSON.stringify({ access_token: 'a' }) }))).toBe(false);
    expect(hasStoredSession(null)).toBe(false);
  });

  it('sends account links to where sign-up would have led, never off-site', () => {
    expect(signedInDestination('/auth.html?mode=signup&redirect=%2Fdashboard.html')).toBe('/dashboard.html');
    expect(signedInDestination('/auth.html')).toBe('/dashboard.html');
    expect(signedInDestination('/auth.html?redirect=%2F%2Fevil.example')).toBe('/dashboard.html');
    expect(signedInDestination('/auth.html?redirect=https%3A%2F%2Fevil.example')).toBe('/dashboard.html');
    expect(signedInDestination('/pricing.html')).toBe('/pricing.html');
  });
});
