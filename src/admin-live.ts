import { apiFetch } from './lib/api';
import { localConnectorLogo } from './lib/connector-logos';
import './styles/coden-shell.css';
import './styles/modern-shell.css';
import './styles/coherence.css';
import './styles/coden-horizon-system.css';
import { initCodenMotion } from './coden-motion';
import { initCodenNavigationTransitions } from './navigation-transitions';
import { initThemeController } from './theme-controller';

initCodenMotion();
initCodenNavigationTransitions();
initThemeController();

type JsonRecord = Record<string, any>;

type AdminState = {
  overview: JsonRecord | null;
  users: JsonRecord[];
  projects: JsonRecord[];
  runs: JsonRecord[];
  errors: JsonRecord | null;
  models: JsonRecord | null;
  publish: JsonRecord | null;
  security: JsonRecord | null;
  flags: JsonRecord[];
  learning: JsonRecord | null;
  integrations: JsonRecord | null;
  loading: boolean;
};

const state: AdminState = {
  overview: null,
  users: [],
  projects: [],
  runs: [],
  errors: null,
  models: null,
  publish: null,
  security: null,
  flags: [],
  learning: null,
  integrations: null,
  loading: true,
};

let allUsers: JsonRecord[] = [];
let allProjects: JsonRecord[] = [];
let allRuns: JsonRecord[] = [];
let globalQuery = '';
const activeFilters: Record<'users' | 'projects', string> = {
  users: 'all',
  projects: 'all',
};

const SECTION_LABELS: Record<string, string> = {
  overview: 'Vue d’ensemble',
  agent: 'Agent',
  users: 'Utilisateurs',
  projects: 'Projets',
  runs: 'Runs',
  errors: 'Erreurs',
  models: 'Modèles',
  integrations: 'Intégrations',
  publish: 'Publication',
  security: 'Sécurité',
  flags: 'Drapeaux',
  support: 'Support',
};

function qs<T extends HTMLElement = HTMLElement>(selector: string) {
  return document.querySelector<T>(selector);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusClass(value: unknown) {
  const status = String(value || 'unknown').toLowerCase();
  if (/ok|ready|success|completed|published|active|enabled|verified/.test(status)) return 'ok';
  if (/fail|error|blocked|denied|missing|disabled|expired|revoked/.test(status)) return 'failed';
  if (/warn|draft|running|pending|unknown|idle|initiated|initializing|needs_fix/.test(status)) return 'warning';
  return status.replace(/[^a-z0-9_-]/g, '') || 'warning';
}

/** The words people read; the class keeps the raw status. */
const STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  warning: 'À vérifier',
  failed: 'Échec',
  error: 'Erreur',
  completed: 'Terminé',
  running: 'En cours',
  queued: 'En file',
  cancelled: 'Annulé',
  blocked: 'Bloqué',
  verified: 'Vérifié',
  needs_fix: 'À corriger',
  idle: 'Inactif',
  draft: 'Brouillon',
  active: 'Actif',
  published: 'Publié',
  ready: 'Prêt',
  success: 'Réussi',
  pending: 'En attente',
  unknown: 'Inconnu',
  enabled: 'Activé',
  disabled: 'Désactivé',
  initiated: 'En attente',
  initializing: 'En attente',
  expired: 'Expiré',
  revoked: 'Révoqué',
  platform_admin: 'Admin plateforme',
  user: 'Utilisateur',
  high: 'Élevée',
  medium: 'Moyenne',
  low: 'Faible',
  critical: 'Critique',
};

function pill(value: unknown, label?: string) {
  const raw = String(value || 'unknown');
  const text = label ?? STATUS_LABELS[raw.toLowerCase()] ?? raw;
  return `<span class="status-pill ${statusClass(raw)}">${escapeHtml(text)}</span>`;
}

function formatDate(value: unknown) {
  if (!value) return 'Jamais';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('fr-FR') : String(value ?? '--');
}

function isRecent(value: unknown, hours = 24) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) && Date.now() - time <= hours * 60 * 60 * 1000;
}

function matchesQuery(row: JsonRecord, query = globalQuery) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return JSON.stringify(row).toLowerCase().includes(q);
}

function skeleton(rows = 5) {
  return `<div class="admin-skeleton" aria-label="Chargement">${Array.from({ length: rows }, () => '<div class="admin-skeleton-line"></div>').join('')}</div>`;
}

async function safeAdminFetch<T extends JsonRecord>(path: string, fallback: T): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Données admin indisponibles.';
    return {
      ...fallback,
      success: false,
      error: message,
      availability: {
        ...(fallback.availability || {}),
        endpoint: false,
      },
    };
  }
}

function metric(label: string, value: unknown, note = '', extra = '') {
  return `
    <article class="admin-card clickable" data-drawer-type="metric" data-drawer-id="${escapeHtml(label)}">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      ${note ? `<span class="metric-note">${escapeHtml(note)}</span>` : ''}
      ${extra}
    </article>
  `;
}

/** Daily bars from real rows: one bar per day over the window, empty days drawn flat. */
function dailyBars(dates: unknown[], days = 14) {
  const counts = new Map<string, number>();
  for (const value of dates) {
    const day = String(value || '').slice(0, 10);
    if (day) counts.set(day, (counts.get(day) || 0) + 1);
  }
  const series: Array<{ day: string; count: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    series.push({ day, count: counts.get(day) || 0 });
  }
  const max = Math.max(1, ...series.map(item => item.count));
  return `<div class="admin-bars" aria-hidden="true">${series.map(item => `<span style="height:${Math.max(8, Math.round((item.count / max) * 100))}%"${item.count ? '' : ' data-empty'} title="${escapeHtml(item.day)} : ${item.count}"></span>`).join('')}</div>`;
}

