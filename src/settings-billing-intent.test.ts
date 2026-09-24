// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The dashboard reached from "Choisir Pro": Billing opens on the chosen
 * offer, preselected, with one button that states what will be paid.
 */
const apiFetch = vi.fn();
vi.mock('./lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
vi.mock('./lib/supabase-browser', () => ({ refreshVerifiedSession: vi.fn(), signOutCurrentDevice: vi.fn(), getVerifiedSession: vi.fn(async () => null) }));

const catalog = {
  plans: [{ key: 'pro', name: 'Pro', capabilities: [] }, { key: 'business', name: 'Business', capabilities: [] }],
  prices: [100, 200].flatMap(credits => (['monthly', 'annual'] as const).flatMap(interval => (['pro', 'business'] as const).map(plan => ({
    plan, credits, interval, currency: 'XAF',
    amount: (plan === 'pro' ? 150 : 300) * credits * (interval === 'annual' ? 12 * 0.8 : 1),
    monthlyEquivalent: (plan === 'pro' ? 150 : 300) * credits * (interval === 'annual' ? 0.8 : 1),
  })))),
  topups: [],
};

async function openWith(search: string, walletPlan = 'free') {
  apiFetch.mockImplementation(async (url: string) => {
    if (url === '/api/billing/plans') return { success: true, catalog };
    if (url === '/api/billing/wallet') return { success: true, plan: walletPlan, balance: 5 };
    return { success: true };
  });
  window.history.replaceState(null, '', `/dashboard.html${search}`);
  const panel = await import('./settings-panel');
  expect(panel.openBillingFromUrl(window.location)).toBe(true);
  for (let i = 0; i < 20 && !document.querySelector('[data-billing-plan-grid] .billing-plan-card'); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  return document.querySelector<HTMLElement>('[data-billing-intent]')!;
}

describe('billing reached from an offer button', () => {
  beforeEach(() => { vi.resetModules(); document.body.innerHTML = ''; apiFetch.mockReset(); });

  it('opens on the chosen offer, preselected, with the amount on the pay button', async () => {
    const intent = await openWith('?settings=facturation&plan=pro&credits=200&interval=annual');
    expect(intent.hidden).toBe(false);
    expect(intent.textContent).toContain('Vous avez choisi Pro');
    expect(intent.textContent).toContain('200 crédits par mois');
    const pay = intent.querySelector<HTMLButtonElement>('[data-billing-checkout="pro"]')!;
    expect(pay.textContent).toMatch(/Payer Pro — .*\/ an/);
    expect(document.querySelector<HTMLSelectElement>('[data-billing-tier="pro"]')!.value).toBe('200');
    expect(window.location.search).toBe('');
  });

  it('says so when the offer is already the account\'s plan, instead of selling it twice', async () => {
    const intent = await openWith('?settings=facturation&plan=pro&credits=100', 'pro');
    expect(intent.textContent).toContain('Pro est déjà votre forfait');
    expect(intent.querySelector('[data-billing-checkout]')).toBeNull();
  });

  it('reports the payment page\'s answer on return', async () => {
    const intent = await openWith('?billing=cancelled');
    expect(intent.textContent).toContain('Paiement annulé');
    expect(intent.textContent).toContain('Aucun montant');
  });
});
