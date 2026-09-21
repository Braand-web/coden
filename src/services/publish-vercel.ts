/**
 * Vercel publisher for generated Coden applications.
 *
 * The publisher deliberately uses Vercel's REST API instead of the CLI so the
 * Railway service stays deterministic and does not need to install a second
 * global tool for every deploy. Builds are produced and security-checked by
 * Coden first; static builds and serverless-compatible source are then sent
 * to Vercel through the same production deployment path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizePublicBuildEnv } from './build-runner.ts';

const VERCEL_API = 'https://api.vercel.com';
const DEFAULT_ROOT_DOMAIN = 'coden.fun';
const MAX_FILES = 10_000;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export type VercelDeploymentState = 'QUEUED' | 'INITIALIZING' | 'BUILDING' | 'READY' | 'ERROR' | 'CANCELED' | string;

export type VercelPublishResult = {
  provider: 'vercel';
  runtime: string;
  projectName: string;
  projectId: string | null;
  defaultUrl: string;
  codenUrl: string | null;
  deploymentId: string;
  deploymentUrl: string;
  customDomain: string | null;
  customDomainVerified: boolean;
  customDomainVerification: Array<{ type?: string; domain?: string; value?: string; reason?: string }>;
};

type VercelDeployment = {
  id?: string;
  name?: string;
  projectId?: string;
  url?: string;
  readyState?: VercelDeploymentState;
  errorCode?: string;
  errorMessage?: string;
};

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}. Configure the Vercel publishing credentials on the server.`);
  return value;
}

function teamQuery(): string {
  const teamId = String(process.env.VERCEL_TEAM_ID || '').trim();
  const teamSlug = String(process.env.VERCEL_TEAM_SLUG || '').trim();
  if (teamId) return `teamId=${encodeURIComponent(teamId)}`;
  if (teamSlug) return `slug=${encodeURIComponent(teamSlug)}`;
  return '';
}

function apiUrl(resource: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  const team = teamQuery();
  if (team) {
    const [key, value] = team.split('=');
    params.set(key, decodeURIComponent(value || ''));
  }
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return `${VERCEL_API}${resource}${suffix ? `?${suffix}` : ''}`;
}

function redactProviderMessage(value: unknown): string {
  return String(value || 'Vercel request failed')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(?:token|secret|key)["'=: ]+[^\s,}"']+/gi, '$1 [redacted]');
}

async function vercelRequest<T = any>(resource: string, init: RequestInit = {}, query: Record<string, string | number | undefined> = {}): Promise<T> {
  const response = await fetch(apiUrl(resource, query), {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv('VERCEL_TOKEN')}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!response.ok) {
    const providerError = payload?.error || payload;
    const error = new Error(redactProviderMessage(providerError?.message || `Vercel request failed (${response.status})`)) as any;
    error.statusCode = response.status;
    error.providerCode = providerError?.code || payload?.errorCode || null;
    throw error;
  }
  return payload as T;
}

function slugify(value: string): string {
  const safe = String(value || 'coden-app')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (safe || 'coden-app').slice(0, 48);
}

export function vercelProjectNameForSlug(slug: string): string {
  return `coden-${slugify(slug)}`.slice(0, 52);
}

export function vercelProjectUrlForSlug(slug: string): string {
  return `https://${vercelProjectNameForSlug(slug)}.vercel.app`;
}

function rootDomain(): string {
  return String(process.env.VERCEL_ROOT_DOMAIN || process.env.CODEN_ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN)
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.+$/, '')
    .toLowerCase() || DEFAULT_ROOT_DOMAIN;
}

export function vercelCodenHostForSlug(slug: string): string {
  return `${slugify(slug)}.${rootDomain()}`;
}

function asHttpsUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return `https://${raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '')}`;
}

function safeRelativeFilePath(root: string, absolute: string): string {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || relative.includes('/../') || path.isAbsolute(relative)) {
    throw new Error('Vercel publish refused a file outside the build output.');
  }
  return relative;
}

export type VercelUploadFile = { file: string; sha: string; size: number; data: Buffer };

function uploadFileRecord(file: string, data: Buffer): VercelUploadFile {
  return {
    file: file.replace(/^\/+/, ''),
    sha: createHash('sha1').update(data).digest('hex'),
    size: data.byteLength,
    data,
  };
}

function collectFiles(root: string, prefix = ''): VercelUploadFile[] {
  if (!fs.existsSync(root)) throw new Error(`Build output not found: ${root}`);
  const output: VercelUploadFile[] = [];
  let totalBytes = 0;

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // Dependencies are installed by Vercel and must never be uploaded from
      // the Coden build worker. This also prevents generated package code from
      // being mixed with the host service's modules.
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.vercel') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (output.length >= MAX_FILES) throw new Error(`Vercel build contains more than ${MAX_FILES} files.`);
      const buffer = fs.readFileSync(absolute);
      totalBytes += buffer.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Vercel build exceeds the 50 MB deployment limit.');
      const relative = safeRelativeFilePath(root, absolute);
      output.push(uploadFileRecord([prefix.replace(/\/+$/, ''), relative].filter(Boolean).join('/'), buffer));
    }
  }

  visit(root);
  if (!output.length) throw new Error('Vercel build output is empty.');
  return output;
}

/** Build Output API v3 layout for an already verified static build. */
export function collectStaticBuildOutput(distDir: string): VercelUploadFile[] {
  const files = collectFiles(distDir, '.vercel/output/static');
  const hasIndex = files.some(file => file.file === '.vercel/output/static/index.html');
  const config = {
    version: 3 as const,
    routes: hasIndex
      ? [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/index.html' }]
      : [{ handle: 'filesystem' }],
  };
  files.push(uploadFileRecord('.vercel/output/config.json', Buffer.from(`${JSON.stringify(config, null, 2)}\n`, 'utf8')));
  return files;
}

async function uploadDeploymentFile(file: VercelUploadFile): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(apiUrl('/v2/files'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requiredEnv('VERCEL_TOKEN')}`,
        'Content-Type': 'application/octet-stream',
        'x-vercel-digest': file.sha,
      },
      body: file.data as unknown as BodyInit,
    });
    if (response.ok) {
      await response.body?.cancel();
      return;
    }
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      continue;
    }
    const providerError = payload?.error || payload;
    const error = new Error(redactProviderMessage(providerError?.message || `Vercel file upload failed (${response.status})`)) as any;
    error.statusCode = response.status;
    error.providerCode = providerError?.code || null;
    throw error;
  }
}

async function uploadDeploymentFiles(files: VercelUploadFile[]): Promise<void> {
  // Identical contents share one immutable SHA blob on Vercel. Uploading each
  // digest once avoids needless requests without changing the deployment map.
  const unique = Array.from(new Map(files.map(file => [file.sha, file])).values());
  let cursor = 0;
  const workers = Array.from({ length: Math.min(6, unique.length) }, async () => {
    while (cursor < unique.length) {
      const file = unique[cursor++];
      await uploadDeploymentFile(file);
    }
  });
  await Promise.all(workers);
}

function findServerEntry(sourceDir: string): string | null {
  const candidates = [
    'api/index.ts', 'api/index.js', 'api/index.mts', 'api/index.mjs',
    'server/index.ts', 'server/index.js', 'server/server.ts', 'server/server.js',
    'server/app.ts', 'server/app.js', 'server.ts', 'server.js',
    'src/server.ts', 'src/server.js',
  ];
  return candidates
    .map(candidate => path.join(sourceDir, candidate))
    .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function stripServerListen(source: string): string {
  // Generated Node apps conventionally start with app.listen(...). A Vercel
  // function owns the HTTP socket, so importing that call would bind a second
  // port and make the function fail. Keep this narrow and line-oriented so
  // arbitrary business code is not rewritten.
  return source.replace(/^\s*(?:await\s+)?(?:app|server)\.listen\([\s\S]*?\);?\s*$/gm, '');
}

export function createVercelFunctionAdapter(importPath: string): string {
  return `import exportedApp from '${importPath}';

const app: any = (exportedApp as any)?.default || exportedApp;

export default async function handler(req: any, res: any) {
  if (typeof app === 'function') return app(req, res);
  if (app && typeof app.callback === 'function') return app.callback()(req, res);
  if (app && typeof app.ready === 'function' && typeof app.routing === 'function') {
    await app.ready();
    return app.routing(req, res);
  }
  if (app && typeof app.handle === 'function') return app.handle(req, res);
  if (app && typeof app.fetch === 'function') {
    const protocol = String(req.headers?.['x-forwarded-proto'] || 'https');
    const host = String(req.headers?.host || 'localhost');
    const requestUrl = new URL(String(req.url || '/'), \`${'${'}protocol}://${'${'}host}\`);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (Array.isArray(value)) headers.set(key, value.join(', '));
      else if (value !== undefined) headers.set(key, String(value));
    }
    const method = String(req.method || 'GET').toUpperCase();
    const request = new Request(requestUrl, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : req,
      // Node's IncomingMessage is a readable stream and can be consumed by
      // Fetch-compatible runtimes without buffering arbitrary request bodies.
      duplex: 'half' as any,
    } as any);
    const response = await app.fetch(request, process.env, {});
    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  res.statusCode = 500;
  res.end('Generated server does not expose an Express or Fetch handler.');
}
`;
}

export function prepareVercelSource(sourceDir: string, runtime: string): void {
  // TanStack Start is compiled by Nitro into native Vercel Functions. A
  // generic Node adapter would duplicate its server entry and break routing.
  if (runtime === 'vercel-functions') return;
  const entry = findServerEntry(sourceDir);
  const dynamic = /node|server|fullstack|next/i.test(String(runtime || ''));
  if (!dynamic || !entry) return;

  const relativeEntry = path.relative(sourceDir, entry).split(path.sep).join('/');
  const existingApiEntry = /^api\/index\.(?:ts|js|mts|mjs)$/i.test(relativeEntry);
  if (existingApiEntry) return;

  const extension = path.extname(relativeEntry) || '.ts';
  const entryDirectory = path.dirname(relativeEntry);
  const adapterName = entryDirectory === '.' ? `server.vercel${extension}` : `${entryDirectory}/vercel-entry${extension}`;
  const adapterAbsolute = path.join(sourceDir, adapterName);
  const original = fs.readFileSync(entry, 'utf8');
  let patched = stripServerListen(original);
  if (!/export\s+default\s+/m.test(patched)) {
    const appName = patched.match(/(?:const|let|var)\s+(app|server)\s*=/)?.[1];
    if (appName) patched += `\nexport default ${appName};\n`;
  }
  fs.mkdirSync(path.dirname(adapterAbsolute), { recursive: true });
  fs.writeFileSync(adapterAbsolute, patched, 'utf8');

  const apiDir = path.join(sourceDir, 'api');
  fs.mkdirSync(apiDir, { recursive: true });
  const importPath = `../${adapterName.replace(/\.(?:ts|js|mts|mjs)$/i, '')}`;
  fs.writeFileSync(path.join(apiDir, 'index.ts'), createVercelFunctionAdapter(importPath), 'utf8');
}

function verificationList(value: unknown): Array<{ type?: string; domain?: string; value?: string; reason?: string }> {
  return Array.isArray(value)
    ? value.slice(0, 4).map(item => ({
        type: typeof item?.type === 'string' ? item.type : undefined,
        domain: typeof item?.domain === 'string' ? item.domain : undefined,
        value: typeof item?.value === 'string' ? item.value : undefined,
        reason: typeof item?.reason === 'string' ? item.reason : undefined,
      }))
    : [];
}

async function attachCodenDomain(project: string, host: string) {
  try {
    const added = await vercelRequest<any>(`/v10/projects/${encodeURIComponent(project)}/domains`, {
      method: 'POST',
      body: JSON.stringify({ name: host }),
    });
    return {
      verified: Boolean(added?.verified),
      verification: verificationList(added?.verification),
    };
  } catch (error: any) {
    // Re-publishing the same Coden project should be idempotent. A domain that
    // already exists is read back below; any other error is kept as a pending
    // domain so a DNS problem never hides a successful Vercel deployment.
    if (!/already|exists|not_modified|conflict/i.test(String(error?.message || ''))) throw error;
    try {
      const existing = await vercelRequest<any>(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(host)}`);
      return {
        verified: Boolean(existing?.verified),
        verification: verificationList(existing?.verification),
      };
    } catch {
      return { verified: false, verification: [] };
    }
  }
}

async function waitForCodenDomain(
  project: string,
  host: string,
  initial: { verified: boolean; verification: Array<{ type?: string; domain?: string; value?: string; reason?: string }> },
) {
  if (initial.verified) return initial;
  let latest = initial;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, Math.min(2_000, 500 + attempt * 125)));
    try {
      const current = await vercelRequest<any>(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(host)}`);
      latest = {
        verified: Boolean(current?.verified),
        verification: verificationList(current?.verification),
      };
      if (latest.verified) return latest;
    } catch (error: any) {
      // Domain creation can be eventually consistent. Keep polling on a 404;
      // authentication and configuration errors must still fail immediately.
      if (Number(error?.statusCode || 0) !== 404) throw error;
    }
  }
  return latest;
}

async function waitForDeployment(deploymentId: string): Promise<VercelDeployment> {
  let current = await vercelRequest<VercelDeployment>(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
  for (let attempt = 0; attempt < 45; attempt += 1) {
    const state = String(current?.readyState || '').toUpperCase();
    if (state === 'READY') return current;
    if (state === 'ERROR' || state === 'CANCELED' || state === 'CANCELLED') {
      throw new Error(`Vercel deployment failed${current.errorMessage ? `: ${redactProviderMessage(current.errorMessage)}` : '.'}`);
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(2_000, 500 + attempt * 50)));
    current = await vercelRequest<VercelDeployment>(`/v13/deployments/${encodeURIComponent(deploymentId)}`);
  }
  throw new Error('Vercel deployment did not become ready before the timeout.');
}

export async function verifyVercelDeployment(
  result: Pick<VercelPublishResult, 'defaultUrl' | 'deploymentUrl' | 'codenUrl'>,
  routePaths: string[] = ['/'],
  fetchImpl: typeof fetch = fetch,
): Promise<{ verified: boolean; baseUrl: string; checks: Array<{ url: string; status: number; ok: boolean; error?: string }> }> {
  const bases = Array.from(new Set([result.codenUrl, result.defaultUrl, result.deploymentUrl].filter(Boolean))) as string[];
  const routes = Array.from(new Set(['/', ...routePaths]))
    .filter(route => /^\/(?!\/)/.test(route) && !/[\\:*]/.test(route))
    .slice(0, 4);
  const checks: Array<{ url: string; status: number; ok: boolean; error?: string }> = [];
  for (const base of bases) {
    const attemptChecks: Array<{ url: string; status: number; ok: boolean; error?: string }> = [];
    for (const route of routes) {
      const url = new URL(route, `${base.replace(/\/+$/, '')}/`).toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8_000);
      try {
        const protectionBypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
        const headers: Record<string, string> = { 'user-agent': 'Coden-Vercel-Deployment-Verifier/1.0' };
        if (protectionBypass) headers['x-vercel-protection-bypass'] = protectionBypass;
        const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal, headers });
        const redirectedToLogin = /(?:^|\.)vercel\.com\/login/i.test(response.url || '');
        const check = { url, status: response.status, ok: response.status >= 200 && response.status < 300 && !redirectedToLogin };
        attemptChecks.push(check);
        await response.body?.cancel();
      } catch (error: any) {
        attemptChecks.push({ url, status: 0, ok: false, error: String(error?.message || error) });
      } finally {
        clearTimeout(timeout);
      }
    }
    checks.push(...attemptChecks);
    if (attemptChecks.length && attemptChecks.every(check => check.ok)) return { verified: true, baseUrl: base, checks };
  }
  return { verified: false, baseUrl: '', checks };
}

