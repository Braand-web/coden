/**
 * Admin → Bibliothèque: the shared sub-agents and skills, and the error memory.
 *
 * See, search, edit, switch off or delete what the agents saved, with their
 * statistics; errors that came back despite their rule are listed first.
 */
import { apiFetch } from './lib/api';

type Row = Record<string, any>;
type Tab = 'agent' | 'skill' | 'errors';

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString('fr-FR') : '--');
const date = (value: unknown) => {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Jamais';
};
const rate = (row: Row) => {
  const uses = Number(row.uses) || 0;
  return uses ? `${Math.round(((Number(row.successes) || 0) / uses) * 100)} %` : '—';
};

const STATUS: Record<string, string> = { active: 'Actif', candidate: 'Candidat', disabled: 'Désactivé', archived: 'Archivé', needs_review: 'À revérifier' };
const CATEGORY: Record<string, string> = { build: 'Build', runtime: 'Exécution', test: 'Test', mishandling: 'Mauvaise manipulation', user_correction: 'Correction utilisateur' };
const pill = (status: string) => `<span class="status-pill ${status === 'active' ? 'ok' : status === 'disabled' ? 'failed' : 'warning'}">${escapeHtml(STATUS[status] || status)}</span>`;

export function mountAdminLibrary(root: HTMLElement) {
  let tab: Tab = 'agent';
  let query = '';
  let overview: Row | null = null;
  let items: Row[] = [];
  let memories: Row[] = [];
  let loading = false;
  let error = '';
  let searchTimer = 0;

  const load = async () => {
    loading = true;
    error = '';
    render();
    try {
      if (tab === 'errors') {
        const [library, memory] = await Promise.all([
          overview ? Promise.resolve({ overview }) : apiFetch<{ overview: Row }>('/api/admin/library?kind=agent'),
          apiFetch<{ memories: Row[] }>(`/api/admin/error-memory?q=${encodeURIComponent(query)}`),
        ]);
        overview = library.overview;
        memories = memory.memories || [];
      } else {
        const library = await apiFetch<{ overview: Row; items: Row[] }>(`/api/admin/library?kind=${tab}&q=${encodeURIComponent(query)}`);
        overview = library.overview;
        items = library.items || [];
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : 'Bibliothèque indisponible.';
    } finally {
      loading = false;
      render();
    }
  };

  const metrics = () => {
    const data = overview || {};
    const card = (label: string, value: unknown, note: string) => `<article class="admin-card"><span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${escapeHtml(value)}</strong><span class="metric-note">${escapeHtml(note)}</span></article>`;
    return [
      card('Sous-agents actifs', number(data.agents ?? 0), `${number(data.versions ?? 0)} anciennes versions conservées`),
      card('Skills actifs', number(data.skills ?? 0), `${number(data.disabled ?? 0)} désactivés`),
      card('Utilisations', number(data.uses ?? 0), data.uses ? `${Math.round(((data.successes || 0) / data.uses) * 100)} % de réussite` : 'Aucune encore'),
      card('Règles d’erreurs', number(data.rules ?? 0), `${number(data.permanentRules ?? 0)} permanentes · ${number(data.errorsSeen ?? 0)} erreurs vues`),
      card('Récidives', number(data.recurring ?? 0), 'Erreurs revenues malgré leur règle'),
      card('À revérifier', number(data.needsReview ?? 0), 'Règles liées à une version changée'),
    ].join('');
  };

  const itemsTable = () => {
    if (!items.length) return `<div class="admin-empty">${tab === 'agent' ? 'Aucun sous-agent sauvegardé pour le moment : ils entrent ici après une tâche réussie.' : 'Aucun skill pour le moment : l’agent en crée quand il résout une tâche qui reviendra.'}</div>`;
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Nom</th><th>Statut</th><th>Version</th><th>Utilisations</th><th>Réussite</th><th>Contributeurs</th><th>Dernier usage</th><th>Actions</th></tr></thead><tbody>${items.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.name)}</strong><br><span>${escapeHtml(row.description || '')}</span>${row.disabled_reason ? `<br><span class="admin-lib-note">${escapeHtml(row.disabled_reason)}</span>` : ''}</td>
        <td>${pill(row.status)}</td>
        <td>v${escapeHtml(row.version)}</td>
        <td>${number(row.uses)}</td>
        <td>${rate(row)}</td>
        <td>${number(row.contributors)}</td>
        <td>${escapeHtml(date(row.last_used_at))}</td>
        <td class="admin-lib-actions">
          <button class="admin-button subtle" type="button" data-lib-action="edit" data-id="${escapeHtml(row.id)}">Modifier</button>
          <button class="admin-button subtle" type="button" data-lib-action="${row.status === 'disabled' ? 'enable' : 'disable'}" data-id="${escapeHtml(row.id)}">${row.status === 'disabled' ? 'Activer' : 'Désactiver'}</button>
          <button class="admin-button subtle" type="button" data-lib-action="versions" data-id="${escapeHtml(row.id)}">Versions</button>
          <button class="admin-button subtle danger" type="button" data-lib-action="delete" data-id="${escapeHtml(row.id)}">Supprimer</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  };

  const memoryTable = () => {
    if (!memories.length) return '<div class="admin-empty">Aucune erreur mémorisée pour le moment : elles entrent ici quand une correction est confirmée.</div>';
    return `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Erreur</th><th>Règle</th><th>Type</th><th>Statut</th><th>Fréquence</th><th>Récidives</th><th>Vue</th><th>Actions</th></tr></thead><tbody>${memories.map(row => `
      <tr${row.recurrences_after_rule > 0 ? ' class="admin-lib-recurring"' : ''}>
        <td><strong>${escapeHtml(String(row.error_message || '').slice(0, 160))}</strong>${Object.keys(row.context?.libraries || {}).length ? `<br><span>${escapeHtml(Object.entries(row.context.libraries).map(([name, major]) => `${name} v${major}`).join(', '))}</span>` : ''}</td>
        <td>${escapeHtml(row.rule || '')}${row.cause ? `<br><span>Cause : ${escapeHtml(row.cause)}</span>` : ''}</td>
        <td>${escapeHtml(CATEGORY[row.category] || row.category)}</td>
        <td>${pill(row.status)}${row.permanent ? ' <span class="status-pill ok">Permanente</span>' : ''}</td>
        <td>${number(row.occurrences)}× <span>(${number(row.confirmations)} confirmée${row.confirmations > 1 ? 's' : ''})</span></td>
        <td>${row.recurrences_after_rule > 0 ? `<span class="status-pill failed">${number(row.recurrences_after_rule)}</span>` : '0'}</td>
        <td>${escapeHtml(date(row.last_seen_at))}</td>
        <td class="admin-lib-actions">
          <button class="admin-button subtle" type="button" data-mem-action="edit" data-id="${escapeHtml(row.id)}">Modifier</button>
          <button class="admin-button subtle" type="button" data-mem-action="${row.status === 'disabled' ? 'enable' : 'disable'}" data-id="${escapeHtml(row.id)}">${row.status === 'disabled' ? 'Activer' : 'Désactiver'}</button>
          <button class="admin-button subtle danger" type="button" data-mem-action="delete" data-id="${escapeHtml(row.id)}">Supprimer</button>
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  };

  function render() {
    root.innerHTML = `
      ${metrics()}
      <article class="admin-card full">
        <div class="admin-lib-toolbar">
          <div class="admin-lib-tabs" role="tablist" aria-label="Bibliothèque">
            ${(['agent', 'skill', 'errors'] as Tab[]).map(value => `<button type="button" role="tab" aria-selected="${value === tab}" data-lib-tab="${value}">${value === 'agent' ? 'Sous-agents' : value === 'skill' ? 'Skills' : 'Mémoire des erreurs'}</button>`).join('')}
          </div>
          <input class="admin-lib-search" type="search" placeholder="${tab === 'errors' ? 'Rechercher une erreur ou une règle' : 'Rechercher par nom ou description'}" value="${escapeHtml(query)}" aria-label="Rechercher dans la bibliothèque">
        </div>
        ${error ? `<div class="admin-error">${escapeHtml(error)}</div>` : ''}
        ${loading ? '<div class="admin-skeleton"><div class="admin-skeleton-line"></div><div class="admin-skeleton-line"></div><div class="admin-skeleton-line"></div></div>' : tab === 'errors' ? memoryTable() : itemsTable()}
      </article>
    `;
  }

  /* Editing: one native dialog, for an item or a rule. */
  const dialog = document.createElement('dialog');
  dialog.className = 'admin-lib-dialog';
  document.body.appendChild(dialog);

  const openItemEditor = (row: Row) => {
    dialog.innerHTML = `
      <form method="dialog" class="admin-lib-form">
        <h3>${escapeHtml(row.kind === 'agent' ? 'Sous-agent' : 'Skill')} · v${escapeHtml(row.version)}</h3>
        <label>Nom<input name="name" value="${escapeHtml(row.name)}" maxlength="80" required></label>
        <label>Description<textarea name="description" rows="2" maxlength="400">${escapeHtml(row.description || '')}</textarea></label>
        <label>Statut<select name="status">${['active', 'candidate', 'disabled'].map(value => `<option value="${value}"${row.status === value ? ' selected' : ''}>${STATUS[value]}</option>`).join('')}</select></label>
        <label>Définition (JSON)<textarea name="definition" rows="14" spellcheck="false">${escapeHtml(JSON.stringify(row.definition || {}, null, 2))}</textarea></label>
        <p class="admin-lib-hint">Aucune donnée d’utilisateur ni secret : la bibliothèque est partagée entre tous les comptes.</p>
        <div class="admin-lib-form-actions"><button class="admin-button subtle" value="cancel" type="submit">Annuler</button><button class="admin-button" value="save" type="submit">Enregistrer</button></div>
      </form>`;
    dialog.showModal();
    dialog.onclose = async () => {
      if (dialog.returnValue !== 'save') return;
      const form = dialog.querySelector('form')!;
      const data = new FormData(form);
      let definition: unknown;
      try { definition = JSON.parse(String(data.get('definition') || '{}')); } catch { window.alert('La définition n’est pas un JSON valide : rien n’a été enregistré.'); return; }
      await apiFetch(`/api/admin/library/${row.id}`, { method: 'PATCH', body: JSON.stringify({ name: data.get('name'), description: data.get('description'), status: data.get('status'), definition }) }).catch(failure => window.alert(failure instanceof Error ? failure.message : 'Échec de l’enregistrement.'));
      await load();
    };
  };

  const openMemoryEditor = (row: Row) => {
    dialog.innerHTML = `
      <form method="dialog" class="admin-lib-form">
        <h3>Règle d’erreur</h3>
        <p class="admin-lib-hint">${escapeHtml(row.error_message)}</p>
        <label>Règle<textarea name="rule" rows="3" maxlength="600">${escapeHtml(row.rule || '')}</textarea></label>
        <label>Cause<textarea name="cause" rows="2" maxlength="600">${escapeHtml(row.cause || '')}</textarea></label>
        <label>Correction<textarea name="fix" rows="2" maxlength="600">${escapeHtml(row.fix || '')}</textarea></label>
        <label>Statut<select name="status">${['active', 'needs_review', 'candidate', 'disabled'].map(value => `<option value="${value}"${row.status === value ? ' selected' : ''}>${STATUS[value]}</option>`).join('')}</select></label>
        <label class="admin-lib-check"><input type="checkbox" name="permanent"${row.permanent ? ' checked' : ''}> Règle permanente (toujours appliquée pour sa stack)</label>
        ${row.recurrences_after_rule > 0 ? '<label class="admin-lib-check"><input type="checkbox" name="acknowledge"> Récidives examinées (remettre le compteur à zéro)</label>' : ''}
        <div class="admin-lib-form-actions"><button class="admin-button subtle" value="cancel" type="submit">Annuler</button><button class="admin-button" value="save" type="submit">Enregistrer</button></div>
      </form>`;
    dialog.showModal();
    dialog.onclose = async () => {
      if (dialog.returnValue !== 'save') return;
      const data = new FormData(dialog.querySelector('form')!);
      await apiFetch(`/api/admin/error-memory/${row.id}`, { method: 'PATCH', body: JSON.stringify({ rule: data.get('rule'), cause: data.get('cause'), fix: data.get('fix'), status: data.get('status'), permanent: data.get('permanent') === 'on', acknowledge: data.get('acknowledge') === 'on' }) }).catch(failure => window.alert(failure instanceof Error ? failure.message : 'Échec de l’enregistrement.'));
      await load();
    };
  };

  const showVersions = async (row: Row) => {
    const payload = await apiFetch<{ versions: Row[] }>(`/api/admin/library/${row.id}/versions`).catch(() => ({ versions: [] as Row[] }));
    dialog.innerHTML = `
      <form method="dialog" class="admin-lib-form">
        <h3>Versions de « ${escapeHtml(row.name)} »</h3>
        <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Version</th><th>Statut</th><th>Utilisations</th><th>Réussite</th><th>Créée</th></tr></thead><tbody>
          ${(payload.versions || []).map(version => `<tr><td>v${escapeHtml(version.version)}${version.is_latest ? ' (actuelle)' : ''}</td><td>${pill(version.status)}</td><td>${number(version.uses)}</td><td>${rate(version)}</td><td>${escapeHtml(date(version.created_at))}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="admin-lib-form-actions"><button class="admin-button" value="cancel" type="submit">Fermer</button></div>
      </form>`;
    dialog.onclose = null;
    dialog.showModal();
  };

  root.addEventListener('click', async event => {
    const target = event.target instanceof Element ? event.target : null;
    const tabButton = target?.closest<HTMLElement>('[data-lib-tab]');
    if (tabButton) {
      tab = tabButton.dataset.libTab as Tab;
      query = '';
      await load();
      return;
    }
    const itemButton = target?.closest<HTMLElement>('[data-lib-action]');
    if (itemButton) {
      const row = items.find(item => item.id === itemButton.dataset.id);
      if (!row) return;
      const action = itemButton.dataset.libAction;
      if (action === 'edit') return openItemEditor(row);
      if (action === 'versions') return void showVersions(row);
      if (action === 'delete' && !window.confirm(`Supprimer définitivement « ${row.name} » v${row.version} ?`)) return;
      if (action === 'delete') await apiFetch(`/api/admin/library/${row.id}`, { method: 'DELETE' }).catch(() => undefined);
      else await apiFetch(`/api/admin/library/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: action === 'enable' ? 'active' : 'disabled' }) }).catch(() => undefined);
      await load();
      return;
    }
    const memoryButton = target?.closest<HTMLElement>('[data-mem-action]');
    if (memoryButton) {
      const row = memories.find(memory => memory.id === memoryButton.dataset.id);
      if (!row) return;
      const action = memoryButton.dataset.memAction;
      if (action === 'edit') return openMemoryEditor(row);
      if (action === 'delete' && !window.confirm('Supprimer cette règle ? L’erreur pourra être réapprise si elle revient.')) return;
      if (action === 'delete') await apiFetch(`/api/admin/error-memory/${row.id}`, { method: 'DELETE' }).catch(() => undefined);
      else await apiFetch(`/api/admin/error-memory/${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: action === 'enable' ? 'active' : 'disabled' }) }).catch(() => undefined);
      await load();
    }
  });
  root.addEventListener('input', event => {
    const input = event.target instanceof HTMLInputElement && event.target.matches('.admin-lib-search') ? event.target : null;
    if (!input) return;
    query = input.value.trim();
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      void load().then(() => {
        const field = root.querySelector<HTMLInputElement>('.admin-lib-search');
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      });
    }, 350);
  });

  render();
  return { load };
}
