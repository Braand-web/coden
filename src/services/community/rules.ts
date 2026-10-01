/**
 * The Community's other rules, all pure: how ranking is scored, when an account is too new or too busy to list more,
 * when reports hide an app, and which sanction follows a repeated offence.
 */
import type { CheckResult } from './checks.ts';

// ── Configuration: limits live here, overridable by environment, never scattered through the code ────────────────

export type CommunityLimits = {
  /** Listings a single account may have online at once. */
  maxOnlinePerAccount: number;
  /** A brand-new account's listing waits this long (hours) before it appears. */
  probationHours: number;
  /** Listings a brand-new account may have online while it is on probation. */
  maxOnlineDuringProbation: number;
  /** Distinct people who must report an app before it is hidden pending a re-analysis. */
  reportHideThreshold: number;
  /** Same, for the gravest reasons (illegal, adult, scam, impersonation). */
  reportHideThresholdGrave: number;
  /** Remixes one account may make per hour; per day. */
  remixesPerHour: number;
  remixesPerDay: number;
  /** The most remixes one account may make from one creator's apps in a day (mass-copy detection). */
  remixesPerCreatorPerDay: number;
};

export const DEFAULT_LIMITS: CommunityLimits = Object.freeze({
  maxOnlinePerAccount: 30,
  probationHours: 6,
  maxOnlineDuringProbation: 3,
  reportHideThreshold: 3,
  reportHideThresholdGrave: 2,
  remixesPerHour: 10,
  remixesPerDay: 40,
  remixesPerCreatorPerDay: 8,
});

export function readLimits(env: Record<string, string | undefined> = process.env): CommunityLimits {
  const number = (key: string, fallback: number, min = 1, max = 10_000) => {
    const parsed = Number(env[key]);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
  };
  return {
    maxOnlinePerAccount: number('CODEN_COMMUNITY_MAX_PER_ACCOUNT', DEFAULT_LIMITS.maxOnlinePerAccount),
    probationHours: number('CODEN_COMMUNITY_PROBATION_HOURS', DEFAULT_LIMITS.probationHours, 0, 24 * 14),
    maxOnlineDuringProbation: number('CODEN_COMMUNITY_PROBATION_MAX', DEFAULT_LIMITS.maxOnlineDuringProbation),
    reportHideThreshold: number('CODEN_COMMUNITY_REPORT_THRESHOLD', DEFAULT_LIMITS.reportHideThreshold),
    reportHideThresholdGrave: number('CODEN_COMMUNITY_REPORT_THRESHOLD_GRAVE', DEFAULT_LIMITS.reportHideThresholdGrave),
    remixesPerHour: number('CODEN_COMMUNITY_REMIX_PER_HOUR', DEFAULT_LIMITS.remixesPerHour),
    remixesPerDay: number('CODEN_COMMUNITY_REMIX_PER_DAY', DEFAULT_LIMITS.remixesPerDay),
    remixesPerCreatorPerDay: number('CODEN_COMMUNITY_REMIX_PER_CREATOR_DAY', DEFAULT_LIMITS.remixesPerCreatorPerDay),
  };
}

// ── Master switches ─────────────────────────────────────────────────────────────────────────────────────────────

export type CommunitySwitches = {
  /** The whole feature: off by default, turned on in the environment (`CODEN_COMMUNITY=1`). */
  enabled: boolean;
  /** Admin kill switch: hide the whole Community (the sidebar entry, every list, every page). */
  hidden: boolean;
  /** Admin kill switch: freeze new listings (what is online stays online). */
  frozen: boolean;
  /** Bonus credits for remixed creators: off until its caps are agreed. */
  bonusCredits: boolean;
};

const truthy = (value: string | undefined) => ['1', 'true', 'on', 'yes', 'enabled'].includes(String(value || '').trim().toLowerCase());

