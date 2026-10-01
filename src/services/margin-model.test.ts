import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS, actionMargin, costPerSuccessfulRunUsd, maxProviderCostUsd, netRevenuePerCreditUsd, sensitivity } from './margin-model.ts';

const noFees = { ...DEFAULT_ASSUMPTIONS, paymentFeeRate: 0, platformCostPerRunUsd: 0 };

describe('revenue per credit', () => {
  it('Pro, 100 credits, 15 000 FCFA at 600 FCFA/$: 25 $ for 100 credits = 0,25 $ a credit (hand-checked)', () => {
    expect(netRevenuePerCreditUsd('pro', 100, 'monthly', noFees)).toBeCloseTo(0.25, 10);
  });

  it('Business is 300 FCFA a credit: 0,50 $', () => {
    expect(netRevenuePerCreditUsd('business', 100, 'monthly', noFees)).toBeCloseTo(0.5, 10);
  });

  it('the 25-credit Pro tier is 5 000 FCFA: 8,33 $ for 25 credits = 0,333 $ a credit', () => {
    expect(netRevenuePerCreditUsd('pro', 25, 'monthly', noFees)).toBeCloseTo(0.3333, 4);
  });

  it('annual billing is 20 % cheaper per credit', () => {
    const monthly = netRevenuePerCreditUsd('pro', 100, 'monthly', noFees);
    expect(netRevenuePerCreditUsd('pro', 100, 'annual', noFees) / monthly).toBeCloseTo(0.8, 6);
  });

  it('takes tax, payment fees and refunds out', () => {
    const net = netRevenuePerCreditUsd('pro', 100, 'monthly', { ...noFees, vatRate: 0.2, paymentFeeRate: 0.03, refundRate: 0.01 });
    expect(net).toBeCloseTo(0.25 / 1.2 * 0.97 * 0.99, 8);
  });
});

describe('one action', () => {
  it('Pro 100 credits, a full page (1,7 credits) that cost 0,106 $: 0,425 $ in, 0,106 $ out, 75 % margin', () => {
    const margin = actionMargin({ plan: 'pro', credits: 100, interval: 'monthly', action: 'full_page', providerCostUsd: 0.106, assumptions: noFees });
    expect(margin).toMatchObject({ credits: 1.7, revenueUsd: 0.425, costUsd: 0.106, marginUsd: 0.319, marginPct: 0.7506, verdict: 'above_floor' });
  });

  it('a premium-model run at about 1,9 $ on a Business full page (0,85 $) is a loss', () => {
    const margin = actionMargin({ plan: 'business', credits: 100, interval: 'monthly', action: 'full_page', providerCostUsd: 1.9, assumptions: noFees });
    expect(margin.revenueUsd).toBe(0.85);
    expect(margin.verdict).toBe('loss');
    expect(margin.marginPct).toBeLessThan(0);
  });

  it('the most a run may cost to keep the 55 % floor: 45 % of the revenue', () => {
    expect(maxProviderCostUsd({ plan: 'pro', credits: 100, interval: 'monthly', action: 'full_page', assumptions: noFees })).toBeCloseTo(0.425 * 0.45, 3);
  });
});

describe('sensitivity', () => {
  const rows = sensitivity({ plan: 'pro', credits: 100, interval: 'monthly', action: 'full_page', providerCostUsd: 0.106 });
  const byLabel = (label: string) => rows.find(row => row.label.startsWith(label))!.marginPct!;

  it('every stress lowers the margin, and a stronger franc raises it', () => {
    const base = byLabel('Base');
    expect(byLabel('Prix des modèles')).toBeLessThan(base);
    expect(byLabel('Franc −10')).toBeLessThan(base);
    expect(byLabel('Franc +10')).toBeGreaterThan(base);
    expect(byLabel('Taxe')).toBeLessThan(base);
    expect(byLabel('Frais de paiement')).toBeLessThan(base);
    expect(byLabel('Coût du run ×3')).toBeLessThan(byLabel('Prix des modèles'));
  });
});

describe('cost per successful run', () => {
  it('carries the failed spend on the successes (3,15 $ over 134 completed turns)', () => {
    expect(costPerSuccessfulRunUsd(3.15, 134)).toBeCloseTo(0.0235, 4);
    expect(costPerSuccessfulRunUsd(3.15, 0)).toBeNull();
  });
});
