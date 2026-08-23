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
