/** Read-only view of the canonical catalogue and immutable financial ledger. */
import { apiFetch } from './lib/api';

type CatalogResponse = {
  version: string;
  readonly: boolean;
  balance: number;
  catalog: { prices: { plan: string; credits: number; interval: string; amount: number }[] };
  transactions: { account_id: string; entry_type: string; amount_credits: number; balance_after: number; created_at: string }[];
};
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const number = (value: unknown) => Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 8 });

export function mountAdminPricing(root: HTMLElement) {
  let loading = false;
  const load = async () => {
    if (loading) return;
    loading = true;
    root.innerHTML = '<article class="admin-card full"><span class="panel-label">Facturation</span><p class="metric-note">Chargement…</p></article>';
    try {
      const data = await apiFetch<CatalogResponse>('/api/admin/billing/catalog');
      root.innerHTML = `<article class="admin-card full">
        <span class="panel-label">Catalogue canonique · Lecture seule</span>
        <h2>Free, Pro et Business</h2><p class="metric-note">${escape(data.version)} · ${escape(number(data.balance))} crédits disponibles au total</p>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Plan</th><th>Crédits</th><th>Période</th><th>Prix FCFA</th></tr></thead><tbody>
        ${data.catalog.prices.map(row => `<tr><td>${escape(row.plan)}</td><td>${escape(number(row.credits))}</td><td>${escape(row.interval)}</td><td>${escape(number(row.amount))}</td></tr>`).join('')}
        </tbody></table></div>
        <p class="metric-note">Les tarifs proviennent du catalogue versionné. Aucun éditeur de grille parallèle.</p>
      </article><article class="admin-card full"><span class="panel-label">Dernières transactions</span>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Date</th><th>Compte</th><th>Type</th><th>Crédits</th><th>Solde</th></tr></thead><tbody>
        ${data.transactions.map(row => `<tr><td>${escape(row.created_at)}</td><td>${escape(row.account_id)}</td><td>${escape(row.entry_type)}</td><td>${escape(number(row.amount_credits))}</td><td>${escape(number(row.balance_after))}</td></tr>`).join('')}
        </tbody></table></div>${data.transactions.length ? '' : '<p class="metric-note">Aucune transaction.</p>'}
        <button type="button" class="admin-button" data-pricing-reload>Actualiser</button>
      </article>`;
    } catch {
      root.innerHTML = '<article class="admin-card full"><span class="panel-label">Facturation</span><p class="metric-note">Le registre est temporairement indisponible. Les tarifs n’ont pas été modifiés.</p><button class="admin-button" type="button" data-pricing-reload>Réessayer</button></article>';
    } finally { loading = false; }
  };
  root.addEventListener('click', event => {
    if ((event.target as Element | null)?.closest('[data-pricing-reload]')) void load();
  });
  return { load };
}
