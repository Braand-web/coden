// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { publicBillingCatalog } from './config/billing-v2';
const apiFetch = vi.fn();
vi.mock('./lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
const { mountAdminPricing } = await import('./admin-pricing');
describe('canonical billing admin', () => {
  beforeEach(() => { apiFetch.mockReset(); document.body.innerHTML = '<div id="root"></div>'; });
  it('reads only the canonical catalogue and ledger, with no mutation controls', async () => {
    apiFetch.mockResolvedValue({ version: 'canonical', readonly: true, balance: 5, catalog: publicBillingCatalog(), transactions: [] });
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    expect(apiFetch).toHaveBeenCalledWith('/api/admin/billing/catalog');
    expect(root.textContent).toContain('Lecture seule');
    expect(root.textContent).toMatch(/5\s000/);
    expect(root.querySelector('form, textarea, [data-pricing-activate]')).toBeNull();
    expect(root.textContent).not.toContain('Pro+');
  });
  it('escapes all ledger fields', async () => {
    apiFetch.mockResolvedValue({ version: '<img src=x>', readonly: true, balance: 5, catalog: publicBillingCatalog(), transactions: [{ account_id: '<img src=x onerror=alert(1)>', entry_type: 'usage', amount_credits: -0.5, balance_after: 4.5, created_at: '2026-10-03' }] });
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x');
  });
  it('shows an outage without replacing the catalogue or proposing a top-up', async () => {
    apiFetch.mockRejectedValue(new Error('private detail'));
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    expect(root.textContent).toContain('temporairement indisponible');
    expect(root.textContent).not.toContain('private detail');
    expect(root.querySelector('[data-pricing-reload]')).not.toBeNull();
  });
});
