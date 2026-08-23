/**
 * Cloudflare Workers + Pages compatibility publishing service.
 *
 * Uses the Cloudflare REST API to:
 *   1. Create (idempotent) a Pages project per Coden app.
 *   2. Direct-upload a built `dist/` folder as a new deployment.
 *   3. Attach a `<slug>.coden.fun` custom domain to the Pages project.
 *   4. Create a CNAME record pointing that subdomain to `<project>.pages.dev`.
 *
 * All secrets read from Railway env vars — nothing Lovable-side.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  attachWorkerCustomDomain,
  getWorkerDomainStatus,
  publishFullstackProjectToCloudflareWorkers,
  publishProjectToCloudflareWorkers,
  removeCloudflareWorker,
} from './publish-cloudflare-workers';
import type { GeneratedAppRuntime } from './generated-app-runtime.ts';
import {
  hostingProviderForTarget,
  resolveCloudflareHostingTarget,
  type CloudflareHostingProvider,
} from './cloudflare-hosting-policy.ts';

const CF_API = 'https://api.cloudflare.com/client/v4';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function accountId() { return env('CLOUDFLARE_ACCOUNT_ID'); }
function apiToken() { return env('CLOUDFLARE_API_TOKEN'); }
function codenZoneId() { return env('CLOUDFLARE_ZONE_ID_CODEN_FUN'); }

export const CODEN_ROOT_DOMAIN = process.env.CODEN_ROOT_DOMAIN || 'coden.fun';

async function cf<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok || json?.success === false) {
    const msg = json?.errors?.[0]?.message || json?.message || `Cloudflare ${res.status}`;
    const err = new Error(msg) as any;
    err.statusCode = res.status;
    err.cfErrors = json?.errors;
    throw err;
  }
  return (json?.result ?? json) as T;
}

export function projectSlugToCfName(slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `coden-${safe}`.slice(0, 58);
}

export async function ensurePagesProject(cfName: string): Promise<{ name: string; subdomain: string }> {
  try {
    const p = await cf<any>(`/accounts/${accountId()}/pages/projects/${cfName}`);
    return { name: p.name, subdomain: p.subdomain };
  } catch (e: any) {
    if (e.statusCode !== 404) throw e;
  }
  const created = await cf<any>(`/accounts/${accountId()}/pages/projects`, {
    method: 'POST',
    body: JSON.stringify({ name: cfName, production_branch: 'main' }),
  });
  return { name: created.name, subdomain: created.subdomain };
}

/** Walk a directory and return { relativePath -> absolutePath } for all files. */
function walkFiles(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) {
        const rel = '/' + path.relative(root, abs).split(path.sep).join('/');
        out[rel] = abs;
      }
    }
  }
  walk(root);
  return out;
}

/**
 * Direct-upload deployment. Uses the JWT-based direct upload endpoint.
 * Docs: https://developers.cloudflare.com/pages/platform/direct-upload/
 */