export async function publishProjectToVercel(params: {
  slug: string;
  distDir: string;
  runtime: string;
  sourceDir?: string;
  outputDirectory?: string;
  publicEnv?: Record<string, string>;
}): Promise<VercelPublishResult> {
  const projectName = vercelProjectNameForSlug(params.slug);
  const sourceDeployment = Boolean(params.sourceDir) && params.runtime !== 'static-assets';
  const deploymentRoot = sourceDeployment ? params.sourceDir! : params.distDir;
  if (sourceDeployment) prepareVercelSource(deploymentRoot, params.runtime);
  const files = sourceDeployment ? collectFiles(deploymentRoot) : collectStaticBuildOutput(params.distDir);
  await uploadDeploymentFiles(files);
  const outputDirectory = String(params.outputDirectory || 'dist').replace(/^[/\\]+/, '') || '.';
  const projectSettings = sourceDeployment
    ? {
        framework: params.runtime === 'vercel-functions' ? 'tanstack-start' : null,
        buildCommand: 'npm run build',
        installCommand: 'npm install --ignore-scripts --no-audit --no-fund',
        ...(params.runtime === 'node-server' ? { outputDirectory } : {}),
      }
    : { framework: null };
  const publicEnv = sanitizePublicBuildEnv(params.publicEnv);
  const deployment = await vercelRequest<VercelDeployment>('/v13/deployments', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      target: 'production',
      files: files.map(({ file, sha, size }) => ({ file, sha, size })),
      projectSettings,
      ...(Object.keys(publicEnv).length ? { env: publicEnv, build: { env: publicEnv } } : {}),
      meta: { coden: 'true', codenSlug: slugify(params.slug) },
    }),
  }, { forceNew: 1, skipAutoDetectionConfirmation: 1 });

  if (!deployment?.id) throw new Error('Vercel did not return a deployment id.');
  const ready = await waitForDeployment(deployment.id);
  const deploymentUrl = asHttpsUrl(ready.url || deployment.url);
  if (!deploymentUrl) throw new Error('Vercel did not return a deployment URL.');

  const host = vercelCodenHostForSlug(params.slug);
  // Coden publication is complete only once the platform-owned hostname is
  // confirmed by Vercel. The vercel.app deployment remains an implementation
  // detail and is never presented as a successful Coden publication.
  let domain = { verified: false, verification: [] as any[] };
  try {
    const attached = await attachCodenDomain(projectName, host);
    domain = await waitForCodenDomain(projectName, host, attached);
  } catch (error: any) {
    console.warn('[coden:vercel_domain_pending]', {
      project: projectName,
      domain: host,
      message: error?.message || 'Vercel custom domain setup failed',
    });
  }
  const codenUrl = domain.verified ? `https://${host}` : null;
  const defaultUrl = vercelProjectUrlForSlug(params.slug);

  return {
    provider: 'vercel',
    runtime: params.runtime,
    projectName,
    projectId: ready.projectId || null,
    defaultUrl,
    codenUrl,
    deploymentId: ready.id || deployment.id,
    deploymentUrl,
    customDomain: domain.verified ? host : null,
    customDomainVerified: domain.verified,
    customDomainVerification: domain.verification,
  };
}

