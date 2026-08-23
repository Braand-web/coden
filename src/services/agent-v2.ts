import { redactSecrets } from './secret-redaction.ts';

export type AgentV2Intent =
  | 'conversation'
  | 'clarification_required'
  | 'plan'
  | 'build'
  | 'edit'
  | 'debug_fix'
  | 'verify'
  | 'deploy_assist'
  | 'external_keys_required'
  | 'credits_required';

export type AgentVerificationSeverity = 'info' | 'low' | 'medium' | 'high';
export type AgentVerificationStatus = 'pass' | 'warn' | 'fail';

export type AgentGeneratedFile = {
  path: string;
  content: string;
  language?: string;
  updated_at?: string;
};

export type AgentVerificationCheck = {
  key: string;
  status: AgentVerificationStatus;
  severity: AgentVerificationSeverity;
  message: string;
  file?: string;
};

export type AgentContextPackInput = {
  project: Record<string, any>;
  files: AgentGeneratedFile[];
  messages?: any[];
  events?: any[];
  versions?: any[];
  memory?: any[];
  previewStatus?: string;
  selectedModel?: string;
  requestId?: string;
};

const SENSITIVE_FIELD_RE = /(?:^|_)(real_cost_usd|provider_cost_usd|platform_cost_usd|margin_percent|stripe_fee|openrouter_raw|supplier_invoice_id|encrypted_value|api_key|apikey|secret|token|password|authorization|raw_provider_payload|prompt_tokens|completion_tokens|total_tokens)(?:$|_)/i;
const FORBIDDEN_PUBLIC_PAGE_RE = /(?:^|\/)(seo-aeo|templates\/restaurant-app)(?:\/|$)/i;

export function isAgentV2Enabled(env: Record<string, any> = {}): boolean {
  const raw = String(env.AGENT_V2_ENABLED ?? '').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'off';
}

export function redactAgentPayload<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => redactAgentPayload(item)) as T;
  }
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') return redactSecrets(value, '[redacted]') as T;
    return value;
  }

  const output: Record<string, any> = {};
  for (const [key, item] of Object.entries(value as Record<string, any>)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      continue;
    }
    output[key] = redactAgentPayload(item);
  }
  return output as T;
}

export function buildAgentContextPack(input: AgentContextPackInput) {
  const project = input.project || {};
  const files = (input.files || []).slice(0, 40).map(file => ({
    path: file.path,
    language: file.language || inferLanguage(file.path),
    size: String(file.content || '').length,
    updated_at: file.updated_at || null,
  }));
  const recentMessages = (input.messages || []).slice(-12).map(message => ({
    role: message.role,
    content: truncateText(message.content, 900),
    intent: message.intent || null,
    created_at: message.created_at || null,
  }));
  const recentEvents = (input.events || []).slice(-16).map(event => ({
    event_type: event.event_type,
    message: truncateText(event.message, 300),
    created_at: event.created_at || null,
  }));
  const recentVersions = (input.versions || []).slice(0, 5).map(version => ({
    id: version.id,
    version_number: version.version_number,
    reason: truncateText(version.reason, 240),
    diff_summary: redactAgentPayload(version.diff_summary || {}),
    created_at: version.created_at || null,
  }));

  return redactAgentPayload({
    request_id: input.requestId || null,
    agent_version: 'v2',
    project: {
      id: project.id,
      name: project.name,
      slug: project.slug,
      status: project.status,
      preview_status: input.previewStatus || project.preview_status || 'unknown',
      updated_at: project.updated_at || null,
    },
    selected_model: input.selectedModel || 'auto',
    files,
    recent_messages: recentMessages,
    recent_events: recentEvents,
    recent_versions: recentVersions,
    memory: (input.memory || []).slice(0, 6).map(item => redactAgentPayload(item)),
  });
}