function ratio(positive: number, negative: number) {
  const total = positive + negative;
  if (!total) return '';
  const share = Math.round((positive / total) * 100);
  return `<div class="admin-ratio" aria-hidden="true"><span style="width:${share}%"></span><span style="width:${100 - share}%"></span></div>`;
}

function empty(message: string) {
  return `<div class="admin-empty">${escapeHtml(message)}</div>`;
}

function table(headers: string[], rows: string[][], emptyMessage = 'Aucune donnée pour le moment.') {
  if (!rows.length) return empty(emptyMessage);
  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
  `;
}

function drawerField(label: string, value: unknown) {
  return `<div class="drawer-field"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '--')}</strong></div>`;
}

function drawerJson(value: unknown) {
  return `<pre class="support-summary">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function openDrawer(title: string, subtitle: string, fields: Array<[string, unknown]>, raw?: unknown, actions = '') {
  const drawer = qs('#admin-drawer');
  const backdrop = qs('#admin-drawer-backdrop');
  const content = qs('#admin-drawer-content');
  if (!drawer || !content) return;
  content.innerHTML = `
    <h2 class="drawer-title">${escapeHtml(title)}</h2>
    <p class="drawer-subtitle">${escapeHtml(subtitle)}</p>
    ${actions ? `<div class="drawer-actions">${actions}</div>` : ''}
    <div class="drawer-grid">${fields.map(([label, value]) => drawerField(label, value)).join('')}</div>
    ${raw ? `<div style="margin-top:14px;">${drawerJson(raw)}</div>` : ''}
  `;
  drawer.classList.add('open');
  backdrop?.classList.add('open');
}

function closeDrawer() {
  qs('#admin-drawer')?.classList.remove('open');
  qs('#admin-drawer-backdrop')?.classList.remove('open');
}

function renderHealth(rows: JsonRecord[] = []) {
  if (!rows.length) return empty('Contrôles de santé indisponibles.');
  return `<div class="health-list">${rows.map(row => `
    <div class="health-row">
      <div><strong>${escapeHtml(row.label)}</strong><br><span>${escapeHtml(row.detail)}</span></div>
      ${pill(row.status)}
    </div>
  `).join('')}</div>`;
}

const AVAILABILITY_LABELS: Record<string, string> = {
  users: 'Utilisateurs',
  projects: 'Projets',
  agent_runs: 'Runs',
  ai_requests: 'Requêtes IA',
  deployments: 'Déploiements',
  credit_wallets: 'Portefeuilles',
  endpoint: 'Point d’accès admin',
};

function renderAvailability(availability: JsonRecord) {
  const entries = Object.entries(availability);
  if (!entries.length) return empty('Aucune donnée de disponibilité.');
  return `<div class="flag-list">${entries.map(([key, available]) => `
    <div class="flag-row">
      <div><strong>${escapeHtml(AVAILABILITY_LABELS[key] || key.replace(/_/g, ' '))}</strong><br><span>${available ? 'Table accessible' : 'Absente ou indisponible'}</span></div>
      ${pill(available ? 'ok' : 'warning')}
    </div>
  `).join('')}</div>`;
}

function renderOverview() {
  const root = qs('#admin-overview');
  if (!root) return;
  const overview = state.overview;
  if (!overview) {
    root.innerHTML = empty('Chargement de la vue d’ensemble…');
    return;
  }
  const metrics = overview.metrics || {};
  const learning = state.learning;
  const integrations = state.integrations;
  root.innerHTML = [
    metric('Utilisateurs', formatNumber(metrics.users ?? 0), `${formatNumber(metrics.active_today ?? 0)} actifs aujourd’hui`),
    metric('Projets', formatNumber(metrics.projects ?? 0), `${formatNumber(metrics.previews_ready ?? 0)} aperçus vérifiés`),
    metric('Réussite des runs', `${metrics.success_rate ?? 100} %`, `${formatNumber(metrics.failed_runs ?? 0)} runs en échec`, dailyBars(allRuns.map(run => run.created_at))),
    metric('Publications', formatNumber(metrics.publish_success ?? 0), 'Déploiements réussis'),
    metric('Apprentissage', formatNumber(learning?.signals?.total ?? 0), learning ? `${formatNumber(learning.knowledge?.visible_patterns ?? 0)} schémas partagés · ${learning.personalization?.share_rate ?? 100} % partagent` : 'Signaux des 30 derniers jours'),
    metric('Intégrations', integrations?.configured ? formatNumber(integrations?.totals?.active ?? 0) : 'Inactives', integrations?.configured ? `${formatNumber(integrations?.totals?.users ?? 0)} comptes · ${formatNumber(integrations?.totals?.toolkits ?? 0)} services` : 'COMPOSIO_API_KEY manquante'),
    `<article class="admin-card wide"><span class="panel-label">Santé des services</span>${renderHealth(overview.health || [])}</article>`,
    `<article class="admin-card"><span class="panel-label">Données</span>${renderAvailability(overview.availability || {})}</article>`,
    `<article class="admin-card full"><span class="panel-label">Derniers runs en échec</span>${renderFailedRuns(overview.recent?.failed_runs || [])}</article>`,
  ].join('');
}

const TASK_LABELS: Record<string, string> = {
  code_generation: 'Génération',
  code_edit: 'Modification',
  general: 'Général',
};

const SIGNAL_LABELS: Record<string, string> = {
  run: 'Runs',
  error_fixed: 'Erreurs corrigées',
  retry: 'Relances',
  feedback: 'Avis 👍/👎',
  revert: 'Versions restaurées',
};