export function readEnvSwitches(env: Record<string, string | undefined> = process.env): Pick<CommunitySwitches, 'enabled' | 'bonusCredits'> & { hiddenByEnv: boolean; frozenByEnv: boolean } {
  return { enabled: truthy(env.CODEN_COMMUNITY), bonusCredits: truthy(env.CODEN_COMMUNITY_BONUS), hiddenByEnv: truthy(env.CODEN_COMMUNITY_HIDE), frozenByEnv: truthy(env.CODEN_COMMUNITY_FREEZE) };
}

/** The feature is reachable only when it is on and not hidden by either kill switch. */
export function communityVisible(switches: CommunitySwitches): boolean {
  return switches.enabled && !switches.hidden;
}

// ── Trending ────────────────────────────────────────────────────────────────────────────────────────────────────

export type TrendingInput = {
  /** Unique viewers, likes and remixes in the last 7 days — never the owner's own. */
  views7d: number;
  likes7d: number;
  remixes7d: number;
  quality: number | null;
  listedAt: string | Date;
  now?: Date;
};

export const TRENDING_HALF_LIFE_HOURS = 72;

/**
 * Time-weighted engagement × quality. A remix says more than a like, a like more than a view; the whole score halves
 * every 72 hours so yesterday's hit does not squat the top. Sub-linear (log) so a single flood cannot dominate, and
 * multiplied by quality (0.4…1) so a polished app outranks a bare one with the same attention.
 */
export function trendingScore(input: TrendingInput): number {
  const now = (input.now || new Date()).getTime();
  const listed = new Date(input.listedAt).getTime();
  if (!Number.isFinite(listed)) return 0;
  const ageHours = Math.max(0, (now - listed) / 3_600_000);
  const engagement = Math.log1p(Math.max(0, input.views7d)) * 1 + Math.log1p(Math.max(0, input.likes7d)) * 4 + Math.log1p(Math.max(0, input.remixes7d)) * 8;
  const recency = Math.pow(0.5, ageHours / TRENDING_HALF_LIFE_HOURS);
  // Everything new gets a small head start so it can be seen at all.
  const freshness = ageHours < 48 ? 1.2 * (1 - ageHours / 48) : 0;
  const quality = 0.4 + 0.6 * (Math.max(0, Math.min(100, input.quality ?? 40)) / 100);
  return Math.round((engagement * recency + freshness) * quality * 1000) / 1000;
}

// ── Anti-abuse: caps and probation ──────────────────────────────────────────────────────────────────────────────

export type AbuseInput = {
  accountCreatedAt: string | Date | null;
  onlineCount: number;
  sanction?: { level: 'warning' | 'suspension' | 'ban'; until?: string | null } | null;
  now?: Date;
  limits?: CommunityLimits;
};

export type AbuseResult = CheckResult & { holdUntil?: string };

export function abuseCheck(input: AbuseInput): AbuseResult {
  const limits = input.limits || DEFAULT_LIMITS;
  const now = input.now || new Date();
  const sanction = input.sanction;
  if (sanction && (sanction.level === 'ban' || (sanction.level === 'suspension' && (!sanction.until || new Date(sanction.until) > now)))) {
    return { key: 'abuse', outcome: 'block', code: sanction.level === 'ban' ? 'creator_banned' : 'creator_suspended', reason: 'Votre compte ne peut plus ajouter d’apps à la Communauté pour le moment. Vos apps et votre espace ne sont pas touchés.', remedy: 'Vous pouvez contester cette décision depuis « Mes publications ».' };
  }
  const created = input.accountCreatedAt ? new Date(input.accountCreatedAt).getTime() : NaN;
  if (Number.isFinite(created) && limits.probationHours > 0) {
    const ready = created + limits.probationHours * 3_600_000;
    if (ready > now.getTime()) {
      if (input.onlineCount >= limits.maxOnlineDuringProbation) {
        return { key: 'abuse', outcome: 'fail', code: 'probation_cap', reason: 'Votre compte est récent : le nombre d’apps visibles est limité pendant les premières heures.', remedy: 'Réessayez un peu plus tard.', holdUntil: new Date(ready).toISOString() };
      }
      return { key: 'abuse', outcome: 'pass', code: 'probation', reason: 'Compte récent : l’app apparaît à la fin d’une courte période d’observation.', holdUntil: new Date(ready).toISOString() };
    }
  }
  if (input.onlineCount >= limits.maxOnlinePerAccount) {
    return { key: 'abuse', outcome: 'fail', code: 'account_cap', reason: `Vous avez atteint la limite de ${limits.maxOnlinePerAccount} apps visibles dans la Communauté.`, remedy: 'Retirez une app de la Communauté pour en ajouter une autre.' };
  }
  return { key: 'abuse', outcome: 'pass', code: 'abuse_ok', reason: 'Aucune limite atteinte.' };
}

