import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLANS,
  FEATURED_PLAN_BADGE,
  planCreditUnitXaf,
  planFeatures,
  priceFor,
  publicBillingCatalog,
  TOPUP_PRODUCTS_V2,
  topupPriceFor,
  topupUnitXaf,
} from './billing-v2';

/**
 * One price list, one set of words.
 *
 * The landing, the pricing page, the upgrade modal, the onboarding and
 * Settings → Facturation all read billing-v2; the static HTML they start from
 * must say the same thing before the script runs.
 */
const landing = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const pricing = readFileSync(new URL('../../pricing.html', import.meta.url), 'utf8');
const listItems = (html: string, marker: string) => {
  const start = html.indexOf(marker);
  const list = html.slice(start, html.indexOf('</ul>', start));
  return [...list.matchAll(/<li>(?:<i aria-hidden="true"><\/i><span>)?([^<]+)(?:<\/span>)?<\/li>/g)].map(match => match[1]);
};
const formatUnit = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value);

describe('pricing consistency', () => {
  it('never sells a top-up credit cheaper than the plan’s own credit', () => {
    for (const plan of ['pro', 'business'] as const) {
      expect(topupUnitXaf(plan)).toBeGreaterThan(planCreditUnitXaf(plan));
      expect(topupUnitXaf(plan)).toBe(planCreditUnitXaf(plan) * 1.25);
      for (const product of TOPUP_PRODUCTS_V2.filter(item => item.plan === plan)) {
        expect(product.amount / product.credits).toBeGreaterThanOrEqual(priceFor(plan, 100, 'monthly').amount / 100);
      }
    }
    expect(topupPriceFor('pro', 100).amount).toBe(18_750);
    expect(topupPriceFor('business', 100).amount).toBe(37_500);
  });

  it('publishes the same plan features through the API as on every surface', () => {
    expect(BILLING_PLANS.pro.capabilities).toEqual(planFeatures('pro', 25));
    expect(BILLING_PLANS.business.capabilities).toEqual(planFeatures('business', 100));
    expect(publicBillingCatalog().topupUnit).toEqual({ pro: 187.5, business: 375 });
  });

  it('starts the pricing page with the canonical lists, top-up prices and badge', () => {
    expect(listItems(pricing, 'data-pricing-capabilities="pro"')).toEqual(planFeatures('pro', 25));
    expect(listItems(pricing, 'data-pricing-capabilities="business"')).toEqual(planFeatures('business', 100));
    expect(listItems(pricing, 'data-pricing-capabilities="free"')).toEqual(['5 crédits offerts une seule fois', ...planFeatures('free')]);
    expect(pricing).toContain(`${formatUnit(topupUnitXaf('pro'))} FCFA le crédit`);
    expect(pricing).toContain(`${formatUnit(topupUnitXaf('business'))} FCFA le crédit`);
    expect(pricing).toContain(`pricing-plan-badge">${FEATURED_PLAN_BADGE}<`);
  });

  it('starts the landing with the first three canonical lines and the same badge', () => {
    expect(listItems(landing, 'data-lp-features="pro"')).toEqual(planFeatures('pro', 25).slice(0, 3));
    expect(listItems(landing, 'data-lp-features="business"')).toEqual(planFeatures('business', 100).slice(0, 3));
    expect(listItems(landing, 'data-lp-features="free"')).toEqual(planFeatures('free').slice(0, 3));
    expect(landing).toContain(`lp-plan-badge">${FEATURED_PLAN_BADGE}<`);
  });
});
