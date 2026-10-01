import { describe, expect, it } from 'vitest';
import { abuseCheck, communityVisible, DEFAULT_LIMITS, isReportReason, nextSanction, readEnvSwitches, readLimits, remixAllowed, reportsAction, trendingScore } from './rules';
import { attributionNote, neutralizeConnections, reconnectList, selectRemixFiles } from './remix';

const NOW = new Date('2026-10-01T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe('switches and limits', () => {
  it('is off unless the environment turns it on, and hidden by either kill switch', () => {
    expect(readEnvSwitches({}).enabled).toBe(false);
    expect(readEnvSwitches({ CODEN_COMMUNITY: '1' }).enabled).toBe(true);
    expect(readEnvSwitches({ CODEN_COMMUNITY: '0' }).enabled).toBe(false);
    expect(communityVisible({ enabled: true, hidden: false, frozen: false, bonusCredits: false })).toBe(true);
    expect(communityVisible({ enabled: true, hidden: true, frozen: false, bonusCredits: false })).toBe(false);
    expect(communityVisible({ enabled: false, hidden: false, frozen: false, bonusCredits: false })).toBe(false);
  });
  it('reads limits from the environment and ignores nonsense', () => {
    expect(readLimits({ CODEN_COMMUNITY_MAX_PER_ACCOUNT: '5' }).maxOnlinePerAccount).toBe(5);
    expect(readLimits({ CODEN_COMMUNITY_MAX_PER_ACCOUNT: 'abc' }).maxOnlinePerAccount).toBe(DEFAULT_LIMITS.maxOnlinePerAccount);
    expect(readLimits({ CODEN_COMMUNITY_MAX_PER_ACCOUNT: '-3' }).maxOnlinePerAccount).toBe(DEFAULT_LIMITS.maxOnlinePerAccount);
  });
});

describe('trending', () => {
  const base = { views7d: 40, likes7d: 6, remixes7d: 2, quality: 80, listedAt: hoursAgo(10), now: NOW };
  it('ranks a remix above a like above a view', () => {
    const views = trendingScore({ ...base, likes7d: 0, remixes7d: 0 });
    const likes = trendingScore({ ...base, views7d: 0, remixes7d: 0 });
    const remixes = trendingScore({ ...base, views7d: 0, likes7d: 0 });
    expect(likes).toBeGreaterThan(views * 0.3);
    expect(remixes).toBeGreaterThan(likes * 0.6);
  });
  it('fades with age and rewards quality', () => {
    expect(trendingScore({ ...base, listedAt: hoursAgo(200) })).toBeLessThan(trendingScore(base));
    expect(trendingScore({ ...base, quality: 95 })).toBeGreaterThan(trendingScore({ ...base, quality: 20 }));
  });
  it('is not dominated by a flood of views', () => {
    const modest = trendingScore({ ...base, views7d: 50 });
    const flood = trendingScore({ ...base, views7d: 5000 });
    expect(flood / modest).toBeLessThan(2);
  });
  it('is finite for empty and odd inputs', () => {
    expect(trendingScore({ views7d: 0, likes7d: 0, remixes7d: 0, quality: null, listedAt: 'n/a' })).toBe(0);
    expect(Number.isFinite(trendingScore({ views7d: -5, likes7d: 0, remixes7d: 0, quality: 500, listedAt: NOW, now: NOW }))).toBe(true);
  });
});

describe('anti-abuse', () => {
  it('holds a brand-new account until its observation period ends', () => {
    const result = abuseCheck({ accountCreatedAt: hoursAgo(1), onlineCount: 0, now: NOW });
    expect(result).toMatchObject({ outcome: 'pass', code: 'probation' });
    expect(new Date(result.holdUntil!).getTime()).toBe(hoursAgo(1).getTime() + 6 * 3_600_000);
  });
  it('caps a new account, then an old one', () => {
    expect(abuseCheck({ accountCreatedAt: hoursAgo(1), onlineCount: 3, now: NOW })).toMatchObject({ outcome: 'fail', code: 'probation_cap' });
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 30, now: NOW })).toMatchObject({ outcome: 'fail', code: 'account_cap' });
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 5, now: NOW })).toMatchObject({ outcome: 'pass', code: 'abuse_ok' });
  });
  it('blocks a banned or suspended creator, and lets a lapsed suspension go', () => {
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 0, now: NOW, sanction: { level: 'ban' } }).outcome).toBe('block');
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 0, now: NOW, sanction: { level: 'suspension', until: new Date(NOW.getTime() + 86_400_000).toISOString() } }).outcome).toBe('block');
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 0, now: NOW, sanction: { level: 'suspension', until: hoursAgo(2).toISOString() } }).outcome).toBe('pass');
    expect(abuseCheck({ accountCreatedAt: hoursAgo(500), onlineCount: 0, now: NOW, sanction: { level: 'warning' } }).outcome).toBe('pass');
  });
});

