export type CodenRuntime = 'static' | 'vite' | 'node' | 'next' | 'cloudflare-worker' | 'fullstack';
export type CodenFramework = 'html' | 'react' | 'vue' | 'svelte' | 'next' | 'express' | 'hono' | 'other';
export type CodenPackageManager = 'npm' | 'pnpm' | 'yarn';
export type CodenDeploymentTarget = 'static' | 'cloudflare' | 'railway' | 'external';

export type CodenProjectManifest = {
  version: '1';
  projectId: string;
  name: string;
  runtime: CodenRuntime;
  framework?: CodenFramework;
  packageManager: CodenPackageManager;
  commands: {
    install: string;
    dev: string;
    build?: string;
    start?: string;
    test?: string;
    lint?: string;
    typecheck?: string;
  };
  preview: { port?: number; healthPath: string; readyPattern?: string };
  deployment: { target: CodenDeploymentTarget; outputDirectory?: string; startCommand?: string };
  environment: Array<{
    name: string;
    required: boolean;
    secret: boolean;
    scope: 'build' | 'runtime' | 'both';
    description: string;
  }>;
  capabilities: {
    auth: boolean;
    database: boolean;
    storage: boolean;
    realtime: boolean;
    payments: boolean;
    ai: boolean;
    fileUploads: boolean;
  };
};

export type ManifestFile = { path: string; content?: string };
export type RuntimeDetection = {
  runtime: CodenRuntime;
  framework: CodenFramework;
  packageManager: CodenPackageManager;
  confidence: number;
  evidence: string[];
};
export type ManifestValidation = { valid: boolean; errors: string[]; warnings: string[] };

