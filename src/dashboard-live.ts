import './styles/coden-light-theme.css';
import './styles/motion-tokens.css';
import './styles/legacy-bridge.css';
import './components/ui/motion.css';
import './styles/agent-surface.css';
import './styles/modern-shell.css';
import './styles/coherence.css';
import './styles/dashboard-workspace.css';
import { initThemeController } from './theme-controller';
import { initCodenNavigationTransitions } from './navigation-transitions';
import './conversion-events';
import { apiFetch } from './lib/api';
import { initCodenMotion } from './coden-motion';
import { initProviderModelSelectors } from './model-selector-ui';
import { initPromptInputActions, storePendingPromptAttachments, type PendingPromptAttachment } from './prompt-input-actions';
import { ensureSettingsPanel, openSettings } from './settings-panel';
import { openConnectorsPanel } from './connectors-panel';
import { formatCreateProjectFlowStatus, startCreateProjectFlow } from './services/create-project-flow';
import { deriveProjectName } from './services/project-naming';
import { getVerifiedSession, refreshVerifiedSession } from './lib/supabase-browser';
import { isLocalPreviewEnabled, localPreviewUrl } from './local-preview';
import { mountAgentModeComposer } from './components/agent/agent-mode-composer';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentRunPanel } from './components/agent/agent-run-panel';
import { applyAgentStreamEvent, createAgentRunViewModel, type AgentRunViewModel } from './services/agent-run-store';
import { openCodenStream } from './lib/stream-client';
import { isCodenStreamEvent, type CodenStreamEvent } from './lib/stream-protocol';
import type { AgentMode } from './services/agent-run-contract';

initThemeController();
initCodenNavigationTransitions();

type ProjectListResponse = {
  success: boolean;
  projects: Array<{
    id: string;
    name: string;
    slug?: string;
    prompt?: string;
    template?: string;
    theme?: string;
    model_id?: string;
    status?: string;
    preview_status?: string;
    preview_html?: string;
    publish_status?: string;
    live_url?: string | null;
    created_at?: string;
    updated_at?: string;
  }>;
};

type DashboardProject = ProjectListResponse['projects'][number];

type UserWorkspaceState = {
  last_project_id?: string;
  dashboard_draft_prompt?: string;
  dashboard_selected_mode?: DashboardMode;
  theme?: string;
  last_route?: string;
};

type DashboardMode = 'auto' | 'plan' | 'build';
type PlanKey = 'free' | 'pro' | 'scale' | 'enterprise';

type BillingWalletResponse = {
  success: boolean;
  plan?: string;
  balance?: number | null;
  buckets?: {
    monthly_credits?: number | null;
    daily_promo_credits?: number | null;
    topup_credits?: number | null;
  };
};

type AiUsageResponse = {
  success: boolean;
  wallet?: {
    balance?: number | null;
    monthly_credits?: number | null;
    daily_promo_credits?: number | null;
    topup_credits?: number | null;
    cloud?: {
      balance_usd?: number | null;
      ai_app_balance_usd?: number | null;
      database_storage_gb?: number | null;
      file_storage_gb?: number | null;
      bandwidth_gb?: number | null;
      topup_min_usd?: number | null;
    };
  };
  history?: Array<{
    id: string;
    project_name?: string;
    model_name?: string;
    mode?: string;
    credits_charged?: number;
    status?: string;
    created_at?: string;
  }>;
};

type ModelRateResponse = {
  success: boolean;
  models?: Array<{
    id: string;
    display_name: string;
    tier: string;
    availability: string;
    credits: {
      plan: string;
      build: string;
      fix: string;
      deploy: string;
    };
  }>;
};

let dashboardInitialized = false;
let dashboardChromeInitialized = false;
let dashboardWorkspaceTimer: number | null = null;
let dashboardWorkspaceState: UserWorkspaceState | null = null;
let aiUsageLoaded = false;
let aiUsageSettingsBound = false;
let dashboardAssistantBusy = false;
let dashboardProjects: DashboardProject[] = [];
let dashboardAttachments: PendingPromptAttachment[] = [];
let dashboardSelectedProjectId = '';

const DASHBOARD_PROJECT_KEY = 'coden-dashboard-selected-project';

function selectedDashboardProjectId() {
  return dashboardSelectedProjectId || localStorage.getItem(DASHBOARD_PROJECT_KEY) || '';
}

async function uploadDashboardAttachments(attachments: PendingPromptAttachment[]) {
  for (const attachment of attachments) {
    if (!attachment.dataUrl) throw new Error(`Le fichier ${attachment.name} ne peut pas être lu.`);
    const response = await apiFetch<{ success: boolean; attachment: { id: string } }>('/api/assistant/attachments', {
      method: 'POST',
      body: JSON.stringify({
        name: attachment.name,
        mimeType: attachment.type,
        size: attachment.size,
        dataUrl: attachment.dataUrl,
      }),
    });
    attachment.id = response.attachment.id;
    attachment.status = 'uploaded';
  }
  dashboardAttachments = [...dashboardAttachments.filter(item => !attachments.includes(item)), ...attachments];
  await storePendingPromptAttachments(dashboardAttachments);
  window.dispatchEvent(new Event('coden:dashboard-attachments-change'));
}

function setDashboardProject(projectId: string, persist = true) {
  const normalized = projectId && projectId !== '__new__' ? projectId : '';
  dashboardSelectedProjectId = normalized;
  const select = document.getElementById('dashboard-project-select') as HTMLSelectElement | null;
  if (select && select.value !== projectId) select.value = projectId || '';
  if (persist) {
    if (normalized) localStorage.setItem(DASHBOARD_PROJECT_KEY, normalized);
    else localStorage.removeItem(DASHBOARD_PROJECT_KEY);
    void apiFetch('/api/users/me/workspace-state', {
      method: 'PATCH',
      body: JSON.stringify({ last_project_id: normalized || null }),
    }).catch(() => undefined);
  }
}

type DashboardChatRole = 'user' | 'assistant' | 'system';
type DashboardChatMessage = {
  id: string;
  role: DashboardChatRole;
  content: string;
  streaming?: boolean;
  view?: AgentRunViewModel;
};

const dashboardChatMessages: DashboardChatMessage[] = [];
const dashboardAgentRoots = new Map<string, Root>();
const dashboardAgentRenderQueue = new Set<string>();
let dashboardAgentRenderFrame: number | null = null;
const dashboardStreamHandles = new Map<string, { cancel: () => void }>();

function getTemplateDescription(template: string): string {
  const labels: Record<string, string> = {
    dashboard: 'analytics dashboard with charts, logs and KPI cards',
    ecommerce: 'e-commerce storefront with catalogue, cart and checkout-ready sections',
    saas: 'AI assistant SaaS with chat, sidebar, billing and project workspace',
    portfolio: 'creative developer portfolio with responsive visual sections',
  };
  return labels[template] || 'modern responsive web application';
}

function selectedFeatures(): string[] {
  return [
    (document.getElementById('features-db') as HTMLInputElement | null)?.checked ? 'Supabase data persistence' : '',
    (document.getElementById('features-auth') as HTMLInputElement | null)?.checked ? 'authentication' : '',
    (document.getElementById('features-export') as HTMLInputElement | null)?.checked ? 'export actions' : '',
    (document.getElementById('features-seo') as HTMLInputElement | null)?.checked ? 'SEO metadata' : '',
  ].filter(Boolean);
}

function setCreateBusy(button: HTMLButtonElement, busy: boolean) {
  button.disabled = busy;
  button.textContent = busy ? 'Creating...' : 'Create Project';
}

function showProjectError(message: string) {
  let status = document.getElementById('new-project-live-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'new-project-live-status';
    status.className = 'dashboard-form-error';
    status.setAttribute('role', 'alert');
    document.querySelector('#new-project-modal .modal-content')?.appendChild(status);
  }
  status.textContent = message;
}

function selectedDashboardMode(): DashboardMode {
  const root = document.querySelector('.prompt-mode') as HTMLElement | null;
  return root?.dataset.promptMode === 'plan' ? 'plan' : root?.dataset.promptMode === 'build' ? 'build' : 'auto';
}

function setDashboardMode(mode: DashboardMode) {
  const selected = mode === 'plan' ? 'plan' : mode === 'build' ? 'build' : 'auto';
  const root = document.querySelector('.prompt-mode') as HTMLElement | null;
  const label = document.querySelector('.prompt-mode-label');
  root?.setAttribute('data-prompt-mode', selected);
  if (label) label.textContent = selected === 'plan' ? 'Plan' : selected === 'build' ? 'Build' : 'Auto';
  document.querySelectorAll('[data-prompt-mode-option]').forEach(option => {
    option.classList.toggle('active', (option as HTMLElement).dataset.promptModeOption === selected);
  });
  window.dispatchEvent(new CustomEvent('coden-agent-mode-sync', { detail: { mode: selected } }));
}

