import { apiFetch } from './lib/api';
import { refreshVerifiedSession, signOutCurrentDevice } from './lib/supabase-browser';
import { trackFunnelEvent } from './conversion-events';

type SettingsTab =
  | 'profile'
  | 'account'
  | 'privacy'
  | 'billing'
  | 'appearance'
  | 'ai-usage'
  | 'capabilities'
  | 'connectors'
  | 'api'
  | 'danger';

type AiUsageResponse = {
  success: boolean;
  wallet?: {
    balance?: number | null;
    monthly_credits?: number | null;
    daily_promo_credits?: number | null;
    topup_credits?: number | null;
    cloud?: {
      balance_usd?: number | null;
      included_balance_usd?: number | null;
      ai_app_balance_usd?: number | null;
      database_storage_gb?: number | null;
      file_storage_gb?: number | null;
      bandwidth_gb?: number | null;
      topup_min_usd?: number | null;
      auto_topup_available?: boolean;
      auto_topup_enabled?: boolean;
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

type AuthMeResponse = {
  success: boolean;
  user?: {
    id?: string;
    email?: string | null;
    role?: string | null;
  };
  plan?: {
    key?: string;
    label?: string;
  };
};

type UserWorkspaceStateResponse = {
  success: boolean;
  state?: {
    theme?: 'light' | 'dark' | null;
    builder_selected_model?: string | null;
    updated_at?: string | null;
  } | null;
};

type SettingsPreferences = {
  profile: {
    displayName: string;
    language: 'auto' | 'fr' | 'en';
    timezone: string;
    role: string;
    instructions: string;
  };
  appearance: {
    theme: 'system' | 'light' | 'dark';
    density: 'comfortable' | 'compact';
    motion: 'normal' | 'reduced';
    accent: 'coden-blue' | 'neutral';
  };
  api: {
    webhookUrl: string;
    webhookEvents: string;
  };
};

let settingsStyleInstalled = false;
let settingsBound = false;
let aiUsageLoaded = false;
let currentAuthSummary: AuthMeResponse | null = null;
const SETTINGS_MANAGED_VERSION = '2026-06-12';
const SETTINGS_PREFS_KEY = 'coden.user.settings.v1';
const SETTINGS_DIRTY_CLASS = 'settings-dirty';

const tabAliases: Record<SettingsTab, string> = {
  profile: 'profil',
  account: 'compte',
  privacy: 'confidentialite',
  billing: 'facturation',
  appearance: 'apparence',
  'ai-usage': 'ia',
  capabilities: 'capacites',
  connectors: 'connecteurs',
  api: 'api',
  danger: 'danger',
};

const settingsTabMeta: Record<string, { title: string; description: string }> = {
  profil: { title: 'General', description: 'Profile, language and personal context.' },
  compte: { title: 'Account', description: 'Identity, plan and active session.' },
  confidentialite: { title: 'Privacy', description: 'Memory, data and security controls.' },
  facturation: { title: 'Billing', description: 'Plan, credits and Coden Cloud.' },
  ia: { title: 'Usage', description: 'AI credits, cloud allowance and recent activity.' },
  capacites: { title: 'Capabilities', description: 'Workshops and agent capabilities.' },
  automatisations: { title: 'Agent autonomy', description: 'Budgets, approvals and workflow safety.' },
  connecteurs: { title: 'Connecteurs', description: 'Services et outils disponibles pour le workspace.' },
  api: { title: 'API', description: 'Webhooks and safe connector controls.' },
  apparence: { title: 'Appearance', description: 'Theme, density, motion and accent.' },
  danger: { title: 'Danger', description: 'Reversible resets and sign-out.' },
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function defaultSettingsPreferences(): SettingsPreferences {
  return {
    profile: {
      displayName: '',
      language: 'auto',
      timezone: defaultTimezone(),
      role: 'founder',
      instructions: '',
    },
    appearance: {
      theme: 'system',
      density: 'comfortable',
      motion: 'normal',
      accent: 'coden-blue',
    },
    api: {
      webhookUrl: '',
      webhookEvents: 'publish, rollback, generation_failed',
    },
  };
}

function mergePreferences(value: any): SettingsPreferences {
  const defaults = defaultSettingsPreferences();
  return {
    profile: {
      displayName: String(value?.profile?.displayName || defaults.profile.displayName).slice(0, 80),
      language: ['auto', 'fr', 'en'].includes(value?.profile?.language) ? value.profile.language : defaults.profile.language,
      timezone: String(value?.profile?.timezone || defaults.profile.timezone).slice(0, 80),
      role: String(value?.profile?.role || defaults.profile.role).slice(0, 80),
      instructions: String(value?.profile?.instructions || defaults.profile.instructions).slice(0, 1200),
    },
    appearance: {
      theme: ['system', 'light', 'dark'].includes(value?.appearance?.theme) ? value.appearance.theme : defaults.appearance.theme,
      density: value?.appearance?.density === 'compact' ? 'compact' : 'comfortable',
      motion: value?.appearance?.motion === 'reduced' ? 'reduced' : 'normal',
      accent: value?.appearance?.accent === 'neutral' ? 'neutral' : 'coden-blue',
    },
    api: {
      webhookUrl: String(value?.api?.webhookUrl || '').slice(0, 320),
      webhookEvents: String(value?.api?.webhookEvents || defaults.api.webhookEvents).slice(0, 180),
    },
  };
}

function loadSettingsPreferences(): SettingsPreferences {
  try {
    return mergePreferences(JSON.parse(localStorage.getItem(SETTINGS_PREFS_KEY) || '{}'));
  } catch {
    return defaultSettingsPreferences();
  }
}

function saveSettingsPreferences(value: SettingsPreferences) {
  localStorage.setItem(SETTINGS_PREFS_KEY, JSON.stringify(value));
}

function resolveThemePreference(theme: SettingsPreferences['appearance']['theme']) {
  if (theme === 'system') {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

function applyAppearancePreferences(value = loadSettingsPreferences()) {
  const theme = resolveThemePreference(value.appearance.theme);
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('coden-theme', theme);
  document.documentElement.dataset.codenDensity = value.appearance.density;
  document.documentElement.dataset.codenMotion = value.appearance.motion;
  document.documentElement.dataset.codenAccent = value.appearance.accent;
}

function readSettingsForm(): SettingsPreferences {
  const prefs = loadSettingsPreferences();
  const read = (selector: string) => (document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector)?.value || '').trim();
  return mergePreferences({
    profile: {
      displayName: read('[data-settings-field="displayName"]'),
      language: read('[data-settings-field="language"]'),
      timezone: read('[data-settings-field="timezone"]'),
      role: read('[data-settings-field="role"]'),
      instructions: read('[data-settings-field="instructions"]'),
    },
    appearance: {
      theme: document.querySelector<HTMLElement>('[data-settings-theme].active')?.dataset.settingsTheme || prefs.appearance.theme,
      density: document.querySelector<HTMLElement>('[data-settings-density].active')?.dataset.settingsDensity || prefs.appearance.density,
      motion: document.querySelector<HTMLElement>('[data-settings-motion].active')?.dataset.settingsMotion || prefs.appearance.motion,
      accent: document.querySelector<HTMLElement>('[data-settings-accent].active')?.dataset.settingsAccent || prefs.appearance.accent,
    },
    api: {
      webhookUrl: read('[data-settings-field="webhookUrl"]'),
      webhookEvents: read('[data-settings-field="webhookEvents"]'),
    },
  });
}

function setSettingsStatus(message: string, tone: 'idle' | 'saving' | 'success' | 'error' = 'idle') {
  const status = document.querySelector<HTMLElement>('[data-settings-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function markSettingsDirty() {
  const panel = document.getElementById('settings-panel');
  panel?.classList.add(SETTINGS_DIRTY_CLASS);
  setSettingsStatus('Unsaved changes', 'saving');
}

function setSegmentActive(group: string, value: string) {
  document.querySelectorAll<HTMLElement>(`[data-settings-${group}]`).forEach(button => {
    button.classList.toggle('active', button.dataset[`settings${group[0].toUpperCase()}${group.slice(1)}`] === value);
  });
}

function installSettingsStyle() {
  if (settingsStyleInstalled || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.id = 'coden-settings-panel-style';
  style.textContent = `
    .settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 9000;
      background: rgba(9, 9, 11, .34);
      opacity: 0;
      visibility: hidden;
      backdrop-filter: blur(8px);
    }

    .settings-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .settings-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 9001;
      display: flex;
      flex-direction: column;
      width: min(620px, 100vw);
      background: var(--bg, #fcfbf8);
      color: var(--text, #1c1c1c);
      border-left: 1px solid var(--border, #eceae4);
      box-shadow: -24px 0 80px rgba(28,28,28,.12);
      transform: translateX(100%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition:
        transform var(--motion-panel, 260ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        opacity var(--motion-normal, 180ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        visibility 0s linear var(--motion-panel, 260ms);
    }

    .settings-panel.open {
      transform: translateX(0);
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transition:
        transform var(--motion-panel, 260ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        opacity var(--motion-normal, 180ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        visibility 0s linear 0s;
    }

    .settings-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
      border-bottom: 1px solid var(--border-light, rgba(236,234,228,.78));
    }

    .settings-header h2 {
      margin: 0;
      font-size: 16px;
      letter-spacing: -.02em;
    }

    .settings-close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 7px;
      background: transparent;
      color: var(--text-sub, #77736b);
      cursor: pointer;
    }

    .settings-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-light, rgba(236,234,228,.78));
      overflow-x: auto;
    }

    .settings-tab {
      height: 28px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 0 10px;
      background: transparent;
      color: var(--text-sub, #77736b);
      cursor: pointer;
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 750;
    }

    .settings-tab.active {
      border-color: var(--border-focus, var(--border, #eceae4));
      background: var(--accent-blue-soft, var(--bg-elevated, #f7f4ed));
      color: var(--accent-blue, var(--text, #1c1c1c));
    }

    .settings-content {
      min-height: 0;
      overflow: auto;
      padding: 16px;
    }

    .settings-title-stack {
      display: grid;
      gap: 4px;
    }

    .settings-title-stack small {
      color: var(--text-sub, #77736b);
      font-size: 11px;
      line-height: 1.4;
    }

    .settings-status {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 9px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 999px;
      background: var(--bg-surface, #fffdf8);
      color: var(--text-sub, #77736b);
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .settings-status[data-tone="saving"] {
      color: var(--accent-blue, #2563eb);
      border-color: color-mix(in srgb, var(--accent-blue, #2563eb) 32%, var(--border, #eceae4));
    }

    .settings-status[data-tone="success"] {
      color: #11845b;
      border-color: rgba(17, 132, 91, .28);
      background: rgba(17, 132, 91, .08);
    }

    .settings-status[data-tone="error"] {
      color: #b42318;
      border-color: rgba(180, 35, 24, .28);
      background: rgba(180, 35, 24, .08);
    }

    .tab-panel.hidden {
      display: none !important;
    }

    .settings-card {
      border: 1px solid var(--border, #eceae4);
      border-radius: 14px;
      background: var(--bg-surface, #fffdf8);
      padding: 14px;
      margin-bottom: 12px;
      transition:
        transform var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        border-color var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        background var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    }

    .settings-card:hover {
      border-color: var(--border-focus, var(--border, #eceae4));
      transform: translateY(-1px);
    }

    .settings-card h3 {
      margin: 0 0 6px;
      font-size: 13px;
      letter-spacing: -.01em;
    }

    .settings-card p {
      margin: 0;
      color: var(--text-sub, #77736b);
      font-size: 12px;
      line-height: 1.55;
    }

    .settings-hero-card {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 14px;
      align-items: center;
      background:
        radial-gradient(circle at 10% 0%, var(--accent-blue-soft, rgba(59,130,246,.14)), transparent 38%),
        var(--bg-surface, #fffdf8);
    }

    .settings-avatar {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      color: var(--bg, #fcfbf8);
      background: var(--accent-blue, #2563eb);
      font-size: 18px;
      font-weight: 900;
      box-shadow: 0 16px 34px rgba(37, 99, 235, .22);
    }

    .settings-plan-badge,
    .settings-mini-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      border: 1px solid var(--border, #eceae4);
      background: var(--bg-elevated, #f7f4ed);
      color: var(--text, #1c1c1c);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .06em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .settings-field-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .settings-field {
      display: grid;
      gap: 7px;
    }

    .settings-field.full {
      grid-column: 1 / -1;
    }

    .settings-field label,
    .settings-control-label {
      color: var(--text-sub, #77736b);
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .settings-field input,
    .settings-field select,
    .settings-field textarea {
      width: 100%;
      min-height: 38px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 10px;
      background: var(--bg, #fcfbf8);
      color: var(--text, #1c1c1c);
      padding: 9px 11px;
      outline: none;
      font: inherit;
      font-size: 13px;
      transition:
        border-color var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        box-shadow var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    }

    .settings-field textarea {
      min-height: 72px;
      resize: vertical;
    }

    .settings-field input:focus,
    .settings-field select:focus,
    .settings-field textarea:focus {
      border-color: var(--accent-blue, #2563eb);
      box-shadow: 0 0 0 3px var(--accent-blue-soft, rgba(59,130,246,.14));
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 0;
      border-top: 1px solid var(--border-light, rgba(236,234,228,.78));
    }

    .settings-row:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .settings-row strong {
      display: block;
      margin-bottom: 3px;
      color: var(--text, #1c1c1c);
      font-size: 13px;
    }

    .settings-row span,
    .settings-row code {
      color: var(--text-sub, #77736b);
      font-size: 12px;
    }

    .settings-row code {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }

    .settings-action-button,
    .settings-danger-button {
      min-height: 32px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 9px;
      padding: 0 11px;
      background: var(--bg, #fcfbf8);
      color: var(--text, #1c1c1c);
      font-size: 12px;
      font-weight: 850;
      cursor: pointer;
      transition:
        transform var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        background var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    }

    .settings-action-button:hover,
    .settings-danger-button:hover {
      transform: translateY(-1px);
      background: var(--bg-elevated, #f7f4ed);
    }

    .settings-danger-button {
      color: #b42318;
      border-color: rgba(180, 35, 24, .24);
      background: rgba(180, 35, 24, .06);
    }

    .settings-segment {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .settings-segment button {
      min-height: 32px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 999px;
      padding: 0 12px;
      background: var(--bg, #fcfbf8);
      color: var(--text-sub, #77736b);
      font-size: 12px;
      font-weight: 850;
      cursor: pointer;
    }

    .settings-segment button.active {
      border-color: var(--accent-blue, #2563eb);
      background: var(--accent-blue-soft, rgba(59,130,246,.14));
      color: var(--accent-blue, #2563eb);
    }

    .settings-integration-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .settings-integration {
      border: 1px solid var(--border-light, rgba(236,234,228,.78));
      border-radius: 11px;
      padding: 10px;
      background: var(--bg, #fcfbf8);
    }

    .settings-integration strong {
      display: block;
      color: var(--text, #1c1c1c);
      font-size: 12px;
      margin-bottom: 5px;
    }

    .settings-integration span {
      color: var(--text-sub, #77736b);
      font-size: 11px;
      line-height: 1.45;
    }

    .settings-danger-zone {
      border-color: rgba(180, 35, 24, .2);
      background:
        linear-gradient(180deg, rgba(180, 35, 24, .05), transparent 58%),
        var(--bg-surface, #fffdf8);
    }

    .usage-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .cloud-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .usage-summary-card,
    .cloud-summary-card {
      border: 1px solid var(--border-light, rgba(236,234,228,.78));
      border-radius: 10px;
      padding: 10px;
      background: var(--bg-elevated, #f7f4ed);
    }

    .usage-summary-label,
    .cloud-summary-label {
      display: block;
      margin-bottom: 6px;
      color: var(--text-sub, #77736b);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .usage-summary-value,
    .cloud-summary-value {
      color: var(--accent-blue, var(--text, #1c1c1c));
      font-size: 18px;
      font-weight: 850;
      letter-spacing: -.03em;
      font-variant-numeric: tabular-nums;
    }

    .usage-row,
    .model-rate-row {
      border: 1px solid var(--border-light, rgba(236,234,228,.78));
      border-radius: 10px;
      padding: 10px;
      background: var(--bg, #fcfbf8);
    }

    .usage-row + .usage-row,
    .model-rate-row + .model-rate-row {
      margin-top: 8px;
    }

    .usage-row-head,
    .model-rate-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }

    .usage-row-title,
    .model-rate-title {
      color: var(--text, #1c1c1c);
      font-size: 12px;
      font-weight: 800;
    }

    .usage-row-meta,
    .model-rate-meta {
      margin-top: 4px;
      color: var(--text-sub, #77736b);
      font-size: 11px;
      line-height: 1.45;
    }

    .usage-credit-pill,
    .model-tier-pill {
      border: 1px solid var(--border, #eceae4);
      border-radius: 999px;
      padding: 3px 7px;
      background: var(--bg-elevated, #f7f4ed);
      color: var(--text, #1c1c1c);
      font-size: 10px;
      font-weight: 850;
      white-space: nowrap;
    }

    .model-credit-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-top: 10px;
    }

    .model-credit-cell {
      border: 1px solid var(--border-light, rgba(236,234,228,.78));
      border-radius: 8px;
      padding: 7px;
      background: var(--bg-elevated, #f7f4ed);
    }

    .model-credit-cell span {
      display: block;
      margin-bottom: 4px;
      color: var(--text-sub, #77736b);
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .model-credit-cell strong {
      color: var(--text, #1c1c1c);
      font-size: 11px;
    }

    .usage-empty {
      border: 1px dashed var(--border, #eceae4);
      border-radius: 10px;
      padding: 12px;
      color: var(--text-sub, #77736b);
      background: var(--bg-elevated, #f7f4ed);
      font-size: 12px;
      line-height: 1.5;
    }

    .settings-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 16px;
      border-top: 1px solid var(--border-light, rgba(236,234,228,.78));
      background: var(--bg, #fcfbf8);
    }

    .settings-footer button {
      height: 30px;
      border: 1px solid var(--border, #eceae4);
      border-radius: 8px;
      padding: 0 12px;
      background: transparent;
      color: var(--text, #1c1c1c);
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .settings-footer .primary {
      background: var(--text, #1c1c1c);
      color: var(--bg, #fcfbf8);
      border-color: var(--text, #1c1c1c);
    }

    /* Shared centered settings workspace */
    .settings-overlay {
      background: rgba(3, 5, 8, .68);
      backdrop-filter: blur(14px) saturate(.75);
      -webkit-backdrop-filter: blur(14px) saturate(.75);
      transition:
        opacity 180ms cubic-bezier(.22, 1, .36, 1),
        visibility 0s linear 180ms;
    }

    .settings-overlay.open {
      transition:
        opacity 180ms cubic-bezier(.22, 1, .36, 1),
        visibility 0s linear 0s;
    }

    .settings-panel {
      top: 50%;
      right: auto;
      bottom: auto;
      left: 50%;
      width: min(1060px, calc(100vw - 40px));
      max-width: none;
      height: min(720px, calc(100dvh - 40px));
      max-height: calc(100dvh - 40px);
      display: block;
      overflow: hidden;
      border: 1px solid var(--border-mid, var(--border, #eceae4));
      border-radius: 16px;
      background: var(--bg-surface, #fffdf8);
      box-shadow: 0 30px 96px rgba(0, 0, 0, .34);
      transform: translate(-50%, -47%) scale(.985);
      transition:
        transform 220ms cubic-bezier(.22, 1, .36, 1),
        opacity 180ms cubic-bezier(.22, 1, .36, 1),
        visibility 0s linear 220ms;
    }

    .settings-panel.open {
      transform: translate(-50%, -50%) scale(1);
      transition:
        transform 220ms cubic-bezier(.22, 1, .36, 1),
        opacity 180ms cubic-bezier(.22, 1, .36, 1),
        visibility 0s linear 0s;
    }

    .settings-shell {
      min-width: 0;
      min-height: 0;
      height: 100%;
      display: grid;
      grid-template-columns: minmax(210px, 250px) minmax(0, 1fr);
    }

    .settings-sidebar {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 12px 14px;
      background: color-mix(in srgb, var(--bg, #fcfbf8) 92%, transparent);
      border-right: 1px solid var(--border-light, rgba(236,234,228,.78));
    }

    .settings-search {
      min-width: 0;
      max-width: 100%;
      height: 40px;
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid transparent;
      border-radius: 11px;
      padding: 0 11px;
      background: var(--bg-elevated, #f7f4ed);
      color: var(--text-sub, #77736b);
      transition:
        border-color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-search:focus-within {
      border-color: var(--border-focus, var(--border, #eceae4));
      background: var(--bg-input, var(--bg-surface, #fffdf8));
    }

    .settings-search svg,
    .settings-tab svg,
    .settings-close svg {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      stroke: currentColor;
    }

    .settings-search input {
      width: 100%;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text, #1c1c1c);
      font: inherit;
      font-size: 14px;
    }

    .settings-search input::placeholder {
      color: var(--text-sub, #77736b);
    }

    .settings-nav-label {
      margin: 4px 10px -6px;
      color: var(--text-sub, #77736b);
      font-size: 11px;
      font-weight: 700;
    }

    .settings-tabs {
      min-width: 0;
      max-width: 100%;
      min-height: 0;
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 3px;
      padding: 0;
      border: 0;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .settings-tab {
      width: 100%;
      min-height: 36px;
      height: auto;
      display: flex;
      align-items: center;
      gap: 9px;
      border: 0;
      border-radius: 10px;
      padding: 0 10px;
      color: var(--text-muted, #5f5f5d);
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      transition:
        color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1),
        transform 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-tab:hover {
      color: var(--text, #1c1c1c);
      background: var(--accent-dim, rgba(28,28,28,.06));
      transform: translateX(1px);
    }

    .settings-tab.active {
      border: 0;
      background: var(--bg-elevated, #f7f4ed);
      color: var(--text, #1c1c1c);
    }

    .settings-tab[hidden] {
      display: none;
    }

    .settings-sidebar-footer {
      display: grid;
      gap: 7px;
      padding: 12px 10px 0;
      border-top: 1px solid var(--border-light, rgba(236,234,228,.78));
    }

    .settings-sidebar-footer strong {
      color: var(--text, #1c1c1c);
      font-size: 12px;
    }

    .settings-sidebar-footer span {
      color: var(--text-sub, #77736b);
      font-size: 11px;
      line-height: 1.45;
    }

    .settings-main {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: var(--bg-surface, #fffdf8);
    }

    .settings-header {
      min-height: 62px;
      padding: 16px 26px;
      border-bottom: 0;
    }

    .settings-title-stack {
      gap: 3px;
    }

    .settings-title-stack h2 {
      font-size: 17px;
      font-weight: 760;
    }

    .settings-title-stack small {
      font-size: 12px;
    }

    .settings-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .settings-close {
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 9px;
      color: var(--text-muted, #5f5f5d);
      transition:
        color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-close:hover {
      color: var(--text, #1c1c1c);
      background: var(--accent-dim, rgba(28,28,28,.06));
    }

    .settings-content {
      min-height: 0;
      padding: 12px 32px 38px;
      scroll-padding-top: 12px;
    }

    .tab-panel {
      width: min(100%, 820px);
      margin: 0 auto;
    }

    .tab-panel::before {
      content: attr(data-settings-heading);
      display: block;
      margin: 2px 0 22px;
      color: var(--text, #1c1c1c);
      font-size: 18px;
      font-weight: 760;
      letter-spacing: -.025em;
    }

    .settings-card {
      border: 0;
      border-bottom: 1px solid var(--border-light, rgba(236,234,228,.78));
      border-radius: 0;
      background: transparent;
      padding: 0 0 22px;
      margin: 0 0 22px;
    }

    .settings-card:last-child {
      border-bottom: 0;
      margin-bottom: 0;
    }

    .settings-card:hover {
      border-color: var(--border-light, rgba(236,234,228,.78));
      transform: none;
    }

    .settings-card h3 {
      margin-bottom: 8px;
      font-size: 15px;
    }

    .settings-card p {
      max-width: 760px;
      font-size: 13px;
    }

    .settings-hero-card {
      grid-template-columns: 1fr auto;
      background: transparent;
    }

    .settings-hero-card .settings-avatar {
      grid-column: 2;
      grid-row: 1;
      width: 48px;
      height: 48px;
      border-radius: 999px;
      box-shadow: none;
    }

    .settings-hero-card > div:nth-child(2) {
      grid-column: 1;
      grid-row: 1;
      align-self: center;
    }

    .settings-hero-card .settings-plan-badge {
      grid-column: 1;
      justify-self: start;
    }

    .settings-field-grid {
      gap: 12px 18px;
      margin-top: 16px;
    }

    .settings-field input,
    .settings-field select,
    .settings-field textarea {
      min-height: 38px;
      border-color: transparent;
      border-radius: 10px;
      background: var(--bg-elevated, #f7f4ed);
    }

    .settings-field textarea {
      min-height: 96px;
    }

    .settings-row {
      min-height: 54px;
      padding: 11px 0;
    }

    .settings-integration-grid {
      gap: 10px;
    }

    .settings-integration,
    .usage-summary-card,
    .cloud-summary-card,
    .usage-row,
    .model-rate-row {
      background: var(--bg-elevated, #f7f4ed);
    }

    .settings-footer {
      padding: 12px 34px 16px;
      background: color-mix(in srgb, var(--bg-surface, #fffdf8) 94%, transparent);
    }

    .settings-footer button {
      height: 36px;
      border-radius: 9px;
      padding: 0 15px;
    }

    .settings-search-empty {
      display: none;
      padding: 16px 12px;
      color: var(--text-sub, #77736b);
      font-size: 12px;
      line-height: 1.5;
    }

    .settings-tabs.is-empty .settings-search-empty {
      display: block;
    }

    [data-theme="dark"] .settings-panel {
      box-shadow: 0 30px 96px rgba(0,0,0,.58);
    }

    @media (max-width: 900px) {
      .settings-panel {
        width: calc(100vw - 18px);
        height: calc(100dvh - 18px);
        max-height: calc(100dvh - 18px);
        border-radius: 14px;
      }

      .settings-shell {
        grid-template-columns: 1fr;
        grid-template-rows: auto minmax(0, 1fr);
      }

      .settings-sidebar {
        gap: 10px;
        padding: 12px;
        border-right: 0;
        border-bottom: 1px solid var(--border-light, rgba(236,234,228,.78));
      }

      .settings-nav-label,
      .settings-sidebar-footer {
        display: none;
      }

      .settings-tabs {
        flex: none;
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
      }

      .settings-tab {
        width: auto;
        flex: 0 0 auto;
        min-height: 36px;
        padding: 0 10px;
      }

      .settings-search {
        height: 40px;
      }

      .settings-header {
        min-height: 64px;
        padding: 14px 18px;
      }

      .settings-content {
        padding: 10px 20px 34px;
      }

      .settings-footer {
        padding: 10px 18px 14px;
      }
    }

    @media (max-width: 640px) {

      .usage-summary-grid,
      .cloud-summary-grid,
      .model-credit-grid,
      .settings-field-grid,
      .settings-integration-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .settings-hero-card {
        grid-template-columns: auto 1fr;
      }

      .settings-hero-card .settings-plan-badge {
        grid-column: 1 / -1;
        justify-self: start;
      }
    }

    @media (max-width: 460px) {
      .settings-field-grid,
      .settings-integration-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .settings-overlay,
      .settings-panel,
      .settings-tab,
      .settings-close {
        transition: none !important;
      }
    }
  `;
  document.head.appendChild(style);
  settingsStyleInstalled = true;
}

function settingsIcon(name: 'search' | 'general' | 'account' | 'privacy' | 'billing' | 'usage' | 'capabilities' | 'connectors' | 'api' | 'appearance' | 'danger' | 'close') {
  const paths: Record<string, string> = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    general: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21h-4v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05a1.7 1.7 0 0 0-1.55 1Z"></path>',
    account: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 21a8 8 0 0 1 15 0"></path>',
    privacy: '<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"></path><rect x="9" y="10" width="6" height="5" rx="1"></rect><path d="M10.5 10V8.8a1.5 1.5 0 0 1 3 0V10"></path>',
    billing: '<rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18"></path><path d="M7 15h3"></path>',
    usage: '<path d="M4 20V10"></path><path d="M9 20V4"></path><path d="M14 20v-7"></path><path d="M19 20V7"></path><path d="M2 20h20"></path>',
    capabilities: '<rect x="3" y="8" width="18" height="12" rx="2"></rect><path d="M8 8V5h8v3"></path><path d="M3 13h18"></path><path d="M10 13v2h4v-2"></path>',
    connectors: '<rect x="4" y="4" width="7" height="7" rx="1"></rect><rect x="13" y="13" width="7" height="7" rx="1"></rect><path d="M14 4h6v6"></path><path d="M10 20H4v-6"></path>',
    api: '<path d="m8 9-4 3 4 3"></path><path d="m16 9 4 3-4 3"></path><path d="m14 4-4 16"></path>',
    appearance: '<path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-1.5a2.5 2.5 0 0 1-2.5-2.5V6c0-1.7-1.3-3-3-3Z"></path><circle cx="7.5" cy="11.5" r=".7"></circle><circle cx="10" cy="7.5" r=".7"></circle><circle cx="7" cy="15.5" r=".7"></circle>',
    danger: '<path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5"></path><path d="M12 17h.01"></path>',
    close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function settingsMarkup() {
  return `
    <div class="settings-shell">
      <aside class="settings-sidebar">
        <label class="settings-search">
          ${settingsIcon('search')}
          <input type="search" data-settings-search placeholder="Search settings" autocomplete="off" aria-label="Search settings">
        </label>
        <div class="settings-nav-label">Settings</div>
        <div class="settings-tabs" role="tablist" aria-label="Settings">
          <button class="settings-tab active" type="button" data-tab="profil" data-search="general profile name language timezone instructions">${settingsIcon('general')}<span>General</span></button>
          <button class="settings-tab" type="button" data-tab="compte" data-search="account email session plan identity">${settingsIcon('account')}<span>Account</span></button>
          <button class="settings-tab" type="button" data-tab="confidentialite" data-search="privacy memory data security confidentiality">${settingsIcon('privacy')}<span>Privacy</span></button>
          <button class="settings-tab" type="button" data-tab="facturation" data-search="billing plan credits invoices cloud balance">${settingsIcon('billing')}<span>Billing</span></button>
          <button class="settings-tab" type="button" data-tab="ia" data-search="usage ai credits cloud history models">${settingsIcon('usage')}<span>Usage</span></button>
          <button class="settings-tab" type="button" data-tab="capacites" data-search="capabilities models build design media decks">${settingsIcon('capabilities')}<span>Capabilities</span></button>
          <button class="settings-tab" type="button" data-tab="automatisations" data-search="skills automations workflows budgets approvals autonomy schedules">${settingsIcon('capabilities')}<span>Agent autonomy</span></button>
          <button class="settings-tab" type="button" data-tab="connecteurs" data-search="connecteurs connectors github supabase vercel stripe">${settingsIcon('connectors')}<span>Connecteurs</span></button>
          <button class="settings-tab" type="button" data-tab="api" data-search="api webhook secrets endpoints">${settingsIcon('api')}<span>API</span></button>
          <button class="settings-tab" type="button" data-tab="apparence" data-search="appearance theme dark light density motion accent">${settingsIcon('appearance')}<span>Appearance</span></button>
          <button class="settings-tab" type="button" data-tab="danger" data-search="danger reset clear drafts sign out">${settingsIcon('danger')}<span>Danger</span></button>
          <div class="settings-search-empty">No setting matches this search.</div>
        </div>
        <div class="settings-sidebar-footer">
          <strong>Coden preferences</strong>
          <span>Shared across dashboard and builder. Sensitive provider secrets stay server-side.</span>
        </div>
      </aside>
      <section class="settings-main">
        <div class="settings-header">
          <div class="settings-title-stack">
            <h2 id="settings-active-title" data-settings-active-title>General</h2>
            <small data-settings-active-description>Profile, language and personal context.</small>
          </div>
          <div class="settings-header-actions">
            <span class="settings-status" data-settings-status data-tone="idle">Saved</span>
            <button class="settings-close" type="button" data-settings-close aria-label="Close settings">${settingsIcon('close')}</button>
          </div>
        </div>
        <div class="settings-content">
      <div class="tab-panel" id="tab-profil" data-settings-heading="Profile">
        <div class="settings-card settings-hero-card">
          <div class="settings-avatar" data-settings-avatar>H</div>
          <div>
            <h3 data-settings-profile-name>Workspace profile</h3>
            <p data-settings-profile-email>Loading your account...</p>
          </div>
          <span class="settings-plan-badge" data-settings-plan-badge>Free</span>
        </div>
        <div class="settings-card">
          <h3>Personal context</h3>
          <p>These preferences help Coden answer in the right language, tone and timezone.</p>
          <div class="settings-field-grid">
            <div class="settings-field">
              <label for="settings-display-name">Display name</label>
              <input id="settings-display-name" data-settings-field="displayName" type="text" autocomplete="name" placeholder="Your name">
            </div>
            <div class="settings-field">
              <label for="settings-role">Role</label>
              <select id="settings-role" data-settings-field="role">
                <option value="founder">Founder</option>
                <option value="freelancer">Freelancer</option>
                <option value="agency">Agency</option>
                <option value="developer">Developer</option>
                <option value="marketer">Marketer</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-language">Coden language</label>
              <select id="settings-language" data-settings-field="language">
                <option value="auto">Auto-detect</option>
                <option value="fr">French</option>
                <option value="en">English</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-timezone">Timezone</label>
              <input id="settings-timezone" data-settings-field="timezone" type="text" placeholder="Africa/Douala">
            </div>
            <div class="settings-field full">
              <label for="settings-instructions">Instructions for Coden</label>
              <textarea id="settings-instructions" data-settings-field="instructions" placeholder="Example: Keep explanations concise, answer in French, and preserve the current design system."></textarea>
            </div>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-compte" data-settings-heading="Account">
        <div class="settings-card">
          <h3>Account</h3>
          <p>Your identity, plan and current browser session.</p>
          <div class="settings-row">
            <div><strong>Email</strong><span data-settings-account-email>Loading...</span></div>
            <span class="settings-mini-badge" data-settings-account-plan>Free</span>
          </div>
          <div class="settings-row">
            <div><strong>User ID</strong><code data-settings-account-id>--</code></div>
            <button type="button" class="settings-action-button" data-settings-action="copy-user-id">Copy</button>
          </div>
          <div class="settings-row">
            <div><strong>Session</strong><span data-settings-session-state>Verified when Settings opened.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="refresh-session">Refresh</button>
          </div>
          <div class="settings-row">
            <div><strong>Facturation</strong><span>Comparez les forfaits et choisissez votre niveau de publication.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-pricing">Comparer</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-confidentialite" data-settings-heading="Privacy">
        <div class="settings-card">
          <h3>Project memory</h3>
          <p>Coden can remember useful project decisions and preferences. Secrets, provider payloads and private tokens are never added to memory.</p>
          <div class="settings-row">
            <div><strong>Controlled project memory</strong><span>Uses saved project decisions to keep future changes coherent.</span></div>
            <span class="settings-mini-badge">Protected</span>
          </div>
          <div class="settings-row">
            <div><strong>Secret redaction</strong><span>Sensitive values are removed from user-visible logs and agent memory.</span></div>
            <span class="settings-mini-badge">Always on</span>
          </div>
        </div>
        <div class="settings-card">
          <h3>Data controls</h3>
          <p>Local UI preferences can be reset from Danger. Account-level data requests stay behind authenticated support flows.</p>
          <div class="settings-row">
            <div><strong>Privacy documentation</strong><span>Review how Coden handles platform and generated-app data.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-privacy">Open</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-facturation" data-settings-heading="Billing">
        <div class="settings-card">
          <h3>Forfait actuel</h3>
          <p>Votre forfait détermine les crédits inclus, l’hébergement et l’accès aux ateliers avancés.</p>
          <div class="settings-row">
            <div><strong data-settings-billing-plan>Forfait gratuit</strong><span>Comparez les options avant de choisir votre prochain niveau.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-pricing">Voir les forfaits</button>
          </div>
        </div>
        <div class="settings-card">
          <h3>Services selon l’usage</h3>
          <p>Les crédits de construction et l’hébergement Coden Cloud restent séparés pour rendre votre consommation lisible.</p>
          <div class="settings-row">
            <div><strong>Crédits de construction</strong><span>Utilisés quand Coden planifie, construit, corrige ou déploie.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-usage">Voir l’usage</button>
          </div>
          <div class="settings-row">
            <div><strong>Coden Cloud</strong><span>Hosting, database, storage, bandwidth and deployed AI usage.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-usage">Review cloud</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-apparence" data-settings-heading="Appearance">
        <div class="settings-card">
          <h3>Appearance</h3>
          <p>Adjust the interface without refreshing the builder. Motion respects reduced-motion preferences.</p>
          <div class="settings-control-label">Theme</div>
          <div class="settings-segment">
            <button type="button" data-settings-theme="system">System</button>
            <button type="button" data-settings-theme="light">Light</button>
            <button type="button" data-settings-theme="dark">Dark</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Density</div>
          <div class="settings-segment">
            <button type="button" data-settings-density="comfortable">Comfortable</button>
            <button type="button" data-settings-density="compact">Compact</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Motion</div>
          <div class="settings-segment">
            <button type="button" data-settings-motion="normal">Normal</button>
            <button type="button" data-settings-motion="reduced">Reduced</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Accent</div>
          <div class="settings-segment">
            <button type="button" data-settings-accent="coden-blue">Coden blue</button>
            <button type="button" data-settings-accent="neutral">Neutral</button>
          </div>
        </div>
      </div>
      ${aiUsageMarkup()}
      <div class="tab-panel hidden" id="tab-capacites" data-settings-heading="Capabilities">
        <div class="settings-card">
          <h3>Coden workshops</h3>
          <p>One assistant, multiple focused workshops. Availability follows the current account plan.</p>
          <div class="settings-integration-grid">
            <div class="settings-integration"><strong>Sites</strong><span>Build, edit, verify and publish complete web applications.</span></div>
            <div class="settings-integration"><strong>Coden Design</strong><span>UI direction, design critique, prototypes and visual polish.</span></div>
            <div class="settings-integration"><strong>Pitch decks</strong><span>Presentation structure, slide narrative and one-pagers.</span></div>
            <div class="settings-integration"><strong>Coden Media</strong><span>Marketing assets, product visuals, UGC and campaign concepts.</span></div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Agent capabilities</h3>
          <p>Coden selects compatible reasoning, code, vision and tool workflows without exposing internal provider details.</p>
          <div class="settings-row"><div><strong>Automatic model routing</strong><span>Chooses a compatible workflow for the requested task.</span></div><span class="settings-mini-badge">Active</span></div>
          <div class="settings-row"><div><strong>Verification and recovery</strong><span>Checks generated work and keeps recoverable drafts when blocked.</span></div><span class="settings-mini-badge">Active</span></div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-automatisations" data-settings-heading="Agent autonomy">
        <div class="settings-card">
          <h3>Bounded autonomy</h3>
          <p>Coden can handle reversible work automatically. Publishing, deletion, migrations, secrets, domains, Git push and billing always require explicit confirmation.</p>
          <div class="settings-row"><div><strong>Skills</strong><span>Build, debug, review, security, test, research and release policies.</span></div><span class="settings-mini-badge">Managed</span></div>
          <div class="settings-row"><div><strong>Verification</strong><span>Runs keep their real checks and never report success without evidence.</span></div><span class="settings-mini-badge">Required</span></div>
          <div class="settings-row"><div><strong>Scheduled workflows</strong><span>Schedules are paused after repeated failures and use an idempotency key.</span></div><span class="settings-mini-badge">Bounded</span></div>
        </div>
        <div class="settings-card">
          <h3>Workspace limits</h3>
          <div class="settings-field-grid">
            <div class="settings-field"><label for="settings-agent-max-steps">Max tool steps</label><input id="settings-agent-max-steps" type="number" min="1" max="20" value="10" disabled></div>
            <div class="settings-field"><label for="settings-agent-concurrency">Concurrent runs</label><input id="settings-agent-concurrency" type="number" min="1" max="3" value="3" disabled></div>
          </div>
          <p style="margin-top:12px;font-size:12px;color:var(--text-sub)">Limits are enforced server-side. Contact your workspace owner to change plan-level budgets.</p>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-connecteurs" data-settings-heading="Connectors">
        <div class="settings-card">
          <h3>Platform connectors</h3>
          <p>Connections are handled through protected backend flows. Secret values never appear in this panel.</p>
          <div class="settings-integration-grid">
            <div class="settings-integration"><strong>GitHub</strong><span>Repository synchronization and versioned collaboration.</span></div>
            <div class="settings-integration"><strong>Supabase</strong><span>Platform auth and generated-app backend services.</span></div>
            <div class="settings-integration"><strong>Vercel</strong><span>Production deployment and live URL verification.</span></div>
            <div class="settings-integration"><strong>Stripe</strong><span>Protected checkout, subscriptions and billing workflows.</span></div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Manage connections</h3>
          <p>Open Connecteurs to connect or review services available to the current workspace.</p>
          <div class="settings-row">
            <div><strong>Workspace connectors</strong><span>Connection availability depends on your plan and configured backend environment.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-integrations">Open Connecteurs</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-api" data-settings-heading="API">
        <div class="settings-card">
          <h3>API</h3>
          <p>Safe connector controls. Secrets stay server-side or inside project Database secrets.</p>
          <div class="settings-integration-grid">
            <div class="settings-integration"><strong>Supabase</strong><span>Platform auth and generated app backend stay separated.</span></div>
            <div class="settings-integration"><strong>Vercel</strong><span>Publish runs through backend tokens only.</span></div>
            <div class="settings-integration"><strong>OpenRouter</strong><span>AI provider keys are never shown in the browser.</span></div>
            <div class="settings-integration"><strong>Project secrets</strong><span>Per-app keys are managed from Database when a project needs them.</span></div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Webhook preferences</h3>
          <p>Store your preferred webhook endpoint locally until account-level webhooks are enabled server-side.</p>
          <div class="settings-field-grid">
            <div class="settings-field full">
              <label for="settings-webhook-url">Webhook URL</label>
              <input id="settings-webhook-url" data-settings-field="webhookUrl" type="url" placeholder="https://example.com/coden-webhook">
            </div>
            <div class="settings-field full">
              <label for="settings-webhook-events">Events</label>
              <input id="settings-webhook-events" data-settings-field="webhookEvents" type="text" placeholder="publish, rollback, generation_failed">
            </div>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-danger" data-settings-heading="Danger">
        <div class="settings-card settings-danger-zone">
          <h3>Danger zone</h3>
          <p>Only reversible local actions are exposed here. Account deletion and billing changes must go through protected backend flows.</p>
          <div class="settings-row">
            <div><strong>Reset UI preferences</strong><span>Restores theme, motion, density and profile preferences on this device.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="reset-preferences">Reset</button>
          </div>
          <div class="settings-row">
            <div><strong>Clear local drafts</strong><span>Removes cached builder prompts and temporary local settings from this browser.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="clear-drafts">Clear</button>
          </div>
          <div class="settings-row">
            <div><strong>Sign out this device</strong><span>Ends the local Supabase session and returns to authentication.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="sign-out">Sign out</button>
          </div>
        </div>
      </div>
        </div>
        <div class="settings-footer">
          <button type="button" data-settings-close>Cancel</button>
          <button type="button" class="primary" data-settings-save>Save changes</button>
        </div>
      </section>
    </div>
  `;
}

function aiUsageMarkup() {
  return `
    <div class="tab-panel hidden" id="tab-ia" data-settings-heading="Usage">
      <div class="settings-card">
        <h3>AI Usage</h3>
        <p>Credits are shown for your account only. Provider costs, margins and internal platform costs are never exposed here.</p>
        <div class="usage-summary-grid">
          <div class="usage-summary-card"><span class="usage-summary-label">Balance</span><strong class="usage-summary-value" id="ai-usage-balance">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Monthly</span><strong class="usage-summary-value" id="ai-usage-monthly">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Daily promo</span><strong class="usage-summary-value" id="ai-usage-daily">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Top-ups</span><strong class="usage-summary-value" id="ai-usage-topups">--</strong></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Coden Cloud</h3>
        <p>Cloud balance runs published apps: hosting, database, file storage, realtime, bandwidth and deployed AI app usage.</p>
        <div class="cloud-summary-grid">
          <div class="cloud-summary-card"><span class="cloud-summary-label">Cloud balance</span><strong class="cloud-summary-value" id="cloud-balance">--</strong></div>
          <div class="cloud-summary-card"><span class="cloud-summary-label">AI app balance</span><strong class="cloud-summary-value" id="cloud-ai-app">--</strong></div>
          <div class="cloud-summary-card"><span class="cloud-summary-label">Top-up from</span><strong class="cloud-summary-value" id="cloud-topup-min">--</strong></div>
          <div class="cloud-summary-card"><span class="cloud-summary-label">Database</span><strong class="cloud-summary-value" id="cloud-db-storage">--</strong></div>
          <div class="cloud-summary-card"><span class="cloud-summary-label">Files</span><strong class="cloud-summary-value" id="cloud-file-storage">--</strong></div>
          <div class="cloud-summary-card"><span class="cloud-summary-label">Bandwidth</span><strong class="cloud-summary-value" id="cloud-bandwidth">--</strong></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>History</h3>
        <div id="ai-usage-history"><div class="usage-empty">AI usage history will appear here after your first Plan, Build, Fix or Deploy action.</div></div>
      </div>
      <div class="settings-card">
        <h3>Model credit rates</h3>
        <div id="model-credit-rates"><div class="usage-empty">Model credit rates are loading on demand.</div></div>
      </div>
    </div>
  `;
}

function ensureAiUsageTab(panel: HTMLElement) {
  const tabs = panel.querySelector('.settings-tabs');
  const content = panel.querySelector('.settings-content');
  if (tabs && !tabs.querySelector('[data-tab="ia"]')) {
    tabs.insertAdjacentHTML('beforeend', '<button class="settings-tab" type="button" data-tab="ia">AI Usage</button>');
  }
  if (content && !content.querySelector('#tab-ia')) {
    content.insertAdjacentHTML('beforeend', aiUsageMarkup());
  }
}

function setFieldValue(selector: string, value: string) {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  if (field) field.value = value;
}

function initialsFor(name: string, email: string) {
  const source = (name || email || 'Coden').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function updateSettingsForm(prefs = loadSettingsPreferences()) {
  setFieldValue('[data-settings-field="displayName"]', prefs.profile.displayName);
  setFieldValue('[data-settings-field="language"]', prefs.profile.language);
  setFieldValue('[data-settings-field="timezone"]', prefs.profile.timezone);
  setFieldValue('[data-settings-field="role"]', prefs.profile.role);
  setFieldValue('[data-settings-field="instructions"]', prefs.profile.instructions);
  setFieldValue('[data-settings-field="webhookUrl"]', prefs.api.webhookUrl);
  setFieldValue('[data-settings-field="webhookEvents"]', prefs.api.webhookEvents);
  setSegmentActive('theme', prefs.appearance.theme);
  setSegmentActive('density', prefs.appearance.density);
  setSegmentActive('motion', prefs.appearance.motion);
  setSegmentActive('accent', prefs.appearance.accent);
  applyAppearancePreferences(prefs);
}

function renderAuthSummary(auth: AuthMeResponse | null, prefs = loadSettingsPreferences()) {
  const email = auth?.user?.email || 'Signed in';
  const userId = auth?.user?.id || '--';
  const displayName = prefs.profile.displayName || email.split('@')[0] || 'Coden user';
  const planLabel = auth?.plan?.label || auth?.plan?.key || 'Free';

  const avatar = document.querySelector<HTMLElement>('[data-settings-avatar]');
  const profileName = document.querySelector<HTMLElement>('[data-settings-profile-name]');
  const profileEmail = document.querySelector<HTMLElement>('[data-settings-profile-email]');
  const planBadge = document.querySelector<HTMLElement>('[data-settings-plan-badge]');
  const accountEmail = document.querySelector<HTMLElement>('[data-settings-account-email]');
  const accountId = document.querySelector<HTMLElement>('[data-settings-account-id]');
  const accountPlan = document.querySelector<HTMLElement>('[data-settings-account-plan]');
  const billingPlan = document.querySelector<HTMLElement>('[data-settings-billing-plan]');

  if (avatar) avatar.textContent = initialsFor(displayName, email);
  if (profileName) profileName.textContent = displayName;
  if (profileEmail) profileEmail.textContent = email;
  if (planBadge) planBadge.textContent = String(planLabel);
  if (accountEmail) accountEmail.textContent = email;
  if (accountId) accountId.textContent = userId;
  if (accountPlan) accountPlan.textContent = String(planLabel);
  if (billingPlan) billingPlan.textContent = `${String(planLabel)} plan`;
}

async function hydrateSettingsPanel() {
  const prefs = loadSettingsPreferences();
  updateSettingsForm(prefs);
  renderAuthSummary(currentAuthSummary, prefs);
  setSettingsStatus('Loading account...', 'saving');
  try {
    const [auth, state] = await Promise.all([
      apiFetch<AuthMeResponse>('/api/auth/me'),
      apiFetch<UserWorkspaceStateResponse>('/api/users/me/workspace-state').catch(() => null),
    ]);
    const merged = mergePreferences({
      ...prefs,
      appearance: {
        ...prefs.appearance,
        theme: prefs.appearance.theme === 'system' && state?.state?.theme ? state.state.theme : prefs.appearance.theme,
      },
    });
    updateSettingsForm(merged);
    currentAuthSummary = auth;
    renderAuthSummary(currentAuthSummary, merged);
    setSettingsStatus('Saved', 'success');
    document.getElementById('settings-panel')?.classList.remove(SETTINGS_DIRTY_CLASS);
  } catch (error) {
    renderAuthSummary(currentAuthSummary, prefs);
    setSettingsStatus(error instanceof Error ? error.message : 'Account unavailable', 'error');
  }
}

async function saveSettingsFromPanel() {
  const prefs = readSettingsForm();
  saveSettingsPreferences(prefs);
  applyAppearancePreferences(prefs);
  setSettingsStatus('Saving...', 'saving');
  try {
    const theme = resolveThemePreference(prefs.appearance.theme);
    await apiFetch('/api/users/me/workspace-state', {
      method: 'PATCH',
      body: JSON.stringify({ theme }),
    }).catch(() => null);
    renderAuthSummary(currentAuthSummary, prefs);
    document.getElementById('settings-panel')?.classList.remove(SETTINGS_DIRTY_CLASS);
    setSettingsStatus('Saved', 'success');
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : 'Could not save settings', 'error');
  }
}

async function copyText(value: string, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(value);
    setSettingsStatus(label, 'success');
  } catch {
    setSettingsStatus('Copy failed', 'error');
  }
}

function resetLocalPreferences() {
  if (!window.confirm('Reset local Coden preferences on this device?')) return;
  localStorage.removeItem(SETTINGS_PREFS_KEY);
  const prefs = defaultSettingsPreferences();
  saveSettingsPreferences(prefs);
  updateSettingsForm(prefs);
  setSettingsStatus('Preferences reset', 'success');
}

function clearLocalDrafts() {
  if (!window.confirm('Clear local builder drafts and temporary local settings?')) return;
  [
    'coden-dashboard-draft',
    'coden-builder-draft',
    'coden-design-settings',
    'coden-media-settings',
    'coden-last-builder-project-id',
  ].forEach(key => localStorage.removeItem(key));
  setSettingsStatus('Local drafts cleared', 'success');
}

async function handleSettingsAction(action: string) {
  if (action === 'copy-user-id') {
    await copyText(document.querySelector<HTMLElement>('[data-settings-account-id]')?.textContent || '', 'User ID copied');
    return;
  }
  if (action === 'refresh-session') {
    setSettingsStatus('Refreshing session...', 'saving');
    const session = await refreshVerifiedSession();
    const sessionState = document.querySelector<HTMLElement>('[data-settings-session-state]');
    if (sessionState) sessionState.textContent = session ? 'Session refreshed just now.' : 'Session could not be refreshed.';
    setSettingsStatus(session ? 'Session refreshed' : 'Refresh failed', session ? 'success' : 'error');
    return;
  }
  if (action === 'open-pricing') {
    trackFunnelEvent('upgrade_pricing_clicked', { surface: 'settings', plan: 'pro', billing: 'monthly' });
    window.location.href = '/pricing.html?plan=pro&billing=monthly';
    return;
  }
  if (action === 'open-integrations') {
    closeSettings();
    document.dispatchEvent(new CustomEvent('coden:open-connectors'));
    return;
  }
  if (action === 'open-privacy') {
    window.location.href = '/privacy.html';
    return;
  }
  if (action === 'open-usage') {
    activateSettingsTab('ia');
    return;
  }
  if (action === 'reset-preferences') {
    resetLocalPreferences();
    return;
  }
  if (action === 'clear-drafts') {
    clearLocalDrafts();
    return;
  }
  if (action === 'sign-out') {
    if (!window.confirm('Sign out on this device?')) return;
    await signOutCurrentDevice();
    window.location.href = '/auth.html';
  }
}

export function ensureSettingsPanel() {
  if (typeof document === 'undefined') return null;
  installSettingsStyle();

  let overlay = document.getElementById('settings-overlay') as HTMLElement | null;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'settings-overlay';
    overlay.className = 'settings-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);
  }
  overlay.classList.add('settings-overlay');
  overlay.dataset.codenSettingsManaged = SETTINGS_MANAGED_VERSION;
  overlay.setAttribute('aria-hidden', overlay.classList.contains('open') ? 'false' : 'true');

  let panel = document.getElementById('settings-panel') as HTMLElement | null;
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'settings-panel';
    panel.className = 'settings-panel';
    panel.setAttribute('aria-label', 'Settings');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = settingsMarkup();
    document.body.appendChild(panel);
  } else {
    panel.classList.add('settings-panel');
    panel.setAttribute('aria-hidden', panel.classList.contains('open') ? 'false' : 'true');
  }
  panel.dataset.codenSettingsManaged = SETTINGS_MANAGED_VERSION;
  panel.setAttribute('aria-label', 'Settings');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'settings-active-title');

  const hasManagedMarkup =
    panel.dataset.codenSettingsManaged === SETTINGS_MANAGED_VERSION &&
    Boolean(panel.querySelector('.settings-shell')) &&
    Boolean(panel.querySelector('[data-settings-search]')) &&
    Boolean(panel.querySelector('[data-settings-active-title]')) &&
    Boolean(panel.querySelector('[data-settings-close]')) &&
    Boolean(panel.querySelector('[data-settings-status]')) &&
    Boolean(panel.querySelector('.settings-content')) &&
    Boolean(panel.querySelector('#tab-ia'));

  if (!hasManagedMarkup) {
    panel.innerHTML = settingsMarkup();
    aiUsageLoaded = false;
  } else {
    ensureAiUsageTab(panel);
  }

  bindSettingsPanel();
  return { overlay, panel };
}

function activateSettingsTab(tab: string) {
  const id = tabAliases[tab as SettingsTab] || tab || 'profil';
  document.querySelectorAll<HTMLElement>('#settings-panel .settings-tab').forEach(button => {
    button.classList.toggle('active', button.dataset.tab === id);
  });
  document.querySelectorAll<HTMLElement>('#settings-panel .tab-panel').forEach(panel => {
    panel.classList.toggle('hidden', panel.id !== `tab-${id}`);
  });
  const meta = settingsTabMeta[id] || settingsTabMeta.profil;
  const title = document.querySelector<HTMLElement>('#settings-panel [data-settings-active-title]');
  const description = document.querySelector<HTMLElement>('#settings-panel [data-settings-active-description]');
  const content = document.querySelector<HTMLElement>('#settings-panel .settings-content');
  if (title) title.textContent = meta.title;
  if (description) description.textContent = meta.description;
  if (content) content.scrollTop = 0;
  if (id === 'ia') void loadAiUsageSettings();
}

export function openSettings(tab: SettingsTab = 'profile') {
  const parts = ensureSettingsPanel();
  if (!parts) return;
  void hydrateSettingsPanel();
  parts.overlay.classList.add('open');
  parts.panel.classList.add('open');
  parts.overlay.setAttribute('aria-hidden', 'false');
  parts.panel.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const search = parts.panel.querySelector<HTMLInputElement>('[data-settings-search]');
  if (search) search.value = '';
  parts.panel.querySelectorAll<HTMLElement>('.settings-tab').forEach(button => {
    button.hidden = false;
  });
  parts.panel.querySelector('.settings-tabs')?.classList.remove('is-empty');
  activateSettingsTab(tabAliases[tab] || tab);
  window.requestAnimationFrame(() => search?.focus());
}

export function closeSettings() {
  const overlay = document.getElementById('settings-overlay');
  const panel = document.getElementById('settings-panel');
  overlay?.classList.remove('open');
  panel?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
  panel?.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function bindSettingsPanel() {
  (window as any).openSettings = openSettings;
  (window as any).closeSettings = closeSettings;
  (window as any).ensureSettingsPanel = ensureSettingsPanel;

  if (settingsBound) return;
  settingsBound = true;
  document.addEventListener('click', event => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    if (target.closest('[data-settings-close], #btn-close-settings')) {
      closeSettings();
      return;
    }

    if (target.id === 'settings-overlay') {
      closeSettings();
      return;
    }

    const tab = target.closest<HTMLElement>('#settings-panel .settings-tab');
    if (tab?.dataset.tab) {
      activateSettingsTab(tab.dataset.tab);
      return;
    }

    const segment = target.closest<HTMLElement>('#settings-panel [data-settings-theme], #settings-panel [data-settings-density], #settings-panel [data-settings-motion], #settings-panel [data-settings-accent]');
    if (segment) {
      const group = segment.dataset.settingsTheme ? 'theme'
        : segment.dataset.settingsDensity ? 'density'
          : segment.dataset.settingsMotion ? 'motion'
            : 'accent';
      const value = segment.dataset.settingsTheme || segment.dataset.settingsDensity || segment.dataset.settingsMotion || segment.dataset.settingsAccent || '';
      setSegmentActive(group, value);
      applyAppearancePreferences(readSettingsForm());
      markSettingsDirty();
      return;
    }

    const action = target.closest<HTMLElement>('#settings-panel [data-settings-action]');
    if (action?.dataset.settingsAction) {
      void handleSettingsAction(action.dataset.settingsAction);
      return;
    }

    if (target.closest('#settings-panel [data-settings-save]')) {
      void saveSettingsFromPanel();
      return;
    }
  });

  document.addEventListener('input', event => {
    const target = event.target as HTMLElement | null;
    const search = target?.closest<HTMLInputElement>('#settings-panel [data-settings-search]');
    if (search) {
      const query = search.value.trim().toLowerCase();
      const tabs = Array.from(document.querySelectorAll<HTMLElement>('#settings-panel .settings-tab'));
      tabs.forEach(tab => {
        const haystack = `${tab.textContent || ''} ${tab.dataset.search || ''}`.toLowerCase();
        tab.hidden = Boolean(query) && !haystack.includes(query);
      });
      document.querySelector('#settings-panel .settings-tabs')?.classList.toggle('is-empty', tabs.every(tab => tab.hidden));
      return;
    }
    if (!target?.closest('#settings-panel [data-settings-field]')) return;
    markSettingsDirty();
    const prefs = readSettingsForm();
    renderAuthSummary(currentAuthSummary, prefs);
  });

  document.addEventListener('change', event => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('#settings-panel [data-settings-field]')) return;
    markSettingsDirty();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeSettings();
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
          ${escapeHtml(item.model_name || 'Auto')} · ${escapeHtml(item.project_name || 'Project')} · ${escapeHtml(item.status || 'completed')} · ${escapeHtml(formatDate(item.created_at))}
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
