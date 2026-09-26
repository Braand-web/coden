/**
 * Admin → Suggestions: what members ask for, ranked by support, with the
 * moderation queue. Statuses notify the author and the voters; a team reply
 * carries the "Équipe" badge on the public page. Every action is audited.
 */
import { apiFetch } from './lib/api';
import { confirmDialog, toast } from './lib/ui-feedback';
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, type FeedbackStatus } from './services/feedback/feedback-core';

type Row = Record<string, any>;

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const date = (value: unknown) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
};
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const TONE: Record<string, string> = { new: 'warning', under_review: 'warning', planned: 'ok', in_progress: 'ok', done: 'ok', declined: 'disabled', duplicate: 'disabled' };

/** Support, as the team reads it: votes, paying voters counted twice, replies half. */
export function supportScore(post: Row): number {
  return Number(post.vote_count || 0) + Number(post.paid_vote_count || 0) + 0.5 * Number(post.comment_count || 0);
}

export function feedbackCsv(rows: Row[]): string {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const head = ['Titre', 'Type', 'Statut', 'Votes', 'Votants payants', 'Réponses', 'Signalements', 'Auteur', 'Créée le'];
  return [head.map(cell).join(','), ...rows.map(post => [post.title, FEEDBACK_TYPES[post.type as 'feature'] || post.type, FEEDBACK_STATUSES[post.status as FeedbackStatus] || post.status, post.vote_count, post.paid_vote_count, post.comment_count, post.report_count, post.author_name, date(post.created_at)].map(cell).join(','))].join('\n');
}