function mountDashboardAgentModeComposer() {
  const root = document.querySelector('.prompt-mode') as HTMLElement | null;
  if (!root || root.dataset.codenAgentModeMounted === 'true') return;
  root.dataset.codenAgentModeMounted = 'true';
  const current = selectedDashboardMode();
  root.innerHTML = '';
  mountAgentModeComposer(root, {
    mode: current,
    locale: (document.documentElement.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en',
    onModeChange: (mode) => {
      root.dataset.promptMode = mode;
      saveDashboardWorkspace(true);
    },
  });
}

function saveDashboardWorkspace(immediate = false) {
  if (isLocalPreviewEnabled()) return;
  if (dashboardWorkspaceTimer !== null) window.clearTimeout(dashboardWorkspaceTimer);
  const save = async () => {
    const textarea = document.getElementById('ai-textarea') as HTMLTextAreaElement | null;
    try {
      await apiFetch('/api/users/me/workspace-state', {
        method: 'PATCH',
        body: JSON.stringify({
          dashboard_draft_prompt: textarea?.value || '',
          dashboard_selected_mode: selectedDashboardMode(),
          last_project_id: selectedDashboardProjectId() || null,
          last_route: '/dashboard.html',
        }),
      });
    } catch {
      // Draft persistence should never block dashboard input.
    }
  };
  if (immediate) {
    void save();
    return;
  }
  dashboardWorkspaceTimer = window.setTimeout(save, 1500);
}

function installContinueLastProject(state: UserWorkspaceState | null) {
  if (state?.last_project_id) setDashboardProject(state.last_project_id, false);
}

function projectNameFromPrompt(prompt: string) {
  return deriveProjectName(prompt);
}

function builderUrl(projectId: string) {
  const path = `/builder.html?project=${encodeURIComponent(projectId)}`;
  return window.location.search.includes('localPreview=1') ? localPreviewUrl(path) : path;
}

async function hydrateWorkspaceState() {
  try {
    const response = await apiFetch<{ success: boolean; state: UserWorkspaceState | null }>('/api/users/me/workspace-state');
    dashboardWorkspaceState = response.state || null;
    const textarea = document.getElementById('ai-textarea') as HTMLTextAreaElement | null;
    if (textarea && !textarea.value.trim() && dashboardWorkspaceState?.dashboard_draft_prompt) {
      textarea.value = dashboardWorkspaceState.dashboard_draft_prompt;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (dashboardWorkspaceState?.dashboard_selected_mode) {
      setDashboardMode(dashboardWorkspaceState.dashboard_selected_mode);
    }
    installContinueLastProject(dashboardWorkspaceState);
  } catch {
    dashboardWorkspaceState = null;
  }
}

function bindDashboardWorkspacePersistence() {
  const textarea = document.getElementById('ai-textarea') as HTMLTextAreaElement | null;
  textarea?.addEventListener('input', () => saveDashboardWorkspace());
  document.querySelectorAll('[data-prompt-mode-option]').forEach(option => {
    option.addEventListener('click', () => {
      window.setTimeout(() => saveDashboardWorkspace(true), 0);
    });
  });
  document.getElementById('submit-btn')?.addEventListener('click', () => saveDashboardWorkspace(true), true);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function relativeTime(isoString?: string) {
  if (!isoString) return 'recently';
  const delta = Date.now() - new Date(isoString).getTime();
  if (!Number.isFinite(delta)) return 'recently';
  const mins = Math.max(0, Math.floor(delta / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function projectAccent(index: number) {
  const colors = ['#8b5cf6', '#22c55e', '#38bdf8', '#f59e0b', '#f472b6'];
  return colors[index % colors.length];
}

function projectDescription(project: DashboardProject) {
  return project.prompt || 'Open the builder to plan, generate and preview this project.';
}

function projectState(project: DashboardProject): 'draft' | 'ready' | 'published' | 'building' | 'needs-fix' {
  const raw = `${project.status || ''} ${project.preview_status || ''} ${project.publish_status || ''}`.toLowerCase();
  if (project.live_url || raw.includes('publish') || raw.includes('deploy') || raw.includes('live')) return 'published';
  if (raw.includes('publish') || raw.includes('deploy') || raw.includes('live')) return 'published';
  if (raw.includes('error') || raw.includes('fail') || raw.includes('blocked') || raw.includes('needs')) return 'needs-fix';
  if (raw.includes('build') || raw.includes('generat') || raw.includes('running') || raw.includes('pending')) return 'building';
  if (raw.includes('verified')) return 'ready';
  return 'draft';
}

function projectStateLabel(state: ReturnType<typeof projectState>) {
  const labels: Record<ReturnType<typeof projectState>, string> = {
    draft: 'Draft',
    ready: 'Preview verified',
    published: 'Published',
    building: 'Building',
    'needs-fix': 'Needs attention',
  };
  return labels[state];
}

function projectKind(project: DashboardProject) {
  const template = String(project.template || '').toLowerCase();
  if (template.includes('media')) return 'Media';
  if (template.includes('deck') || template.includes('pitch')) return 'Deck';
  if (template.includes('design')) return 'Design';
  if (template.includes('ecommerce')) return 'E-commerce';
  if (template.includes('saas')) return 'SaaS';
  return 'Web app';
}

function isRecentProject(project: DashboardProject) {
  const raw = project.updated_at || project.created_at;
  if (!raw) return false;
  const time = new Date(raw).getTime();
  return Number.isFinite(time) && Date.now() - time < 1000 * 60 * 60 * 24 * 7;
}

function projectHealthItems(project: DashboardProject, state: ReturnType<typeof projectState>) {
  return [
    {
      label: 'Preview',
      status: state === 'ready' || state === 'published' ? 'ok' : state === 'building' ? 'working' : state === 'needs-fix' ? 'issue' : 'idle',
    },
    {
      label: 'Live',
      status: state === 'published' ? 'ok' : 'idle',
    },
    {
      label: 'Recent',
      status: isRecentProject(project) ? 'ok' : 'idle',
    },
  ];
}

function projectTimelineItems(project: DashboardProject, state: ReturnType<typeof projectState>) {
  const items = [
    `Created ${relativeTime(project.created_at)}`,
    `Updated ${relativeTime(project.updated_at || project.created_at)}`,
  ];
  if (state === 'published') items.push('Live');
  if (state === 'needs-fix') items.push('Needs review');
  return items.slice(0, 3);
}

function projectLiveUrl(project: DashboardProject) {
  const raw = String(project.live_url || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function projectPreviewFrame(project: DashboardProject, state: ReturnType<typeof projectState>) {
  const html = String(project.preview_html || '').trim();
  if ((state === 'ready' || state === 'published') && html) {
    return `
      <iframe
        class="project-preview-frame"
        title="${escapeHtml(project.name)} preview"
        loading="lazy"
        sandbox="allow-scripts allow-forms"
        srcdoc="${escapeHtml(html)}"
      ></iframe>
    `;
  }
  return `
    <div class="project-preview-empty" aria-hidden="true">
      <span class="project-preview-mark">${escapeHtml((project.name || 'H').slice(0, 1).toUpperCase())}</span>
      <span>${state === 'needs-fix' ? 'Needs fix' : state === 'building' ? 'Building' : 'No preview yet'}</span>
    </div>
  `;
}

async function deleteProject(projectId: string, projectName: string) {
  const confirmed = window.confirm(`Delete "${projectName}"? This cannot be undone.`);
  if (!confirmed) return;
  await apiFetch(`/api/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
  await loadLiveProjects();
}

function installDashboardUxPolish() {
  if (document.getElementById('coden-dashboard-ux-polish')) return;
  const style = document.createElement('style');
  style.id = 'coden-dashboard-ux-polish';
  style.textContent = `
    .sidebar-profile {
      position: relative;
    }

    .profile-settings-btn {
      display: inline-grid;
      place-items: center;
      flex: 0 0 auto;
      width: 31px;
      height: 31px;
      margin-left: auto;
      border: 1px solid var(--border);
      border-radius: 11px;
      background: color-mix(in srgb, var(--bg-elevated) 86%, transparent);
      color: var(--text-sub);
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease;
    }

    .profile-settings-btn:hover,
    .profile-settings-btn:focus-visible {
      transform: translateY(-1px);
      border-color: var(--border-focus);
      background: var(--accent-dim);
      color: var(--text);
      outline: none;
    }

    .create-section {
      transition: min-height 400ms ease, padding 400ms ease, align-content 400ms ease;
    }

    .create-section[data-chat-state="conversation"],
    .create-section[data-chat-state="promoting"] {
      flex: 1 1 auto;
      min-height: 0;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 10px;
    }

    /* Le chat occupe toute la zone : un seul scroll (le fil des messages),
       pas de double barre, et les sections projets sont masquées pendant la
       conversation (prise en charge facon Claude/ChatGPT). */
    .content-area:has(.create-section[data-chat-state="conversation"]),
    .content-area:has(.create-section[data-chat-state="promoting"]) {
      overflow: hidden;
      min-height: 0;
    }
    .content-area:has(.create-section[data-chat-state="conversation"]) > :not(.create-section),
    .content-area:has(.create-section[data-chat-state="promoting"]) > :not(.create-section) {
      display: none;
    }

    .create-section[data-chat-state="conversation"] .create-title,
    .create-section[data-chat-state="conversation"] .create-subtitle,
    .create-section[data-chat-state="conversation"] .chips-row,
    .create-section[data-chat-state="promoting"] .create-title,
    .create-section[data-chat-state="promoting"] .create-subtitle,
    .create-section[data-chat-state="promoting"] .chips-row {
      display: none;
    }

    .dashboard-chat-thread {
      display: none;
      width: 100%;
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 6px 2px 10px;
      text-align: left;
      scroll-behavior: smooth;
      scrollbar-width: thin;
      scrollbar-color: color-mix(in srgb, var(--text) 16%, transparent) transparent;
    }
    /* Scrollbar : 4px, invisible au repos, fade-in discret au survol du fil. */
    .dashboard-chat-thread::-webkit-scrollbar { width: 4px; height: 4px; }
    .dashboard-chat-thread::-webkit-scrollbar-track { background: transparent; }
    .dashboard-chat-thread::-webkit-scrollbar-thumb {
      background: transparent;
      border-radius: 999px;
      transition: background 0.3s ease;
    }
    .dashboard-chat-thread:hover::-webkit-scrollbar-thumb {
      background: color-mix(in srgb, var(--text) 18%, transparent);
    }
    .dashboard-chat-thread::-webkit-scrollbar-thumb:hover {
      background: color-mix(in srgb, var(--text) 30%, transparent);
    }

    .create-section[data-chat-state="conversation"] .dashboard-chat-thread,
    .create-section[data-chat-state="promoting"] .dashboard-chat-thread {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .dashboard-chat-message {
      display: flex;
      width: 100%;
      align-items: flex-start;
      animation: dashboard-chat-rise 250ms cubic-bezier(.22, 1, .36, 1) both;
    }

    .dashboard-chat-message.user {
      justify-content: flex-end;
    }

    .dashboard-chat-message.assistant,
    .dashboard-chat-message.system {
      justify-content: flex-start;
    }

    /* Assistant: texte discret, sans cadre lourd (façon Claude/ChatGPT). */
    .dashboard-chat-bubble {
      width: fit-content;
      max-width: min(640px, 100%);
      border: 0;
      border-radius: 14px;
      background: transparent;
      color: var(--text);
      padding: 2px 0;
      font-size: 14.5px;
      line-height: 1.62;
      white-space: pre-wrap;
      word-break: break-word;
      box-shadow: none;
    }

    /* Utilisateur : bulle sombre subtile à droite, compacte (taille du contenu). */
    .dashboard-chat-message.user .dashboard-chat-bubble {
      width: fit-content;
      max-width: 70%;
      border: 0;
      border-radius: 14px;
      background: color-mix(in srgb, var(--text) 8%, transparent);
      color: var(--text);
      padding: 9px 13px;
      font-size: 14px;
      line-height: 1.45;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
    }

    .dashboard-chat-message.system .dashboard-chat-bubble {
      border-color: transparent;
      background: transparent;
      color: var(--text-sub);
      padding: 2px 4px;
      box-shadow: none;
      font-size: 12px;
      font-weight: 720;
    }

    .dashboard-chat-cursor {
      display: inline-block;
      width: 7px;
      height: 1.1em;
      margin-left: 2px;
      border-radius: 1px;
      background: currentColor;
      vertical-align: -0.15em;
      opacity: 0.55;
      animation: dashboard-chat-cursor 900ms steps(2, start) infinite;
    }

    .dashboard-chat-bubble.is-thinking {
      color: var(--text) !important;
    }

    .dashboard-chat-pending {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-height: 22px;
      vertical-align: middle;
    }

    .dashboard-chat-pending i {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--accent-blue, #4f8cff);
      animation: dashboard-chat-pending 1s ease-in-out infinite;
    }

    .dashboard-chat-pending i:nth-child(2) { animation-delay: .15s; }
    .dashboard-chat-pending i:nth-child(3) { animation-delay: .3s; }

    @keyframes dashboard-chat-pending {
      0%, 80%, 100% { transform: translateY(0); opacity: .42; }
      40% { transform: translateY(-3px); opacity: 1; }
    }

    .create-section[data-chat-state="conversation"] .input-wrapper,
    .create-section[data-chat-state="promoting"] .input-wrapper {
      position: sticky;
      bottom: 12px;
      z-index: 4;
      margin-top: auto;
      backdrop-filter: blur(16px);
    }

    /* En conversation, le composer se compacte (l'immense input du repos
       descend et rétrécit) pour laisser respirer le fil. */
    .create-section[data-chat-state="conversation"] .input-wrapper,
    .create-section[data-chat-state="promoting"] .input-wrapper {
      padding: 9px 12px !important;
      border-radius: 16px !important;
    }
    .create-section[data-chat-state="conversation"] #ai-textarea,
    .create-section[data-chat-state="promoting"] #ai-textarea {
      min-height: 40px !important;
      padding-top: 8px !important;
      font-size: 14px !important;
    }

    /* La compaction du composer (repos -> conversation) s'anime en douceur. */
    .create-section .input-wrapper {
      transition: padding 0.3s ease, border-radius 0.3s ease,
                  border-color 0.16s ease, box-shadow 0.16s ease;
    }
    .create-section #ai-textarea {
      transition: min-height 0.3s ease;
      scrollbar-width: none;
    }
    /* Pas de 2e scrollbar : le textarea scrolle en interne sans barre visible. */
    .create-section #ai-textarea::-webkit-scrollbar { width: 0; height: 0; }

    .create-section[data-local-preview-locked="true"] .input-wrapper {
      border-color: color-mix(in srgb, var(--text-sub) 32%, var(--border));
    }

    .dashboard-local-preview-status {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 8px;
      padding: 8px 10px;
      border: 1px solid color-mix(in srgb, var(--text-sub) 24%, transparent);
      border-radius: 9px;
      background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.45;
    }

    .dashboard-local-preview-status::before {
      content: '';
      width: 6px;
      height: 6px;
      flex: 0 0 auto;
      margin-top: 4px;
      border-radius: 999px;
      background: var(--text-sub);
    }

    .create-section[data-local-preview-locked="true"] #submit-btn {
      cursor: not-allowed;
      opacity: .48;
      box-shadow: none;
    }

    @media (prefers-reduced-motion: reduce) {
      .dashboard-local-preview-status { transition: none; }
    }

    /* Le grand wordmark CODEN (hero du repos) disparaît en conversation pour
       que les messages occupent l'espace — épuré, conversations bien visibles. */
    .create-section[data-chat-state="conversation"]::before,
    .create-section[data-chat-state="promoting"]::before {
      display: none !important;
    }

    @keyframes dashboard-chat-rise {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes dashboard-chat-cursor {
      0%, 45% { opacity: 0.65; }
      46%, 100% { opacity: 0; }
    }

    .dashboard-overview-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin: 18px 0 18px;
    }

    .dashboard-overview-card {
      min-height: 92px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: color-mix(in srgb, var(--bg-elevated) 86%, transparent);
      box-shadow: 0 12px 34px rgba(18, 22, 32, 0.06);
      transition: transform 180ms ease, border-color 180ms ease, background 180ms ease;
    }

    .dashboard-overview-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-focus);
      background: var(--bg-surface);
    }

    .dashboard-overview-label {
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 780;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .dashboard-overview-value {
      margin-top: 10px;
      color: var(--text);
      font-size: 26px;
      font-weight: 880;
      letter-spacing: 0;
      line-height: 1;
    }

    .dashboard-overview-note {
      margin-top: 8px;
      color: var(--text-sub);
      font-size: 12px;
      line-height: 1.4;
    }

    .project-filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 16px;
    }

    .project-filter-pill {
      height: 32px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--bg-elevated);
      color: var(--text-muted);
      padding: 0 12px;
      font-size: 12px;
      font-weight: 760;
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease, color 160ms ease;
    }

    .project-filter-pill:hover,
    .project-filter-pill.active {
      transform: translateY(-1px);
      border-color: var(--border-focus);
      background: var(--accent-dim);
      color: var(--text);
    }

    .project-card {
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: auto;
      padding: 0 !important;
      border-radius: 18px !important;
      gap: 0 !important;
      background: var(--bg-surface) !important;
      transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }

    .project-card:hover {
      box-shadow: 0 14px 34px rgba(18, 22, 32, 0.09) !important;
    }

    .project-card[hidden] {
      display: none !important;
    }

    .workspace-hubs {
      display: none !important;
    }

    .project-preview-shell {
      position: relative;
      aspect-ratio: 16 / 10;
      width: 100%;
      overflow: hidden;
      border-bottom: 1px solid var(--border);
      background:
        radial-gradient(circle at 50% 20%, color-mix(in srgb, var(--project-accent) 18%, transparent), transparent 58%),
        color-mix(in srgb, var(--bg-elevated) 86%, transparent);
    }

    .project-preview-frame {
      width: 100%;
      height: 100%;
      border: 0;
      background: #fff;
      pointer-events: none;
      transform: scale(0.72);
      transform-origin: 0 0;
      width: 138.89%;
      height: 138.89%;
      filter: saturate(0.96) contrast(0.98);
    }

    .project-preview-empty {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      gap: 10px;
      color: var(--text-sub);
      font-size: 12px;
      font-weight: 760;
      text-align: center;
    }

    .project-preview-mark {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      margin: 0 auto;
      border-radius: 14px;
      background: color-mix(in srgb, var(--project-accent) 14%, var(--bg-elevated));
      color: var(--text);
      border: 1px solid var(--border);
      font-size: 18px;
      font-weight: 860;
    }

    .project-hover-actions {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      opacity: 0;
      transform: translateY(6px);
      pointer-events: none;
      background: color-mix(in srgb, #020617 42%, transparent);
      backdrop-filter: blur(5px);
      transition: opacity 160ms ease, transform 160ms ease;
    }

    .project-card:hover .project-hover-actions,
    .project-card:focus-within .project-hover-actions {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    .project-hover-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 34px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.20);
      background: rgba(255, 255, 255, 0.92);
      color: #111827;
      padding: 0 12px;
      font-size: 12px;
      font-weight: 820;
      box-shadow: 0 10px 24px rgba(0,0,0,0.18);
      transition: transform 150ms ease, background 150ms ease, color 150ms ease;
    }

    .project-hover-button:hover {
      transform: translateY(-1px);
      background: #fff;
    }

    .project-hover-button.danger {
      background: rgba(31, 41, 55, 0.88);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.16);
    }

    .project-hover-button.danger:hover {
      background: #ef4444;
    }

    .project-card-body {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 13px 13px;
    }

    .project-card-title {
      min-width: 0;
    }

    .project-card-title .card-name {
      display: block;
      color: var(--text);
      font-size: 13px;
      font-weight: 820;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-card-title .card-meta {
      display: block;
      margin-top: 4px;
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.3;
    }

    .project-card-topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 26px;
    }

    .project-accent-line {
      display: block;
      width: 42px;
      height: 5px;
      border-radius: 999px;
      background: var(--project-accent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--project-accent) 10%, transparent);
    }

    .project-kind-pill,
    .project-status {
      display: inline-flex;
      min-height: 24px;
      align-items: center;
      border-radius: 999px;
      padding: 0 9px;
      font-size: 11px;
      font-weight: 800;
    }

    .project-kind-pill {
      border: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg-elevated) 82%, transparent);
      color: var(--text-muted);
    }

    .project-card .card-header {
      align-items: flex-start;
    }

    .project-card .card-title-row {
      min-width: 0;
    }

    .project-card .card-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-card .card-desc {
      margin: -2px 0 0;
      min-height: 40px;
      line-height: 1.55;
    }

    .project-status.draft { border-color: var(--border); background: var(--bg-elevated); color: var(--text-muted); }
    .project-status.ready { border-color: rgba(59, 130, 246, 0.22); background: rgba(59, 130, 246, 0.10); color: var(--accent); }
    .project-status.published { border-color: rgba(34, 197, 94, 0.22); background: rgba(34, 197, 94, 0.10); color: var(--success); }
    .project-status.building { border-color: rgba(245, 158, 11, 0.22); background: rgba(245, 158, 11, 0.10); color: #d97706; }
    .project-status.needs-fix { border-color: rgba(248, 113, 113, 0.26); background: rgba(248, 113, 113, 0.10); color: #ef4444; }

    .project-health-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding-top: 2px;
    }

    .project-health-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      color: var(--text-sub);
      font-size: 11px;
      font-weight: 720;
    }

    .project-health-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--border-mid);
    }

    .project-health-item.ok .project-health-dot {
      background: var(--success);
      box-shadow: 0 0 0 3px var(--success-dim);
    }

    .project-health-item.working .project-health-dot {
      background: var(--warning);
      box-shadow: 0 0 0 3px var(--warning-dim);
      animation: dotPulse 1.6s ease-in-out infinite;
    }

    .project-health-item.issue .project-health-dot {
      background: var(--error);
      box-shadow: 0 0 0 3px var(--error-dim);
    }

    .project-mini-timeline {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.35;
    }

    .project-mini-timeline span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .project-mini-timeline span:not(:last-child)::after {
      content: "";
      width: 3px;
      height: 3px;
      border-radius: 999px;
      background: var(--border-mid);
    }

    .project-card-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 2px;
    }

    .project-card-actions .btn-open-project {
      min-height: 32px;
      border-radius: 999px !important;
      padding: 0 14px !important;
      font-weight: 760;
    }

    .dashboard-activity-item {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 10px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
      cursor: pointer;
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    .dashboard-activity-item:hover {
      transform: translateY(-1px);
      border-color: var(--border-focus);
      background: var(--bg-surface);
    }

    .dashboard-activity-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--activity-accent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--activity-accent) 14%, transparent);
    }

    .dashboard-activity-title {
      color: var(--text);
      font-size: 13px;
      font-weight: 800;
    }

    .dashboard-activity-meta,
    .dashboard-activity-time {
      color: var(--text-sub);
      font-size: 11px;
      line-height: 1.4;
    }

    @media (max-width: 980px) {
      .dashboard-overview-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 620px) {
      .dashboard-overview-grid {
        grid-template-columns: 1fr;
      }

      .project-card {
        border-radius: 16px !important;
      }

      .project-hover-actions {
        position: static;
        opacity: 1;
        transform: none;
        pointer-events: auto;
        background: transparent;
        backdrop-filter: none;
        justify-content: flex-start;
        padding: 0 13px 13px;
      }

      .project-hover-button {
        min-height: 32px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .dashboard-overview-card,
      .project-filter-pill,
      .project-card,
      .dashboard-activity-item,
      .profile-settings-btn,
      .create-section,
      .create-section .input-wrapper,
      .create-section #ai-textarea,
      .dashboard-chat-thread,
      .dashboard-chat-thread::-webkit-scrollbar-thumb,
      .dashboard-chat-message,
      .dashboard-chat-cursor {
        transition: none !important;
        animation: none !important;
      }
      .dashboard-chat-pending i { animation: none !important; opacity: .7; }
    }
  `;
  document.head.appendChild(style);
}

function renderLiveProjects(projects: DashboardProject[]) {
  dashboardProjects = projects.slice();
  const grid = document.querySelector('.projects-grid') as HTMLElement | null;
  const sidebarList = document.getElementById('sidebar-projects-list');
  const projectSelect = document.getElementById('dashboard-project-select') as HTMLSelectElement | null;
  const countLabel = document.querySelector('.section-label span');
  if (countLabel) countLabel.textContent = `(${projects.length})`;

  if (projectSelect) {
    const preferred = selectedDashboardProjectId() || dashboardWorkspaceState?.last_project_id || '';
    projectSelect.innerHTML = [
      '<option value="">Sélectionner un projet</option>',
      ...projects.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name)} · ${escapeHtml(relativeTime(project.updated_at || project.created_at))}</option>`),
      '<option value="__new__">Créer un nouveau projet</option>',
    ].join('');
    if (preferred && projects.some(project => project.id === preferred)) {
      setDashboardProject(preferred, false);
      projectSelect.value = preferred;
    } else {
      setDashboardProject('', false);
    }
  }

  if (sidebarList) {
    sidebarList.innerHTML = projects.length
      ? projects.map((project, index) => `
          <button class="nav-project" data-id="${escapeHtml(project.id)}">
            <div class="project-dot" style="background:${projectAccent(index)}"></div>
            <span class="project-nav-name">${escapeHtml(project.name)}</span>
          </button>
        `).join('')
      : '<div class="empty-nav-state">Aucun projet</div>';
    sidebarList.querySelectorAll<HTMLElement>('.nav-project').forEach(button => {
      button.addEventListener('click', () => {
        const id = button.dataset.id;
        if (id) window.location.href = builderUrl(id);
      });
    });
  }

  if (!grid) return;
  if (!projects.length) {
    grid.innerHTML = `
      <div class="empty-state">
        <h3 class="empty-title">Aucun projet pour le moment.</h3>
        <p class="empty-desc">Décrivez votre première idée dans le composer.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = projects.slice(0, 5).map((project, index) => {
    const state = projectState(project);
    const accent = projectAccent(index);
    const liveUrl = projectLiveUrl(project);
    const updated = relativeTime(project.updated_at || project.created_at);
    return `
      <div class="project-card" data-id="${escapeHtml(project.id)}" data-project-state="${state}" data-project-recent="${isRecentProject(project) ? 'true' : 'false'}" style="--project-accent:${accent}">
        <div class="project-preview-shell">
          ${projectPreviewFrame(project, state)}
          <div class="project-hover-actions" aria-label="Project actions">
            <button class="project-hover-button" type="button" data-project-action="edit">Continue</button>
            ${liveUrl ? `<button class="project-hover-button" type="button" data-project-action="live" data-live-url="${escapeHtml(liveUrl)}">View live</button>` : ''}
            <button class="project-hover-button danger btn-card-delete" type="button" data-project-action="delete">Delete</button>
          </div>
        </div>
        <div class="project-card-body">
          <div class="project-card-title">
            <span class="card-name">${escapeHtml(project.name)}</span>
            <span class="card-meta">${escapeHtml(projectKind(project))} &middot; Updated ${escapeHtml(updated)}</span>
          </div>
          <span class="status-badge project-status ${state}">${escapeHtml(projectStateLabel(state))}</span>
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll<HTMLElement>('.project-card').forEach(card => {
    card.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-project-action]')) return;
      const id = card.dataset.id;
      if (id) window.location.href = builderUrl(id);
    });
  });

  grid.querySelectorAll<HTMLButtonElement>('[data-project-action]').forEach(button => {
    button.addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const card = button.closest<HTMLElement>('.project-card');
      const id = card?.dataset.id;
      if (!id) return;
      const action = button.dataset.projectAction;
      if (action === 'edit') {
        window.location.href = builderUrl(id);
        return;
      }
      if (action === 'live') {
        const url = button.dataset.liveUrl;
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (action === 'delete') {
        const project = projects.find(item => item.id === id);
        button.disabled = true;
        try {
          await deleteProject(id, project?.name || 'this project');
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Project could not be deleted.');
          button.disabled = false;
        }
      }
    });
  });
}