// ── Reports and sanctions ───────────────────────────────────────────────────────────────────────────────────────

export const REPORT_REASONS = {
  illegal: 'Contenu illégal',
  adult: 'Contenu pour adultes',
  hate: 'Haine ou harcèlement',
  scam: 'Arnaque ou hameçonnage',
  impersonation: 'Usurpation d’une marque ou d’une personne',
  copyright: 'Droit d’auteur',
  privacy: 'Données personnelles',
  spam: 'Spam',
  other: 'Autre',
} as const;
export type ReportReason = keyof typeof REPORT_REASONS;

export const isReportReason = (value: unknown): value is ReportReason => typeof value === 'string' && Object.prototype.hasOwnProperty.call(REPORT_REASONS, value);
const GRAVE: ReadonlySet<string> = new Set(['illegal', 'adult', 'scam', 'impersonation']);

/** Distinct reporters decide, never the raw number of reports: one person cannot hide someone else's app alone. */
export function reportsAction(reports: Array<{ reporter: string; reason: string }>, limits: CommunityLimits = DEFAULT_LIMITS): { hide: boolean; reinforce: boolean; distinct: number } {
  const distinct = new Set(reports.map(report => report.reporter)).size;
  const grave = new Set(reports.filter(report => GRAVE.has(report.reason)).map(report => report.reporter)).size;
  const hide = distinct >= limits.reportHideThreshold || grave >= limits.reportHideThresholdGrave;
  return { hide, reinforce: hide, distinct };
}

export type Sanction = { level: 'warning' | 'suspension' | 'ban'; days?: number };

/** First upheld report: a warning. Second: a 7-day suspension of new listings. Third and beyond: out of the Community. */
export function nextSanction(upheldBefore: number): Sanction {
  if (upheldBefore <= 0) return { level: 'warning' };
  if (upheldBefore === 1) return { level: 'suspension', days: 7 };
  return { level: 'ban' };
}

// ── Remix limits (mass copy) ────────────────────────────────────────────────────────────────────────────────────

export type RemixHistory = { lastHour: number; lastDay: number; lastDaySameCreator: number };

export function remixAllowed(history: RemixHistory, limits: CommunityLimits = DEFAULT_LIMITS): { ok: true } | { ok: false; code: 'rate_hour' | 'rate_day' | 'mass_copy'; reason: string } {
  if (history.lastDaySameCreator >= limits.remixesPerCreatorPerDay) return { ok: false, code: 'mass_copy', reason: 'Vous avez déjà remixé beaucoup d’apps de ce créateur aujourd’hui. Réessayez demain.' };
  if (history.lastHour >= limits.remixesPerHour) return { ok: false, code: 'rate_hour', reason: 'Trop de remix à la suite : réessayez dans quelques minutes.' };
  if (history.lastDay >= limits.remixesPerDay) return { ok: false, code: 'rate_day', reason: 'Vous avez atteint la limite de remix pour aujourd’hui.' };
  return { ok: true };
}
