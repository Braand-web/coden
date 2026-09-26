/**
 * Admin → Tarifs: the active pricing grid, its profitability offer by offer,
 * the v3 grid measured beside the current one, and versioned changes.
 *
 * A change is a draft (the whole JSON, validated by the server), then an
 * explicit activation; activated versions are never edited, only replaced.
 */
import { apiFetch, ApiError } from './lib/api';
import { confirmDialog, toast } from './lib/ui-feedback';

type Row = Record<string, any>;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const date = (value: unknown) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
};
const usd = (value: unknown, digits = 2) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) })} $` : '—';
};
const percent = (value: unknown) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 1000) / 10} %`);

const PLAN_LABELS: Record<string, string> = { free: 'Gratuit', pro: 'Pro', pro_plus: 'Pro+', business: 'Business', enterprise: 'Enterprise' };
const OFFER_LABELS: Record<string, string> = { monthly: 'Mensuel', annual: 'Annuel', topup: 'Recharge' };
const CATEGORY_LABELS: Record<string, string> = { build: 'Build', chat: 'Chat', app_ai: 'IA des apps', connectors: 'Connecteurs' };
const STATUS: Record<string, [string, string]> = { active: ['ok', 'Active'], draft: ['warning', 'Brouillon'], archived: ['disabled', 'Archivée'] };

/** "20 $" with the FCFA amount in superscript, as on the public pages. */
function price(value: unknown, config: Row | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  const rate = Number(config?.currency?.secondary_per_usd) || 600;
  const exact = amount * rate;
  const step = exact >= 1_000 ? Number(config?.currency?.display_round_secondary) || 100 : 5;
  const secondary = Math.round(exact / step) * step;
  return `${escapeHtml(usd(amount, Number.isInteger(amount) ? 0 : 2))}<sup class="admin-fcfa">${escapeHtml(secondary.toLocaleString('fr-FR'))} ${escapeHtml(config?.currency?.secondary_label || 'FCFA')}</sup>`;
}