export function mountAdminFeedback(root: HTMLElement) {
  let posts: Row[] = [];
  let reports: Row[] = [];
  let error = '';
  let loaded = false;
  let query = '';
  let type = '';
  let status = 'open';
  let openId: string | null = null;
  let detail: Row | null = null;

  const load = async () => {
    try {
      const data = await apiFetch<Row>('/api/admin/feedback');
      posts = data.posts || [];
      reports = data.reports || [];
      error = '';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Les suggestions n’ont pas pu être chargées.';
    }
    loaded = true;
    render();
  };

  const loadDetail = async (id: string) => {
    try {
      detail = await apiFetch<Row>(`/api/feedback/${encodeURIComponent(id)}`);
    } catch {
      detail = null;
    }
    render();
  };

  const visible = () => posts
    .filter(post => !type || post.type === type)
    .filter(post => !status || (status === 'open' ? ['new', 'under_review', 'planned', 'in_progress'].includes(post.status) : status === 'hidden' ? post.hidden : post.status === status))
    .filter(post => !query || `${post.title} ${post.body} ${post.author_name}`.toLocaleLowerCase('fr').includes(query))
    .sort((a, b) => Number(b.report_count > 0) - Number(a.report_count > 0) || supportScore(b) - supportScore(a));

  const statusSelect = (post: Row) => `<select data-feedback-status="${escapeHtml(post.id)}" aria-label="Statut de « ${escapeHtml(post.title)} »">${(Object.keys(FEEDBACK_STATUSES) as FeedbackStatus[]).filter(value => value !== 'duplicate' || post.status === 'duplicate').map(value => `<option value="${value}"${post.status === value ? ' selected' : ''}${value === 'duplicate' ? ' disabled' : ''}>${escapeHtml(FEEDBACK_STATUSES[value])}</option>`).join('')}</select>`;

  const detailPanel = (post: Row) => {
    if (!detail || detail.post?.id !== post.id) return '<tr class="admin-feedback-detail"><td colspan="7"><p class="metric-note">Chargement…</p></td></tr>';
    const others = posts.filter(item => item.id !== post.id && item.status !== 'duplicate' && !item.hidden).sort((a, b) => supportScore(b) - supportScore(a)).slice(0, 200);
    return `<tr class="admin-feedback-detail"><td colspan="7">
      ${post.body ? `<p class="admin-feedback-body">${escapeHtml(post.body)}</p>` : ''}
      ${detail.post.screenshot_url ? `<a href="${escapeHtml(detail.post.screenshot_url)}" target="_blank" rel="noopener noreferrer" class="admin-link">Voir la capture d’écran</a>` : ''}
      <div class="admin-feedback-thread">
        ${(detail.comments || []).map((comment: Row) => `<div class="admin-feedback-comment${comment.is_team ? ' is-team' : ''}${comment.hidden ? ' is-hidden' : ''}">
          <div><strong>${escapeHtml(comment.author_name)}</strong> ${comment.is_team ? '<span class="status-pill ok">Équipe</span>' : ''} ${comment.hidden ? '<span class="status-pill failed">Masquée</span>' : ''} <small>${escapeHtml(date(comment.created_at))}</small></div>
          <p>${escapeHtml(comment.body)}</p>
          <div class="admin-pricing-actions">
            <button class="admin-button subtle" type="button" data-comment-pin="${escapeHtml(comment.id)}" data-value="${comment.pinned ? 'false' : 'true'}">${comment.pinned ? 'Désépingler' : 'Épingler'}</button>
            <button class="admin-button subtle${comment.hidden ? '' : ' is-danger'}" type="button" data-comment-hide="${escapeHtml(comment.id)}" data-value="${comment.hidden ? 'false' : 'true'}">${comment.hidden ? 'Rétablir' : 'Masquer'}</button>
          </div>
        </div>`).join('') || '<p class="metric-note">Aucune réponse.</p>'}
      </div>
      <form class="admin-alert-form" data-feedback-reply="${escapeHtml(post.id)}">
        <label class="admin-grant-reason">Réponse de l’équipe (publique, badge « Équipe », épinglée)<textarea name="body" rows="3" maxlength="3000" required></textarea></label>
        <button class="admin-button primary" type="submit">Répondre</button>
      </form>
      ${post.status !== 'duplicate' && others.length ? `<form class="admin-alert-form" data-feedback-merge="${escapeHtml(post.id)}">
        <label>Fusionner dans l’originale<select name="target">${others.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title.slice(0, 80))} (${escapeHtml(item.vote_count)} votes)</option>`).join('')}</select></label>
        <button class="admin-button" type="submit">Fusionner comme doublon</button>
      </form>` : ''}
    </td></tr>`;
  };

  const render = () => {
    if (!loaded) { root.innerHTML = '<article class="admin-card full"><span class="panel-label">Suggestions</span><p class="metric-note">Chargement…</p></article>'; return; }
    if (error) { root.innerHTML = `<article class="admin-card full"><span class="panel-label">Suggestions</span><p class="metric-note">${escapeHtml(error)}</p><button class="admin-button" type="button" data-feedback-reload>Réessayer</button></article>`; return; }
    const open = posts.filter(post => ['new', 'under_review', 'planned', 'in_progress'].includes(post.status) && !post.hidden);
    const rows = visible();
    const postTitle = (id: string) => posts.find(post => post.id === id)?.title || 'Suggestion supprimée';
    root.innerHTML = `
      <div class="admin-metric-row">
        <article class="admin-card"><span class="panel-label">Ouvertes</span><strong class="metric-value">${open.length}</strong><span class="metric-note">${plural(open.filter(post => post.type === 'bug').length, 'bug')} · ${plural(open.filter(post => post.type === 'feature').length, 'idée')}</span></article>
        <article class="admin-card"><span class="panel-label">Nouvelles à trier</span><strong class="metric-value">${posts.filter(post => post.status === 'new' && !post.hidden).length}</strong><span class="metric-note">Statut « Nouveau »</span></article>
        <article class="admin-card"><span class="panel-label">Signalements</span><strong class="metric-value">${reports.length}</strong><span class="metric-note">En attente de modération</span></article>
        <article class="admin-card"><span class="panel-label">Livrées</span><strong class="metric-value">${posts.filter(post => post.status === 'done').length}</strong><span class="metric-note">Auteurs et votants notifiés</span></article>
      </div>
      ${reports.length ? `<article class="admin-card full">
        <div class="admin-panel-head"><div><span class="panel-label">À modérer</span><p class="metric-note">Contenus signalés par les membres. Masquer retire le contenu du tableau public ; ignorer clôt le signalement.</p></div></div>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Contenu</th><th>Motif</th><th>Signalé</th><th>Actions</th></tr></thead><tbody>
        ${reports.map(report => `<tr>
          <td>${report.comment ? `Réponse de <strong>${escapeHtml(report.comment.author_name)}</strong> : ${escapeHtml(report.comment.body)}` : `Suggestion : <strong>${escapeHtml(postTitle(report.post_id))}</strong>`}</td>
          <td>${escapeHtml(report.reason || '—')}</td>
          <td>${escapeHtml(date(report.created_at))}</td>
          <td><div class="admin-pricing-actions">
            ${report.comment_id ? `<button class="admin-button subtle is-danger" type="button" data-comment-hide="${escapeHtml(report.comment_id)}" data-value="true">Masquer la réponse</button>` : `<button class="admin-button subtle is-danger" type="button" data-feedback-hide="${escapeHtml(report.post_id)}" data-value="true">Masquer la suggestion</button>`}
            <button class="admin-button subtle" type="button" data-report-dismiss="${escapeHtml(report.id)}">Ignorer</button>
          </div></td></tr>`).join('')}
        </tbody></table></div>
      </article>` : ''}
      <article class="admin-card full">
        <div class="admin-panel-head admin-costs-head"><div><span class="panel-label">Suggestions des membres</span><p class="metric-note">Classées par soutien : votes, votants payants comptés deux fois, réponses pour moitié. Un changement de statut vers Prévu, En cours ou Livré notifie l’auteur et les votants ; Refusé, l’auteur seulement.</p></div>
          <button class="admin-button subtle" type="button" data-feedback-export>Exporter (CSV)</button></div>
        <div class="admin-dt-toolbar">
          <input class="admin-search admin-dt-search" type="search" placeholder="Rechercher" value="${escapeHtml(query)}" data-feedback-search aria-label="Rechercher une suggestion">
          <select data-feedback-type aria-label="Type"><option value="">Tous types</option><option value="feature"${type === 'feature' ? ' selected' : ''}>Fonctionnalités</option><option value="bug"${type === 'bug' ? ' selected' : ''}>Bugs</option></select>
          <select data-feedback-filter aria-label="Statut"><option value="">Tous statuts</option><option value="open"${status === 'open' ? ' selected' : ''}>Ouvertes</option>${(Object.keys(FEEDBACK_STATUSES) as FeedbackStatus[]).map(value => `<option value="${value}"${status === value ? ' selected' : ''}>${escapeHtml(FEEDBACK_STATUSES[value])}</option>`).join('')}<option value="hidden"${status === 'hidden' ? ' selected' : ''}>Masquées</option></select>
          <span class="admin-dt-count">${rows.length} suggestion${rows.length > 1 ? 's' : ''}</span>
        </div>
        ${rows.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Suggestion</th><th class="is-end">Votes</th><th class="is-end">Payants</th><th class="is-end">Réponses</th><th>Statut</th><th>Créée</th><th>Actions</th></tr></thead><tbody>
          ${rows.map(post => `<tr${post.hidden ? ' class="is-muted"' : ''}>
            <td><button class="admin-link" type="button" data-feedback-open="${escapeHtml(post.id)}" aria-expanded="${openId === post.id}">${escapeHtml(post.title)}</button><br><small class="metric-note">${escapeHtml(FEEDBACK_TYPES[post.type as 'feature'] || post.type)}${post.private ? ' · sécurité (privée)' : ''} · ${escapeHtml(post.author_name)}${post.report_count ? ` · <span class="admin-negative">${escapeHtml(post.report_count)} signalement(s)</span>` : ''}${post.hidden ? ' · <span class="admin-negative">masquée</span>' : ''}${post.pinned ? ' · épinglée' : ''}</small></td>
            <td class="is-end">${escapeHtml(post.vote_count)}</td>
            <td class="is-end">${escapeHtml(post.paid_vote_count)}</td>
            <td class="is-end">${escapeHtml(post.comment_count)}</td>
            <td>${post.status === 'duplicate' ? `<span class="status-pill ${TONE.duplicate}">Doublon</span>` : statusSelect(post)}</td>
            <td>${escapeHtml(date(post.created_at))}</td>
            <td><div class="admin-pricing-actions">
              <button class="admin-button subtle" type="button" data-feedback-pin="${escapeHtml(post.id)}" data-value="${post.pinned ? 'false' : 'true'}">${post.pinned ? 'Désépingler' : 'Épingler'}</button>
              <button class="admin-button subtle${post.hidden ? '' : ' is-danger'}" type="button" data-feedback-hide="${escapeHtml(post.id)}" data-value="${post.hidden ? 'false' : 'true'}">${post.hidden ? 'Rétablir' : 'Masquer'}</button>
              <a class="admin-button subtle" href="/dashboard.html#suggestions/${encodeURIComponent(post.id)}" target="_blank" rel="noopener">Voir</a>
            </div></td>
          </tr>${openId === post.id ? detailPanel(post) : ''}`).join('')}
        </tbody></table></div>` : '<p class="metric-note">Aucune suggestion ne correspond.</p>'}
      </article>`;
  };

  const patch = async (id: string, body: Row, done: string) => {
    try {
      await apiFetch(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      toast(done, 'success');
      await load();
      if (openId) void loadDetail(openId);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error');
      render();
    }
  };

  root.addEventListener('change', event => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement && target.dataset.feedbackStatus) {
      const id = target.dataset.feedbackStatus;
      const next = target.value as FeedbackStatus;
      const post = posts.find(item => item.id === id);
      const who = ['planned', 'in_progress', 'done'].includes(next) ? `l’auteur et les ${post?.vote_count ?? 0} votant(s) seront notifiés` : next === 'declined' ? 'l’auteur sera notifié' : 'personne ne sera notifié';
      void confirmDialog({ title: `Passer à « ${FEEDBACK_STATUSES[next]} » ?`, body: `« ${post?.title || ''} » : ${who}.`, confirmLabel: 'Confirmer' }).then(ok => {
        if (ok) void patch(id, { status: next }, `Statut : ${FEEDBACK_STATUSES[next]}.`);
        else render();
      });
      return;
    }
    if (target instanceof HTMLSelectElement && target.hasAttribute('data-feedback-type')) { type = target.value; render(); }
    if (target instanceof HTMLSelectElement && target.hasAttribute('data-feedback-filter')) { status = target.value; render(); }
  });

  let searchTimer = 0;
  root.addEventListener('input', event => {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement) || !target.hasAttribute('data-feedback-search')) return;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      query = target.value.trim().toLocaleLowerCase('fr');
      render();
      const input = root.querySelector<HTMLInputElement>('[data-feedback-search]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 250);
  });

  root.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-feedback-reload')) { void load(); return; }
    if (button.hasAttribute('data-feedback-export')) {
      const blob = new Blob([`\ufeff${feedbackCsv(visible())}`], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `suggestions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      return;
    }
    if (button.dataset.feedbackOpen) {
      const id = button.dataset.feedbackOpen;
      openId = openId === id ? null : id;
      detail = null;
      render();
      if (openId) void loadDetail(openId);
      return;
    }
    if (button.dataset.feedbackPin) { void patch(button.dataset.feedbackPin, { pinned: button.dataset.value === 'true' }, button.dataset.value === 'true' ? 'Suggestion épinglée.' : 'Suggestion désépinglée.'); return; }
    if (button.dataset.feedbackHide) {
      const hide = button.dataset.value === 'true';
      if (hide && !(await confirmDialog({ title: 'Masquer cette suggestion ?', body: 'Elle disparaît du tableau public (vous la voyez toujours ici) et ses signalements sont clos.', confirmLabel: 'Masquer', danger: true }))) return;
      void patch(button.dataset.feedbackHide, { hidden: hide }, hide ? 'Suggestion masquée.' : 'Suggestion rétablie.');
      return;
    }
    const commentId = button.dataset.commentHide || button.dataset.commentPin;
    if (commentId) {
      const body = button.dataset.commentHide ? { hidden: button.dataset.value === 'true' } : { pinned: button.dataset.value === 'true' };
      try {
        await apiFetch(`/api/admin/feedback/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: JSON.stringify(body) });
        toast('Réponse mise à jour.', 'success');
        await load();
        if (openId) void loadDetail(openId);
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error');
      }
      return;
    }
    if (button.dataset.reportDismiss) {
      try {
        await apiFetch(`/api/admin/feedback/reports/${encodeURIComponent(button.dataset.reportDismiss)}/resolve`, { method: 'POST', body: '{}' });
        toast('Signalement ignoré.', 'success');
        void load();
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : 'Action impossible.', 'error');
      }
    }
  });

  root.addEventListener('submit', async event => {
    const form = event.target as HTMLFormElement;
    if (form.dataset.feedbackReply) {
      event.preventDefault();
      const body = String(new FormData(form).get('body') || '').trim();
      if (!body) return;
      try {
        await apiFetch(`/api/feedback/${encodeURIComponent(form.dataset.feedbackReply)}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
        toast('Réponse publiée avec le badge « Équipe ».', 'success');
        await load();
        void loadDetail(form.dataset.feedbackReply);
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : 'Réponse impossible.', 'error');
      }
      return;
    }
    if (form.dataset.feedbackMerge) {
      event.preventDefault();
      const source = form.dataset.feedbackMerge;
      const target = String(new FormData(form).get('target') || '');
      const targetPost = posts.find(item => item.id === target);
      if (!(await confirmDialog({ title: 'Fusionner comme doublon ?', body: `Les votes rejoignent « ${targetPost?.title || ''} » (un vote par personne) et cette suggestion passe au statut Doublon.`, confirmLabel: 'Fusionner' }))) return;
      try {
        const result = await apiFetch<Row>(`/api/admin/feedback/${encodeURIComponent(source)}/merge`, { method: 'POST', body: JSON.stringify({ target_id: target }) });
        toast(`Fusionnée : ${result.votes_moved} vote(s) reporté(s).`, 'success');
        openId = null;
        void load();
      } catch (caught) {
        toast(caught instanceof Error ? caught.message : 'Fusion impossible.', 'error');
      }
    }
  });

  render();
  return { load };
}
