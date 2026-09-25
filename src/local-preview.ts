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
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return false;
  try {
    const explicitlyRequested = new URL(location.href).searchParams.get(LOCAL_PREVIEW_QUERY_KEY) === '1';
    // The localhost boundary is the security gate. Some desktop preview hosts
    // serve a production Vite bundle, where import.meta.env.DEV is false even
    // though the surface is isolated on loopback. Keep the explicit query
    // requirement so this can never activate on coden.fun.
    return explicitlyRequested && (isDev || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
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

/*
 * A small project to look at: the Code and Cloud workshops are empty screens
 * without files, and an interface cannot be reviewed from its empty state.
 * Only ever served on loopback with ?localPreview=1.
 */
const localPreviewFiles = [
  { path: 'index.html', content: '<!doctype html>\n<html lang="fr">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Pulseboard</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n' },
  { path: 'package.json', content: '{\n  "name": "pulseboard",\n  "private": true,\n  "type": "module",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  },\n  "dependencies": {\n    "react": "^19.0.0",\n    "react-dom": "^19.0.0"\n  }\n}\n' },
  { path: 'src/main.tsx', content: "import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);\n" },
  { path: 'src/App.tsx', content: "import { useState } from 'react';\nimport { StatCard } from './components/StatCard';\n\n// Three numbers the team checks every morning.\nconst stats = [\n  { label: 'Projets', value: 12 },\n  { label: 'Tâches', value: 38 },\n  { label: 'Équipe', value: 7 },\n];\n\nexport default function App() {\n  const [range, setRange] = useState<'7d' | '30d'>('7d');\n  return (\n    <main className=\"page\">\n      <h1>Votre activité, en un coup d’œil.</h1>\n      <button onClick={() => setRange(range === '7d' ? '30d' : '7d')}>\n        {range === '7d' ? '7 jours' : '30 jours'}\n      </button>\n      <section className=\"grid\">\n        {stats.map(stat => <StatCard key={stat.label} {...stat} />)}\n      </section>\n    </main>\n  );\n}\n" },
  { path: 'src/components/StatCard.tsx', content: "type Props = { label: string; value: number };\n\nexport function StatCard({ label, value }: Props) {\n  return (\n    <article className=\"card\">\n      <span>{label}</span>\n      <strong>{value.toLocaleString('fr-FR')}</strong>\n    </article>\n  );\n}\n" },
  { path: 'src/styles.css', content: ':root {\n  --accent: #3a83f7;\n  font-family: system-ui, sans-serif;\n}\n\n.page {\n  max-width: 960px;\n  margin: 0 auto;\n  padding: 48px 24px;\n}\n\n.grid {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);\n  gap: 12px;\n}\n\n.card strong {\n  font-size: 24px;\n  color: var(--accent);\n}\n' },
  { path: 'api/contacts.ts', content: "// Lists the workspace contacts; the key stays on the server.\nexport async function GET(request: Request) {\n  const url = new URL(request.url);\n  const limit = Number(url.searchParams.get('limit') || 20);\n  return Response.json({ contacts: [], limit });\n}\n" },
];

const localPreviewHtml = '<!doctype html><html><body style="margin:0;font-family:system-ui;background:#fff;color:#1a1c1f"><main style="max-width:960px;margin:0 auto;padding:48px 24px"><h1 style="font-size:34px;margin:0 0 24px">Votre activité, en un coup d’œil.</h1><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"><div style="padding:18px;border:1px solid #e2e2e2;border-radius:12px">Projets<br><b style="font-size:24px;color:#3a83f7">12</b></div><div style="padding:18px;border:1px solid #e2e2e2;border-radius:12px">Tâches<br><b style="font-size:24px;color:#3a83f7">38</b></div><div style="padding:18px;border:1px solid #e2e2e2;border-radius:12px">Équipe<br><b style="font-size:24px;color:#3a83f7">7</b></div></div></main></body></html>';

const localPreviewDatabase = {
  cloud: { status: 'ready', provider: 'coden_cloud', region: 'eu-west', mode: 'shared', schema_name: 'app_pulseboard', resources: [{}, {}], requirements: { needs_auth: true } },
  tables: [{ name: 'contacts' }, { name: 'tasks' }],
  assets: [{ id: 'a1', name: 'logo.svg', mime_type: 'image/svg+xml', size_bytes: 2048 }],
  secrets: [{ id: 's1', variable: 'RESEND_API_KEY', service: 'Resend', masked_value: 're_••••••••4f2a' }],
  activity: [
    { event_type: 'deploy', message: 'Aperçu reconstruit', created_at: '2026-01-01T09:00:00.000Z' },
    { event_type: 'migration', message: 'Table contacts créée', created_at: '2026-01-01T08:55:00.000Z' },
  ],
  integrations: [],
  security: { rls_required: true },
  last_sync_at: '2026-01-01T09:00:00.000Z',
};

function localPreviewProjectPayload() {
  return {
    success: true,
    project: localPreviewProject,
    files: localPreviewFiles,
    messages: [],
    events: [],
    workspace_state: {
      draft_prompt: '',
      selected_mode: 'auto',
      selected_model: 'auto',
      active_tab: 'preview',
      preview_device: 'desktop',
    },
    preview: { status: 'unknown', html: localPreviewHtml },
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
  if (path === '/api/integrations/status') {
    return { handled: true, payload: { success: true, configured: true, local_preview: true } };
  }
  if (path === '/api/integrations/categories') {
    return { handled: true, payload: { success: true, configured: true, categories: [{ id: 'developer-tools', name: 'Outils développeur' }, { id: 'databases', name: 'Bases de données' }, { id: 'payments', name: 'Paiements' }, { id: 'productivity', name: 'Productivité' }], local_preview: true } };
  }
  if (path.startsWith('/api/integrations/toolkits')) {
    const toolkit = (slug: string, name: string, description: string, category: string) => ({ slug, name, description, logo: '', categories: [{ id: category, name: category }], toolsCount: 20, noAuth: false, managed: true });
    return {
      handled: true,
      payload: {
        success: true,
        configured: true,
        items: [
          toolkit('github', 'GitHub', 'Dépôts, issues et pull requests.', 'Outils développeur'),
          toolkit('supabase', 'Supabase', 'Base Postgres, authentification et stockage.', 'Bases de données'),
          toolkit('stripe', 'Stripe', 'Paiements, abonnements et factures.', 'Paiements'),
          toolkit('notion', 'Notion', 'Pages et bases de connaissances.', 'Productivité'),
          toolkit('gmail', 'Gmail', 'Envoyer et organiser des e-mails.', 'Productivité'),
          toolkit('slack', 'Slack', 'Messages et notifications d’équipe.', 'Productivité'),
        ],
        nextCursor: null,
        local_preview: true,
      },
    };
  }
  if (path === '/api/integrations/connections') {
    return { handled: true, payload: { success: true, configured: true, connections: [{ id: 'ca_preview', toolkit: 'github', status: 'ACTIVE' }], local_preview: true } };
  }
  if (path === '/api/users/me/personalization') {
    return { handled: true, payload: { success: true, personalization: { instructions: '', shareImprovement: true, updatedAt: null, maxInstructions: 4000 }, local_preview: true } };
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
  // The status is nested under `publish`, because that is where the real route
  // puts it and where the panel reads it. Returned flat, every field here was
  // invisible: `payload.publish` was undefined, so the panel rendered its
  // no-status state and the stub silently described nothing.
  if (isProjectPath(path, '/publish/status')) {
    return {
      handled: true,
      payload: {
        success: true,
        publish: {
          state: 'not_ready',
          public_url: '',
          custom_domain: null,
          current_visitors: 0,
          latest_published_at: null,
          project_updated_at: localPreviewProject.updated_at,
          badge_required: false,
          can_publish: false,
          has_unpublished_changes: false,
          checks: [
            { key: 'files', label: 'Fichiers du projet', status: 'fail', detail: 'Génération désactivée dans l’aperçu local.' },
            { key: 'preview', label: 'Aperçu', status: 'fail', detail: 'Aucun aperçu vérifié dans l’aperçu local.' },
          ],
        },
        deployment: null,
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
    return { handled: true, payload: { success: true, database: localPreviewDatabase, local_preview: true } };
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
