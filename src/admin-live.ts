import { apiFetch } from './lib/api';
import { localConnectorLogo } from './lib/connector-logos';
import { mountAdminLibrary } from './admin-library';
import { mountDataTable, type DataTable, type DataTableColumn, type DataTableFilter } from './admin-table';
import { confirmDialog, toast } from './lib/ui-feedback';
import './styles/admin-console.css';
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
  live: JsonRecord | null;
  costs: JsonRecord | null;
  audit: JsonRecord[];
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
  live: null,
  costs: null,
  audit: [],
  loading: true,
};

let allUsers: JsonRecord[] = [];
let allProjects: JsonRecord[] = [];
let allRuns: JsonRecord[] = [];
let globalQuery = '';
let costDays = 30;
const tables: Record<string, DataTable<JsonRecord>> = {};

const SECTION_LABELS: Record<string, string> = {
  overview: 'Vue d’ensemble',
  agent: 'Agent',
  library: 'Bibliothèque',
  users: 'Utilisateurs',
  projects: 'Projets',
  runs: 'Runs',
  errors: 'Erreurs',
  models: 'Modèles',
  costs: 'Coûts',
  integrations: 'Intégrations',
  publish: 'Publication',
  security: 'Sécurité',
  flags: 'Drapeaux',
  audit: 'Journal d’audit',
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

function formatUsd(value: unknown, digits = 2) {
  const number = Number(value || 0);
  return `${number.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, number && number < 0.1 ? 4 : digits) })} $`;
}

function formatTokens(value: unknown) {
  const number = Number(value || 0);
  if (number >= 1_000_000) return `${(number / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (number >= 1_000) return `${(number / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
  return number.toLocaleString('fr-FR');
}

function userLabel(userId: unknown) {
  const user = allUsers.find(row => row.id === userId);
  return user?.email || (userId ? `${String(userId).slice(0, 8)}…` : '--');
}

/**
 * Sets a section's frame once. Tables mounted inside it keep their search,
 * sort and page across refreshes; only the metric cards are redrawn.
 */
function frame(root: HTMLElement, key: string, html: string) {
  if (root.dataset.frame === key) return false;
  root.dataset.frame = key;
  root.innerHTML = html;
  return true;
}

function tableIn<Row extends JsonRecord>(key: string, host: HTMLElement | null, options: Parameters<typeof mountDataTable<Row>>[1]) {
  if (!host) return null;
  if (!tables[key] || !host.contains(document.querySelector(`[data-dt-key="${key}"]`))) {
    host.dataset.dtKey = key;
    tables[key] = mountDataTable(host, options as any) as unknown as DataTable<JsonRecord>;
    if (globalQuery) tables[key].setExternalQuery(globalQuery);
  }
  return tables[key];
}

const detailsButton = (type: string, id: unknown, label = 'Détails') => `<button class="admin-button" data-drawer-type="${escapeHtml(type)}" data-drawer-id="${escapeHtml(id)}" type="button">${escapeHtml(label)}</button>`;

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
      <div class="health-actions">${row.testable ? `<button class="admin-button subtle" type="button" data-health-test="${escapeHtml(row.id)}">Tester</button>` : ''}${pill(row.status)}</div>
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
    `<section class="admin-card full admin-live" aria-labelledby="admin-live-title"><div class="admin-panel-head"><div><span class="panel-label" id="admin-live-title"><span class="admin-live-dot" aria-hidden="true"></span>En direct</span><p class="metric-note">Actualisé toutes les 15 secondes tant que cette page est ouverte.</p></div><span class="metric-note" id="admin-live-updated"></span></div><div id="admin-live-body">${renderLiveBody()}</div></section>`,
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

function renderLiveBody() {
  const data = state.live;
  if (!data) return skeleton(3);
  if (data.success === false) return `<div class="admin-error">${escapeHtml(data.error || 'Les données en direct sont indisponibles.')}</div>`;
  const live = data.live || {};
  const alerts: JsonRecord[] = data.alerts || [];
  const errors: JsonRecord[] = data.recent_errors || [];
  const tile = (label: string, value: string, note: string, tone = '') => `<div class="admin-live-tile"${tone ? ` data-tone="${tone}"` : ''}><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></div>`;
  return `
    ${alerts.length ? `<div class="admin-alert" data-level="${alerts.some(alert => alert.level === 'exceeded') ? 'exceeded' : 'warning'}" role="alert"><strong>${alerts.length} alerte${alerts.length > 1 ? 's' : ''} de coût</strong><span>${alerts.slice(0, 3).map(alert => escapeHtml(`${alert.scope === 'global' ? 'Budget global' : alert.scope === 'user' ? userLabel(alert.target_id) : alert.target_id} : ${formatUsd(alert.spent_usd)} / ${formatUsd(alert.budget_usd)} (${Math.round(alert.ratio * 100)} %)`)).join(' · ')}</span><button class="admin-button subtle" type="button" data-goto="costs">Voir les coûts</button></div>` : ''}
    <div class="admin-live-grid">
      ${tile('Actifs maintenant', formatNumber(live.active_now ?? 0), 'runs lancés ces 15 dernières minutes')}
      ${tile('Actifs aujourd’hui', formatNumber(live.active_today ?? 0), `sur ${formatNumber(live.users_total ?? 0)} comptes`)}
      ${tile('Projets créés', formatNumber(live.projects_today ?? 0), `24 h · ${formatNumber(live.projects_week ?? 0)} sur 7 jours`)}
      ${tile('Runs (24 h)', formatNumber(live.runs_today ?? 0), `${formatNumber(live.runs_failed_today ?? 0)} en échec · ${formatNumber(live.running_turns ?? 0)} en cours`, Number(live.runs_failed_today) > 0 ? 'warn' : '')}
      ${tile('Tokens (24 h)', formatTokens(live.tokens_today ?? 0), 'déclarés par OpenRouter')}
      ${tile('Coût OpenRouter', formatUsd(live.cost_today_usd ?? 0), `aujourd’hui · ${formatUsd(live.cost_month_usd ?? 0)} ce mois`)}
    </div>
    <div class="admin-live-errors"><span class="panel-label">Erreurs récentes</span>${errors.length ? `<ul>${errors.slice(0, 5).map(run => `<li><button type="button" class="admin-link" data-drawer-type="run" data-drawer-id="${escapeHtml(run.id)}"><strong>${escapeHtml(run.diagnostic_code || run.suggested_action || 'Échec du run')}</strong><span>${escapeHtml(userLabel(run.user_id))} · ${escapeHtml(run.model_id || 'Auto')} · ${escapeHtml(formatDate(run.created_at))}</span></button></li>`).join('')}</ul>` : empty('Aucune erreur récente.')}</div>`;
}

function renderLive() {
  const body = qs('#admin-live-body');
  if (body) body.innerHTML = renderLiveBody();
  const updated = qs('#admin-live-updated');
  if (updated && state.live?.generated_at) updated.textContent = `Mis à jour à ${new Date(state.live.generated_at).toLocaleTimeString('fr-FR')}`;
}

let livePoll: number | null = null;
async function refreshLive() {
  const data = await safeAdminFetch('/api/admin/live', { live: {}, alerts: [], recent_errors: [] });
  state.live = data;
  renderLive();
}
function syncLivePolling() {
  const overviewActive = qs('[data-section="overview"]')?.classList.contains('active');
  const shouldPoll = Boolean(overviewActive && document.visibilityState === 'visible');
  if (shouldPoll && livePoll === null) livePoll = window.setInterval(() => void refreshLive(), 15_000);
  if (!shouldPoll && livePoll !== null) { window.clearInterval(livePoll); livePoll = null; }
}

const USER_FILTERS: DataTableFilter<JsonRecord>[] = [
  { value: 'admin', label: 'Admins', test: user => Boolean(user.is_platform_admin) },
  { value: 'active', label: 'Actifs aujourd’hui', test: user => isRecent(user.last_sign_in_at, 24) },
  { value: 'suspended', label: 'Suspendus', test: user => Boolean(user.suspended) },
  { value: 'no-email', label: 'Sans e-mail', test: user => !user.email },
];

function renderUsers() {
  const root = qs('#admin-users');
  if (!root) return;
  frame(root, 'users', `
    <div class="admin-grid admin-metric-row" data-users-metrics></div>
    <article class="admin-card full"><span class="panel-label">Utilisateurs</span><div data-users-table></div></article>`);
  const suspended = state.users.filter(user => user.suspended).length;
  const metricsHost = root.querySelector<HTMLElement>('[data-users-metrics]');
  if (metricsHost) metricsHost.innerHTML = [
    metric('Comptes', formatNumber(state.users.length), `${formatNumber(state.users.filter(user => isRecent(user.last_sign_in_at, 24)).length)} actifs aujourd’hui`),
    metric('Nouveaux (7 j)', formatNumber(state.users.filter(user => isRecent(user.created_at, 24 * 7)).length), 'inscriptions récentes'),
    metric('Suspendus', formatNumber(suspended), suspended ? 'connexion bloquée' : 'aucun compte suspendu'),
  ].join('');
  const columns: DataTableColumn<JsonRecord>[] = [
    { key: 'email', label: 'Utilisateur', sortable: true, value: user => user.email || '', render: user => `<strong>${escapeHtml(user.email || 'Sans e-mail')}</strong><br><span class="admin-mono">${escapeHtml(user.id)}</span>` },
    { key: 'status', label: 'Statut', sortable: true, value: user => user.suspended ? 'Suspendu' : 'Actif', render: user => user.suspended ? pill('failed', 'Suspendu') : pill('ok', 'Actif') },
    { key: 'credits', label: 'Crédits', sortable: true, align: 'end', value: user => Number(user.wallet?.balance ?? 0), render: user => escapeHtml(formatNumber(user.wallet?.balance ?? 0)) },
    { key: 'project_count', label: 'Projets', sortable: true, align: 'end' },
    { key: 'run_count', label: 'Runs', sortable: true, align: 'end' },
    { key: 'created_at', label: 'Inscription', sortable: true, render: user => escapeHtml(formatDate(user.created_at)) },
    { key: 'last_sign_in_at', label: 'Dernière connexion', sortable: true, render: user => escapeHtml(formatDate(user.last_sign_in_at)) },
    { key: 'role', label: 'Rôle', sortable: true, value: user => user.is_platform_admin ? 'Admin plateforme' : 'Utilisateur', render: user => pill(user.is_platform_admin ? 'platform_admin' : 'user') },
    { key: 'actions', label: 'Action', exportable: false, render: user => detailsButton('user', user.id) },
  ];
  tableIn('users', root.querySelector<HTMLElement>('[data-users-table]'), { label: 'Utilisateurs', columns, filters: USER_FILTERS, searchPlaceholder: 'Rechercher un e-mail ou un identifiant', exportName: 'utilisateurs', initialSort: { key: 'last_sign_in_at', direction: 'desc' }, emptyMessage: 'Aucun utilisateur.' })?.setRows(state.users);
}

function renderProjects() {
  const root = qs('#admin-projects');
  if (!root) return;
  frame(root, 'projects', `<article class="admin-card full"><span class="panel-label">Projets</span><div data-projects-table></div></article>`);
  const columns: DataTableColumn<JsonRecord>[] = [
    { key: 'name', label: 'Projet', sortable: true, render: project => `<strong>${escapeHtml(project.name)}</strong><br><span class="admin-mono" aria-label="Identifiant de l’application">ID · ${escapeHtml(project.id)}</span>` },
    { key: 'owner', label: 'Propriétaire', sortable: true, value: project => userLabel(project.owner_id) },
    { key: 'preview_status', label: 'Aperçu', sortable: true, render: project => pill(project.preview_status) },
    { key: 'publish', label: 'Publication', sortable: true, value: project => project.publish_status || (project.live_url ? 'published' : 'draft'), render: project => pill(project.publish_status || (project.live_url ? 'published' : 'draft')) },
    { key: 'file_count', label: 'Fichiers', sortable: true, align: 'end' },
    { key: 'created_at', label: 'Créé', sortable: true, render: project => escapeHtml(formatDate(project.created_at)) },
    { key: 'updated_at', label: 'Mis à jour', sortable: true, render: project => escapeHtml(formatDate(project.updated_at)) },
    { key: 'actions', label: 'Action', exportable: false, render: project => `${detailsButton('project', project.id)} <button class="admin-button subtle" data-open-project="${escapeHtml(project.id)}" type="button">Ouvrir</button>` },
  ];
  tableIn('projects', root.querySelector<HTMLElement>('[data-projects-table]'), {
    label: 'Projets', columns, searchPlaceholder: 'Rechercher un projet, un propriétaire ou un identifiant', exportName: 'projets', initialSort: { key: 'updated_at', direction: 'desc' },
    filters: [
      { value: 'preview-ready', label: 'Aperçu vérifié', test: project => project.preview_status === 'verified' },
      { value: 'published', label: 'Publiés', test: project => Boolean(project.live_url) || /published|ready|success/i.test(String(project.publish_status || '')) },
      { value: 'needs-attention', label: 'À surveiller', test: project => /fail|error|blocked|unknown|not_ready|needs_fix/i.test(`${project.preview_status} ${project.publish_status}`) },
    ],
  })?.setRows(state.projects);
}

const RUN_COLUMNS: DataTableColumn<JsonRecord>[] = [
  { key: 'request_id', label: 'Run', sortable: true, value: run => run.request_id || run.id, render: run => `<strong>${escapeHtml(run.request_id || run.id)}</strong><br><span class="admin-mono">${escapeHtml(run.project_id || '--')}</span>` },
  { key: 'status', label: 'Statut', sortable: true, render: run => pill(run.status) },
  { key: 'user', label: 'Utilisateur', sortable: true, value: run => userLabel(run.user_id) },
  { key: 'intent', label: 'Intention', sortable: true },
  { key: 'model_id', label: 'Modèle', sortable: true, value: run => run.model_id || 'Auto', render: run => `<code>${escapeHtml(run.model_id || 'Auto')}</code>` },
  { key: 'diagnostic_code', label: 'Diagnostic', sortable: true, value: run => run.diagnostic_code || run.suggested_action || '' },
  { key: 'duration_ms', label: 'Durée', sortable: true, align: 'end', value: run => Number(run.duration_ms || 0), render: run => escapeHtml(`${Math.round(Number(run.duration_ms || 0) / 1000)} s`) },
  { key: 'created_at', label: 'Créé', sortable: true, render: run => escapeHtml(formatDate(run.created_at)) },
  { key: 'actions', label: 'Action', exportable: false, render: run => detailsButton('run', run.id) },
];

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
  frame(root, 'runs', `<div class="admin-grid admin-metric-row" data-runs-metrics></div><article class="admin-card full"><span class="panel-label">Runs récents</span><div data-runs-table></div></article><article class="admin-card full"><span class="panel-label">Répartition des intentions</span><div data-runs-intents></div></article>`);
  const metricsHost = root.querySelector<HTMLElement>('[data-runs-metrics]');
  if (metricsHost) metricsHost.innerHTML = [
    metric('Runs observés', formatNumber(state.runs.length), '500 derniers runs d’agent', dailyBars(state.runs.map(run => run.created_at))),
    metric('En échec', formatNumber(state.runs.filter(run => run.status === 'failed').length), 'À examiner'),
    metric('Durée moyenne', averageDuration(state.runs), 'Runs terminés'),
  ].join('');
  tableIn('runs', root.querySelector<HTMLElement>('[data-runs-table]'), {
    label: 'Runs', columns: RUN_COLUMNS, exportName: 'runs', searchPlaceholder: 'Rechercher un run, un projet, un modèle', initialSort: { key: 'created_at', direction: 'desc' },
    filters: [
      { value: 'failed', label: 'En échec', test: run => run.status === 'failed' },
      { value: 'completed', label: 'Terminés', test: run => run.status === 'completed' },
      { value: 'running', label: 'En cours', test: run => /running|queued|pending/.test(String(run.status)) },
    ],
  })?.setRows(state.runs);
  const intents = Object.entries(state.overview?.distributions?.run_intent || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const intentsHost = root.querySelector<HTMLElement>('[data-runs-intents]');
  if (intentsHost) intentsHost.innerHTML = table(['Intention', 'Runs'], intents.map(([intent, count]) => [escapeHtml(intent), escapeHtml(formatNumber(count))]));
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
  frame(root, 'errors', `<div class="admin-grid admin-metric-row" data-errors-metrics></div><article class="admin-card full"><span class="panel-label">Runs en échec</span><div data-errors-runs></div></article><article class="admin-card full"><span class="panel-label">Contrôles en échec</span><div data-errors-checks></div></article>`);
  const metricsHost = root.querySelector<HTMLElement>('[data-errors-metrics]');
  if (metricsHost) metricsHost.innerHTML = [
    metric('Runs en échec', formatNumber(failedRuns.length), 'Échecs récents au niveau du run'),
    metric('Contrôles en échec', formatNumber(runnerFailures.length), 'Build, aperçu ou contrôle qualité'),
    metric('Diagnostic le plus fréquent', topKey(state.errors?.grouped?.diagnostic_code), 'Cause dominante'),
  ].join('');
  tableIn('errors-runs', root.querySelector<HTMLElement>('[data-errors-runs]'), { label: 'Runs en échec', columns: RUN_COLUMNS, exportName: 'runs-en-echec', initialSort: { key: 'created_at', direction: 'desc' }, emptyMessage: 'Aucun run en échec.' })?.setRows(failedRuns);
  tableIn('errors-checks', root.querySelector<HTMLElement>('[data-errors-checks]'), {
    label: 'Contrôles en échec', exportName: 'controles-en-echec', initialSort: { key: 'created_at', direction: 'desc' }, emptyMessage: 'Aucun contrôle en échec.',
    columns: [
      { key: 'agent_run_id', label: 'Run', sortable: true },
      { key: 'check_type', label: 'Contrôle', sortable: true },
      { key: 'severity', label: 'Gravité', sortable: true, value: row => row.severity || row.status, render: row => pill(row.severity || row.status) },
      { key: 'message', label: 'Message', sortable: false },
      { key: 'created_at', label: 'Quand', sortable: true, render: row => escapeHtml(formatDate(row.created_at)) },
      { key: 'actions', label: 'Action', exportable: false, render: row => detailsButton('runner_failure', row.agent_run_id || row.created_at || '') },
    ],
  })?.setRows(runnerFailures);
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
  frame(root, 'models', `<div class="admin-grid admin-metric-row" data-models-metrics></div><article class="admin-card full"><span class="panel-label">Requêtes récentes</span><div data-models-table></div></article>`);
  const metricsHost = root.querySelector<HTMLElement>('[data-models-metrics]');
  if (metricsHost) metricsHost.innerHTML = [
    metric('Requêtes IA', formatNumber(costs.length), 'Lignes récentes'),
    metric('Usage fournisseurs', formatNumber(providers.length), 'Événements d’usage fournisseur'),
    metric('Contrôles de marge', formatNumber(margins.length), 'Échantillons de garde-fous de coût'),
  ].join('');
  tableIn('models', root.querySelector<HTMLElement>('[data-models-table]'), {
    label: 'Requêtes IA', exportName: 'requetes-ia', initialSort: { key: 'created_at', direction: 'desc' },
    columns: [
      { key: 'model_id', label: 'Modèle', sortable: true, value: row => row.model_id || 'Auto', render: row => `<code>${escapeHtml(row.model_id || 'Auto')}</code>` },
      { key: 'request_type', label: 'Type', sortable: true },
      { key: 'status', label: 'Statut', sortable: true, render: row => pill(row.status) },
      { key: 'project_id', label: 'Projet', sortable: true },
      { key: 'created_at', label: 'Quand', sortable: true, render: row => escapeHtml(formatDate(row.created_at)) },
    ],
  })?.setRows(costs);
}

function renderCosts() {
  const root = qs('#admin-costs');
  if (!root) return;
  frame(root, 'costs', `
    <div class="admin-card full admin-costs-head"><div><span class="panel-label">Coûts OpenRouter</span><p class="metric-note">Mesurés sur le registre d’usage (coût facturé par le fournisseur), jamais estimés.</p></div><label class="admin-dt-size">Période <select data-cost-days aria-label="Période">${[7, 30, 90].map(days => `<option value="${days}"${days === costDays ? ' selected' : ''}>${days} jours</option>`).join('')}</select></label></div>
    <div class="admin-grid admin-metric-row" data-costs-metrics></div>
    <div data-costs-alerts class="admin-card full"></div>
    <article class="admin-card full"><span class="panel-label">Par modèle</span><div data-costs-models></div></article>
    <article class="admin-card full"><span class="panel-label">Par utilisateur</span><div data-costs-users></div></article>`);
  root.querySelector<HTMLSelectElement>('[data-cost-days]')!.value = String(costDays);
  const data = state.costs;
  const metricsHost = root.querySelector<HTMLElement>('[data-costs-metrics]');
  if (!data) { if (metricsHost) metricsHost.innerHTML = skeleton(3); return; }
  if (data.success === false) { if (metricsHost) metricsHost.innerHTML = `<div class="admin-error">${escapeHtml(data.error || 'Coûts indisponibles.')}</div>`; return; }
  const totals = data.totals || {};
  const days: JsonRecord[] = data.by_day || [];
  const max = Math.max(0.0001, ...days.map(day => Number(day.cost_usd || 0)));
  const bars = `<div class="admin-bars" aria-hidden="true">${days.map(day => `<span style="height:${Math.max(6, Math.round((Number(day.cost_usd || 0) / max) * 100))}%"${Number(day.cost_usd) ? '' : ' data-empty'} title="${escapeHtml(day.key)} : ${escapeHtml(formatUsd(day.cost_usd))}"></span>`).join('')}</div>`;
  if (metricsHost) metricsHost.innerHTML = [
    metric('Aujourd’hui', formatUsd(totals.today_usd), 'coût fournisseur'),
    metric('Ce mois', formatUsd(totals.month_usd), 'depuis le 1er du mois'),
    metric(`${data.days || costDays} derniers jours`, formatUsd(totals.cost_usd), `${formatNumber(totals.requests ?? 0)} requêtes facturées`, bars),
    metric('Tokens', formatTokens(Number(totals.prompt_tokens || 0) + Number(totals.completion_tokens || 0)), `${formatTokens(totals.prompt_tokens)} en entrée · ${formatTokens(totals.completion_tokens)} en sortie`),
  ].join('');
  const alerts = data.alerts || {};
  const alertsHost = root.querySelector<HTMLElement>('[data-costs-alerts]');
  const modelOptions = (data.by_model || []).map((row: JsonRecord) => `<option value="${escapeHtml(row.key)}">${escapeHtml(row.key)}</option>`).join('');
  const userOptions = allUsers.filter(user => user.email).map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.email)}</option>`).join('');
  const scopeLabel = (rule: JsonRecord) => rule.scope === 'global' ? 'Budget global' : rule.scope === 'user' ? `Utilisateur · ${rule.email || userLabel(rule.target_id)}` : `Modèle · ${rule.target_id}`;
  if (alertsHost) alertsHost.innerHTML = `
    <div class="admin-panel-head"><div><span class="panel-label">Alertes de dépassement</span><p class="metric-note">Budget mensuel en dollars : alerte à 80 %, dépassement à 100 %. Les alertes s’affichent ici et sur la vue d’ensemble.</p></div></div>
    ${alerts.available === false ? '<div class="admin-error">La table des alertes n’existe pas encore : la migration admin doit être appliquée.</div>' : ''}
    ${(alerts.triggered || []).map((alert: JsonRecord) => `<div class="admin-alert" data-level="${alert.level}"><strong>${alert.level === 'exceeded' ? 'Dépassé' : 'Bientôt atteint'}</strong><span>${escapeHtml(scopeLabel({ ...alert, email: alert.email }))} : ${escapeHtml(formatUsd(alert.spent_usd))} sur ${escapeHtml(formatUsd(alert.budget_usd))} (${Math.round(Number(alert.ratio) * 100)} %)</span></div>`).join('')}
    ${table(['Portée', 'Budget mensuel', 'Créée par', 'Action'], (alerts.rules || []).map((rule: JsonRecord) => [escapeHtml(scopeLabel(rule)), escapeHtml(formatUsd(rule.monthly_budget_usd)), escapeHtml(rule.created_by || '--'), `<button class="admin-button subtle is-danger" type="button" data-delete-alert="${escapeHtml(rule.id)}" data-alert-label="${escapeHtml(scopeLabel(rule))}">Supprimer</button>`]), 'Aucun budget défini.')}
    <form class="admin-alert-form" data-alert-form>
      <label>Portée<select name="scope"><option value="global">Global</option><option value="user">Utilisateur</option><option value="model">Modèle</option></select></label>
      <label data-target="user" hidden>Utilisateur<select name="user">${userOptions}</select></label>
      <label data-target="model" hidden>Modèle<select name="model">${modelOptions}</select></label>
      <label>Budget mensuel ($)<input name="budget" type="number" min="0.01" step="0.01" required placeholder="50"></label>
      <button class="admin-button primary" type="submit">Enregistrer le budget</button>
    </form>`;
  tableIn('costs-models', root.querySelector<HTMLElement>('[data-costs-models]'), {
    label: 'Coûts par modèle', exportName: 'couts-par-modele', initialSort: { key: 'cost_usd', direction: 'desc' }, emptyMessage: 'Aucun coût mesuré sur la période.',
    columns: [
      { key: 'key', label: 'Modèle', sortable: true, render: row => `<code>${escapeHtml(row.key)}</code>` },
      { key: 'cost_usd', label: 'Coût', sortable: true, align: 'end', render: row => escapeHtml(formatUsd(row.cost_usd)) },
      { key: 'requests', label: 'Requêtes', sortable: true, align: 'end' },
      { key: 'prompt_tokens', label: 'Tokens entrée', sortable: true, align: 'end', render: row => escapeHtml(formatTokens(row.prompt_tokens)) },
      { key: 'completion_tokens', label: 'Tokens sortie', sortable: true, align: 'end', render: row => escapeHtml(formatTokens(row.completion_tokens)) },
      { key: 'average', label: 'Coût moyen', sortable: true, align: 'end', value: row => Number(row.requests) ? Number(row.cost_usd) / Number(row.requests) : 0, render: row => escapeHtml(formatUsd(Number(row.requests) ? Number(row.cost_usd) / Number(row.requests) : 0, 3)) },
    ],
  })?.setRows(data.by_model || []);
  tableIn('costs-users', root.querySelector<HTMLElement>('[data-costs-users]'), {
    label: 'Coûts par utilisateur', exportName: 'couts-par-utilisateur', initialSort: { key: 'cost_usd', direction: 'desc' }, emptyMessage: 'Aucun coût mesuré sur la période.',
    columns: [
      { key: 'email', label: 'Utilisateur', sortable: true, value: row => row.email || userLabel(row.key), render: row => `<strong>${escapeHtml(row.email || userLabel(row.key))}</strong><br><span class="admin-mono">${escapeHtml(row.key)}</span>` },
      { key: 'cost_usd', label: 'Coût', sortable: true, align: 'end', render: row => escapeHtml(formatUsd(row.cost_usd)) },
      { key: 'requests', label: 'Requêtes', sortable: true, align: 'end' },
      { key: 'tokens', label: 'Tokens', sortable: true, align: 'end', value: row => Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0), render: row => escapeHtml(formatTokens(Number(row.prompt_tokens || 0) + Number(row.completion_tokens || 0))) },
      { key: 'actions', label: 'Action', exportable: false, render: row => detailsButton('user', row.key) },
    ],
  })?.setRows(data.by_user || []);
}

async function loadCosts() {
  state.costs = await safeAdminFetch(`/api/admin/costs?days=${costDays}`, { totals: {}, by_user: [], by_model: [], by_day: [], alerts: { rules: [], triggered: [] } });
  renderCosts();
}

const AUDIT_LABELS: Record<string, string> = {
  'user.suspended': 'Compte suspendu',
  'user.unsuspended': 'Compte réactivé',
  'user.password_reset_sent': 'Réinitialisation du mot de passe envoyée',
  'cost_alert.created': 'Budget créé',
  'cost_alert.updated': 'Budget modifié',
  'cost_alert.deleted': 'Budget supprimé',
  'library.updated': 'Bibliothèque modifiée',
  'library.deleted': 'Élément de bibliothèque supprimé',
  'error_memory.updated': 'Règle d’erreur modifiée',
  'error_memory.deleted': 'Règle d’erreur supprimée',
  'cloud.provisioning_checked': 'Test du provisionnement Cloud',
};

function renderAudit() {
  const root = qs('#admin-audit');
  if (!root) return;
  frame(root, 'audit', `<article class="admin-card full"><div class="admin-panel-head"><div><span class="panel-label">Journal d’audit</span><p class="metric-note">Chaque action admin qui modifie quelque chose : qui, quoi, sur quoi et quand. Les adresses IP ne sont conservées que sous forme d’empreinte.</p></div></div><div data-audit-table></div></article>`);
  tableIn('audit', root.querySelector<HTMLElement>('[data-audit-table]'), {
    label: 'Journal d’audit', exportName: 'journal-audit', initialSort: { key: 'created_at', direction: 'desc' }, emptyMessage: 'Aucune action admin enregistrée pour le moment.',
    filters: [
      { value: 'users', label: 'Utilisateurs', test: row => String(row.action).startsWith('user.') },
      { value: 'costs', label: 'Coûts', test: row => String(row.action).startsWith('cost_alert.') },
      { value: 'library', label: 'Bibliothèque', test: row => /^(library|error_memory)\./.test(String(row.action)) },
    ],
    columns: [
      { key: 'created_at', label: 'Quand', sortable: true, render: row => escapeHtml(formatDate(row.created_at)) },
      { key: 'actor_email', label: 'Admin', sortable: true },
      { key: 'action', label: 'Action', sortable: true, value: row => AUDIT_LABELS[row.action] || row.action },
      { key: 'target', label: 'Cible', sortable: true, value: row => row.target_type === 'user' ? userLabel(row.target_id) : `${row.target_type || ''} ${row.target_id || ''}`.trim() },
      { key: 'detail', label: 'Détail', value: row => Object.entries(row.detail || {}).filter(([key]) => key !== 'email').map(([key, value]) => `${key} : ${Array.isArray(value) ? value.join(', ') : value}`).join(' · ') },
    ],
  })?.setRows(state.audit);
}

async function loadAudit() {
  const data = await safeAdminFetch('/api/admin/audit-log', { entries: [] });
  state.audit = data.entries || [];
  renderAudit();
}

function renderPublish() {
  const root = qs('#admin-publish');
  if (!root) return;
  const deployments = state.publish?.deployments || [];
  const domains = state.publish?.domains || [];
  frame(root, 'publish', `<div class="admin-grid admin-metric-row" data-publish-metrics></div><article class="admin-card full"><span class="panel-label">Déploiements</span><div data-publish-table></div></article>`);
  const metricsHost = root.querySelector<HTMLElement>('[data-publish-metrics]');
  if (metricsHost) metricsHost.innerHTML = [
    metric('Déploiements', formatNumber(deployments.length), 'Publications récentes', dailyBars(deployments.map((row: JsonRecord) => row.created_at))),
    metric('Domaines', formatNumber(domains.length), 'Domaines personnalisés'),
    metric('En ligne', formatNumber(deployments.filter((row: JsonRecord) => /ready|success|published|completed/i.test(row.status)).length), 'Déploiements réussis'),
  ].join('');
  tableIn('publish', root.querySelector<HTMLElement>('[data-publish-table]'), {
    label: 'Déploiements', exportName: 'deploiements', initialSort: { key: 'created_at', direction: 'desc' },
    columns: [
      { key: 'id', label: 'Déploiement', sortable: true },
      { key: 'project_id', label: 'Projet', sortable: true },
      { key: 'status', label: 'Statut', sortable: true, render: row => pill(row.status) },
      { key: 'url', label: 'Adresse', sortable: true, render: row => row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(row.url)}</a>` : '--' },
      { key: 'created_at', label: 'Quand', sortable: true, render: row => escapeHtml(formatDate(row.created_at)) },
      { key: 'actions', label: 'Action', exportable: false, render: row => detailsButton('deployment', row.id || row.url || '') },
    ],
  })?.setRows(deployments);
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
  if (state.costs) renderCosts();
  if (tables.audit) renderAudit();
}

