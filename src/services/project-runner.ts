import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runBrowserInteractionAudit } from './browser-interaction-runner.ts';
import type { AgentVerificationCheck } from './agent-v2.ts';
import { containsSecret, redactSecrets } from './secret-redaction.ts';
import { detectCodenCloudRequirements } from './coden-cloud.ts';
import { validateCodenFullstackFiles } from './fullstack-generation.ts';
import { scanGeneratedSecurity } from './generated-security-scanner.ts';

export type RunnerStatus = 'passed' | 'failed' | 'skipped';
export type RunnerSeverity = 'info' | 'low' | 'medium' | 'high';

export type RunnerFile = {
  path: string;
  content: string;
  language?: string;
};

export type RunnerCheck = {
  check_type: string;
  status: RunnerStatus;
  severity: RunnerSeverity;
  message: string;
  file_path?: string;
  command?: string;
  duration_ms?: number;
  public_payload?: Record<string, unknown>;
};

export type RunnerResult = {
  run_id: string;
  status: RunnerStatus;
  duration_ms: number;
  checks: RunnerCheck[];
};

export interface RunnerAdapter {
  run(input: {
    runId: string;
    projectId: string;
    files: RunnerFile[];
    previewHtml?: string;
    prompt?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RunnerResult>;
}

const DANGEROUS_SCRIPT_RE = /\b(rm\s+-rf|del\s+\/|format\b|curl\b|wget\b|powershell\b|pwsh\b|bash\b|sh\b|chmod\b|sudo\b|scp\b|ssh\b|node\s+-e|python\b|python3\b|eval\b)\b/i;
const SCRIPT_NAMES = ['lint', 'test', 'build'];

const SAFE_SCRIPT_SEGMENT_RE = /^(?:vite\s+build(?:\s+[\w./:=@-]+)*|tsc(?:\s+[\w./:=@-]+)*|eslint(?:\s+[\w./*{},=:@-]+)*|biome\s+check(?:\s+[\w./*{},=:@-]+)*|node\s+(?:--experimental-strip-types|--test)\s+[\w./*{}-]+|tsx\s+--test\s+[\w./*{}-]+|vitest(?:\s+run)?(?:\s+[\w./*{},=:@-]+)*|npm\s+run\s+(?:build|test|lint|typecheck)(?:\s+--[\w-]+)*)$/i;

function isSafePackageScript(value: string) {
  const script = String(value || '').trim();
  if (!script || DANGEROUS_SCRIPT_RE.test(script)) return false;
  // Only a simple AND chain is supported. This prevents a safe first command
  // from smuggling an arbitrary shell command through pipes, substitutions,
  // semicolons or fallback operators.
  if (/\|\||[;|`\n\r]|\$\(/.test(script)) return false;
  const segments = script.split(/\s*&&\s*/).filter(Boolean);
  return segments.length > 0 && segments.every(segment => SAFE_SCRIPT_SEGMENT_RE.test(segment.trim()));
}

export class HybridProjectRunner implements RunnerAdapter {
  private executeScripts: boolean;

  constructor(options: { executeScripts?: boolean } = {}) {
    this.executeScripts = Boolean(options.executeScripts);
  }

  async run(input: {
    runId: string;
    projectId: string;
    files: RunnerFile[];
    previewHtml?: string;
    prompt?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<RunnerResult> {
    const startedAt = Date.now();
    const checks: RunnerCheck[] = [];
    const workdir = path.join(tmpdir(), `coden-runner-${sanitizePathPart(input.projectId)}-${randomUUID()}`);

    try {
      throwIfAborted(input.signal);
      await mkdir(workdir, { recursive: true });
      checks.push(...this.staticChecks(input.files, input.previewHtml || ''));

      if (!checks.some(check => check.status === 'failed' && check.severity === 'high')) {
        await this.writeSafeFiles(workdir, input.files, checks);
      }

      throwIfAborted(input.signal);
      const packageFile = input.files.find(file => normalizePath(file.path) === 'package.json');
      checks.push(...this.projectTopologyChecks(input.files, input.previewHtml || '', Boolean(packageFile), input.prompt || ''));
      checks.push(...verificationChecksToRunnerChecks(await runBrowserInteractionAudit({
        files: input.files,
        previewHtml: input.previewHtml,
        timeoutMs: Math.min(input.timeoutMs || 120_000, 20_000),
      })));
      throwIfAborted(input.signal);
      if (packageFile) {
        checks.push(...await this.packageChecks(workdir, packageFile, input.timeoutMs || 120_000, input.signal));
      } else {
        checks.push({
          check_type: 'package_scripts',
          status: 'skipped',
          severity: 'info',
          message: 'Script checks skipped for this legacy static snapshot.',
        });
      }
      checks.push(this.technicalScoreCheck(checks));
    } finally {
      await rm(workdir, { recursive: true, force: true }).catch(() => null);
    }

    const failed = checks.some(check => check.status === 'failed');
    return {
      run_id: input.runId,
      status: failed ? 'failed' : 'passed',
      duration_ms: Date.now() - startedAt,
      checks,
    };
  }

  private staticChecks(files: RunnerFile[], previewHtml: string): RunnerCheck[] {
    const checks: RunnerCheck[] = [];

    if (!files.length) {
      checks.push(fail('files_present', 'high', 'No project files are available for runner checks.'));
    }

    for (const file of files) {
      const safePath = normalizePath(file.path);
      if (!isSafeProjectPath(safePath)) {
        checks.push(fail('safe_path', 'high', 'Unsafe file path blocked by runner.', file.path));
        continue;
      }
      if (/^\.env(?:\.|$)|\/\.env(?:\.|$)/i.test(safePath)) {
        checks.push(fail('no_env_files', 'high', 'Runner blocked generated .env files.', file.path));
      }
      if (containsSecret(file.content || '')) {
        checks.push(fail('no_secrets', 'high', 'Potential secret or credential detected.', file.path));
      }
      if (safePath.endsWith('.json')) {
        try {
          JSON.parse(file.content || '{}');
          checks.push(pass('json_parse', `JSON parsed successfully: ${safePath}`, file.path));
        } catch (error: any) {
          checks.push(fail('json_parse', 'medium', `Invalid JSON: ${error.message}`, file.path));
        }
      }
      if (/\.(js|ts|tsx|jsx)$/i.test(safePath)) {
        if (/\beval\s*\(|new Function\s*\(|from\s+['"]node:child_process['"]|require\(['"]child_process['"]\)/i.test(file.content || '')) {
          checks.push(fail('unsafe_runtime_api', 'high', 'Unsafe runtime API detected in generated script.', file.path));
        } else {
          checks.push(pass('script_static', `Script passed static safety scan: ${safePath}`, file.path));
        }
      }
      if (safePath.endsWith('.css')) {
        const open = (file.content.match(/{/g) || []).length;
        const close = (file.content.match(/}/g) || []).length;
        if (open !== close) {
          checks.push(fail('css_braces', 'medium', 'CSS brace count is unbalanced.', file.path));
        } else {
          checks.push(pass('css_braces', `CSS brace balance passed: ${safePath}`, file.path));
        }
      }
    }

    const indexHtml = files.find(file => normalizePath(file.path).toLowerCase() === 'index.html')?.content || '';
    const html = indexHtml || previewHtml || files.find(file => normalizePath(file.path).endsWith('.html'))?.content || '';
    if (!html.trim()) {
      checks.push(fail('preview_non_empty', 'high', 'Preview HTML is empty.'));
    } else {
      checks.push(pass('preview_non_empty', 'Preview HTML is non-empty.'));
      if (!/<title[\s>][\s\S]*<\/title>/i.test(html)) checks.push(warn('seo_title', 'medium', 'Preview is missing a title tag.'));
      if (!/<h1[\s>]/i.test(html)) checks.push(warn('a11y_h1', 'medium', 'Preview is missing a clear H1.'));
      if (!/<meta\s+name=["']description["']/i.test(html)) checks.push(warn('seo_description', 'low', 'Preview is missing a meta description.'));
      if (/<img\b(?![^>]*\balt=)/i.test(html)) checks.push(warn('a11y_img_alt', 'low', 'At least one image is missing alt text.'));
    }

    return checks;
  }

  private projectTopologyChecks(files: RunnerFile[], previewHtml: string, hasPackageJson: boolean, prompt = ''): RunnerCheck[] {
    const checks: RunnerCheck[] = [];
    const byPath = new Map(files.map(file => [normalizePath(file.path).toLowerCase(), file]));
    const source = files.map(file => `${file.path}\n${file.content || ''}`).join('\n\n');
    const indexHtml = files.find(file => normalizePath(file.path).toLowerCase() === 'index.html')?.content || '';
    const html = indexHtml || previewHtml || files.find(file => normalizePath(file.path).endsWith('.html'))?.content || '';
    const hasIndex = byPath.has('index.html');
    const hasMain = Array.from(byPath.keys()).some(file => /^src\/main\.(tsx|jsx|ts|js)$/.test(file));
    const hasApp = Array.from(byPath.keys()).some(file => /^src\/app\.(tsx|jsx)$/.test(file));
    const hasViteRoot = /<div\s+id=["']root["'][^>]*>/i.test(html);
    const hasMainScript = /<script[^>]+type=["']module["'][^>]+src=["']\/src\/main\.(tsx|jsx|ts|js)["']/i.test(html);

    if (hasPackageJson) {
      checks.push(hasIndex ? pass('vite_index_present', 'index.html is present.', 'index.html') : fail('vite_index_present', 'high', 'Modern project is missing index.html.', 'index.html'));
      checks.push(hasMain ? pass('vite_main_present', 'React entrypoint is present.', 'src/main.tsx') : fail('vite_main_present', 'high', 'Modern project is missing src/main.tsx or equivalent.', 'src/main.tsx'));
      checks.push(hasApp ? pass('vite_app_present', 'React App component is present.', 'src/App.tsx') : fail('vite_app_present', 'high', 'Modern project is missing src/App.tsx or equivalent.', 'src/App.tsx'));
      checks.push(hasViteRoot ? pass('vite_root_mount', 'Preview contains a root mount.', 'index.html') : fail('vite_root_mount', 'high', 'index.html should expose <div id="root"> for React.', 'index.html'));
      checks.push(hasMainScript ? pass('vite_main_script', 'Preview references the React entrypoint.', 'index.html') : fail('vite_main_script', 'high', 'index.html should load /src/main.tsx as a module.', 'index.html'));
    }

    checks.push(...this.localImportChecks(files));
    checks.push(...this.interactionChecks(source));
    checks.push(...this.fullstackChecks(files, source));
    checks.push(...verificationChecksToRunnerChecks(scanGeneratedSecurity(files, { prompt }).checks));
    checks.push(...this.previewRuntimeChecks(html));
    checks.push(...this.productionReadinessChecks(files, source, hasPackageJson, prompt));
    return checks;
  }

  private fullstackChecks(files: RunnerFile[], source: string): RunnerCheck[] {
    const hasExplicitFullstackSurface = files.some(file => /^(supabase\/schema\.sql|src\/lib\/codenCloud\.ts|src\/lib\/appData\.ts|src\/fullstack\.test\.ts|FULLSTACK\.md)$/i.test(normalizePath(file.path)))
      || /@supabase\/supabase-js|Coden Cloud|codenCloud|supabase\s*\.|getCodenCloudClient|from\(['"`]app_/i.test(source);
    if (!hasExplicitFullstackSurface) return [];
    const requirement = detectCodenCloudRequirements(source);
    return validateCodenFullstackFiles(files, requirement).map(check => ({
      check_type: check.key,
      status: check.status === 'fail' ? 'failed' : check.status === 'pass' ? 'passed' : 'skipped',
      severity: check.severity,
      message: check.message,
      file_path: check.file,
    }));
  }

  private localImportChecks(files: RunnerFile[]): RunnerCheck[] {
    const checks: RunnerCheck[] = [];
    const filePaths = new Set(files.map(file => normalizePath(file.path).toLowerCase()));
    const sourceFiles = files.filter(file => /\.(tsx|jsx|ts|js)$/i.test(normalizePath(file.path)));
    const missing: Array<{ from: string; target: string }> = [];

    for (const file of sourceFiles) {
      const fromPath = normalizePath(file.path);
      const fromDir = path.posix.dirname(fromPath);
      const content = String(file.content || '');
      const importRegex = /(?:import\s+(?:[^'"]+\s+from\s+)?|import\s*\(|require\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content))) {
        const specifier = match[1];
        if (!specifier) continue;
        const resolved = normalizePath(path.posix.normalize(path.posix.join(fromDir, specifier))).toLowerCase();
        if (hasLocalModule(filePaths, resolved)) continue;
        missing.push({ from: fromPath, target: specifier });
      }
    }

    if (!missing.length) {
      checks.push(pass('local_imports_resolve', 'Local imports resolve statically.'));
    } else {
      missing.slice(0, 6).forEach(item => {
        checks.push(fail('local_imports_resolve', 'high', `Missing local import ${item.target}.`, item.from));
      });
    }
    return checks;
  }

  private interactionChecks(source: string): RunnerCheck[] {
    const checks: RunnerCheck[] = [];
    const hasButton = /<button|role=["']button|type=["']button/i.test(source);
    const hasForm = /<form|<input|<select|<textarea/i.test(source);
    const hasHandler = /\b(onClick|onSubmit|onChange|addEventListener|useState|useReducer|href=|aria-expanded)\b/i.test(source);
    const hasValidation = /\b(required|minLength|maxLength|pattern|aria-invalid|invalid|error|validation|validate|setError)\b/i.test(source);
    const hasFeedback = /\b(loading|saving|saved|success|error|empty|toast|alert|disabled|pending|cancelled)\b/i.test(source);
    const hasListExperience = /\b(todo|task|kanban|table|list|catalog|marketplace|inventory|crm|dashboard|reservation|booking)\b/i.test(source);
    const hasListTools = /\b(search|filter|sort|query|status|category|tag|segment|favorite|favourite)\b/i.test(source);
    const hasTabs = /\b(tablist|role=["']tab|activeTab|setActiveTab|data-tab|tabs?\b)\b/i.test(source);
    const hasTabControls = /\b(aria-selected|aria-controls|setActiveTab|onClick|data-tab)\b/i.test(source);
    const hasModal = /\b(dialog|modal|sheet|drawer|popover|aria-modal)\b/i.test(source);
    const hasModalState = /\b(isOpen|openModal|closeModal|setOpen|set.*Open|aria-expanded|onClose|onOpen)\b/i.test(source);
    const hasDestructiveAction = /\b(delete|remove|archive|clear|reset|destroy|supprimer|effacer|retirer)\b/i.test(source);
    const hasDestructiveSafety = /\b(confirm\(|confirmation|undo|toast|modal|dialog|cancel|annuler|restore|rollback)\b/i.test(source);

    if (hasButton) {
      checks.push(hasHandler ? pass('control_handlers', 'Primary controls have handlers or navigation.') : fail('control_handlers', 'high', 'Controls exist but no handlers or navigation were detected.'));
    }
    if (hasForm) {
      checks.push(hasValidation ? pass('form_validation', 'Forms include validation or error feedback.') : fail('form_validation', 'medium', 'Forms need validation and visible feedback.'));
    }
    if (hasListExperience) {
      checks.push(hasListTools ? pass('list_tools', 'List-oriented experience includes search, filters, sorting, or status controls.') : warn('list_tools', 'medium', 'List-oriented apps should include search, filters, sorting, or status controls.'));
    }
    if (hasTabs) {
      checks.push(hasTabControls ? pass('tab_interaction', 'Tabs expose a visible active-state interaction.') : fail('tab_interaction', 'medium', 'Tabs are mentioned but no active-state interaction was detected.'));
    }
    if (hasModal) {
      checks.push(hasModalState ? pass('modal_interaction', 'Modal, drawer, or popover has open/close state.') : fail('modal_interaction', 'medium', 'Modal-like UI needs open/close behavior.'));
    }
    if (hasDestructiveAction) {
      checks.push(hasDestructiveSafety
        ? pass('destructive_action_safety', 'Destructive actions include confirmation, undo, or feedback.')
        : warn('destructive_action_safety', 'medium', 'Destructive actions should include confirmation, undo, or clear feedback.'));
    }
    checks.push(hasFeedback ? pass('ui_feedback_states', 'User feedback states are represented.') : warn('ui_feedback_states', 'medium', 'No loading, empty, error, success, or disabled state was detected.'));
    return checks;
  }

  private previewRuntimeChecks(html: string): RunnerCheck[] {
    const checks: RunnerCheck[] = [];
    if (!html.trim()) return checks;
    if (/Cannot\s+read\s+properties|ReferenceError|SyntaxError|TypeError|__CODEN_FORCE_ERROR__|data-coden-runtime-error/i.test(html)) {
      checks.push(fail('preview_runtime_markers', 'high', 'Preview contains a runtime error marker.'));
    } else {
      checks.push(pass('preview_runtime_markers', 'No known runtime error markers found in preview.'));
    }
    if (/<body[^>]*>\s*<\/body>/i.test(html) || /id=["']root["'][^>]*>\s*<\/div>\s*<\/body>/i.test(html)) {
      checks.push(warn('preview_body_content', 'medium', 'Preview body appears sparse before runtime rendering; runner will rely on source checks.'));
    } else {
      checks.push(pass('preview_body_content', 'Preview body contains rendered content or a mounted shell.'));
    }
    return checks;
  }

  private productionReadinessChecks(files: RunnerFile[], source: string, hasPackageJson: boolean, prompt = ''): RunnerCheck[] {
    const checks: RunnerCheck[] = [];
    const paths = new Set(files.map(file => normalizePath(file.path).toLowerCase()));
    const hasModernReact = hasPackageJson && paths.has('index.html') && Array.from(paths).some(file => /^src\/main\.(tsx|ts|jsx|js)$/.test(file)) && Array.from(paths).some(file => /^src\/app\.(tsx|jsx)$/.test(file));
    const hasCss = Array.from(paths).some(file => /\.(css|scss)$/.test(file));
    const hasResponsiveCss = /@media|clamp\(|minmax\(|grid-template|flex-wrap|container-type|max-width|\b(?:sm|md|lg|xl|2xl):/i.test(source);
    const explicitServerIntent = /\b(backend|api|server|fullstack|full stack)\b/i.test(prompt);
    const privateDataIntent = /\b(auth|login|sign in|signup|supabase|postgres|database|rls|roles?|team|admin|private|secure|paiement|payment|stripe|subscription|invoice|facture|storage|upload|multi-user|multi user|account|workspace|organization|organisation|realtime|real-time)\b/i.test(prompt);
    const hasLocalStorage = /\blocalStorage\b/i.test(source);
    const hasSupabaseSchema = paths.has('supabase/schema.sql');
    const schemaFile = files.find(file => normalizePath(file.path).toLowerCase() === 'supabase/schema.sql');
    const schema = schemaFile?.content || '';
    const hasRls = /enable row level security/i.test(schema);
    const hasPolicies = /create policy/i.test(schema);
    const hasOwnerScope = /owner_id|organization_id|org_id/i.test(schema);
    let pkg: any = {};
    try {
      pkg = JSON.parse(files.find(file => normalizePath(file.path).toLowerCase() === 'package.json')?.content || '{}');
    } catch {
      pkg = {};
    }
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const scripts = pkg.scripts || {};
    const hasNodeBackend = Boolean(dependencies.express || dependencies.fastify || dependencies.hono || dependencies.koa)
      && Array.from(paths).some(file => /^(?:server\/(?:index|server|app)|api\/index|server)\.(?:ts|js|mts|mjs)$/.test(file));
    const hasNodeApiRoutes = hasNodeBackend && /\.(?:get|post|put|patch|delete)\(\s*['"]\/api\//i.test(source);
    const hasValidationLayer = paths.has('src/lib/validation.ts') && /zod|z\.object/i.test(source);
    const hasServerValidation = hasValidationLayer || Boolean(
      hasNodeBackend &&
      /\b(?:req|request)\.body\b/i.test(source) &&
      /\b(trim|required|length|validate|safeParse|parse)\b/i.test(source)
    );
    const hasRateLimit = /assertRateLimit|rate limit|RATE_LIMITED/i.test(source);
    const hasWebhookSignature = /assertWebhookSignature|stripe-signature|webhook signature/i.test(source);
    const hasStripe = /\b(stripe|subscription|payment|invoice|paiement|facture)\b/i.test(source);
    const hasExplicitFullstackSurface = hasSupabaseSchema || /@supabase\/supabase-js|Coden Cloud|codenCloud|supabase\s*\.|getCodenCloudClient|from\(['"`]app_/i.test(source);
    const hasDataIntent = explicitServerIntent || privateDataIntent || hasStripe || hasExplicitFullstackSurface || hasNodeBackend;
    const requiresDatabaseSecurity = hasSupabaseSchema || /\b(supabase|postgres|database|rls|private data|multi-user|multi user)\b/i.test(prompt);
    const requiresAuthGuard = hasSupabaseSchema || /\b(auth|login|sign in|signup|roles?|team|admin|private|secure|multi-user|multi user|account|workspace|organization|organisation)\b/i.test(prompt);
    const hasBackendContract = hasSupabaseSchema || (hasNodeBackend && hasNodeApiRoutes);
    const serverSource = files.filter(file => /^(?:server\/|api\/|server\.)/i.test(normalizePath(file.path))).map(file => file.content).join('\n');
    const clientSource = files.filter(file => /^(?:src\/|app\/)/i.test(normalizePath(file.path)) && !/\/server\./i.test(normalizePath(file.path))).map(file => file.content).join('\n');
    const viteConfig = files.filter(file => /^vite\.config\.(?:ts|js|mts|mjs)$/i.test(normalizePath(file.path))).map(file => file.content).join('\n');
    const startScript = String(scripts.start || '');
    const buildScript = String(scripts.build || '');
    const devScript = String(scripts.dev || '');
    const hasBackendDevScript = Object.entries(scripts).some(([name, body]) => /^dev:(?:server|backend|api)$/i.test(name) && /server|api|tsx|node/i.test(String(body)));
    const devStartsBoth = /concurrently|npm-run-all|run-p\b/i.test(devScript) && /server|backend|dev:server/i.test(devScript);
    const startRunsSource = /\b(?:tsx|ts-node|node\s+--experimental-strip-types)\b/i.test(startScript) && /server|api/i.test(startScript);
    const startRunsBuild = /\bnode\b/i.test(startScript) && /dist|build/i.test(startScript) && /\b(?:tsc|tsup|esbuild|rollup)\b/i.test(buildScript);
    const hasRunnableNodeStart = Boolean(startScript && (startRunsSource || startRunsBuild));
    const hasBackendHealth = /\.(?:get|all)\(\s*['"]\/api\/(?:health|status|ready)/i.test(serverSource);
    const clientUsesApi = /(?:fetch|axios\.(?:get|post|put|patch|delete))\(\s*['"`]\/api\//i.test(clientSource);
    const hasViteApiProxy = !clientUsesApi || /proxy\s*:\s*\{/i.test(viteConfig);
    const hasRunnableFullstackPreview = hasBackendDevScript || devStartsBoth || startRunsSource;
    const hasRouteGuard = /getCodenCloudClient|auth\.getUser|onAuthStateChange|ProtectedRoute|requireAuth|session/i.test(source);
    const hasDeployScript = /"build"\s*:|"preview"\s*:|vite build|next build/i.test(source);
    const noSecrets = !containsSecret(source) && !/service[_-]?role|SUPABASE_SERVICE_ROLE|sbp_[a-z0-9]|secret eyJ/i.test(source);

    checks.push(hasModernReact
      ? readinessPass('production_frontend', 92, 'Frontend uses a modern React project structure.')
      : fail('production_frontend', 'high', 'Production apps need a modern React/TypeScript project structure.'));
    checks.push(hasCss && hasResponsiveCss
      ? readinessPass('production_responsive', 88, 'Responsive/mobile-first CSS patterns are present.')
      : fail('production_responsive', 'medium', 'Responsive/mobile-first CSS patterns are missing.'));
    if (hasDataIntent) {
      checks.push(hasBackendContract
        ? readinessPass('production_backend_contract', 86, hasSupabaseSchema ? 'Data app includes a managed backend schema contract.' : 'Data app includes a real Node API contract.')
        : fail('production_backend_contract', 'high', 'Data apps must include a real backend API or managed schema contract, not only frontend state.'));
      if (requiresDatabaseSecurity) {
        checks.push(hasRls && hasPolicies && hasOwnerScope
          ? readinessPass('production_database_security', 90, 'Database schema includes RLS, policies, and owner/org scoping.')
          : fail('production_database_security', 'high', 'Private persistent data tables need RLS, policies, and owner/org scoping.'));
      }
      checks.push(hasServerValidation
        ? readinessPass('production_validation', 84, hasValidationLayer ? 'Shared validation layer is present.' : 'Server input validation is present.')
        : fail('production_validation', 'high', 'Backend write operations need server-side input validation.'));
      if (requiresAuthGuard) {
        checks.push(hasRouteGuard
          ? readinessPass('production_auth_guard', 84, 'Auth/session guard path is present.')
          : fail('production_auth_guard', 'high', 'Private routes or data actions need auth/session guards.'));
      }
    }
    if (hasNodeBackend) {
      checks.push(hasRunnableNodeStart && hasBackendHealth
        ? readinessPass('production_node_runtime', 90, 'Node backend has a runnable production start contract and a health endpoint.')
        : fail('production_node_runtime', 'high', 'Node fullstack apps need a runnable start script, compiled server output or source runner, and /api/health.'));
      checks.push(hasRunnableFullstackPreview && hasViteApiProxy
        ? readinessPass('production_fullstack_preview', 90, 'Frontend and Node API can start together in preview and /api is proxied.')
        : fail('production_fullstack_preview', 'high', 'Fullstack preview needs a backend development command (or combined dev script) and a Vite /api proxy.'));
    }
    if (hasLocalStorage && privateDataIntent && !/isPreviewRuntime/i.test(source)) {
      checks.push(fail('production_no_fake_localstorage', 'high', 'localStorage cannot be production persistence for real private data.'));
    } else if (hasLocalStorage) {
      checks.push(readinessPass('production_demo_data_honesty', 78, 'Local demo storage is limited or appears preview-only.'));
    }
    checks.push(noSecrets
      ? readinessPass('production_secret_safety', 96, 'No frontend secrets or service role keys detected.')
      : fail('production_secret_safety', 'high', 'Secrets or service role keys must never appear in generated frontend files.'));
    if (requiresAuthGuard || hasStripe) {
      checks.push(hasRateLimit
        ? readinessPass('production_rate_limit', 78, 'Rate limit helper or guard is present.')
        : warn('production_rate_limit', 'medium', 'Sensitive actions should include rate limiting.'));
    }
    if (hasStripe) {
      checks.push(hasWebhookSignature
        ? readinessPass('production_stripe_webhook', 86, 'Webhook signature verification path is present.')
        : fail('production_stripe_webhook', 'high', 'Payment apps need server-side webhook signature verification.'));
    }
    checks.push(hasDeployScript
      ? readinessPass('production_deploy', 82, 'Build/deploy script surface is present.')
      : warn('production_deploy', 'medium', 'Deploy readiness could not be confirmed without build scripts.'));

    const categoryScores = {
      frontend: scoreFromBooleans([hasModernReact, hasCss, hasResponsiveCss]),
      backend: hasDataIntent ? scoreFromBooleans([hasBackendContract, hasServerValidation, !requiresAuthGuard || hasRouteGuard]) : 100,
      database: requiresDatabaseSecurity ? scoreFromBooleans([hasSupabaseSchema, hasRls, hasPolicies, hasOwnerScope]) : 100,
      security: scoreFromBooleans([noSecrets, !hasStripe || hasWebhookSignature, !hasDataIntent || hasServerValidation, !requiresAuthGuard || hasRouteGuard]),
      responsive: scoreFromBooleans([hasCss, hasResponsiveCss]),
      deploy: scoreFromBooleans([hasDeployScript, hasPackageJson, !hasNodeBackend || hasRunnableNodeStart]),
    };
    const minScore = Math.min(...Object.values(categoryScores));
    checks.push({
      check_type: 'production_readiness_score',
      status: minScore >= 76 ? 'passed' : minScore >= 60 ? 'skipped' : 'failed',
      severity: minScore >= 60 ? 'low' : 'high',
      message: `Production readiness score: frontend ${categoryScores.frontend}, backend ${categoryScores.backend}, database ${categoryScores.database}, security ${categoryScores.security}, responsive ${categoryScores.responsive}, deploy ${categoryScores.deploy}.`,
      public_payload: categoryScores,
    });
    return checks;
  }

  private technicalScoreCheck(checks: RunnerCheck[]): RunnerCheck {
    const penalty = checks.reduce((total, check) => {
      if (check.status === 'passed') return total;
      const base = check.severity === 'high' ? 24 : check.severity === 'medium' ? 13 : check.severity === 'low' ? 6 : 2;
      return total + (check.status === 'failed' ? base : Math.ceil(base / 2));
    }, 0);
    const score = Math.max(0, Math.min(100, 100 - penalty));
    return {
      check_type: 'technical_build_score',
      status: score >= 76 ? 'passed' : score >= 60 ? 'skipped' : 'failed',
      severity: score >= 60 ? 'low' : 'high',
      message: `Technical build score: ${score}/100.`,
      public_payload: { score },
    };
  }

  private async writeSafeFiles(workdir: string, files: RunnerFile[], checks: RunnerCheck[]) {
    for (const file of files) {
      const safePath = normalizePath(file.path);
      if (!isSafeProjectPath(safePath) || /^\.env(?:\.|$)|\/\.env(?:\.|$)/i.test(safePath)) continue;
      const target = path.join(workdir, safePath);
      if (!target.startsWith(workdir)) {
        checks.push(fail('safe_write', 'high', 'Runner blocked path traversal during write.', file.path));
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content || '', 'utf8');
    }
  }

  private async packageChecks(workdir: string, packageFile: RunnerFile, timeoutMs: number, signal?: AbortSignal): Promise<RunnerCheck[]> {
    const checks: RunnerCheck[] = [];
    let pkg: any;
    try {
      pkg = JSON.parse(packageFile.content || '{}');
    } catch (error: any) {
      return [fail('package_parse', 'medium', `Invalid package.json: ${error.message}`, packageFile.path)];
    }

    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
    for (const scriptName of SCRIPT_NAMES) {
      const scriptBody = String(scripts[scriptName] || '').trim();
      if (!scriptBody) {
        checks.push({ check_type: `script_${scriptName}`, status: 'skipped', severity: 'info', message: `No ${scriptName} script present.` });
        continue;
      }
      if (!isSafePackageScript(scriptBody)) {
        checks.push(fail(`script_${scriptName}_safe`, 'high', `Blocked unsafe or unsupported ${scriptName} script.`, 'package.json'));
        continue;
      }
      checks.push(pass(`script_${scriptName}_safe`, `${scriptName} script is allowed.`, 'package.json'));
      if (!this.executeScripts) {
        checks.push({ check_type: `script_${scriptName}_exec`, status: 'skipped', severity: 'info', message: `${scriptName} execution skipped by runner policy.` });
        continue;
      }
      checks.push(await this.runNpmScript(workdir, scriptName, Math.min(timeoutMs, 120_000), signal));
    }
    return checks;
  }

  private runNpmScript(workdir: string, scriptName: string, timeoutMs: number, signal?: AbortSignal): Promise<RunnerCheck> {
    return new Promise(resolve => {
      const startedAt = Date.now();
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', scriptName, '--if-present', '--silent'], {
        cwd: workdir,
        env: safeRunnerEnv(),
        shell: false,
        windowsHide: true,
      });
      let output = '';
      let settled = false;
      const finish = (check: RunnerCheck) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(check);
      };
      const onAbort = () => {
        child.kill('SIGTERM');
        finish(fail(`script_${scriptName}_exec`, 'medium', 'Runner cancelled by the active request.', 'package.json', Date.now() - startedAt, redactOutput(output)));
      };
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(fail(`script_${scriptName}_exec`, 'medium', `${scriptName} timed out after ${timeoutMs}ms.`, 'package.json', Date.now() - startedAt, redactOutput(output)));
      }, timeoutMs);
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', chunk => { output += String(chunk); });
      child.stderr.on('data', chunk => { output += String(chunk); });
      child.on('error', error => {
        finish(fail(`script_${scriptName}_exec`, 'medium', `${scriptName} could not start: ${error.message}`, 'package.json', Date.now() - startedAt));
      });
      child.on('close', code => {
        const duration = Date.now() - startedAt;
        if (code === 0) {
          finish({ check_type: `script_${scriptName}_exec`, status: 'passed', severity: 'info', message: `${scriptName} completed.`, command: `npm run ${scriptName}`, duration_ms: duration, public_payload: { output: redactOutput(output) } });
        } else {
          finish(fail(`script_${scriptName}_exec`, 'medium', `${scriptName} exited with code ${code}.`, 'package.json', duration, redactOutput(output)));
        }
      });
    });
  }
}

export function runnerChecksToVerificationChecks(checks: RunnerCheck[]): Array<{
  key: string;
  status: 'pass' | 'warn' | 'fail';
  severity: RunnerSeverity;
  message: string;
  file?: string;
}> {
  return checks.map(check => ({
    key: `runner_${check.check_type}`,
    status: check.status === 'failed' ? 'fail' : check.status === 'passed' ? 'pass' : 'warn',
    severity: check.severity,
    message: check.message,
    file: check.file_path,
  }));
}

function verificationChecksToRunnerChecks(checks: AgentVerificationCheck[]): RunnerCheck[] {
  return checks.map(check => ({
    check_type: check.key,
    status: check.status === 'fail' ? 'failed' : check.status === 'pass' ? 'passed' : 'skipped',
    severity: check.severity,
    message: check.message,
    file_path: check.file,
  }));
}

function normalizePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isSafeProjectPath(value: string) {
  return Boolean(value) && !value.includes('..') && !value.startsWith('/') && !/^[a-z]:/i.test(value);
}

function hasLocalModule(filePaths: Set<string>, resolved: string) {
  // TypeScript source commonly imports `./module.js` so the emitted ESM keeps
  // a valid runtime extension. Static resolution must map that specifier back
  // to module.ts/module.tsx instead of reporting a false missing import.
  const sourceStem = resolved.replace(/\.(?:mjs|cjs|js|jsx)$/i, '');
  const candidates = [
    resolved,
    sourceStem,
    `${sourceStem}.ts`,
    `${sourceStem}.tsx`,
    `${sourceStem}.mts`,
    `${sourceStem}.cts`,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}.json`,
    `${resolved}.css`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
  ];
  return candidates.some(candidate => filePaths.has(candidate));
}

function sanitizePathPart(value: string) {
  return String(value || 'project').replace(/[^a-z0-9_-]/gi, '_').slice(0, 48);
}

function safeRunnerEnv() {
  const keys = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'HOME'];
  const env: Record<string, string> = { CODEN_RUNNER: '1', CI: '1', NODE_ENV: 'production' };
  for (const key of keys) {
    if (process.env[key]) env[key] = String(process.env[key]);
  }
  return env;
}

function redactOutput(value: string) {
  return redactSecrets(value, '[redacted]').slice(-4000);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error('Project runner cancelled by the active request.');
    error.name = 'AbortError';
    throw error;
  }
}

function readinessPass(check_type: string, score: number, message: string): RunnerCheck {
  return {
    check_type,
    status: 'passed',
    severity: 'info',
    message,
    public_payload: { score },
  };
}

function scoreFromBooleans(values: boolean[]) {
  if (!values.length) return 100;
  return Math.round(values.filter(Boolean).length / values.length * 100);
}

function pass(check_type: string, message: string, file_path?: string): RunnerCheck {
  return { check_type, status: 'passed', severity: 'info', message, file_path };
}

function warn(check_type: string, severity: RunnerSeverity, message: string, file_path?: string): RunnerCheck {
  return { check_type, status: 'skipped', severity, message, file_path };
}

function fail(check_type: string, severity: RunnerSeverity, message: string, file_path?: string, duration_ms?: number, output?: string): RunnerCheck {
  return {
    check_type,
    status: 'failed',
    severity,
    message,
    file_path,
    duration_ms,
    public_payload: output ? { output } : undefined,
  };
}