function renderAgent() {
  const root = qs('#admin-agent');
  if (!root) return;
  const learning = state.learning;
  if (!learning) {
    root.innerHTML = skeleton(4);
    return;
  }
  if (learning.success === false) {
    root.innerHTML = `<article class="admin-card full">${empty(learning.error || 'Les données d’apprentissage sont indisponibles.')}</article>`;
    return;
  }
  const signals = learning.signals || {};
  const knowledge = learning.knowledge || {};
  const personalization = learning.personalization || {};
  const routing = learning.routing || {};
  const perDay: JsonRecord[] = signals.per_day || [];
  const runDates = perDay.flatMap(day => Array.from({ length: Number(day.runs) || 0 }, () => day.day));
  root.innerHTML = `
    ${metric('Signaux (30 j)', formatNumber(signals.total ?? 0), `${formatNumber(signals.shared ?? 0)} partagés avec la base commune`, dailyBars(runDates, 30))}
    ${metric('Réussite mesurée', signals.run_success_rate === null || signals.run_success_rate === undefined ? '--' : `${signals.run_success_rate} %`, `${formatNumber(signals.runs ?? 0)} runs · ${formatNumber(signals.errors_fixed ?? 0)} erreurs corrigées`)}
    ${metric('Avis utilisateurs', `${formatNumber(signals.feedback_positive ?? 0)} 👍 · ${formatNumber(signals.feedback_negative ?? 0)} 👎`, `${formatNumber(signals.reverts ?? 0)} versions restaurées · ${formatNumber(signals.retries ?? 0)} relances`, ratio(Number(signals.feedback_positive) || 0, Number(signals.feedback_negative) || 0))}
    ${metric('Base commune', formatNumber(knowledge.visible_patterns ?? 0), `schémas visibles (≥ ${knowledge.min_contributors ?? 2} contributeurs) · ${formatNumber(knowledge.patterns ?? 0)} observés · ${formatNumber(knowledge.curated ?? 0)} curés`)}
    ${metric('Partage des données', `${personalization.share_rate ?? 100} %`, `${formatNumber(personalization.opted_out ?? 0)} désinscription${Number(personalization.opted_out) > 1 ? 's' : ''} sur ${formatNumber(personalization.users ?? 0)} comptes`)}
    ${metric('Personnalisation', formatNumber(personalization.with_instructions ?? 0), `comptes avec des instructions · mémoire privée pour ${formatNumber(personalization.memory_users ?? 0)}`)}
    <article class="admin-card full">
      <div class="admin-panel-head">
        <div>
          <span class="panel-label">Routeur Auto · taux de réussite par modèle</span>
          <p class="metric-note">Lissés vers 70 % tant que les runs sont peu nombreux. Un modèle n’influence Auto qu’à partir de ${formatNumber(routing.min_runs ?? 8)} runs et 12 points d’avance.</p>
        </div>
      </div>
      ${table(['Tâche', 'Modèle', 'Runs', 'Réussite brute', 'Réussite lissée', 'Fiabilité'], (routing.stats || []).filter((row: JsonRecord) => matchesQuery(row)).slice(0, 60).map((row: JsonRecord) => [
        escapeHtml(TASK_LABELS[row.task_type] || row.task_type),
        `<code>${escapeHtml(row.model_id)}</code>`,
        escapeHtml(formatNumber(row.runs)),
        escapeHtml(`${row.success_rate} %`),
        `<strong>${escapeHtml(`${row.smoothed_rate} %`)}</strong>`,
        pill(row.reliable ? 'ok' : 'warning', row.reliable ? 'Pris en compte' : 'Trop peu de runs'),
      ]), 'Aucun run mesuré sur les 30 derniers jours.')}
    </article>
    <article class="admin-card wide">
      <span class="panel-label">Schémas partagés les plus confirmés</span>
      ${table(['Schéma', 'Type', 'Contributeurs'], (knowledge.top || []).filter((row: JsonRecord) => matchesQuery(row)).map((row: JsonRecord) => [
        `<div class="admin-pattern"><span>${escapeHtml(row.content)}</span><small>${escapeHtml(TASK_LABELS[row.task_type] || row.task_type)} · vu le ${escapeHtml(formatDate(row.last_seen))}</small></div>`,
        pill(row.kind === 'error_fix' ? 'ok' : 'warning', row.kind === 'error_fix' ? 'Correction' : row.kind === 'stack_pattern' ? 'Stack' : row.kind),
        escapeHtml(formatNumber(row.contributors)),
      ]), 'Aucun schéma n’a encore été confirmé par deux contributeurs. Les entrées curées servent en attendant.')}
    </article>
    <article class="admin-card">
      <span class="panel-label">Signaux par type</span>
      <div class="flag-list">${Object.entries(signals.by_kind || {}).map(([kind, count]) => `
        <div class="flag-row"><div><strong>${escapeHtml(SIGNAL_LABELS[kind] || kind)}</strong></div><span class="metric-note">${escapeHtml(formatNumber(count))}</span></div>
      `).join('') || empty('Aucun signal.')}</div>
      <p class="metric-note" style="margin-top:12px;">Signaux sans contenu : ni prompt, ni fichier, ni instruction ne quittent le compte de l’utilisateur.</p>
    </article>
  `;
}