async function loadAdminData() {
  try {
    qs('#admin-overview')!.innerHTML = skeleton(6);
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Actualisation…';
    const [overview, users, projects, runs, errors, costs, providers, margins, publish, security, flags, learning, integrations, live] = await Promise.all([
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
      safeAdminFetch('/api/admin/live', { live: {}, alerts: [], recent_errors: [] }),
    ]);
    state.live = live;
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
    renderLive();
    if (tables.audit) void loadAudit();
    if (state.costs) void loadCosts();
    if (liveStatus) liveStatus.textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Impossible de charger les données admin.';
    const root = qs('#admin-overview');
    if (root) root.innerHTML = `<div class="admin-error">${escapeHtml(message)}</div>`;
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Données indisponibles';
  }
}

/* The library loads on first visit: it is not part of the overview's snapshot. */
let adminLibrary: ReturnType<typeof mountAdminLibrary> | null = null;
function ensureAdminLibrary() {
  const root = qs('#admin-library');
  if (!root) return;
  if (!adminLibrary) adminLibrary = mountAdminLibrary(root);
  void adminLibrary.load();
}

function activateSection(tab: string) {
  if (tab === 'library') ensureAdminLibrary();
  if (tab === 'costs' && !state.costs) void loadCosts();
  if (tab === 'audit' && !tables.audit) { renderAudit(); void loadAudit(); }
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
  syncLivePolling();
  if (tab === 'overview') void refreshLive();
}