function hydrateUserIdentity(detail?: any) {
  const user = detail?.user || detail?.detail?.user;
  const email = typeof user?.email === 'string' ? user.email : '';
  const name = typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
    ? user.user_metadata.full_name.trim()
    : email.split('@')[0] || 'Workspace';
  const nameEl = document.getElementById('dashboard-user-name');
  const emailEl = document.getElementById('dashboard-user-email');
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = email || 'Session verified';
}

async function hydrateAdminConsoleAccess() {
  const adminLink = document.getElementById('btn-admin-console') as HTMLElement | null;
  if (!adminLink) return;
  try {
    const response = await apiFetch<{ success: boolean; user?: { is_platform_admin?: boolean } }>('/api/auth/me');
    adminLink.style.display = response.user?.is_platform_admin ? 'flex' : 'none';
  } catch {
    adminLink.style.display = 'none';
  }
}

async function loadLiveProjects() {
  try {
    localStorage.removeItem('coden-projects');
    localStorage.removeItem('coden-current-project');
    const response = await apiFetch<ProjectListResponse>('/api/projects');
    renderLiveProjects(response.projects || []);
  } catch (error) {
    const grid = document.querySelector('.projects-grid') as HTMLElement | null;
    if (grid) {
      grid.innerHTML = `
        <div class="empty-state">
          <h3 class="empty-title">Projects unavailable</h3>
          <p class="empty-desc">${escapeHtml(error instanceof Error ? error.message : 'Unable to load projects from Supabase.')}</p>
        </div>
      `;
    }
  }
}

