import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SaspayService } from './billing-service';

describe('complimentary subscription expiry', () => {
  const run = async (anotherActive: boolean) => {
    const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
    const filters: unknown[] = [];
    const db = { from(table: string) {
      let patch: Record<string, unknown> | undefined;
      const q: any = {
        select: () => q, eq: () => q, lte: () => q, gt: () => q, limit: () => q,
        in: (column: string, values: string[]) => { filters.push([column, values]); return q; },
        update: (value: Record<string, unknown>) => { patch = value; writes.push({ table, patch: value }); return q; },
        maybeSingle: async () => ({ data: table === 'organizations' ? { plan: 'business' } : anotherActive ? { id: 'paid-active' } : null, error: null }),
        then: (resolve: any) => Promise.resolve({ data: !patch && table === 'billing_subscriptions_v2' ? [{ id: 'admin-expired', account_id: 'test-account' }] : null, error: null }).then(resolve),
      }; return q;
    } };
    expect(await new SaspayService(db).expireEndedPlans()).toBe(1);
    return { writes, filters };
  };
  it('expires admin entitlements and restores Free when no other subscription remains', async () => {
    const { writes, filters } = await run(false);
    expect(filters).toContainEqual(['provider', ['saspay', 'admin']]);
    expect(writes).toContainEqual({ table: 'billing_subscriptions_v2', patch: expect.objectContaining({ status: 'expired' }) });
    expect(writes).toContainEqual({ table: 'organizations', patch: expect.objectContaining({ plan: 'free' }) });
  });
  it('does not remove another active subscription', async () => {
    const { writes } = await run(true);
    expect(writes.some(w => w.table === 'organizations')).toBe(false);
  });
  it('keeps complimentary grants out of recurring paid credit issuance', () => {
    const source = readFileSync(new URL('./billing-service.ts', import.meta.url), 'utf8');
    const annual = source.slice(source.indexOf('async grantDueAnnualCredits('), source.indexOf('async expireEndedPlans('));
    expect(annual).toContain(".eq('provider', 'saspay')");
    const migration = readFileSync(new URL('../../supabase/migrations/20261004074605_admin_complimentary_subscription_provider.sql', import.meta.url), 'utf8');
    expect(migration).toContain('monthly_net_revenue_usd = 0 and next_credit_grant_at is null');
    expect(migration).toContain("billing_interval = 'contract'");
    expect(migration).not.toMatch(/grant\s+(?:all|insert|update)|disable row level security/i);
  });
});
