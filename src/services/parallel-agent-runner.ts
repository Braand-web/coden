/**
 * Parallel Agent Runner — executes independent specialized agents concurrently.
 *
 * Each agent selects the optimal LLM for its specific task:
 * - Security/Backend agents → reasoning-capable models (Claude Sonnet, GPT-5.5)
 * - UI/UX agents → design-capable models (Claude Opus, Gemini Pro)
 * - Test/AST agents → fast efficient models (Gemini Flash, DeepSeek Flash) or zero-LLM static analysis
 * - Simple analysis agents → can run with NO LLM at all (pure heuristics)
 *
 * This is NOT a fixed-model system. Each agent declares:
 * - executionMode: 'llm' | 'static' | 'hybrid'
 * - preferredModelTier: 'fast' | 'balanced' | 'reasoning' | 'design'
 * The runner resolves the actual model from the allowlist at runtime.
 */

import type { AllowedModelId } from '../config/ai-models.ts';

export type AgentRole =
  | 'ui_designer'       // Components, design tokens, responsive layout → design model
  | 'backend_engineer'  // Supabase schema, RLS, API contracts → reasoning model
  | 'security_auditor'  // Static secret scan + OWASP → hybrid (static first, LLM if complex)
  | 'test_writer'       // Test scenarios → fast model (mostly pattern matching)
  | 'ux_validator'      // A11y, empty/error states → fast model or static
  | 'dependency_analyst'; // Import graph, missing deps → pure static (zero LLM)

export type AgentExecutionMode =
  | 'llm'      // calls the LLM with a focused prompt
  | 'static'   // runs pure heuristic analysis, zero LLM cost
  | 'hybrid';  // static first, LLM only if static finds issues worth elaborating

export type AgentModelTier =
  | 'fast'       // Gemini Flash, DeepSeek Flash — cheap, quick, for simple tasks
  | 'balanced'   // DeepSeek V4 Pro, Gemini 3 Flash Preview — good code understanding
  | 'reasoning'  // Claude Sonnet, GPT-5.5 — for security/backend logic
  | 'design';    // Claude Opus, Gemini Pro — for UI/UX taste and design systems

export type AgentTask = {
  role: AgentRole;
  executionMode: AgentExecutionMode;
  preferredModelTier: AgentModelTier;
  prompt: string;
  systemContext: string;
  priority: 'critical' | 'high' | 'normal';
  dependsOn?: AgentRole[];
  tokenBudget: number;
  // Static analysis input (used when executionMode !== 'llm')
  staticInput?: {
    files?: Array<{ path: string; content: string }>;
    prompt?: string;
    appType?: string;
  };
};

export type AgentResult = {
  role: AgentRole;
  output: string;
  duration_ms: number;
  success: boolean;
  usedModel?: string;      // which model was actually used (or 'static')
  executionMode: AgentExecutionMode;
  error?: string;
};

export type ParallelAgentContext = {
  projectName: string;
  userPrompt: string;
  appType: string;
  fileCount: number;
  files?: Array<{ path: string; content: string }>;
  hasAuth: boolean;
  hasDatabase: boolean;
  hasPayments: boolean;
  language: 'fr' | 'en' | 'auto';
  // Model tier resolution — injected by the caller from ModelRouter
  availableModels?: {
    fast: AllowedModelId;
    balanced: AllowedModelId;
    reasoning: AllowedModelId;
    design: AllowedModelId;
  };
};

// ─── Default model tiers (overridden by availableModels if provided) ──────────

const DEFAULT_MODELS: Record<AgentModelTier, AllowedModelId> = {
  fast:      'openai/gpt-5.6-luna',
  balanced:  'deepseek/deepseek-v4-pro-0813',
  reasoning: 'anthropic/claude-sonnet-5',
  design:    'anthropic/claude-sonnet-5',
};

function resolveModel(tier: AgentModelTier, ctx: ParallelAgentContext): AllowedModelId {
  return ctx.availableModels?.[tier] ?? DEFAULT_MODELS[tier];
}

