/**
 * How reliable the agents are, measured from the turns themselves.
 *
 * A turn is what a person asked for and waited on; its final status is the one fact nobody can argue with. The older
 * `agent_runs` ledger also counts rows that were opened and never closed (the boot reaper later stamps them
 * `RUN_INTERRUPTED`), so it reads worse than reality: turns are the source here.
 *
 * Success rate = completed / (completed + failed). A turn the person cancelled, one that stopped to ask a question
 * (`blocked`, `waiting_for_user`) and one still running are not failures of the product, so they stay out of the rate
 * and are counted apart.
 */
export type ReliabilityTurn = {
  id?: string;
  user_id?: string | null;
  status: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  resolved_action?: string | null;
  requested_mode?: string | null;
  checkpoint?: { modelId?: unknown } | null;
};

export type ReliabilityDay = { day: string; turns: number; completed: number; failed: number; cancelled: number; successRate: number | null };
export type ReliabilityGroup = { key: string; turns: number; completed: number; failed: number; successRate: number | null; durationMsP50: number | null };

export type ReliabilityReport = {
  days: number;
  totals: { turns: number; completed: number; failed: number; cancelled: number; other: number; successRate: number | null };
  daily: ReliabilityDay[];
  duration: { p50Ms: number | null; p90Ms: number | null };
  byModel: ReliabilityGroup[];
  byAction: ReliabilityGroup[];
  activation: Activation;
};

/**
 * How many people who tried got a real result.
 *
 * A build is the turn that takes minutes; a chat answer takes seconds. Counting every completed turn as « success »
 * would hide the people who asked for an app and never got one, so a result is a completed turn of at least
 * `BUILD_MIN_MS`. `underThreeMinutes` is the share of those people whose first such result came within three minutes.
 */
export const BUILD_MIN_MS = 60_000;
export type Activation = { people: number; withResult: number; rate: number | null; underThreeMinutes: number | null; firstResultP50Ms: number | null };

const ratio = (completed: number, failed: number): number | null => (completed + failed > 0 ? Math.round((completed / (completed + failed)) * 1000) / 1000 : null);

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

