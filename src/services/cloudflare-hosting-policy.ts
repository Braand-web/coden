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
/**
 * Whether this particular project can actually be deployed as a Worker.
 *
 * Not a preference — a fact about the files. `runWranglerDeploy` spawns
 * `<projectDir>/node_modules/.bin/wrangler` and reads a `wrangler.jsonc`,
 * `wrangler.json` or `wrangler.toml` beside it, and throws the moment either
 * is missing.
 */
export type WorkerDeployability = {
  /** A pinned Wrangler binary exists inside the generated project. */
  hasWranglerBinary: boolean;
  /** And a Wrangler configuration for it to read. */
  hasWranglerConfig: boolean;
};

export function canDeployAsWorker(capabilities?: WorkerDeployability): boolean {
  return Boolean(capabilities?.hasWranglerBinary && capabilities?.hasWranglerConfig);
}

/**
 * Where a generated application is published, decided by what it is.
 *
 * The generated app manifest is authoritative for full-stack deployments. A
 * process-wide feature flag must never downgrade a Worker application to a
 * static Pages upload, because that would silently remove its server runtime.
 *
 * The static case used to be decided the other way round — by
 * `CODEN_STATIC_HOSTING_PROVIDER`, defaulting to Workers — and that default
 * could not work for anything Coden generates. `starters.ts` pins React, Vite,
 * Tailwind and TypeScript, and no Wrangler; there is no `wrangler.jsonc`
 * either. So every publish reached `findWranglerBinary` and threw "The
 * generated Worker project does not include a pinned Wrangler dependency" —
 * deterministically, on the first click, since the feature shipped. The
 * database holds zero deployments and the Cloudflare account holds no Coden
 * worker: the same fact from both ends.
 *
 * So the decision is made from the project rather than from an environment
 * variable someone has to remember to set. A static app that carries Wrangler
 * is deployed as a Worker; one that does not goes to Pages, which needs
 * nothing installed in the project — it uploads the built `dist/` over the
 * Cloudflare API and attaches `<slug>.coden.fun` itself.
 *
 * The environment variable still forces Pages when set, so an operator can
 * pin the legacy path; it can no longer force a Worker deployment that the
 * project is incapable of.
 */
export function resolveCloudflareHostingTarget(
  runtime: GeneratedAppRuntime,
  legacyStaticProvider = process.env.CODEN_STATIC_HOSTING_PROVIDER,
  capabilities?: WorkerDeployability,
): CloudflareHostingTarget {
  if (runtime === 'node-server') {
    throw new Error('Standalone Node applications require the Railway deployment adapter and cannot be published as static Cloudflare assets.');
  }
  if (runtime === 'cloudflare-workers') return 'workers-fullstack';
  if (String(legacyStaticProvider || '').toLowerCase() === 'cloudflare-pages') return 'pages-legacy';
  return canDeployAsWorker(capabilities) ? 'workers-static-assets' : 'pages-legacy';
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
