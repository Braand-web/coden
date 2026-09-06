/**
 * V2 runs in shadow mode until the additive ledger migration has been applied
 * and reconciled. Setting CODEN_MONETIZATION_V2_ENABLED=1 performs the cutover
 * without requiring another build; disabling it never removes usage records.
 */
export const CODEN_MONETIZATION_ENABLED = process.env.CODEN_MONETIZATION_V2_ENABLED === '1';
export const CODEN_UNMETERED_USAGE_BUDGET = Number.MAX_SAFE_INTEGER;

export const CODEN_PUBLIC_ACCESS = {
  key: CODEN_MONETIZATION_ENABLED ? 'metered-v2' : 'shadow-v2',
  label: CODEN_MONETIZATION_ENABLED ? 'Metered access' : 'Billing V2 shadow mode',
  metered: CODEN_MONETIZATION_ENABLED,
  pricingAvailable: true,
} as const;
