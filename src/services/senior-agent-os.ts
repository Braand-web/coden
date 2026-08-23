import { redactSecrets } from './secret-redaction.ts';
import { architectPromptContext, compileArchitectBlueprint, type ArchitectBlueprint } from './architect-blueprint.ts';
import { inferProductionBlueprint } from './production-blueprints.ts';

export type SeniorAgentFile = {
  path: string;
  content: string;
  language?: string;
  updated_at?: string;
};

export type SeniorAgentDecisionLike = {
  intent?: string;
  confidence?: number;
  requiresFileChanges?: boolean;
  requiresPreviewRebuild?: boolean;
  autoPlanRequired?: boolean;
  requestedMode?: string;
};

export type SeniorAgentImportLike = {
  source?: string;
  mode?: string;
  status?: string;
  source_url?: string;
  file_name?: string;
};

export type SeniorAgentProjectIndex = {
  file_count: number;
  routes: string[];
  components: string[];
  api_endpoints: string[];
  database_tables: string[];
  style_tokens: string[];
  auth_files: string[];
  billing_files: string[];
  deployment_files: string[];
  critical_files: string[];
};

export type SeniorAgentTask = {
  id: string;
  label: string;
  area: 'frontend' | 'backend' | 'database' | 'auth' | 'billing' | 'deploy' | 'design' | 'qa' | 'research' | 'media';
  risk: 'low' | 'medium' | 'high' | 'critical';
  requires_runner: boolean;
};

export type SeniorAgentPolicy = {
  state_machine: string[];
  action_contract: {
    allowed_scopes: string[];
    blocked_scopes: string[];
    requires_confirmation: boolean;
    rollback_required: boolean;
    no_fake_success: boolean;
  };
  risk_score: number;
  confidence_score: number;
  cost_tier: 'free_light' | 'standard' | 'premium';
  recommended_model_policy: 'economy' | 'balanced' | 'premium';
};

export type SeniorAgentBlueprint = {
  platform_type: string;
  required_components: string[];
  required_states: string[];
  functional_checks: string[];
  forbidden_patterns: string[];
};

export type SeniorAgentPlaybook = {
  id: string;
  title: string;
  steps: string[];
  checks: string[];
};

export type SeniorAgentContext = {
  version: 'senior-agent-os-v1';
  operation: string;
  project_index: SeniorAgentProjectIndex;
  task_decomposition: SeniorAgentTask[];
  architect_blueprint: ArchitectBlueprint;
  blueprint: SeniorAgentBlueprint;
  playbooks: SeniorAgentPlaybook[];
  policy: SeniorAgentPolicy;
  prompt_normalization: {
    user_goal: string;
    inferred_scope: string;
    imported_source?: string;
  };
};

const KNOWN_FAILURES = [
  {
    signature: 'SUPABASE_AUTH_CLIENT_UNDEFINED',
    root_cause: 'Generated code calls supabase.auth without an initialized browser-safe Supabase client.',
    fix_strategy: 'Create or import src/lib/supabase.ts and use a Coden Cloud-safe auth fallback in preview.',
  },
  {
    signature: 'REACT_BLANK_SCREEN',
    root_cause: 'The app renders no visible content or crashes during preview bootstrap.',
    fix_strategy: 'Check imports, root mounting, route guards, and runtime exceptions before declaring preview ready.',
  },
  {
    signature: 'BUILD_IMPORT_MISSING',
    root_cause: 'A generated file imports a dependency, component, or helper that does not exist.',
    fix_strategy: 'Add the missing file/dependency or replace the import with an existing local implementation.',
  },
];

