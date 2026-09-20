/* ---------------------------------------------------------------------------
 * What a balance readout is allowed to claim
 *
 * Coden's credits are granted per category. A grant carries a
 * `usage_restriction` — `build`, `cloud`, `ai_gateway`, `email`, or `general`
 * for credit that can pay for anything — and `coden_billing_reserve` only ever
 * draws from grants restricted to the category being charged or to `general`.
 *
 * Any number shown to a customer that does not use that same predicate is a
 * promise the next request cannot keep. On 13 September this account's wallet
 * read 30 credits and its next message was refused: the 30 were build and
 * cloud allowances, the message needed `ai_gateway`, and the free plan issues
 * 4 of those a month against 30 build and 20 cloud.
 *
 * So this lives in one place, is pure, and is tested — rather than being a
 * reduce written twice with slightly different filters.
 * ------------------------------------------------------------------------- */
export const UNIFIED_USAGE_CATEGORIES = ['build', 'cloud', 'ai_gateway', 'email'] as const;

export type UnifiedUsageCategory = (typeof UNIFIED_USAGE_CATEGORIES)[number];

/** The restriction that can pay for any category. */
export const SHARED_USAGE_RESTRICTION = 'general';

export type SpendableGrant = {
  usage_restriction: string;
  credits_remaining: number;
};

/**
 * Whether this grant can pay for this category.
 *
 * Mirrors the reservation RPC's own WHERE clause. An approximation of it would
 * reintroduce the same disagreement in miniature, which is the entire defect
 * this module exists to prevent.
 */
export function grantCoversCategory(grant: SpendableGrant, category: UnifiedUsageCategory): boolean {
  return grant.usage_restriction === category || grant.usage_restriction === SHARED_USAGE_RESTRICTION;
}

/**
 * Credit actually spendable per category.
 *
 * The caller is expected to have already excluded frozen, expired and
 * exhausted grants — the same way the RPC does — so this only applies the
 * restriction axis.
 */
export function spendableByCategory(grants: readonly SpendableGrant[]): Record<UnifiedUsageCategory, number> {
  const totals = Object.fromEntries(
    UNIFIED_USAGE_CATEGORIES.map(category => [category, 0]),
  ) as Record<UnifiedUsageCategory, number>;

  for (const grant of grants) {
    const remaining = Number(grant.credits_remaining || 0);
    if (!(remaining > 0)) continue;
    for (const category of UNIFIED_USAGE_CATEGORIES) {
      if (grantCoversCategory(grant, category)) totals[category] += remaining;
    }
  }

  return totals;
}

/**
 * Credit that is not tied to a category.
 *
 * Reported separately so the per-category figures can be read as "what this
 * can pay for" — shared credit is counted inside every one of them, and a
 * reader adding them up would otherwise count it several times.
 */
export function sharedCredits(grants: readonly SpendableGrant[]): number {
  return grants
    .filter(grant => grant.usage_restriction === SHARED_USAGE_RESTRICTION)
    .reduce((sum, grant) => sum + Math.max(0, Number(grant.credits_remaining || 0)), 0);
}
