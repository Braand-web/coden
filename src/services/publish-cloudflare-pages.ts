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

type Verification = { verified: boolean; baseUrl: string; checks: Array<{ url: string; status: number; ok: boolean; error?: string }> };
type VerifyTargets = { codenUrl: string | null; defaultUrl: string; deploymentUrl: string };

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
  verify: (targets, routes) => verifyVercelDeployment(targets, routes),
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
  /** Called as soon as Cloudflare created the deployment, before any verification (to leave a record behind). */
  onDeployed?: (deployment: { id: string; url: string }) => Promise<void>;
  onPhase?: (phase: string) => void;
}, deps: CloudflarePagesDeps = defaultDeps): Promise<CloudflarePagesPublishResult> {
  const phase = (name: string) => params.onPhase?.(name);
  const cfName = projectSlugToCfName(params.slug);
  const project = await deps.ensureProject(cfName);
  const productionHost = project.subdomain && /\.pages\.dev$/i.test(project.subdomain) ? project.subdomain : `${cfName}.pages.dev`;
  const defaultUrl = `https://${productionHost}`;
  phase('cloudflare_project_ready');

  const deployment = await deps.deploy(cfName, params.distDir);
  phase('cloudflare_deployed');
  await params.onDeployed?.(deployment);

  // The deployment's own address first: it reflects exactly this upload. A just-created site can need a moment.
  const targets: VerifyTargets = { codenUrl: null, defaultUrl, deploymentUrl: deployment.url };
  let verification = await deps.verify(targets, params.publicRoutes);
  for (let attempt = 0; attempt < 5 && !verification.verified; attempt += 1) {
    await deps.wait(1_500 * (attempt + 1));
    verification = await deps.verify(targets, params.publicRoutes);
  }
  phase('verified');
  if (!verification.verified) {
    // The new deployment is already the production one: put the previous one back when there is one.
    if (params.previousDeploymentId) {
      await deps.rollback(cfName, params.previousDeploymentId).catch((error: any) => {
        console.warn('[coden:cloudflare_rollback_failed]', { project: cfName, message: String(error?.message || error).slice(0, 200) });
      });
    }
    throw new Error(`Cloudflare deployment could not be verified (${summarize(verification.checks) || 'no response'}).`);
  }

  // The Coden address: a few seconds of patience, never a reason to fail a site that is already online.
  const host = codenHostForSlug(params.slug);
  let codenUrl: string | null = null;
  try {
    await deps.attachDomain(cfName, host);
    await deps.upsertCname(codenSubdomainForSlug(params.slug), `${cfName}.pages.dev`);
    phase('domain_attached');
    for (let attempt = 0; attempt < 5 && !codenUrl; attempt += 1) {
      await deps.wait(2_000);
      const live = await deps.verify({ codenUrl: `https://${host}`, defaultUrl: '', deploymentUrl: '' }, params.publicRoutes);
      if (live.verified) codenUrl = `https://${host}`;
    }
  } catch (error: any) {
    console.warn('[coden:cloudflare_domain_pending]', { project: cfName, host, message: String(error?.message || error).slice(0, 200) });
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

export const CLOUDFLARE_PUBLISH_VARIABLES = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ZONE_ID_CODEN_FUN'] as const;

/** Which Cloudflare settings are missing, by name only (a value is never read out). */
export function missingCloudflareSettings(env: Record<string, string | undefined> = process.env): string[] {
  return CLOUDFLARE_PUBLISH_VARIABLES.filter(name => !String(env[name] || '').trim());
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
