const PUBLIC_SECRET_PLACEHOLDER = '[masked-secret]';

const DIRECT_SECRET_RE =
  /\b(sk-(?:live|test|proj)-[A-Za-z0-9_-]+|sk_live_[A-Za-z0-9_]+|sk_test_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+|sbp_[A-Za-z0-9_]+|sb_secret_[A-Za-z0-9_-]+|xox[baprs]-[A-Za-z0-9-]+)\b/g;

const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|apikey|secret|password|token|authorization|service[_-]?role)(\s*[:=]\s*)(["']?)([A-Za-z0-9_./+=-]{24,})(\3)/gi;

const JWT_RE = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g;

function decodeBase64UrlJson(value: string): Record<string, unknown> | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = globalThis.atob(padded);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function isSensitiveJwt(token: string): boolean {
  const payload = decodeBase64UrlJson(token.split('.')[1] || '');
  if (!payload) return false;
  const issuer = String(payload.iss || '').toLowerCase();
  const role = String(payload.role || '').toLowerCase();
  const projectRef = String(payload.ref || '').toLowerCase();
  const isSupabaseJwt = issuer === 'supabase' || Boolean(projectRef);
  if (!isSupabaseJwt) return false;
  return role === 'service_role' || role === 'supabase_admin' || role === 'postgres';
}

export function redactSecrets(value: unknown, placeholder = PUBLIC_SECRET_PLACEHOLDER): string {
  return String(value || '')
    .replace(JWT_RE, token => (isSensitiveJwt(token) ? placeholder : token))
    .replace(DIRECT_SECRET_RE, placeholder)
      .replace(SECRET_ASSIGNMENT_RE, (_match, key, separator, quote) => `${key}${separator}${quote}${placeholder}${quote}`);
}

export function containsSecret(value: unknown): boolean {
  const text = String(value || '');
  DIRECT_SECRET_RE.lastIndex = 0;
  if (DIRECT_SECRET_RE.test(text)) return true;
  SECRET_ASSIGNMENT_RE.lastIndex = 0;
  let match;
  while ((match = SECRET_ASSIGNMENT_RE.exec(text)) !== null) {
    const val = match[4];
    if (/placeholder|your[_-]|example|fake|secret|key|token|dummy|test[_-]?value|masked[_-]secret/i.test(val)) {
      continue;
    }
    return true;
  }
  JWT_RE.lastIndex = 0;
  return Array.from(text.matchAll(JWT_RE)).some(match => isSensitiveJwt(match[0]));
}

export function redactSecretPayload<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => redactSecretPayload(item)) as T;
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? redactSecrets(value) as T : value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactSecretPayload(item);
  }
  return output as T;
}