const SKILL_LIBRARY: SeniorAgentPlaybook[] = [
  {
    id: 'create-saas-dashboard',
    title: 'Create SaaS dashboard',
    steps: ['Define user role and core metric', 'Create navigation and dashboard shell', 'Add tables/cards/actions', 'Add empty/loading/error states', 'Run preview and interaction checks'],
    checks: ['dashboard_has_primary_action', 'tables_or_cards_are_useful', 'mobile_navigation_usable'],
  },
  {
    id: 'add-auth',
    title: 'Add Coden Cloud Auth',
    steps: ['Detect current auth files', 'Use browser-safe client only', 'Add signed-out and signed-in states', 'Avoid service role in frontend', 'Verify preview does not crash'],
    checks: ['no_service_role_key', 'auth_client_exists', 'signed_out_state_visible'],
  },
  {
    id: 'add-database-crud',
    title: 'Add database CRUD',
    steps: ['Infer entities', 'Create schema or local demo fallback', 'Wire list/create/update/delete UI', 'Add validation and optimistic feedback', 'Run runner checks'],
    checks: ['schema_safe', 'crud_controls_work', 'empty_error_success_states'],
  },
  {
    id: 'improve-design-premium',
    title: 'Improve design quality',
    steps: ['Identify target screen', 'Preserve product logic', 'Improve hierarchy and spacing', 'Add subtle states and motion', 'Check responsive and contrast'],
    checks: ['anti_generic_design', 'contrast_ok', 'mobile_no_overflow'],
  },
  {
    id: 'import-from-github',
    title: 'Import GitHub repository',
    steps: ['Detect framework', 'Index routes/components/scripts', 'Run install/build/lint through runner', 'Preview existing app', 'Patch only requested changes'],
    checks: ['framework_detected', 'build_status_known', 'architecture_preserved'],
  },
  {
    id: 'import-from-visual-source',
    title: 'Import visual source',
    steps: ['Extract visual hierarchy', 'Convert to components', 'Add missing responsive behavior', 'Add real controls or honest placeholders', 'Run visual and functional checks'],
    checks: ['not_static_copy', 'components_editable', 'interactions_completed'],
  },
  {
    id: 'publish-vercel',
    title: 'Publish safely',
    steps: ['Verify build output', 'Deploy immutable live version', 'Persist deployment status', 'Verify public URL/domain', 'Keep preview/live separated'],
    checks: ['deployment_persisted', 'live_url_verified', 'published_version_immutable'],
  },
];

function clean(value: unknown, max = 500) {
  return redactSecrets(String(value || '').replace(/\s+/g, ' ').trim()).slice(0, max);
}