async function loadLiveWallet() {
  const count = document.querySelector('.credits-count');
  const total = document.querySelector('.credits-total');
  const pill = document.getElementById('btn-upgrade-dashboard') as HTMLButtonElement | null;
  const badge = document.getElementById('dashboard-plan-badge');
  const separator = pill?.querySelector('.dashboard-plan-separator') as HTMLElement | null;
  const skeleton = pill?.querySelector('.dashboard-plan-pill-skeleton') as HTMLElement | null;
  if (isLocalPreviewEnabled()) {
    [count, badge, separator].forEach(node => node?.setAttribute('hidden', ''));
    if (total) {
      total.textContent = 'Aperçu local';
      total.removeAttribute('hidden');
    }
    skeleton?.setAttribute('hidden', '');
    pill?.classList.remove('is-loading');
    pill?.classList.add('is-unavailable');
    if (pill) pill.disabled = true;
    return;
  }
  try {
    const wallet = await apiFetch<BillingWalletResponse>('/api/billing/wallet');
    syncDashboardPlanBadges(wallet.plan || 'free');
    if (count) count.textContent = String(wallet.balance ?? 0);
    if (total) total.textContent = 'crédits';
    [count, total, badge, separator].forEach(node => node?.removeAttribute('hidden'));
    skeleton?.setAttribute('hidden', '');
    pill?.classList.remove('is-loading', 'is-unavailable');
    if (pill) pill.disabled = false;
  } catch {
    [count, badge, separator].forEach(node => node?.setAttribute('hidden', ''));
    if (total) {
      total.textContent = 'Forfait indisponible';
      total.removeAttribute('hidden');
    }
    skeleton?.setAttribute('hidden', '');
    pill?.classList.remove('is-loading');
    pill?.classList.add('is-unavailable');
    if (pill) pill.disabled = true;
  }
}