export async function attachVercelCustomDomain(project: string, domain: string) {
  const result = await attachCodenDomain(project, domain);
  return {
    domain,
    verified: result.verified,
    instructions: result.verification.map(record => ({
      type: (record.type || 'CNAME') as 'A' | 'CNAME' | 'TXT',
      name: record.domain || domain,
      value: record.value || '',
    })),
  };
}

export async function getVercelCustomDomainStatus(project: string, domain: string) {
  const result = await vercelRequest<any>(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`);
  return {
    domain,
    status: result?.verified ? 'active' : 'pending',
    certificate_status: result?.verified ? 'issued' : 'pending',
    verification_data: verificationList(result?.verification),
  };
}

export async function removeVercelCustomDomain(project: string, domain: string): Promise<void> {
  await vercelRequest(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
}

async function resolveVercelProjectId(project: string): Promise<string | null> {
  try {
    const record = await vercelRequest<any>(`/v9/projects/${encodeURIComponent(project)}`);
    return String(record?.id || '').trim() || null;
  } catch (error: any) {
    if (Number(error?.statusCode || 0) === 404) return null;
    throw error;
  }
}

/**
 * Pause the provider project after Coden's subscription grace period.
 * Pausing leaves deployments and source intact while making every Vercel
 * alias return 503, including the direct `vercel.app` URL that cannot pass
 * through Coden's entitlement middleware.
 */
export async function pauseVercelProject(project: string): Promise<'paused' | 'missing'> {
  const projectId = await resolveVercelProjectId(project);
  if (!projectId) return 'missing';
  try {
    await vercelRequest(`/v1/projects/${encodeURIComponent(projectId)}/pause`, { method: 'POST' });
  } catch (error: any) {
    // Some Vercel API versions answer conflict when the desired state was
    // already reached. Treat only that idempotent condition as success.
    if (Number(error?.statusCode) !== 409) throw error;
  }
  return 'paused';
}

/** Reactivate an intact provider project after a paid subscription resumes. */
export async function unpauseVercelProject(project: string): Promise<'active' | 'missing'> {
  const projectId = await resolveVercelProjectId(project);
  if (!projectId) return 'missing';
  try {
    await vercelRequest(`/v1/projects/${encodeURIComponent(projectId)}/unpause`, { method: 'POST' });
  } catch (error: any) {
    // Vercel treats an already-active project as a conflict on some API
    // versions. The desired state is already reached, so keep publication
    // idempotent while still surfacing every other provider failure.
    if (Number(error?.statusCode || 0) !== 409) throw error;
  }
  return 'active';
}

export async function promoteVercelDeployment(project: string, deploymentId: string): Promise<void> {
  await vercelRequest(`/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(deploymentId)}`, { method: 'POST' });
}
