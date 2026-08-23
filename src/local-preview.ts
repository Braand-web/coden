import './styles/local-preview.css';

export const LOCAL_PREVIEW_QUERY_KEY = 'localPreview';
export const LOCAL_PREVIEW_PROJECT_ID = 'local-preview-project-001';

type PreviewLocation = {
  href: string;
  hostname: string;
};

type LocalPreviewAuth = {
  user: {
    id: string;
    email: string;
    user_metadata: { full_name: string };
  };
  session: {
    access_token: string;
    user: LocalPreviewAuth['user'];
  };
};

const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;

export function isLocalPreviewLocation(location: PreviewLocation, isDev: boolean): boolean {
  if (!isDev) return false;
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
  try {
    return new URL(location.href).searchParams.get(LOCAL_PREVIEW_QUERY_KEY) === '1';
  } catch {
    return false;
  }
}

export function isLocalPreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return isLocalPreviewLocation(window.location, Boolean(viteEnv?.DEV));
}

export function getLocalPreviewAuth(): LocalPreviewAuth {
  const user = {
    id: 'local-preview-user',
    email: 'preview@localhost',
    user_metadata: { full_name: 'Aperçu local' },
  };
  return {
    user,
    session: {
      access_token: 'local-preview-session',
      user,
    },
  };
}

export function localPreviewUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set(LOCAL_PREVIEW_QUERY_KEY, '1');
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return `${url.pathname}${url.search}`;
}