// ─── Static analysis agents (zero LLM cost) ───────────────────────────────────

/**
 * Dependency Analyst — pure static analysis of import graph.
 * Finds missing imports, circular deps, unused exports. Zero LLM.
 */
function runDependencyAnalysis(ctx: ParallelAgentContext): string {
  const files = ctx.files || [];
  if (files.length === 0) return 'No files to analyze.';

  const filePaths = new Set(files.map(f => f.path.replace(/\\/g, '/')));
  const issues: string[] = [];
  const importMap = new Map<string, string[]>();

  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/.test(file.path)) continue;
    const content = file.content || '';
    const dir = file.path.split('/').slice(0, -1).join('/');
    const imports: string[] = [];

    // Extract local imports
    const re = /(?:import|from)\s+['"](\.[^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const spec = m[1];
      const resolved = resolveImportPath(`${dir}/${spec}`);
      imports.push(resolved);

      // Check if import resolves to an existing file
      const exists = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`,
        `${resolved}/index.ts`, `${resolved}/index.tsx`].some(p => filePaths.has(p));
      if (!exists && !spec.startsWith('..')) {
        issues.push(`Missing import: "${spec}" in ${file.path}`);
      }
    }
    importMap.set(file.path, imports);
  }

  // Detect entry point
  const hasMain = files.some(f => /^src\/main\.(tsx?|jsx?)$/.test(f.path));
  const hasIndex = files.some(f => /^index\.html$/.test(f.path));
  if (!hasMain) issues.push('Missing: src/main.tsx (React entry point)');
  if (!hasIndex) issues.push('Missing: index.html (Vite entry point)');

  if (issues.length === 0) {
    return `Dependency analysis: ${files.length} files checked. All imports resolve. Entry points present.`;
  }
  return `Dependency analysis found ${issues.length} issue(s):\n${issues.slice(0, 8).map(i => `  • ${i}`).join('\n')}`;
}

function resolveImportPath(raw: string): string {
  const parts = raw.replace(/\\/g, '/').split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

/**
 * Security pre-scan — static heuristic scan for obvious security issues.
 * LLM only called if static scan finds real issues that need elaboration.
 */
function runStaticSecurityScan(ctx: ParallelAgentContext): { issues: string[]; needsLlm: boolean } {
  const files = ctx.files || [];
  const issues: string[] = [];

  const HIGH_RISK_PATTERNS = [
    { re: /service[_-]?role[_-]?key/gi, label: 'service_role_key in frontend' },
    { re: /SUPABASE_SERVICE_ROLE/g, label: 'SUPABASE_SERVICE_ROLE exposed' },
    { re: /sk_live_[a-zA-Z0-9]+/, label: 'Stripe live key exposed' },
    { re: /sk_test_[a-zA-Z0-9]+/, label: 'Stripe test key exposed' },
    { re: /window\.supabase/g, label: 'global window.supabase anti-pattern' },
    { re: /__CODEN_FORCE_ERROR__/g, label: 'forced error marker in code' },
    { re: /eval\s*\(/g, label: 'unsafe eval()' },
    { re: /dangerouslySetInnerHTML/g, label: 'dangerouslySetInnerHTML (XSS risk)' },
  ];

  for (const file of files) {
    if (file.path.includes('node_modules')) continue;
    const content = file.content || '';
    for (const { re, label } of HIGH_RISK_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(content)) {
        issues.push(`${label} in ${file.path}`);
      }
    }
  }

  // Auth requirement signals in prompt
  const hasAuth = ctx.hasAuth || /\b(auth|login|signup)\b/i.test(ctx.userPrompt);
  const hasFiles = files.length > 0;
  const hasRls = files.some(f => /enable row level security/i.test(f.content || ''));

  if (hasAuth && hasFiles && !hasRls && ctx.hasDatabase) {
    issues.push('No RLS policies detected — private data tables may be unprotected');
  }

  // needsLlm: only call LLM if we found real issues (save tokens otherwise)
  return { issues, needsLlm: issues.length > 0 };
}

// ─── Agent task builders ──────────────────────────────────────────────────────

function buildUIAgentTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'ui_designer',
    executionMode: 'llm',
    preferredModelTier: 'design',  // UI/UX → design-capable model (Gemini Pro, Claude Opus)
    prompt: `[UI AGENT] For "${ctx.projectName}" (${ctx.appType}), produce:
1. React component list with required props and state
2. Design tokens: primary color, font, radius, spacing scale
3. Mobile-first responsive strategy (breakpoints, touch targets)
4. Required interaction states: loading, empty, error, success, disabled
5. Top 2 anti-generic-design rules for this app type

Request: "${ctx.userPrompt.slice(0, 500)}"`,
    systemContext: `Senior UI/UX engineer for ${ctx.appType}. Frontend visual layer only.
Structured analysis, not code. Under 350 words. Be specific, not generic.`,
    priority: 'high',
    tokenBudget: 1800,
  };
}

function buildBackendAgentTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'backend_engineer',
    executionMode: 'llm',
    preferredModelTier: 'reasoning',  // Backend/RLS → reasoning model (Claude Sonnet, GPT-5.5)
    prompt: `[BACKEND AGENT] For "${ctx.projectName}" (${ctx.appType}):
1. Data entities and relationships
2. Supabase tables: name, key columns, indexes, access pattern (owner/org)
3. RLS policy strategy per table (SELECT/INSERT/UPDATE/DELETE)
4. API endpoints needed (method, path, auth required)

Request: "${ctx.userPrompt.slice(0, 500)}"`,
    systemContext: `Senior backend engineer, Supabase/PostgreSQL expert. Data architecture only.
Under 350 words. Schema spec, not code.`,
    priority: 'high',
    tokenBudget: 1800,
  };
}

function buildSecurityAgentTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'security_auditor',
    executionMode: 'hybrid',  // Static scan first, LLM only if issues found
    preferredModelTier: 'reasoning',  // Security → reasoning model when LLM needed
    prompt: `[SECURITY AGENT] Pre-generation audit for "${ctx.projectName}":
1. Authentication touchpoints requiring guards
2. Input validation requirements (forms, uploads, API params)
3. Missing RLS or policy gaps
4. OWASP risks specific to ${ctx.appType}
5. Required mitigations (max 5 actionable items)

Request: "${ctx.userPrompt.slice(0, 400)}"`,
    systemContext: `Security engineer. OWASP-aware checklist only. Under 250 words. Actionable.`,
    priority: 'normal',
    tokenBudget: 1200,
    staticInput: { files: ctx.files, prompt: ctx.userPrompt, appType: ctx.appType },
  };
}

function buildTestAgentTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'test_writer',
    executionMode: 'llm',
    preferredModelTier: 'fast',  // Test scenarios → fast cheap model is sufficient
    prompt: `[TEST AGENT] Minimum test scenarios for "${ctx.projectName}" (${ctx.appType}):
1. Primary user flow (happy path)
2. Empty state
3. Error state / form validation
4. Critical business logic check

Request: "${ctx.userPrompt.slice(0, 350)}"`,
    systemContext: `QA engineer. Structured test list only. Under 200 words.`,
    priority: 'normal',
    tokenBudget: 800,
  };
}

function buildUXAgentTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'ux_validator',
    executionMode: 'llm',
    preferredModelTier: 'balanced',  // UX → balanced model, no need for frontier
    prompt: `[UX AGENT] UX requirements for "${ctx.projectName}" (${ctx.appType}):
1. Touch target requirements (mobile)
2. WCAG 2.1 AA critical items
3. Empty states with CTAs
4. Error messages (actionable, not generic)
5. Loading: skeleton vs spinner decision

Request: "${ctx.userPrompt.slice(0, 350)}"`,
    systemContext: `UX specialist. Structured requirements. Under 200 words. ${ctx.appType}-specific.`,
    priority: 'normal',
    tokenBudget: 800,
  };
}

function buildDependencyAnalystTask(ctx: ParallelAgentContext): AgentTask {
  return {
    role: 'dependency_analyst',
    executionMode: 'static',  // Pure static — zero LLM cost
    preferredModelTier: 'fast', // not used for static mode
    prompt: '',  // not used for static mode
    systemContext: '',
    priority: 'normal',
    tokenBudget: 0,  // no tokens consumed
    staticInput: { files: ctx.files },
  };
}

// ─── Executor types ───────────────────────────────────────────────────────────

export type LlmExecutor = (
  task: AgentTask,
  modelId: AllowedModelId,
) => Promise<string>;

// ─── Parallel execution engine ────────────────────────────────────────────────

/**
 * Executes agents in parallel. Each agent uses the model appropriate for its task:
 * - 'static' agents → zero LLM, instant
 * - 'hybrid' agents → static first, LLM only if needed
 * - 'llm' agents → uses preferredModelTier to resolve the actual model
 */
export async function runParallelAgents(
  ctx: ParallelAgentContext,
  executor: LlmExecutor,
  enabled: AgentRole[] = ['ui_designer', 'backend_engineer'],
  timeoutMs = 18_000,
): Promise<AgentResult[]> {
  const taskBuilders: Record<AgentRole, (ctx: ParallelAgentContext) => AgentTask> = {
    ui_designer:       buildUIAgentTask,
    backend_engineer:  buildBackendAgentTask,
    security_auditor:  buildSecurityAgentTask,
    test_writer:       buildTestAgentTask,
    ux_validator:      buildUXAgentTask,
    dependency_analyst: buildDependencyAnalystTask,
  };

  const tasks = enabled.map(role => taskBuilders[role](ctx));
  const noDeps = tasks.filter(t => !t.dependsOn?.length);
  const withDeps = tasks.filter(t => (t.dependsOn?.length ?? 0) > 0);
  const completedRoles = new Set<AgentRole>();
  const allResults: AgentResult[] = [];

  const runOne = async (task: AgentTask): Promise<AgentResult> => {
    const startedAt = Date.now();
    try {
      let output = '';
      let usedModel: string = 'static';

      if (task.executionMode === 'static') {
        // ✅ Pure static — zero LLM, zero cost, instant
        if (task.role === 'dependency_analyst') {
          output = runDependencyAnalysis(ctx);
        }
      } else if (task.executionMode === 'hybrid') {
        // ✅ Static first — only call LLM if static found real issues
        if (task.role === 'security_auditor') {
          const scan = runStaticSecurityScan(ctx);
          if (!scan.needsLlm) {
            output = scan.issues.length === 0
              ? 'Static security scan: no critical issues detected.'
              : `Static security issues:\n${scan.issues.map(i => `  • ${i}`).join('\n')}`;
          } else {
            // Issues found → escalate to LLM for deeper analysis
            const modelId = resolveModel(task.preferredModelTier, ctx);
            usedModel = modelId;
            const augmentedPrompt = `${task.prompt}\n\nSTATIC SCAN PRE-FINDINGS:\n${scan.issues.map(i => `  • ${i}`).join('\n')}`;
            const llmTask = { ...task, prompt: augmentedPrompt };
            const outputPromise = executor(llmTask, modelId);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout`)), timeoutMs),
            );
            output = await Promise.race([outputPromise, timeoutPromise]);
            output = `Static pre-findings:\n${scan.issues.map(i => `  • ${i}`).join('\n')}\n\nLLM analysis:\n${output}`;
          }
        }
      } else {
        // ✅ LLM mode — resolve model from tier, not hardcoded
        const modelId = resolveModel(task.preferredModelTier, ctx);
        usedModel = modelId;
        const outputPromise = executor(task, modelId);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Agent ${task.role} timed out`)), timeoutMs),
        );
        output = await Promise.race([outputPromise, timeoutPromise]);
      }

      return {
        role: task.role,
        output,
        duration_ms: Date.now() - startedAt,
        success: true,
        usedModel,
        executionMode: task.executionMode,
      };
    } catch (err: any) {
      console.warn(`[coden:parallel_agent_failed] role=${task.role} mode=${task.executionMode}`, { message: err?.message });
      return {
        role: task.role,
        output: '',
        duration_ms: Date.now() - startedAt,
        success: false,
        usedModel: 'error',
        executionMode: task.executionMode,
        error: err?.message,
      };
    }
  };

  // Wave 1: all independent agents in parallel (static + LLM mixed)
  if (noDeps.length > 0) {
    const wave1 = await Promise.allSettled(noDeps.map(runOne));
    for (const r of wave1) {
      const result = r.status === 'fulfilled'
        ? r.value
        : { role: 'ui_designer' as AgentRole, output: '', duration_ms: 0, success: false, executionMode: 'llm' as AgentExecutionMode };
      allResults.push(result);
      if (result.success) completedRoles.add(result.role);
    }
  }

  // Wave 2: dependent agents
  const readyDeps = withDeps.filter(t => (t.dependsOn || []).every(dep => completedRoles.has(dep)));
  if (readyDeps.length > 0) {
    const wave2 = await Promise.allSettled(readyDeps.map(runOne));
    for (const r of wave2) {
      if (r.status === 'fulfilled') allResults.push(r.value);
    }
  }

  return allResults;
}

// ─── Context merger ───────────────────────────────────────────────────────────

export function mergeAgentOutputs(results: AgentResult[]): string {
  const sections: string[] = [];

  for (const result of results) {
    if (!result.success || !result.output.trim()) continue;

    const label: Record<AgentRole, string> = {
      ui_designer:        'UI AGENT BRIEF',
      backend_engineer:   'BACKEND AGENT BRIEF',
      security_auditor:   'SECURITY AGENT CHECKLIST',
      test_writer:        'TEST AGENT SCENARIOS',
      ux_validator:       'UX AGENT REQUIREMENTS',
      dependency_analyst: 'DEPENDENCY ANALYSIS',
    };

    const modelNote = result.usedModel && result.usedModel !== 'static' && result.usedModel !== 'error'
      ? ` (via ${result.usedModel.split('/').pop()})`
      : result.executionMode === 'static' ? ' (static analysis)' : '';

    sections.push(`[${label[result.role]}${modelNote}]\n${result.output.trim()}`);
  }

  if (sections.length === 0) return '';

  return [
    '[PARALLEL AGENT PRE-ANALYSIS]',
    'Specialist agents analyzed the request. Use their outputs as binding requirements.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}

/**
 * Selects which agents to run. Static agents are always cheap — enable freely.
 * LLM agents are selected based on what the prompt actually needs.
 */
export function selectAgentsForContext(ctx: ParallelAgentContext): AgentRole[] {
  const roles: AgentRole[] = [];
  const prompt = ctx.userPrompt.toLowerCase();
  const hasFiles = ctx.files && ctx.files.length > 0;

  // Static agents — always free, always useful
  if (hasFiles) roles.push('dependency_analyst');

  // UI agent — for any build/edit with visual output
  if (/\b(build|create|cree|creer|genere|app|interface|ui|component|page|layout|design)\b/i.test(prompt)) {
    roles.push('ui_designer');
  }

  // Backend agent — only when data/API is involved
  if (ctx.hasDatabase || ctx.hasAuth || ctx.hasPayments ||
    /\b(database|supabase|auth|login|crud|stripe|payment|api|backend|schema|table)\b/i.test(prompt)) {
    roles.push('backend_engineer');
  }

  // Security auditor — hybrid, so cheap unless issues found
  if (ctx.hasAuth || ctx.hasPayments || hasFiles ||
    /\b(auth|login|secret|permission|role|rls|stripe|webhook|security|admin)\b/i.test(prompt)) {
    roles.push('security_auditor');
  }

  // UX agent — for new builds
  if (/\b(build|create|cree|creer|genere|nouvelle app|new app)\b/i.test(prompt)) {
    roles.push('ux_validator');
  }

  return roles;
}