const DANGEROUS_COMMAND = /(^|\s)(sudo|su|shutdown|reboot|mkfs|mount|umount|dd)(\s|$)|rm\s+-rf\s+[\/~]|:\(\)\s*\{/i;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

function fileMap(files: ManifestFile[]) {
  return new Map(files.map((file) => [file.path.replace(/\\/g, '/').replace(/^\.\//, ''), String(file.content || '')]));
}

function packageJson(files: ManifestFile[]) {
  const raw = fileMap(files).get('package.json');
  if (!raw) return null;
  try { return JSON.parse(raw) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; } catch { return null; }
}

export function detectProjectRuntime(files: ManifestFile[]): RuntimeDetection {
  const map = fileMap(files);
  const pkg = packageJson(files);
  const dependencies = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const evidence: string[] = [];
  const packageManager: CodenPackageManager = map.has('pnpm-lock.yaml') ? 'pnpm' : map.has('yarn.lock') ? 'yarn' : 'npm';
  if (map.has('coden.project.json')) {
    try {
      const manifest = JSON.parse(map.get('coden.project.json') || '') as CodenProjectManifest;
      const validation = validateProjectManifest(manifest);
      if (validation.valid) return { runtime: manifest.runtime, framework: manifest.framework || 'other', packageManager: manifest.packageManager, confidence: 1, evidence: ['valid coden.project.json'] };
      evidence.push(...validation.errors.map((error) => `invalid manifest: ${error}`));
    } catch {
      evidence.push('invalid manifest JSON');
    }
  }
  if (map.has('wrangler.jsonc') || map.has('wrangler.toml') || dependencies['wrangler'] || dependencies['@cloudflare/workers-types']) {
    return { runtime: 'cloudflare-worker', framework: dependencies['hono'] ? 'hono' : 'other', packageManager, confidence: .96, evidence: [...evidence, 'Cloudflare Worker configuration'] };
  }
  if (dependencies['next'] || map.has('next.config.js') || map.has('next.config.mjs') || map.has('next.config.ts')) {
    return { runtime: 'next', framework: 'next', packageManager, confidence: .97, evidence: [...evidence, 'Next.js dependency or configuration'] };
  }
  const hasFrontend = Boolean(dependencies['vite'] || map.has('vite.config.ts') || map.has('vite.config.js'));
  const hasBackend = Boolean(dependencies['express'] || dependencies['hono'] || map.has('server.ts') || map.has('server.js') || map.has('api/index.ts'));
  if (hasFrontend && hasBackend) return { runtime: 'fullstack', framework: dependencies['react'] ? 'react' : dependencies['vue'] ? 'vue' : dependencies['svelte'] ? 'svelte' : 'other', packageManager, confidence: .9, evidence: [...evidence, 'frontend and backend entrypoints'] };
  if (hasFrontend) return { runtime: 'vite', framework: dependencies['react'] ? 'react' : dependencies['vue'] ? 'vue' : dependencies['svelte'] ? 'svelte' : 'other', packageManager, confidence: .94, evidence: [...evidence, 'Vite dependency or configuration'] };
  if (pkg) return { runtime: 'node', framework: dependencies['express'] ? 'express' : dependencies['hono'] ? 'hono' : 'other', packageManager, confidence: .78, evidence: [...evidence, 'package.json without browser build framework'] };
  return { runtime: 'static', framework: 'html', packageManager, confidence: map.has('index.html') ? .98 : .62, evidence: [...evidence, map.has('index.html') ? 'static index.html' : 'no package manifest'] };
}

export function validateProjectManifest(value: unknown): ManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!value || typeof value !== 'object') return { valid: false, errors: ['manifest must be an object'], warnings };
  const manifest = value as Partial<CodenProjectManifest>;
  if (manifest.version !== '1') errors.push('version must be "1"');
  if (!String(manifest.projectId || '').trim()) errors.push('projectId is required');
  if (!String(manifest.name || '').trim()) errors.push('name is required');
  if (!['static', 'vite', 'node', 'next', 'cloudflare-worker', 'fullstack'].includes(String(manifest.runtime))) errors.push('runtime is unsupported');
  if (!['npm', 'pnpm', 'yarn'].includes(String(manifest.packageManager))) errors.push('packageManager is unsupported');
  if (!manifest.commands?.install || !manifest.commands?.dev) errors.push('install and dev commands are required');
  for (const [name, command] of Object.entries(manifest.commands || {})) {
    if (command && DANGEROUS_COMMAND.test(command)) errors.push(`commands.${name} contains a blocked system operation`);
  }
  if (!manifest.preview?.healthPath?.startsWith('/')) errors.push('preview.healthPath must start with /');
  if (manifest.preview?.port !== undefined && (!Number.isInteger(manifest.preview.port) || manifest.preview.port < 1 || manifest.preview.port > 65535)) errors.push('preview.port is invalid');
  const seen = new Set<string>();
  for (const item of manifest.environment || []) {
    if (!ENV_NAME.test(item.name)) errors.push(`environment variable ${item.name} has an invalid name`);
    if (seen.has(item.name)) errors.push(`environment variable ${item.name} is duplicated`);
    seen.add(item.name);
    if (item.secret && /^(VITE_|NEXT_PUBLIC_|PUBLIC_)/.test(item.name)) warnings.push(`${item.name} is marked secret but uses a public-client prefix`);
  }
  if (manifest.runtime === 'static' && manifest.deployment?.target === 'railway') warnings.push('static projects should normally deploy to Cloudflare');
  if ((manifest.runtime === 'node' || manifest.runtime === 'next' || manifest.runtime === 'fullstack') && manifest.deployment?.target === 'static') errors.push('server runtimes cannot use a static deployment target');
  return { valid: errors.length === 0, errors, warnings };
}

export function createProjectManifest(input: { projectId: string; name: string; files: ManifestFile[] }): CodenProjectManifest {
  const detected = detectProjectRuntime(input.files);
  const map = fileMap(input.files);
  const manager = detected.packageManager;
  const run = manager === 'npm' ? 'npm run' : `${manager} run`;
  const install = manager === 'npm'
    ? (map.has('package-lock.json') || map.has('npm-shrinkwrap.json') ? 'npm ci' : 'npm install')
    : manager === 'pnpm'
      ? (map.has('pnpm-lock.yaml') ? 'pnpm install --frozen-lockfile' : 'pnpm install')
      : (map.has('yarn.lock') ? 'yarn install --frozen-lockfile' : 'yarn install');
  const pkg = packageJson(input.files);
  const scripts = pkg?.scripts || {};
  const deploymentTarget: CodenDeploymentTarget = detected.runtime === 'static' || detected.runtime === 'vite' || detected.runtime === 'cloudflare-worker' ? 'cloudflare' : 'railway';
  return {
    version: '1',
    projectId: input.projectId,
    name: input.name,
    runtime: detected.runtime,
    framework: detected.framework,
    packageManager: manager,
    commands: {
      install: detected.runtime === 'static' ? 'true' : install,
      dev: detected.runtime === 'static' ? 'static-preview' : scripts.dev ? `${run} dev` : `${run} start`,
      build: scripts.build ? `${run} build` : undefined,
      start: scripts.start ? `${run} start` : undefined,
      test: scripts.test ? `${run} test` : undefined,
      lint: scripts.lint ? `${run} lint` : undefined,
      typecheck: scripts.typecheck ? `${run} typecheck` : undefined,
    },
    preview: { port: detected.runtime === 'static' ? 4173 : detected.runtime === 'next' ? 3000 : detected.runtime === 'cloudflare-worker' ? 8787 : 5173, healthPath: '/' },
    deployment: {
      target: deploymentTarget,
      outputDirectory: detected.runtime === 'vite' ? 'dist' : detected.runtime === 'static' ? '.' : undefined,
      startCommand: deploymentTarget === 'railway' ? (scripts.start ? `${run} start` : undefined) : undefined,
    },
    environment: [],
    capabilities: { auth: false, database: false, storage: false, realtime: false, payments: false, ai: false, fileUploads: false },
  };
}

export function serializeProjectManifest(manifest: CodenProjectManifest) {
  const validation = validateProjectManifest(manifest);
  if (!validation.valid) throw new Error(`Invalid Coden project manifest: ${validation.errors.join('; ')}`);
  return JSON.stringify(manifest, null, 2) + '\n';
}
