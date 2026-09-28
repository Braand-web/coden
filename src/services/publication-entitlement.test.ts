import { describe, expect, it } from 'vitest';
import { resolvePublicationEntitlement } from './billing-service';

function fakeSupabase(subscription: Record<string, unknown> | null) {
  const query: any = {
    select() { return query; },
    eq() { return query; },
    order() { return query; },
    limit() { return query; },
    async maybeSingle() { return { data: subscription, error: null }; },
  };
  return { from: () => query };
}

describe('publication entitlement', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('allows a Free account to publish on Coden but not add a custom domain', async () => {
    const entitlement = await resolvePublicationEntitlement(fakeSupabase(null), 'account', now);
    expect(entitlement).toMatchObject({
      plan: 'free',
      canPublish: true,
      canAddDomain: false,
      canServeExisting: true,
      publishedSites: null,
      customDomains: 0,
    });
  });

  it('maps an active Pro credit tier to its exact site and domain limits', async () => {
    const entitlement = await resolvePublicationEntitlement(fakeSupabase({
      plan_id: 'coden_pro_v2',
      credit_tier: 60,
      status: 'active',
      current_period_end: '2026-10-20T12:00:00.000Z',
    }), 'account', now);
    expect(entitlement).toMatchObject({
      plan: 'pro',
      creditTier: 60,
      canPublish: true,
      canAddDomain: true,
      canServeExisting: true,
      publishedSites: null,
      customDomains: 3,
    });
  });

  it('keeps publication available after payment expiry without allowing a new custom domain', async () => {
    const entitlement = await resolvePublicationEntitlement(fakeSupabase({
      plan_id: 'coden_pro_v2',
      credit_tier: 100,
      status: 'past_due',
      current_period_end: '2026-09-18T12:00:00.000Z',
    }), 'account', now);
    expect(entitlement.canPublish).toBe(true);
    expect(entitlement.canAddDomain).toBe(false);
    expect(entitlement.canServeExisting).toBe(true);
    expect(entitlement.graceEndsAt).toBeNull();
  });

  it('keeps existing sites and domains online after the old grace period', async () => {
    const entitlement = await resolvePublicationEntitlement(fakeSupabase({
      plan_id: 'coden_business_v2',
      credit_tier: 100,
      status: 'past_due',
      current_period_end: '2026-09-10T12:00:00.000Z',
    }), 'account', now);
    expect(entitlement.canPublish).toBe(true);
    expect(entitlement.canServeExisting).toBe(true);
    expect(entitlement.canAddDomain).toBe(false);
    expect(entitlement.publishedSites).toBeNull();
    expect(entitlement.customDomains).toBeNull();
  });
});
