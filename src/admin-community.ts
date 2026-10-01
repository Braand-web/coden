/**
 * Admin → Communauté: the kill switches, the numbers (apps by state, time to appear, refusals and why, reports, removals,
 * remixes, paid accounts that add apps, upgrades from the Community), the listings with the right to remove or restore,
 * the contestations, and the decision journal. Every action is audited on the server.
 */
import { apiFetch } from './lib/api';
import { confirmDialog, toast } from './lib/ui-feedback';

type Row = Record<string, any>;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const when = (value: unknown) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
};
const pct = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)} %`);
const STATUS: Record<string, string> = { pending: 'En contrôle', online: 'En ligne', needs_fix: 'À corriger', refused: 'Refusé', removed_by_user: 'Retiré par l’utilisateur', removed_by_moderation: 'Retiré par la modération', hidden: 'Masqué' };
const REASONS: Record<string, string> = { illegal: 'Illégal', adult: 'Adulte', hate: 'Haine', scam: 'Arnaque', impersonation: 'Usurpation', copyright: 'Droit d’auteur', privacy: 'Données perso', spam: 'Spam', other: 'Autre' };

export function mountAdminCommunity(root: HTMLElement) {
  let data: Row | null = null;
  let listings: Row[] = [];
  let status = '';
  let error = '';

  const load = async () => {
    try {
      const [overview, rows] = await Promise.all([
        apiFetch<Row>('/api/admin/community'),
        apiFetch<Row>(`/api/admin/community/listings${status ? `?status=${encodeURIComponent(status)}` : ''}`),
      ]);
      data = overview;
      listings = rows.listings || [];
      error = '';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'La Communauté n’a pas pu être chargée.';
    }
    render();
  };

  const act = async (id: string, action: string, reason = '', sanction = false) => {
    try {
      await apiFetch(`/api/admin/community/listings/${id}/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, reason, sanction }) });
      toast('Fait.', 'success');
      await load();
    } catch (caught) { toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error'); }
  };

  const setSwitch = async (key: 'hidden' | 'frozen', value: boolean) => {
    const label = key === 'hidden' ? (value ? 'Masquer toute la Communauté' : 'Rendre la Communauté visible') : (value ? 'Geler les nouveaux listings' : 'Rétablir les nouveaux listings');
    const ok = await confirmDialog({ title: label, body: key === 'hidden' && value ? 'L’entrée de la barre latérale et toutes les pages disparaissent pour tout le monde, immédiatement. Les apps restent publiées.' : 'Cette décision est appliquée tout de suite et journalisée.', confirmLabel: label, danger: value });
    if (!ok) return;
    try {
      await apiFetch('/api/admin/community/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key, value }) });
      await load();
    } catch (caught) { toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error'); }
  };

  const resolveAppeal = async (id: string, decision: 'accepted' | 'declined') => {
    try {
      await apiFetch(`/api/admin/community/appeals/${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
      await load();
    } catch (caught) { toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error'); }
  };

  const tile = (label: string, value: string, hint = '') => `<article class="admin-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong>${hint ? `<span class="metric-note">${escapeHtml(hint)}</span>` : ''}</article>`;

  function render() {
    if (error) { root.innerHTML = `<article class="admin-card full"><p role="alert">${escapeHtml(error)}</p><button type="button" class="admin-button" data-act="reload">Réessayer</button></article>`; bind(); return; }
    if (!data) { root.innerHTML = '<article class="admin-card full"><p class="metric-note">Chargement…</p></article>'; return; }
    const o = data.overview;
    const sw = data.switches || {};
    root.innerHTML = `
      <article class="admin-card full">
        <span class="panel-label">Interrupteurs</span>
        <p class="metric-note">La fonctionnalité est ${sw.enabled ? 'activée' : 'désactivée'} par l’environnement (CODEN_COMMUNITY). Ces deux interrupteurs agissent sans redéploiement.</p>
        <div class="admin-actions">
          <button type="button" class="admin-button${sw.hidden ? ' is-danger' : ''}" data-switch="hidden" data-value="${sw.hidden ? 'false' : 'true'}">${sw.hidden ? 'Communauté masquée — rendre visible' : 'Masquer toute la Communauté'}</button>
          <button type="button" class="admin-button${sw.frozen ? ' is-danger' : ''}" data-switch="frozen" data-value="${sw.frozen ? 'false' : 'true'}">${sw.frozen ? 'Nouveaux listings gelés — rétablir' : 'Geler les nouveaux listings'}</button>
        </div>
      </article>
      ${tile('Apps en ligne', String(o.totals.online), `${o.totals.listings} au total`)}
      ${tile('En contrôle', String(o.totals.pending), `${o.totals.needsFix} à corriger · ${o.totals.refused} refusées`)}
      ${tile('Délai publication → ligne', o.delay.medianMinutes === null ? '—' : `${o.delay.medianMinutes} min`, `p90 ${o.delay.p90Minutes ?? '—'} min · ${o.delay.sample} apps`)}
      ${tile('Signalements ouverts', String(o.reports.open), `${o.reports.upheld} confirmés · ${o.reports.dismissed} écartés`)}
      ${tile('Retraits', `${o.totals.removedByModeration} modération`, `${o.totals.removedByUser} par les créateurs · ${o.totals.hidden} masquées`)}
      ${tile('Remix (30 jours)', String(o.remixes.last30Days))}
      ${tile('Comptes payants qui ajoutent des apps', pct(o.origins.paidShareAdded), `${o.origins.freeAuto} auto (gratuit) · ${o.origins.paidOptIn} par choix`)}
      ${tile('Passages vers un plan payant', String(o.upgradeClicks), 'clics depuis « Mes publications »')}
      ${tile('Qualité moyenne', o.quality.average === null ? '—' : `${o.quality.average}/100`, `${o.quality.featured} « Choix de Coden »`)}
      <article class="admin-card">
        <span class="panel-label">Pourquoi des apps ne sont pas listées</span>
        ${o.refusals.length ? `<ul class="admin-list">${o.refusals.map((item: Row) => `<li><code>${escapeHtml(item.code)}</code> — ${item.count}</li>`).join('')}</ul>` : '<p class="metric-note">Aucun refus.</p>'}
      </article>
      <article class="admin-card">
        <span class="panel-label">Signalements par motif</span>
        ${o.reports.byReason.length ? `<ul class="admin-list">${o.reports.byReason.map((item: Row) => `<li>${escapeHtml(REASONS[item.reason] || item.reason)} — ${item.count}</li>`).join('')}</ul>` : '<p class="metric-note">Aucun signalement.</p>'}
      </article>
      <article class="admin-card full">
        <span class="panel-label">Contestations ouvertes (${(data.appeals || []).length})</span>
        ${(data.appeals || []).length ? `<ul class="admin-list">${data.appeals.map((appeal: Row) => `<li><div>${escapeHtml(appeal.message)}</div><small class="metric-note">${when(appeal.created_at)} · annonce ${escapeHtml(String(appeal.listing_id).slice(0, 8))}</small>
          <div class="admin-actions"><button type="button" class="admin-button" data-appeal="${escapeHtml(appeal.id)}" data-decision="accepted">Accepter</button><button type="button" class="admin-button" data-appeal="${escapeHtml(appeal.id)}" data-decision="declined">Refuser</button></div></li>`).join('')}</ul>` : '<p class="metric-note">Aucune.</p>'}
      </article>
      <article class="admin-card full">
        <span class="panel-label">Annonces</span>
        <label>Statut <select data-filter="status"><option value="">Tous</option>${Object.entries(STATUS).map(([key, label]) => `<option value="${key}"${status === key ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Titre</th><th>Statut</th><th>Origine</th><th>Qualité</th><th>Signal.</th><th>Mise à jour</th><th></th></tr></thead><tbody>
        ${listings.map(row => `<tr><td>${escapeHtml(row.title)}</td><td>${escapeHtml(STATUS[row.status] || row.status)}${row.status_code ? `<br><small class="metric-note"><code>${escapeHtml(row.status_code)}</code></small>` : ''}</td><td>${row.origin === 'free_auto' ? 'Gratuit (auto)' : 'Choix payant'}</td><td>${row.quality_score ?? '—'}</td><td>${row.report_count || 0}</td><td>${when(row.updated_at)}</td>
          <td><div class="admin-actions">
            ${row.status === 'removed_by_moderation' || row.status === 'refused' || row.status === 'needs_fix' ? `<button type="button" class="admin-button" data-row="${row.id}" data-action="restore">Rétablir</button>` : `<button type="button" class="admin-button is-danger" data-row="${row.id}" data-action="remove">Retirer</button>`}
            ${row.status === 'online' ? `<button type="button" class="admin-button" data-row="${row.id}" data-action="${row.featured ? 'unfeature' : 'feature'}">${row.featured ? 'Ne plus mettre en avant' : 'Mettre en avant'}</button>` : ''}
            ${row.report_count ? `<button type="button" class="admin-button" data-row="${row.id}" data-action="dismiss_reports">Écarter les signalements</button>` : ''}
          </div></td></tr>`).join('') || '<tr><td colspan="7" class="metric-note">Aucune annonce.</td></tr>'}
        </tbody></table></div>
      </article>
      <article class="admin-card full">
        <span class="panel-label">Journal des décisions (100 dernières)</span>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Quand</th><th>Qui</th><th>Quoi</th><th>Pourquoi</th></tr></thead><tbody>
        ${(data.events || []).map((event: Row) => `<tr><td>${when(event.created_at)}</td><td>${escapeHtml(event.actor_type)}</td><td>${escapeHtml(event.event)}${event.to_status ? ` → ${escapeHtml(STATUS[event.to_status] || event.to_status)}` : ''}</td><td>${escapeHtml(event.reason || event.code || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="metric-note">Rien pour l’instant.</td></tr>'}
        </tbody></table></div>
      </article>`;
    bind();
  }

  function bind() {
    root.querySelector('[data-act="reload"]')?.addEventListener('click', () => { void load(); });
    root.querySelectorAll<HTMLButtonElement>('[data-switch]').forEach(button => button.addEventListener('click', () => { void setSwitch(button.dataset.switch as 'hidden' | 'frozen', button.dataset.value === 'true'); }));
    root.querySelectorAll<HTMLButtonElement>('[data-appeal]').forEach(button => button.addEventListener('click', () => { void resolveAppeal(button.dataset.appeal!, button.dataset.decision as 'accepted' | 'declined'); }));
    root.querySelector<HTMLSelectElement>('[data-filter="status"]')?.addEventListener('change', event => { status = (event.target as HTMLSelectElement).value; void load(); });
    root.querySelectorAll<HTMLButtonElement>('[data-row]').forEach(button => button.addEventListener('click', async () => {
      const action = button.dataset.action!;
      if (action === 'remove') {
        const reason = window.prompt('Motif du retrait (envoyé au créateur) :', 'Contenu non conforme aux règles de la Communauté.');
        if (reason === null) return;
        const sanction = await confirmDialog({ title: 'Appliquer une sanction ?', body: 'Un avertissement, puis une suspension de 7 jours, puis une exclusion de la Communauté. L’app et le compte ne sont pas touchés.', confirmLabel: 'Retirer avec sanction', cancelLabel: 'Retirer sans sanction' });
        void act(button.dataset.row!, 'remove', reason, sanction);
        return;
      }
      void act(button.dataset.row!, action);
    }));
  }

  return { load };
}