function toolkitCell(slug: string) {
  const logo = localConnectorLogo(slug);
  const name = slug.replace(/[-_]/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  return `<span class="admin-toolkit"><span class="admin-toolkit-logo">${logo ? `<img src="${escapeHtml(logo)}" alt="" loading="lazy">` : escapeHtml(name.slice(0, 2).toUpperCase())}</span>${escapeHtml(name)}</span>`;
}

function renderIntegrations() {
  const root = qs('#admin-integrations');
  if (!root) return;
  const data = state.integrations;
  if (!data) {
    root.innerHTML = skeleton(4);
    return;
  }
  if (!data.configured) {
    root.innerHTML = `
      ${metric('Composio', 'Non configuré', 'Ajoutez COMPOSIO_API_KEY dans les variables Railway')}
      <article class="admin-card wide"><span class="panel-label">Effet</span>${empty('Les utilisateurs voient les services phares en « Bientôt » ; l’agent propose Coden Cloud quand une app a besoin d’un backend.')}</article>
    `;
    return;
  }
  if (data.success === false) {
    root.innerHTML = `
      ${metric('Composio', 'Erreur', data.error || 'Composio ne répond pas')}
      <article class="admin-card wide">${empty('Vérifiez la clé COMPOSIO_API_KEY : une clé refusée par Composio apparaît ici.')}</article>
    `;
    return;
  }
  const totals = data.totals || {};
  root.innerHTML = `
    ${metric('Connexions actives', formatNumber(totals.active ?? 0), `${formatNumber(totals.connections ?? 0)} au total`)}
    ${metric('Comptes connectés', formatNumber(totals.users ?? 0), 'Utilisateurs Coden avec au moins un service')}
    ${metric('Services utilisés', formatNumber(totals.toolkits ?? 0), data.catalogue_total ? `sur ${formatNumber(data.catalogue_total)} disponibles dans le catalogue` : 'Catalogue Composio')}
    <article class="admin-card full"><span class="panel-label">Par service</span>${table(['Service', 'Actives', 'En attente', 'En échec', 'Comptes'], (data.by_toolkit || []).filter((row: JsonRecord) => matchesQuery(row)).map((row: JsonRecord) => [
      toolkitCell(row.toolkit),
      escapeHtml(formatNumber(row.active)),
      escapeHtml(formatNumber(row.pending)),
      escapeHtml(formatNumber(row.failed)),
      escapeHtml(formatNumber(row.users)),
    ]), 'Aucune connexion pour le moment.')}</article>
    <article class="admin-card full"><span class="panel-label">Connexions récentes</span>${table(['Service', 'Statut', 'Compte', 'Créée'], (data.recent || []).filter((row: JsonRecord) => matchesQuery(row)).map((row: JsonRecord) => [
      toolkitCell(row.toolkit),
      pill(String(row.status || '').toLowerCase()),
      row.user_id ? `<button class="admin-button subtle" data-drawer-type="user" data-drawer-id="${escapeHtml(row.user_id)}" type="button">${escapeHtml(String(row.user_id).slice(0, 8))}…</button>` : '--',
      escapeHtml(formatDate(row.created_at)),
    ]), 'Aucune connexion récente.')}</article>
  `;
}

function renderUsers() {
  const root = qs('#admin-users');
  if (!root) return;
  const rows = state.users
    .filter(user => matchesQuery(user))
    .filter(user => {
      if (activeFilters.users === 'admin') return Boolean(user.is_platform_admin);
      if (activeFilters.users === 'active') return isRecent(user.last_sign_in_at, 24);
      if (activeFilters.users === 'no-email') return !user.email;
      return true;
    });
  root.innerHTML = table(['Utilisateur', 'Crédits', 'Projets', 'Runs', 'Dernière connexion', 'Rôle', 'Action'], rows.map(user => [
    `<strong>${escapeHtml(user.email || 'Sans e-mail')}</strong><br><span>${escapeHtml(user.id)}</span>`,
    `<strong>${escapeHtml(user.wallet?.balance ?? '--')}</strong><br><span>crédits visibles</span>`,
    escapeHtml(user.project_count ?? 0),
    escapeHtml(user.run_count ?? 0),
    escapeHtml(formatDate(user.last_sign_in_at)),
    pill(user.is_platform_admin ? 'platform_admin' : user.role || 'user'),
    `<button class="admin-button" data-drawer-type="user" data-drawer-id="${escapeHtml(user.id)}" type="button">Détails</button>`,
  ]));
}

function renderProjects() {
  const root = qs('#admin-projects');
  if (!root) return;
  const rows = state.projects
    .filter(project => matchesQuery(project))
    .filter(project => {
      if (activeFilters.projects === 'preview-ready') return project.preview_status === 'verified';
      if (activeFilters.projects === 'published') return Boolean(project.live_url) || /published|ready|success/i.test(String(project.publish_status || ''));
      if (activeFilters.projects === 'needs-attention') return /fail|error|blocked|unknown|not_ready|needs_fix/i.test(`${project.preview_status} ${project.publish_status}`);
      return true;
    });
  root.innerHTML = table(['Projet', 'Propriétaire', 'Aperçu', 'Publication', 'Fichiers', 'Mis à jour', 'Action'], rows.map(project => [
    `<strong>${escapeHtml(project.name)}</strong><br><span class="admin-mono" aria-label="Identifiant de l’application">ID · ${escapeHtml(project.id)}</span>`,
    escapeHtml(project.owner_id || '--'),
    pill(project.preview_status),
    pill(project.publish_status || (project.live_url ? 'published' : 'draft')),
    escapeHtml(project.file_count ?? '--'),
    escapeHtml(formatDate(project.updated_at)),
    `<button class="admin-button" data-drawer-type="project" data-drawer-id="${escapeHtml(project.id)}" type="button">Détails</button>
     <button class="admin-button subtle" data-open-project="${escapeHtml(project.id)}" type="button">Ouvrir</button>`,
  ]));
}

function renderFailedRuns(rows: JsonRecord[]) {
  return table(['Requête', 'Intention', 'Modèle', 'Diagnostic', 'Quand', 'Action'], rows.map(run => [
    `<strong>${escapeHtml(run.request_id || run.id)}</strong><br><span>${escapeHtml(run.project_id || '--')}</span>`,
    escapeHtml(run.intent || '--'),
    escapeHtml(run.model_id || 'Auto'),
    escapeHtml(run.diagnostic_code || run.suggested_action || '--'),
    escapeHtml(formatDate(run.created_at)),
    `<button class="admin-button" data-drawer-type="run" data-drawer-id="${escapeHtml(run.id)}" type="button">Détails</button>`,
  ]), 'Aucun run en échec. 🎉');
}

function renderRuns() {
  const root = qs('#admin-runs');
  if (!root) return;
  const distributions = state.overview?.distributions || {};
  const intents = Object.entries(distributions.run_intent || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  root.innerHTML = `
    ${metric('Runs observés', formatNumber(state.runs.length), '500 derniers runs d’agent', dailyBars(state.runs.map(run => run.created_at)))}
    ${metric('En échec', formatNumber(state.runs.filter(run => run.status === 'failed').length), 'À examiner')}
    ${metric('Durée moyenne', averageDuration(state.runs), 'Runs terminés')}
    <article class="admin-card full"><span class="panel-label">Runs récents</span>${table(['Run', 'Statut', 'Intention', 'Modèle', 'Durée', 'Créé', 'Action'], state.runs.filter(run => matchesQuery(run)).slice(0, 80).map(run => [
      `<strong>${escapeHtml(run.request_id || run.id)}</strong><br><span>${escapeHtml(run.project_id || '--')}</span>`,
      pill(run.status),
      escapeHtml(run.intent || '--'),
      escapeHtml(run.model_id || 'Auto'),
      escapeHtml(`${Math.round(Number(run.duration_ms || 0) / 1000)} s`),
      escapeHtml(formatDate(run.created_at)),
      `<button class="admin-button" data-drawer-type="run" data-drawer-id="${escapeHtml(run.id)}" type="button">Détails</button>`,
    ]))}</article>
    <article class="admin-card full"><span class="panel-label">Répartition des intentions</span>${table(['Intention', 'Runs'], intents.map(([intent, count]) => [escapeHtml(intent), escapeHtml(formatNumber(count))]))}</article>
  `;
}

function averageDuration(rows: JsonRecord[]) {
  const durations = rows.map(row => Number(row.duration_ms || 0)).filter(value => value > 0);
  if (!durations.length) return '0 s';
  return `${Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000)} s`;
}

function renderErrors() {
  const root = qs('#admin-errors');
  if (!root) return;
  const failedRuns = state.errors?.errors?.failed_runs || [];
  const runnerFailures = state.errors?.errors?.runner_failures || [];
  root.innerHTML = `
    ${metric('Runs en échec', formatNumber(failedRuns.length), 'Échecs récents au niveau du run')}
    ${metric('Contrôles en échec', formatNumber(runnerFailures.length), 'Build, aperçu ou contrôle qualité')}
    ${metric('Diagnostic le plus fréquent', topKey(state.errors?.grouped?.diagnostic_code), 'Cause dominante')}
    <article class="admin-card full"><span class="panel-label">Runs en échec</span>${renderFailedRuns(failedRuns.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80))}</article>
    <article class="admin-card full"><span class="panel-label">Contrôles en échec</span>${table(['Run', 'Contrôle', 'Gravité', 'Message', 'Quand', 'Action'], runnerFailures.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80).map((row: JsonRecord) => [
      escapeHtml(row.agent_run_id || '--'),
      escapeHtml(row.check_type || '--'),
      pill(row.severity || row.status),
      escapeHtml(row.message || '--'),
      escapeHtml(formatDate(row.created_at)),
      `<button class="admin-button" data-drawer-type="runner_failure" data-drawer-id="${escapeHtml(row.agent_run_id || row.created_at || '')}" type="button">Détails</button>`,
    ]))}</article>
  `;
}

function topKey(record: JsonRecord = {}) {
  const entries = Object.entries(record).sort((a, b) => Number(b[1]) - Number(a[1]));
  return entries[0]?.[0] || '--';
}

function renderModels() {
  const root = qs('#admin-models');
  if (!root) return;
  const costs = state.models?.costs || [];
  const providers = state.models?.providers || [];
  const margins = state.models?.margins || [];
  const byModel = Object.entries(costs.reduce((acc: Record<string, number>, row: JsonRecord) => {
    const key = String(row.model_id || 'Auto');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {})).sort((a, b) => Number(b[1]) - Number(a[1]));
  root.innerHTML = `
    ${metric('Requêtes IA', formatNumber(costs.length), 'Lignes récentes')}
    ${metric('Usage fournisseurs', formatNumber(providers.length), 'Événements d’usage fournisseur')}
    ${metric('Contrôles de marge', formatNumber(margins.length), 'Échantillons de garde-fous de coût')}
    <article class="admin-card wide"><span class="panel-label">Requêtes par modèle</span>${table(['Modèle', 'Requêtes'], byModel.map(([model, count]) => [`<code>${escapeHtml(model)}</code>`, escapeHtml(formatNumber(count))]))}</article>
    <article class="admin-card full"><span class="panel-label">Requêtes récentes</span>${table(['Modèle', 'Type', 'Statut', 'Projet', 'Quand'], costs.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80).map((row: JsonRecord) => [
      escapeHtml(row.model_id || 'Auto'),
      escapeHtml(row.request_type || '--'),
      pill(row.status),
      escapeHtml(row.project_id || '--'),
      escapeHtml(formatDate(row.created_at)),
    ]))}</article>
  `;
}

function renderPublish() {
  const root = qs('#admin-publish');
  if (!root) return;
  const deployments = state.publish?.deployments || [];
  const domains = state.publish?.domains || [];
  root.innerHTML = `
    ${metric('Déploiements', formatNumber(deployments.length), 'Publications récentes', dailyBars(deployments.map((row: JsonRecord) => row.created_at)))}
    ${metric('Domaines', formatNumber(domains.length), 'Domaines personnalisés')}
    ${metric('En ligne', formatNumber(deployments.filter((row: JsonRecord) => /ready|success|published|completed/i.test(row.status)).length), 'Déploiements réussis')}
    <article class="admin-card full"><span class="panel-label">Déploiements</span>${table(['Déploiement', 'Projet', 'Statut', 'Adresse', 'Quand', 'Action'], deployments.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 100).map((row: JsonRecord) => [
      escapeHtml(row.id || '--'),
      escapeHtml(row.project_id || '--'),
      pill(row.status),
      row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url)}</a>` : '--',
      escapeHtml(formatDate(row.created_at)),
      `<button class="admin-button" data-drawer-type="deployment" data-drawer-id="${escapeHtml(row.id || row.url || '')}" type="button">Détails</button>`,
    ]))}</article>
  `;
}

function renderSecurity() {
  const root = qs('#admin-security');
  if (!root) return;
  const findings = state.security?.findings || [];
  const checklist = state.security?.checklist || [];
  root.innerHTML = `
    ${metric('Alertes ouvertes', formatNumber(state.security?.summary?.open_findings ?? 0), 'Résultats de sécurité des contrôles')}
    ${metric('Projets analysés', formatNumber(state.security?.summary?.projects_observed ?? 0), 'Projets récents')}
    ${metric('Garde admin', state.security?.summary?.admin_guard === 'enabled' || !state.security?.summary?.admin_guard ? 'Active' : state.security.summary.admin_guard, 'Routes serveur protégées')}
    <article class="admin-card wide"><span class="panel-label">Liste de contrôle</span><div class="health-list">${checklist.map((item: JsonRecord) => `
      <div class="health-row"><div><strong>${escapeHtml(item.label)}</strong></div>${pill(item.status)}</div>
    `).join('') || empty('Aucun contrôle.')}</div></article>
    <article class="admin-card full"><span class="panel-label">Alertes</span>${table(['Run', 'Contrôle', 'Gravité', 'Message'], findings.slice(0, 80).map((row: JsonRecord) => [
      escapeHtml(row.agent_run_id || '--'),
      escapeHtml(row.check_type || '--'),
      pill(row.severity || row.status),
      escapeHtml(row.message || '--'),
    ]), 'Aucune alerte de sécurité.')}</article>
  `;
}

function renderFlags() {
  const root = qs('#admin-flags');
  if (!root) return;
  root.innerHTML = `
    <article class="admin-card full">
      <div class="admin-panel-head">
        <div>
          <span class="panel-label">Drapeaux de fonctionnalités</span>
          <p class="metric-note">Lus depuis l’environnement du serveur. Ils se modifient dans les variables Railway, pas ici.</p>
        </div>
        ${pill('ok', `${state.flags.filter(flag => flag.enabled).length} / ${state.flags.length} actifs`)}
      </div>
      <div class="flag-list" style="margin-top:12px;">
        ${state.flags.map(flag => `
          <div class="flag-row">
            <div>
              <strong>${escapeHtml(flag.label)}</strong>
              <br>
              <span>${escapeHtml(flag.key)}</span>
            </div>
            <div class="flag-meta">
              <span>${escapeHtml(flag.rollout || 'tous')}</span>
              <span>risque ${escapeHtml(STATUS_LABELS[flag.risk] || flag.risk || 'moyen').toLowerCase()}</span>
              ${pill(flag.enabled ? 'enabled' : 'disabled')}
            </div>
          </div>
        `).join('') || empty('Aucun drapeau.')}
      </div>
    </article>
  `;
}

function buildSupportSummary() {
  const overview = state.overview?.metrics || {};
  const failed = state.errors?.errors?.failed_runs?.[0];
  const learning = state.learning;
  const integrations = state.integrations;
  return [
    'Coden · résumé support',
    `Généré le : ${new Date().toLocaleString('fr-FR')}`,
    `Utilisateurs : ${overview.users ?? 0}`,
    `Projets : ${overview.projects ?? 0}`,
    `Réussite des runs : ${overview.success_rate ?? 100} %`,
    `Runs en échec : ${overview.failed_runs ?? 0}`,
    failed ? `Dernier échec : ${failed.request_id || failed.id} / ${failed.diagnostic_code || failed.status}` : 'Dernier échec : aucun',
    learning ? `Apprentissage : ${learning.signals?.total ?? 0} signaux (30 j), ${learning.knowledge?.visible_patterns ?? 0} schémas partagés, ${learning.personalization?.share_rate ?? 100} % de partage` : 'Apprentissage : indisponible',
    integrations?.configured ? `Intégrations : ${integrations.totals?.active ?? 0} connexions actives, ${integrations.totals?.users ?? 0} comptes` : 'Intégrations : Composio non configuré',
    'Secrets : masqués par l’API admin',
  ].join('\n');
}

function renderSupport() {
  const root = qs('#admin-support');
  if (!root) return;
  root.innerHTML = `<pre class="support-summary">${escapeHtml(buildSupportSummary())}</pre>`;
}

function renderAll() {
  renderOverview();
  renderAgent();
  renderUsers();
  renderProjects();
  renderRuns();
  renderErrors();
  renderModels();
  renderIntegrations();
  renderPublish();
  renderSecurity();
  renderFlags();
  renderSupport();
}

async function loadAdminData() {
  try {
    qs('#admin-overview')!.innerHTML = skeleton(6);
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Actualisation…';
    const [overview, users, projects, runs, errors, costs, providers, margins, publish, security, flags, learning, integrations] = await Promise.all([
      safeAdminFetch('/api/admin/overview', { metrics: {}, health: [], availability: {}, distributions: {}, recent: { failed_runs: [] } }),
      safeAdminFetch('/api/admin/users', { users: [], availability: {} }),
      safeAdminFetch('/api/admin/projects', { projects: [], availability: {} }),
      safeAdminFetch('/api/admin/runs', { runs: [], distributions: {}, availability: {} }),
      safeAdminFetch('/api/admin/errors', { errors: { failed_runs: [], runner_failures: [] }, grouped: {}, availability: {} }),
      safeAdminFetch('/api/admin/ai-costs', { rows: [], availability: {} }),
      safeAdminFetch('/api/admin/provider-usage', { rows: [], availability: {} }),
      safeAdminFetch('/api/admin/billing/margins', { rows: [], guardrails: {}, availability: {} }),
      safeAdminFetch('/api/admin/publish', { deployments: [], domains: [], availability: {}, grouped: {} }),
      safeAdminFetch('/api/admin/security', { summary: {}, checklist: [], findings: [], availability: {} }),
      safeAdminFetch('/api/admin/feature-flags', { flags: [], availability: {} }),
      safeAdminFetch('/api/admin/agent-learning', { signals: {}, knowledge: {}, personalization: {}, routing: { stats: [] }, availability: {} }),
      safeAdminFetch('/api/admin/integrations', { configured: false, by_toolkit: [], recent: [], totals: {} }),
    ]);
    state.overview = overview;
    allUsers = users.users || [];
    allProjects = projects.projects || [];
    allRuns = runs.runs || [];
    state.users = allUsers;
    state.projects = allProjects;
    state.runs = allRuns;
    state.errors = errors;
    state.models = { costs: costs.rows || [], providers: providers.rows || [], margins: margins.rows || [], guardrails: margins.guardrails };
    state.publish = publish;
    state.security = security;
    state.flags = flags.flags || [];
    state.learning = learning;
    state.integrations = integrations;
    renderAll();
    if (liveStatus) liveStatus.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Impossible de charger les données admin.';
    const root = qs('#admin-overview');
    if (root) root.innerHTML = `<div class="admin-error">${escapeHtml(message)}</div>`;
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Données indisponibles';
  }
}

function activateSection(tab: string) {
  document.querySelectorAll<HTMLElement>('[data-admin-tab]').forEach(item => {
    const active = item.dataset.adminTab === tab;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll<HTMLElement>('[data-section]').forEach(section => section.classList.toggle('active', section.dataset.section === tab));
  const crumb = qs('[data-admin-crumb]');
  if (crumb) crumb.textContent = `/ ${SECTION_LABELS[tab] || tab}`;
  try { history.replaceState(null, '', `#${tab}`); } catch { /* the hash is a convenience */ }
}

