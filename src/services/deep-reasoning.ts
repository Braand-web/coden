import { normalizeExecutionText, type ExecutionContract } from './execution-contract.ts';

export type DeepReasoningStageKey =
  | 'intent'
  | 'context'
  | 'planner'
  | 'architect'
  | 'security_audit'
  | 'ux_audit'
  | 'execution'
  | 'verification'
  | 'critic'
  | 'recovery'
  | 'delivery';

export type DeepReasoningContract = {
  version: 'coden-deep-reasoning-v2';
  language: 'fr' | 'en' | 'auto';
  user_goal: string;
  intent: string;
  app_type: string;
  context_builder: {
    project_name: string;
    file_count: number;
    critical_files: string[];
    recent_blockers: string[];
    assumptions: string[];
  };
  planner: {
    invisible: true;
    stages: Array<{
      key: DeepReasoningStageKey;
      objective: string;
      output: string;
      user_visible: boolean;
    }>;
  };
  model_workflow: {
    reasoning: boolean;
    structured_output: boolean;
    tool_loop: boolean;
    long_context: boolean;
    vision: boolean;
    streaming: boolean;
  };
  quality_critic: {
    checks: string[];
    no_fake_success: string[];
  };
  communication: {
    user_language: 'fr' | 'en' | 'auto';
    max_public_sentences: number;
    show_internal_reasoning: false;
  };
  architecture_critic: {
    max_component_depth: number;
    max_file_count: number;
    separation_of_concerns: boolean;
    patterns: string[];
  };
  interaction_simulator: {
    test_scenarios: string[];
    edge_cases: string[];
    expected_user_flows: string[];
  };
  recovery_diagnostics: {
    known_failure_modes: string[];
    auto_repair_strategies: string[];
    escalation_threshold: number;
    max_retry_cycles: number;
  };
};

type DeepReasoningInput = {
  prompt: string;
  projectName?: string;
  files?: Array<{ path: string; content?: string }>;
  decision?: {
    intent?: string;
    requiresFileChanges?: boolean;
    requiresPreviewRebuild?: boolean;
    autoPlanRequired?: boolean;
  } | null;
  executionContract?: ExecutionContract | null;
  recentHistory?: string[];
  previousBlockers?: string[];
};

const CRITICAL_FILE_PATTERNS = [
  /^package\.json$/i,
  /^index\.html$/i,
  /^vite\.config\./i,
  /^src\/main\.(t|j)sx?$/i,
  /^src\/App\.(t|j)sx?$/i,
  /^src\/lib\/(supabase|codenCloud|api|auth)/i,
  /^supabase\/schema\.sql$/i,
  /^server\.(t|j)s$/i,
  /stripe|billing|payment|checkout|webhook/i,
  /auth|session|login|signup|rls|policy/i,
];

function compactText(value: string, max = 260) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items.filter(Boolean)));
}

function detectLanguage(prompt: string): 'fr' | 'en' | 'auto' {
  const normalized = normalizeExecutionText(prompt);
  if (/\b(je|tu|vous|nous|mon|ma|mes|avec|pour|corrige|cree|creer|genere|generer|application|tache|supprime|ajoute|ameliore|bonjour|merci)\b/i.test(normalized)) {
    return 'fr';
  }
  if (/\b(create|build|fix|make|add|remove|explain|hello|thanks|application|website|dashboard|todo)\b/i.test(normalized)) {
    return 'en';
  }
  return 'auto';
}