describe('reports and sanctions', () => {
  it('hides on distinct reporters, not on one person reporting many times', () => {
    expect(reportsAction([{ reporter: 'a', reason: 'spam' }, { reporter: 'a', reason: 'spam' }, { reporter: 'a', reason: 'other' }]).hide).toBe(false);
    expect(reportsAction([{ reporter: 'a', reason: 'spam' }, { reporter: 'b', reason: 'spam' }, { reporter: 'c', reason: 'other' }]).hide).toBe(true);
  });
  it('hides sooner for the gravest reasons', () => {
    expect(reportsAction([{ reporter: 'a', reason: 'scam' }, { reporter: 'b', reason: 'impersonation' }]).hide).toBe(true);
    expect(reportsAction([{ reporter: 'a', reason: 'spam' }, { reporter: 'b', reason: 'spam' }]).hide).toBe(false);
  });
  it('escalates a repeated offence: warning, suspension, ban', () => {
    expect(nextSanction(0)).toEqual({ level: 'warning' });
    expect(nextSanction(1)).toEqual({ level: 'suspension', days: 7 });
    expect(nextSanction(2)).toEqual({ level: 'ban' });
  });
  it('knows its reasons', () => {
    expect(isReportReason('scam')).toBe(true);
    expect(isReportReason('toString')).toBe(false);
    expect(isReportReason(null)).toBe(false);
  });
});

describe('remix limits', () => {
  it('stops mass copy of one creator, then the hourly and daily rates', () => {
    expect(remixAllowed({ lastHour: 0, lastDay: 0, lastDaySameCreator: 0 })).toEqual({ ok: true });
    expect(remixAllowed({ lastHour: 0, lastDay: 9, lastDaySameCreator: 8 })).toMatchObject({ ok: false, code: 'mass_copy' });
    expect(remixAllowed({ lastHour: 10, lastDay: 10, lastDaySameCreator: 1 })).toMatchObject({ ok: false, code: 'rate_hour' });
    expect(remixAllowed({ lastHour: 1, lastDay: 40, lastDaySameCreator: 1 })).toMatchObject({ ok: false, code: 'rate_day' });
  });
});

describe('what a remix copies', () => {
  it('drops env files, keys, uploads and git, keeps code and examples', () => {
    const { files, dropped } = selectRemixFiles([
      { path: 'src/App.tsx', content: 'x' }, { path: 'src/index.css', content: 'y' }, { path: '.env', content: 'SECRET=1' }, { path: '.env.local', content: 'A=1' },
      { path: '.env.example', content: 'A=' }, { path: 'public/uploads/photo.png', content: 'bin' }, { path: 'cert.pem', content: 'k' },
      { path: 'node_modules/x/index.js', content: 'z' }, { path: 'supabase/seed.sql', content: 'insert into users' }, { path: '../escape.ts', content: 'e' },
      { path: 'big.js', content: 'a'.repeat(500_000) },
    ]);
    expect(files.map(file => file.path).sort()).toEqual(['.env.example', 'src/App.tsx', 'src/index.css']);
    expect(dropped.length).toBe(8);
  });

  it('replaces the creator’s database address and public keys with environment reads', () => {
    const anon = `eyJ${'a'.repeat(20)}.${'b'.repeat(40)}.${'c'.repeat(30)}`;
    const { file, changed } = neutralizeConnections({ path: 'src/lib/supabase.ts', content: `createClient('https://abcdefghijkl.supabase.co', '${anon}'); loadStripe('pk_live_${'x'.repeat(24)}')` });
    expect(changed).toBe(true);
    expect(file.content).not.toContain('abcdefghijkl');
    expect(file.content).not.toContain('pk_live_');
    expect(file.content).toContain('import.meta.env.VITE_SUPABASE_URL');
    expect(neutralizeConnections({ path: 'README.md', content: 'https://abcdefghijkl.supabase.co' }).changed).toBe(false);
  });

  it('lists what must be reconnected from what the code uses', () => {
    const list = reconnectList([{ path: 'src/a.ts', content: "import { createClient } from '@supabase/supabase-js'; supabase.auth.signUp(); loadStripe(x); fetch('/api/send'); import.meta.env.VITE_MAP_KEY" }]).map(item => item.key);
    expect(list).toEqual(expect.arrayContaining(['database', 'auth', 'payments', 'email', 'env', 'domain']));
    expect(reconnectList([{ path: 'src/a.ts', content: 'const a = 1' }]).map(item => item.key)).toEqual(['domain']);
  });

  it('writes the attribution line', () => {
    expect(attributionNote({ listingId: 'x', title: 'Atelier Lumière', creator: 'Lina' })).toBe('Remixé depuis « Atelier Lumière » — Lina');
  });
});
