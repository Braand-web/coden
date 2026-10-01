import { describe, expect, it } from 'vitest';
import { buildCommunityOverview } from './admin-metrics';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const at = (minutesAfter: number, base = '2026-10-09T10:00:00Z') => new Date(Date.parse(base) + minutesAfter * 60_000).toISOString();

describe('the admin overview', () => {
  const listings = [
    { id: '1', status: 'online', origin: 'free_auto', created_at: at(0), listed_at: at(4), quality_score: 80 },
    { id: '2', status: 'online', origin: 'free_auto', created_at: at(0), listed_at: at(10), quality_score: 60 },
    { id: '3', status: 'online', origin: 'paid_opt_in', created_at: at(0), listed_at: at(30), quality_score: 90 },
    { id: '4', status: 'refused', origin: 'free_auto', status_code: 'secret_in_browser_code', created_at: at(0) },
    { id: '5', status: 'needs_fix', origin: 'free_auto', status_code: 'empty_render', created_at: at(0) },
    { id: '6', status: 'needs_fix', origin: 'free_auto', status_code: 'empty_render', created_at: at(0) },
    { id: '7', status: 'removed_by_moderation', origin: 'free_auto', created_at: at(0) },
  ];
  const overview = buildCommunityOverview({
    listings, now: NOW, featured: 1, paidAccounts: 10, paidAccountsWithListing: 3,
    reports: [{ status: 'open', reason: 'spam', created_at: at(1) }, { status: 'upheld', reason: 'scam', created_at: at(2) }, { status: 'dismissed', reason: 'spam', created_at: at(3) }],
    remixes: [{ created_at: at(5) }, { created_at: '2026-01-01T00:00:00Z' }], appeals: [{ id: 'a' }],
    events: [{ id: 'e', actor_type: 'user', event: 'upgrade_click', created_at: at(1) }, { id: 'f', actor_type: 'system', event: 'listed', created_at: at(2) }],
  });

  it('counts apps by status and origin', () => {
    expect(overview.totals).toMatchObject({ listings: 7, online: 3, needsFix: 2, refused: 1, removedByModeration: 1 });
    expect(overview.origins).toEqual({ freeAuto: 2, paidOptIn: 1, paidShareAdded: 0.3 });
  });
  it('measures how long a listing takes to appear', () => {
    expect(overview.delay).toEqual({ medianMinutes: 10, p90Minutes: 30, sample: 3 });
  });
  it('says why apps are refused, most common first', () => {
    expect(overview.refusals[0]).toEqual({ code: 'empty_render', count: 2 });
    expect(overview.refusals).toHaveLength(2);
  });
  it('counts reports, recent remixes, quality, appeals and upgrade clicks', () => {
    expect(overview.reports).toMatchObject({ open: 1, upheld: 1, dismissed: 1 });
    expect(overview.reports.byReason[0]).toEqual({ reason: 'spam', count: 2 });
    expect(overview.remixes.last30Days).toBe(1);
    expect(overview.quality).toEqual({ average: 77, featured: 1 });
    expect(overview.openAppeals).toBe(1);
    expect(overview.upgradeClicks).toBe(1);
  });
  it('has no rate without paid accounts and no delay without listings', () => {
    const empty = buildCommunityOverview({ listings: [], reports: [], remixes: [], appeals: [], events: [] });
    expect(empty.origins.paidShareAdded).toBeNull();
    expect(empty.delay).toEqual({ medianMinutes: null, p90Minutes: null, sample: 0 });
    expect(empty.quality.average).toBeNull();
  });
});