function inferAppType(prompt: string) {
  const text = normalizeExecutionText(prompt);
  const matches: Array<[string, RegExp]> = [
    ['todo_task_app', /\b(todo|to do|to-do|task|tache|taches)\b/i],
    ['pomodoro_timer', /\b(pomodoro|pomodero|timer|minuteur|chrono|focus|pause courte|pause longue)\b/i],
    ['saas_dashboard', /\b(saas|dashboard|analytics|workspace|billing|subscription)\b/i],
    ['marketplace', /\b(marketplace|vendeur|seller|products|orders|catalogue)\b/i],
    ['ecommerce', /\b(ecommerce|e-commerce|shop|cart|checkout|panier|produit)\b/i],
    ['booking_app', /\b(booking|reservation|rendez-vous|appointment|calendar)\b/i],
    ['crm', /\b(crm|lead|pipeline|contact|deal)\b/i],
    ['ai_tool', /\b(ai tool|outil ia|chatbot|prompt|generateur|generator)\b/i],
    ['media_marketing', /\b(video|image|ugc|ads|pub|storyboard|thumbnail|media)\b/i],
    ['portfolio_or_landing', /\b(portfolio|landing|homepage|hero|agency|agence)\b/i],
    ['social_platform', /\b(social|reseau social|timeline|feed|followers?|following|posts?|likes?|share|partage)\b/i],
    ['project_management', /\b(project management|gestion de projet|kanban|sprint|backlog|roadmap|milestone|epic)\b/i],
    ['education_platform', /\b(education|cours|course|learning|lms|quiz|student|teacher|classroom|module)\b/i],
    ['healthcare_app', /\b(healthcare|sante|medical|patient|doctor|appointment|prescription|clinic)\b/i],
    ['real_estate', /\b(real estate|immobilier|property|listing|rent|location|tenant|landlord|apartment)\b/i],
    ['inventory_system', /\b(inventory|stock|warehouse|supply chain|entrepot|gestion de stock|sku)\b/i],
    ['analytics_dashboard', /\b(analytics|metrics|kpi|reporting|chart|graph|insight|data viz|visualization)\b/i],
    ['communication_tool', /\b(chat|messaging|messagerie|notification|inbox|email|sms|communication)\b/i],
  ];
  return matches.find(([, pattern]) => pattern.test(text))?.[0] || 'custom_web_app';
}

function inferRecentBlockers(input: DeepReasoningInput) {
  const corpus = [
    input.prompt,
    ...(input.recentHistory || []),
    ...(input.previousBlockers || []),
  ].join('\n');
  const text = normalizeExecutionText(corpus);
  const blockers: string[] = [];
  if (/forced runtime failure marker|crash force|marker|__coden_force_error__/i.test(text)) {
    blockers.push('forced_runtime_failure_marker');
  }
  if (/preview blanche|white screen|blank preview|preview ne s affiche pas|screen blanc/i.test(text)) {
    blockers.push('blank_preview');
  }
  if (/index\.html|main\.tsx|app\.tsx|entrypoint|root div/i.test(corpus)) {
    blockers.push('vite_entrypoint_or_root');
  }
  if (/cannot read properties|undefined|import|module not found|missing import/i.test(corpus)) {
    blockers.push('runtime_or_import_error');
  }
  if (/auth_session|session|login|google oauth|supabase\.auth/i.test(text)) {
    blockers.push('auth_session_or_client');
  }
  if (/publish|vercel|deploy|live url|ecran blanc en ligne/i.test(text)) {
    blockers.push('publish_or_live_preview');
  }
  if (/\b(blocage restant|points bloquants|blocking issue|blocker|needs fix|draft recuperable|recoverable draft)\b/i.test(text)) {
    blockers.push('recoverable_draft_blocker');
  }
  if (/cors|cross origin|access-control|blocked by cors/i.test(text)) {
    blockers.push('cors_or_cross_origin');
  }
  if (/type error|type.*mismatch|incompatible types|generic.*type|extends.*type/i.test(corpus)) {
    blockers.push('typescript_type_error');
  }
  if (/hydration|ssr|server side|next.*error|remix.*error/i.test(text)) {
    blockers.push('ssr_hydration_error');
  }
  if (/layout shift|cls|cumulative layout|flickering|flash|fout/i.test(text)) {
    blockers.push('layout_shift_or_flicker');
  }
  if (/memory leak|out of memory|heap|gc|garbage collect/i.test(text)) {
    blockers.push('memory_or_performance');
  }
  if (/websocket|socket|realtime|real-time|disconnect|reconnect/i.test(text)) {
    blockers.push('websocket_or_realtime');
  }
  if (/migration|schema.*change|alter table|column.*missing|relation.*not exist/i.test(text)) {
    blockers.push('database_migration_error');
  }
  return unique(blockers).slice(0, 12);
}

function criticalFiles(files: Array<{ path: string; content?: string }> = []) {
  return files
    .map(file => file.path)
    .filter(filePath => CRITICAL_FILE_PATTERNS.some(pattern => pattern.test(filePath)))
    .slice(0, 16);
}

