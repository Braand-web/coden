export const TEMPORARY_GENERATION_ACCESS_TOKEN = 'coden-temporary-generation-access';

export type TemporaryGenerationAccessEnv = Record<string, string | undefined>;

export type TemporaryGenerationAccessConfig = {
  enabled: boolean;
  ips: string[];
  email: string;
  expiresAt: number;
  trustForwardedHeaders: boolean;
  unlimitedCredits: boolean;
};

function readBoolean(value: string | undefined, fallback = false) {
  if (value === undefined || value.trim() === '') return fallback;
  return !['0', 'false', 'off', 'disabled', 'no'].includes(value.trim().toLowerCase());
}

export function normalizeIpAddress(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized.startsWith('::ffff:')) return normalized.slice('::ffff:'.length);
  if (normalized === '::1') return '127.0.0.1';
  return normalized;
}

export function readTemporaryGenerationAccessConfig(
  env: TemporaryGenerationAccessEnv = typeof process === 'undefined' ? {} : process.env,
): TemporaryGenerationAccessConfig {
  const ips = String(env.CODEN_TEMPORARY_GENERATION_IPS || '')
    .split(',')
    .map(normalizeIpAddress)
    .filter(Boolean);
  const expiresAt = Date.parse(String(env.CODEN_TEMPORARY_GENERATION_EXPIRES_AT || ''));

  return {
    enabled: readBoolean(env.CODEN_TEMPORARY_GENERATION_ACCESS),
    ips: [...new Set(ips)],
    email: String(env.CODEN_TEMPORARY_GENERATION_EMAIL || '').trim().toLowerCase(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    trustForwardedHeaders: readBoolean(env.CODEN_TEMPORARY_GENERATION_TRUST_PROXY),
    unlimitedCredits: readBoolean(env.CODEN_TEMPORARY_GENERATION_UNLIMITED_CREDITS),
  };
}

export function getRequestClientIp(
  request: { ip?: unknown; socket?: { remoteAddress?: unknown }; connection?: { remoteAddress?: unknown }; headers?: Record<string, unknown> },
  trustForwardedHeaders: boolean,
) {
  if (trustForwardedHeaders) {
    const forwarded = request.headers?.['x-forwarded-for'];
    const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || '').split(',')[0];
    const forwardedIp = normalizeIpAddress(firstForwarded);
    if (forwardedIp) return forwardedIp;
  }

  return normalizeIpAddress(request.ip || request.socket?.remoteAddress || request.connection?.remoteAddress);
}

export function isTemporaryGenerationAccessAllowed(
  request: Parameters<typeof getRequestClientIp>[0],
  env: TemporaryGenerationAccessEnv = typeof process === 'undefined' ? {} : process.env,
  now = Date.now(),
) {
  const config = readTemporaryGenerationAccessConfig(env);
  if (!config.enabled || !config.email || !config.ips.length || !config.expiresAt || config.expiresAt <= now) return false;
  const requestIp = getRequestClientIp(request, config.trustForwardedHeaders);
  return Boolean(requestIp && config.ips.includes(requestIp));
}

export function isTemporaryGenerationRoute(method: string, originalUrl: string) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const path = String(originalUrl || '').split('?')[0].replace(/\/$/, '') || '/';
  if (path === '/api/projects') return normalizedMethod === 'GET' || normalizedMethod === 'POST';
  if (!path.startsWith('/api/projects/')) return false;

  const projectPath = path.slice('/api/projects/'.length);
  if (/^[^/]+$/.test(projectPath)) return normalizedMethod === 'GET';
  if (/^[^/]+\/(?:state|messages|events|analysis|seo-audit|runtime-profile|publish\/status|deployments|versions|agent\/runs|agent\/research|agent\/memory|diff)$/.test(projectPath)) {
    return normalizedMethod === 'GET';
  }
  if (/^[^/]+\/(?:preview|preview\/[^/]+|preview\/start|build|build\/cancel|build\/resume|generate|browser-test|security-scan|agent\/answer|agent\/feedback|media\/generate|import-context|visual-edit)$/.test(projectPath)) {
    return ['POST', 'DELETE'].includes(normalizedMethod);
  }
  if (/^[^/]+\/agent\/runs\/[^/]+(?:\/runner-results)?$/.test(projectPath)) return normalizedMethod === 'GET';
  if (/^[^/]+\/agent\/runs\/[^/]+\/(?:instructions|confirm|cancel)$/.test(projectPath)) return normalizedMethod === 'POST';
  return false;
}