function bindNavigation() {
  document.querySelectorAll<HTMLButtonElement>('[data-admin-tab]').forEach(button => {
    button.addEventListener('click', () => activateSection(button.dataset.adminTab || 'overview'));
  });
  const initial = window.location.hash.replace('#', '');
  if (initial && SECTION_LABELS[initial]) activateSection(initial);
}

function bindFilters() {
  let searchTimer = 0;
  qs<HTMLInputElement>('#admin-global-search')?.addEventListener('input', event => {
    const value = (event.currentTarget as HTMLInputElement).value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      globalQuery = value.trim().toLowerCase();
      Object.values(tables).forEach(item => item.setExternalQuery(globalQuery));
      renderAgent();
      renderIntegrations();
      renderSecurity();
    }, 150);
  });
}

const ACTIVITY_ICONS: Record<string, string> = { run: 'Run', project: 'Projet', admin: 'Admin', login: 'Connexion' };

/**
 * One account, loaded when opened: status, spend, projects, activity, and
 * the actions an admin may take on it — each confirmed, each audited.
 */
async function openUserDrawer(id: string) {
  const drawer = qs('#admin-drawer');
  const content = qs('#admin-drawer-content');
  if (!drawer || !content) return;
  const known = allUsers.find(row => String(row.id) === id);
  content.innerHTML = `<h2 class="drawer-title">${escapeHtml(known?.email || 'Utilisateur')}</h2><p class="drawer-subtitle">Chargement du compte…</p>${skeleton(6)}`;
  drawer.classList.add('open');
  qs('#admin-drawer-backdrop')?.classList.add('open');
  let data: JsonRecord;
  try { data = await apiFetch<JsonRecord>(`/api/admin/users/${encodeURIComponent(id)}`); }
  catch (error) {
    content.innerHTML = `<h2 class="drawer-title">${escapeHtml(known?.email || 'Utilisateur')}</h2><div class="admin-error">${escapeHtml(error instanceof Error ? error.message : 'Compte indisponible.')}</div>`;
    return;
  }
  const user = data.user || {};
  const costs = data.costs?.totals || {};
  const activity: JsonRecord[] = data.activity || [];
  const projects: JsonRecord[] = data.projects || [];
  const actions = `
    ${user.suspended
      ? `<button class="admin-button primary" type="button" data-user-action="unsuspend" data-user-id="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email || '')}">Réactiver le compte</button>`
      : `<button class="admin-button is-danger" type="button" data-user-action="suspend" data-user-id="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email || '')}"${user.is_platform_admin ? ' disabled title="Un admin plateforme ne peut pas être suspendu"' : ''}>Suspendre</button>`}
    <button class="admin-button" type="button" data-user-action="reset" data-user-id="${escapeHtml(user.id)}" data-user-email="${escapeHtml(user.email || '')}"${user.email ? '' : ' disabled'}>Réinitialiser le mot de passe</button>
    <button class="admin-button subtle" data-copy-value="${escapeHtml(user.id)}" type="button">Copier l’identifiant</button>`;
  content.innerHTML = `
    <h2 class="drawer-title">${escapeHtml(user.email || 'Sans e-mail')}</h2>
    <p class="drawer-subtitle">${user.suspended ? pill('failed', 'Suspendu') : pill('ok', 'Actif')} ${user.is_platform_admin ? pill('platform_admin') : ''}</p>
    <div class="drawer-actions">${actions}</div>
    <div class="drawer-grid">${[
      ['Identifiant', user.id],
      ['Inscription', formatDate(user.created_at)],
      ['Dernière connexion', formatDate(user.last_sign_in_at)],
      ['E-mail confirmé', user.confirmed_at ? formatDate(user.confirmed_at) : 'Non'],
      ['Crédits', data.wallet?.balance ?? '--'],
      ['Projets', projects.length],
      ['Coût OpenRouter (30 j)', formatUsd(costs.cost_usd)],
      ['Tokens (30 j)', formatTokens(Number(costs.prompt_tokens || 0) + Number(costs.completion_tokens || 0))],
    ].map(([label, value]) => drawerField(String(label), value)).join('')}</div>
    <h3 class="drawer-section-title">Historique d’activité</h3>
    ${activity.length ? `<ol class="admin-timeline">${activity.slice(0, 30).map(item => `<li data-kind="${escapeHtml(item.kind)}"><span class="admin-timeline-kind">${escapeHtml(ACTIVITY_ICONS[item.kind] || item.kind)}</span><div><strong>${escapeHtml(item.label)}</strong>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</div><time>${escapeHtml(formatDate(item.at))}</time></li>`).join('')}</ol>` : empty('Aucune activité enregistrée.')}
    <h3 class="drawer-section-title">Projets</h3>
    ${table(['Projet', 'Aperçu', 'Mis à jour'], projects.slice(0, 20).map(project => [`<button class="admin-link" type="button" data-open-project="${escapeHtml(project.id)}">${escapeHtml(project.name)}</button>`, pill(project.preview_status), escapeHtml(formatDate(project.updated_at))]), 'Aucun projet.')}
    <h3 class="drawer-section-title">Coûts par modèle (30 j)</h3>
    ${table(['Modèle', 'Coût', 'Requêtes'], (data.costs?.by_model || []).map((row: JsonRecord) => [`<code>${escapeHtml(row.key)}</code>`, escapeHtml(formatUsd(row.cost_usd)), escapeHtml(formatNumber(row.requests))]), 'Aucun coût mesuré.')}`;
}

