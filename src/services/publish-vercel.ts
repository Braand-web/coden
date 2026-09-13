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

function collectFiles(root: string): Array<{ file: string; data: string; encoding: 'base64' }> {
  if (!fs.existsSync(root)) throw new Error(`Build output not found: ${root}`);
  const output: Array<{ file: string; data: string; encoding: 'base64' }> = [];
  let totalBytes = 0;

  function visit(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      // Dependencies are installed by Vercel and must never be uploaded from
      // the Coden build worker. This also keeps the inline deployment below
      // Vercel's payload limit and prevents generated package code from being
      // mixed with the host service's modules.
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
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Vercel build exceeds the 50 MB inline deployment limit.');
      output.push({ file: safeRelativeFilePath(root, absolute), data: buffer.toString('base64'), encoding: 'base64' });
    }
  }

  visit(root);
  if (!output.length) throw new Error('Vercel build output is empty.');
  return output;
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

function prepareVercelSource(sourceDir: string, runtime: string): void {
  const entry = findServerEntry(sourceDir);
  const dynamic = /node|server|fullstack|cloudflare|next/i.test(String(runtime || ''));
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
  if (!/export\s+default\s+/m.test(patched) && /(?:const|let|var)\s+app\s*=/.test(patched)) {
    patched += '\nexport default app;\n';
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
        const response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': 'Coden-Vercel-Deployment-Verifier/1.0' } });
        const check = { url, status: response.status, ok: response.status >= 200 && response.status < 300 };
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
}): Promise<VercelPublishResult> {
  const projectName = vercelProjectNameForSlug(params.slug);
  const deploymentRoot = params.sourceDir || params.distDir;
  if (params.sourceDir) prepareVercelSource(params.sourceDir, params.runtime);
  const files = collectFiles(deploymentRoot);
  const outputDirectory = String(params.outputDirectory || 'dist').replace(/^[/\\]+/, '') || '.';
  const projectSettings = params.sourceDir
    ? {
        framework: null,
        buildCommand: 'true',
        installCommand: 'npm install --ignore-scripts --no-audit --no-fund',
        outputDirectory,
      }
    : { framework: null };
  const deployment = await vercelRequest<VercelDeployment>('/v13/deployments', {
    method: 'POST',
    body: JSON.stringify({
      name: projectName,
      target: 'production',
      files,
      projectSettings,
      meta: { coden: 'true', codenSlug: slugify(params.slug) },
    }),
  }, { forceNew: 1, skipAutoDetectionConfirmation: 1 });

  if (!deployment?.id) throw new Error('Vercel did not return a deployment id.');
  const ready = await waitForDeployment(deployment.id);
  const deploymentUrl = asHttpsUrl(ready.url || deployment.url);
  if (!deploymentUrl) throw new Error('Vercel did not return a deployment URL.');

  const host = vercelCodenHostForSlug(params.slug);
  // A Vercel deployment is usable through its vercel.app URL even when the
  // optional coden.fun domain still needs DNS verification. Domain setup must
  // never turn a successful application deployment into a publish failure.
  let domain = { verified: false, verification: [] as any[] };
  try {
    domain = await attachCodenDomain(projectName, host);
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

export async function promoteVercelDeployment(project: string, deploymentId: string): Promise<void> {
  await vercelRequest(`/v10/projects/${encodeURIComponent(project)}/promote/${encodeURIComponent(deploymentId)}`, { method: 'POST' });
}