export async function deployDirectory(cfName: string, distDir: string): Promise<{ id: string; url: string }> {
  if (!fs.existsSync(distDir)) throw new Error(`dist directory not found: ${distDir}`);

  // Step 1: obtain upload JWT
  const jwt = await cf<string>(`/accounts/${accountId()}/pages/projects/${cfName}/upload-token`);

  // Step 2: hash + prepare manifest
  const files = walkFiles(distDir);
  const manifest: Record<string, string> = {};
  const payloads: Record<string, { base64: string; metadata: { contentType: string } }> = {};
  for (const [rel, abs] of Object.entries(files)) {
    const buf = fs.readFileSync(abs);
    const hash = crypto.createHash('blake2b256' as any).update(buf).digest('hex').slice(0, 32);
    manifest[rel] = hash;
    payloads[hash] = {
      base64: buf.toString('base64'),
      metadata: { contentType: guessContentType(rel) },
    };
  }

  // Step 3: check which files are missing
  const missing = await fetch(`${CF_API}/pages/assets/check-missing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes: Object.values(manifest) }),
  }).then(r => r.json()).then((j: any) => j?.result || []);

  // Step 4: upload missing in batches
  const batchSize = 5;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize).map((h: string) => ({
      key: h,
      value: payloads[h].base64,
      metadata: payloads[h].metadata,
      base64: true,
    }));
    const upRes = await fetch(`${CF_API}/pages/assets/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: batch }),
    });
    if (!upRes.ok) throw new Error(`Asset upload failed: ${upRes.status} ${await upRes.text()}`);
  }

  // Step 5: create deployment (multipart) — trigger deployment referencing manifest
  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest));
  form.append('branch', 'main');

  const deployRes = await fetch(`${CF_API}/accounts/${accountId()}/pages/projects/${cfName}/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken()}` },
    body: form as any,
  });
  const deployJson: any = await deployRes.json();
  if (!deployRes.ok || deployJson?.success === false) {
    throw new Error(deployJson?.errors?.[0]?.message || `Deployment failed: ${deployRes.status}`);
  }
  const dep = deployJson.result;
  return { id: dep.id, url: dep.url };
}

export async function attachCustomDomain(cfName: string, domain: string): Promise<void> {
  try {
    await cf(`/accounts/${accountId()}/pages/projects/${cfName}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    });
  } catch (e: any) {
    // 409 = already attached — ignore
    if (e.statusCode !== 409 && !/already/i.test(e.message)) throw e;
  }
}

export async function upsertCnameOnCodenFun(subdomain: string, target: string): Promise<void> {
  const zoneId = codenZoneId();
  const name = `${subdomain}.${CODEN_ROOT_DOMAIN}`;
  const existing = await cf<any[]>(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`);
  const record = { type: 'CNAME', name, content: target, ttl: 1, proxied: true };
  if (existing?.length) {
    await cf(`/zones/${zoneId}/dns_records/${existing[0].id}`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
  } else {
    await cf(`/zones/${zoneId}/dns_records`, {
      method: 'POST',
      body: JSON.stringify(record),
    });
  }
}

export interface PublishResult {
  provider: CloudflareHostingProvider;
  runtime: GeneratedAppRuntime;
  cfName: string;
  subdomain: string;             // pages.dev subdomain
  defaultUrl: string;            // https://<project>.pages.dev
  codenUrl: string;              // https://<slug>.coden.fun
  deploymentId: string;
  deploymentUrl: string;
}

export type DeploymentHttpCheck = {
  url: string;
  status: number;
  ok: boolean;
  error?: string;
};

const wait = (durationMs: number) => new Promise(resolve => setTimeout(resolve, durationMs));

export async function verifyCloudflareDeployment(
  result: PublishResult,
  routePaths: string[] = ['/'],
  fetchImpl: typeof fetch = fetch,
): Promise<{ verified: boolean; baseUrl: string; checks: DeploymentHttpCheck[] }> {
  const bases = Array.from(new Set([
    result.deploymentUrl,
    result.defaultUrl,
    result.codenUrl,
  ].filter(Boolean).map(value => String(value).replace(/\/$/, ''))));
  const routes = Array.from(new Set(['/', ...routePaths]))
    .filter(route => route.startsWith('/') && !route.includes(':') && !route.includes('*'))
    .slice(0, 4);
  const checks: DeploymentHttpCheck[] = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const baseUrl of bases) {
      const attemptChecks: DeploymentHttpCheck[] = [];
      for (const route of routes) {
        const url = new URL(route, `${baseUrl}/`).toString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8_000);
        try {
          const response = await fetchImpl(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: { 'user-agent': 'Coden-Deployment-Verifier/1.0' },
          });
          attemptChecks.push({ url, status: response.status, ok: response.status >= 200 && response.status < 400 });
        } catch (error: any) {
          attemptChecks.push({ url, status: 0, ok: false, error: String(error?.message || error) });
        } finally {
          clearTimeout(timeout);
        }
      }
      checks.push(...attemptChecks);
      if (attemptChecks.length && attemptChecks.every(check => check.ok)) {
        return { verified: true, baseUrl, checks };
      }
    }
    if (attempt < 5) await wait(1_500 * (attempt + 1));
  }
  return { verified: false, baseUrl: '', checks };
}

