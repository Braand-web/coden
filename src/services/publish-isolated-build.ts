/** Generated build scripts run in a fresh microVM, never in the Coden server. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sanitizePublicBuildEnv, type StaticSource, type BuildOptions } from './build-runner.ts';
import { e2bFactory, remoteSandboxConfigured, type RemoteSandboxClient, type RemoteSandboxFactory } from './sandbox/remote-executor.ts';

const APP_DIR = '/home/user/app';
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const TIMEOUT_MS = 8 * 60_000;
type Asset = { path: string; size: number; sha256: string };
export type PublishBuildSandbox = RemoteSandboxClient & {
  files: RemoteSandboxClient['files'] & {
    read(path: string, options: { format: 'stream'; requestTimeoutMs: number; streamIdleTimeoutMs: number; signal: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
  };
};
type Factory = (options: Parameters<RemoteSandboxFactory>[0]) => Promise<PublishBuildSandbox>;
const factory: Factory = async options => {
  const vm = await e2bFactory(options);
  if (typeof (vm.files as any).read !== 'function') {
    await vm.kill().catch(() => false);
    throw new Error('ISOLATED_BUILD_UNAVAILABLE');
  }
  return vm as PublishBuildSandbox;
};

/** Reject paths that change meaning across Windows, Linux, URLs or Cloudflare. */
export function publicationRelativePath(value: string): string {
  if (!value || value.length > 500 || /[\\\x00-\x1f\x7f:*?]/.test(value) || value.startsWith('/')) throw new Error('INVALID_PUBLICATION_PATH');
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('INVALID_PUBLICATION_PATH');
  return value;
}

export function validatePublicationAssets(value: unknown): Asset[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_FILES) throw new Error('INVALID_BUILD_ARTIFACT');
  const seen = new Set<string>();
  let total = 0;
  const assets = value.map((raw: any) => {
    const relative = publicationRelativePath(String(raw?.path || ''));
    if (seen.has(relative.toLowerCase()) || !Number.isSafeInteger(raw.size) || raw.size < 0 || raw.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(raw.sha256)) throw new Error('INVALID_BUILD_ARTIFACT');
    // Static uploads must not silently execute Workers or leak build metadata/secrets.
    if (relative.split('/').some(p => /^\.env(?:\.|$)/i.test(p) || p === '.git' || p === 'node_modules') || /(?:^|\/)_worker\.js(?:\/|$)/.test(relative)) throw new Error('UNSAFE_STATIC_ARTIFACT');
    seen.add(relative.toLowerCase());
    total += raw.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('BUILD_ARTIFACT_LIMIT');
    return { path: relative, size: raw.size, sha256: raw.sha256 };
  });
  if (!seen.has('index.html')) throw new Error('BUILD_INDEX_MISSING');
  return assets;
}

const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
function enumerationScript(output: string): string {
  return `const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');
const root=p.resolve(${JSON.stringify(APP_DIR)},${JSON.stringify(output)}), app=${JSON.stringify(APP_DIR)};
if(!root.startsWith(app+'/') || fs.lstatSync(root).isSymbolicLink() || !fs.realpathSync(root).startsWith(app+'/')) throw Error('invalid output');
const assets=[];let total=0;
function walk(dir){for(const name of fs.readdirSync(dir)){const file=p.join(dir,name),s=fs.lstatSync(file);
if(s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) throw Error('unsafe output');
if(s.isDirectory()){walk(file);continue;}
if(s.size>${MAX_FILE_BYTES} || (total+=s.size)>${MAX_TOTAL_BYTES} || assets.length>=${MAX_FILES}) throw Error('output limit');
assets.push({path:p.relative(root,file).split(p.sep).join('/'),size:s.size,sha256:c.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
walk(root);process.stdout.write(JSON.stringify(assets));`;
}