function inferAssumptions(input: DeepReasoningInput) {
  const text = normalizeExecutionText(input.prompt);
  const assumptions: string[] = [];
  if (input.executionContract?.mode === 'build' || input.decision?.intent === 'build') {
    assumptions.push('Use React, TypeScript, Vite and Tailwind unless the user explicitly asks for a simpler static page.');
  }
  if (/\b(localstorage|stockage local|browser storage)\b/i.test(text)) {
    assumptions.push('Use browser localStorage honestly for local persistence and keep the UI resilient if stored data is malformed.');
  }
  if (/\b(auth|login|database|supabase|stripe|payment|paiement)\b/i.test(text)) {
    assumptions.push('Keep secrets server-side and generate explicit backend/auth contracts instead of pretending production services are connected.');
  }
  if (/\b(api|endpoint|route|backend|server|express|fastify)\b/i.test(text)) {
    assumptions.push('Keep API routes RESTful with proper HTTP methods, status codes, and error responses. Use middleware for auth, validation, and rate limiting.');
  }
  if (/\b(real-?time|live|websocket|socket|subscription|presence)\b/i.test(text)) {
    assumptions.push('Use Supabase Realtime or WebSocket for live features. Implement reconnection logic and optimistic UI updates for latency tolerance.');
  }
  if (/\b(test|testing|spec|unit test|e2e|integration test|jest|vitest|cypress)\b/i.test(text)) {
    assumptions.push('Include meaningful test coverage for critical paths. Prefer integration tests over unit tests for business logic. Mock external services.');
  }
  if (/\b(mobile|responsive|tablet|ios|android|pwa|native)\b/i.test(text)) {
    assumptions.push('Design mobile-first with touch-friendly targets (min 44px), responsive breakpoints, and progressive enhancement for offline capability.');
  }
  if (/\b(performance|fast|optimize|speed|cache|lazy|bundle)\b/i.test(text)) {
    assumptions.push('Apply code splitting, lazy loading, image optimization, and caching strategies. Measure with Lighthouse and keep LCP under 2.5s.');
  }
  if (!assumptions.length) {
    assumptions.push('Prefer the smallest complete implementation that makes the requested product usable.');
  }
  return assumptions;
}

function stage(key: DeepReasoningStageKey, objective: string, output: string, user_visible = false) {
  return { key, objective, output, user_visible };
}

