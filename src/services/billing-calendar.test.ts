import { describe, expect, it } from 'vitest';
import { annualInstallments, billingMonthAt } from './billing-calendar';

describe('anchored annual grants', () => {
  it('keeps all twelve periods anchored through February and leap years', () => {
    const anchor = new Date('2024-01-31T12:34:56.000Z');
    const periods = annualInstallments(anchor,new Date('2025-02-01T00:00:00Z'));
    expect(periods).toHaveLength(12);
    expect(periods[1].startsAt.toISOString()).toBe('2024-02-29T12:34:56.000Z');
    expect(periods[2].startsAt.toISOString()).toBe('2024-03-31T12:34:56.000Z');
    expect(periods[11].expiresAt.toISOString()).toBe('2025-01-31T12:34:56.000Z');
    expect(new Set(periods.map(p=>p.startsAt.toISOString())).size).toBe(12);
  });
  it('does not grant future installments on an early or resumed run', () => {
    const anchor = new Date('2026-01-31T23:00:00Z');
    const now = new Date('2026-04-01T00:00:00Z');
    expect(annualInstallments(anchor,now).map(p=>p.index)).toEqual([0,1,2]);
    expect(billingMonthAt(anchor,1).toISOString()).toBe('2026-02-28T23:00:00.000Z');
    expect(billingMonthAt(anchor,2).toISOString()).toBe('2026-03-31T23:00:00.000Z');
  });
  it('rejects invalid dates and offsets', () => {
    expect(()=>billingMonthAt(new Date('invalid'),1)).toThrow();
    expect(()=>billingMonthAt(new Date(),-1)).toThrow();
    expect(()=>billingMonthAt(new Date(),0.5)).toThrow();
  });
});
