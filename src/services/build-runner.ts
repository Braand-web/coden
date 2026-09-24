/**
 * Isolated Vite build runner for published apps.
 *
 * Given the source of a generated app (files map or a source directory),
 * writes it to a temp working directory, installs deps (if needed) and
 * runs `vite build`, returning the absolute path to the resulting `dist/`.
 *
 * For MVP: assumes the generated apps already ship as a bundled/static
 * `dist`-style folder (index.html + assets). If a full toolchain build is
 * required, plug in your own resolver here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export interface StaticSource {
  /** Map of relative path (with leading slash allowed) → file contents (utf8 or base64). */
  files: Record<string, { content: string; encoding?: 'utf8' | 'base64' }>;
}

export interface BuildOptions {
  workDir?: string;             // defaults to /tmp/coden-builds/<slug>
  runViteBuild?: boolean;       // if true, runs `npm run build` in workDir
  slug: string;
  outputDirectory?: string;     // manifest-controlled production output directory
  /** Explicit browser-safe values required while Vite builds the user app. */
  publicEnv?: Record<string, string>;
}

function ensureCleanDir(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

export function materializeStaticSource(src: StaticSource, targetDir: string) {
  ensureCleanDir(targetDir);
  for (const [relRaw, entry] of Object.entries(src.files)) {
    const rel = relRaw.replace(/^\/+/, '');
    const abs = path.resolve(targetDir, rel);
    const safeRoot = `${path.resolve(targetDir)}${path.sep}`;
    if (!abs.startsWith(safeRoot) && abs !== path.resolve(targetDir)) {
      throw new Error(`Refusing to materialize a path outside the build directory: ${relRaw}`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buf =
      entry.encoding === 'base64'
        ? Buffer.from(entry.content, 'base64')
        : Buffer.from(entry.content, 'utf8');
    fs.writeFileSync(abs, buf);
  }
}

const BASE_BUILD_ENV_KEYS = [
  'PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'SystemRoot', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
];

const INSTALL_NETWORK_ENV_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_noproxy', 'npm_config_cafile', 'npm_config_strict_ssl',
];

const PUBLIC_BUILD_ENV_NAME = /^(?:VITE_|PUBLIC_|NEXT_PUBLIC_)[A-Z0-9_]+$/;
const FORBIDDEN_PUBLIC_ENV_NAME = /(?:SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD|DATABASE_URL|OPENAI|ANTHROPIC|OPENROUTER|VERCEL_TOKEN|CLOUDFLARE|SASPAY)/i;

/**
 * Only explicitly supplied, browser-safe variables can enter generated code.
 * The Coden host process contains provider, database and billing secrets; a
 * generated `vite.config` must never be able to read them during its build.
 */
export function sanitizePublicBuildEnv(values: Record<string, string> = {}): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, rawValue] of Object.entries(values)) {
    if (!PUBLIC_BUILD_ENV_NAME.test(name) || FORBIDDEN_PUBLIC_ENV_NAME.test(name)) continue;
    const value = String(rawValue ?? '');
    if (value) safe[name] = value;
  }
  return safe;
}

function buildEnv(includeInstallNetwork = false, publicEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...BASE_BUILD_ENV_KEYS, ...(includeInstallNetwork ? INSTALL_NETWORK_ENV_KEYS : [])]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.NODE_ENV = 'production';
  env.CI = '1';
  env.NO_COLOR = '1';
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  env.npm_config_ignore_scripts = 'true';
  Object.assign(env, sanitizePublicBuildEnv(publicEnv));
  return env;
}

/**
 * Whether this process may run a generated app's build itself.
 *
 * `npm run build` executes generated JavaScript. Environment filtering is
 * useful defense-in-depth, but it is not a filesystem/process/network
 * boundary, so production only builds here behind a separate container/VM
 * worker. Everywhere else the build goes to the host's own isolated builders
 * (see `publishProjectToVercel`'s `buildOnProvider`).
 */
export function localBuildAllowed(env: Record<string, string | undefined> = process.env): boolean {
  return !(env.NODE_ENV === 'production' && env.CODEN_BUILD_RUNNER_ISOLATION !== 'container');
}

function assertSecureBuildRuntime(): void {
  if (!localBuildAllowed()) {
    throw new Error('SECURE_BUILD_RUNNER_REQUIRED: generated builds need an isolated container or VM runner.');
  }
}

function executable(cmd: string, args: string[]) {
  if (process.platform === 'win32' && cmd === 'npm') {
    const cli = process.env.npm_execpath && /npm-cli\.js$/i.test(process.env.npm_execpath) && existsSync(process.env.npm_execpath)
      ? process.env.npm_execpath
      : path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (existsSync(cli)) return { binary: process.execPath, args: [cli, ...args] };
  }
  return { binary: cmd, args };
}

function run(cmd: string, args: string[], cwd: string, env = buildEnv()): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = executable(cmd, args);
    const child = spawn(command.binary, command.args, { cwd, stdio: 'inherit', shell: false, env, windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });
}

/**
 * Build (or just stage) a generated app and return the dist directory to upload.
 *
 * If `runViteBuild` is true, executes `npm install && npm run build` so build
 * toolchains such as Vite and TanStack Start are available in clean runners.
 * inside `workDir` and returns the manifest-controlled output directory. Otherwise returns `workDir`
 * directly (assumes the source is already a static bundle).
 */
export async function buildStaticSource(src: StaticSource, opts: BuildOptions): Promise<string> {
  const workDir = opts.workDir || path.join('/tmp', 'coden-builds', opts.slug);
  materializeStaticSource(src, workDir);

  if (opts.runViteBuild) {
    assertSecureBuildRuntime();
    // Lifecycle scripts are arbitrary code from an untrusted generated app.
    // Keep them off during dependency installation and never inherit Coden's
    // provider, database, hosting or billing environment variables.
    await run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts'], workDir, buildEnv(true));
    await run('npm', ['run', 'build'], workDir, buildEnv(false, opts.publicEnv));
    const outputDirectory = String(opts.outputDirectory || 'dist').replace(/^[/\\]+/, '');
    const outputPath = path.resolve(workDir, outputDirectory);
    if (!outputPath.startsWith(`${path.resolve(workDir)}${path.sep}`) || !fs.existsSync(outputPath)) {
      throw new Error(`Build produced no ${outputDirectory}/ in ${workDir}`);
    }
    return outputPath;
  }

  return workDir;
}