export async function publishProjectToCloudflare(params: {
  slug: string;
  distDir: string;
  projectDir: string;
  runtime: GeneratedAppRuntime;
}): Promise<PublishResult> {
  const target = resolveCloudflareHostingTarget(params.runtime);
  if (target === 'workers-fullstack') {
    return publishFullstackProjectToCloudflareWorkers({
      slug: params.slug,
      projectDir: params.projectDir,
    });
  }
  if (target === 'workers-static-assets') {
    return publishProjectToCloudflareWorkers(params);
  }
  const cfName = projectSlugToCfName(params.slug);
  const { subdomain } = await ensurePagesProject(cfName);
  const dep = await deployDirectory(cfName, params.distDir);
  const codenSub = params.slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const codenHost = `${codenSub}.${CODEN_ROOT_DOMAIN}`;
  await attachCustomDomain(cfName, codenHost);
  await upsertCnameOnCodenFun(codenSub, `${cfName}.pages.dev`);
  return {
    provider: hostingProviderForTarget(target),
    runtime: params.runtime,
    cfName,
    subdomain,
    defaultUrl: `https://${cfName}.pages.dev`,
    codenUrl: `https://${codenHost}`,
    deploymentId: dep.id,
    deploymentUrl: dep.url,
  };
}

export async function attachUserCustomDomain(
  cfName: string,
  domain: string,
  runtime: GeneratedAppRuntime = 'static-assets',
) {
  if (resolveCloudflareHostingTarget(runtime) !== 'pages-legacy') {
    await attachWorkerCustomDomain(cfName, domain);
    return {
      domain,
      instructions: [
        { type: 'CNAME', name: domain, value: `${cfName}.workers.dev` },
      ],
    };
  }
  await attachCustomDomain(cfName, domain);
  return {
    domain,
    instructions: [
      { type: 'CNAME', name: domain, value: `${cfName}.pages.dev` },
    ],
  };
}

export async function getCustomDomainStatus(
  cfName: string,
  domain: string,
  runtime: GeneratedAppRuntime = 'static-assets',
) {
  if (resolveCloudflareHostingTarget(runtime) !== 'pages-legacy') {
    return getWorkerDomainStatus(cfName, domain);
  }
  const domains = await cf<any[]>(`/accounts/${accountId()}/pages/projects/${cfName}/domains`);
  const match = domains.find(d => d.name === domain);
  return {
    domain,
    status: match?.status || 'unknown',
    certificate_status: match?.certificate_authority || null,
    verification_data: match?.validation_data || null,
  };
}

export async function removePublication(
  cfName: string,
  codenSub?: string,
  runtime: GeneratedAppRuntime = 'static-assets',
) {
  if (resolveCloudflareHostingTarget(runtime) !== 'pages-legacy') {
    try { await removeCloudflareWorker(cfName); } catch { /* best-effort */ }
    return;
  }
  if (codenSub) {
    try {
      const existing = await cf<any[]>(`/zones/${codenZoneId()}/dns_records?name=${encodeURIComponent(`${codenSub}.${CODEN_ROOT_DOMAIN}`)}`);
      for (const r of existing || []) {
        await cf(`/zones/${codenZoneId()}/dns_records/${r.id}`, { method: 'DELETE' });
      }
    } catch { /* best-effort */ }
  }
  try {
    await cf(`/accounts/${accountId()}/pages/projects/${cfName}`, { method: 'DELETE' });
  } catch { /* best-effort */ }
}

function guessContentType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  const map: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
  };
  return map[ext] || 'application/octet-stream';
}