function bindNavigation() {
  document.querySelectorAll<HTMLButtonElement>('[data-admin-tab]').forEach(button => {
    button.addEventListener('click', () => activateSection(button.dataset.adminTab || 'overview'));
  });
  const initial = window.location.hash.replace('#', '');
  if (initial && SECTION_LABELS[initial]) activateSection(initial);
}

function bindFilters() {
  qs<HTMLInputElement>('#admin-user-search')?.addEventListener('input', event => {
    const value = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    state.users = allUsers.filter(user => !value || String(user.email || '').toLowerCase().includes(value) || String(user.id || '').toLowerCase().includes(value));
    renderUsers();
  });
  qs<HTMLInputElement>('#admin-project-search')?.addEventListener('input', event => {
    const value = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    state.projects = allProjects.filter(project => !value || String(project.name || '').toLowerCase().includes(value) || String(project.id || '').toLowerCase().includes(value) || String(project.owner_id || '').toLowerCase().includes(value));
    renderProjects();
  });
  qs<HTMLInputElement>('#admin-global-search')?.addEventListener('input', event => {
    globalQuery = (event.currentTarget as HTMLInputElement).value.trim().toLowerCase();
    renderAll();
  });
  document.querySelectorAll<HTMLButtonElement>('[data-filter-group][data-filter-value], [data-filter-group] [data-filter-value]').forEach(button => {
    button.addEventListener('click', () => {
      const group = button.closest<HTMLElement>('[data-filter-group]')?.dataset.filterGroup as 'users' | 'projects' | undefined;
      if (!group) return;
      activeFilters[group] = button.dataset.filterValue || 'all';
      button.closest('[data-filter-group]')?.querySelectorAll('[data-filter-value]').forEach(chip => chip.classList.toggle('active', chip === button));
      if (group === 'users') renderUsers();
      if (group === 'projects') renderProjects();
    });
  });
}

