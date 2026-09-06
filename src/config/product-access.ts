/**
 * Coden currently has no commercial plans or usage-based access gates.
 * Provider cost is still measured internally for operations, but it never
 * changes product access and is never presented as credits to the user.
 */
export const CODEN_MONETIZATION_ENABLED = false;
export const CODEN_UNMETERED_USAGE_BUDGET = Number.MAX_SAFE_INTEGER;

export const CODEN_PUBLIC_ACCESS = {
  key: 'open',
  label: 'Open access',
  metered: false,
  pricingAvailable: false,
} as const;