export function buildDeepReasoningContract(input: DeepReasoningInput): DeepReasoningContract {
  const execution = input.executionContract;
  const intent = execution?.mode || input.decision?.intent || 'auto';
  const language = detectLanguage(input.prompt);
  const canMutate = Boolean(execution?.can_mutate_files || input.decision?.requiresFileChanges);
  const shouldVerify = Boolean(execution?.requires_runner || input.decision?.requiresPreviewRebuild || canMutate);
  const recentBlockers = inferRecentBlockers(input);
  const workflow = execution?.model_workflow;
  const fileCount = input.files?.length || 0;
  const appType = inferAppType(input.prompt);

  return {
    version: 'coden-deep-reasoning-v2',
    language,
    user_goal: compactText(input.prompt, 340),
    intent,
    app_type: appType,
    context_builder: {
      project_name: compactText(input.projectName || 'Untitled Coden project', 120),
      file_count: fileCount,
      critical_files: criticalFiles(input.files),
      recent_blockers: recentBlockers,
      assumptions: inferAssumptions(input),
    },
    planner: {
      invisible: true,
      stages: [
        stage('intent', 'Classify whether the user wants conversation, planning, build, edit, debug, verify or a critical action.', 'A typed execution contract decides whether file mutation is allowed.'),
        stage('context', 'Read only the project context needed for the current request.', 'Use critical files, recent blockers, current preview state and recent history without flooding the model.'),
        stage('planner', 'Create a short internal JSON plan before file work when the task mutates the project.', 'Plan target files, risks, checks and fallback. Never print this plan as the final answer.', false),
        stage('architect', 'Evaluate architecture: component depth, separation of concerns, state management patterns, and data flow.', 'Ensure no god component, no prop drilling beyond 2 levels, and clean data boundaries between features.', true),
        stage('security_audit', 'Audit for OWASP Top 10, XSS, CSRF, injection, secrets exposure, and insecure defaults.', 'Flag any client-side secret, unvalidated input, or missing auth guard before code generation.', true),
        stage('ux_audit', 'Validate accessibility (WCAG 2.1 AA), responsive design, loading states, error states, and empty states.', 'Every interactive element must have focus indicators, aria labels, and keyboard navigation support.', false),
        stage('execution', 'Generate or patch the smallest complete set of files for the product requested.', 'The app must be general-purpose, not limited to a template list, and must satisfy the prompt features.', true),
        stage('verification', 'Verify rendering, build structure, interactions, persistence and safety before saying ready.', shouldVerify ? 'Run available preview/runner/browser checks and use their findings.' : 'Skip heavy checks for simple conversation.'),
        stage('critic', 'Critique the result against the user goal and known blockers.', 'Reject fake success, broken previews, raw JSON, code dumped into chat and dead controls.'),
        stage('recovery', 'If blocked, repair and retest; if still blocked, save a recoverable draft with one clear cause.', recentBlockers.length ? `Prioritize known blockers: ${recentBlockers.join(', ')}.` : 'Use auto-fix and retest before asking the user for missing information.'),
        stage('delivery', 'Return a concise user-facing result in the user language.', 'Mention the result, important checks, and next action. Hide internal reasoning, model/provider details and raw contracts.'),
      ],
    },
    model_workflow: {
      reasoning: workflow?.reasoning ?? true,
      structured_output: workflow?.structured_output ?? canMutate,
      tool_loop: workflow?.tool_calling ?? canMutate,
      long_context: workflow?.long_context ?? Boolean(fileCount > 12),
      vision: workflow?.vision ?? false,
      streaming: workflow?.streaming ?? canMutate,
    },
    quality_critic: {
      checks: [
        'The generated app renders with index.html, src/main.tsx, src/App.tsx and a root element when using React/Vite.',
        'Primary buttons, forms, filters, timers, tabs, carts or navigation visibly update state when present.',
        'Persistence is honest: localStorage works locally; database persistence includes schema/RLS/auth guards when requested.',
        'No raw JSON, model chatter, hidden prompts, provider details or code blocks should appear as the final user answer.',
        'If preview/build/browser checks fail, fix and retest before claiming ready.',
      ],
      no_fake_success: [
        'No preview_ready without a real preview-ready event or successful preview pipeline.',
        'No production-ready claim without build/check/security evidence.',
        'No publish success unless Vercel deployment and Supabase persistence both succeeded.',
        'No recoverable draft message repeated twice.',
      ],
    },
    communication: {
      user_language: language,
      max_public_sentences: canMutate ? 5 : 3,
      show_internal_reasoning: false,
    },
    architecture_critic: {
      max_component_depth: fileCount > 30 ? 4 : 3,
      max_file_count: fileCount > 50 ? 80 : 40,
      separation_of_concerns: true,
      patterns: appType === 'saas_dashboard'
        ? ['feature-based modules', 'shared services layer', 'container/presenter split']
        : appType === 'ecommerce' || appType === 'marketplace'
        ? ['domain-driven layout', 'cart/checkout isolation', 'product catalog module']
        : appType === 'crm'
        ? ['entity-based modules', 'pipeline state machine', 'contact graph isolation']
        : ['component colocation', 'hooks for shared logic', 'flat feature folders'],
    },
    interaction_simulator: {
      test_scenarios: appType === 'todo_task_app'
        ? ['create task', 'complete task', 'delete task', 'filter tasks', 'persist across reload']
        : appType === 'pomodoro_timer'
        ? ['start timer', 'pause timer', 'switch to break', 'view history', 'reset session']
        : appType === 'ecommerce' || appType === 'marketplace'
        ? ['browse products', 'add to cart', 'checkout flow', 'payment confirmation', 'order history']
        : appType === 'booking_app'
        ? ['select date', 'choose time slot', 'confirm booking', 'cancel booking', 'view bookings']
        : appType === 'social_platform'
        ? ['create post', 'like post', 'follow user', 'view feed', 'edit profile']
        : appType === 'project_management'
        ? ['create project', 'add task to board', 'move task between columns', 'assign member', 'view roadmap']
        : appType === 'education_platform'
        ? ['enroll in course', 'watch lesson', 'take quiz', 'view progress', 'submit assignment']
        : appType === 'healthcare_app'
        ? ['book appointment', 'view patient record', 'issue prescription', 'check schedule', 'send notification']
        : ['load app', 'primary action', 'secondary action', 'error recovery', 'data persistence'],
      edge_cases: [
        'empty state on first load',
        'rapid repeated clicks',
        'network timeout or failure',
        'very long text input',
        'concurrent modifications',
      ],
      expected_user_flows: appType === 'pomodoro_timer'
        ? ['start focus session → complete → short break → repeat', 'view history of past sessions']
        : appType === 'ecommerce' || appType === 'marketplace'
        ? ['browse → add to cart → checkout → payment → confirmation', 'search → filter → compare → buy']
        : appType === 'social_platform'
        ? ['sign up → create profile → post content → engage with feed', 'discover users → follow → interact']
        : appType === 'project_management'
        ? ['create project → add tasks → assign → track progress → deliver', 'review board → update status → report']
        : ['open app → perform main task → verify result → close'],
    },
    recovery_diagnostics: {
      known_failure_modes: recentBlockers.length
        ? recentBlockers.map(b => `blocker:${b}`)
        : ['no known failures'],
      auto_repair_strategies: [
        'verify entry point files exist and are correctly linked',
        'check import paths and module resolution',
        'validate environment variables and secrets are not client-exposed',
        'ensure CSS/style imports are present and not circular',
        'confirm state initialization and default values',
        ...(recentBlockers.includes('cors_or_cross_origin') ? ['add CORS headers or proxy configuration'] : []),
        ...(recentBlockers.includes('typescript_type_error') ? ['fix type annotations and generic constraints'] : []),
        ...(recentBlockers.includes('ssr_hydration_error') ? ['wrap client-only code in useEffect or dynamic import'] : []),
        ...(recentBlockers.includes('database_migration_error') ? ['verify schema migrations are applied in order'] : []),
      ],
      escalation_threshold: recentBlockers.length > 3 ? 2 : 3,
      max_retry_cycles: recentBlockers.length > 5 ? 4 : 3,
    },
  };
}

