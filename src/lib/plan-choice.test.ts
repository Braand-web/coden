import { describe, expect, it } from 'vitest';
import { planChoiceHref, readBillingReturn, readPlanChoice, wantsBillingSettings, withoutPlanParams } from './plan-choice';

describe('plan choice links', () => {
  it('carries the offer to billing, through sign-up for a visitor', () => {
    const signedIn = planChoiceHref({ plan: 'pro', credits: 200, interval: 'annual' }, true);
    expect(signedIn).toBe('/dashboard.html?settings=facturation&plan=pro&interval=annual&credits=200');
    const visitor = planChoiceHref({ plan: 'business', credits: 400, interval: 'monthly' }, false);
    expect(visitor.startsWith('/auth.html?mode=signup&redirect=')).toBe(true);
    expect(decodeURIComponent(visitor.split('redirect=')[1])).toBe('/dashboard.html?settings=facturation&plan=business&interval=monthly&credits=400');
  });

  it('sends the free plan to the dashboard, with nothing to pay', () => {
    expect(planChoiceHref({ plan: 'free', interval: 'monthly' }, true)).toBe('/dashboard.html');
    expect(planChoiceHref({ plan: 'free', interval: 'monthly' }, false)).toBe('/auth.html?mode=signup&redirect=%2Fdashboard.html');
  });

  it('reads back what the button carried, and nothing else', () => {
    expect(readPlanChoice('?settings=facturation&plan=pro&interval=annual&credits=200')).toEqual({ plan: 'pro', interval: 'annual', credits: 200 });
    expect(readPlanChoice('?plan=business')).toEqual({ plan: 'business', interval: 'monthly' });
    expect(readPlanChoice('?plan=free')).toBeNull();
    expect(readPlanChoice('?plan=enterprise')).toBeNull();
    expect(readPlanChoice('?plan=pro&credits=-3')?.credits).toBeUndefined();
    expect(wantsBillingSettings('?settings=facturation')).toBe(true);
    expect(wantsBillingSettings('?settings=profil')).toBe(false);
    expect(readBillingReturn('?billing=success')).toBe('success');
    expect(readBillingReturn('?billing=topup-cancelled')).toBe('topup-cancelled');
    expect(readBillingReturn('?billing=hacked')).toBeNull();
  });

  it('clears the consumed parameters so a reload replays nothing', () => {
    expect(withoutPlanParams('https://coden.fun/dashboard.html?settings=facturation&plan=pro&credits=100&interval=annual&billing=success&project=x#top'))
      .toBe('/dashboard.html?project=x#top');
  });
});
