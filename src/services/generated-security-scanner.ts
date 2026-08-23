import type { AgentGeneratedFile, AgentVerificationCheck } from './agent-v2.ts';
import { containsSecret, redactSecrets } from './secret-redaction.ts';

export type SecurityFinding = {
  key: string;
  status: 'pass' | 'warn' | 'fail';
  severity: 'info' | 'low' | 'medium' | 'high';
  message: string;
  file?: string;
  public_payload?: Record<string, unknown>;
};

export type SecurityScanResult = {
  status: 'passed' | 'warning' | 'failed';
  findings: SecurityFinding[];
  checks: AgentVerificationCheck[];
};

function normalizePath(value: string) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function sourceBundle(files: AgentGeneratedFile[]) {
  return files.map(file => `--- ${normalizePath(file.path)} ---\n${file.content || ''}`).join('\n\n');
}

function fileByPath(files: AgentGeneratedFile[], target: string) {
  const normalized = normalizePath(target).toLowerCase();
  return files.find(file => normalizePath(file.path).toLowerCase() === normalized);
}

function escapeRegExp(value: string) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isFrontendFile(file: AgentGeneratedFile) {
  const path = normalizePath(file.path).toLowerCase();
  return (
    path.startsWith('src/') &&
    !path.includes('.test.') &&
    !path.startsWith('src/server') &&
    !path.startsWith('src/api/')
  );
}

function isEdgeFunctionFile(file: AgentGeneratedFile) {
  const path = normalizePath(file.path).toLowerCase();
  return path.startsWith('supabase/functions/') || path.startsWith('functions/');
}