function normalizePlanKey(value: unknown): PlanKey {
  const raw = String(value || 'free').trim().toLowerCase();
  if (raw === 'pro' || raw === 'scale' || raw === 'enterprise') return raw;
  return 'free';
}

function planLabel(plan: PlanKey) {
  if (plan === 'enterprise') return 'Enterprise';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function planRank(plan: PlanKey) {
  return plan === 'enterprise' ? 4 : plan === 'scale' ? 3 : plan === 'pro' ? 2 : 1;
}

function syncDashboardPlanBadges(planInput: unknown) {
  const plan = normalizePlanKey(planInput);
  const badge = document.getElementById('dashboard-plan-badge');
  if (badge) {
    badge.textContent = planLabel(plan);
    badge.classList.remove('free', 'pro', 'scale', 'enterprise', 'team');
    badge.classList.add(plan);
    badge.setAttribute('title', `Current plan: ${planLabel(plan)}`);
  }
  document.querySelectorAll<HTMLElement>('.workspace-plan-tag[data-plan-min]').forEach(tag => {
    const minPlan = normalizePlanKey(tag.dataset.planMin);
    const included = planRank(plan) >= planRank(minPlan);
    tag.textContent = included ? 'Included' : planLabel(minPlan);
    tag.classList.toggle('included', included);
    tag.classList.toggle('locked', !included);
    tag.setAttribute('title', included
      ? `Available on your ${planLabel(plan)} plan`
      : `Requires ${planLabel(minPlan)} plan`);
  });
}

function formatCredits(value: unknown) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatUsd(value: unknown) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `$${number.toFixed(number % 1 === 0 ? 0 : 2)}`;
}

