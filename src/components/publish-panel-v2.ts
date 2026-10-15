import type { PublicationStatusV2, PublishPhase, PublishSettings } from '../shared/publish';
import '../styles/publish-panel-v2.css';

export interface PublishPanelV2Options {
  container: HTMLElement;
  projectId: string;
  /** The caller supplies authenticated JSON requests, including error handling. */
  request: (path: string, init?: RequestInit) => Promise<any>;
  onClose?: () => void;
  onStatus?: (status: PublicationStatusV2) => void;
  onManageDomains?: () => void;
}

export interface PublishPanelV2Controller {
  destroy: () => void;
  refresh: () => Promise<void>;
}

const PHASES: Array<{ phase: PublishPhase; label: string }> = [
  { phase: 'queued', label: 'En attente' },
  { phase: 'validating', label: 'Vérification du projet' },
  { phase: 'building', label: 'Construction' },
  { phase: 'uploading', label: 'Transfert' },
  { phase: 'verifying', label: 'Vérification du site' },
  { phase: 'activating', label: 'Activation' },
  { phase: 'completed', label: 'Publication terminée' },
];
let panelSequence = 0;

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  // getRandomValues remains available in local/insecure fixtures where randomUUID is not.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function publicUrl(status: PublicationStatusV2 | null): string | null {
  if (!status?.effective || !status.public_url) return null;
  try {
    const url = new URL(status.public_url);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function projectAssetPath(value: string): string | null {
  const path = value.trim();
  // Mirrors publication-v2/model.ts without importing server-only code.
  return path.length <= 512 && /^\/(?!\/)[a-zA-Z0-9_./%-]+$/.test(path)
    && !/(?:%2e|%2f|%5c|\.\.)/i.test(path) ? path : null;
}

function errorMessage(error: unknown, fallback: string): string {
  const value = error as { status?: number; message?: unknown } | null;
  if (value?.status === 401) return 'Votre session a expiré. Reconnectez vous, puis réessayez.';
  if (value?.status === 403) return 'Vous n’avez pas l’autorisation pour cette action. Vérifiez vos accès.';
  if (value?.status === 429) return 'Trop de demandes. Patientez un instant, puis réessayez.';
  return typeof value?.message === 'string' && value.message.trim() ? `${fallback} ${value.message}` : fallback;
}

function readStatus(response: any, requireSuccess = true): PublicationStatusV2 {
  const validSettings = (value: any) => value && typeof value.subdomain === 'string'
    && ['public', 'invite_only', 'workspace'].includes(value.audience)
    && Array.isArray(value.invitations) && value.invitations.every((item: unknown) => typeof item === 'string')
    && value.metadata && typeof value.metadata.title === 'string' && typeof value.metadata.description === 'string'
    && (value.metadata.favicon === null || typeof value.metadata.favicon === 'string')
    && (value.metadata.image === null || typeof value.metadata.image === 'string');
  const value = response?.publish;
  if ((requireSuccess ? response?.success !== true : response?.success === false) || value?.version !== 2 || !validSettings(value.draft)
    || (value.effective !== null && !validSettings(value.effective))
    || typeof value.proposed_url !== 'string' || (value.public_url !== null && typeof value.public_url !== 'string')
    || typeof value.can_publish !== 'boolean' || typeof value.can_use_workspace !== 'boolean'
    || typeof value.has_unpublished_changes !== 'boolean'
    || (value.removal_pending !== undefined && typeof value.removal_pending !== 'boolean')
    || !Array.isArray(value.checks) || !value.checks.every((check: any) => check && typeof check.label === 'string' && ['pass', 'warn', 'fail'].includes(check.status))
    || (value.active_job !== null && (!value.active_job || typeof value.active_job.id !== 'string'
      || !['pending', 'processing', 'completed', 'failed', 'cancelled'].includes(value.active_job.status)
      || ![...PHASES.map(item => item.phase), 'failed'].includes(value.active_job.phase)
      || typeof value.active_job.message !== 'string' || !Number.isFinite(value.active_job.sequence)
      || (value.active_job.recoverable !== undefined && typeof value.active_job.recoverable !== 'boolean')
      || (value.active_job.reconciliation_required !== undefined && typeof value.active_job.reconciliation_required !== 'boolean')))) {
    throw new Error(typeof response?.error === 'string' ? response.error
      : typeof response?.message === 'string' ? response.message : 'Le serveur n’a pas renvoyé un état de publication valide.');
  }
  return response.publish;
}

/** An isolated modal: closing stops observation, never the durable server job. */
export function mountPublishPanelV2(options: PublishPanelV2Options): PublishPanelV2Controller {
  const { container, projectId, request } = options;
  const prefix = `coden-publish-v2-${++panelSequence}`;
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/publish`;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = 'cdn-pub-v2';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', `${prefix}-title`);
  dialog.setAttribute('aria-describedby', `${prefix}-intro`);
  dialog.tabIndex = -1;
  // Only static, owned markup enters HTML. All server and user values use DOM properties.
  dialog.innerHTML = `
    <header class="cdn-pub-v2__head">
      <h2 id="${prefix}-title">Publier</h2>
      <button type="button" class="cdn-pub-v2__close" data-action="close" aria-label="Fermer la publication"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    </header>
    <div class="cdn-pub-v2__body">
      <p id="${prefix}-intro" class="cdn-pub-v2__hint">Choisissez l’adresse et les accès, puis publiez votre site.</p>
      <p data-simulation class="cdn-pub-v2__notice" hidden>Simulation : aucune mise en ligne réelle.</p>
      <div class="cdn-pub-v2__error" data-error role="alert" hidden><p data-error-message></p><button type="button" data-action="retry" class="cdn-pub-v2__secondary">Réessayer</button></div>
      <p data-announcement class="cdn-pub-v2__sr" role="status" aria-live="polite" aria-atomic="true"></p>
      <div data-loading class="cdn-pub-v2__loading" role="status">Chargement de la publication…<span aria-hidden="true"></span><span aria-hidden="true"></span></div>
      <section data-status hidden aria-label="État de publication" class="cdn-pub-v2__status">
        <div class="cdn-pub-v2__section-head"><h3 data-state-title></h3><button type="button" class="cdn-pub-v2__secondary" data-action="refresh">Actualiser</button></div>
        <p id="${prefix}-state-detail" class="cdn-pub-v2__hint" data-state-detail></p>
        <p id="${prefix}-resume-hint" data-resume-notice class="cdn-pub-v2__hint" hidden>La version capturée sera reprise ; vos brouillons restent conservés.</p>
        <div class="cdn-pub-v2__url"><span data-url-label></span><span data-proposed-url dir="ltr"></span><a data-live-url target="_blank" rel="noopener noreferrer" hidden></a></div>
        <div class="cdn-pub-v2__row" data-live-actions hidden><button type="button" class="cdn-pub-v2__secondary" data-action="copy">Copier l’adresse</button></div>
        <div data-progress hidden><p data-job-message role="status" aria-live="polite" aria-atomic="true"></p><ol class="cdn-pub-v2__phases" data-phases aria-label="Étapes de publication"></ol></div>
        <ul data-checks class="cdn-pub-v2__checks" aria-label="Vérifications avant publication" hidden></ul>
      </section>
      <form data-form novalidate hidden>
        <fieldset class="cdn-pub-v2__fields" data-fields>
          <legend class="cdn-pub-v2__sr">Paramètres de publication</legend>
          <label class="cdn-pub-v2__field" for="${prefix}-subdomain"><span>Sous domaine</span><input id="${prefix}-subdomain" name="subdomain" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" dir="ltr" minlength="3" maxlength="48" required aria-describedby="${prefix}-subdomain-hint ${prefix}-subdomain-error"><small id="${prefix}-subdomain-hint">De 3 à 48 lettres minuscules, chiffres ou tirets, sans tiret au début ni à la fin. Le serveur vérifie les adresses réservées.</small><small class="cdn-pub-v2__field-error" id="${prefix}-subdomain-error" data-field-error="subdomain" hidden></small></label>
          <label class="cdn-pub-v2__field" for="${prefix}-audience"><span>Qui peut accéder au site ?</span><select id="${prefix}-audience" name="audience" aria-describedby="${prefix}-audience-hint ${prefix}-audience-error"><option value="public">Tout le monde</option><option value="invite_only">Personnes invitées</option><option value="workspace">Membres de l’espace de travail</option></select><small id="${prefix}-audience-hint" data-workspace-hint></small><small class="cdn-pub-v2__field-error" id="${prefix}-audience-error" data-field-error="audience" hidden></small></label>
          <label class="cdn-pub-v2__field" data-invitations-field for="${prefix}-invitations" hidden><span>Adresses e mail autorisées</span><textarea id="${prefix}-invitations" name="invitations" rows="3" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="email" aria-describedby="${prefix}-invitations-hint ${prefix}-invitations-error"></textarea><small id="${prefix}-invitations-hint">Jusqu’à 100 adresses, séparées par une virgule ou un retour à la ligne. En accès sur invitation, une liste vide réserve l’accès au propriétaire et retire les invitations précédentes à la prochaine publication. <span data-invitation-delivery></span></small><small class="cdn-pub-v2__field-error" id="${prefix}-invitations-error" data-field-error="invitations" hidden></small></label>
          <details class="cdn-pub-v2__metadata"><summary>Titre, description et aperçu</summary><div class="cdn-pub-v2__metadata-fields">
            <label class="cdn-pub-v2__field" for="${prefix}-meta-title"><span>Titre du site</span><input id="${prefix}-meta-title" name="title" type="text" maxlength="120" required aria-describedby="${prefix}-title-hint ${prefix}-title-error"><small id="${prefix}-title-hint">Obligatoire, 120 caractères maximum.</small><small class="cdn-pub-v2__field-error" id="${prefix}-title-error" data-field-error="title" hidden></small></label>
            <label class="cdn-pub-v2__field" for="${prefix}-description"><span>Description</span><textarea id="${prefix}-description" name="description" rows="3" maxlength="320" aria-describedby="${prefix}-description-hint ${prefix}-description-error"></textarea><small id="${prefix}-description-hint">320 caractères maximum.</small><small class="cdn-pub-v2__field-error" id="${prefix}-description-error" data-field-error="description" hidden></small></label>
            <p id="${prefix}-assets-hint" class="cdn-pub-v2__hint">Utilisez un fichier du projet, comme /favicon.ico ou /images/partage.png, avec un chemin de 512 caractères maximum. Les URL externes, les remontées de dossier et les points ou séparateurs encodés ne sont pas acceptés. L’aperçu se charge en quittant le champ.</p>
            <label class="cdn-pub-v2__field" for="${prefix}-favicon"><span>Chemin de l’icône du site</span><input id="${prefix}-favicon" name="favicon" type="text" autocomplete="off" autocapitalize="none" dir="ltr" maxlength="512" spellcheck="false" aria-describedby="${prefix}-assets-hint ${prefix}-favicon-error"><small class="cdn-pub-v2__field-error" id="${prefix}-favicon-error" data-field-error="favicon" hidden></small></label>
            <label class="cdn-pub-v2__field" for="${prefix}-image"><span>Chemin de l’image de partage</span><input id="${prefix}-image" name="image" type="text" autocomplete="off" autocapitalize="none" dir="ltr" maxlength="512" spellcheck="false" aria-describedby="${prefix}-assets-hint ${prefix}-image-error"><small class="cdn-pub-v2__field-error" id="${prefix}-image-error" data-field-error="image" hidden></small></label>
            <div class="cdn-pub-v2__preview" aria-label="Aperçu du partage"><img class="cdn-pub-v2__preview-image" data-preview-image alt="Aperçu de l’image de partage" referrerpolicy="no-referrer" hidden><p data-image-error class="cdn-pub-v2__hint" hidden>Impossible de charger ce fichier du projet. Vérifiez son chemin.</p><div class="cdn-pub-v2__preview-copy"><img data-preview-favicon alt="" width="24" height="24" referrerpolicy="no-referrer" hidden><strong data-preview-title></strong><p data-preview-description></p></div></div>
          </div></details>
        </fieldset>
        <footer class="cdn-pub-v2__foot"><p data-publish-hint class="cdn-pub-v2__hint"></p><button type="submit" class="cdn-pub-v2__primary" data-action="publish">Publier le site</button><button type="button" class="cdn-pub-v2__primary" data-action="resume" aria-describedby="${prefix}-resume-hint" hidden>Reprendre la publication</button><p class="cdn-pub-v2__hint">Vous pouvez fermer ce panneau pendant la publication.</p></footer>
      </form>
      <section data-unpublish-section hidden class="cdn-pub-v2__unpublish" aria-label="Retirer le site"><button type="button" class="cdn-pub-v2__secondary cdn-pub-v2__danger" data-action="unpublish">Retirer le site</button><div data-unpublish-confirm hidden><h3 id="${prefix}-remove-title" tabindex="-1">Retirer le site en ligne ?</h3><p id="${prefix}-remove-detail" class="cdn-pub-v2__hint">L’adresse publique ne sera plus accessible. Votre projet et ses paramètres sont conservés.</p><div class="cdn-pub-v2__row"><button type="button" class="cdn-pub-v2__secondary" data-action="cancel-unpublish">Garder le site en ligne</button><button type="button" class="cdn-pub-v2__secondary cdn-pub-v2__danger" data-action="confirm-unpublish" aria-describedby="${prefix}-remove-detail">Confirmer le retrait</button></div></div></section>
      ${options.onManageDomains ? '<button type="button" class="cdn-pub-v2__secondary" data-action="manage-domains">Gérer les domaines</button>' : ''}
    </div>`;
  container.append(dialog);
  const el = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const form = el<HTMLFormElement>('[data-form]');
  const fields = el<HTMLFieldSetElement>('[data-fields]');
  type Field = 'subdomain' | 'audience' | 'invitations' | 'title' | 'description' | 'favicon' | 'image';
  const input = (name: Field) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  let status: PublicationStatusV2 | null = null;
  let destroyed = false;
  let dirty = false;
  let busy: 'publish' | 'resume' | 'unpublish' | null = null;
  let confirmingRemoval = false;
  let copying = false;
  let epoch = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let readController: AbortController | null = null;
  let reading: Promise<void> | null = null;
  let retry: (() => void) | null = null;
  // Reuse on an ambiguous network failure. Editing the settings starts a new intent.
  let publishIntent: { settings: string; key: string } | null = null;
  let observedPending = false;

  const activeJob = () => status?.active_job && ['pending', 'processing'].includes(status.active_job.status) ? status.active_job : null;
  const recoverableJob = () => status?.active_job?.status === 'failed' && status.active_job.recoverable === true ? status.active_job : null;
  const needsReconciliation = () => status?.active_job?.reconciliation_required === true || Boolean(recoverableJob());
  const failedReconciliation = () => status?.active_job?.status === 'failed' && needsReconciliation() ? status.active_job : null;
  const announce = (message: string) => { el('[data-announcement]').textContent = message; };
  const clearError = () => { el('[data-error]').hidden = true; retry = null; };
  const showError = (message: string, action: (() => void) | null) => {
    if (destroyed) return;
    el('[data-error-message]').textContent = message;
    el('[data-error]').hidden = false;
    retry = action;
    el('[data-action="retry"]').hidden = !action;
    el('[data-action="retry"]').textContent = action === retryResume ? 'Reprendre la publication' : 'Réessayer';
  };
  function settings(): PublishSettings {
    return {
      subdomain: input('subdomain').value.trim().toLowerCase(),
      audience: input('audience').value as PublishSettings['audience'],
      invitations: [...new Set(input('invitations').value.split(/[\s,;]+/).filter(Boolean).map(value => value.toLowerCase()))],
      metadata: { title: input('title').value.trim(), description: input('description').value.trim(), favicon: input('favicon').value.trim() || null, image: input('image').value.trim() || null },
    };
  }
  function populate(draft: PublishSettings) {
    input('subdomain').value = draft.subdomain;
    input('audience').value = draft.audience;
    input('invitations').value = draft.invitations.join('\n');
    for (const name of ['title', 'description', 'favicon', 'image'] as const) input(name).value = draft.metadata[name] || '';
    dirty = false;
    updatePreview(true);
  }
  function updatePreview(loadAssets = false) {
    el('[data-invitations-field]').hidden = input('audience').value !== 'invite_only'
      && input('invitations').getAttribute('aria-invalid') !== 'true'
      && document.activeElement !== input('invitations');
    el('[data-preview-title]').textContent = input('title').value.trim() || 'Titre du site';
    el('[data-preview-description]').textContent = input('description').value.trim() || 'Ajoutez une description pour l’aperçu du partage.';
    for (const name of ['favicon', 'image'] as const) {
      const image = el<HTMLImageElement>(`[data-preview-${name}]`);
      const path = projectAssetPath(input(name).value);
      if (path !== image.getAttribute('src')) {
        image.hidden = true;
        image.removeAttribute('src');
        // Text previews stay live; image requests require a validated, committed
        // project path (or a server-provided draft), never a URL typed by a user.
        if (path && loadAssets) { image.setAttribute('src', path); image.hidden = false; }
        if (name === 'image') el('[data-image-error]').hidden = true;
      }
    }
  }
  function validate(): boolean {
    const draft = settings();
    const errors: Partial<Record<Field, string>> = {};
    if (!/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(draft.subdomain)) errors.subdomain = 'Choisissez de 3 à 48 lettres minuscules ou chiffres, avec des tirets uniquement à l’intérieur.';
    if (!['public', 'invite_only', 'workspace'].includes(draft.audience)) errors.audience = 'Choisissez qui peut accéder au site.';
    if (draft.audience === 'workspace' && !status?.can_use_workspace) errors.audience = 'L’accès par espace de travail n’est pas disponible pour ce projet.';
    if (draft.invitations.length > 100) errors.invitations = 'Ajoutez au maximum 100 adresses e mail.';
    else if (draft.invitations.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.invitations = 'Vérifiez le format de chaque adresse e mail.';
    for (const name of ['favicon', 'image'] as const) {
      if (draft.metadata[name] && !projectAssetPath(draft.metadata[name]!)) errors[name] = 'Choisissez un chemin du projet commençant par /, de 512 caractères maximum, sans URL externe, remontée de dossier ni point ou séparateur encodé.';
    }
    if (!draft.metadata.title || draft.metadata.title.length > 120) errors.title = 'Ajoutez un titre de 1 à 120 caractères.';
    if (draft.metadata.description.length > 320) errors.description = 'La description ne doit pas dépasser 320 caractères.';
    for (const name of ['subdomain', 'audience', 'invitations', 'title', 'description', 'favicon', 'image'] as const) {
      const message = errors[name];
      input(name).setAttribute('aria-invalid', String(Boolean(message)));
      const box = el(`[data-field-error="${name}"]`);
      box.hidden = !message;
      box.textContent = message || '';
    }
    const first = Object.keys(errors)[0] as Field | undefined;
    if (!first) return true;
    if (errors.invitations) el('[data-invitations-field]').hidden = false;
    const details = input(first).closest('details');
    if (details) details.open = true;
    input(first).focus();
    announce('Vérifiez les champs signalés avant de publier.');
    return false;
  }
  function render() {
    if (destroyed) return;
    el('[data-loading]').hidden = Boolean(status);
    el('[data-status]').hidden = !status;
    form.hidden = !status;
    if (!status) return;
    el('[data-simulation]').hidden = !status.simulation;
    const job = status.active_job;
    const running = activeJob();
    const resumable = recoverableJob();
    const reconciliation = needsReconciliation();
    const interrupted = failedReconciliation();
    const removing = status.removal_pending === true;
    const url = publicUrl(status);
    if (retry === retryResume && !resumable) clearError();
    fields.disabled = Boolean(busy || running || reconciliation || removing || observedPending);
    el('[data-resume-notice]').hidden = !resumable;
    if (resumable) fields.setAttribute('aria-describedby', `${prefix}-resume-hint`);
    else if (reconciliation) fields.setAttribute('aria-describedby', `${prefix}-state-detail`);
    else fields.removeAttribute('aria-describedby');
    el('[data-invitation-delivery]').textContent = status.simulation
      ? 'Aucun email réel n’est envoyé en simulation.'
      : 'Les invitations sont envoyées après une publication réussie.';
    const workspace = el<HTMLOptionElement>('option[value="workspace"]');
    workspace.disabled = !status.can_use_workspace;
    el('[data-workspace-hint]').textContent = status.can_use_workspace ? 'Les accès sont appliqués à la prochaine publication.' : 'L’accès par espace de travail n’est pas disponible pour ce projet.';
    el('[data-state-title]').textContent = removing ? 'Retrait à terminer' : running || observedPending ? 'Publication en cours' : interrupted ? 'Publication interrompue' : job?.status === 'failed' ? 'La publication a échoué' : url ? 'Votre site est en ligne' : status.simulation ? 'Prêt pour une simulation' : 'Votre site n’est pas en ligne';
    el('[data-state-detail]').textContent = removing ? 'Les accès Coden sont bloqués. Le nettoyage des accès fournisseur reste à terminer. Vous pouvez reprendre le retrait sans perdre votre projet.' : running || observedPending ? 'La publication continue même si vous fermez ce panneau.' : resumable ? 'Cette publication attend votre confirmation pour être reprise. Vous pouvez aussi retirer la publication interrompue. Aucun nouveau lancement ne sera effectué automatiquement.' : interrupted ? 'Le nombre maximal de reprises est atteint. Retirez la publication interrompue avant de lancer une nouvelle publication. Vos brouillons restent conservés.' : job?.status === 'failed' ? (job.error || job.message || 'Vous pouvez réessayer.') : job?.status === 'cancelled' ? 'La publication a été interrompue sur le serveur. Vous pouvez réessayer.' : url && (status.has_unpublished_changes || dirty) ? 'Des modifications ne sont pas encore en ligne. La version publiée reste disponible.' : url ? 'Cette adresse ouvre la version actuellement publiée.' : 'L’adresse proposée deviendra accessible après une publication réussie.';
    el('[data-url-label]').textContent = url ? 'Adresse en ligne' : 'Adresse proposée';
    const proposed = el('[data-proposed-url]');
    proposed.hidden = Boolean(url);
    proposed.textContent = status.proposed_url || 'L’adresse sera disponible après la publication.';
    const link = el<HTMLAnchorElement>('[data-live-url]');
    link.hidden = !url;
    if (url) { link.href = url; link.textContent = url; link.setAttribute('aria-label', `Ouvrir le site publié : ${url} (nouvel onglet)`); }
    else { link.removeAttribute('href'); link.textContent = ''; }
    el('[data-live-actions]').hidden = !url;
    el<HTMLButtonElement>('[data-action="copy"]').disabled = copying || !url;
    el('[data-progress]').hidden = !job;
    const jobMessage = job ? `${interrupted ? 'Interrompue' : job.status === 'failed' ? 'Échec' : job.status === 'cancelled' ? 'Interrompu' : PHASES.find(item => item.phase === job.phase)?.label || 'Publication'}${job.message ? ` : ${job.message}` : ''}` : '';
    if (el('[data-job-message]').textContent !== jobMessage) el('[data-job-message]').textContent = jobMessage;
    const phases = el('[data-phases]');
    phases.replaceChildren();
    if (job) {
      const current = PHASES.findIndex(item => item.phase === job.phase);
      for (const [index, item] of PHASES.entries()) {
        const row = document.createElement('li');
        const completed = job.status === 'completed' || (current >= 0 && index < current);
        row.dataset.state = completed ? 'complete' : index === current ? 'current' : 'waiting';
        if (index === current && running) row.setAttribute('aria-current', 'step');
        row.textContent = `${item.label}${completed ? ' · terminé' : index === current && running ? ' · en cours' : ''}`;
        phases.append(row);
      }
    }
    const checks = el('[data-checks]');
    checks.replaceChildren();
    for (const check of status.checks.filter(item => item.status !== 'pass')) {
      const row = document.createElement('li');
      row.dataset.state = check.status;
      row.textContent = `${check.status === 'fail' ? 'À corriger' : 'À noter'} : ${check.label}${check.detail ? ` — ${check.detail}` : ''}`;
      checks.append(row);
    }
    checks.hidden = !checks.childElementCount;
    const primary = el<HTMLButtonElement>('[data-action="publish"]');
    primary.hidden = reconciliation;
    primary.disabled = Boolean(busy || running || reconciliation || observedPending || !status.can_publish);
    primary.textContent = busy === 'publish' ? 'Enregistrement et lancement…' : running || observedPending ? 'Publication en cours…' : status.simulation ? 'Lancer la simulation' : job?.status === 'failed' ? 'Réessayer la publication' : status.effective ? 'Publier les modifications' : 'Publier le site';
    const resumeButton = el<HTMLButtonElement>('[data-action="resume"]');
    resumeButton.hidden = !resumable;
    resumeButton.disabled = Boolean(busy || running || observedPending || !resumable);
    resumeButton.textContent = busy === 'resume' ? 'Reprise en cours…' : 'Reprendre la publication';
    el('[data-publish-hint]').textContent = resumable ? 'La reprise utilise la version déjà capturée, sans enregistrer ni publier les paramètres du brouillon affiché.' : interrupted ? 'Retirez d’abord la publication interrompue. Aucun nouveau lancement n’est possible tant que ce retrait n’est pas confirmé.' : !status.can_publish ? 'La publication n’est pas disponible. Consultez les vérifications ci dessus, puis actualisez.' : status.simulation ? 'Ce lancement utilise le mode simulation fourni par le serveur.' : 'Ce bouton enregistre les paramètres et confirme la mise en ligne, avec les accès choisis.';
    const unpublishSection = el('[data-unpublish-section]');
    unpublishSection.hidden = !url && !interrupted && !removing;
    unpublishSection.setAttribute('aria-label', interrupted ? 'Retirer la publication interrompue' : 'Retirer le site');
    el('[data-unpublish-confirm]').hidden = !confirmingRemoval;
    const remove = el<HTMLButtonElement>('[data-action="unpublish"]');
    remove.hidden = confirmingRemoval;
    remove.textContent = removing ? 'Terminer le retrait' : interrupted ? 'Retirer la publication interrompue' : 'Retirer le site';
    el(`#${prefix}-remove-title`).textContent = removing ? 'Terminer le retrait ?' : interrupted ? 'Retirer la publication interrompue ?' : 'Retirer le site en ligne ?';
    el(`#${prefix}-remove-detail`).textContent = interrupted
      ? 'La publication interrompue sera abandonnée et tout accès public associé sera retiré. Une éventuelle version en ligne ne sera plus accessible. Votre projet et ses brouillons sont conservés.'
      : 'L’adresse publique ne sera plus accessible. Votre projet et ses paramètres sont conservés.';
    el('[data-action="cancel-unpublish"]').textContent = interrupted ? 'Conserver la publication interrompue' : 'Garder le site en ligne';
    remove.disabled = Boolean(busy || running || observedPending);
    el<HTMLButtonElement>('[data-action="confirm-unpublish"]').disabled = Boolean(busy || running || observedPending);
    el<HTMLButtonElement>('[data-action="cancel-unpublish"]').disabled = Boolean(busy);
    el('[data-action="confirm-unpublish"]').textContent = busy === 'unpublish' ? 'Retrait en cours…' : 'Confirmer le retrait';
    updatePreview();
  }
  function accept(next: PublicationStatusV2, forceDraft = false) {
    if (destroyed) return;
    if (status?.active_job?.id === next.active_job?.id && status?.active_job && next.active_job
      && next.active_job.sequence < status.active_job.sequence) return;
    status = next;
    if (forceDraft || !dirty) populate(next.draft);
    if (next.active_job) observedPending = false;
    render();
    options.onStatus?.(next);
  }
  function schedule(delay = activeJob() || observedPending ? 1500 : 10000) {
    clearTimeout(pollTimer);
    if (!destroyed) pollTimer = setTimeout(() => { void refresh(); }, delay);
  }
  function refresh(): Promise<void> {
    if (destroyed) return Promise.resolve();
    if (reading) return reading;
    if (busy) return Promise.resolve();
    clearTimeout(pollTimer);
    const atEpoch = epoch;
    const controller = new AbortController();
    readController = controller;
    el<HTMLButtonElement>('[data-action="refresh"]').disabled = true;
    reading = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let abortRead: (() => void) | undefined;
      try {
        const response = await Promise.race([
          request(`${endpoint}/status`, { method: 'GET', signal: controller.signal }),
          new Promise<never>((_resolve, reject) => {
            abortRead = () => reject(new DOMException('Observation interrompue.', 'AbortError'));
            controller.signal.addEventListener('abort', abortRead, { once: true });
            timeout = setTimeout(() => { reject(new Error('Le serveur met trop de temps à répondre. Réessayez.')); controller.abort(); }, 15000);
          }),
        ]);
        if (destroyed || atEpoch !== epoch) return;
        accept(readStatus(response));
        // A status retry must not hide a failed write or a clipboard error.
        if (retry === retryRefresh) clearError();
      } catch (error) {
        if (destroyed || atEpoch !== epoch) return;
        el('[data-loading]').hidden = true;
        showError(errorMessage(error, 'Impossible de lire la publication. Vos paramètres sont conservés.'), retryRefresh);
      } finally {
        clearTimeout(timeout);
        if (abortRead) controller.signal.removeEventListener('abort', abortRead);
        reading = null;
        readController = null;
        if (!destroyed) { el<HTMLButtonElement>('[data-action="refresh"]').disabled = false; schedule(el('[data-error]').hidden ? undefined : 5000); }
      }
    })();
    return reading;
  }
  function retryRefresh() { void refresh(); }
  function invalidateReads() {
    epoch++;
    clearTimeout(pollTimer);
    readController?.abort();
  }
  async function publish() {
    if (destroyed || busy || activeJob() || needsReconciliation() || observedPending || !status?.can_publish || !validate()) return;
    const draft = settings();
    const serialized = JSON.stringify(draft);
    try {
      if (publishIntent?.settings !== serialized) publishIntent = { settings: serialized, key: idempotencyKey() };
    } catch (error) {
      showError(errorMessage(error, 'Impossible de sécuriser le lancement. Rechargez la page, puis réessayez.'), retryRefresh);
      return;
    }
    const key = publishIntent.key;
    busy = 'publish';
    confirmingRemoval = false;
    invalidateReads();
    clearError();
    render();
    try {
      const saved = readStatus(await request(`${endpoint}/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: serialized }));
      accept(saved, true);
      if (needsReconciliation()) return;
      if (saved.active_job && ['pending', 'processing'].includes(saved.active_job.status)) {
        announce('Une publication est déjà en cours. Son avancement est affiché dans ce panneau.');
        return;
      }
      if (!saved.can_publish || (saved.draft.audience === 'workspace' && !saved.can_use_workspace)) throw new Error('La publication est bloquée. Vérifiez les accès et les contrôles du projet.');
      // Deliberately no AbortSignal: closing the panel must not cancel this intent.
      const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ async: true, confirmed: true, idempotency_key: key }) });
      const next = readStatus(response, false);
      if (typeof response.job_id !== 'string' || !response.job_id) throw new Error('Le serveur n’a pas confirmé le lancement. Actualisez avant de réessayer.');
      observedPending = !next.active_job;
      accept(next, true);
      publishIntent = null;
      announce('Publication lancée. Vous pouvez fermer ce panneau.');
    } catch (error) {
      showError(errorMessage(error, 'La publication n’a pas abouti. Vos paramètres sont conservés.'), retryPublish);
    } finally {
      busy = null;
      render();
      schedule();
    }
  }
  async function resume() {
    const interrupted = recoverableJob();
    if (destroyed || busy || !interrupted || activeJob() || observedPending) return;
    const resumeJobId = interrupted.id;
    busy = 'resume';
    confirmingRemoval = false;
    invalidateReads();
    clearError();
    render();
    let accepted = false;
    try {
      // Resume the server's captured snapshot only. Never save the displayed draft
      // or generate a new publication intent/idempotency key for this operation.
      const response = await request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true, confirmed: true, resume_job_id: resumeJobId }),
      });
      const next = readStatus(response, false);
      if (typeof response.job_id !== 'string' || !response.job_id) throw new Error('Le serveur n’a pas confirmé la reprise. Actualisez avant de réessayer.');
      observedPending = !next.active_job;
      accept(next);
      accepted = true;
      announce('Reprise de la publication lancée. Vos brouillons restent conservés.');
    } catch (error) {
      showError(errorMessage(error, 'La publication n’a pas pu être reprise. La version capturée et vos brouillons sont conservés.'), retryResume);
    } finally {
      busy = null;
      render();
      if (accepted) void refresh();
      else schedule();
    }
  }
  function retryResume() {
    if (recoverableJob()) void resume();
    else void refresh();
  }
  function retryPublish() {
    if (activeJob() || needsReconciliation() || observedPending || !status?.can_publish) void refresh();
    else void publish();
  }
  async function unpublish() {
    if (destroyed || !confirmingRemoval || busy || activeJob() || observedPending || (!publicUrl(status) && !failedReconciliation() && !status?.removal_pending)) return;
    const discardingInterrupted = Boolean(failedReconciliation());
    busy = 'unpublish';
    invalidateReads();
    clearError();
    render();
    let removed = false;
    try {
      accept(readStatus(await request(endpoint, { method: 'DELETE' })));
      confirmingRemoval = false;
      publishIntent = null;
      removed = true;
      announce(discardingInterrupted ? 'La publication interrompue a été retirée. Votre projet et vos brouillons sont conservés.' : 'Le site a été retiré. Votre projet est conservé.');
    } catch (error) {
      showError(errorMessage(error, discardingInterrupted ? 'La publication interrompue n’a pas pu être retirée. Vos brouillons sont conservés. Réessayez.' : 'Le site n’a pas pu être retiré. Vérifiez son état, puis réessayez.'), retryUnpublish);
    } finally {
      busy = null;
      render();
      schedule();
      if (removed && !destroyed) {
        const primary = el<HTMLButtonElement>('[data-action="publish"]');
        (primary.hidden || primary.disabled ? el('[data-action="close"]') : primary).focus();
      }
    }
  }
  function retryUnpublish() {
    if ((!publicUrl(status) && !failedReconciliation() && !status?.removal_pending) || activeJob() || observedPending) void refresh();
    else { confirmingRemoval = true; void unpublish(); }
  }
  async function copy() {
    const url = publicUrl(status);
    if (!url || copying || destroyed) return;
    copying = true;
    render();
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Le presse papier n’est pas disponible dans ce navigateur.');
      await navigator.clipboard.writeText(url);
      if (!destroyed) {
        if (retry === retryCopy) clearError();
        announce('Adresse du site publiée copiée.');
      }
    } catch (error) {
      showError(errorMessage(error, 'Impossible de copier l’adresse. Vous pouvez la sélectionner dans le lien du site.'), retryCopy);
    } finally { copying = false; render(); }
  }
  function retryCopy() { void copy(); }
  function onInput(event: Event) {
    if (!(event.target instanceof HTMLElement) || !form.contains(event.target)) return;
    dirty = true;
    publishIntent = null;
    const target = event.target as HTMLInputElement;
    updatePreview(event.type === 'change' && ['favicon', 'image'].includes(target.name));
    if (target.name) {
      target.removeAttribute('aria-invalid');
      const fieldError = dialog.querySelector<HTMLElement>(`[data-field-error="${target.name}"]`);
      if (fieldError) fieldError.hidden = true;
    }
  }
  function onSubmit(event: Event) { event.preventDefault(); void publish(); }
  function onClick(event: MouseEvent) {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button[data-action]') : null;
    if (!button || button.disabled) return;
    switch (button.dataset.action) {
      case 'close': close(); break;
      case 'retry': retry?.(); break;
      case 'refresh': void refresh(); break;
      case 'resume': void resume(); break;
      case 'manage-domains': if (options.onManageDomains) { close(); options.onManageDomains(); } break;
      case 'copy': void copy(); break;
      case 'unpublish': confirmingRemoval = true; render(); el('[data-action="cancel-unpublish"]').focus(); break;
      case 'cancel-unpublish': confirmingRemoval = false; if (retry === retryUnpublish) clearError(); render(); el('[data-action="unpublish"]').focus(); break;
      case 'confirm-unpublish': void unpublish(); break;
    }
  }
  function focusable(): HTMLElement[] {
    return Array.from(dialog.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], summary, [tabindex]')).filter(node => {
      if (node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden], [inert]')) return false;
      const details = node.closest('details');
      return !details || details.open || node === details.querySelector('summary');
    });
  }
  function onKeydown(event: KeyboardEvent) {
    if (destroyed) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = focusable();
    const first = nodes[0] || dialog;
    const last = nodes[nodes.length - 1] || dialog;
    if (!dialog.contains(document.activeElement) || document.activeElement === dialog || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  function onFocus(event: FocusEvent) {
    if (!destroyed && event.target instanceof Node && !dialog.contains(event.target)) (focusable()[0] || dialog).focus();
  }
  function onCancel(event: Event) { event.preventDefault(); close(); }
  function onImageError(event: Event) {
    if (!(event.target instanceof HTMLImageElement)) return;
    event.target.hidden = true;
    if (event.target.hasAttribute('data-preview-image')) el('[data-image-error]').hidden = false;
  }
  const inerted: Array<{ node: HTMLElement; inert: boolean }> = [];
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(pollTimer);
    readController?.abort();
    dialog.removeEventListener('click', onClick);
    form.removeEventListener('submit', onSubmit);
    form.removeEventListener('input', onInput);
    form.removeEventListener('change', onInput);
    dialog.removeEventListener('cancel', onCancel);
    dialog.removeEventListener('close', close);
    dialog.removeEventListener('error', onImageError, true);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocus, true);
    for (const { node, inert } of inerted) node.inert = inert;
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function close() {
    if (destroyed) return;
    destroy();
    options.onClose?.();
  }
  dialog.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  form.addEventListener('input', onInput);
  form.addEventListener('change', onInput);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('close', close);
  dialog.addEventListener('error', onImageError, true);
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('focusin', onFocus, true);
  // Native dialog supplies top-layer modality. The fallback also isolates AT and pointer input.
  let nativeModal = false;
  try { dialog.showModal(); nativeModal = dialog.matches(':modal'); } catch { dialog.setAttribute('open', ''); }
  if (!nativeModal) {
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) { inerted.push({ node: sibling, inert: sibling.inert }); sibling.inert = true; }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
  }
  el('[data-action="close"]').focus();
  void refresh();
  return { destroy, refresh };
}
