import './styles/local-preview.css';
import { resolveCloudState } from './lib/cloud-state';

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

/*
 * Shaped like most projects in production: a backend the app needs and that
 * is not activated yet. A "ready" sample hid exactly the state people meet.
 */
const localPreviewNeeds = { needs_database: true, needs_auth: true, needs_storage: false };
const localPreviewDatabase = {
  backend_status: 'required',
  cloud: { status: 'required', raw_status: 'planned', state: resolveCloudState({ status: 'planned', needs: localPreviewNeeds }), needs: localPreviewNeeds, provider: 'coden_cloud', region: 'auto', mode: 'dedicated', schema_name: 'app_pulseboard', resources: [], requirements: { needs_auth: true } },
  tables: [{ name: 'contacts' }, { name: 'tasks' }],
  assets: [{ id: 'a1', name: 'logo.svg', mime_type: 'image/svg+xml', size_bytes: 2048 }],
  secrets: [
    { id: 's1', variable: 'RESEND_API_KEY', service: 'Resend', masked_value: 're_••••••••4f2a', status: 'configured', updated_at: '2026-01-01T09:00:00.000Z' },
    { id: 's2', variable: 'STRIPE_SECRET_KEY', service: 'Stripe', masked_value: 'sk_t••••••9Qx1', status: 'needs_reentry', updated_at: '2025-12-20T09:00:00.000Z' },
  ],
  activity: [
    { event_type: 'deploy', message: 'Aperçu reconstruit', created_at: '2026-01-01T09:00:00.000Z' },
    { event_type: 'migration', message: 'Table contacts créée', created_at: '2026-01-01T08:55:00.000Z' },
  ],
  integrations: [],
  security: { rls_required: true, secrets_encrypted: true },
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
  if (path.startsWith('/api/admin/')) {
    return { handled: true, payload: localPreviewAdminPayload(path.replace('/api/admin/', '').split('?')[0]) };
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

/** Small, obviously sample data so the admin console can be laid out without a backend. */
function localPreviewAdminPayload(section: string): Record<string, unknown> {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString();
  const runs = Array.from({ length: 24 }, (_, index) => ({
    id: `run_${index}`, request_id: `req_${index}`, project_id: LOCAL_PREVIEW_PROJECT_ID, status: index % 8 === 0 ? 'failed' : 'completed',
    intent: index % 3 ? 'build_app' : 'edit_app', model_id: index % 2 ? 'anthropic/claude-sonnet-5' : 'openai/gpt-6-luna',
    diagnostic_code: index % 8 === 0 ? 'PREVIEW_BROWSER_CHECK_FAILED' : null, duration_ms: 90_000 + index * 2_000, created_at: day(index % 14),
  }));
  const libraryItem = (id: string, kind: string, name: string, description: string, uses: number, successes: number, status = 'active') => ({
    id, kind, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, description, version: 1 + (uses % 3), status, is_latest: true, parent_id: null,
    definition: kind === 'agent'
      ? { role: name, systemPrompt: 'Exemple de prompt système générique.', tools: ['read_file', 'write_file', 'edit_file'], modelTier: 'design' }
      : { whenToUse: description, instructions: 'Étapes génériques…', examples: [], dependencies: ['@stripe/stripe-js'] },
    tags: [], uses, successes, failures: uses - successes, contributors: 3, created_by: 'agent',
    disabled_reason: status === 'disabled' ? 'Désactivé automatiquement : 1 réussite(s) sur 7 utilisations.' : null,
    last_used_at: day(uses % 5), created_at: day(20), updated_at: day(1),
  });
  const libraryOverview = { agents: 4, skills: 6, disabled: 1, versions: 5, uses: 128, successes: 109, rules: 23, permanentRules: 5, needsReview: 2, recurring: 1, errorsSeen: 214 };
  const payloads: Record<string, Record<string, unknown>> = {
    library: {
      overview: libraryOverview,
      items: [
        libraryItem('a1', 'agent', 'Expert UI', 'Écrans React, design tokens, responsive', 41, 37),
        libraryItem('a2', 'agent', 'Expert base de données', 'Schéma Supabase, RLS, requêtes typées', 22, 19),
        libraryItem('a3', 'agent', 'Testeur', 'Scénarios de bout en bout et tests unitaires', 18, 15),
        libraryItem('a4', 'agent', 'Revue de sécurité', 'Secrets, RLS, validation des entrées', 7, 1, 'disabled'),
      ],
    },
    'error-memory': {
      memories: [
        { id: 'm1', signature: 'build|react-router-dom|…', category: 'build', error_message: "'switch' is not exported from 'react-router-dom'", context: { libraries: { 'react-router-dom': 7 } }, cause: 'API de la v5 utilisée avec la v7', fix: 'Utiliser Routes et Route', rule: 'Avec react-router-dom v7 : ne pas importer Switch, utiliser Routes.', status: 'active', permanent: true, occurrences: 14, confirmations: 12, recurrences_after_rule: 1, contributors: 9, last_seen_at: day(0) },
        { id: 'm2', signature: 'runtime|@supabase/supabase-js|…', category: 'runtime', error_message: 'supabase.auth.session is not a function', context: { libraries: { '@supabase/supabase-js': 2 } }, cause: 'Méthode retirée en v2', fix: 'Utiliser supabase.auth.getSession()', rule: 'Avec supabase-js v2 : ne pas utiliser auth.session(), utiliser auth.getSession().', status: 'active', permanent: false, occurrences: 5, confirmations: 4, recurrences_after_rule: 0, contributors: 4, last_seen_at: day(2) },
        { id: 'm3', signature: 'mishandling|-|…', category: 'mishandling', error_message: 'Fichier de routes supprimé par erreur', context: {}, cause: 'Réécriture complète d’un fichier partagé', fix: 'Modifier avec edit_file', rule: 'Ne jamais réécrire un fichier de routes entier : faire des modifications ciblées.', status: 'needs_review', permanent: false, occurrences: 2, confirmations: 1, recurrences_after_rule: 0, contributors: 2, last_seen_at: day(4) },
      ],
    },
    overview: {
      metrics: { users: 42, projects: 97, active_today: 6, runs: runs.length, failed_runs: 3, success_rate: 88, previews_ready: 61, publish_success: 18, ai_requests: 240, wallet_credits: 1840 },
      health: [
        { label: 'Supabase', status: 'ok', detail: 'Références frontend et backend identiques' },
        { label: 'OpenRouter', status: 'ok', detail: 'Clé API configurée' },
        { label: 'Intégrations Composio', status: 'ok', detail: 'Clé API configurée côté serveur' },
        { label: 'Publication', status: 'warning', detail: 'Aucun hébergeur configuré' },
      ],
      availability: { users: true, projects: true, agent_runs: true, deployments: true },
      distributions: { run_intent: { build_app: 16, edit_app: 8 } },
      recent: { failed_runs: runs.filter(run => run.status === 'failed') },
    },
    runs: { runs },
    errors: { errors: { failed_runs: runs.filter(run => run.status === 'failed'), runner_failures: [] }, grouped: { diagnostic_code: { PREVIEW_BROWSER_CHECK_FAILED: 3 } } },
    'agent-learning': {
      signals: {
        total: 186, shared: 171, by_kind: { run: 88, error_fixed: 51, feedback: 31, retry: 8, revert: 8 }, runs: 88, run_success_rate: 84,
        errors_fixed: 117, retries: 8, reverts: 8, feedback_positive: 26, feedback_negative: 5,
        per_day: Array.from({ length: 30 }, (_, index) => ({ day: day(29 - index).slice(0, 10), runs: 1 + ((index * 7) % 6), successes: 1 })),
      },
      knowledge: {
        rows: 214, patterns: 73, visible_patterns: 14, curated: 11, min_contributors: 2,
        top: [
          { kind: 'error_fix', task_type: 'code_generation', content: 'Erreur « failed to resolve import \'recharts\' » → corrigée en : installer le paquet « recharts » avec install_package plutôt que réécrire l\'import.', contributors: 9, last_seen: day(0) },
          { kind: 'stack_pattern', task_type: 'code_generation', content: 'Application de type saas construite et vérifiée avec : @supabase/supabase-js, lucide-react, react-router-dom, recharts.', contributors: 4, last_seen: day(2) },
        ],
      },
      personalization: { users: 42, with_preferences: 17, with_instructions: 11, opted_out: 2, share_rate: 95, memory_users: 29 },
      routing: {
        min_runs: 8,
        stats: [
          { task_type: 'code_generation', model_id: 'anthropic/claude-sonnet-5', runs: 46, successes: 41, success_rate: 89, smoothed_rate: 87, reliable: true },
          { task_type: 'code_generation', model_id: 'openai/gpt-6-luna', runs: 22, successes: 16, success_rate: 73, smoothed_rate: 72, reliable: true },
          { task_type: 'code_edit', model_id: 'google/gemini-3-flash', runs: 5, successes: 5, success_rate: 100, smoothed_rate: 84, reliable: false },
        ],
      },
    },
    integrations: {
      configured: true, catalogue_total: 870, totals: { connections: 23, active: 20, users: 14, toolkits: 6 },
      by_toolkit: [
        { toolkit: 'supabase', active: 8, pending: 1, failed: 0, users: 8 }, { toolkit: 'github', active: 5, pending: 0, failed: 0, users: 5 },
        { toolkit: 'stripe', active: 3, pending: 1, failed: 0, users: 3 }, { toolkit: 'notion', active: 2, pending: 0, failed: 0, users: 2 },
        { toolkit: 'gmail', active: 1, pending: 0, failed: 1, users: 1 }, { toolkit: 'slack', active: 1, pending: 0, failed: 0, users: 1 },
      ],
      recent: [
        { id: 'ca_1', toolkit: 'stripe', status: 'ACTIVE', user_id: 'local-preview-user', created_at: day(0) },
        { id: 'ca_2', toolkit: 'supabase', status: 'INITIATED', user_id: 'local-preview-user', created_at: day(1) },
      ],
    },
    'feature-flags': {
      flags: [
        { key: 'multi_agent_pipeline', label: 'Pipeline multi-agents (planner, coder, réparation)', enabled: true, rollout: 'tous', risk: 'high' },
        { key: 'composio_integrations', label: 'Intégrations Composio', enabled: true, rollout: 'tous', risk: 'medium' },
        { key: 'parallel_writers', label: 'Écritures parallèles', enabled: false, rollout: 'tous', risk: 'high' },
      ],
    },
  };
  const emails = ['awa@exemple.ci', 'marc@exemple.fr', 'lea@exemple.fr', 'admin@coden.fun', 'yao@exemple.ci', 'sofia@exemple.es'];
  const users = Array.from({ length: 34 }, (_, index) => ({
    id: `lp-user-${index + 1}`, email: index === 7 ? null : emails[index % emails.length].replace('@', `${index > 5 ? index : ''}@`),
    created_at: day(60 - index), last_sign_in_at: index % 5 === 0 ? day(0) : day(index % 20), is_platform_admin: index === 3,
    suspended: index === 9, banned_until: index === 9 ? day(-3650) : null, role: 'authenticated',
    wallet: { balance: 30 + index * 7 }, project_count: index % 6, run_count: (index * 3) % 17,
  }));
  payloads.users = { users, availability: { users: true, wallets: true } };
  payloads.projects = { projects: Array.from({ length: 41 }, (_, index) => ({
    id: `lp-project-${index + 1}`, name: ['Boutique Awa', 'Pulseboard', 'Agenda Kiné', 'Portfolio Léa', 'CRM Immobilier'][index % 5] + (index > 4 ? ` ${index}` : ''),
    owner_id: users[index % users.length].id, status: 'draft', preview_status: index % 4 ? 'verified' : 'needs_fix', publish_status: index % 6 === 0 ? 'published' : null,
    live_url: index % 6 === 0 ? `https://app-${index}.coden.app` : null, file_count: 12 + index, created_at: day(40 - index), updated_at: day(index % 12),
  })) };
  const models = ['openai/gpt-6-luna', 'anthropic/claude-sonnet-5', 'moonshotai/kimi-k3', 'google/gemini-3.8-flash'];
  const byDay = Array.from({ length: 30 }, (_, index) => ({ key: day(29 - index).slice(0, 10), cost_usd: Math.round((0.4 + ((index * 37) % 11) / 5) * 100) / 100, requests: 5 + (index % 9), prompt_tokens: 40_000 + index * 900, completion_tokens: 6_000 + index * 120 }));
  payloads.live = {
    live: { active_now: 3, active_today: 11, users_total: users.length, projects_today: 4, projects_week: 19, runs_today: 27, runs_failed_today: 2, running_turns: 1, tokens_today: 482_310, cost_today_usd: 1.87, cost_month_usd: 38.42 },
    alerts: [{ rule_id: 'r2', scope: 'user', target_id: users[1].id, budget_usd: 10, spent_usd: 11.4, ratio: 1.14, level: 'exceeded' }],
    recent_errors: runs.filter(run => run.status === 'failed'),
  };
  payloads.costs = {
    days: 30,
    totals: { cost_usd: 61.2, requests: 402, prompt_tokens: 12_400_000, completion_tokens: 1_950_000, today_usd: 1.87, month_usd: 38.42 },
    by_day: byDay,
    by_model: models.map((key, index) => ({ key, cost_usd: [31.4, 18.2, 7.9, 3.7][index], requests: [120, 96, 110, 76][index], prompt_tokens: [5e6, 3.8e6, 2.4e6, 1.2e6][index], completion_tokens: [8e5, 6e5, 3.5e5, 2e5][index] })),
    by_user: users.slice(0, 12).map((user, index) => ({ key: user.id, email: user.email, cost_usd: Math.round((14 - index) * 83) / 100, requests: 40 - index * 3, prompt_tokens: 900_000 - index * 60_000, completion_tokens: 120_000 - index * 8_000 })),
    alerts: {
      available: true,
      rules: [
        { id: 'r1', scope: 'global', target_id: null, monthly_budget_usd: 150, enabled: true, created_by: 'admin@coden.fun', created_at: day(20) },
        { id: 'r2', scope: 'user', target_id: users[1].id, email: users[1].email, monthly_budget_usd: 10, enabled: true, created_by: 'admin@coden.fun', created_at: day(4) },
      ],
      triggered: [{ rule_id: 'r2', scope: 'user', target_id: users[1].id, email: users[1].email, budget_usd: 10, spent_usd: 11.4, ratio: 1.14, level: 'exceeded' }],
    },
  };
  (payloads.costs as any).margins = users.slice(0, 10).map((user, index) => {
    const revenue = Math.round((12 - index) * 70) / 100;
    const cost = Math.round((14 - index * 1.4) * 60) / 100;
    return { key: user.id, email: user.email, revenue_usd: revenue, cost_usd: cost, margin_usd: Math.round((revenue - cost) * 100) / 100, margin_pct: revenue ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null, credits_charged: 40 - index * 3 };
  });
  payloads['cloud/backends'] = {
    backends: [
      { project_id: 'lp-project-2', project_name: 'Pulseboard', owner_id: users[1].id, status: 'active', mode: 'dedicated', region: 'eu-west-2', supabase_ref: 'abcd1234efgh5678ijkl', last_error: null, monthly_cost_usd: 10, updated_at: day(2) },
      { project_id: 'lp-project-5', project_name: 'CRM Immobilier', owner_id: users[4].id, status: 'failed', mode: 'dedicated', region: 'auto', supabase_ref: null, last_error: 'quota_reached', monthly_cost_usd: null, updated_at: day(1) },
      { project_id: 'lp-project-7', project_name: 'Agenda Kiné 7', owner_id: users[6].id, status: 'planned', mode: 'dedicated', region: 'auto', supabase_ref: null, last_error: null, monthly_cost_usd: null, updated_at: day(6) },
    ],
    totals: { total: 3, active: 1, failed: 1, monthly_cost_usd: 10 },
    pricing: { source: 'provider_cost_catalog', configured: true, unit_cost_usd: 10 },
  };
  payloads['alerts/channels'] = { slack: true, email: false };
  payloads['audit-log'] = { available: true, entries: [
    { id: 'e1', actor_email: 'admin@coden.fun', action: 'user.suspended', target_type: 'user', target_id: users[9].id, detail: { email: users[9].email, reason: 'Abus de génération' }, created_at: day(1) },
    { id: 'e2', actor_email: 'admin@coden.fun', action: 'cost_alert.created', target_type: 'cost_alert', target_id: 'r2', detail: { scope: 'user', monthly_budget_usd: 10 }, created_at: day(4) },
    { id: 'e3', actor_email: 'admin@coden.fun', action: 'library.updated', target_type: 'library_item', target_id: 'a2', detail: { fields: ['status'] }, created_at: day(6) },
    { id: 'e4', actor_email: 'admin@coden.fun', action: 'user.password_reset_sent', target_type: 'user', target_id: users[2].id, detail: { email: users[2].email }, created_at: day(9) },
  ] };
  if (section.startsWith('users/')) {
    const user = users.find(item => item.id === section.slice('users/'.length)) || users[0];
    return {
      success: true, local_preview: true,
      user: { ...user, confirmed_at: user.created_at, provider: 'email' },
      wallet: { balance: user.wallet.balance },
      projects: (payloads.projects.projects as any[]).filter(project => project.owner_id === user.id),
      runs: runs.slice(0, 6).map(run => ({ ...run, user_id: user.id })),
      costs: { totals: { cost_usd: 4.21, requests: 37, prompt_tokens: 812_000, completion_tokens: 96_000 }, by_model: [{ key: models[0], cost_usd: 3.1, requests: 20 }, { key: models[1], cost_usd: 1.11, requests: 17 }] },
      ledger: [], audit: [],
      admin_grants: [
        { id: '6f1c2d3e-0000-4000-8000-000000000001', restriction: 'general', credits_issued: 100, credits_remaining: 64, issued_at: day(8), expires_at: day(-82), revoked: false, reason: 'Geste commercial après un incident', granted_by: 'admin@coden.fun' },
        { id: '6f1c2d3e-0000-4000-8000-000000000002', restriction: 'build', credits_issued: 20, credits_remaining: 0, issued_at: day(30), expires_at: day(-60), revoked: true, reason: 'Test', granted_by: 'admin@coden.fun' },
      ],
      activity: [
        { at: day(0), kind: 'login', label: 'Dernière connexion', detail: '' },
        { at: day(1), kind: 'run', label: 'Run build_app · completed', detail: models[0] },
        { at: day(3), kind: 'project', label: 'Projet créé · Boutique Awa', detail: 'draft' },
        { at: day(5), kind: 'run', label: 'Run edit_app · failed', detail: 'PREVIEW_BROWSER_CHECK_FAILED' },
      ],
    };
  }
  return { success: true, local_preview: true, rows: [], users: [], projects: [], deployments: [], domains: [], findings: [], checklist: [], ...(payloads[section] || {}) };
}