function durationMs(turn: ReliabilityTurn): number | null {
  const start = Date.parse(turn.started_at || turn.created_at);
  const end = Date.parse(turn.completed_at || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function group(turns: ReliabilityTurn[], keyOf: (turn: ReliabilityTurn) => string): ReliabilityGroup[] {
  const buckets = new Map<string, ReliabilityTurn[]>();
  for (const turn of turns) {
    const key = keyOf(turn) || 'inconnu';
    buckets.set(key, [...(buckets.get(key) || []), turn]);
  }
  return [...buckets.entries()].map(([key, rows]) => {
    const completed = rows.filter(row => row.status === 'completed').length;
    const failed = rows.filter(row => row.status === 'failed').length;
    return { key, turns: rows.length, completed, failed, successRate: ratio(completed, failed), durationMsP50: percentile(rows.filter(row => row.status === 'completed').map(durationMs).filter((v): v is number => v !== null), 50) };
  }).sort((a, b) => b.turns - a.turns);
}

export function buildReliabilityReport(turns: ReliabilityTurn[], options: { days?: number; now?: number } = {}): ReliabilityReport {
  const days = Math.min(90, Math.max(1, Math.round(options.days || 14)));
  const now = options.now ?? Date.now();
  const since = now - days * 86_400_000;
  const inWindow = turns.filter(turn => { const at = Date.parse(turn.created_at); return Number.isFinite(at) && at >= since && at <= now + 60_000; });

  const dayKey = (iso: string) => new Date(iso).toISOString().slice(0, 10);
  const byDay = new Map<string, ReliabilityTurn[]>();
  for (let index = 0; index < days; index += 1) byDay.set(new Date(now - index * 86_400_000).toISOString().slice(0, 10), []);
  for (const turn of inWindow) { const key = dayKey(turn.created_at); byDay.set(key, [...(byDay.get(key) || []), turn]); }
  const daily = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, rows]) => {
    const completed = rows.filter(row => row.status === 'completed').length;
    const failed = rows.filter(row => row.status === 'failed').length;
    return { day, turns: rows.length, completed, failed, cancelled: rows.filter(row => row.status === 'cancelled').length, successRate: ratio(completed, failed) };
  });

  const completedTurns = inWindow.filter(turn => turn.status === 'completed');
  const firstResults = new Map<string, number>();
  const people = new Set<string>();
  for (const turn of inWindow) {
    if (!turn.user_id) continue;
    people.add(turn.user_id);
    const took = durationMs(turn);
    if (turn.status !== 'completed' || took === null || took < BUILD_MIN_MS) continue;
    const at = Date.parse(turn.created_at);
    const known = firstResults.get(turn.user_id);
    // The first result of each person: the earliest completed build of the window.
    if (known === undefined || at < known) firstResults.set(turn.user_id, at);
  }
  const firstDurations = [...firstResults.entries()].map(([user]) => {
    const first = inWindow.filter(turn => turn.user_id === user && turn.status === 'completed' && (durationMs(turn) ?? 0) >= BUILD_MIN_MS)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0];
    return first ? durationMs(first) : null;
  }).filter((value): value is number => value !== null);
  const activation: Activation = {
    people: people.size,
    withResult: firstResults.size,
    rate: people.size ? Math.round((firstResults.size / people.size) * 1000) / 1000 : null,
    underThreeMinutes: firstDurations.length ? Math.round((firstDurations.filter(value => value < 180_000).length / firstDurations.length) * 1000) / 1000 : null,
    firstResultP50Ms: percentile(firstDurations, 50),
  };
  const completed = completedTurns.length;
  const failed = inWindow.filter(turn => turn.status === 'failed').length;
  const cancelled = inWindow.filter(turn => turn.status === 'cancelled').length;
  const durations = completedTurns.map(durationMs).filter((value): value is number => value !== null);
  return {
    days,
    totals: { turns: inWindow.length, completed, failed, cancelled, other: inWindow.length - completed - failed - cancelled, successRate: ratio(completed, failed) },
    daily,
    duration: { p50Ms: percentile(durations, 50), p90Ms: percentile(durations, 90) },
    byModel: group(inWindow, turn => String(turn.checkpoint?.modelId || '')).slice(0, 12),
    byAction: group(inWindow, turn => String(turn.resolved_action || turn.requested_mode || '')).slice(0, 12),
    activation,
  };
}

export type ReliabilityAlert = { level: 'ok' | 'warn'; turns: number; completed: number; failed: number; successRate: number | null; windowMinutes: number };

/**
 * Something is wrong *now*: in the last `windowMinutes`, enough turns ended (`minTurns`) and too few of them worked.
 * A quiet hour is not an alarm, and one failure among three is not a trend.
 */
export function evaluateReliabilityAlert(turns: ReliabilityTurn[], options: { now?: number; windowMinutes?: number; minTurns?: number; minSuccessRate?: number } = {}): ReliabilityAlert {
  const now = options.now ?? Date.now();
  const windowMinutes = options.windowMinutes ?? 90;
  const minTurns = options.minTurns ?? 8;
  const minSuccessRate = options.minSuccessRate ?? 0.5;
  const recent = turns.filter(turn => {
    const ended = Date.parse(turn.completed_at || '');
    return Number.isFinite(ended) && ended >= now - windowMinutes * 60_000 && ended <= now + 60_000;
  });
  const completed = recent.filter(turn => turn.status === 'completed').length;
  const failed = recent.filter(turn => turn.status === 'failed').length;
  const successRate = ratio(completed, failed);
  const level = completed + failed >= minTurns && successRate !== null && successRate < minSuccessRate ? 'warn' : 'ok';
  return { level, turns: completed + failed, completed, failed, successRate, windowMinutes };
}

export function reliabilityAlertEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CODEN_RELIABILITY_ALERT !== '0';
}
