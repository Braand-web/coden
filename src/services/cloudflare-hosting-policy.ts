import type { GeneratedAppRuntime } from './generated-app-runtime.ts';

export type CloudflareHostingTarget =
  | 'workers-fullstack'
  | 'workers-static-assets'
  | 'pages-legacy';

export type CloudflareHostingProvider =
  | 'cloudflare-workers'
  | 'cloudflare-pages';

/**
 * The generated app manifest is authoritative for full-stack deployments.
 * A process-wide feature flag must never downgrade a Worker application to a
 * static Pages upload because that would silently remove its server runtime.
 */
export function resolveCloudflareHostingTarget(
  runtime: GeneratedAppRuntime,
  legacyStaticProvider = process.env.CODEN_STATIC_HOSTING_PROVIDER,
): CloudflareHostingTarget {
  if (runtime === 'node-server') {
    throw new Error('Standalone Node applications require the Railway deployment adapter and cannot be published as static Cloudflare assets.');
  }
  if (runtime === 'cloudflare-workers') return 'workers-fullstack';
  return String(legacyStaticProvider || '').toLowerCase() === 'cloudflare-pages'
    ? 'pages-legacy'
    : 'workers-static-assets';
}

export function hostingProviderForTarget(target: CloudflareHostingTarget): CloudflareHostingProvider {
  return target === 'pages-legacy' ? 'cloudflare-pages' : 'cloudflare-workers';
}

export function workersDevUrl(workerName: string, accountSubdomain = process.env.CLOUDFLARE_WORKERS_SUBDOMAIN) {
  const subdomain = String(accountSubdomain || '').trim().replace(/^\.+|\.+$/g, '');
  return subdomain ? `https://${workerName}.${subdomain}.workers.dev` : '';
}

export const DEFAULT_CODEN_ROOT_DOMAIN = 'coden.fun';

/**
 * The apex domain every published project is served from by default.  It is a
 * deployment-level setting, so a self-hosted Coden must be able to move every
 * generated app onto its own domain by setting CODEN_ROOT_DOMAIN alone.
 */
export function codenRootDomain(rootDomain = process.env.CODEN_ROOT_DOMAIN): string {
  const normalized = String(rootDomain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/^\.+|\.+$/g, '')
    .toLowerCase();
  return normalized || DEFAULT_CODEN_ROOT_DOMAIN;
}

export function codenSubdomainForSlug(slug: string): string {
  return String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app';
}

/**
 * The single place that decides where a published project lives.  Every caller
 * — the Workers deploy, the Pages deploy, the persisted publication row and the
 * URL shown to the user — must derive the host from here, otherwise Cloudflare
 * serves one hostname while Coden advertises another.
 */
export function codenHostForSlug(slug: string, rootDomain = process.env.CODEN_ROOT_DOMAIN): string {
  return `${codenSubdomainForSlug(slug)}.${codenRootDomain(rootDomain)}`;
}