function formatGb(value: unknown) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number % 1 === 0 ? number.toFixed(0) : number.toFixed(2)} GB`;
}

function formatDate(iso?: string) {
  if (!iso) return 'Recently';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return 'Recently';
  }
}

function renderAiUsage(data: AiUsageResponse, rates: ModelRateResponse) {
  const balance = document.getElementById('ai-usage-balance');
  const monthly = document.getElementById('ai-usage-monthly');
  const daily = document.getElementById('ai-usage-daily');
  const topups = document.getElementById('ai-usage-topups');
  if (balance) balance.textContent = formatCredits(data.wallet?.balance);
  if (monthly) monthly.textContent = formatCredits(data.wallet?.monthly_credits);
  if (daily) daily.textContent = formatCredits(data.wallet?.daily_promo_credits);
  if (topups) topups.textContent = formatCredits(data.wallet?.topup_credits);

  const cloud = data.wallet?.cloud;
  const cloudBalance = document.getElementById('cloud-balance');
  const cloudAiApp = document.getElementById('cloud-ai-app');
  const cloudTopupMin = document.getElementById('cloud-topup-min');
  const cloudDbStorage = document.getElementById('cloud-db-storage');
  const cloudFileStorage = document.getElementById('cloud-file-storage');
  const cloudBandwidth = document.getElementById('cloud-bandwidth');
  if (cloudBalance) cloudBalance.textContent = formatUsd(cloud?.balance_usd);
  if (cloudAiApp) cloudAiApp.textContent = formatUsd(cloud?.ai_app_balance_usd);
  if (cloudTopupMin) cloudTopupMin.textContent = cloud?.topup_min_usd ? formatUsd(cloud.topup_min_usd) : 'Included only';
  if (cloudDbStorage) cloudDbStorage.textContent = formatGb(cloud?.database_storage_gb);
  if (cloudFileStorage) cloudFileStorage.textContent = formatGb(cloud?.file_storage_gb);
  if (cloudBandwidth) cloudBandwidth.textContent = formatGb(cloud?.bandwidth_gb);

  const history = document.getElementById('ai-usage-history');
  if (history) {
    const rows = data.history || [];
    history.innerHTML = rows.length ? rows.map(item => `
      <div class="usage-row">
        <div class="usage-row-head">
          <span class="usage-row-title">${escapeHtml(item.mode || 'AI action')}</span>
          <span class="usage-credit-pill">${escapeHtml(formatCredits(item.credits_charged))} credits</span>
        </div>
        <div class="usage-row-meta">
          ${escapeHtml(item.model_name || 'Auto')} · ${escapeHtml(item.project_name || 'Projet')} · ${escapeHtml(item.status || 'completed')} · ${escapeHtml(formatDate(item.created_at))}
        </div>
      </div>
    `).join('') : '<div class="usage-empty">AI usage history will appear here after your first Plan, Build, Fix or Deploy action.</div>';
  }

  const rateList = document.getElementById('model-credit-rates');
  if (rateList) {
    const models = rates.models || [];
    rateList.innerHTML = models.length ? models.map(model => `
      <div class="model-rate-row">
        <div class="model-rate-head">
          <div>
            <div class="model-rate-title">${escapeHtml(model.display_name)}</div>
            <div class="model-rate-meta">${escapeHtml(model.availability === 'all' ? 'Available to all plans' : `${model.availability} plan and above`)}</div>
          </div>
          <span class="model-tier-pill">${escapeHtml(model.tier)}</span>
        </div>
        <div class="model-credit-grid">
          <div class="model-credit-cell"><span>Plan</span><strong>${escapeHtml(model.credits.plan)}</strong></div>
          <div class="model-credit-cell"><span>Build</span><strong>${escapeHtml(model.credits.build)}</strong></div>
          <div class="model-credit-cell"><span>Fix</span><strong>${escapeHtml(model.credits.fix)}</strong></div>
          <div class="model-credit-cell"><span>Deploy</span><strong>${escapeHtml(model.credits.deploy)}</strong></div>
        </div>
      </div>
    `).join('') : '<div class="usage-empty">Model credit rates are unavailable right now.</div>';
  }
}

async function loadAiUsageSettings(force = false) {
  if (aiUsageLoaded && !force) return;
  const history = document.getElementById('ai-usage-history');
  const rateList = document.getElementById('model-credit-rates');
  if (history) history.innerHTML = '<div class="usage-empty">Loading AI usage...</div>';
  if (rateList) rateList.innerHTML = '<div class="usage-empty">Loading model credit rates...</div>';
  try {
    const [usage, rates] = await Promise.all([
      apiFetch<AiUsageResponse>('/api/users/me/ai-usage'),
      apiFetch<ModelRateResponse>('/api/users/me/model-credit-rates'),
    ]);
    renderAiUsage(usage, rates);
    aiUsageLoaded = true;
  } catch (error) {
    if (history) history.innerHTML = `<div class="usage-empty">${escapeHtml(error instanceof Error ? error.message : 'Unable to load AI usage.')}</div>`;
    if (rateList) rateList.innerHTML = '<div class="usage-empty">Model credit rates are unavailable right now.</div>';
  }
}

function bindAiUsageSettings() {
  if (aiUsageSettingsBound) return;
  aiUsageSettingsBound = true;
  ensureSettingsPanel();
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('#btn-settings')) return;
    event.preventDefault();
    openSettings('profile');
  });
}

function bindDashboardConnectors() {
  document.querySelectorAll<HTMLButtonElement>('#btn-connectors, [data-open-connectors]').forEach(button => {
    if (button.dataset.codenConnectorsBound === 'true') return;
    button.dataset.codenConnectorsBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      openConnectorsPanel();
    });
  });
  document.addEventListener('coden:open-connectors', () => openConnectorsPanel());
  document.addEventListener('coden:open-settings', event => {
    const tab = String((event as CustomEvent).detail?.tab || 'connectors');
    openSettings(tab as any);
  });
}

function initDashboardChrome() {
  if (dashboardChromeInitialized) return;
  dashboardChromeInitialized = true;
  installDashboardUxPolish();
  initCodenMotion();
  ensureSettingsPanel();
  initPromptInputActions({
    persistForBuilder: true,
    onFiles: uploadDashboardAttachments,
    onAttachmentsChange: attachments => {
      const nextIds = new Set(attachments.map(item => item.id));
      dashboardAttachments
        .filter(item => item.id.startsWith('att_') && !nextIds.has(item.id))
        .forEach(item => {
          void apiFetch(`/api/assistant/attachments/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => undefined);
        });
      dashboardAttachments = attachments;
      void storePendingPromptAttachments(attachments);
      window.dispatchEvent(new Event('coden:dashboard-attachments-change'));
    },
  });
  initProviderModelSelectors();
  bindAiUsageSettings();
  bindDashboardConnectors();
}

function bindLiveProjectCreation() {
  const oldButton = document.getElementById('btn-new-proj-create') as HTMLButtonElement | null;
  if (!oldButton) return;

  const button = oldButton.cloneNode(true) as HTMLButtonElement;
  oldButton.replaceWith(button);

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const nameInput = document.getElementById('new-proj-name') as HTMLInputElement | null;
    const templateSelect = document.getElementById('new-proj-template') as HTMLSelectElement | null;
    const themeSelect = document.getElementById('new-proj-theme') as HTMLSelectElement | null;
    const modelSelect = document.getElementById('new-proj-model') as HTMLSelectElement | null;
    const name = nameInput?.value.trim() || '';

    if (!name) {
      showProjectError('Please enter a valid project name.');
      return;
    }

    const template = templateSelect?.value || 'dashboard';
    const theme = themeSelect?.value || 'light';
    const model = modelSelect?.value || 'auto';
    const features = selectedFeatures();
    const initialPrompt = sessionStorage.getItem('coden-initial-prompt')?.trim() || localStorage.getItem('coden-initial-prompt')?.trim() || '';
    const prompt = initialPrompt || `Create a ${getTemplateDescription(template)} named "${name}". Include ${features.join(', ') || 'a polished responsive UI'}.`;

    setCreateBusy(button, true);
    showProjectError('');

    try {
      await startCreateProjectFlow({
        prompt,
        mode: selectedDashboardMode(),
        source: 'modal',
        projectName: name,
        template,
        theme,
        model,
        features,
      }, {
        createProject: true,
        onStatus: status => {
          const locale = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
          button.textContent = formatCreateProjectFlowStatus(status, locale);
        },
      });
    } catch (error) {
      showProjectError(error instanceof Error ? error.message : 'Unable to create the project.');
    } finally {
      setCreateBusy(button, false);
    }
  });
}