function openEntityDrawer(type: string, id: string) {
  if (type === 'metric') {
    openDrawer(id, 'Contexte de l’indicateur', [
      ['Valeur', 'Voir les cartes et les tableaux de la section'],
      ['Astuce', 'La recherche globale filtre les utilisateurs, projets, runs et connexions derrière ce signal'],
    ]);
    return;
  }

  if (type === 'user') {
    const user = allUsers.find(row => String(row.id) === id);
    if (!user) {
      openDrawer('Compte', 'Ce compte n’apparaît pas dans les 500 derniers utilisateurs chargés.', [['Identifiant', id]], undefined, `<button class="admin-button" data-copy-value="${escapeHtml(id)}" type="button">Copier l’identifiant</button>`);
      return;
    }
    openDrawer(user.email || 'Utilisateur', 'Compte, activité et crédits visibles.', [
      ['Identifiant', user.id],
      ['E-mail', user.email || '--'],
      ['Dernière connexion', formatDate(user.last_sign_in_at)],
      ['Projets', user.project_count ?? 0],
      ['Runs', user.run_count ?? 0],
      ['Crédits', user.wallet?.balance ?? '--'],
      ['Rôle', user.is_platform_admin ? 'Admin plateforme' : STATUS_LABELS[user.role] || user.role || 'Utilisateur'],
    ], user, `<button class="admin-button" data-copy-value="${escapeHtml(user.id)}" type="button">Copier l’identifiant</button>`);
    return;
  }

  if (type === 'project') {
    const project = allProjects.find(row => String(row.id) === id);
    if (!project) return;
    openDrawer(project.name || 'Projet', 'Aperçu, publication et propriétaire.', [
      ['Identifiant', project.id],
      ['Propriétaire', project.owner_id || '--'],
      ['Aperçu', STATUS_LABELS[project.preview_status] || project.preview_status || '--'],
      ['Publication', STATUS_LABELS[project.publish_status] || project.publish_status || (project.live_url ? 'Publié' : 'Brouillon')],
      ['Adresse publique', project.live_url || '--'],
      ['Fichiers', project.file_count ?? '--'],
      ['Mis à jour', formatDate(project.updated_at)],
    ], project, `
      <button class="admin-button" data-open-project="${escapeHtml(project.id)}" type="button">Ouvrir dans le Builder</button>
      <button class="admin-button subtle" data-copy-value="${escapeHtml(project.id)}" type="button">Copier l’identifiant</button>
    `);
    return;
  }

  if (type === 'run') {
    const runs = [
      ...allRuns,
      ...(state.errors?.errors?.failed_runs || []),
    ];
    const run = runs.find((row: JsonRecord) => String(row.id) === id || String(row.request_id) === id);
    if (!run) return;
    openDrawer(run.request_id || run.id || 'Run', 'Exécution de l’agent et diagnostic.', [
      ['Run', run.id || '--'],
      ['Requête', run.request_id || '--'],
      ['Projet', run.project_id || '--'],
      ['Utilisateur', run.user_id || '--'],
      ['Statut', STATUS_LABELS[run.status] || run.status || '--'],
      ['Intention', run.intent || '--'],
      ['Modèle', run.model_id || 'Auto'],
      ['Diagnostic', run.diagnostic_code || run.suggested_action || '--'],
      ['Durée', `${Math.round(Number(run.duration_ms || 0) / 1000)} s`],
      ['Créé', formatDate(run.created_at)],
    ], run, `
      ${run.project_id ? `<button class="admin-button" data-open-project="${escapeHtml(run.project_id)}" type="button">Ouvrir le projet</button>` : ''}
      <button class="admin-button subtle" data-copy-value="${escapeHtml(run.request_id || run.id || '')}" type="button">Copier la requête</button>
    `);
    return;
  }

  if (type === 'deployment') {
    const deployment = (state.publish?.deployments || []).find((row: JsonRecord) => String(row.id || row.url) === id);
    if (!deployment) return;
    openDrawer(deployment.url || deployment.id || 'Déploiement', 'Statut de publication et adresse publique.', [
      ['Déploiement', deployment.id || '--'],
      ['Projet', deployment.project_id || '--'],
      ['Statut', STATUS_LABELS[deployment.status] || deployment.status || '--'],
      ['Adresse', deployment.url || '--'],
      ['Domaine', deployment.domain || '--'],
      ['Créé', formatDate(deployment.created_at)],
    ], deployment, `
      ${deployment.url ? `<a class="admin-button" href="${escapeHtml(deployment.url)}" target="_blank" rel="noreferrer">Voir en ligne</a>` : ''}
      ${deployment.project_id ? `<button class="admin-button subtle" data-open-project="${escapeHtml(deployment.project_id)}" type="button">Ouvrir le projet</button>` : ''}
    `);
    return;
  }

  if (type === 'runner_failure') {
    const failure = (state.errors?.errors?.runner_failures || []).find((row: JsonRecord) => String(row.agent_run_id || row.created_at || '') === id);
    if (!failure) return;
    openDrawer(failure.check_type || 'Contrôle en échec', 'Échec d’un contrôle build, navigateur ou qualité.', [
      ['Run', failure.agent_run_id || '--'],
      ['Contrôle', failure.check_type || '--'],
      ['Gravité', STATUS_LABELS[failure.severity] || failure.severity || failure.status || '--'],
      ['Message', failure.message || '--'],
      ['Créé', formatDate(failure.created_at)],
    ], failure, `<button class="admin-button subtle" data-copy-value="${escapeHtml(failure.agent_run_id || '')}" type="button">Copier l’identifiant du run</button>`);
  }
}

