/**
 * One-click publication of a built static app on Cloudflare Pages, under <slug>.coden.fun.
 *
 * A Pages deployment on the production branch is live as soon as it succeeds, so there is no staging and no promotion:
 * upload the built `dist/`, check the deployment answers, attach the Coden address, and look at that address for a few
 * seconds. If the Coden address is not up yet the site is already public on its pages.dev address, which is what the
 * user gets; the address is upgraded to <slug>.coden.fun on a later read (see `upgradeToCodenAddress`).
 */

import {
  attachCustomDomain,
  deployDirectory,
  ensurePagesProject,
  projectSlugToCfName,
  rollbackPagesDeployment,
  upsertCnameOnCodenFun,
} from './publish-cloudflare.ts';
import { codenHostForSlug, codenSubdomainForSlug } from './cloudflare-hosting-policy.ts';
import { verifyVercelDeployment } from './publish-vercel.ts';
import fs from 'node:fs/promises';
import path from 'node:path';

type Verification = { verified: boolean; baseUrl: string; checks: Array<{ url: string; status: number; ok: boolean; error?: string }> };
type VerifyTargets = { codenUrl: string | null; defaultUrl: string; deploymentUrl: string; expectedPublicationId?: string };

export type CloudflarePagesDeps = {
  ensureProject: (cfName: string) => Promise<{ name: string; subdomain: string }>;
  deploy: (cfName: string, distDir: string) => Promise<{ id: string; url: string }>;
  attachDomain: (cfName: string, host: string) => Promise<void>;
  upsertCname: (subdomain: string, target: string) => Promise<void>;
  rollback: (cfName: string, deploymentId: string) => Promise<void>;
  verify: (targets: VerifyTargets, routes: string[]) => Promise<Verification>;
  wait: (ms: number) => Promise<void>;
};