function dashboardMessageId(role: DashboardChatRole) {
  return `dash_${role}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function dashboardSelectedModel() {
  return localStorage.getItem('coden-selected-model') || 'auto';
}

function dashboardSetChatState(state: 'idle' | 'conversation' | 'promoting') {
  const createSection = document.querySelector('.create-section') as HTMLElement | null;
  createSection?.setAttribute('data-chat-state', state);
}

function ensureDashboardChatThread() {
  let thread = document.getElementById('dashboard-chat-thread') as HTMLElement | null;
  if (thread) return thread;
  const createSection = document.querySelector('.create-section') as HTMLElement | null;
  const inputWrapper = createSection?.querySelector('.input-wrapper') as HTMLElement | null;
  if (!createSection || !inputWrapper) return null;
  thread = document.createElement('div');
  thread.id = 'dashboard-chat-thread';
  thread.className = 'dashboard-chat-thread';
  thread.setAttribute('aria-live', 'polite');
  inputWrapper.insertAdjacentElement('beforebegin', thread);
  return thread;
}

function dashboardChatHtml(text: string) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function renderDashboardChat() {
  const thread = ensureDashboardChatThread();
  if (!thread) return;
  dashboardAgentRoots.forEach(root => root.unmount());
  dashboardAgentRoots.clear();
  // No indentation/newlines inside the bubble: it has white-space: pre-wrap,
  // so any template whitespace would render as real space and inflate the bubble.
  thread.innerHTML = dashboardChatMessages.map(message => {
    if (message.role === 'assistant' && message.view) {
      return `<article class="dashboard-chat-message assistant dashboard-chat-agent-message" data-message-id="${escapeHtml(message.id)}"><div class="dashboard-agent-run-host" data-dashboard-agent-host="${escapeHtml(message.id)}"></div></article>`;
    }
    const thinking = message.role === 'assistant' && message.streaming;
    const pendingIndicator = thinking && !message.content
      ? '<span class="dashboard-chat-pending" aria-hidden="true"><i></i><i></i><i></i></span>'
      : '';
    return (
    `<article class="dashboard-chat-message ${message.role}" data-message-id="${escapeHtml(message.id)}">` +
    `<div class="dashboard-chat-bubble${thinking ? ' is-thinking' : ''}">${dashboardChatHtml(message.content)}${pendingIndicator}` +
    `${message.streaming ? '<span class="dashboard-chat-cursor" aria-hidden="true"></span>' : ''}</div>` +
    `</article>`
    );
  }).join('');
  dashboardChatMessages.forEach(message => {
    if (message.role !== 'assistant' || !message.view) return;
    const host = thread.querySelector(`[data-dashboard-agent-host="${CSS.escape(message.id)}"]`) as HTMLElement | null;
    if (!host) return;
    const root = createRoot(host);
    dashboardAgentRoots.set(message.id, root);
    root.render(createElement(AgentRunPanel, {
      view: message.view,
      streamText: message.content,
      locale: (document.documentElement.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en',
      onCancel: () => dashboardStreamHandles.get(message.id)?.cancel(),
      onRetry: () => void streamDashboardConversation(message.view?.prompt || message.content, message.id, message.view?.requestedMode || 'auto'),
      onBuildPlan: () => {
        if (window.confirm('Construire ce plan dans le Builder ? Les fichiers pourront être modifiés après validation du contexte.')) {
          void promoteDashboardPromptToBuilder(message.view?.prompt || message.content, 'build', message.view?.planId);
        }
      },
    }));
  });
  thread.scrollTop = thread.scrollHeight;
}

function renderDashboardAgentMessage(message: DashboardChatMessage) {
  if (!message.view) return;
  const root = dashboardAgentRoots.get(message.id);
  if (!root) {
    renderDashboardChat();
    return;
  }
  root.render(createElement(AgentRunPanel, {
    view: message.view,
    streamText: message.content,
    locale: (document.documentElement.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en',
    onCancel: () => dashboardStreamHandles.get(message.id)?.cancel(),
    onRetry: () => void streamDashboardConversation(message.view?.prompt || message.content, message.id, message.view?.requestedMode || 'auto'),
    onBuildPlan: () => {
      if (window.confirm('Construire ce plan dans le Builder ? Les fichiers pourront être modifiés après validation du contexte.')) {
        void promoteDashboardPromptToBuilder(message.view?.prompt || message.content, 'build', message.view?.planId);
      }
    },
  }));
}

function scheduleDashboardAgentRender(messageId: string) {
  dashboardAgentRenderQueue.add(messageId);
  if (dashboardAgentRenderFrame !== null) return;
  dashboardAgentRenderFrame = window.requestAnimationFrame(() => {
    dashboardAgentRenderFrame = null;
    const ids = [...dashboardAgentRenderQueue];
    dashboardAgentRenderQueue.clear();
    ids.forEach(id => {
      const message = dashboardChatMessages.find(item => item.id === id);
      if (message) renderDashboardAgentMessage(message);
    });
  });
}

function appendDashboardMessage(role: DashboardChatRole, content: string, streaming = false) {
  const message: DashboardChatMessage = {
    id: dashboardMessageId(role),
    role,
    content,
    streaming,
  };
  dashboardChatMessages.push(message);
  renderDashboardChat();
  return message.id;
}

function appendDashboardRunMessage(prompt: string, mode: AgentMode) {
  const message: DashboardChatMessage = {
    id: dashboardMessageId('assistant'),
    role: 'assistant',
    content: '',
    streaming: true,
    view: createAgentRunViewModel({
      runId: `dashboard_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      prompt,
      requestedMode: mode,
      model: dashboardSelectedModel(),
      status: 'submitting',
      language: (document.documentElement.lang || '').toLowerCase().startsWith('fr') ? 'fr' : 'en',
    }),
  };
  dashboardChatMessages.push(message);
  renderDashboardChat();
  return message.id;
}

function updateDashboardMessage(id: string, content: string, streaming = false) {
  const message = dashboardChatMessages.find(item => item.id === id);
  if (!message) return;
  message.content = content;
  message.streaming = streaming;
  if (message.view) {
    message.view.assistantText = content;
    scheduleDashboardAgentRender(id);
    return;
  }
  renderDashboardChat();
}

function recentDashboardConversationForAssistant() {
  return dashboardChatMessages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-10)
    .map(message => ({ role: message.role, content: message.content }));
}

async function streamDashboardConversation(prompt: string, assistantMessageId: string, requestedMode: AgentMode = 'auto') {
  dashboardAssistantBusy = true;
  let verified = await getVerifiedSession({ allowRefresh: true });
  if (!verified?.session?.access_token) verified = await refreshVerifiedSession();
  if (!verified?.session?.access_token) {
    const message = dashboardChatMessages.find(item => item.id === assistantMessageId);
    if (message?.view) {
      message.view.status = 'failed';
      message.view.error = 'Session expirée. Reconnectez-vous pour continuer.';
      scheduleDashboardAgentRender(assistantMessageId);
    } else {
      updateDashboardMessage(assistantMessageId, 'Session expirée. Reconnectez-vous pour continuer.', false);
    }
    window.location.href = `/auth.html?redirect=${encodeURIComponent('/dashboard.html')}`;
    dashboardAssistantBusy = false;
    return;
  }
  const message = dashboardChatMessages.find(item => item.id === assistantMessageId);
  if (!message?.view) {
    dashboardAssistantBusy = false;
    return;
  }
  const handle = openCodenStream({
    url: '/api/assistant/chat/stream',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${verified.session.access_token}` },
      body: JSON.stringify({
        prompt,
        requestedMode,
        modelId: dashboardSelectedModel(),
        projectId: selectedDashboardProjectId() || undefined,
        attachmentIds: dashboardAttachments.filter(item => item.status === 'uploaded').map(item => item.id),
        messages: recentDashboardConversationForAssistant(),
      }),
    },
    maxRetries: 0,
    idleTimeoutMs: 45_000,
    onProtocolEvent: (event: CodenStreamEvent) => {
      const current = dashboardChatMessages.find(item => item.id === assistantMessageId);
      if (!current?.view) return;
      current.view = applyAgentStreamEvent(current.view, event);
      if (event.type === 'assistant_delta') current.content = current.view.assistantText;
      if (event.type === 'done') current.streaming = false;
      scheduleDashboardAgentRender(assistantMessageId);
    },
    onEvent: (_type, data) => {
      if (!isCodenStreamEvent(data)) return;
      if (data.type === 'error') {
        const current = dashboardChatMessages.find(item => item.id === assistantMessageId);
        if (current?.view) current.view.error = data.message;
      }
    },
  });
  dashboardStreamHandles.set(assistantMessageId, handle);
  try {
    await handle.done;
    const current = dashboardChatMessages.find(item => item.id === assistantMessageId);
    if (current?.view && !current.view.hasFinal && !handle.isCancelled()) {
      current.view.status = 'incomplete';
      current.view.error = 'Le flux s’est interrompu avant sa fin.';
    }
    if (current) current.streaming = false;
    scheduleDashboardAgentRender(assistantMessageId);
  } catch (error) {
    const current = dashboardChatMessages.find(item => item.id === assistantMessageId);
    if (current?.view) {
      current.view.status = handle.isCancelled() ? 'cancelled' : 'failed';
      current.view.error = error instanceof Error && error.message.trim() ? error.message.trim() : 'Le flux IA a échoué.';
      current.streaming = false;
      scheduleDashboardAgentRender(assistantMessageId);
    }
  } finally {
    dashboardStreamHandles.delete(assistantMessageId);
    dashboardAssistantBusy = false;
  }
}

type DashboardDecisionResponse = {
  success: boolean;
  request_id?: string;
  requested_mode?: AgentMode;
  resolved_action?: string;
  requires_project?: boolean;
  requires_confirmation?: boolean;
  objective?: AgentRunViewModel['objective'];
  clarification?: { question: string; options?: string[] };
  error?: string;
  message?: string;
};

async function requestDashboardDecision(prompt: string, requestedMode: AgentMode) {
  return apiFetch<DashboardDecisionResponse>('/api/assistant/decision', {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      requestedMode,
      modelId: dashboardSelectedModel(),
      projectId: selectedDashboardProjectId() || undefined,
      attachmentIds: dashboardAttachments.filter(item => item.status === 'uploaded').map(item => item.id),
      messages: recentDashboardConversationForAssistant(),
    }),
  });
}

async function promoteDashboardPromptToBuilder(prompt: string, mode: AgentMode, planId?: string) {
  const submit = document.getElementById('submit-btn') as HTMLButtonElement | null;
  if (!submit) return;
  const original = submit.innerHTML;
  dashboardSetChatState('promoting');
  const statusMessageId = appendDashboardMessage('system', '', true);
  submit.classList.add('is-loading');
  try {
    const selectedProject = selectedDashboardProjectId();
    if (selectedProject) {
      sessionStorage.setItem('coden-initial-prompt', prompt);
      sessionStorage.setItem('coden-requested-mode', mode);
      sessionStorage.setItem('coden-selected-model', dashboardSelectedModel());
      if (planId) sessionStorage.setItem('coden-approved-plan-id', planId);
      sessionStorage.setItem('coden-dashboard-handoff', JSON.stringify({
        projectId: selectedProject,
        prompt,
        requestedMode: mode,
        modelId: dashboardSelectedModel(),
        attachmentIds: dashboardAttachments.filter(item => item.status === 'uploaded').map(item => item.id),
        planId,
        createdAt: Date.now(),
      }));
      await storePendingPromptAttachments(dashboardAttachments);
      window.location.href = builderUrl(selectedProject);
      return;
    }
    if (planId) sessionStorage.setItem('coden-approved-plan-id', planId);
    await startCreateProjectFlow({
      prompt,
      mode,
      source: 'dashboard',
      projectName: projectNameFromPrompt(prompt),
      model: dashboardSelectedModel(),
      template: 'custom',
      theme: 'light',
    }, {
      createProject: true,
      onStatus: status => {
        const locale = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr') ? 'fr' : 'en';
        const label = formatCreateProjectFlowStatus(status, locale);
        updateDashboardMessage(statusMessageId, label, true);
        submit.textContent = label;
      },
    });
  } catch (error) {
    updateDashboardMessage(statusMessageId, error instanceof Error ? error.message : 'Impossible de démarrer le projet pour le moment.', false);
    submit.classList.remove('is-loading');
    submit.innerHTML = original;
  }
}

function bindDashboardComposerControls() {
  const textarea = document.getElementById('ai-textarea') as HTMLTextAreaElement | null;
  const submit = document.getElementById('submit-btn') as HTMLButtonElement | null;
  const projectSelect = document.getElementById('dashboard-project-select') as HTMLSelectElement | null;
  const wrapper = textarea?.closest('.input-wrapper') as HTMLElement | null;
  if (!textarea || !submit || !wrapper || wrapper.dataset.codenComposerBound === 'true') return;
  wrapper.dataset.codenComposerBound = 'true';

  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(220, Math.max(84, textarea.scrollHeight))}px`;
  };
  const syncSubmit = () => {
    const hasPrompt = Boolean(textarea.value.trim());
    const hasAttachment = dashboardAttachments.some(item => item.status === 'uploaded');
    const uploading = dashboardAttachments.some(item => item.status === 'pending');
    submit.disabled = dashboardAssistantBusy || uploading || (!hasPrompt && !hasAttachment) || isLocalPreviewEnabled();
    wrapper.dataset.composerState = dashboardAssistantBusy ? 'streaming' : uploading ? 'uploading' : 'idle';
  };
  const applySlashCommand = () => {
    const raw = textarea.value.trim().toLowerCase();
    const commands: Record<string, DashboardMode> = { '/auto': 'auto', '/build': 'build', '/plan': 'plan' };
    const mode = commands[raw];
    if (!mode) return false;
    setDashboardMode(mode);
    textarea.value = '';
    resize();
    syncSubmit();
    return true;
  };

  textarea.addEventListener('input', () => {
    resize();
    syncSubmit();
  });
  textarea.addEventListener('focus', () => { wrapper.dataset.composerState = 'focused'; });
  textarea.addEventListener('blur', () => { wrapper.dataset.composerState = dashboardAssistantBusy ? 'streaming' : 'idle'; });
  textarea.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (applySlashCommand()) return;
      if (!submit.disabled) submit.click();
    }
    if (event.key === 'Escape') textarea.blur();
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      textarea.focus();
    }
  });
  projectSelect?.addEventListener('change', () => {
    if (projectSelect.value === '__new__') {
      projectSelect.value = selectedDashboardProjectId();
      document.getElementById('btn-new-project')?.click();
      return;
    }
    setDashboardProject(projectSelect.value);
  });
  resize();
  syncSubmit();
  window.addEventListener('coden:dashboard-attachments-change', syncSubmit);
}