function table(headers: string[], rows: string[][], empty: string, endColumns: number[] = []) {
  if (!rows.length) return `<p class="metric-note">${escapeHtml(empty)}</p>`;
  const cell = (index: number) => (endColumns.includes(index) ? ' class="is-end"' : '');
  return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr>${headers.map((header, index) => `<th${cell(index)}>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((value, index) => `<td${cell(index)}>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function mountAdminPricing(root: HTMLElement) {
  let data: Row | null = null;
  let observation: Row | null = null;
  let error = '';
  let draftText = '';
  let draftErrors: string[] = [];
  let busy = false;

  const load = async () => {
    error = '';
    try {
      const [pricing, observed] = await Promise.all([
        apiFetch<Row>('/api/admin/billing/pricing'),
        apiFetch<Row>('/api/admin/billing/pricing/observation?days=30').catch(() => null),
      ]);
      data = pricing;
      observation = observed;
      if (!draftText) draftText = JSON.stringify(pricing.active?.config || pricing.defaults || {}, null, 2);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Les tarifs n’ont pas pu être chargés.';
    }
    render();
  };

  const render = () => {
    if (error) {
      root.innerHTML = `<article class="admin-card full"><span class="panel-label">Tarifs</span><p class="metric-note">${escapeHtml(error)}</p><button class="admin-button" type="button" data-pricing-reload>Réessayer</button></article>`;
      return;
    }
    if (!data) {
      root.innerHTML = '<article class="admin-card full"><span class="panel-label">Tarifs</span><p class="metric-note">Chargement…</p></article>';
      return;
    }
    const active = data.active as Row | null;
    const config = (active?.config || data.defaults) as Row;
    const report = active?.profitability as Row | null;
    const versions = (data.versions || []) as Row[];
    const lowest = report?.rows?.length ? Math.min(...report.rows.map((row: Row) => Number(row.price_per_credit_usd))) : null;
    const plans = Object.entries(config.plans || {}) as Array<[string, Row]>;

    root.innerHTML = `
      ${data.available === false ? '<article class="admin-card full admin-alert"><span>La table des versions de tarifs n’existe pas encore dans la base : la grille par défaut s’applique. Appliquez la migration de facturation v3.</span></article>' : ''}
      <div class="admin-metric-row">
        <article class="admin-card"><span class="panel-label">Version active</span><strong class="metric-value">${active ? `v${escapeHtml(active.version)}` : 'Par défaut'}</strong><span class="metric-note">${active ? `Activée le ${escapeHtml(date(active.activated_at))}${active.activated_by ? ` par ${escapeHtml(active.activated_by)}` : ''}` : 'Aucune version enregistrée'}</span></article>
        <article class="admin-card"><span class="panel-label">Coût réel maximal par crédit</span><strong class="metric-value">${escapeHtml(usd(report?.max_cost_per_credit_usd, 4))}</strong><span class="metric-note">${percent(config.credit?.max_cost_ratio)} du prix de crédit le plus bas (${lowest === null ? '—' : escapeHtml(usd(lowest, 3))})</span></article>
        <article class="admin-card"><span class="panel-label">Frais du fournisseur</span><strong class="metric-value">${percent(config.credit?.provider_fee_rate)}</strong><span class="metric-note">Ajoutés au coût OpenRouter avant conversion en crédits</span></article>
        <article class="admin-card"><span class="panel-label">Taux FCFA</span><strong class="metric-value">${escapeHtml(config.currency?.secondary_per_usd)} ${escapeHtml(config.currency?.secondary_label || 'FCFA')}</strong><span class="metric-note">pour 1 $ (${escapeHtml(config.currency?.secondary || 'XAF')}), affiché en exposant</span></article>
      </div>

      <article class="admin-card full">
        <div class="admin-panel-head"><div><span class="panel-label">Forfaits</span><p class="metric-note">Prix publics de la version active. Crédits quotidiens valables pour ${config.daily_credits_scope === 'agent' ? 'le Build et le Chat' : 'le Build'}.</p></div></div>
        ${table(['Forfait', 'Mensuel', 'Annuel (par mois)', 'Crédits / mois', 'Quotidiens', 'Recharge (par crédit)'], plans.map(([key, plan]) => [
          `<strong>${escapeHtml(plan.label || PLAN_LABELS[key] || key)}</strong>${plan.per_seat ? ' <span class="metric-note">par siège</span>' : ''}${plan.custom ? ' <span class="metric-note">sur devis</span>' : ''}`,
          plan.custom ? 'Sur devis' : plan.monthly_usd === null ? '—' : price(plan.monthly_usd, config),
          plan.annual_monthly_usd ? price(plan.annual_monthly_usd, config) : '—',
          escapeHtml(plan.monthly_credits || (plan.signup_credits ? `${plan.signup_credits} à l’inscription` : '—')),
          escapeHtml(plan.daily_credits ? `${plan.daily_credits} / jour${plan.daily_credits_monthly_cap ? ` (max ${plan.daily_credits_monthly_cap} / mois)` : ''}` : '—'),
          plan.topup_price_usd ? price(plan.topup_price_usd, config) : '—',
        ]), 'Aucun forfait.', [1, 2, 3, 5])}
      </article>

      <article class="admin-card full">
        <div class="admin-panel-head"><div><span class="panel-label">Rentabilité par offre</span><p class="metric-note">Part du prix payé que coûte un crédit consommé au plafond de conversion. Règle : au plus ${percent(report?.limit ?? config.credit?.max_cost_ratio)}. La seconde colonne ajoute les crédits quotidiens du mois, offerts.</p></div></div>
        ${table(['Forfait', 'Offre', 'Prix par crédit', 'Coût / prix', 'Avec quotidiens', 'Règle'], (report?.rows || []).map((row: Row) => [
          escapeHtml(PLAN_LABELS[row.plan] || row.plan),
          escapeHtml(OFFER_LABELS[row.kind] || row.kind),
          price(Math.round(Number(row.price_per_credit_usd) * 1000) / 1000, config),
          escapeHtml(percent(row.cost_ratio)),
          `<span class="${row.cost_ratio_with_daily !== null && row.cost_ratio_with_daily > 0.8 ? 'admin-negative' : ''}">${escapeHtml(percent(row.cost_ratio_with_daily))}</span>`,
          row.ok ? '<span class="status-pill ok">Respectée</span>' : '<span class="status-pill failed">Dépassée</span>',
        ]), 'Aucune offre payante dans cette version.', [2, 3, 4])}
      </article>

      <article class="admin-card full">
        <div class="admin-panel-head"><div><span class="panel-label">Observation v3 (30 jours)</span><p class="metric-note">La grille v3 mesure chaque appel au coût réel sans rien facturer : elle est comparée ici à ce que la grille actuelle a facturé. Un coût par crédit au-dessus du plafond (${escapeHtml(usd(observation?.max_cost_per_credit_usd ?? report?.max_cost_per_credit_usd, 4))}) signale une perte.</p></div></div>
        ${observation?.available === false
          ? '<p class="metric-note">La mesure v3 démarre après la migration : aucune donnée pour le moment.</p>'
          : table(['Catégorie', 'Appels', 'Coût fournisseur', 'Crédits facturés (actuel)', 'Crédits v3', 'Coût par crédit (actuel)', 'Coût par crédit (v3)'], ((observation?.rows || []) as Row[]).map(row => {
            const limit = Number(observation?.max_cost_per_credit_usd) || Infinity;
            const flag = (value: unknown) => `<span class="${Number(value) > limit ? 'admin-negative' : ''}">${escapeHtml(value === null ? '—' : usd(value, 4))}</span>`;
            return [
              escapeHtml(CATEGORY_LABELS[row.category] || row.category),
              escapeHtml(Number(row.events).toLocaleString('fr-FR')),
              escapeHtml(usd(row.provider_cost_usd, 4)),
              escapeHtml(Number(row.v2_credits).toLocaleString('fr-FR')),
              escapeHtml(Number(row.v3_credits).toLocaleString('fr-FR')),
              flag(row.v2_cost_per_credit_usd),
              flag(row.v3_cost_per_credit_usd),
            ];
          }), 'Aucun appel mesuré sur la période.', [1, 2, 3, 4, 5, 6])}
        ${observation?.truncated ? '<p class="metric-note">Les 5 000 derniers appels seulement.</p>' : ''}
      </article>

      <article class="admin-card full">
        <div class="admin-panel-head"><div><span class="panel-label">Versions</span><p class="metric-note">Une version activée n’est jamais modifiée : elle est archivée quand une autre la remplace. Toute action est inscrite au journal d’audit.</p></div></div>
        ${table(['Version', 'Statut', 'Motif', 'Créée', 'Activée', 'Actions'], versions.map(version => {
          const [tone, label] = STATUS[version.status] || ['warning', version.status];
          const actions = [
            `<button class="admin-button subtle" type="button" data-pricing-load="${escapeHtml(version.id)}">Copier dans l’éditeur</button>`,
            version.status === 'draft' && version.valid ? `<button class="admin-button primary" type="button" data-pricing-activate="${escapeHtml(version.id)}" data-version="${escapeHtml(version.version)}">Activer</button>` : '',
            version.status === 'draft' ? `<button class="admin-button subtle is-danger" type="button" data-pricing-delete="${escapeHtml(version.id)}" data-version="${escapeHtml(version.version)}">Supprimer</button>` : '',
          ].filter(Boolean).join(' ');
          return [
            `<strong>v${escapeHtml(version.version)}</strong>`,
            `<span class="status-pill ${tone}">${escapeHtml(label)}</span>${version.valid ? '' : ' <span class="status-pill failed">Invalide</span>'}`,
            escapeHtml(version.note || '—'),
            `${escapeHtml(date(version.created_at))}${version.created_by ? `<br><small class="metric-note">${escapeHtml(version.created_by)}</small>` : ''}`,
            escapeHtml(date(version.activated_at)),
            `<div class="admin-pricing-actions">${actions}</div>`,
          ];
        }), 'Aucune version enregistrée.')}
      </article>

      <article class="admin-card full">
        <form class="admin-pricing-editor" data-pricing-form>
          <div class="admin-panel-head"><div><span class="panel-label">Nouveau brouillon</span><p class="metric-note">La grille complète au format JSON. Le serveur la vérifie entièrement (forfaits, prix annuels, paliers, règle de rentabilité) avant de l’enregistrer ; elle ne s’applique qu’après activation.</p></div></div>
          <label class="admin-sr-only" for="admin-pricing-json">Configuration JSON</label>
          <textarea id="admin-pricing-json" name="config" spellcheck="false" rows="18">${escapeHtml(draftText)}</textarea>
          ${draftErrors.length ? `<ul class="admin-pricing-errors" role="alert">${draftErrors.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
          <div class="admin-alert-form">
            <label class="admin-grant-reason">Motif de la modification<input name="note" type="text" minlength="3" maxlength="300" required placeholder="Baisse du prix de la recharge Pro"></label>
            <button class="admin-button subtle" type="button" data-pricing-reset>Repartir de la version active</button>
            <button class="admin-button primary" type="submit" ${busy ? 'disabled' : ''}>Enregistrer le brouillon</button>
          </div>
        </form>
      </article>`;
  };

  root.addEventListener('input', event => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLTextAreaElement && target.name === 'config') draftText = target.value;
  });

  root.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !data) return;
    if (button.hasAttribute('data-pricing-reload')) { void load(); return; }
    if (button.hasAttribute('data-pricing-reset')) {
      draftText = JSON.stringify(data.active?.config || data.defaults || {}, null, 2);
      draftErrors = [];
      render();
      return;
    }
    const loadId = button.dataset.pricingLoad;
    if (loadId) {
      const version = (data.versions || []).find((item: Row) => item.id === loadId);
      if (version) {
        draftText = JSON.stringify(version.config, null, 2);
        draftErrors = [];
        render();
        root.querySelector<HTMLTextAreaElement>('#admin-pricing-json')?.focus();
      }
      return;
    }
    const activateId = button.dataset.pricingActivate;
    if (activateId) {
      const version = (data.versions || []).find((item: Row) => item.id === activateId);
      const failing = (version?.profitability?.rows || []).filter((row: Row) => !row.ok).length;
      const ok = await confirmDialog({
        title: `Activer la version v${button.dataset.version} ?`,
        body: `Elle remplace la grille active pour tous les utilisateurs, en moins d’une minute. La version actuelle est archivée et reste consultable.${failing ? ` Attention : ${failing} offre(s) dépassent la règle de rentabilité.` : ''}`,
        confirmLabel: 'Activer',
        danger: failing > 0,
      });
      if (!ok) return;
      button.disabled = true;
      try {
        await apiFetch(`/api/admin/billing/pricing/${encodeURIComponent(activateId)}/activate`, { method: 'POST', body: '{}' });
        toast(`Version v${button.dataset.version} activée.`, 'success');
        void load();
      } catch (caught) {
        button.disabled = false;
        toast(caught instanceof Error ? caught.message : 'Activation impossible.', 'error');
      }
      return;
    }
    const deleteId = button.dataset.pricingDelete;
    if (deleteId) {
      if (!(await confirmDialog({ title: `Supprimer le brouillon v${button.dataset.version} ?`, body: 'Seul un brouillon peut être supprimé ; la suppression est inscrite au journal d’audit.', confirmLabel: 'Supprimer', danger: true }))) return;
      button.disabled = true;
      try {
        await apiFetch(`/api/admin/billing/pricing/${encodeURIComponent(deleteId)}`, { method: 'DELETE' });
        toast('Brouillon supprimé.', 'success');
        void load();
      } catch (caught) {
        button.disabled = false;
        toast(caught instanceof Error ? caught.message : 'Suppression impossible.', 'error');
      }
    }
  });

  root.addEventListener('submit', async event => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-pricing-form]');
    if (!form) return;
    event.preventDefault();
    const note = String(new FormData(form).get('note') || '').trim();
    let config: unknown;
    try {
      config = JSON.parse(draftText);
    } catch (caught) {
      draftErrors = [`JSON invalide : ${caught instanceof Error ? caught.message : 'syntaxe'}`];
      render();
      return;
    }
    busy = true;
    draftErrors = [];
    render();
    try {
      const result = await apiFetch<Row>('/api/admin/billing/pricing/drafts', { method: 'POST', body: JSON.stringify({ config, note }) });
      busy = false;
      toast(`Brouillon v${result.draft?.version} enregistré. Vérifiez sa rentabilité puis activez-le.`, 'success');
      void load();
    } catch (caught) {
      busy = false;
      const payload = caught instanceof ApiError ? (caught.payload as Row | null) : null;
      draftErrors = Array.isArray(payload?.errors) ? payload!.errors.map(String) : [caught instanceof Error ? caught.message : 'Enregistrement impossible.'];
      render();
      const noteInput = root.querySelector<HTMLInputElement>('input[name="note"]');
      if (noteInput) noteInput.value = note;
    }
  });

  render();
  return { load };
}