const defaultDeps: CloudflarePagesDeps = {
  ensureProject: ensurePagesProject,
  deploy: deployDirectory,
  attachDomain: attachCustomDomain,
  upsertCname: upsertCnameOnCodenFun,
  rollback: rollbackPagesDeployment,
  verify: (targets, routes) => verifyVercelDeployment(targets, routes, fetch, { expectedPublicationId: targets.expectedPublicationId }),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export type CloudflarePagesPublishResult = {
  provider: 'cloudflare-pages';
  projectName: string;
  deploymentId: string;
  deploymentUrl: string;
  defaultUrl: string;
  codenUrl: string | null;
  customDomain: string | null;
  /** The address the user is given: the Coden address when it already answers, else the pages.dev one. */
  publicUrl: string;
};

const summarize = (checks: Verification['checks']) => checks.slice(0, 4)
  .map(check => `${check.url}: ${check.status || check.error || 'unreachable'}${check.status && check.error ? ` ${check.error}` : ''}`).join(' | ');

export async function publishStaticAppToCloudflarePages(params: {
  slug: string;
  distDir: string;
  publicRoutes: string[];
  previousDeploymentId?: string;
  artifactHash?: string;
  /** Called as soon as Cloudflare created the deployment, before any verification (to leave a record behind). */
  onDeployed?: (deployment: { id: string; url: string }) => Promise<void>;
  onPhase?: (phase: string) => void;
}, deps: CloudflarePagesDeps = defaultDeps): Promise<CloudflarePagesPublishResult> {
  const phase = (name: string) => params.onPhase?.(name);
  const cfName = projectSlugToCfName(params.slug);
  if (params.artifactHash) {
    if (!/^[a-f0-9]{64}$/.test(params.artifactHash)) throw new Error('INVALID_PUBLICATION_ARTIFACT_HASH');
    const index = path.join(params.distDir, 'index.html');
    const html = (await fs.readFile(index, 'utf8')).replace(/<meta\b[^>]*\bname\s*=\s*["']coden-build["'][^>]*>/gi, '');
    const marker = `<meta name="coden-build" content="${params.artifactHash}">`;
    await fs.writeFile(index, /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${marker}</head>`) : `${marker}${html}`);
  }
  const project = await deps.ensureProject(cfName);
  const productionHost = project.subdomain && /\.pages\.dev$/i.test(project.subdomain) ? project.subdomain : `${cfName}.pages.dev`;
  const defaultUrl = `https://${productionHost}`;
  phase('cloudflare_project_ready');

  const deployment = await deps.deploy(cfName, params.distDir);
  phase('cloudflare_deployed');
  try {
    await params.onDeployed?.(deployment);
  } catch (error) {
    // Pages has already replaced production: persistence failure must not strand an older app on a new release.
    if (params.previousDeploymentId) await deps.rollback(cfName, params.previousDeploymentId);
    throw error;
  }

  // The deployment's own address first: it reflects exactly this upload. A just-created site can need a moment.
  const targets: VerifyTargets = { codenUrl: null, defaultUrl: '', deploymentUrl: deployment.url, expectedPublicationId: params.artifactHash };
  let verification = await deps.verify(targets, params.publicRoutes);
  for (let attempt = 0; attempt < 6 && !verification.verified; attempt += 1) {
    await deps.wait(3_000 * (attempt + 1));
    verification = await deps.verify(targets, params.publicRoutes);
  }
  if (!verification.verified) {
    // The new deployment is already the production one: put the previous one back when there is one.
    if (params.previousDeploymentId) {
      await deps.rollback(cfName, params.previousDeploymentId).catch((error: any) => {
        console.warn('[coden:cloudflare_rollback_failed]', { project: cfName, message: redactCloudflareCredentials(String(error?.message || error)).slice(0, 200) });
      });
    }
    throw new Error(`Cloudflare deployment could not be verified (${summarize(verification.checks) || 'no response'}).`);
  }

  // A healthy older production address is not proof that this new upload works.
  // After the immutable deployment URL, verify the stable production URL too.
  const productionTargets = { codenUrl: null, defaultUrl, deploymentUrl: '', expectedPublicationId: params.artifactHash };
  let production = await deps.verify(productionTargets, params.publicRoutes);
  for (let attempt = 0; attempt < 5 && !production.verified; attempt += 1) {
    await deps.wait(1_500 * (attempt + 1));
    production = await deps.verify(productionTargets, params.publicRoutes);
  }
  if (!production.verified) {
    if (params.previousDeploymentId) await deps.rollback(cfName, params.previousDeploymentId).catch(() => undefined);
    throw new Error('Cloudflare production address is not ready.');
  }
  phase('verified');

  // The Coden address: a few seconds of patience, never a reason to fail a site that is already online.
  const host = codenHostForSlug(params.slug);
  let codenUrl: string | null = null;
  try {
    await deps.attachDomain(cfName, host);
    await deps.upsertCname(codenSubdomainForSlug(params.slug), `${cfName}.pages.dev`);
    phase('domain_attached');
    for (let attempt = 0; attempt < 5 && !codenUrl; attempt += 1) {
      await deps.wait(2_000);
      const live = await deps.verify({ codenUrl: `https://${host}`, defaultUrl: '', deploymentUrl: '', expectedPublicationId: params.artifactHash }, params.publicRoutes);
      if (live.verified) codenUrl = `https://${host}`;
    }
  } catch (error: any) {
    console.warn('[coden:cloudflare_domain_pending]', { project: cfName, host, message: redactCloudflareCredentials(String(error?.message || error)).slice(0, 200) });
  }
  phase(codenUrl ? 'coden_address_live' : 'coden_address_pending');

  return {
    provider: 'cloudflare-pages',
    projectName: cfName,
    deploymentId: deployment.id,
    deploymentUrl: deployment.url,
    defaultUrl,
    codenUrl,
    customDomain: codenUrl ? host : null,
    publicUrl: codenUrl || defaultUrl,
  };
}

/**
 * A site published before its Coden address answered carries its pages.dev address. When the Coden address answers
 * now, this returns it (one quick look, no waiting); otherwise null.
 */
export async function upgradeToCodenAddress(slug: string, publicRoutes: string[] = ['/'], deps: Pick<CloudflarePagesDeps, 'verify'> = defaultDeps): Promise<string | null> {
  const host = codenHostForSlug(slug);
  const live = await deps.verify({ codenUrl: `https://${host}`, defaultUrl: '', deploymentUrl: '' }, publicRoutes);
  return live.verified ? `https://${host}` : null;
}

/** Cloudflare Pages hosts every new publication; Vercel is used only when the variable explicitly says so. */
export function publishProviderChoice(env: Record<string, string | undefined> = process.env): 'vercel' | 'cloudflare' {
  return String(env.CODEN_PUBLISH_PROVIDER || '').trim().toLowerCase() === 'vercel' ? 'vercel' : 'cloudflare';
}

/** Globally unique and stable even when two owners use the same app name. */
export function cloudflarePublicationSlug(projectId: string): string {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(projectId)) throw new Error('INVALID_PUBLICATION_PROJECT_ID');
  return `app-${projectId.replace(/-/g, '').toLowerCase()}`;
}

export function publicationHostingConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (publishProviderChoice(env) === 'vercel') return Boolean(String(env.VERCEL_TOKEN || '').trim());
  return !missingCloudflareSettings(env).length && !malformedCloudflareSettings(env).length
    && (env.NODE_ENV !== 'production' || (Boolean(String(env.E2B_API_KEY || '').trim()) && env.CODEN_SANDBOX_PROVIDER !== 'local'));
}

export const CLOUDFLARE_PUBLISH_VARIABLES = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID_CODEN_FUN'] as const;

/** Which Cloudflare settings are missing, by name only (a value is never read out). */
export function missingCloudflareSettings(env: Record<string, string | undefined> = process.env): string[] {
  return CLOUDFLARE_PUBLISH_VARIABLES.filter(name => !String(env[name] || '').trim());
}

/**
 * Settings that are present but are not what they should be, by name only. The classic mistake: pasting the whole
 * « curl … -H "Authorization: Bearer <token>" » test command that Cloudflare shows next to a new token, instead of the
 * token itself. That value is not a valid header and, worse, would be echoed in an error message.
 */
export function malformedCloudflareSettings(env: Record<string, string | undefined> = process.env): string[] {
  const shapes: Record<string, RegExp> = {
    CLOUDFLARE_ACCOUNT_ID: /^[0-9a-f]{32}$/i,
    CLOUDFLARE_ZONE_ID_CODEN_FUN: /^[0-9a-f]{32}$/i,
    CLOUDFLARE_API_TOKEN: /^[A-Za-z0-9_-]{20,}$/,
  };
  return CLOUDFLARE_PUBLISH_VARIABLES.filter(name => {
    const value = String(env[name] || '').trim();
    return value !== '' && !shapes[name].test(value);
  });
}

/** Never let a Cloudflare credential reach a log, whatever the message it was embedded in. */
export function redactCloudflareCredentials(text: string): string {
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
  const value = token ? String(text).split(token).join('[redacted]') : String(text);
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bcf[a-z]{1,3}_[A-Za-z0-9_-]{12,}/g, '[redacted]');
}

/** The diagnostic for a failure that names a missing Cloudflare setting, else null. Checked before any generic rule. */
export function cloudflareConfigurationDiagnostic(message: string) {
  if (!/CLOUDFLARE_(?:ACCOUNT_ID|API_TOKEN|ZONE_ID)/i.test(message)) return null;
  return {
    message: 'La publication est momentanément indisponible : l’hébergement n’est pas encore configuré sur le serveur. Votre projet est conservé.',
    diagnostic_code: 'CLOUDFLARE_NOT_CONFIGURED',
    suggested_action: 'configure_cloudflare',
    status: 503,
  };
}