function bindDashboardPromptCreation() {
  const textarea = document.getElementById('ai-textarea') as HTMLTextAreaElement | null;
  const submit = document.getElementById('submit-btn') as HTMLButtonElement | null;
  if (!textarea || !submit || submit.dataset.codenCreateFlowBound === 'true') return;
  submit.dataset.codenCreateFlowBound = 'true';
  submit.dataset.defaultMarkup = submit.innerHTML;
  if (isLocalPreviewEnabled()) {
    const createSection = document.querySelector('.create-section') as HTMLElement | null;
    const inputWrapper = createSection?.querySelector('.input-wrapper') as HTMLElement | null;
    if (createSection) createSection.dataset.localPreviewLocked = 'true';
    submit.disabled = true;
    submit.setAttribute('aria-disabled', 'true');
    submit.setAttribute('title', 'Génération désactivée dans l’aperçu local');
    const status = document.createElement('div');
    status.id = 'dashboard-local-preview-status';
    status.className = 'dashboard-local-preview-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Génération IA et modifications désactivées dans l’aperçu local.';
    inputWrapper?.appendChild(status);
  }
  submit.addEventListener('click', async event => {
    if (isLocalPreviewEnabled()) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }
    const prompt = textarea.value.trim();
    const hasAttachments = dashboardAttachments.some(item => item.status === 'uploaded');
    if ((!prompt && !hasAttachments) || dashboardAssistantBusy) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const mode = selectedDashboardMode();
    const effectivePrompt = prompt || 'Analyse les pièces jointes fournies et propose la prochaine action utile.';
    dashboardSetChatState('conversation');
    appendDashboardMessage('user', effectivePrompt);
    submit.classList.add('is-loading');
    try {
      const decision = await requestDashboardDecision(effectivePrompt, mode);
      if (decision.success === false) throw new Error(decision.message || decision.error || 'La décision de l’agent est indisponible.');
      textarea.value = '';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      const needsProject = Boolean(decision.requires_project) || ['build', 'edit', 'debug', 'verify'].includes(String(decision.resolved_action));
      if (needsProject) {
        await promoteDashboardPromptToBuilder(effectivePrompt, mode);
        return;
      }
      const assistantId = appendDashboardRunMessage(effectivePrompt, mode);
      submit.classList.remove('is-loading');
      submit.innerHTML = 'Envoyer';
      const message = dashboardChatMessages.find(item => item.id === assistantId);
      if (message?.view) {
        message.view.resolvedAction = decision.resolved_action as AgentRunViewModel['resolvedAction'];
        message.view.objective = decision.objective;
        message.view.clarification = decision.clarification;
        if (decision.clarification) message.view.status = 'clarifying';
        scheduleDashboardAgentRender(assistantId);
      }
      void streamDashboardConversation(effectivePrompt, assistantId, mode);
    } catch (error) {
      textarea.focus();
      submit.classList.remove('is-loading');
      submit.innerHTML = submit.dataset.defaultMarkup || submit.innerHTML;
      submit.disabled = false;
      submit.removeAttribute('aria-disabled');
      appendDashboardMessage('system', error instanceof Error ? error.message : 'La demande n’a pas pu être traitée.', false);
    }
  }, true);
}
type DashboardMobileTarget = 'create' | 'projects' | 'usage' | 'account';

function setDashboardMobileTarget(target: DashboardMobileTarget) {
  document.querySelectorAll<HTMLButtonElement>('[data-mobile-dashboard-target]').forEach(button => {
    const active = button.dataset.mobileDashboardTarget === target;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function scrollDashboardTo(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function bindDashboardMobileNav() {
  document.querySelectorAll<HTMLButtonElement>('[data-mobile-dashboard-target]').forEach(button => {
    if (button.dataset.codenMobileNavBound === 'true') return;
    button.dataset.codenMobileNavBound = 'true';
    button.addEventListener('click', event => {
      event.preventDefault();
      const target = (button.dataset.mobileDashboardTarget || 'create') as DashboardMobileTarget;
      setDashboardMobileTarget(target);
      if (target === 'projects') {
        scrollDashboardTo('.projects-grid');
        return;
      }
      if (target === 'usage') {
        openSettings('ai-usage');
        return;
      }
      if (target === 'account') {
        openSettings('profile');
        return;
      }
      scrollDashboardTo('.create-section');
    });
  });
}

function initDashboardLive() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;
  initDashboardChrome();
  mountDashboardAgentModeComposer();
  bindDashboardComposerControls();
  if (!dashboardChatMessages.length) dashboardSetChatState('idle');
  hydrateUserIdentity((window as any).codenAuthReady);
  bindLiveProjectCreation();
  bindDashboardPromptCreation();
  bindDashboardMobileNav();
  bindDashboardWorkspacePersistence();
  void hydrateWorkspaceState();
  void loadLiveProjects();
  void loadLiveWallet();
  void hydrateAdminConsoleAccess();
}

window.addEventListener('coden:auth-ready', event => {
  (window as any).codenAuthReady = (event as CustomEvent).detail;
  initDashboardLive();
});
if (document.documentElement.dataset.authReady === 'true') initDashboardLive();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboardChrome);
} else {
  initDashboardChrome();
}