/**
 * Compact serialisation of the reasoning contract — strips verbose fields
 * that add tokens without improving generation quality (full stage list,
 * interaction simulator details, large blocker arrays).
 * This keeps the injected context under ~800 tokens while preserving all
 * decision-critical information.
 */
export function buildCompactReasoningContext(contract: DeepReasoningContract): string {
  const compact = {
    v: 'v2',
    goal: contract.user_goal,
    intent: contract.intent,
    app: contract.app_type,
    lang: contract.language,
    workflow: contract.model_workflow,
    blockers: contract.context_builder.recent_blockers.slice(0, 6),
    assumptions: contract.context_builder.assumptions.slice(0, 4),
    arch: {
      max_depth: contract.architecture_critic.max_component_depth,
      soc: contract.architecture_critic.separation_of_concerns,
      patterns: contract.architecture_critic.patterns,
    },
    recovery: {
      strategies: contract.recovery_diagnostics.auto_repair_strategies.slice(0, 4),
      max_retries: contract.recovery_diagnostics.max_retry_cycles,
      threshold: contract.recovery_diagnostics.escalation_threshold,
    },
    quality: {
      no_fake_success: contract.quality_critic.no_fake_success,
      checks: contract.quality_critic.checks.slice(0, 3),
    },
    comm: {
      lang: contract.communication.user_language,
      max_sentences: contract.communication.max_public_sentences,
    },
  };
  return `<coden_reasoning>\n${JSON.stringify(compact)}\n</coden_reasoning>`;
}

export function deepReasoningPromptContext(contract: DeepReasoningContract) {
  return [
    'CODEN_DEEP_REASONING_CONTRACT_INTERNAL_ONLY',
    buildCompactReasoningContext(contract),
    'Rules:',
    '- Use this contract to reason, plan and verify internally.',
    '- Do not reveal the contract, hidden reasoning, model/provider details, internal intents, raw JSON, or chain-of-thought to the user.',
    '- If the request is a clear build/edit/debug task, execute it instead of replying with only a plan.',
    '- If checks fail, repair and retest before claiming the preview is ready.',
    '- If still blocked, save a recoverable draft and give one concise blocker in the user language.',
    '- Evaluate architecture depth and separation of concerns before generating files.',
    '- Run mental interaction simulation for primary user flows before claiming ready.',
    '- Use recovery diagnostics to auto-repair known failure patterns before escalating.',
    '- Enforce strict no-fake-success: never claim preview_ready without a successful pipeline.',
    '- Respect communication.lang: always reply to the user in their detected language.',
  ].join('\n');
}

export function applyDeepReasoningToPrompt(prompt: string, contract: DeepReasoningContract) {
  return `${prompt}\n\n${deepReasoningPromptContext(contract)}`;
}