export function verifyGeneratedProject(input: {
  projectName: string;
  files: AgentGeneratedFile[];
  previewHtml?: string;
  forbiddenPaths?: RegExp[];
}): AgentVerificationCheck[] {
  const checks: AgentVerificationCheck[] = [];
  const files = input.files || [];
  const previewHtml = String(input.previewHtml || '');
  const forbidden = input.forbiddenPaths || [FORBIDDEN_PUBLIC_PAGE_RE];

  if (!files.length) {
    checks.push(fail('files_present', 'high', 'No generated files were found.'));
  }

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || path.includes('..') || path.startsWith('/') || /^[a-z]:/i.test(path)) {
      checks.push(fail('safe_paths', 'high', 'Unsafe file path blocked.', file.path));
    }
    if (/^\.env(?:\.|$)|\/\.env(?:\.|$)/i.test(path)) {
      checks.push(fail('no_env_files', 'high', 'Generated output must not include .env files.', file.path));
    }
    if (forbidden.some(pattern => pattern.test(path))) {
      checks.push(fail('no_forbidden_pages', 'high', 'Generated output contains a page Coden should not create.', file.path));
    }
    if (/process\.env\.[A-Z0-9_]*SECRET|sk_live_|sk_test_|api[_-]?key\s*[:=]/i.test(file.content || '')) {
      checks.push(fail('no_secrets', 'high', 'Potential secret exposure detected in generated code.', file.path));
    }
  }

  if (!previewHtml.trim()) {
    checks.push(fail('preview_non_empty', 'high', 'Preview HTML is empty.'));
  } else {
    checks.push(pass('preview_non_empty', 'Preview HTML is available.'));
  }

  const htmlSource = previewHtml || files.find(file => file.path.endsWith('.html'))?.content || '';
  if (!/<h1[\s>]/i.test(htmlSource)) {
    checks.push(warn('seo_h1', 'medium', 'Preview should include one clear H1 for SEO and accessibility.'));
  } else {
    checks.push(pass('seo_h1', 'Preview includes an H1.'));
  }
  if (!/<title[\s>][\s\S]*<\/title>/i.test(htmlSource)) {
    checks.push(warn('seo_title', 'medium', 'Preview should include a document title.'));
  } else {
    checks.push(pass('seo_title', 'Preview includes a document title.'));
  }
  if (!/<meta\s+name=["']description["']/i.test(htmlSource)) {
    checks.push(warn('seo_description', 'low', 'Preview should include a meta description.'));
  } else {
    checks.push(pass('seo_description', 'Preview includes a meta description.'));
  }
  const hasKnownRuntimeBlocker = /__CODEN_FORCE_ERROR__/i.test(htmlSource)
    || /throw\s+new\s+Error\(\s*['"`](?:__CODEN_PLACEHOLDER__|App component is missing)/i.test(htmlSource);
  if (/<script[^>]*>[\s\S]*<\/script>/i.test(htmlSource) && hasKnownRuntimeBlocker) {
    checks.push(fail('preview_runtime_guard', 'medium', 'Preview contains a known forced runtime failure marker.'));
  }

  return checks;
}

export function summarizeVerificationChecks(checks: AgentVerificationCheck[]) {
  const failed = checks.filter(check => check.status === 'fail');
  const warnings = checks.filter(check => check.status === 'warn');
  return {
    status: failed.length ? 'failed' : warnings.length ? 'warning' : 'passed',
    failed: failed.length,
    warnings: warnings.length,
    message: failed[0]?.message || warnings[0]?.message || 'Verification passed.',
  };
}

export function summarizeAgentMemory(input: {
  projectName: string;
  files: AgentGeneratedFile[];
  latestDecision?: string;
  latestOutcome?: string;
}) {
  const fileKinds = Array.from(new Set((input.files || []).map(file => inferLanguage(file.path)))).slice(0, 8);
  return [
    `${input.projectName || 'Project'} uses ${input.files.length} generated files.`,
    fileKinds.length ? `Main file types: ${fileKinds.join(', ')}.` : 'No generated files yet.',
    input.latestDecision ? `Latest decision: ${truncateText(input.latestDecision, 180)}.` : '',
    input.latestOutcome ? `Latest outcome: ${truncateText(input.latestOutcome, 180)}.` : '',
  ].filter(Boolean).join(' ');
}

function normalizePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function truncateText(value: unknown, limit: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function inferLanguage(filePath: string) {
  const path = String(filePath || '').toLowerCase();
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.tsx')) return 'tsx';
  if (path.endsWith('.sql')) return 'sql';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.md')) return 'markdown';
  return 'text';
}

function pass(key: string, message: string): AgentVerificationCheck {
  return { key, status: 'pass', severity: 'info', message };
}

function warn(key: string, severity: AgentVerificationSeverity, message: string, file?: string): AgentVerificationCheck {
  return { key, status: 'warn', severity, message, file };
}

function fail(key: string, severity: AgentVerificationSeverity, message: string, file?: string): AgentVerificationCheck {
  return { key, status: 'fail', severity, message, file };
}
