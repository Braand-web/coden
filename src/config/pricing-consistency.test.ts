import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BILLING_PLANS,
  FEATURED_PLAN_BADGE,
  MONTHLY_EMAILS,
  planComparisonRows,
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

  it('compares the plans with the catalogue’s own figures', () => {
    const flat = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');
    const rows = Object.fromEntries(planComparisonRows().map(row => [row.label, { free: flat(row.free), pro: flat(row.pro), business: flat(row.business) }]));
    expect(rows.Prix).toEqual({ free: '0 FCFA', pro: 'dès 5 000 FCFA / mois', business: 'dès 30 000 FCFA / mois' });
    expect(rows.Prix.pro).toContain(flat(new Intl.NumberFormat('fr-FR').format(priceFor('pro', BILLING_PLANS.pro.tiers[0], 'monthly').amount)));
    expect(rows.Crédits.pro).toBe('25, 60, puis 100 à 10 000 par mois');
    expect(rows['Sites publiés']).toEqual({ free: '—', pro: '1, 3 ou illimités', business: 'Illimités' });
    expect(rows['Domaines personnalisés']).toEqual({ free: '—', pro: '1, 3 ou 10', business: 'Illimités' });
    expect(rows['E-mails transactionnels'].business).toBe(`${flat(new Intl.NumberFormat('fr-FR').format(MONTHLY_EMAILS.business))} par mois`);
    expect(rows['Recharge ponctuelle']).toEqual({ free: '—', pro: `${formatUnit(topupUnitXaf('pro'))} FCFA le crédit`, business: `${formatUnit(topupUnitXaf('business'))} FCFA le crédit` });
    expect(rows['Paiement annuel'].pro).toBe('−20 %');
  });

  it('starts the pricing page with the comparison rows of the catalogue', () => {
    const flat = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
    const start = pricing.indexOf('<tbody data-pricing-comparison>');
    const body = pricing.slice(start, pricing.indexOf('</tbody>', start));
    const rows = [...body.matchAll(/<tr>(.*?)<\/tr>/g)].map(match => [...match[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map(cell => flat(cell[1])));
    expect(start).toBeGreaterThan(0);
    expect(rows).toEqual(planComparisonRows().map(row => [row.label, row.free, row.pro, row.business].map(flat)));
  });

  it('starts the landing with the first three canonical lines and the same badge', () => {
    expect(listItems(landing, 'data-lp-features="pro"')).toEqual(planFeatures('pro', 25).slice(0, 3));
    expect(listItems(landing, 'data-lp-features="business"')).toEqual(planFeatures('business', 100).slice(0, 3));
    expect(listItems(landing, 'data-lp-features="free"')).toEqual(planFeatures('free').slice(0, 3));
    expect(landing).toContain(`lp-plan-badge">${FEATURED_PLAN_BADGE}<`);
  });
});