function bindActions() {
  qs('#admin-refresh')?.addEventListener('click', () => void loadAdminData());
  qs('#admin-clear-filters')?.addEventListener('click', () => {
    globalQuery = '';
    const globalInput = qs<HTMLInputElement>('#admin-global-search');
    if (globalInput) globalInput.value = '';
    activeFilters.users = 'all';
    activeFilters.projects = 'all';
    document.querySelectorAll<HTMLElement>('[data-filter-group]').forEach(group => {
      group.querySelectorAll<HTMLElement>('[data-filter-value]').forEach(chip => chip.classList.toggle('active', chip.dataset.filterValue === 'all'));
    });
    renderAll();
  });
  qs('#admin-copy-summary')?.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    await navigator.clipboard?.writeText(buildSupportSummary()).catch(() => undefined);
    const label = button.textContent;
    button.textContent = 'Copié';
    window.setTimeout(() => { button.textContent = label; }, 1400);
  });
  qs('#admin-build-support-summary')?.addEventListener('click', renderSupport);
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const copyValue = target.closest<HTMLElement>('[data-copy-value]')?.dataset.copyValue;
    if (copyValue) {
      void navigator.clipboard?.writeText(copyValue).catch(() => undefined);
      return;
    }
    const projectId = target.closest<HTMLElement>('[data-open-project]')?.dataset.openProject;
    if (projectId) {
      window.location.href = `/builder.html?project=${encodeURIComponent(projectId)}`;
      return;
    }
    const drawerTarget = target.closest<HTMLElement>('[data-drawer-type][data-drawer-id]');
    if (drawerTarget) {
      openEntityDrawer(drawerTarget.dataset.drawerType || '', drawerTarget.dataset.drawerId || '');
    }
  });
  qs('#admin-drawer-close')?.addEventListener('click', closeDrawer);
  qs('#admin-drawer-backdrop')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDrawer();
  });
}

function initAdmin() {
  bindNavigation();
  bindFilters();
  bindActions();
  void loadAdminData();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}
