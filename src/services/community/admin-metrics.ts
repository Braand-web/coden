/**
 * What the admin sees of the Community: how many apps are in each state, how long a listing takes to appear, why apps are
 * refused, what is reported and removed, how many remixes, and how many paid accounts chose to add their apps.
 * Pure: fed with rows, returns numbers.
 */
type ListingRow = { id: string; status: string; origin: string; status_code?: string | null; created_at: string; listed_at?: string | null; quality_score?: number | null };
type ReportRow = { status: string; reason: string; created_at: string };
type EventRow = { id: string; listing_id?: string | null; actor_type: string; event: string; to_status?: string | null; code?: string | null; reason?: string | null; created_at: string };

export type CommunityOverview = {
  totals: { listings: number; online: number; pending: number; needsFix: number; refused: number; hidden: number; removedByUser: number; removedByModeration: number };
  delay: { medianMinutes: number | null; p90Minutes: number | null; sample: number };
  refusals: Array<{ code: string; count: number }>;
  reports: { open: number; upheld: number; dismissed: number; byReason: Array<{ reason: string; count: number }> };
  remixes: { last30Days: number };
  origins: { freeAuto: number; paidOptIn: number; paidShareAdded: number | null };
  quality: { average: number | null; featured: number };
  openAppeals: number;
  upgradeClicks: number;
};

const median = (values: number[], p = 50): number | null => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};
const tally = (items: string[]) => Object.entries(items.reduce<Record<string, number>>((acc, key) => { acc[key] = (acc[key] || 0) + 1; return acc; }, {})).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);

export function buildCommunityOverview(input: { listings: ListingRow[]; reports: ReportRow[]; remixes: Array<{ created_at: string }>; appeals: Array<{ id: string }>; events: EventRow[]; featured?: number; paidAccounts?: number; paidAccountsWithListing?: number; now?: number }): CommunityOverview {
  const count = (status: string) => input.listings.filter(row => row.status === status).length;
  const delays = input.listings.filter(row => row.listed_at && row.status === 'online').map(row => (Date.parse(row.listed_at as string) - Date.parse(row.created_at)) / 60_000).filter(minutes => minutes >= 0);
  const scores = input.listings.filter(row => row.status === 'online' && typeof row.quality_score === 'number').map(row => row.quality_score as number);
  const now = input.now ?? Date.now();
  return {
    totals: { listings: input.listings.length, online: count('online'), pending: count('pending'), needsFix: count('needs_fix'), refused: count('refused'), hidden: count('hidden'), removedByUser: count('removed_by_user'), removedByModeration: count('removed_by_moderation') },
    delay: { medianMinutes: median(delays, 50) === null ? null : Math.round((median(delays, 50) as number) * 10) / 10, p90Minutes: median(delays, 90) === null ? null : Math.round((median(delays, 90) as number) * 10) / 10, sample: delays.length },
    refusals: tally(input.listings.filter(row => (row.status === 'refused' || row.status === 'needs_fix') && row.status_code).map(row => row.status_code as string)).map(item => ({ code: item.key, count: item.count })),
    reports: {
      open: input.reports.filter(report => report.status === 'open').length, upheld: input.reports.filter(report => report.status === 'upheld').length, dismissed: input.reports.filter(report => report.status === 'dismissed').length,
      byReason: tally(input.reports.map(report => report.reason)).map(item => ({ reason: item.key, count: item.count })),
    },
    remixes: { last30Days: input.remixes.filter(remix => now - Date.parse(remix.created_at) <= 30 * 86_400_000).length },
    origins: {
      freeAuto: input.listings.filter(row => row.origin === 'free_auto' && row.status === 'online').length,
      paidOptIn: input.listings.filter(row => row.origin === 'paid_opt_in' && row.status === 'online').length,
      paidShareAdded: input.paidAccounts ? Math.round(((input.paidAccountsWithListing || 0) / input.paidAccounts) * 1000) / 1000 : null,
    },
    quality: { average: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null, featured: input.featured ?? 0 },
    openAppeals: input.appeals.length,
    upgradeClicks: input.events.filter(event => event.event === 'upgrade_click').length,
  };
}