function unique(values: string[], max = 20) {
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

function normalizedPath(file: SeniorAgentFile) {
  return String(file.path || '').replace(/\\/g, '/');
}

function inferRouteFromPath(path: string) {
  if (/^src\/pages\//i.test(path)) return `/${path.replace(/^src\/pages\//i, '').replace(/\.[tj]sx?$/i, '').replace(/index$/i, '')}`.replace(/\/$/, '/') || '/';
  if (/^app\/.*page\.[tj]sx?$/i.test(path)) return `/${path.replace(/^app\//i, '').replace(/\/page\.[tj]sx?$/i, '')}`.replace(/\/$/, '/') || '/';
  if (/src\/App\.[tj]sx?$/i.test(path)) return '/';
  return '';
}

function extractMatches(content: string, pattern: RegExp, group = 1, max = 20) {
  const output: string[] = [];
  for (const match of content.matchAll(pattern)) {
    const value = clean(match[group], 160);
    if (value) output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

export function indexProjectCodebase(files: SeniorAgentFile[]): SeniorAgentProjectIndex {
  const routes: string[] = [];
  const components: string[] = [];
  const apiEndpoints: string[] = [];
  const databaseTables: string[] = [];
  const styleTokens: string[] = [];
  const authFiles: string[] = [];
  const billingFiles: string[] = [];
  const deploymentFiles: string[] = [];
  const criticalFiles: string[] = [];

  for (const file of files || []) {
    const path = normalizedPath(file);
    const content = String(file.content || '');
    const route = inferRouteFromPath(path);
    if (route) routes.push(route);
    if (/\/components\/|Component|\.tsx$/i.test(path)) components.push(path);
    apiEndpoints.push(...extractMatches(content, /(?:fetch|apiFetch)\(\s*['"`]([^'"`]*\/api\/[^'"`]+)['"`]/g));
    apiEndpoints.push(...extractMatches(content, /app\.(?:get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g));
    databaseTables.push(...extractMatches(content, /(?:from|table)\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*\)/g));
    databaseTables.push(...extractMatches(content, /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z0-9_."]+)/gi));
    styleTokens.push(...extractMatches(content, /--([a-zA-Z0-9-]+)\s*:/g));
    if (/auth|supabase|session|login|sign-?in/i.test(path) || /supabase\.auth|signInWith|onAuthStateChange/i.test(content)) authFiles.push(path);
    if (/billing|stripe|checkout|pricing|subscription|credit/i.test(path) || /stripe|checkout|subscription|credits?/i.test(content)) billingFiles.push(path);
    if (/vercel|deploy|domain|publish|railway|netlify/i.test(path) || /deployment|custom domain|publish/i.test(content)) deploymentFiles.push(path);
    if (/package\.json|vite\.config|server\.ts|src\/App|src\/main|schema\.sql|auth|billing|deploy/i.test(path)) criticalFiles.push(path);
  }

  return {
    file_count: files.length,
    routes: unique(routes, 30),
    components: unique(components, 30),
    api_endpoints: unique(apiEndpoints, 30),
    database_tables: unique(databaseTables, 30),
    style_tokens: unique(styleTokens, 40),
    auth_files: unique(authFiles, 20),
    billing_files: unique(billingFiles, 20),
    deployment_files: unique(deploymentFiles, 20),
    critical_files: unique(criticalFiles, 24),
  };
}

function addTask(tasks: SeniorAgentTask[], task: SeniorAgentTask) {
  if (!tasks.some(item => item.id === task.id)) tasks.push(task);
}

export function decomposeAgentTask(input: { prompt: string; decision?: SeniorAgentDecisionLike; importContext?: SeniorAgentImportLike }): SeniorAgentTask[] {
  const prompt = clean(input.prompt, 1600).toLowerCase();
  const tasks: SeniorAgentTask[] = [];
  const intent = String(input.decision?.intent || '').toLowerCase();
  const importSource = String(input.importContext?.source || '').toLowerCase();

  if (intent === 'conversation' || intent === 'clarification_required') {
    addTask(tasks, { id: 'answer-user', label: 'Answer without touching files', area: 'qa', risk: 'low', requires_runner: false });
    return tasks;
  }
  if (importSource === 'github') addTask(tasks, { id: 'import-github', label: 'Import and index existing repository', area: 'research', risk: 'high', requires_runner: true });
  if (importSource === 'figma' || importSource === 'image' || importSource === 'url') addTask(tasks, { id: 'import-visual-source', label: 'Convert source into responsive editable product', area: 'design', risk: 'medium', requires_runner: true });
  if (/auth|login|sign ?in|signup|session|oauth|google/i.test(prompt)) addTask(tasks, { id: 'auth', label: 'Design safe authentication flow', area: 'auth', risk: 'critical', requires_runner: true });
  if (/database|supabase|crud|table|storage|record|save|persist/i.test(prompt)) addTask(tasks, { id: 'database', label: 'Create or preserve data model and CRUD flow', area: 'database', risk: 'high', requires_runner: true });
  if (/billing|stripe|payment|checkout|subscription|pricing|credit|top-?up/i.test(prompt)) addTask(tasks, { id: 'billing', label: 'Protect billing and credit logic', area: 'billing', risk: 'critical', requires_runner: true });
  if (/deploy|publish|vercel|domain|dns|ssl|railway/i.test(prompt)) addTask(tasks, { id: 'deploy', label: 'Verify deploy and domain workflow', area: 'deploy', risk: 'high', requires_runner: true });
  if (/dashboard|crm|admin|analytics|table|chart|report/i.test(prompt)) addTask(tasks, { id: 'dashboard', label: 'Build useful operational screens', area: 'frontend', risk: 'medium', requires_runner: true });
  if (/design|premium|ui|ux|responsive|mobile|style|color|spacing|layout|animation/i.test(prompt)) addTask(tasks, { id: 'design-quality', label: 'Improve visual quality and responsive behavior', area: 'design', risk: 'medium', requires_runner: true });
  if (/bug|error|broken|crash|blank|doesn.t work|ne fonctionne|erreur|cass/i.test(prompt) || intent === 'debug_fix') addTask(tasks, { id: 'debug-fix', label: 'Interpret error and apply targeted fix', area: 'qa', risk: 'high', requires_runner: true });
  if (/app|build|create|generate|component|page|feature|workflow|tool/i.test(prompt) || intent === 'build' || intent === 'edit') addTask(tasks, { id: 'frontend-build', label: 'Create or patch product UI and interactions', area: 'frontend', risk: 'medium', requires_runner: true });
  if (!tasks.length) addTask(tasks, { id: 'understand-and-respond', label: 'Understand user goal and respond directly', area: 'qa', risk: 'low', requires_runner: false });
  return tasks.slice(0, 10);
}

export function inferProductBlueprint(prompt: string): SeniorAgentBlueprint {
  const text = clean(prompt, 1600).toLowerCase();
  const production = inferProductionBlueprint(text);
  const productionPlatformMap: Record<string, string> = {
    admin_dashboard: 'dashboard',
    internal_tool: 'dashboard',
    blog_cms: 'cms',
    ecommerce: 'ecommerce',
    ai_tool: 'ai_tool',
  };
  const platformFromProduction = productionPlatformMap[production.type] || production.type;
  if (production.type !== 'saas' || /\b(saas|app|dashboard|marketplace|crm|booking|e-?commerce|cms|blog|internal tool|ai tool)\b/i.test(text)) {
    return {
      platform_type: platformFromProduction,
      required_components: unique(production.components, 16),
      required_states: unique([...production.frontend.requiredStates, 'loading', 'empty', 'error', 'success'], 16),
      functional_checks: unique(production.tests, 16),
      forbidden_patterns: unique([
        'dead primary buttons',
        'fake connected backend without honest fallback',
        'beautiful but non-functional UI',
        'localStorage as production persistence for private data',
        'table without RLS',
      ], 12),
    };
  }
  const match = (type: string, re: RegExp) => re.test(text) ? type : '';
  const platformType =
    match('crm', /crm|client|pipeline|deal|lead/) ||
    match('ecommerce', /e-?commerce|shop|product|cart|checkout|store/) ||
    match('marketplace', /marketplace|seller|buyer|listing/) ||
    match('restaurant', /restaurant|menu|reservation|booking|local business/) ||
    match('fintech', /fintech|invoice|payment|finance|wallet/) ||
    match('ai_tool', /ai tool|chatbot|builder|prompt|agent/) ||
    match('portfolio', /portfolio|agency|case stud/) ||
    match('dashboard', /dashboard|admin|analytics|report/) ||
    match('mobile_pwa', /mobile|pwa|app store|reels|tiktok/) ||
    'saas';

  const defaults: Record<string, SeniorAgentBlueprint> = {
    crm: {
      platform_type: 'crm',
      required_components: ['sidebar', 'search', 'client table', 'pipeline/status board', 'details panel', 'settings'],
      required_states: ['empty clients', 'loading table', 'form validation', 'success toast', 'delete confirmation'],
      functional_checks: ['create client works locally', 'search filters clients', 'status changes are visible'],
      forbidden_patterns: ['landing-page-only CRM', 'fake dashboard with no actions'],
    },
    ecommerce: {
      platform_type: 'ecommerce',
      required_components: ['catalog', 'filters', 'product cards', 'cart', 'checkout feedback', 'order confirmation'],
      required_states: ['empty cart', 'out of stock', 'variant selected', 'coupon error', 'success confirmation'],
      functional_checks: ['add to cart mutates state', 'filters change products', 'checkout has honest demo state'],
      forbidden_patterns: ['buttons without cart state', 'fake payment claim'],
    },
    marketplace: {
      platform_type: 'marketplace',
      required_components: ['search', 'filters', 'listings', 'seller trust', 'favorites', 'inquiry/checkout'],
      required_states: ['no results', 'saved listing', 'loading listings', 'filter active'],
      functional_checks: ['search filters listings', 'favorites persist locally', 'contact action gives feedback'],
      forbidden_patterns: ['static listing grid only'],
    },
    restaurant: {
      platform_type: 'restaurant',
      required_components: ['menu', 'reservation form', 'hours', 'location', 'reviews', 'contact actions'],
      required_states: ['reservation validation', 'closed/open state', 'success confirmation'],
      functional_checks: ['reservation form validates', 'menu categories switch', 'contact links are clear'],
      forbidden_patterns: ['generic hero without menu/reservation'],
    },
    fintech: {
      platform_type: 'fintech',
      required_components: ['balance summary', 'transactions table', 'secure actions', 'confirmations', 'audit trail'],
      required_states: ['empty transactions', 'pending action', 'error state', 'success confirmation'],
      functional_checks: ['numbers align', 'destructive action requires confirmation', 'trust copy is sober'],
      forbidden_patterns: ['playful unsafe finance UI'],
    },
    ai_tool: {
      platform_type: 'ai_tool',
      required_components: ['prompt input', 'results/history', 'settings', 'stream/status', 'usage/limits'],
      required_states: ['thinking', 'empty history', 'error', 'result ready'],
      functional_checks: ['submit adds result state', 'history updates', 'settings are visible'],
      forbidden_patterns: ['fake streaming with no result persistence'],
    },
    portfolio: {
      platform_type: 'portfolio',
      required_components: ['hero', 'project gallery', 'case studies', 'about', 'contact'],
      required_states: ['filter active', 'project modal/detail', 'contact validation'],
      functional_checks: ['project detail opens', 'contact form validates', 'responsive gallery works'],
      forbidden_patterns: ['generic SaaS dashboard layout'],
    },
    dashboard: {
      platform_type: 'dashboard',
      required_components: ['sidebar', 'metrics', 'table/list', 'filters', 'detail panel', 'settings'],
      required_states: ['empty table', 'loading chart', 'filter active', 'error banner'],
      functional_checks: ['tabs/filters switch data', 'table actions give feedback', 'mobile nav remains usable'],
      forbidden_patterns: ['marketing landing instead of operational dashboard'],
    },
    mobile_pwa: {
      platform_type: 'mobile_pwa',
      required_components: ['touch-first layout', 'bottom nav', 'compact cards', 'gesture-safe spacing', 'offline/empty state'],
      required_states: ['active tab', 'loading', 'empty', 'success feedback'],
      functional_checks: ['thumb-zone controls usable', 'mobile width no overflow', 'nav switches content'],
      forbidden_patterns: ['desktop compressed into phone'],
    },
    saas: {
      platform_type: 'saas',
      required_components: ['hero or workspace shell', 'primary CTA', 'feature proof', 'pricing or upgrade path', 'settings/usage when needed'],
      required_states: ['loading', 'empty', 'error', 'success', 'disabled'],
      functional_checks: ['primary CTA works', 'forms validate', 'responsive layout holds'],
      forbidden_patterns: ['three generic cards only', 'oversized empty hero with no product surface'],
    },
  };
  const selected = defaults[platformType] || defaults.saas;
  return {
    ...selected,
    required_states: unique([
      ...selected.required_states,
      'loading',
      'empty',
      'error',
      'success',
    ], 16),
    forbidden_patterns: unique([
      ...selected.forbidden_patterns,
      'dead primary buttons',
      'fake connected backend without honest fallback',
      'beautiful but non-functional UI',
    ], 12),
  };
}

function selectPlaybooks(tasks: SeniorAgentTask[], blueprint: SeniorAgentBlueprint, importContext?: SeniorAgentImportLike) {
  const ids = new Set<string>();
  if (tasks.some(task => task.id === 'auth')) ids.add('add-auth');
  if (tasks.some(task => task.id === 'database')) ids.add('add-database-crud');
  if (tasks.some(task => task.id === 'deploy')) ids.add('publish-vercel');
  if (tasks.some(task => task.id === 'design-quality' || task.id === 'import-visual-source')) ids.add('improve-design-premium');
  if (tasks.some(task => task.id === 'import-github') || importContext?.source === 'github') ids.add('import-from-github');
  if (tasks.some(task => task.id === 'import-visual-source') || ['figma', 'image', 'url'].includes(String(importContext?.source || ''))) ids.add('import-from-visual-source');
  if (blueprint.platform_type === 'dashboard' || blueprint.platform_type === 'crm') ids.add('create-saas-dashboard');
  if (!ids.size) ids.add('improve-design-premium');
  return SKILL_LIBRARY.filter(skill => ids.has(skill.id)).slice(0, 5);
}

function buildStateMachine(tasks: SeniorAgentTask[], decision?: SeniorAgentDecisionLike) {
  if (decision?.intent === 'conversation' || !tasks.some(task => task.requires_runner)) {
    return ['idle', 'understanding', 'answering', 'waiting_user_feedback'];
  }
  const states = ['idle', 'understanding'];
  if (decision?.autoPlanRequired || tasks.some(task => ['high', 'critical'].includes(task.risk))) states.push('planning');
  if (tasks.some(task => task.id.includes('import'))) states.push('reading_source');
  states.push('reading_files', 'editing', 'building', 'testing');
  if (tasks.some(task => ['high', 'critical'].includes(task.risk))) states.push('fixing', 'retesting');
  states.push('preview_ready', 'waiting_user_feedback');
  return unique(states, 12);
}

export function evaluateSeniorPolicy(input: {
  prompt: string;
  decision?: SeniorAgentDecisionLike;
  tasks: SeniorAgentTask[];
  projectIndex: SeniorAgentProjectIndex;
}): SeniorAgentPolicy {
  const prompt = clean(input.prompt, 1600).toLowerCase();
  const maxRisk = input.tasks.some(task => task.risk === 'critical') ? 'critical'
    : input.tasks.some(task => task.risk === 'high') ? 'high'
      : input.tasks.some(task => task.risk === 'medium') ? 'medium'
        : 'low';
  const riskScore = maxRisk === 'critical' ? 95 : maxRisk === 'high' ? 78 : maxRisk === 'medium' ? 48 : 18;
  const destructive = /delete|drop table|remove database|disable rls|expose key|service role|supprimer|effacer/i.test(prompt);
  const hasExistingCriticalFiles = input.projectIndex.critical_files.length > 0;
  const confidenceBase = Number(input.decision?.confidence || 0.74);
  const confidencePenalty = maxRisk === 'critical' ? 0.18 : maxRisk === 'high' ? 0.1 : 0;
  const confidenceScore = Math.max(35, Math.min(98, Math.round((confidenceBase - confidencePenalty) * 100)));
  return {
    state_machine: buildStateMachine(input.tasks, input.decision),
    action_contract: {
      allowed_scopes: allowedScopesForTasks(input.tasks),
      blocked_scopes: destructive ? ['secrets', 'service_role', 'rls_disable', 'unconfirmed_destructive_database_change'] : ['secrets', 'service_role', 'provider_costs'],
      requires_confirmation: destructive || riskScore >= 92,
      rollback_required: Boolean(input.decision?.requiresFileChanges || hasExistingCriticalFiles),
      no_fake_success: true,
    },
    risk_score: riskScore,
    confidence_score: confidenceScore,
    cost_tier: riskScore >= 78 ? 'premium' : riskScore >= 42 ? 'standard' : 'free_light',
    recommended_model_policy: riskScore >= 78 ? 'premium' : riskScore >= 42 ? 'balanced' : 'economy',
  };
}

function allowedScopesForTasks(tasks: SeniorAgentTask[]) {
  const scopes = new Set<string>();
  for (const task of tasks) {
    if (task.area === 'frontend' || task.area === 'design') scopes.add('frontend_files');
    if (task.area === 'database') scopes.add('supabase_schema');
    if (task.area === 'auth') scopes.add('auth_ui_and_safe_client');
    if (task.area === 'billing') scopes.add('billing_ui_and_server_routes');
    if (task.area === 'deploy') scopes.add('deployment_metadata');
    if (task.area === 'qa') scopes.add('tests_and_preview_checks');
    if (task.area === 'research') scopes.add('source_analysis');
  }
  return Array.from(scopes.size ? scopes : new Set(['answer_only']));
}

export function compileSeniorAgentContext(input: {
  prompt: string;
  project?: Record<string, any>;
  files: SeniorAgentFile[];
  decision?: SeniorAgentDecisionLike;
  importContext?: SeniorAgentImportLike;
}): SeniorAgentContext {
  const projectIndex = indexProjectCodebase(input.files || []);
  const tasks = decomposeAgentTask({
    prompt: input.prompt,
    decision: input.decision,
    importContext: input.importContext,
  });
  const blueprint = inferProductBlueprint(input.prompt);
  const architectBlueprint = compileArchitectBlueprint({
    prompt: input.prompt,
    files: input.files || [],
    decision: input.decision,
    projectIndex,
    importContext: input.importContext,
  });
  const policy = evaluateSeniorPolicy({ prompt: input.prompt, decision: input.decision, tasks, projectIndex });
  const playbooks = selectPlaybooks(tasks, blueprint, input.importContext);

  return {
    version: 'senior-agent-os-v1',
    operation: String(input.decision?.intent || 'auto'),
    project_index: projectIndex,
    task_decomposition: tasks,
    architect_blueprint: architectBlueprint,
    blueprint,
    playbooks,
    policy,
    prompt_normalization: {
      user_goal: clean(input.prompt, 320),
      inferred_scope: tasks.map(task => task.label).join(' -> '),
      imported_source: input.importContext?.source ? String(input.importContext.source) : undefined,
    },
  };
}

export function seniorAgentPromptContext(context: SeniorAgentContext) {
  return [
    'Senior Agent OS context:',
    JSON.stringify({
      version: context.version,
      operation: context.operation,
      task_decomposition: context.task_decomposition,
      project_index: context.project_index,
      blueprint: context.blueprint,
      playbooks: context.playbooks.map(playbook => ({
        id: playbook.id,
        title: playbook.title,
        steps: playbook.steps,
        checks: playbook.checks,
      })),
      policy: context.policy,
      architect_summary: {
        version: context.architect_blueprint.version,
        archetype: context.architect_blueprint.archetype,
        stage: context.architect_blueprint.discovery.product_stage,
        missing_questions: context.architect_blueprint.discovery.missing_questions,
        quality_gates: context.architect_blueprint.quality_gates,
      },
      known_failure_memory: KNOWN_FAILURES,
      rule: 'No fake success: do not say ready unless the build/preview/checks are truly acceptable or the blocker is clearly reported.',
    }),
    architectPromptContext(context.architect_blueprint),
  ].join('\n');
}

export function applySeniorAgentContextToPrompt(prompt: string, context: SeniorAgentContext) {
  return `${prompt}\n\n${seniorAgentPromptContext(context)}`;
}
