// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRICING_CONFIG, profitabilityReport } from './services/billing/pricing-config';

/* Admin → Tarifs: the grid in $ with FCFA, profitability, observation, drafts. */
const apiFetch = vi.fn();
class ApiError extends Error {
  constructor(message: string, public status: number, public payload: unknown) { super(message); }
}
vi.mock('./lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError }));
vi.mock('./lib/ui-feedback', () => ({ toast: vi.fn(), confirmDialog: vi.fn(async () => true) }));

const { mountAdminPricing } = await import('./admin-pricing');

const active = { id: '00000000-0000-4000-8000-000000000001', version: 1, status: 'active', config: DEFAULT_PRICING_CONFIG, note: '<img src=x onerror=alert(1)>', created_at: '2026-09-26T10:00:00Z', activated_at: '2026-09-26T10:00:00Z', valid: true, profitability: profitabilityReport(DEFAULT_PRICING_CONFIG) };

describe('admin pricing', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('shows plans in dollars with FCFA in superscript, escapes notes and flags daily credits', async () => {
    apiFetch.mockImplementation(async (path: string) => path.includes('observation')
      ? { available: true, max_cost_per_credit_usd: 0.0576, rows: [{ category: 'build', events: 3, provider_cost_usd: 0.3, v2_credits: 3, v3_credits: 5.5, v2_cost_per_credit_usd: 0.1, v3_cost_per_credit_usd: 0.0545 }] }
      : { available: true, active, versions: [active], defaults: DEFAULT_PRICING_CONFIG });
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    expect(root.textContent).toContain('v1');
    expect(root.querySelector('sup.admin-fcfa')?.textContent).toMatch(/FCFA/);
    expect(root.textContent).toMatch(/20 \$12\s000 FCFA/u);
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    // The current grid costs 0.10 $ per credit on Build: above the ceiling, flagged.
    expect(root.querySelectorAll('.admin-negative').length).toBeGreaterThan(0);
    expect(root.querySelector('[data-pricing-activate]')).toBeNull();
  });

  it('keeps the draft and lists the server validation errors', async () => {
    apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new ApiError('Configuration invalide.', 400, { errors: ['plans.pro.monthly_usd : nombre attendu'] });
      return path.includes('observation') ? { available: false } : { available: true, active, versions: [active], defaults: DEFAULT_PRICING_CONFIG };
    });
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    const textarea = root.querySelector<HTMLTextAreaElement>('#admin-pricing-json')!;
    textarea.value = '{"schema_version":"1"}';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector<HTMLInputElement>('input[name="note"]')!.value = 'Essai';
    root.querySelector<HTMLFormElement>('[data-pricing-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('.admin-pricing-errors')?.textContent).toContain('monthly_usd'));
    expect(root.querySelector<HTMLTextAreaElement>('#admin-pricing-json')!.value).toBe('{"schema_version":"1"}');
    expect(root.querySelector<HTMLInputElement>('input[name="note"]')!.value).toBe('Essai');
    const [, options] = apiFetch.mock.calls.find(([path]) => path === '/api/admin/billing/pricing/drafts')!;
    expect(JSON.parse(String(options.body))).toEqual({ config: { schema_version: '1' }, note: 'Essai' });
  });

  it('rejects malformed JSON without calling the server', async () => {
    apiFetch.mockResolvedValue({ available: true, active, versions: [active], defaults: DEFAULT_PRICING_CONFIG });
    const root = document.getElementById('root')!;
    await mountAdminPricing(root).load();
    const textarea = root.querySelector<HTMLTextAreaElement>('#admin-pricing-json')!;
    textarea.value = '{ oops';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const calls = apiFetch.mock.calls.length;
    root.querySelector<HTMLFormElement>('[data-pricing-form]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(root.querySelector('.admin-pricing-errors')?.textContent).toContain('JSON invalide');
    expect(apiFetch.mock.calls.length).toBe(calls);
  });
});
