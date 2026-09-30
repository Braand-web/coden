/**
 * Two projects of the same person should not look like twins.
 *
 * A project's accent hue is picked from a short list that suits its direction, seeded by the project so it never
 * drifts. Seeded alone, two dashboards in a row can land on the same hue; here the hues of the person's recent
 * projects are set aside first, so the next one is at least `MIN_DISTANCE` degrees away on the colour wheel when the
 * list allows it, and as far as it can be when it does not.
 */
export const MIN_DISTANCE = 30;

/** Shortest distance between two hues on the wheel, 0–180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(((a % 360) + 360) % 360 - ((b % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

/**
 * `avoid` is newest first. When the pool cannot keep away from all of them, the oldest are let go one by one: the
 * look of the project just before this one matters more than that of the one five projects ago.
 */
export function pickDistinctHue(candidates: number[], seedIndex: number, avoid: number[] = [], lock?: number | null): number {
  if (typeof lock === 'number' && Number.isFinite(lock)) return lock;
  const pool = candidates.length ? candidates : [250];
  const recent = avoid.filter(value => Number.isFinite(value));
  if (!recent.length) return pool[seedIndex % pool.length];
  const gapTo = (hue: number, others: number[]) => Math.min(...others.map(other => hueDistance(hue, other)));
  for (let keep = recent.length; keep >= 1; keep -= 1) {
    const others = recent.slice(0, keep);
    const far = pool.filter(hue => gapTo(hue, others) >= MIN_DISTANCE);
    // Far enough: the seed's own pick among them, so the choice is stable for a given history.
    if (far.length) return far[seedIndex % far.length];
  }
  // Even the latest one alone is too close to everything: the farthest from it, the seed breaking ties.
  const latest = recent.slice(0, 1);
  const best = Math.max(...pool.map(hue => gapTo(hue, latest)));
  const farthest = pool.filter(hue => gapTo(hue, latest) === best);
  return farthest[seedIndex % farthest.length];
}

export type DesignIdentity = { hue: number; direction: string; mode: 'light' | 'dark' };

/** What a stored identity may be: a hue on the wheel, a short direction name. Anything else is ignored. */
export function readDesignIdentity(value: unknown): DesignIdentity | null {
  const row = (value && typeof value === 'object' ? value : null) as Record<string, unknown> | null;
  if (!row) return null;
  const hue = Number(row.hue);
  if (!Number.isFinite(hue) || hue < 0 || hue > 360) return null;
  return { hue, direction: String(row.direction || '').slice(0, 40), mode: row.mode === 'dark' ? 'dark' : 'light' };
}