export async function buildPublicationInMicroVM(
  source: StaticSource,
  options: BuildOptions & { projectId: string },
  deps: { factory?: Factory; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const env = deps.env || process.env;
  if (!remoteSandboxConfigured(env)) throw new Error('ISOLATED_BUILD_UNAVAILABLE');
  if (!options.workDir) throw new Error('PUBLICATION_WORK_DIRECTORY_REQUIRED');
  const output = publicationRelativePath(options.outputDirectory || 'dist');
  const entries: Array<{ path: string; data: ArrayBuffer }> = [];
  let sourceBytes = 0;
  const seen = new Set<string>();
  for (const [rawPath, file] of Object.entries(source.files)) {
    const rel = publicationRelativePath(rawPath.replace(/^\/+/, ''));
    if (seen.has(rel.toLowerCase())) throw new Error('INVALID_PUBLICATION_PATH');
    seen.add(rel.toLowerCase());
    const bytes = Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
    sourceBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_FILE_BYTES || sourceBytes > MAX_TOTAL_BYTES || entries.length >= MAX_FILES) throw new Error('BUILD_SOURCE_LIMIT');
    entries.push({ path: `${APP_DIR}/${rel}`, data: Uint8Array.from(bytes).buffer });
  }
  if (!seen.has('package.json')) throw new Error('BUILD_PACKAGE_MISSING');
  const publicEnv = sanitizePublicBuildEnv(options.publicEnv);
  const buildEnv = { ...publicEnv, NODE_ENV: 'production', CI: '1', NO_COLOR: '1', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_ignore_scripts: 'true' };
  const vm = await (deps.factory || factory)({
    template: env.CODEN_E2B_TEMPLATE || undefined, timeoutMs: TIMEOUT_MS,
    metadata: { coden_project: options.projectId, purpose: 'publication-build' },
    // Only browser-safe app configuration. The VM never receives hosting, E2B or platform credentials.
    envs: buildEnv,
  });
  try {
    await vm.files.write(entries);
    async function run(command: string, timeoutMs: number) {
      try {
        const result = await vm.commands.run(command, { cwd: APP_DIR, envs: buildEnv, timeoutMs });
        if (result.exitCode !== 0) throw new Error('build failed');
        return result;
      } catch { throw new Error('ISOLATED_PUBLICATION_BUILD_FAILED'); }
    }
    await run('npm install --ignore-scripts --include=dev --no-audit --no-fund', 180_000);
    await run('npm run build', 180_000);
    const listed = await run(`node -e ${quote(enumerationScript(output))}`, 30_000);
    if (String(listed.stdout || '').length > 1024 * 1024) throw new Error('BUILD_ARTIFACT_LIMIT');
    let assets: Asset[];
    try { assets = validatePublicationAssets(JSON.parse(listed.stdout)); }
    catch { throw new Error('INVALID_BUILD_ARTIFACT'); }
    // A fresh host directory receives bytes only. No generated code is run here.
    const destination = path.resolve(options.workDir, 'published-assets');
    await fs.mkdir(destination, { recursive: true });
    for (const asset of assets) {
      const stream = await vm.files.read(`${APP_DIR}/${output}/${asset.path}`, { format: 'stream', requestTimeoutMs: 30_000, streamIdleTimeoutMs: 15_000, signal: AbortSignal.timeout(30_000) });
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > asset.size || size > MAX_FILE_BYTES) throw new Error('BUILD_ARTIFACT_CHANGED');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => undefined); }
      const bytes = Buffer.concat(chunks);
      if (size !== asset.size || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('BUILD_ARTIFACT_CHANGED');
      const target = path.resolve(destination, asset.path);
      if (!target.startsWith(`${destination}${path.sep}`)) throw new Error('INVALID_PUBLICATION_PATH');
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' });
    }
    return destination;
  } finally {
    // The maximum VM lifetime also bounds cleanup failure; no unbounded idle build VM.
    await vm.kill().catch(() => false);
  }
}
