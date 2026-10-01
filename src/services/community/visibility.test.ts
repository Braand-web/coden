import { describe, expect, it } from 'vitest';
import { decideListing, graceEndsAt, ownerControls, planKind } from './visibility';

const live = { published: true, protection: 'none' as const };

describe('plans', () => {
  it('maps Coden plans to free or paid, and anything unknown to a cautious third kind', () => {
    expect(planKind('free')).toBe('free');
    expect(planKind(' PRO ')).toBe('paid');
    expect(planKind('business')).toBe('paid');
    expect(planKind('enterprise')).toBe('paid');
    expect(planKind('mystery')).toBe('unknown');
    expect(planKind(null)).toBe('unknown');
  });
});

describe('the listing decision', () => {
  it('lists a published free-plan app automatically', () => {
    expect(decideListing({ ...live, plan: 'free' })).toMatchObject({ listable: true, origin: 'free_auto', code: 'listable_free_auto' });
  });

  it('never lists a draft, whatever the plan or the choice', () => {
    for (const plan of ['free', 'pro', 'business', 'enterprise']) {
      expect(decideListing({ published: false, plan, optedIn: true })).toMatchObject({ listable: false, code: 'not_published' });
    }
  });

  it('never lists a protected app, even on the free plan or when the owner opted in', () => {
    expect(decideListing({ published: true, protection: 'password', plan: 'free' })).toMatchObject({ listable: false, code: 'protected' });
    expect(decideListing({ published: true, protection: 'private', plan: 'pro', optedIn: true })).toMatchObject({ listable: false, code: 'protected' });
  });

  it('keeps a paid-plan app private until the owner adds it', () => {
    expect(decideListing({ ...live, plan: 'pro' })).toMatchObject({ listable: false, code: 'paid_not_opted_in' });
    expect(decideListing({ ...live, plan: 'pro', optedIn: true })).toMatchObject({ listable: true, origin: 'paid_opt_in' });
    expect(decideListing({ ...live, plan: 'business', optedIn: false }).listable).toBe(false);
  });

  it('treats an unknown plan like a paid one: nothing is listed on its own', () => {
    expect(decideListing({ ...live, plan: 'mystery' })).toMatchObject({ listable: false, code: 'plan_unknown' });
    expect(decideListing({ ...live, plan: undefined, optedIn: true }).listable).toBe(true);
  });

  it('lets a person or a moderator take an app out, and nothing overrides that', () => {
    expect(decideListing({ ...live, plan: 'free', removedByUser: true })).toMatchObject({ listable: false, code: 'removed_by_user' });
    expect(decideListing({ ...live, plan: 'pro', optedIn: true, removedByModeration: true })).toMatchObject({ listable: false, code: 'removed_by_moderation' });
    expect(decideListing({ ...live, plan: 'free', removedByUser: true, removedByModeration: true }).code).toBe('removed_by_moderation');
  });

  it('holds a downgraded app back until the 14-day notice has run out', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    const later = new Date('2026-10-10T10:00:00Z');
    expect(decideListing({ ...live, plan: 'free', autoListNotBefore: later, now })).toMatchObject({ listable: false, code: 'grace_period' });
    expect(decideListing({ ...live, plan: 'free', autoListNotBefore: later, now: new Date('2026-10-11T00:00:00Z') }).listable).toBe(true);
    // The owner may still add it themselves during the notice.
    expect(decideListing({ ...live, plan: 'free', autoListNotBefore: later, optedIn: true, now }).listable).toBe(true);
    expect(graceEndsAt(now).toISOString()).toBe('2026-10-15T10:00:00.000Z');
  });

  it('freezes new listings but leaves the ones already online alone', () => {
    expect(decideListing({ ...live, plan: 'free', listingsFrozen: true })).toMatchObject({ listable: false, code: 'listings_frozen' });
    expect(decideListing({ ...live, plan: 'free', listingsFrozen: true, alreadyListed: true }).listable).toBe(true);
  });

  it('always answers with a reason a person can read', () => {
    const codes = [
      decideListing({ published: false, plan: 'free' }), decideListing({ ...live, plan: 'pro' }), decideListing({ ...live, plan: 'free' }),
      decideListing({ ...live, plan: 'free', removedByUser: true }), decideListing({ ...live, plan: 'free', listingsFrozen: true }),
    ];
    for (const item of codes) expect(item.reason.length).toBeGreaterThan(20);
  });
});

describe('what the owner may control', () => {
  it('free: automatic, no choice; paid: a choice', () => {
    expect(ownerControls('free')).toEqual({ canChoose: false, mode: 'automatic' });
    expect(ownerControls('pro')).toEqual({ canChoose: true, mode: 'choice' });
  });
});