async function runUserAction(button: HTMLButtonElement) {
  const action = button.dataset.userAction;
  const id = button.dataset.userId || '';
  const email = button.dataset.userEmail || '';
  const who = email || 'ce compte';
  if (!id || !action) return;
  if (action === 'suspend') {
    const ok = await confirmDialog({ title: `Suspendre ${who} ?`, body: 'La personne ne pourra plus se connecter ni lancer de génération. Ses projets et ses données sont conservés ; la suspension se lève à tout moment.', confirmLabel: 'Suspendre le compte', danger: true, typeToConfirm: email || undefined });
    if (!ok) return;
  } else if (action === 'unsuspend') {
    if (!(await confirmDialog({ title: `Réactiver ${who} ?`, body: 'La personne pourra de nouveau se connecter.', confirmLabel: 'Réactiver' }))) return;
  } else if (action === 'reset') {
    if (!(await confirmDialog({ title: 'Réinitialiser le mot de passe ?', body: `${who} recevra un e-mail pour choisir un nouveau mot de passe. Aucun mot de passe n’est visible ni défini par un admin.`, confirmLabel: 'Envoyer l’e-mail' }))) return;
  }
  button.disabled = true;
  try {
    const path = action === 'reset' ? 'reset-password' : action;
    await apiFetch(`/api/admin/users/${encodeURIComponent(id)}/${path}`, { method: 'POST', body: JSON.stringify({}) });
    toast(action === 'suspend' ? `${who} est suspendu.` : action === 'unsuspend' ? `${who} est réactivé.` : `E-mail de réinitialisation envoyé à ${who}.`, 'success');
    const row = allUsers.find(user => user.id === id);
    if (row && action !== 'reset') { row.suspended = action === 'suspend'; renderUsers(); }
    void openUserDrawer(id);
    if (tables.audit) void loadAudit();
  } catch (error) {
    button.disabled = false;
    toast(error instanceof Error ? error.message : 'Action impossible.', 'error');
  }
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
    void openUserDrawer(id);
    return;
  }

  if (type === 'user-legacy') {
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
    Object.values(tables).forEach(item => item.setExternalQuery(''));
    renderAll();
  });
  qs('#admin-copy-summary')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(buildSupportSummary()); toast('Résumé copié dans le presse-papiers.', 'success'); }
    catch { toast('Copie impossible : votre navigateur a refusé l’accès au presse-papiers.', 'error'); }
  });
  document.addEventListener('visibilitychange', syncLivePolling);
  document.addEventListener('change', event => {
    const target = event.target as HTMLElement;
    if (target.matches('[data-cost-days]')) {
      costDays = Number((target as HTMLSelectElement).value) || 30;
      state.costs = null;
      renderCosts();
      void loadCosts();
    }
    if (target.matches('[data-alert-form] select[name="scope"]')) {
      const form = target.closest('form')!;
      const scope = (target as HTMLSelectElement).value;
      form.querySelectorAll<HTMLElement>('[data-target]').forEach(label => { label.hidden = label.dataset.target !== scope; });
    }
  });
  document.addEventListener('submit', async event => {
    const form = (event.target as HTMLElement).closest<HTMLFormElement>('[data-alert-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const scope = String(data.get('scope') || 'global');
    const target_id = scope === 'user' ? data.get('user') : scope === 'model' ? data.get('model') : null;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await apiFetch('/api/admin/cost-alerts', { method: 'POST', body: JSON.stringify({ scope, target_id, monthly_budget_usd: Number(data.get('budget')) }) });
      toast('Budget enregistré.', 'success');
      await loadCosts();
      void refreshLive();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Le budget n’a pas pu être enregistré.', 'error');
    } finally { if (submit) submit.disabled = false; }
  });
  qs('#admin-build-support-summary')?.addEventListener('click', renderSupport);
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const copyValue = target.closest<HTMLElement>('[data-copy-value]')?.dataset.copyValue;
    if (copyValue) {
      void navigator.clipboard?.writeText(copyValue).then(() => toast('Copié.', 'success'), () => toast('Copie impossible.', 'error'));
      return;
    }
    const userAction = target.closest<HTMLButtonElement>('[data-user-action]');
    if (userAction) { void runUserAction(userAction); return; }
    const goto = target.closest<HTMLElement>('[data-goto]')?.dataset.goto;
    if (goto) { activateSection(goto); return; }
    const deleteAlert = target.closest<HTMLButtonElement>('[data-delete-alert]');
    if (deleteAlert) {
      void (async () => {
        if (!(await confirmDialog({ title: 'Supprimer ce budget ?', body: `${deleteAlert.dataset.alertLabel || 'Ce budget'} ne déclenchera plus d’alerte.`, confirmLabel: 'Supprimer', danger: true }))) return;
        try { await apiFetch(`/api/admin/cost-alerts/${encodeURIComponent(deleteAlert.dataset.deleteAlert || '')}`, { method: 'DELETE' }); toast('Budget supprimé.', 'success'); await loadCosts(); }
        catch (error) { toast(error instanceof Error ? error.message : 'Suppression impossible.', 'error'); }
      })();
      return;
    }
    const healthTest = target.closest<HTMLButtonElement>('[data-health-test]');
    if (healthTest) {
      healthTest.disabled = true;
      healthTest.textContent = 'Test…';
      void apiFetch<JsonRecord>('/api/admin/cloud/provisioning-check', { method: 'POST', body: JSON.stringify({}) })
        .then(result => toast(String(result.message || (result.ok ? 'Test réussi.' : 'Test en échec.')), result.ok ? 'success' : 'error'))
        .catch(error => toast(error instanceof Error ? error.message : 'Test impossible.', 'error'))
        .finally(() => { healthTest.disabled = false; healthTest.textContent = 'Tester'; });
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