export function installLocalPreviewSurface(surface: string): void {
  if (!isLocalPreviewEnabled()) return;
  document.documentElement.dataset.localPreview = 'true';
  document.documentElement.dataset.localPreviewSurface = surface;

  const render = () => {
    if (document.getElementById('coden-local-preview-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'coden-local-preview-banner';
    banner.className = 'coden-local-preview-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.innerHTML = `
      <span class="coden-local-preview-dot" aria-hidden="true"></span>
      <span>Aperçu local · ${surface === 'builder' ? 'Builder' : 'Dashboard'}</span>
      <span class="coden-local-preview-note">Auth, IA, écritures et publication désactivées</span>
    `;
    document.body.prepend(banner);
  };

  if (document.body) render();
  else document.addEventListener('DOMContentLoaded', render, { once: true });
}

export type LocalPreviewApiResult = {
  handled: boolean;
  blocked?: boolean;
  payload?: unknown;
};

const localPreviewProject = {
  id: LOCAL_PREVIEW_PROJECT_ID,
  name: 'Aperçu local — Pulseboard',
  slug: 'local-preview-pulseboard',
  template: 'dashboard',
  theme: 'coden-forge',
  model_id: 'auto',
  status: 'draft',
  preview_status: 'unknown',
  live_url: null,
  prompt: 'Aperçu de l’interface Builder sans génération réelle.',
  created_at: '2026-01-01T09:00:00.000Z',
  updated_at: '2026-01-01T09:00:00.000Z',
};

const localPreviewState = {
  last_project_id: LOCAL_PREVIEW_PROJECT_ID,
  dashboard_draft_prompt: '',
  dashboard_selected_mode: 'auto',
  builder_draft_prompt: '',
  builder_selected_mode: 'auto',
  builder_selected_model: 'auto',
  builder_active_tab: 'preview',
  builder_preview_device: 'desktop',
  last_route: '/dashboard.html',
};

const localPreviewWallet = {
  success: true,
  plan: 'pro',
  balance: 820,
  buckets: { monthly_credits: 2000, daily_promo_credits: 0, topup_credits: 0 },
};

const localPreviewModels = {
  models: [
    {
      id: 'auto',
      display_name: 'Auto',
      tier: 'standard',
      provider: 'local-preview',
      description: 'Sélecteur visible uniquement pour l’aperçu de l’interface.',
      plan_minimum: 'free',
      locked: false,
      capabilities: { streaming: false, structuredOutput: false, toolCalling: false },
    },
  ],
};

function localPreviewProjectPayload() {
  return {
    success: true,
    project: localPreviewProject,
    files: [],
    messages: [],
    events: [],
    workspace_state: {
      draft_prompt: '',
      selected_mode: 'auto',
      selected_model: 'auto',
      active_tab: 'preview',
      preview_device: 'desktop',
    },
    preview: { status: 'unknown', html: '' },
    verification_status: 'unknown',
    local_preview: true,
  };
}

function isProjectPath(path: string, suffix: string): boolean {
  return path.startsWith(`/api/projects/${LOCAL_PREVIEW_PROJECT_ID}`) && path.endsWith(suffix);
}

export function getLocalPreviewApiResult(path: string, method = 'GET'): LocalPreviewApiResult {
  if (!isLocalPreviewEnabled()) return { handled: false };
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod !== 'GET' && normalizedMethod !== 'HEAD') {
    return { handled: true, blocked: true };
  }

  if (path === '/api/projects') {
    return { handled: true, payload: { success: true, projects: [localPreviewProject], local_preview: true } };
  }
  if (path === '/api/billing/wallet') {
    return { handled: true, payload: { ...localPreviewWallet, local_preview: true } };
  }
  if (path === '/api/users/me/workspace-state') {
    return { handled: true, payload: { success: true, state: localPreviewState, local_preview: true } };
  }
  if (path === '/api/auth/me') {
    return { handled: true, payload: { success: true, user: { is_platform_admin: false }, local_preview: true } };
  }
  if (path === '/api/users/me/ai-usage') {
    return {
      handled: true,
      payload: {
        success: true,
        wallet: { ...localPreviewWallet, cloud: { balance_usd: null, ai_app_balance_usd: null, database_storage_gb: null, file_storage_gb: null, bandwidth_gb: null, topup_min_usd: null } },
        history: [],
        local_preview: true,
      },
    };
  }
  if (path === '/api/users/me/model-credit-rates') {
    return {
      handled: true,
      payload: {
        success: true,
        models: [{ id: 'auto', display_name: 'Auto', tier: 'standard', availability: 'all', credits: { plan: '—', build: '—', fix: '—', deploy: '—' } }],
        local_preview: true,
      },
    };
  }
  if (path === '/api/ai/models') {
    return { handled: true, payload: { ...localPreviewModels, providers: [], local_preview: true } };
  }
  if (path === '/api/assistant/chat') {
    return { handled: true, payload: { success: false, local_preview: true, message: 'Le chat IA est désactivé dans l’aperçu local.' } };
  }
  if (path === `/api/projects/${LOCAL_PREVIEW_PROJECT_ID}`) {
    return { handled: true, payload: localPreviewProjectPayload() };
  }
  if (path === `/api/projects/${LOCAL_PREVIEW_PROJECT_ID}/workspace-state`) {
    return { handled: true, payload: { success: true, state: localPreviewState, local_preview: true } };
  }
  if (isProjectPath(path, '/publish/status')) {
    return {
      handled: true,
      payload: {
        success: true,
        state: 'not_ready',
        public_url: '',
        custom_domain: null,
        latest_published_at: null,
        project_updated_at: localPreviewProject.updated_at,
        badge_required: false,
        checks: [],
        can_publish: false,
        has_unpublished_changes: false,
        local_preview: true,
      },
    };
  }
  if (isProjectPath(path, '/agent/runs') || path.includes('/agent/runs?')) {
    return { handled: true, payload: { success: true, runs: [], local_preview: true } };
  }
  if (path.endsWith('/versions')) {
    return { handled: true, payload: { success: true, versions: [], local_preview: true } };
  }
  if (path.endsWith('/database')) {
    return { handled: true, payload: { success: true, database: { provisioning_required: true, status: 'not_configured' }, local_preview: true } };
  }
  if (path.endsWith('/db/schemas')) {
    return { handled: true, payload: { success: true, provisioning_required: true, schemas: [], local_preview: true } };
  }
  if (path.endsWith('/users')) {
    return { handled: true, payload: { success: true, users: [], local_preview: true } };
  }
  if (path.includes('/analysis')) {
    return { handled: true, payload: { success: false, local_preview: true, message: 'Analyse indisponible dans l’aperçu local.' } };
  }

  return {
    handled: true,
    payload: { success: false, local_preview: true, message: 'Cette action n’est pas disponible dans l’aperçu local.' },
  };
}
