/** Anchor every installment to the purchase date; February must not shift March. */
export function billingMonthAt(anchor: Date, months: number): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isInteger(months) || months < 0) throw new Error('Invalid billing calendar.');
  const value = new Date(anchor);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const last = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate();
  value.setUTCDate(Math.min(day,last));
  return value;
}
export function annualInstallments(anchor: Date, now: Date): Array<{ index: number; startsAt: Date; expiresAt: Date }> {
  const rows = [];
  for (let index = 0; index < 12; index++) {
    const startsAt = billingMonthAt(anchor,index);
    if (startsAt > now) break;
    rows.push({ index, startsAt, expiresAt: billingMonthAt(anchor,index+1) });
  }
  return rows;
}
