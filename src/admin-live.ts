import { apiFetch } from './lib/api';
import './styles/coden-shell.css';
import './styles/modern-shell.css';
import './styles/coherence.css';
import { initCodenNavigationTransitions } from './navigation-transitions';

initCodenNavigationTransitions();

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
  if (/ok|ready|success|completed|published|active|enabled/.test(status)) return 'ok';
  if (/fail|error|blocked|denied|missing|disabled/.test(status)) return 'failed';
  if (/warn|draft|running|pending|unknown|idle/.test(status)) return 'warning';
  return status.replace(/[^a-z0-9_-]/g, '') || 'warning';
}

function pill(value: unknown) {
  const text = String(value || 'unknown');
  return `<span class="status-pill ${statusClass(text)}">${escapeHtml(text)}</span>`;
}

function formatDate(value: unknown) {
  if (!value) return 'Never';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  return `<div class="admin-skeleton" aria-label="Loading">${Array.from({ length: rows }, () => '<div class="admin-skeleton-line"></div>').join('')}</div>`;
}

async function safeAdminFetch<T extends JsonRecord>(path: string, fallback: T): Promise<T> {
  try {
    return await apiFetch<T>(path);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Admin data unavailable.';
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

function metric(label: string, value: unknown, note = '') {
  return `
    <article class="admin-card clickable" data-drawer-type="metric" data-drawer-id="${escapeHtml(label)}">
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong class="metric-value">${escapeHtml(value)}</strong>
      ${note ? `<span class="metric-note">${escapeHtml(note)}</span>` : ''}
    </article>
  `;
}

function empty(message: string) {
  return `<div class="admin-empty">${escapeHtml(message)}</div>`;
}

function table(headers: string[], rows: string[][]) {
  if (!rows.length) return empty('No data available yet.');
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
  if (!rows.length) return empty('Health checks are unavailable.');
  return `<div class="health-list">${rows.map(row => `
    <div class="health-row">
      <div><strong>${escapeHtml(row.label)}</strong><br><span>${escapeHtml(row.detail)}</span></div>
      ${pill(row.status)}
    </div>
  `).join('')}</div>`;
}

function renderOverview() {
  const root = qs('#admin-overview');
  if (!root) return;
  const overview = state.overview;
  if (!overview) {
    root.innerHTML = empty('Loading admin overview...');
    return;
  }
  const metrics = overview.metrics || {};
  root.innerHTML = [
    metric('Users', metrics.users ?? 0, `${metrics.active_today ?? 0} active today`),
    metric('Projects', metrics.projects ?? 0, `${metrics.previews_ready ?? 0} previews ready`),
    metric('Run success', `${metrics.success_rate ?? 100}%`, `${metrics.failed_runs ?? 0} failed runs observed`),
    metric('Published', metrics.publish_success ?? 0, 'Successful deployment records'),
    metric('AI requests', metrics.ai_requests ?? 0, 'Recent provider requests'),
    metric('Wallet credits', metrics.wallet_credits ?? 0, 'Total visible wallet balance'),
    `<article class="admin-card wide"><span class="panel-label">System health</span>${renderHealth(overview.health || [])}</article>`,
    `<article class="admin-card"><span class="panel-label">Availability</span>${renderAvailability(overview.availability || {})}</article>`,
    `<article class="admin-card full"><span class="panel-label">Recent failed runs</span>${renderFailedRuns(overview.recent?.failed_runs || [])}</article>`,
  ].join('');
}

function renderAvailability(availability: JsonRecord) {
  const entries = Object.entries(availability);
  if (!entries.length) return empty('No availability data.');
  return `<div class="flag-list">${entries.map(([key, available]) => `
    <div class="flag-row">
      <div><strong>${escapeHtml(key.replace(/_/g, ' '))}</strong><br><span>${available ? 'Connected' : 'Missing or unavailable'}</span></div>
      ${pill(available ? 'ok' : 'warning')}
    </div>
  `).join('')}</div>`;
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
  root.innerHTML = table(['User', 'Plan/credits', 'Projects', 'Runs', 'Last sign in', 'Role', 'Action'], rows.map(user => [
    `<strong>${escapeHtml(user.email || 'No email')}</strong><br><span>${escapeHtml(user.id)}</span>`,
    `<strong>${escapeHtml(user.wallet?.balance ?? '--')}</strong><br><span>visible credits</span>`,
    escapeHtml(user.project_count ?? 0),
    escapeHtml(user.run_count ?? 0),
    escapeHtml(formatDate(user.last_sign_in_at)),
    pill(user.is_platform_admin ? 'platform_admin' : user.role || 'user'),
    `<button class="admin-button" data-drawer-type="user" data-drawer-id="${escapeHtml(user.id)}" type="button">Inspect</button>`,
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
      if (activeFilters.projects === 'needs-attention') return /fail|error|blocked|unknown|not_ready/i.test(`${project.preview_status} ${project.publish_status}`);
      return true;
    });
  root.innerHTML = table(['Project', 'Owner', 'Preview', 'Publish', 'Files', 'Updated', 'Action'], rows.map(project => [
    `<strong>${escapeHtml(project.name)}</strong><br><span>${escapeHtml(project.id)}</span>`,
    escapeHtml(project.owner_id || '--'),
    pill(project.preview_status),
    pill(project.publish_status || (project.live_url ? 'published' : 'draft')),
    escapeHtml(project.file_count ?? '--'),
    escapeHtml(formatDate(project.updated_at)),
    `<button class="admin-button" data-drawer-type="project" data-drawer-id="${escapeHtml(project.id)}" type="button">Inspect</button>
     <button class="admin-button subtle" data-open-project="${escapeHtml(project.id)}" type="button">Open</button>`,
  ]));
}

function renderFailedRuns(rows: JsonRecord[]) {
  return table(['Request', 'Intent', 'Model', 'Diagnostic', 'When', 'Action'], rows.map(run => [
    `<strong>${escapeHtml(run.request_id || run.id)}</strong><br><span>${escapeHtml(run.project_id || '--')}</span>`,
    escapeHtml(run.intent || '--'),
    escapeHtml(run.model_id || 'Auto'),
    escapeHtml(run.diagnostic_code || run.suggested_action || '--'),
    escapeHtml(formatDate(run.created_at)),
    `<button class="admin-button" data-drawer-type="run" data-drawer-id="${escapeHtml(run.id)}" type="button">Inspect</button>`,
  ]));
}

function renderRuns() {
  const root = qs('#admin-runs');
  if (!root) return;
  const distributions = state.overview?.distributions || {};
  root.innerHTML = `
    ${metric('Runs observed', state.runs.length, 'Latest 500 agent runs')}
    ${metric('Failed', state.runs.filter(run => run.status === 'failed').length, 'Requires investigation')}
    ${metric('Average duration', averageDuration(state.runs), 'Completed run mean')}
    <article class="admin-card full"><span class="panel-label">Recent runs</span>${table(['Run', 'Status', 'Intent', 'Model', 'Duration', 'Created', 'Action'], state.runs.filter(run => matchesQuery(run)).slice(0, 80).map(run => [
      `<strong>${escapeHtml(run.request_id || run.id)}</strong><br><span>${escapeHtml(run.project_id || '--')}</span>`,
      pill(run.status),
      escapeHtml(run.intent || '--'),
      escapeHtml(run.model_id || 'Auto'),
      escapeHtml(`${Math.round(Number(run.duration_ms || 0) / 1000)}s`),
      escapeHtml(formatDate(run.created_at)),
      `<button class="admin-button" data-drawer-type="run" data-drawer-id="${escapeHtml(run.id)}" type="button">Inspect</button>`,
    ]))}</article>
    <article class="admin-card full"><span class="panel-label">Intent distribution</span><pre class="support-summary">${escapeHtml(JSON.stringify(distributions.run_intent || {}, null, 2))}</pre></article>
  `;
}

function averageDuration(rows: JsonRecord[]) {
  const durations = rows.map(row => Number(row.duration_ms || 0)).filter(value => value > 0);
  if (!durations.length) return '0s';
  return `${Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000)}s`;
}

function renderErrors() {
  const root = qs('#admin-errors');
  if (!root) return;
  const failedRuns = state.errors?.errors?.failed_runs || [];
  const runnerFailures = state.errors?.errors?.runner_failures || [];
  root.innerHTML = `
    ${metric('Failed runs', failedRuns.length, 'Recent run-level failures')}
    ${metric('Runner failures', runnerFailures.length, 'Build, preview or QA checks')}
    ${metric('Top diagnostic', topKey(state.errors?.grouped?.diagnostic_code), 'Most frequent issue')}
    <article class="admin-card full"><span class="panel-label">Failed runs</span>${renderFailedRuns(failedRuns.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80))}</article>
    <article class="admin-card full"><span class="panel-label">Runner failures</span>${table(['Run', 'Check', 'Severity', 'Message', 'When', 'Action'], runnerFailures.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80).map((row: JsonRecord) => [
      escapeHtml(row.agent_run_id || '--'),
      escapeHtml(row.check_type || '--'),
      pill(row.severity || row.status),
      escapeHtml(row.message || '--'),
      escapeHtml(formatDate(row.created_at)),
      `<button class="admin-button" data-drawer-type="runner_failure" data-drawer-id="${escapeHtml(row.agent_run_id || row.created_at || '')}" type="button">Inspect</button>`,
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
  root.innerHTML = `
    ${metric('AI requests', costs.length, 'Recent request rows')}
    ${metric('Provider rows', providers.length, 'Provider usage events')}
    ${metric('Margin rows', margins.length, 'Cost guardrail samples')}
    <article class="admin-card full"><span class="panel-label">AI costs</span>${table(['Model', 'Type', 'Status', 'Project', 'When'], costs.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 80).map((row: JsonRecord) => [
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
    ${metric('Deployments', deployments.length, 'Recent publish records')}
    ${metric('Domains', domains.length, 'Custom domain records')}
    ${metric('Ready', deployments.filter((row: JsonRecord) => /ready|success|published|completed/i.test(row.status)).length, 'Successful deploys')}
    <article class="admin-card full"><span class="panel-label">Deployments</span>${table(['Deployment', 'Project', 'Status', 'URL', 'When', 'Action'], deployments.filter((row: JsonRecord) => matchesQuery(row)).slice(0, 100).map((row: JsonRecord) => [
      escapeHtml(row.id || '--'),
      escapeHtml(row.project_id || '--'),
      pill(row.status),
      row.url ? `<a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url)}</a>` : '--',
      escapeHtml(formatDate(row.created_at)),
      `<button class="admin-button" data-drawer-type="deployment" data-drawer-id="${escapeHtml(row.id || row.url || '')}" type="button">Inspect</button>`,
    ]))}</article>
  `;
}

function renderSecurity() {
  const root = qs('#admin-security');
  if (!root) return;
  const findings = state.security?.findings || [];
  const checklist = state.security?.checklist || [];
  root.innerHTML = `
    ${metric('Open findings', state.security?.summary?.open_findings ?? 0, 'Security-related runner findings')}
    ${metric('Projects observed', state.security?.summary?.projects_observed ?? 0, 'Recent projects scanned')}
    ${metric('Admin guard', state.security?.summary?.admin_guard || 'enabled', 'Protected server routes')}
    <article class="admin-card wide"><span class="panel-label">Checklist</span><div class="health-list">${checklist.map((item: JsonRecord) => `
      <div class="health-row"><div><strong>${escapeHtml(item.label)}</strong></div>${pill(item.status)}</div>
    `).join('')}</div></article>
    <article class="admin-card full"><span class="panel-label">Findings</span>${table(['Run', 'Check', 'Severity', 'Message'], findings.slice(0, 80).map((row: JsonRecord) => [
      escapeHtml(row.agent_run_id || '--'),
      escapeHtml(row.check_type || '--'),
      pill(row.severity || row.status),
      escapeHtml(row.message || '--'),
    ]))}</article>
  `;
}

function renderFlags() {
  const root = qs('#admin-flags');
  if (!root) return;
  root.innerHTML = `
    <article class="admin-card full">
      <div class="admin-panel-head">
        <div>
          <span class="panel-label">Feature flags</span>
          <p class="metric-note">Read-only rollout map. Dangerous mutations stay disabled until audit logging is wired.</p>
        </div>
        ${pill(`${state.flags.filter(flag => flag.enabled).length} enabled`)}
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
              <span>${escapeHtml(flag.rollout || 'all')}</span>
              <span>risk ${escapeHtml(flag.risk || 'medium')}</span>
              ${pill(flag.enabled ? 'enabled' : 'disabled')}
            </div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function buildSupportSummary() {
  const overview = state.overview?.metrics || {};
  const failed = state.errors?.errors?.failed_runs?.[0];
  return [
    'Coden support snapshot',
    `Generated: ${new Date().toISOString()}`,
    `Users: ${overview.users ?? 0}`,
    `Projects: ${overview.projects ?? 0}`,
    `Run success: ${overview.success_rate ?? 100}%`,
    `Failed runs: ${overview.failed_runs ?? 0}`,
    failed ? `Latest failure: ${failed.request_id || failed.id} / ${failed.diagnostic_code || failed.status}` : 'Latest failure: none observed',
    'Secrets: redacted by admin API',
  ].join('\n');
}

function renderSupport() {
  const root = qs('#admin-support');
  if (!root) return;
  root.innerHTML = `<pre class="support-summary">${escapeHtml(buildSupportSummary())}</pre>`;
}

function renderAll() {
  renderOverview();
  renderUsers();
  renderProjects();
  renderRuns();
  renderErrors();
  renderModels();
  renderPublish();
  renderSecurity();
  renderFlags();
  renderSupport();
}

async function loadAdminData() {
  try {
    qs('#admin-overview')!.innerHTML = skeleton(6);
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Refreshing live data';
    const [overview, users, projects, runs, errors, costs, providers, margins, publish, security, flags] = await Promise.all([
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
    renderAll();
    if (liveStatus) liveStatus.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load admin data.';
    const root = qs('#admin-overview');
    if (root) root.innerHTML = `<div class="admin-error">${escapeHtml(message)}</div>`;
    const liveStatus = qs('#admin-live-status');
    if (liveStatus) liveStatus.textContent = 'Admin data unavailable';
  }
}

function bindNavigation() {
  document.querySelectorAll<HTMLButtonElement>('[data-admin-tab]').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.adminTab;
      document.querySelectorAll<HTMLElement>('[data-admin-tab]').forEach(item => item.classList.toggle('active', item.dataset.adminTab === tab));
      document.querySelectorAll<HTMLElement>('[data-section]').forEach(section => section.classList.toggle('active', section.dataset.section === tab));
    });
  });
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
    openDrawer(id, 'Metric context', [
      ['Current value', 'See overview cards and related tables'],
      ['Tip', 'Use search and filters to isolate the users, projects or runs behind this signal'],
    ]);
    return;
  }

  if (type === 'user') {
    const user = allUsers.find(row => String(row.id) === id);
    if (!user) return;
    openDrawer(user.email || 'User', 'Account, activity and visible wallet context.', [
      ['User ID', user.id],
      ['Email', user.email || '--'],
      ['Last sign in', formatDate(user.last_sign_in_at)],
      ['Projects', user.project_count ?? 0],
      ['Runs', user.run_count ?? 0],
      ['Credits', user.wallet?.balance ?? '--'],
      ['Role', user.is_platform_admin ? 'platform_admin' : user.role || 'user'],
    ], user, `<button class="admin-button" data-copy-value="${escapeHtml(user.id)}" type="button">Copy user ID</button>`);
    return;
  }

  if (type === 'project') {
    const project = allProjects.find(row => String(row.id) === id);
    if (!project) return;
    openDrawer(project.name || 'Project', 'Preview, publish and ownership context.', [
      ['Project ID', project.id],
      ['Owner', project.owner_id || '--'],
      ['Preview', project.preview_status || '--'],
      ['Publish', project.publish_status || (project.live_url ? 'published' : 'draft')],
      ['Live URL', project.live_url || '--'],
      ['Files', project.file_count ?? '--'],
      ['Updated', formatDate(project.updated_at)],
    ], project, `
      <button class="admin-button" data-open-project="${escapeHtml(project.id)}" type="button">Open builder</button>
      <button class="admin-button subtle" data-copy-value="${escapeHtml(project.id)}" type="button">Copy project ID</button>
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
    openDrawer(run.request_id || run.id || 'Run', 'Agent execution context and diagnostic fields.', [
      ['Run ID', run.id || '--'],
      ['Request ID', run.request_id || '--'],
      ['Project', run.project_id || '--'],
      ['User', run.user_id || '--'],
      ['Status', run.status || '--'],
      ['Intent', run.intent || '--'],
      ['Model', run.model_id || 'Auto'],
      ['Diagnostic', run.diagnostic_code || run.suggested_action || '--'],
      ['Duration', `${Math.round(Number(run.duration_ms || 0) / 1000)}s`],
      ['Created', formatDate(run.created_at)],
    ], run, `
      ${run.project_id ? `<button class="admin-button" data-open-project="${escapeHtml(run.project_id)}" type="button">Open project</button>` : ''}
      <button class="admin-button subtle" data-copy-value="${escapeHtml(run.request_id || run.id || '')}" type="button">Copy request</button>
    `);
    return;
  }

  if (type === 'deployment') {
    const deployment = (state.publish?.deployments || []).find((row: JsonRecord) => String(row.id || row.url) === id);
    if (!deployment) return;
    openDrawer(deployment.url || deployment.id || 'Deployment', 'Publish status and live URL context.', [
      ['Deployment', deployment.id || '--'],
      ['Project', deployment.project_id || '--'],
      ['Status', deployment.status || '--'],
      ['URL', deployment.url || '--'],
      ['Domain', deployment.domain || '--'],
      ['Created', formatDate(deployment.created_at)],
    ], deployment, `
      ${deployment.url ? `<a class="admin-button" href="${escapeHtml(deployment.url)}" target="_blank" rel="noreferrer">Open live</a>` : ''}
      ${deployment.project_id ? `<button class="admin-button subtle" data-open-project="${escapeHtml(deployment.project_id)}" type="button">Open project</button>` : ''}
    `);
    return;
  }

  if (type === 'runner_failure') {
    const failure = (state.errors?.errors?.runner_failures || []).find((row: JsonRecord) => String(row.agent_run_id || row.created_at || '') === id);
    if (!failure) return;
    openDrawer(failure.check_type || 'Runner failure', 'Runner, browser or quality check failure.', [
      ['Run', failure.agent_run_id || '--'],
      ['Check', failure.check_type || '--'],
      ['Severity', failure.severity || failure.status || '--'],
      ['Message', failure.message || '--'],
      ['Created', formatDate(failure.created_at)],
    ], failure, `<button class="admin-button subtle" data-copy-value="${escapeHtml(failure.agent_run_id || '')}" type="button">Copy run ID</button>`);
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
  qs('#admin-copy-summary')?.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(buildSupportSummary()).catch(() => undefined);
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
