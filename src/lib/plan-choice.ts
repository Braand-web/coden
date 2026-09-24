/**
 * An offer chosen on a public page, carried to the payment.
 *
 * "Choisir Pro" on the pricing page put the plan, credits and interval in the
 * link — and the dashboard read none of it: it opened as usual and the choice
 * was lost, so the buyer had to find Settings → Billing and choose again. The
 * landing's buttons did not even carry the choice. Both pages now build the
 * link here, and the dashboard reads it back here, so the two cannot drift.
 */

import type { BillingInterval } from '../config/billing-v2';
import { storedAccessToken } from './stored-session';

export type PaidPlan = 'pro' | 'business';
export type PlanChoice = { plan: 'free' | PaidPlan; credits?: number; interval: BillingInterval };
export type BillingReturn = 'success' | 'cancelled' | 'topup-success' | 'topup-cancelled';

/** Where an offer button leads: the dashboard's billing, through sign-up when signed out. */
export function planChoiceHref(choice: PlanChoice, signedIn: boolean): string {
  let destination = '/dashboard.html';
  if (choice.plan !== 'free') {
    const query = new URLSearchParams({ settings: 'facturation', plan: choice.plan, interval: choice.interval });
    if (choice.credits && Number.isFinite(choice.credits)) query.set('credits', String(Math.round(choice.credits)));
    destination = `/dashboard.html?${query.toString()}`;
  }
  return signedIn ? destination : `/auth.html?mode=signup&redirect=${encodeURIComponent(destination)}`;
}

/** The paid offer a link asked for, or null. The free plan needs no payment step. */
export function readPlanChoice(search: string): (PlanChoice & { plan: PaidPlan }) | null {
  const params = new URLSearchParams(search);
  const plan = params.get('plan');
  if (plan !== 'pro' && plan !== 'business') return null;
  const credits = Number(params.get('credits'));
  return {
    plan,
    interval: params.get('interval') === 'annual' ? 'annual' : 'monthly',
    ...(Number.isFinite(credits) && credits > 0 ? { credits: Math.round(credits) } : {}),
  };
}

/** Whether the link opens the billing settings at all (`?settings=facturation`). */
export function wantsBillingSettings(search: string): boolean {
  const value = new URLSearchParams(search).get('settings');
  return value === 'facturation' || value === 'billing';
}

/** The payment provider's return, from `?billing=`. */
export function readBillingReturn(search: string): BillingReturn | null {
  const value = new URLSearchParams(search).get('billing');
  return value === 'success' || value === 'cancelled' || value === 'topup-success' || value === 'topup-cancelled' ? value : null;
}

/** The URL without the parameters this module consumed, so a reload does not replay them. */
export function withoutPlanParams(href: string): string {
  const url = new URL(href);
  for (const key of ['settings', 'plan', 'credits', 'interval', 'billing']) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The signed-in account's plan key, or null for a visitor or an unreachable wallet. */
export async function fetchCurrentPlan(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const token = storedAccessToken();
  if (!token) return null;
  try {
    const response = await fetchImpl('/api/billing/wallet', { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (!response.ok) return null;
    const data = await response.json() as { plan?: string | { key?: string } | null; planKey?: string };
    const plan = typeof data?.plan === 'string' ? data.plan : data?.plan?.key || data?.planKey;
    return plan ? String(plan) : null;
  } catch {
    return null;
  }
}
