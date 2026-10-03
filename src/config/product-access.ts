/** Shadow accounting is a development tool, never a production entitlement. */
export function monetizationEnabled(env: Record<string, string | undefined>): boolean {
  const production = env.NODE_ENV === 'production'
    || String(env.RAILWAY_ENVIRONMENT_NAME || '').toLowerCase() === 'production';
  // Missing or accidentally disabled flags must not grant every customer
  // Enterprise model access or effectively infinite credits in production.
  if (production) return true;
  return env.CODEN_MONETIZATION_V2_ENABLED === '1';
}

export const CODEN_MONETIZATION_ENABLED = monetizationEnabled(process.env);
export const CODEN_UNMETERED_USAGE_BUDGET = Number.MAX_SAFE_INTEGER;

export const CODEN_PUBLIC_ACCESS = {
  key: CODEN_MONETIZATION_ENABLED ? 'metered-v2' : 'shadow-v2',
  label: CODEN_MONETIZATION_ENABLED ? 'Metered access' : 'Billing V2 shadow mode',
  metered: CODEN_MONETIZATION_ENABLED,
  pricingAvailable: true,
} as const;
