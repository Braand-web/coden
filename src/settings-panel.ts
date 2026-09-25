import { apiFetch } from './lib/api';
import { mountIntegrationsGrid } from './integrations';
import { publicBillingCatalog } from './config/billing-v2';
import { refreshVerifiedSession, signOutCurrentDevice } from './lib/supabase-browser';
import { readBillingReturn, readPlanChoice, wantsBillingSettings, withoutPlanParams, type BillingReturn, type PaidPlan } from './lib/plan-choice';

type SettingsTab =
  | 'profile'
  | 'personalization'
  | 'account'
  | 'privacy'
  | 'appearance'
  | 'billing'
  | 'usage'
  | 'capabilities'
  | 'connectors'
  | 'api'
  | 'danger';

type AuthMeResponse = {
  success: boolean;
  plan?: { key?: string; label?: string };
  user?: {
    id?: string;
    email?: string | null;
    role?: string | null;
  };
};

type AiUsageItem = {
  mode?: string | null;
  credits_charged?: number | null;
  model_name?: string | null;
  project_name?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type AiUsageResponse = {
  success: boolean;
  wallet?: {
    balance?: number | null;
    monthly_credits?: number | null;
    daily_promo_credits?: number | null;
    topup_credits?: number | null;
    breakdown?: Record<string, number>;
    // Per usage_restriction — the axis every debit actually filters on.
    spendable?: Partial<Record<'build' | 'cloud' | 'ai_gateway' | 'email', number>>;
    shared?: number | null;
    cloud?: {
      balance_usd?: number | null;
      ai_app_balance_usd?: number | null;
      topup_min_usd?: number | null;
      database_storage_gb?: number | null;
      file_storage_gb?: number | null;
      bandwidth_gb?: number | null;
    } | null;
  } | null;
  history?: AiUsageItem[];
};

type ModelRateResponse = {
  success: boolean;
  models?: Array<{
    display_name: string;
    availability: string;
    tier: string;
    credits: { plan: number; build: number; fix: number; deploy: number };
  }>;
};

type BillingInterval = 'monthly' | 'annual';
type BillingCatalogResponse = {
  success: boolean;
  catalog?: {
    version: string;
    annualDiscountPercent: number;
    creditTiers: number[];
    plans: Array<{ key: string; name: string; capabilities: string[] }>;
    prices: Array<{
      plan: 'pro' | 'business';
      credits: number;
      interval: BillingInterval;
      amount: number;
      monthlyEquivalent: number;
      currency: string;
    }>;
    topups: Array<{ id: string; plan: 'pro' | 'business'; credits: number; amount: number; currency: string }>;
  };
};

type BillingWalletResponse = {
  success: boolean;
  billing_version?: string;
  mode?: 'authoritative' | 'shadow';
  plan?: string;
  balance?: number;
  breakdown?: Record<string, number>;
  spendable?: Partial<Record<'build' | 'cloud' | 'ai_gateway' | 'email', number>>;
  shared?: number | null;
  grants?: Array<{
    id: string;
    kind: string;
    usage_restriction: string;
    credits_remaining: number;
    expires_at: string;
  }>;
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
let currentAuthSummary: AuthMeResponse | null = null;
let aiUsageLoaded = false;
let billingLoaded = false;
let billingCatalog: BillingCatalogResponse['catalog'] | null = null;
let billingWallet: BillingWalletResponse | null = null;
let billingWalletUnavailable = false;
let selectedBillingInterval: BillingInterval = 'monthly';
/** An offer chosen on the landing or the pricing page, waiting for the buyer's confirmation. */
let pendingPlanChoice: { plan: PaidPlan; credits?: number } | null = null;
/** What the payment page answered, shown once at the top of Billing. */
let billingReturnNotice: BillingReturn | null = null;
const SETTINGS_MANAGED_VERSION = '2026-06-12';
const SETTINGS_PREFS_KEY = 'coden.user.settings.v1';
const SETTINGS_DIRTY_CLASS = 'settings-dirty';
/** Same bound as the server (agent-personalization.ts). */
const MAX_AGENT_INSTRUCTIONS = 4000;

const tabAliases: Record<SettingsTab, string> = {
  profile: 'profil',
  personalization: 'personnalisation',
  account: 'compte',
  privacy: 'confidentialite',
  appearance: 'apparence',
  billing: 'facturation',
  usage: 'ia',
  capabilities: 'capacites',
  connectors: 'connecteurs',
  api: 'api',
  danger: 'danger',
};

const settingsTabMeta: Record<string, { title: string; description: string }> = {
  profil: { title: 'Profil', description: 'Nom, langue et préférences personnelles.' },
  personnalisation: { title: 'Personnalisation', description: 'Vos instructions pour l’agent et l’amélioration de Coden.' },
  compte: { title: 'Compte et sécurité', description: 'Identité et session active.' },
  confidentialite: { title: 'Confidentialité', description: 'Mémoire, données et protections.' },
  capacites: { title: 'Capacités', description: 'Ateliers et capacités de l’agent.' },
  automatisations: { title: 'Autonomie de l’agent', description: 'Budgets, validations et sécurité des automatisations.' },
  connecteurs: { title: 'Intégrations', description: 'Connectez vos services pour que l’agent puisse les utiliser.' },
  api: { title: 'API', description: 'Webhooks et contrôle des connecteurs.' },
  apparence: { title: 'Apparence', description: 'Thème, densité et animations.' },
  facturation: { title: 'Facturation', description: 'Forfait, crédits, renouvellement et paiements.' },
  ia: { title: 'Consommation', description: 'Build, Cloud, IA intégrée et historique de consommation.' },
  danger: { title: 'Zone sensible', description: 'Réinitialisations réversibles et déconnexion.' },
};

/** "free" and "Free" read as the plan's French name; other plan names are proper nouns. */
function planDisplayName(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw || /^free$/i.test(raw) || /^gratuit$/i.test(raw)) return 'Gratuit';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&var(--syntax-cyan);');
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

/** The onboarding's first answer becomes the Profile tab's role. */
export function rememberOnboardingProfile(role: string) {
  try {
    const prefs = loadSettingsPreferences();
    prefs.profile.role = role.slice(0, 80);
    saveSettingsPreferences(prefs);
  } catch { /* storage unavailable: the answer is still on the account */ }
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
      // No longer edited here: the agent's instructions moved to Personnalisation, saved server-side.
      instructions: prefs.profile.instructions,
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

let settingsStatusTimer = 0;
function setSettingsStatus(message: string, tone: 'idle' | 'saving' | 'success' | 'error' = 'idle') {
  const status = document.querySelector<HTMLElement>('[data-settings-status]');
  if (!status) return;
  window.clearTimeout(settingsStatusTimer);
  status.textContent = message;
  status.dataset.tone = tone;
  // A confirmation is a moment, not a label: "Identifiant copié" used to stay
  // on every tab until the next action. It settles back to "Enregistré".
  if (tone === 'success' && message !== 'Enregistré') {
    settingsStatusTimer = window.setTimeout(() => setSettingsStatus('Enregistré', 'success'), 2400);
  }
}

function markSettingsDirty() {
  const panel = document.getElementById('settings-panel');
  panel?.classList.add(SETTINGS_DIRTY_CLASS);
  setSettingsStatus('Modifications non enregistrées', 'saving');
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
      background: color-mix(in srgb, var(--surface) 34%, transparent);
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
      background: var(--surface);
      color: var(--foreground);
      border-left: 1px solid var(--border);
      box-shadow: -24px 0 80px color-mix(in srgb, var(--foreground) 12%, transparent);
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
      border-bottom: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
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
      border: 1px solid var(--border);
      border-radius: 7px;
      background: transparent;
      color: var(--text-secondary, var(--text-muted));
      cursor: pointer;
    }

    .settings-tabs {
      display: flex;
      gap: 6px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      overflow-x: auto;
    }

    .settings-tab {
      height: 28px;
      border: 1px solid transparent;
      border-radius: 7px;
      padding: 0 10px;
      background: transparent;
      color: var(--text-secondary, var(--text-muted));
      cursor: pointer;
      flex: 0 0 auto;
      font-size: 12px;
      font-weight: 750;
    }

    .settings-tab.active {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent);
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
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      line-height: 1.4;
    }

    .settings-status {
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 9px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
    }

    .settings-status[data-tone="saving"] {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
    }

    .settings-status[data-tone="success"] {
      color: var(--success);
      border-color: color-mix(in srgb, var(--success) 28%, transparent);
      background: color-mix(in srgb, var(--success) 8%, transparent);
    }

    .settings-status[data-tone="error"] {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 28%, transparent);
      background: color-mix(in srgb, var(--danger) 8%, transparent);
    }

    .tab-panel.hidden {
      display: none !important;
    }

    .settings-card {
      border: 1px solid var(--border);
      border-radius: 14px;
      background: var(--surface);
      padding: 14px;
      margin-bottom: 12px;
      transition:
        transform var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        border-color var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1)),
        background var(--motion-fast, 140ms) var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
    }

    .settings-card:hover {
      border-color: var(--accent);
      transform: translateY(-1px);
    }

    .settings-card h3 {
      margin: 0 0 6px;
      font-size: 13px;
      letter-spacing: -.01em;
    }

    .settings-card p {
      margin: 0;
      color: var(--text-secondary, var(--text-muted));
      font-size: 12px;
      line-height: 1.55;
    }

    .settings-hero-card {
      display: grid;
      grid-template-columns: auto 1fr auto;
      gap: 14px;
      align-items: center;background: var(--surface);
    }

    .settings-avatar {
      width: 48px;
      height: 48px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      color: var(--text-on-accent);
      background: var(--accent);
      font-size: 18px;
      font-weight: 900;
      box-shadow: 0 16px 34px color-mix(in srgb, var(--syntax-cyan) 22%, transparent);
    }

    .settings-plan-badge,
    .settings-mini-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      padding: 0 9px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: var(--surface-soft);
      color: var(--foreground);
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
      color: var(--text-secondary, var(--text-muted));
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
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      color: var(--foreground);
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
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft, color-mix(in srgb, var(--syntax-cyan) 14%, transparent));
    }

    .settings-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 0;
      border-top: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
    }

    .settings-row:first-child {
      border-top: 0;
      padding-top: 0;
    }

    .settings-row strong {
      display: block;
      margin-bottom: 3px;
      color: var(--foreground);
      font-size: 13px;
    }

    .settings-row span,
    .settings-row code {
      color: var(--text-secondary, var(--text-muted));
      font-size: 12px;
    }

    .settings-row code {
      font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      word-break: break-all;
    }

    .settings-action-button,
    .settings-danger-button {
      min-height: 32px;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 0 11px;
      background: var(--surface);
      color: var(--foreground);
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
      background: var(--surface-soft);
    }

    .settings-danger-button {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 24%, transparent);
      background: color-mix(in srgb, var(--danger) 6%, transparent);
    }

    .settings-footer[hidden] {
      display: none;
    }

    .settings-integrations-card [data-settings-integrations] {
      margin-top: 14px;
    }

    .personalization-field {
      margin-top: 14px;
    }

    .personalization-field textarea {
      min-height: 176px;
      line-height: 1.55;
    }

    .personalization-footer {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .personalization-counter {
      color: var(--text-muted);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }

    .personalization-counter[data-tone="near"] { color: var(--warning, var(--text-secondary)); }
    .personalization-counter[data-tone="limit"] { color: var(--danger); font-weight: 800; }

    .personalization-state {
      flex: 1;
      min-width: 0;
      color: var(--text-muted);
      font-size: 12px;
    }

    .personalization-state[data-tone="success"] { color: var(--success); }
    .personalization-state[data-tone="error"] { color: var(--danger); }

    .settings-action-button.is-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--text-on-accent);
    }

    .settings-action-button.is-primary:hover:not(:disabled) {
      background: var(--accent-hover, var(--accent));
    }

    .settings-action-button:disabled {
      opacity: .5;
      cursor: not-allowed;
      transform: none;
    }

    .personalization-share {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      margin-top: 12px;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-control, 10px);
      background: var(--surface-soft);
      cursor: pointer;
    }

    .personalization-share input {
      width: 18px;
      height: 18px;
      margin: 1px 0 0;
      accent-color: var(--accent);
      cursor: pointer;
    }

    .personalization-share input:focus-visible {
      outline: 2px solid var(--ring, var(--accent));
      outline-offset: 2px;
    }

    .personalization-share-copy strong {
      display: block;
      margin-bottom: 4px;
      color: var(--foreground);
      font-size: 13px;
    }

    .personalization-share-copy span {
      display: block;
      color: var(--text-secondary, var(--text-muted));
      font-size: 12px;
      line-height: 1.55;
    }

    .settings-card p.personalization-note {
      margin-top: 10px;
    }

    .personalization-note a {
      color: var(--accent);
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .billing-balance-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 16px;background: var(--surface);
    }

    .billing-balance-value {
      display: block;
      margin-top: 8px;
      font-size: 30px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .billing-plan-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 12px;
    }

    .billing-plan-card {
      display: grid;
      gap: 12px;
      min-width: 0;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--surface);
    }

    .billing-plan-card[data-plan="pro"] {
      border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
    }

    .billing-plan-card.is-selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
    }

    .billing-intent {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .billing-intent[hidden] { display: none; }
    .billing-intent h3 { margin: 0 0 4px; }
    .billing-intent p { margin: 0; }
    .billing-intent[data-tone="accent"] { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
    .billing-intent[data-tone="success"] { border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
    .billing-intent .settings-action-button.is-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: var(--accent-foreground, #fff);
    }

    .billing-plan-head,
    .billing-plan-price {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .billing-plan-head strong { font-size: 14px; }
    .billing-plan-price strong { font-size: 22px; letter-spacing: -.035em; }
    .billing-plan-price span { color: var(--text-secondary, var(--text-muted)); font-size: 11px; }

    .billing-tier-select {
      width: 100%;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 9px;
      padding: 0 10px;
      color: var(--foreground);
      background: var(--surface);
      font: inherit;
      font-size: 12px;
    }

    .billing-inline-actions {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: min(280px, 54%);
    }

    .billing-inline-actions .billing-tier-select { min-width: 150px; }

    .billing-plan-features {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      line-height: 1.45;
    }

    .billing-plan-features li::before {
      content: '✓';
      margin-right: 6px;
      color: var(--accent);
      font-weight: 900;
    }

    .billing-plan-card .settings-action-button {
      width: 100%;
      color: var(--text-on-accent);
      border-color: var(--accent);
      background: var(--accent);
    }

    .billing-plan-card .settings-action-button:disabled {
      opacity: .56;
      cursor: wait;
      transform: none;
    }

    @media (max-width: 520px) {
      .billing-plan-grid { grid-template-columns: 1fr; }
      .billing-balance-card { grid-template-columns: 1fr; }
      .billing-inline-actions { width: 100%; min-width: 0; }
      .billing-inline-actions .billing-tier-select { min-width: 0; }
    }

    .settings-segment {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 10px;
    }

    .settings-segment button {
      min-height: 32px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 12px;
      background: var(--surface);
      color: var(--text-secondary, var(--text-muted));
      font-size: 12px;
      font-weight: 850;
      cursor: pointer;
    }

    /* A tint of the accent under the foreground colour: accent text on
       --accent-soft read blue on blue. */
    .settings-segment button.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 16%, var(--surface));
      color: var(--foreground);
      font-weight: 700;
    }

    .settings-integration-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .settings-integration {
      border: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      border-radius: 11px;
      padding: 10px;
      background: var(--surface);
    }

    .settings-integration strong {
      display: block;
      color: var(--foreground);
      font-size: 12px;
      margin-bottom: 5px;
    }

    .settings-integration span {
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      line-height: 1.45;
    }

    .settings-danger-zone {
      border-color: color-mix(in srgb, var(--danger) 20%, transparent);
      background: var(--surface);
    }

    .usage-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .settings-cloud-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .usage-summary-card,
    .settings-cloud-summary-card {
      border: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      border-radius: 10px;
      padding: 10px;
      background: var(--surface-soft);
    }

    .usage-summary-label,
    .settings-cloud-summary-label {
      display: block;
      margin-bottom: 6px;
      color: var(--text-secondary, var(--text-muted));
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .usage-summary-value,
    .settings-cloud-summary-value {
      color: var(--accent);
      font-size: 18px;
      font-weight: 850;
      letter-spacing: -.03em;
      font-variant-numeric: tabular-nums;
    }

    .usage-row,
    .model-rate-row {
      border: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      border-radius: 10px;
      padding: 10px;
      background: var(--surface);
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
      color: var(--foreground);
      font-size: 12px;
      font-weight: 800;
    }

    .usage-row-meta,
    .model-rate-meta {
      margin-top: 4px;
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      line-height: 1.45;
    }

    .usage-credit-pill,
    .model-tier-pill {
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 7px;
      background: var(--surface-soft);
      color: var(--foreground);
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
      border: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      border-radius: 8px;
      padding: 7px;
      background: var(--surface-soft);
    }

    .model-credit-cell span {
      display: block;
      margin-bottom: 4px;
      color: var(--text-secondary, var(--text-muted));
      font-size: 9px;
      font-weight: 850;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .model-credit-cell strong {
      color: var(--foreground);
      font-size: 11px;
    }

    .usage-empty {
      border: 1px dashed var(--border);
      border-radius: 10px;
      padding: 12px;
      color: var(--text-secondary, var(--text-muted));
      background: var(--surface-soft);
      font-size: 12px;
      line-height: 1.5;
    }

    .settings-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 14px 16px;
      border-top: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
      background: var(--surface);
    }

    .settings-footer button {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 12px;
      background: transparent;
      color: var(--foreground);
      font-size: 12px;
      font-weight: 800;
      cursor: pointer;
    }

    .settings-footer .primary {
      background: var(--accent);
      color: var(--text-on-accent);
      border-color: var(--accent);
    }

    /* Shared centered settings workspace */
    .settings-overlay {
      background: color-mix(in srgb, var(--background) 68%, transparent);
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
      width: min(920px, calc(100vw - 40px));
      max-width: none;
      height: min(660px, calc(100dvh - 40px));
      max-height: calc(100dvh - 40px);
      display: block;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-radius: 16px;
      background: var(--surface);
      box-shadow: 0 30px 96px color-mix(in srgb, var(--foreground) 34%, transparent);
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
      grid-template-columns: 210px minmax(0, 1fr);
    }

    .settings-sidebar {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 12px 14px;
      background: color-mix(in srgb, var(--background) 92%, transparent);
      border-right: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
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
      background: var(--surface-soft);
      color: var(--text-secondary, var(--text-muted));
      transition:
        border-color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-search:focus-within {
      border-color: var(--accent);
      background: var(--input);
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
      color: var(--foreground);
      font: inherit;
      font-size: 14px;
    }

    .settings-search input::placeholder {
      color: var(--text-secondary, var(--text-muted));
    }

    .settings-nav-label {
      margin: 4px 10px -6px;
      color: var(--text-secondary, var(--text-muted));
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
      color: var(--text-muted);
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      transition:
        color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1),
        transform 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-tab:hover {
      color: var(--foreground);
      background: var(--surface-soft, color-mix(in srgb, var(--background) 6%, transparent));
      transform: translateX(1px);
    }

    .settings-tab.active {
      border: 0;
      background: var(--surface-soft);
      color: var(--foreground);
    }

    .settings-tab[hidden] {
      display: none;
    }

    .settings-sidebar-footer {
      display: grid;
      gap: 7px;
      padding: 12px 10px 0;
      border-top: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
    }

    .settings-sidebar-footer strong {
      color: var(--foreground);
      font-size: 12px;
    }

    .settings-sidebar-footer span {
      color: var(--text-secondary, var(--text-muted));
      font-size: 11px;
      line-height: 1.45;
    }

    .settings-main {
      min-width: 0;
      min-height: 0;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr) auto;
      background: var(--surface);
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
      color: var(--text-muted);
      transition:
        color 140ms cubic-bezier(.22, 1, .36, 1),
        background 140ms cubic-bezier(.22, 1, .36, 1);
    }

    .settings-close:hover {
      color: var(--foreground);
      background: var(--surface-soft, color-mix(in srgb, var(--background) 6%, transparent));
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

    /* The panel header already names the section (settings-active-title);
       a second, English copy of it used to sit above every tab. */
    .tab-panel { padding-top: 2px; }

    .settings-card {
      border: 0;
      border-bottom: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
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
      border-color: var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
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
      background: var(--surface-soft);
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
    .settings-cloud-summary-card,
    .usage-row,
    .model-rate-row {
      background: var(--surface-soft);
    }

    .settings-footer {
      padding: 12px 34px 16px;
      background: color-mix(in srgb, var(--surface) 94%, transparent);
    }

    .settings-footer button {
      height: 36px;
      border-radius: var(--radius-control);
      padding: 0 15px;
    }

    .settings-search-empty {
      display: none;
      padding: 16px 12px;
      color: var(--text-secondary, var(--text-muted));
      font-size: 12px;
      line-height: 1.5;
    }

    .settings-tabs.is-empty .settings-search-empty {
      display: block;
    }

    [data-theme="dark"] .settings-panel {
      background: var(--surface);
      color: var(--foreground);
      box-shadow: 0 30px 96px color-mix(in srgb, var(--foreground) 58%, transparent);
    }

    [data-theme="dark"] .settings-sidebar {
      background: var(--surface);
    }

    [data-theme="dark"] .settings-main,
    [data-theme="dark"] .settings-footer {
      background: var(--surface);
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
        border-bottom: 1px solid var(--border-subtle, color-mix(in srgb, var(--border) 78%, transparent));
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
      .settings-cloud-summary-grid,
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

function settingsIcon(name: 'search' | 'general' | 'personalization' | 'account' | 'privacy' | 'billing' | 'usage' | 'capabilities' | 'connectors' | 'api' | 'appearance' | 'danger' | 'close') {
  const paths: Record<string, string> = {
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    general: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21h-4v-.05a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3v-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 4.2l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3h4v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21v4h-.05a1.7 1.7 0 0 0-1.55 1Z"></path>',
    account: '<circle cx="12" cy="8" r="4"></circle><path d="M4.5 21a8 8 0 0 1 15 0"></path>',
    personalization: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Z"></path><path d="m14 8 3 3"></path><path d="M19 15v4"></path><path d="M17 17h4"></path>',
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
        <div class="settings-nav-label">Paramètres</div>
        <div class="settings-tabs" role="tablist" aria-label="Paramètres">
          <button class="settings-tab active" type="button" data-tab="profil">${settingsIcon('general')}<span>Profil</span></button>
          <button class="settings-tab" type="button" data-tab="personnalisation">${settingsIcon('personalization')}<span>Personnalisation</span></button>
          <button class="settings-tab" type="button" data-tab="compte">${settingsIcon('account')}<span>Compte et sécurité</span></button>
          <button class="settings-tab" type="button" data-tab="apparence">${settingsIcon('appearance')}<span>Apparence</span></button>
          <button class="settings-tab" type="button" data-tab="facturation">${settingsIcon('billing')}<span>Facturation</span></button>
          <button class="settings-tab" type="button" data-tab="ia">${settingsIcon('usage')}<span>Consommation</span></button>
          <button class="settings-tab" type="button" data-tab="connecteurs">${settingsIcon('connectors')}<span>Intégrations</span></button>
          <button class="settings-tab" type="button" data-tab="confidentialite">${settingsIcon('privacy')}<span>Confidentialité</span></button>
        </div>
        <div class="settings-sidebar-footer">
          <strong>Préférences Coden</strong>
          <span>Partagées entre le dashboard et le Builder.</span>
        </div>
      </aside>
      <section class="settings-main">
        <div class="settings-header">
          <div class="settings-title-stack">
            <h2 id="settings-active-title" data-settings-active-title>Profil</h2>
            <small data-settings-active-description>Nom, langue et préférences personnelles.</small>
          </div>
          <div class="settings-header-actions">
            <span class="settings-status" data-settings-status data-tone="idle">Enregistré</span>
            <button class="settings-close" type="button" data-settings-close aria-label="Fermer les paramètres">${settingsIcon('close')}</button>
          </div>
        </div>
        <div class="settings-content">
      <div class="tab-panel" id="tab-profil" data-settings-heading="Profil">
        <div class="settings-card settings-hero-card">
          <div class="settings-avatar" data-settings-avatar>H</div>
          <div>
            <h3 data-settings-profile-name>Profil du workspace</h3>
            <p data-settings-profile-email>Chargement du compte…</p>
          </div>
          <span class="settings-plan-badge" data-settings-plan-badge>Gratuit</span>
        </div>
        <div class="settings-card">
          <h3>Préférences personnelles</h3>
          <p>Elles aident Coden à répondre avec la bonne langue et le bon contexte.</p>
          <div class="settings-field-grid">
            <div class="settings-field">
              <label for="settings-display-name">Nom affiché</label>
              <input id="settings-display-name" data-settings-field="displayName" type="text" autocomplete="name" placeholder="Votre nom">
            </div>
            <div class="settings-field">
              <label for="settings-role">Rôle</label>
              <select id="settings-role" data-settings-field="role">
                <option value="founder">Fondateur ou fondatrice</option>
                <option value="freelancer">Indépendant</option>
                <option value="agency">Agence</option>
                <option value="developer">Développeur</option>
                <option value="marketer">Marketing</option>
                <option value="other">Autre</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-language">Langue de Coden</label>
              <select id="settings-language" data-settings-field="language">
                <option value="auto">Détection automatique</option>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
              </select>
            </div>
            <div class="settings-field">
              <label for="settings-timezone">Fuseau horaire</label>
              <input id="settings-timezone" data-settings-field="timezone" type="text" placeholder="Africa/Douala">
            </div>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-personnalisation" data-settings-heading="Personnalisation">
        <div class="settings-card">
          <h3>Instructions pour l’agent</h3>
          <p>Coden les applique à chaque session et à chaque modèle, mode Auto compris, avec la priorité la plus haute après ses règles de sécurité.</p>
          <div class="settings-field full personalization-field">
            <label for="settings-agent-instructions">Vos instructions</label>
            <textarea id="settings-agent-instructions" data-personalization-instructions maxlength="${MAX_AGENT_INSTRUCTIONS}" rows="8" spellcheck="true" placeholder="Exemples : Réponds toujours en français. Utilise Tailwind et des composants accessibles. Écris des commentaires courts. Demande-moi avant d’ajouter une dépendance."></textarea>
            <div class="personalization-footer">
              <span class="personalization-counter" data-personalization-counter aria-live="polite">0 / ${MAX_AGENT_INSTRUCTIONS}</span>
              <span class="personalization-state" data-personalization-state></span>
              <button type="button" class="settings-action-button is-primary" data-settings-action="save-agent-instructions" disabled>Enregistrer</button>
            </div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Amélioration de Coden</h3>
          <label class="personalization-share" for="settings-share-improvement">
            <input id="settings-share-improvement" type="checkbox" data-personalization-share checked>
            <span class="personalization-share-copy">
              <strong>Aider à améliorer l’agent Coden avec mes données</strong>
              <span>Les résultats de vos builds (réussite, erreurs corrigées, relances, 👍/👎, versions restaurées) apprennent à Coden quelles corrections et quels modèles fonctionnent. Tout est anonymisé avant d’alimenter la base commune : clés d’API, secrets, e-mails, noms, données de bases de données et contenus privés sont retirés, et un schéma n’est réutilisé que s’il a été observé chez plusieurs personnes.</span>
            </span>
          </label>
          <p class="personalization-note">Décocher prend effet immédiatement : vos données ne servent plus à la base commune et vos contributions passées sont supprimées. Vos instructions et votre mémoire privée restent réservées à vos sessions. <a href="/privacy.html#amelioration-agent" target="_blank" rel="noopener">Politique de confidentialité</a></p>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-compte" data-settings-heading="Compte et sécurité">
        <div class="settings-card">
          <h3>Votre compte</h3>
          <p>Votre identité, votre forfait et la session de ce navigateur.</p>
          <div class="settings-row">
            <div><strong>E-mail</strong><span data-settings-account-email>Chargement…</span></div>
            <span class="settings-mini-badge" data-settings-account-plan>Gratuit</span>
          </div>
          <div class="settings-row">
            <div><strong>Identifiant</strong><code data-settings-account-id>--</code></div>
            <button type="button" class="settings-action-button" data-settings-action="copy-user-id">Copier</button>
          </div>
          <div class="settings-row">
            <div><strong>Session</strong><span data-settings-session-state>Vérifiée à l’ouverture des paramètres.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="refresh-session">Actualiser</button>
          </div>
          <div class="settings-row">
            <div><strong>Facturation</strong><span>Comparez les forfaits et choisissez votre niveau de publication.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-pricing">Comparer</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-confidentialite" data-settings-heading="Confidentialité">
        <div class="settings-card">
          <h3>Mémoire des projets</h3>
          <p>Coden retient les décisions et préférences utiles à vos projets. Les secrets, les réponses des fournisseurs et les jetons privés n’y sont jamais ajoutés.</p>
          <div class="settings-row">
            <div><strong>Mémoire maîtrisée</strong><span>Les décisions enregistrées gardent les prochaines modifications cohérentes.</span></div>
            <span class="settings-mini-badge">Protégée</span>
          </div>
          <div class="settings-row">
            <div><strong>Masquage des secrets</strong><span>Les valeurs sensibles sont retirées des journaux visibles et de la mémoire de l’agent.</span></div>
            <span class="settings-mini-badge">Toujours actif</span>
          </div>
        </div>
        <div class="settings-card">
          <h3>Vos données</h3>
          <p>Les préférences locales se réinitialisent depuis la zone sensible. Les demandes portant sur les données du compte passent par le support, après authentification.</p>
          <div class="settings-row">
            <div><strong>Politique de confidentialité</strong><span>Comment Coden traite les données de la plateforme et des applications générées.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="open-privacy">Ouvrir</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-facturation" data-settings-heading="Facturation">
        <div class="settings-card billing-intent" data-billing-intent hidden></div>
        <div class="settings-card billing-balance-card">
          <div>
            <h3 data-settings-billing-plan>Forfait gratuit</h3>
            <p>Un solde unique pour la génération, le Cloud et l’IA intégrée. Les crédits réservés à un usage sont consommés en premier.</p>
            <strong class="billing-balance-value" data-billing-balance>—</strong>
          </div>
          <button type="button" class="settings-action-button" data-settings-action="open-usage">Voir l’usage</button>
        </div>
        <div class="settings-card">
          <h3>Choisir un forfait</h3>
          <p>Les crédits sont attribués chaque mois. L’annuel est payé à l’avance avec 20 % de remise.</p>
          <div class="settings-segment" role="group" aria-label="Cycle de facturation">
            <button type="button" class="active" data-billing-interval="monthly">Mensuel</button>
            <button type="button" data-billing-interval="annual">Annuel · −20 %</button>
          </div>
          <div class="billing-plan-grid" data-billing-plan-grid>
            <div class="usage-empty">Chargement des forfaits…</div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Crédits et paiements</h3>
          <p>Les recharges expirent après douze mois et ne sont accordées qu’après confirmation signée de Saspay.</p>
          <div class="settings-row">
            <div><strong>Ajouter des crédits</strong><span>Disponible pour les forfaits Pro et Business.</span></div>
            <div class="billing-inline-actions">
              <select class="billing-tier-select" data-billing-topup-product aria-label="Montant de la recharge"><option value="">Chargement…</option></select>
              <button type="button" class="settings-action-button" data-settings-action="billing-topup">Ajouter</button>
            </div>
          </div>
          <div class="settings-row">
            <div><strong>Paiements et renouvellement</strong><span>Checkout Saspay sécurisé. Les forfaits mensuels et annuels se renouvellent depuis Coden.</span></div>
            <button type="button" class="settings-action-button" data-settings-action="billing-portal">Actualiser</button>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-apparence" data-settings-heading="Apparence">
        <div class="settings-card">
          <h3>Interface</h3>
          <p>Ajustez l’interface sans recharger le builder. Les animations respectent la préférence « réduire les animations » de votre appareil.</p>
          <div class="settings-control-label">Thème</div>
          <div class="settings-segment">
            <button type="button" data-settings-theme="system">Système</button>
            <button type="button" data-settings-theme="light">Clair</button>
            <button type="button" data-settings-theme="dark">Sombre</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Densité</div>
          <div class="settings-segment">
            <button type="button" data-settings-density="comfortable">Confortable</button>
            <button type="button" data-settings-density="compact">Compacte</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Animations</div>
          <div class="settings-segment">
            <button type="button" data-settings-motion="normal">Normal</button>
            <button type="button" data-settings-motion="reduced">Réduites</button>
          </div>
          <div class="settings-control-label" style="margin-top:16px;">Couleur d’accent</div>
          <div class="settings-segment">
            <button type="button" data-settings-accent="coden-blue">Bleu Coden</button>
            <button type="button" data-settings-accent="neutral">Neutre</button>
          </div>
        </div>
      </div>
      ${aiUsageMarkup()}
      <div class="tab-panel hidden" id="tab-capacites" data-settings-heading="Capacités">
        <div class="settings-card">
          <h3>Ateliers Coden</h3>
          <p>Un assistant, plusieurs ateliers spécialisés. Leur disponibilité suit votre forfait.</p>
          <div class="settings-integration-grid">
            <div class="settings-integration"><strong>Sites</strong><span>Créer, modifier, vérifier et publier des applications web complètes.</span></div>
            <div class="settings-integration"><strong>Présentations</strong><span>Structure, récit des diapositives et one-pagers.</span></div>
            <div class="settings-integration"><strong>Coden Media</strong><span>Visuels marketing, images produit, UGC et concepts de campagne.</span></div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Capacités de l’agent</h3>
          <p>Coden choisit les modes de raisonnement, de code, de vision et d’outils adaptés, sans exposer les détails des fournisseurs.</p>
          <div class="settings-row"><div><strong>Choix automatique du modèle</strong><span>Sélectionne un mode de travail adapté à la demande.</span></div><span class="settings-mini-badge">Actif</span></div>
          <div class="settings-row"><div><strong>Vérification et reprise</strong><span>Contrôle le travail généré et conserve un brouillon récupérable en cas de blocage.</span></div><span class="settings-mini-badge">Actif</span></div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-automatisations" data-settings-heading="Autonomie de l’agent">
        <div class="settings-card">
          <h3>Autonomie encadrée</h3>
          <p>Coden réalise seul le travail réversible. Publication, suppression, migrations, secrets, domaines, push Git et facturation demandent toujours votre confirmation.</p>
          <div class="settings-row"><div><strong>Compétences</strong><span>Règles de construction, débogage, relecture, sécurité, tests, recherche et mise en ligne.</span></div><span class="settings-mini-badge">Géré</span></div>
          <div class="settings-row"><div><strong>Vérification</strong><span>Chaque exécution garde ses vrais contrôles et n’annonce jamais un succès sans preuve.</span></div><span class="settings-mini-badge">Obligatoire</span></div>
          <div class="settings-row"><div><strong>Tâches planifiées</strong><span>Mises en pause après des échecs répétés, protégées contre les doubles exécutions.</span></div><span class="settings-mini-badge">Encadré</span></div>
        </div>
        <div class="settings-card">
          <h3>Limites de l’espace</h3>
          <div class="settings-field-grid">
            <div class="settings-field"><label for="settings-agent-max-steps">Étapes d’outils maximum</label><input id="settings-agent-max-steps" type="number" min="1" max="20" value="10" disabled></div>
            <div class="settings-field"><label for="settings-agent-concurrency">Exécutions simultanées</label><input id="settings-agent-concurrency" type="number" min="1" max="3" value="3" disabled></div>
          </div>
          <p style="margin-top:12px;font-size:12px;color:var(--text-secondary)">Ces limites sont appliquées côté serveur. Contactez le propriétaire de l’espace pour changer les budgets du forfait.</p>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-connecteurs" data-settings-heading="Intégrations">
        <div class="settings-card settings-integrations-card">
          <h3>Vos services connectés</h3>
          <p>Connectez vos comptes (base de données, paiements, e-mail, stockage, outils) : l’agent peut ensuite les utiliser dans vos sessions. La connexion passe par Composio ; aucune clé n’est affichée ni stockée dans votre navigateur.</p>
          <div data-settings-integrations></div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-api" data-settings-heading="API">
        <div class="settings-card">
          <h3>API</h3>
          <p>Contrôle des connecteurs. Les secrets restent côté serveur ou dans les secrets Cloud du projet.</p>
          <div class="settings-integration-grid">
            <div class="settings-integration"><strong>Supabase</strong><span>L’authentification de la plateforme et le backend des applications restent séparés.</span></div>
            <div class="settings-integration"><strong>Vercel</strong><span>La publication passe uniquement par des jetons serveur.</span></div>
            <div class="settings-integration"><strong>OpenRouter</strong><span>Les clés des fournisseurs d’IA ne sont jamais affichées dans le navigateur.</span></div>
            <div class="settings-integration"><strong>Secrets de projet</strong><span>Les clés propres à une application se gèrent depuis Cloud quand un projet en a besoin.</span></div>
          </div>
        </div>
        <div class="settings-card">
          <h3>Webhooks</h3>
          <p>Votre adresse de webhook est gardée sur cet appareil en attendant l’activation des webhooks de compte côté serveur.</p>
          <div class="settings-field-grid">
            <div class="settings-field full">
              <label for="settings-webhook-url">Adresse du webhook</label>
              <input id="settings-webhook-url" data-settings-field="webhookUrl" type="url" placeholder="https://example.com/coden-webhook">
            </div>
            <div class="settings-field full">
              <label for="settings-webhook-events">Événements</label>
              <input id="settings-webhook-events" data-settings-field="webhookEvents" type="text" placeholder="publish, rollback, generation_failed">
            </div>
          </div>
        </div>
      </div>
      <div class="tab-panel hidden" id="tab-danger" data-settings-heading="Zone sensible">
        <div class="settings-card settings-danger-zone">
          <h3>Zone sensible</h3>
          <p>Seules des actions locales et réversibles figurent ici. La suppression du compte et les changements de facturation passent par des flux serveur protégés.</p>
          <div class="settings-row">
            <div><strong>Réinitialiser l’interface</strong><span>Rétablit le thème, les animations, la densité et le profil sur cet appareil.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="reset-preferences">Réinitialiser</button>
          </div>
          <div class="settings-row">
            <div><strong>Effacer les brouillons</strong><span>Supprime les demandes en cours et les réglages temporaires gardés par ce navigateur.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="clear-drafts">Effacer</button>
          </div>
          <div class="settings-row">
            <div><strong>Se déconnecter de cet appareil</strong><span>Ferme la session sur ce navigateur et revient à la connexion.</span></div>
            <button type="button" class="settings-danger-button" data-settings-action="sign-out">Se déconnecter</button>
          </div>
        </div>
      </div>
        </div>
        <div class="settings-footer">
          <button type="button" data-settings-close>Annuler</button>
          <button type="button" class="primary" data-settings-save>Enregistrer</button>
        </div>
      </section>
    </div>
  `;
}

function aiUsageMarkup() {
  return `
    <div class="tab-panel hidden" id="tab-ia" data-settings-heading="Consommation">
      <div class="settings-card">
        <h3>Consommation</h3>
        <p>Les crédits de votre compte uniquement. Les coûts des fournisseurs et de la plateforme ne sont jamais affichés ici.</p>
        <div class="usage-summary-grid">
          <div class="usage-summary-card"><span class="usage-summary-label">Solde</span><strong class="usage-summary-value" id="ai-usage-balance">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Mensuels</span><strong class="usage-summary-value" id="ai-usage-monthly">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Bonus du jour</span><strong class="usage-summary-value" id="ai-usage-daily">--</strong></div>
          <div class="usage-summary-card"><span class="usage-summary-label">Recharges</span><strong class="usage-summary-value" id="ai-usage-topups">--</strong></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Crédits disponibles</h3>
        <p>Ce que chaque type d’action peut réellement dépenser en ce moment. Les crédits partagés sont comptés dans les trois premiers, puisqu’ils peuvent payer n’importe lequel.</p>
        <div class="settings-cloud-summary-grid">
          <div class="settings-cloud-summary-card"><span class="settings-cloud-summary-label">Générer et corriger</span><strong class="settings-cloud-summary-value" id="grant-build">--</strong></div>
          <div class="settings-cloud-summary-card"><span class="settings-cloud-summary-label">Cloud et déploiement</span><strong class="settings-cloud-summary-value" id="grant-cloud">--</strong></div>
          <div class="settings-cloud-summary-card"><span class="settings-cloud-summary-label">Discussion avec l’agent</span><strong class="settings-cloud-summary-value" id="grant-ai">--</strong></div>
          <div class="settings-cloud-summary-card"><span class="settings-cloud-summary-label">Dont partagés</span><strong class="settings-cloud-summary-value" id="grant-general">--</strong></div>
        </div>
      </div>
      <div class="settings-card">
        <h3>Historique</h3>
        <div id="ai-usage-history"><div class="usage-empty">L’historique apparaîtra ici après votre première génération, correction ou publication.</div></div>
      </div>
      <div class="settings-card">
        <h3>Tarification mesurée</h3>
        <p>Coden réserve une borne avant l’action, puis règle uniquement l’usage réel : modèles, outils, sandbox, navigateur, Cloud et IA intégrée. La réserve inutilisée est restituée automatiquement.</p>
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
  setFieldValue('[data-settings-field="webhookUrl"]', prefs.api.webhookUrl);
  setFieldValue('[data-settings-field="webhookEvents"]', prefs.api.webhookEvents);
  setSegmentActive('theme', prefs.appearance.theme);
  setSegmentActive('density', prefs.appearance.density);
  setSegmentActive('motion', prefs.appearance.motion);
  setSegmentActive('accent', prefs.appearance.accent);
  applyAppearancePreferences(prefs);
}

function renderAuthSummary(auth: AuthMeResponse | null, prefs = loadSettingsPreferences()) {
  const email = auth?.user?.email || 'Session active';
  const userId = auth?.user?.id || '--';
  const displayName = prefs.profile.displayName || email.split('@')[0] || 'Utilisateur Coden';
  const planLabel = planDisplayName(auth?.plan?.label || auth?.plan?.key);

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
  if (billingPlan) billingPlan.textContent = planLabel === 'Gratuit' ? 'Forfait gratuit' : `Forfait ${String(planLabel)}`;
}

async function hydrateSettingsPanel() {
  const prefs = loadSettingsPreferences();
  updateSettingsForm(prefs);
  renderAuthSummary(currentAuthSummary, prefs);
  setSettingsStatus('Chargement…', 'saving');
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
    setSettingsStatus('Enregistré', 'success');
    document.getElementById('settings-panel')?.classList.remove(SETTINGS_DIRTY_CLASS);
  } catch (error) {
    renderAuthSummary(currentAuthSummary, prefs);
    setSettingsStatus(error instanceof Error ? error.message : 'Compte momentanément indisponible', 'error');
  }
}

async function saveSettingsFromPanel() {
  const prefs = readSettingsForm();
  saveSettingsPreferences(prefs);
  applyAppearancePreferences(prefs);
  setSettingsStatus('Enregistrement…', 'saving');
  try {
    const theme = resolveThemePreference(prefs.appearance.theme);
    await apiFetch('/api/users/me/workspace-state', {
      method: 'PATCH',
      body: JSON.stringify({ theme }),
    }).catch(() => null);
    renderAuthSummary(currentAuthSummary, prefs);
    document.getElementById('settings-panel')?.classList.remove(SETTINGS_DIRTY_CLASS);
    setSettingsStatus('Enregistré', 'success');
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : 'Enregistrement impossible', 'error');
  }
}

async function copyText(value: string, label = 'Copié') {
  try {
    await navigator.clipboard.writeText(value);
    setSettingsStatus(label, 'success');
  } catch {
    setSettingsStatus('Copie impossible', 'error');
  }
}

function resetLocalPreferences() {
  if (!window.confirm('Réinitialiser les préférences Coden de cet appareil ?')) return;
  localStorage.removeItem(SETTINGS_PREFS_KEY);
  const prefs = defaultSettingsPreferences();
  saveSettingsPreferences(prefs);
  updateSettingsForm(prefs);
  setSettingsStatus('Préférences réinitialisées', 'success');
}

function clearLocalDrafts() {
  if (!window.confirm('Effacer les brouillons et réglages temporaires de ce navigateur ?')) return;
  [
    'coden-dashboard-draft',
    'coden-builder-draft',
    'coden-design-settings',
    'coden-media-settings',
    'coden-last-builder-project-id',
  ].forEach(key => localStorage.removeItem(key));
  setSettingsStatus('Brouillons effacés', 'success');
}

async function handleSettingsAction(action: string) {
  if (action === 'save-agent-instructions') {
    await saveAgentInstructions();
    return;
  }
  if (action === 'copy-user-id') {
    await copyText(document.querySelector<HTMLElement>('[data-settings-account-id]')?.textContent || '', 'Identifiant copié');
    return;
  }
  if (action === 'refresh-session') {
    setSettingsStatus('Actualisation de la session…', 'saving');
    const session = await refreshVerifiedSession();
    const sessionState = document.querySelector<HTMLElement>('[data-settings-session-state]');
    if (sessionState) sessionState.textContent = session ? 'Session actualisée à l’instant.' : 'La session n’a pas pu être actualisée.';
    setSettingsStatus(session ? 'Session actualisée' : 'Actualisation impossible', session ? 'success' : 'error');
    return;
  }
  if (action === 'open-pricing') {
    activateSettingsTab('facturation');
    return;
  }
  if (action === 'billing-refresh') {
    billingReturnNotice = null;
    await loadBillingSettings(true);
    return;
  }
  if (action === 'billing-dismiss-choice') {
    pendingPlanChoice = null;
    billingReturnNotice = null;
    document.querySelectorAll('.billing-plan-card.is-selected').forEach(card => card.classList.remove('is-selected'));
    renderBillingIntent();
    return;
  }
  if (action === 'open-integrations') {
    activateSettingsTab('connecteurs');
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
  if (action === 'billing-portal') {
    await openBillingPortal();
    return;
  }
  if (action === 'billing-topup') {
    await startTopupCheckout();
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
    if (!window.confirm('Se déconnecter de cet appareil ?')) return;
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
  overlay.inert = !overlay.classList.contains('open');

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
  panel.inert = !panel.classList.contains('open');

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
    billingLoaded = false;
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
  // Personnalisation and Intégrations save on their own; the panel-wide
  // Enregistrer (for local preferences) would be a second, unrelated button.
  const footer = document.querySelector<HTMLElement>('#settings-panel .settings-footer');
  if (footer) footer.hidden = id === 'personnalisation' || id === 'connecteurs';
  if (id === 'ia') void loadAiUsageSettings();
  if (id === 'facturation') void loadBillingSettings();
  if (id === 'personnalisation') void loadPersonalizationSettings();
  if (id === 'connecteurs') mountSettingsIntegrations();
}

let refreshSettingsIntegrations: (() => Promise<void>) | null = null;
function mountSettingsIntegrations() {
  const root = document.querySelector<HTMLElement>('#settings-panel [data-settings-integrations]');
  if (!root) return;
  if (refreshSettingsIntegrations && root.dataset.mounted === 'true') {
    void refreshSettingsIntegrations();
    return;
  }
  root.dataset.mounted = 'true';
  refreshSettingsIntegrations = mountIntegrationsGrid(root);
}

export function openSettings(tab: SettingsTab = 'profile') {
  const parts = ensureSettingsPanel();
  if (!parts) return;
  void hydrateSettingsPanel();
  parts.overlay.classList.add('open');
  parts.panel.classList.add('open');
  parts.overlay.setAttribute('aria-hidden', 'false');
  parts.panel.setAttribute('aria-hidden', 'false');
  parts.overlay.inert = false;
  parts.panel.inert = false;
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
  if (overlay) overlay.inert = true;
  if (panel) panel.inert = true;
  document.body.style.overflow = '';
}

type PersonalizationState = { instructions: string; shareImprovement: boolean; updatedAt: string | null };
let personalizationSaved: PersonalizationState | null = null;
let personalizationLoading: Promise<void> | null = null;

function instructionsField() {
  return document.querySelector<HTMLTextAreaElement>('#settings-panel [data-personalization-instructions]');
}

/** Counter, "not saved" hint and the Save button, from the textarea against what the server holds. */
function renderInstructionsState(note?: { text: string; tone: 'success' | 'error' | 'idle' }) {
  const field = instructionsField();
  if (!field) return;
  const length = field.value.length;
  const counter = document.querySelector<HTMLElement>('#settings-panel [data-personalization-counter]');
  if (counter) {
    counter.textContent = `${length.toLocaleString('fr-FR')} / ${MAX_AGENT_INSTRUCTIONS.toLocaleString('fr-FR')}`;
    counter.dataset.tone = length >= MAX_AGENT_INSTRUCTIONS ? 'limit' : length >= MAX_AGENT_INSTRUCTIONS * 0.9 ? 'near' : '';
  }
  const dirty = personalizationSaved !== null && field.value.trim() !== personalizationSaved.instructions;
  const button = document.querySelector<HTMLButtonElement>('#settings-panel [data-settings-action="save-agent-instructions"]');
  if (button) button.disabled = !dirty || personalizationSaved === null;
  const state = document.querySelector<HTMLElement>('#settings-panel [data-personalization-state]');
  if (state) {
    state.textContent = note?.text || (dirty ? 'Modifications non enregistrées' : '');
    state.dataset.tone = note?.tone || (dirty ? 'idle' : '');
  }
}

function renderPersonalization(value: PersonalizationState) {
  personalizationSaved = { ...value, instructions: value.instructions.trim() };
  const field = instructionsField();
  if (field) {
    // Instructions typed in the old Profile field lived only in this browser
    // and never reached the agent. Offered here once, for the person to save.
    const legacy = !value.instructions ? loadSettingsPreferences().profile.instructions.trim() : '';
    field.value = value.instructions || legacy;
    field.disabled = false;
  }
  const share = document.querySelector<HTMLInputElement>('#settings-panel [data-personalization-share]');
  if (share) {
    share.checked = value.shareImprovement;
    share.disabled = false;
  }
  renderInstructionsState();
}

async function loadPersonalizationSettings(force = false) {
  if (personalizationSaved && !force) return renderPersonalization(personalizationSaved);
  if (personalizationLoading) return personalizationLoading;
  const field = instructionsField();
  const share = document.querySelector<HTMLInputElement>('#settings-panel [data-personalization-share]');
  if (field && !personalizationSaved) field.disabled = true;
  if (share && !personalizationSaved) share.disabled = true;
  personalizationLoading = (async () => {
    try {
      const response = await apiFetch<{ success: boolean; personalization: PersonalizationState }>('/api/users/me/personalization');
      renderPersonalization(response.personalization);
    } catch {
      if (field) field.disabled = false;
      if (share) share.disabled = false;
      renderInstructionsState({ text: 'Chargement impossible. Réessayez dans un instant.', tone: 'error' });
    } finally {
      personalizationLoading = null;
    }
  })();
  return personalizationLoading;
}

async function putPersonalization(patch: Partial<Pick<PersonalizationState, 'instructions' | 'shareImprovement'>>) {
  const response = await apiFetch<{ success: boolean; personalization: PersonalizationState }>('/api/users/me/personalization', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  return response.personalization;
}

async function saveAgentInstructions() {
  const field = instructionsField();
  const button = document.querySelector<HTMLButtonElement>('#settings-panel [data-settings-action="save-agent-instructions"]');
  if (!field) return;
  if (field.value.length > MAX_AGENT_INSTRUCTIONS) {
    renderInstructionsState({ text: `Limite de ${MAX_AGENT_INSTRUCTIONS} caractères dépassée.`, tone: 'error' });
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Enregistrement…'; }
  try {
    const saved = await putPersonalization({ instructions: field.value });
    personalizationSaved = { ...saved, instructions: saved.instructions.trim() };
    if (field.value.trim() !== saved.instructions) field.value = saved.instructions;
    // The old browser-only copy has been superseded by the saved one.
    try {
      const local = loadSettingsPreferences();
      if (local.profile.instructions) saveSettingsPreferences({ ...local, profile: { ...local.profile, instructions: '' } });
    } catch { /* storage unavailable: nothing to clean */ }
    renderInstructionsState({ text: 'Enregistré · appliqué dès la prochaine demande', tone: 'success' });
    setSettingsStatus('Instructions enregistrées', 'success');
  } catch (error: any) {
    renderInstructionsState({ text: error?.message || 'Enregistrement impossible.', tone: 'error' });
    setSettingsStatus('Enregistrement impossible', 'error');
  } finally {
    if (button) button.textContent = 'Enregistrer';
    const dirty = personalizationSaved !== null && field.value.trim() !== personalizationSaved.instructions;
    if (button) button.disabled = !dirty;
  }
}

/** Saved the moment it changes; reverted on failure so the box never lies. */
async function saveShareImprovement(input: HTMLInputElement) {
  const wanted = input.checked;
  input.disabled = true;
  setSettingsStatus(wanted ? 'Activation du partage…' : 'Désactivation du partage…', 'saving');
  try {
    const saved = await putPersonalization({ shareImprovement: wanted });
    if (personalizationSaved) personalizationSaved.shareImprovement = saved.shareImprovement;
    input.checked = saved.shareImprovement;
    setSettingsStatus(saved.shareImprovement
      ? 'Merci : vos builds aident à améliorer Coden'
      : 'Partage désactivé · vos contributions ont été supprimées', 'success');
  } catch {
    input.checked = !wanted;
    setSettingsStatus('Préférence non enregistrée, réessayez', 'error');
  } finally {
    input.disabled = false;
  }
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

    const billingInterval = target.closest<HTMLElement>('#settings-panel [data-billing-interval]');
    if (billingInterval?.dataset.billingInterval) {
      selectedBillingInterval = billingInterval.dataset.billingInterval === 'annual' ? 'annual' : 'monthly';
      renderBillingSettings();
      return;
    }

    const billingCheckout = target.closest<HTMLButtonElement>('#settings-panel [data-billing-checkout]');
    if (billingCheckout?.dataset.billingCheckout === 'pro' || billingCheckout?.dataset.billingCheckout === 'business') {
      void startBillingCheckout(billingCheckout.dataset.billingCheckout, billingCheckout);
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
    if (target?.closest('#settings-panel [data-personalization-instructions]')) {
      renderInstructionsState();
      return;
    }
    if (!target?.closest('#settings-panel [data-settings-field]')) return;
    markSettingsDirty();
    const prefs = readSettingsForm();
    renderAuthSummary(currentAuthSummary, prefs);
  });

  document.addEventListener('change', event => {
    const target = event.target as HTMLElement | null;
    const share = target?.closest<HTMLInputElement>('#settings-panel [data-personalization-share]');
    if (share) {
      void saveShareImprovement(share);
      return;
    }
    const billingTier = target?.closest<HTMLSelectElement>('#settings-panel [data-billing-tier]');
    if (billingTier?.dataset.billingTier === 'pro' || billingTier?.dataset.billingTier === 'business') {
      const price = billingPrice(billingTier.dataset.billingTier, Number(billingTier.value));
      const priceNode = document.querySelector<HTMLElement>(`[data-billing-price="${billingTier.dataset.billingTier}"]`);
      if (priceNode) priceNode.innerHTML = `<strong>${formatBillingAmount(price?.monthlyEquivalent, price?.currency)}</strong><span>/ mois${selectedBillingInterval === 'annual' ? ' · paiement annuel' : ''}</span>`;
      return;
    }
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
  // Unmetered and test-unlimited accounts carry a sentinel, not a balance.
  if (number >= 1_000_000_000) return 'Illimité';
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatBillingAmount(value: unknown, currency = 'XAF') {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(number);
}

function formatGb(value: unknown) {
  if (value === null || value === undefined || value === '') return '--';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return `${number % 1 === 0 ? number.toFixed(0) : number.toFixed(2)} GB`;
}

function formatDate(iso?: string | null) {
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

function billingPrice(plan: 'pro' | 'business', credits: number) {
  return billingCatalog?.prices.find(price =>
    price.plan === plan && price.credits === credits && price.interval === selectedBillingInterval,
  ) || null;
}

function billingPlanMarkup(plan: 'pro' | 'business') {
  const catalogPlan = billingCatalog?.plans.find(item => item.key === plan);
  const tiers = Array.from(new Set((billingCatalog?.prices || []).filter(price => price.plan === plan).map(price => price.credits))).sort((a, b) => a - b);
  // The entry tier: Pro starts at 25 credits (5 000 FCFA), Business at 100.
  const defaultTier = tiers[0] || 100;
  const price = billingPrice(plan, defaultTier);
  const current = billingWallet?.plan === plan;
  return `
    <article class="billing-plan-card" data-plan="${plan}">
      <div class="billing-plan-head"><strong>${escapeHtml(catalogPlan?.name || plan)}</strong>${current ? '<span class="settings-mini-badge">Actuel</span>' : ''}</div>
      <select class="billing-tier-select" data-billing-tier="${plan}" aria-label="Crédits mensuels ${escapeHtml(catalogPlan?.name || plan)}">
        ${tiers.map(tier => `<option value="${tier}"${tier === defaultTier ? ' selected' : ''}>${new Intl.NumberFormat().format(tier)} crédits / mois</option>`).join('')}
      </select>
      <div class="billing-plan-price" data-billing-price="${plan}"><strong>${formatBillingAmount(price?.monthlyEquivalent, price?.currency)}</strong><span>/ mois${selectedBillingInterval === 'annual' ? ' · paiement annuel' : ''}</span></div>
      <ul class="billing-plan-features">${(catalogPlan?.capabilities || []).slice(0, 5).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      <button type="button" class="settings-action-button" data-billing-checkout="${plan}"${current ? ' disabled' : ''}>${current ? 'Forfait actuel' : `Choisir ${escapeHtml(catalogPlan?.name || plan)}`}</button>
    </article>`;
}

function renderBillingSettings() {
  const balance = document.querySelector<HTMLElement>('[data-billing-balance]');
  if (balance) {
    balance.textContent = billingWalletUnavailable
      ? 'Solde momentanément indisponible'
      : billingWallet?.mode === 'shadow'
      ? 'Accès ouvert · V2 en validation'
      : formatCredits(billingWallet?.balance) === 'Illimité' ? 'Crédits illimités' : `${formatCredits(billingWallet?.balance)} crédits`;
  }
  const currentPlan = document.querySelector<HTMLElement>('#tab-facturation [data-settings-billing-plan]');
  if (currentPlan) currentPlan.textContent = billingWalletUnavailable
    ? 'Forfait à confirmer'
    : `Forfait ${billingWallet?.plan === 'business' ? 'Business' : billingWallet?.plan === 'pro' ? 'Pro' : 'Free'}`;

  document.querySelectorAll<HTMLElement>('[data-billing-interval]').forEach(button => {
    button.classList.toggle('active', button.dataset.billingInterval === selectedBillingInterval);
  });
  const grid = document.querySelector<HTMLElement>('[data-billing-plan-grid]');
  if (grid) grid.innerHTML = `${billingPlanMarkup('pro')}${billingPlanMarkup('business')}`;
  renderBillingIntent();

  const topupSelect = document.querySelector<HTMLSelectElement>('[data-billing-topup-product]');
  const topupButton = document.querySelector<HTMLButtonElement>('[data-settings-action="billing-topup"]');
  const isPaid = billingWallet?.plan === 'pro' || billingWallet?.plan === 'business';
  const plan = billingWallet?.plan === 'business' ? 'business' : 'pro';
  const products = (billingCatalog?.topups || []).filter(product => product.plan === plan);
  if (topupSelect) {
    topupSelect.innerHTML = products.map(product => `<option value="${escapeHtml(product.id)}">${new Intl.NumberFormat().format(product.credits)} crédits · ${formatBillingAmount(product.amount, product.currency)}</option>`).join('');
    topupSelect.disabled = !isPaid;
  }
  if (topupButton) topupButton.disabled = !isPaid;
}

/*
 * The chosen offer, or the payment's outcome, at the top of Billing.
 *
 * The offer is confirmed rather than paid on arrival: the buyer sees the plan,
 * the credits and the amount before being sent to Saspay, and a reload cannot
 * start a second payment.
 */
function renderBillingIntent() {
  const box = document.querySelector<HTMLElement>('[data-billing-intent]');
  if (!box) return;
  const returnCopy: Record<BillingReturn, { title: string; body: string; tone: string }> = {
    success: { title: 'Paiement reçu', body: 'Votre forfait s’active dès que Saspay confirme le paiement, en général en quelques instants.', tone: 'success' },
    cancelled: { title: 'Paiement annulé', body: 'Aucun montant n’a été prélevé. Vous pouvez choisir une offre à nouveau.', tone: 'neutral' },
    'topup-success': { title: 'Recharge reçue', body: 'Les crédits sont ajoutés dès que Saspay confirme le paiement.', tone: 'success' },
    'topup-cancelled': { title: 'Recharge annulée', body: 'Aucun montant n’a été prélevé.', tone: 'neutral' },
  };
  if (billingReturnNotice) {
    const copy = returnCopy[billingReturnNotice];
    const pending = billingReturnNotice === 'success' || billingReturnNotice === 'topup-success';
    box.hidden = false;
    box.dataset.tone = copy.tone;
    box.innerHTML = `<div><h3>${escapeHtml(copy.title)}</h3><p>${escapeHtml(copy.body)}</p></div>${pending ? '<button type="button" class="settings-action-button" data-settings-action="billing-refresh">Actualiser</button>' : ''}`;
    return;
  }
  if (!pendingPlanChoice || !billingCatalog) { box.hidden = true; box.innerHTML = ''; return; }
  const { plan } = pendingPlanChoice;
  const name = billingCatalog.plans.find(item => item.key === plan)?.name || (plan === 'business' ? 'Business' : 'Pro');
  if (billingWallet?.plan === plan) {
    box.hidden = false;
    box.dataset.tone = 'neutral';
    box.innerHTML = `<div><h3>${escapeHtml(name)} est déjà votre forfait</h3><p>Vous pouvez changer le nombre de crédits ou ajouter une recharge ci-dessous.</p></div><button type="button" class="settings-action-button" data-settings-action="billing-dismiss-choice">Fermer</button>`;
    return;
  }
  const select = document.querySelector<HTMLSelectElement>(`[data-billing-tier="${plan}"]`);
  if (select && pendingPlanChoice.credits && Array.from(select.options).some(option => Number(option.value) === pendingPlanChoice!.credits)) {
    select.value = String(pendingPlanChoice.credits);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.querySelector(`.billing-plan-card[data-plan="${plan}"]`)?.classList.add('is-selected');
  const credits = Number(select?.value || pendingPlanChoice.credits || 100);
  const price = billingPrice(plan, credits);
  const total = formatBillingAmount(price?.amount ?? price?.monthlyEquivalent, price?.currency);
  const cadence = selectedBillingInterval === 'annual' ? ' / an' : ' / mois';
  box.hidden = false;
  box.dataset.tone = 'accent';
  box.innerHTML = `<div><h3>Vous avez choisi ${escapeHtml(name)}</h3><p>${new Intl.NumberFormat('fr-FR').format(credits)} crédits par mois · ${selectedBillingInterval === 'annual' ? 'paiement annuel' : 'paiement mensuel'}. Le paiement se fait sur la page sécurisée Saspay.</p></div>`
    + `<div class="billing-inline-actions"><button type="button" class="settings-action-button" data-settings-action="billing-dismiss-choice">Changer d’offre</button>`
    + `<button type="button" class="settings-action-button is-primary" data-billing-checkout="${plan}">Payer ${escapeHtml(name)} — ${escapeHtml(total)}${cadence}</button></div>`;
}

/**
 * The dashboard's billing links: `?settings=facturation&plan=pro&credits=100&interval=annual`
 * from an offer button, `?billing=success|cancelled|…` back from Saspay.
 * Consumed once and removed from the address.
 */
export function openBillingFromUrl(location: Location = window.location): boolean {
  const choice = readPlanChoice(location.search);
  const back = readBillingReturn(location.search);
  if (!choice && !back && !wantsBillingSettings(location.search)) return false;
  try { window.history.replaceState(window.history.state, '', withoutPlanParams(location.href)); } catch { /* the address keeps them */ }
  if (choice) {
    pendingPlanChoice = { plan: choice.plan, credits: choice.credits };
    selectedBillingInterval = choice.interval;
  }
  billingReturnNotice = back;
  if (!ensureSettingsPanel()) return false;
  openSettings('billing');
  // Back from a payment: the plan and the balance may just have changed.
  if (back) void loadBillingSettings(true);
  return true;
}

async function loadBillingSettings(force = false) {
  if (billingLoaded && !force) return;
  const grid = document.querySelector<HTMLElement>('[data-billing-plan-grid]');
  if (grid) grid.innerHTML = '<div class="usage-empty">Chargement des forfaits…</div>';
  try {
    const catalogResponse = await apiFetch<BillingCatalogResponse>('/api/billing/plans');
    billingCatalog = catalogResponse.catalog || null;
    if (!billingCatalog) throw new Error('Le catalogue des forfaits est indisponible.');
  } catch (error) {
    // The public prices are versioned in the bundle as well: an unreachable
    // catalogue route shows them rather than "catalogue indisponible". The
    // checkout is still the server's, which validates the tier again.
    console.warn('[coden:billing_catalog_fallback]', error);
    billingCatalog = publicBillingCatalog() as unknown as NonNullable<BillingCatalogResponse['catalog']>;
  }

  billingWalletUnavailable = false;
  try {
    billingWallet = await apiFetch<BillingWalletResponse>('/api/billing/wallet');
  } catch (error) {
    // A private balance outage must never hide the public, versioned pricing catalog.
    billingWallet = null;
    billingWalletUnavailable = true;
    console.warn('[coden:billing_wallet_unavailable]', error);
  }

  try {
    billingLoaded = true;
    renderBillingSettings();
  } catch (error) {
    if (grid) grid.innerHTML = `<div class="usage-empty">${escapeHtml(error instanceof Error ? error.message : 'La facturation est momentanément indisponible.')}</div>`;
  }
}

async function startBillingCheckout(plan: 'pro' | 'business', button: HTMLButtonElement) {
  const select = document.querySelector<HTMLSelectElement>(`[data-billing-tier="${plan}"]`);
  const credits = Number(select?.value || 100);
  button.disabled = true;
  button.textContent = 'Ouverture sécurisée…';
  try {
    const response = await apiFetch<{ success: boolean; url?: string }>('/api/billing/checkout/subscription', {
      method: 'POST',
      body: JSON.stringify({
        planKey: plan,
        credits,
        billingInterval: selectedBillingInterval,
        email: currentAuthSummary?.user?.email || undefined,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    if (!response.url) throw new Error('Saspay n’a pas retourné de page de paiement.');
    window.location.assign(response.url);
  } catch (error) {
    button.disabled = false;
    button.textContent = `Choisir ${plan === 'business' ? 'Business' : 'Pro'}`;
    setSettingsStatus(error instanceof Error ? error.message : 'Paiement indisponible', 'error');
  }
}

async function openBillingPortal() {
  setSettingsStatus('Ouverture du portail sécurisé…', 'saving');
  try {
    const response = await apiFetch<{ success: boolean; url?: string }>('/api/billing/portal', { method: 'POST', body: '{}' });
    if (!response.url) throw new Error('Espace de facturation Saspay indisponible.');
    window.location.assign(response.url);
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : 'Portail indisponible', 'error');
  }
}

async function startTopupCheckout() {
  const select = document.querySelector<HTMLSelectElement>('[data-billing-topup-product]');
  const productId = String(select?.value || '');
  if (!productId) return;
  setSettingsStatus('Ouverture de la recharge…', 'saving');
  try {
    const response = await apiFetch<{ success: boolean; url?: string }>('/api/billing/checkout/topup', {
      method: 'POST',
      body: JSON.stringify({ productId, email: currentAuthSummary?.user?.email || undefined, idempotencyKey: crypto.randomUUID() }),
    });
    if (!response.url) throw new Error('Saspay n’a pas retourné de page de paiement.');
    window.location.assign(response.url);
  } catch (error) {
    setSettingsStatus(error instanceof Error ? error.message : 'Recharge indisponible', 'error');
  }
}

function renderAiUsage(data: AiUsageResponse) {
  const balance = document.getElementById('ai-usage-balance');
  const monthly = document.getElementById('ai-usage-monthly');
  const daily = document.getElementById('ai-usage-daily');
  const topups = document.getElementById('ai-usage-topups');
  if (balance) balance.textContent = formatCredits(data.wallet?.balance);
  if (monthly) monthly.textContent = formatCredits(data.wallet?.monthly_credits);
  if (daily) daily.textContent = formatCredits(data.wallet?.daily_promo_credits);
  if (topups) topups.textContent = formatCredits(data.wallet?.topup_credits);

  /*
   * These four read `spendable`, not `breakdown`.
   *
   * `breakdown` is keyed by the grant's KIND — `daily_build`, `monthly_ai`,
   * `topup`. Every debit filters on its usage_restriction instead, drawing
   * only from grants restricted to the category being charged or to
   * `general`. Reading the first and spending the second is how this account
   * saw 30 credits and got "the model is temporarily unavailable" on its next
   * message: the 30 were build and cloud, the chat needed ai_gateway, and the
   * ai_gateway allowance is 4 a month on the free plan.
   *
   * Two of these slots were also simply never right. A top-up is spendable on
   * all three categories but, being kind `topup`, showed under none of them;
   * and "General credits" asked `breakdown` for `general`, which is a
   * restriction and never a kind, so it displayed nothing at all.
   *
   * `spendable` comes from the server computed with the reservation RPC's own
   * predicate, so what is displayed here is what the next request can spend.
   */
  const spendable = data.wallet?.spendable || {};
  const buildGrant = document.getElementById('grant-build');
  const cloudGrant = document.getElementById('grant-cloud');
  const aiGrant = document.getElementById('grant-ai');
  const generalGrant = document.getElementById('grant-general');
  if (buildGrant) buildGrant.textContent = formatCredits(spendable.build);
  if (cloudGrant) cloudGrant.textContent = formatCredits(spendable.cloud);
  if (aiGrant) aiGrant.textContent = formatCredits(spendable.ai_gateway);
  if (generalGrant) generalGrant.textContent = formatCredits(data.wallet?.shared);

  const history = document.getElementById('ai-usage-history');
  if (history) {
    const rows = data.history || [];
    history.innerHTML = rows.length ? rows.map(item => `
      <div class="usage-row">
        <div class="usage-row-head">
          <span class="usage-row-title">${escapeHtml(item.mode || 'Action')}</span>
          <span class="usage-credit-pill">${escapeHtml(formatCredits(item.credits_charged))} crédit${Number(item.credits_charged) > 1 ? 's' : ''}</span>
        </div>
        <div class="usage-row-meta">
          ${escapeHtml(item.model_name || 'Auto')} · ${escapeHtml(item.project_name || 'Projet')} · ${escapeHtml(({ completed: 'terminé', failed: 'échoué', refunded: 'remboursé', pending: 'en cours' } as Record<string, string>)[String(item.status || 'completed')] || String(item.status))} · ${escapeHtml(formatDate(item.created_at))}
        </div>
      </div>
    `).join('') : '<div class="usage-empty">L’historique apparaîtra ici après votre première génération, correction ou publication.</div>';
  }

}

async function loadAiUsageSettings(force = false) {
  if (aiUsageLoaded && !force) return;
  const history = document.getElementById('ai-usage-history');
  if (history) history.innerHTML = '<div class="usage-empty">Chargement de la consommation…</div>';
  try {
    const usage = await apiFetch<AiUsageResponse>('/api/users/me/ai-usage');
    renderAiUsage(usage);
    aiUsageLoaded = true;
  } catch (error) {
    if (history) history.innerHTML = `<div class="usage-empty">${escapeHtml(error instanceof Error ? error.message : 'La consommation est momentanément indisponible.')}</div>`;
  }
}