export function scanGeneratedSecurity(files: AgentGeneratedFile[], options: { prompt?: string } = {}): SecurityScanResult {
  const findings: SecurityFinding[] = [];
  const source = sourceBundle(files);
  const prompt = String(options.prompt || '');
  const schema = fileByPath(files, 'supabase/schema.sql')?.content || '';
  const paths = files.map(file => normalizePath(file.path));
  const frontendSource = files.filter(isFrontendFile).map(file => `--- ${normalizePath(file.path)} ---\n${file.content || ''}`).join('\n\n');
  const edgeSource = files.filter(isEdgeFunctionFile).map(file => `--- ${normalizePath(file.path)} ---\n${file.content || ''}`).join('\n\n');

  if (containsSecret(source) || /service[_-]?role|SUPABASE_SERVICE_ROLE|sbp_[a-z0-9]|secret\s+eyJ/i.test(source)) {
    findings.push(fail('security_no_frontend_secrets', 'Potential secret, service role key, or provider credential found in generated files.'));
  } else {
    findings.push(pass('security_no_frontend_secrets', 'No frontend secrets or service role keys detected.'));
  }

  const usesSupabase = /@supabase\/supabase-js|createClient\(|\bsupabase\s*\.|Coden Cloud|getCodenCloudClient/i.test(source);
  const explicitBackendIntent = /\b(auth|login|signup|database|supabase|postgres|backend|api|server|rls|roles?|team|admin|private|secure|paiement|payment|stripe|subscription|invoice|facture|storage|upload|multi-user|multi user|account|workspace|organization|organisation|realtime|real-time)\b/i.test(prompt);
  const createTables = Array.from(schema.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-zA-Z0-9_]+)/gi)).map(match => match[1]);
  const usesPrivateData = explicitBackendIntent || usesSupabase || createTables.length > 0;

  if (usesPrivateData || usesSupabase || createTables.length) {
    findings.push(schema.trim()
      ? pass('security_schema_present', 'Supabase schema contract is present.', 'supabase/schema.sql')
      : fail('security_schema_present', 'Apps with private data need a Supabase schema contract.', 'supabase/schema.sql'));

    findings.push(/enable\s+row\s+level\s+security/i.test(schema)
      ? pass('security_rls_enabled', 'RLS is enabled in the generated schema.', 'supabase/schema.sql')
      : fail('security_rls_enabled', 'Every user table needs RLS enabled.', 'supabase/schema.sql'));

    if (createTables.length) {
      const missingRlsTables = createTables.filter((tableName) => {
        const table = escapeRegExp(tableName || '');
        return !new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${table}\\s+enable\\s+row\\s+level\\s+security`, 'i').test(schema);
      });
      findings.push(missingRlsTables.length
        ? fail('security_all_private_tables_rls', `RLS must be enabled per table. Missing: ${missingRlsTables.slice(0, 8).join(', ')}.`, 'supabase/schema.sql', { missing_tables: missingRlsTables })
        : pass('security_all_private_tables_rls', 'Every generated table enables RLS explicitly.', 'supabase/schema.sql'));
    }

    findings.push(/create\s+policy/i.test(schema)
      ? pass('security_rls_policies', 'RLS policies are present.', 'supabase/schema.sql')
      : fail('security_rls_policies', 'Generated schema needs explicit RLS policies.', 'supabase/schema.sql'));

    findings.push(/owner_id|organization_id|org_id/i.test(schema)
      ? pass('security_owner_scope', 'Owner or organization scoping is present.', 'supabase/schema.sql')
      : fail('security_owner_scope', 'Private tables need owner_id or organization_id scoping.', 'supabase/schema.sql'));

    findings.push(!/\b(raw_user_meta_data|user_metadata)\b/i.test(schema)
      ? pass('security_no_user_metadata_authz', 'RLS policies do not rely on user-editable metadata.', 'supabase/schema.sql')
      : fail('security_no_user_metadata_authz', 'RLS policies must not rely on user_metadata or raw_user_meta_data for authorization.', 'supabase/schema.sql'));

    findings.push(!/create\s+(?:or\s+replace\s+)?function\s+public\.[\w_]+[\s\S]*?security\s+definer/i.test(schema)
      ? pass('security_no_public_security_definer', 'No public security definer function is generated.', 'supabase/schema.sql')
      : fail('security_no_public_security_definer', 'Security definer functions must not be created in the exposed public schema.', 'supabase/schema.sql'));
  }

  const hasValidation = paths.includes('src/lib/validation.ts') || /\bzod\b|z\.object\(|safe[A-Z]\w+Schema/i.test(source);
  if (usesPrivateData) {
    findings.push(hasValidation
      ? pass('security_server_validation', 'Validation layer is present.')
      : fail('security_server_validation', 'Sensitive data workflows need validation before writes.'));
  }

  const hasStripe = /\b(stripe|subscription|payment|invoice|paiement|facture)\b/i.test(source);
  if (hasStripe) {
    findings.push(/stripe-signature|webhook signature|assertWebhookSignature/i.test(source)
      ? pass('security_webhook_signature', 'Payment webhook signature verification is represented.')
      : fail('security_webhook_signature', 'Payment apps need server-side webhook signature verification.'));
  }

  if (/\b(upload|storage|bucket|file input|type=["']file["'])\b/i.test(source)) {
    findings.push(/mime_type|size_bytes|uploadPolicySchema|storage policy|bucket policy/i.test(source)
      ? pass('security_upload_policy', 'Upload constraints or storage policy contract is present.')
      : warn('security_upload_policy', 'Uploads should include mime type, size, path and storage access constraints.'));
  }

  if (/\b(delete|remove|reset|clear|destroy|supprimer|effacer)\b/i.test(source)) {
    findings.push(/\b(confirm\(|confirmation|undo|toast|modal|dialog|cancel|rollback|feedback)\b/i.test(source)
      ? pass('security_destructive_feedback', 'Destructive actions include confirmation, undo or visible feedback.')
      : warn('security_destructive_feedback', 'Destructive actions need confirmation, undo or clear feedback.'));
  }

  const referencesAiFeature = /\b(ai tool|chatbot|assistant|llm|prompt workspace|summari[sz]e|resume|streaming ai|ai[-_ ]?stream|streamAiResponse|app_generations|app_prompts|generated outputs)\b/i.test(source);
  const hasAiEdgeConnector = paths.some(path => /^supabase\/functions\/ai-stream\/index\.ts$/i.test(path)) || /text\/event-stream|ReadableStream/i.test(edgeSource);
  const frontendProviderCall = /(from\s+['"]openai['"]|new\s+OpenAI\s*\(|@anthropic-ai\/sdk|new\s+Anthropic\s*\(|GoogleGenerativeAI|@google\/generative-ai|createOpenAI\s*\(|createAnthropic\s*\(|streamText\s*\(|generateText\s*\()/i.test(frontendSource);
  const frontendProviderKey = /import\.meta\.env\.VITE_(OPENAI|ANTHROPIC|GEMINI|GOOGLE|DEEPSEEK|FAL|AI_PROVIDER)[A-Z0-9_]*KEY|Authorization["']?\s*:\s*["']?Bearer\s+\$\{?\s*import\.meta\.env/i.test(frontendSource);
  const frontendOwnStreamClient = /\/functions\/v1\/ai-stream|streamAiResponse|EventSource|ReadableStream|getReader\(/i.test(frontendSource);

  if (referencesAiFeature || frontendProviderCall || frontendProviderKey || hasAiEdgeConnector || frontendOwnStreamClient) {
    findings.push(hasAiEdgeConnector
      ? pass('security_ai_connector_server_side', 'AI streaming uses a server-side connector.')
      : fail('security_ai_connector_server_side', 'AI streaming features need a server-side connector such as supabase/functions/ai-stream/index.ts.'));

    findings.push(!frontendProviderCall && !frontendProviderKey
      ? pass('security_ai_no_frontend_provider_call', 'No direct AI provider SDK call or provider key is present in frontend files.')
      : fail('security_ai_no_frontend_provider_call', 'AI provider SDK calls and provider keys must stay out of frontend files.'));

    findings.push(/Deno\.env\.get|process\.env/i.test(edgeSource) || !hasAiEdgeConnector
      ? (hasAiEdgeConnector
          ? pass('security_ai_secrets_server_env', 'AI provider secrets are read from server environment only.')
          : warn('security_ai_secrets_server_env', 'AI provider secrets should be read only from the server connector.'))
      : fail('security_ai_secrets_server_env', 'AI connector must read provider secrets from server environment variables.'));

    if (frontendOwnStreamClient) {
      findings.push(/AbortController|signal|abort\(/i.test(frontendSource)
        ? pass('security_ai_stream_cancel', 'AI stream UI supports cancellation.')
        : warn('security_ai_stream_cancel', 'AI stream UI should support AbortController cancellation.'));
      findings.push(/\berror\b|try\s*\{|catch\s*\(|onError|retry/i.test(frontendSource)
        ? pass('security_ai_stream_error_state', 'AI stream UI includes error or retry handling.')
        : warn('security_ai_stream_error_state', 'AI stream UI should include error and retry handling.'));
    }
  }

  const status = findings.some(item => item.status === 'fail')
    ? 'failed'
    : findings.some(item => item.status === 'warn')
      ? 'warning'
      : 'passed';

  return {
    status,
    findings: findings.map(item => ({ ...item, message: redactSecrets(item.message, '[redacted]') })),
    checks: findings.map(item => ({
      key: item.key,
      status: item.status,
      severity: item.severity,
      message: redactSecrets(item.message, '[redacted]'),
      file: item.file,
    })),
  };
}

function pass(key: string, message: string, file?: string, public_payload?: Record<string, unknown>): SecurityFinding {
  return { key, status: 'pass', severity: 'info', message, file, public_payload };
}

function warn(key: string, message: string, file?: string, public_payload?: Record<string, unknown>): SecurityFinding {
  return { key, status: 'warn', severity: 'medium', message, file, public_payload };
}

function fail(key: string, message: string, file?: string, public_payload?: Record<string, unknown>): SecurityFinding {
  return { key, status: 'fail', severity: 'high', message, file, public_payload };
}
