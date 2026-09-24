/**
 * Where generated code runs when it must not run here: an E2B microVM.
 *
 * The host sandbox executes a project's `npm install`, type-checker and dev
 * server as child processes of the Coden server — the process that holds the
 * OpenRouter key, the Supabase service role and every other platform secret.
 * In production that is refused (SECURE_SANDBOX_REQUIRED), and with it the
 * whole agent: no install, no live preview, no browser checks, no repair loop.
 *
 * This moves execution, and only execution, into a Firecracker microVM per
 * project:
 *
 *   - The project's files stay on the host, where the agent's tools already
 *     read and write them; writing a file executes nothing. Before every
 *     command the changed files are pushed to the VM, so the VM always runs
 *     exactly what the agent wrote.
 *   - Commands and the dev server run in the VM with the project's own
 *     environment and nothing else. The VM never receives a platform secret:
 *     there is none in it to steal.
 *   - The preview is the VM's HTTPS port, reached through Coden's preview
 *     proxy, so the Builder's iframe, hot reload and the browser checks keep
 *     the URL they already use.
 *   - A VM lives while it is used. Idle, it is released; it also expires on
 *     its own, so a Coden restart cannot leave one running.
 *
 * Enabled by `E2B_API_KEY`. `CODEN_E2B_TEMPLATE` selects a template (one with
 * the scaffolds' dependencies preinstalled makes the first install near
 * instant); the default image has Node.js.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** The slice of the E2B SDK this uses, so tests can stand in for it. */
export type RemoteSandboxClient = {
  sandboxId: string;
  files: {
    write(entries: Array<{ path: string; data: string | ArrayBuffer }>): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  commands: {
    run(cmd: string, opts: Record<string, unknown>): Promise<any>;
  };
  getHost(port: number): string;
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<boolean>;
};

export type RemoteSandboxFactory = (options: {
  template?: string;
  timeoutMs: number;
  metadata: Record<string, string>;
  envs: Record<string, string>;
}) => Promise<RemoteSandboxClient>;

export type RemoteCommandResult = { code: number | null; output: string; timedOut: boolean };

const APP_DIR = '/home/user/app';
const SKIP = new Set(['node_modules', '.npm-cache', '.git', 'dist', '.vite', '.next', 'coverage']);
const DEV_PORT = 5173;
const READY_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|[\w.-]+):(\d{2,5})/i;
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

export function remoteSandboxConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(String(env.E2B_API_KEY || '').trim()) && env.CODEN_SANDBOX_PROVIDER !== 'local';
}

/**
 * The VM image, built by Coden itself so enabling E2B takes a key and nothing
 * else: Node 22, plus the scaffolds' dependencies preinstalled under
 * /opt/coden-deps, which each new VM copies before its first install — so
 * that install only fetches what the project added. E2B caches the build by
 * content: an unchanged image is not rebuilt.
 */
export const CODEN_TEMPLATE_NAME = 'coden-vite-node22';
const PREINSTALLED_DEPS = '/opt/coden-deps';
let templateReady: Promise<string | undefined> | null = null;

export function prepareRemoteTemplate(manifest: Record<string, unknown>): Promise<string | undefined> {
  if (process.env.CODEN_E2B_TEMPLATE) return Promise.resolve(process.env.CODEN_E2B_TEMPLATE);
  templateReady ??= (async () => {
    try {
      const { Template } = await import('e2b');
      const packageJson = JSON.stringify({ name: 'coden-deps', private: true, ...manifest });
      const template = Template()
        .fromNodeImage('22')
        .runCmd([
          `mkdir -p ${PREINSTALLED_DEPS}`,
          `cat > ${PREINSTALLED_DEPS}/package.json <<'CODEN_JSON'\n${packageJson}\nCODEN_JSON`,
          `cd ${PREINSTALLED_DEPS} && npm install --ignore-scripts --no-audit --no-fund`,
          `chmod -R a+rX ${PREINSTALLED_DEPS}`,
        ], { user: 'root' });
      await Template.build(template as any, CODEN_TEMPLATE_NAME, { apiKey: process.env.E2B_API_KEY, cpuCount: 2, memoryMB: 2048 } as any);
      console.info('[coden:e2b_template_ready]', { template: CODEN_TEMPLATE_NAME });
      return CODEN_TEMPLATE_NAME;
    } catch (error: any) {
      // The default image still works; the first install is just slower.
      console.warn('[coden:e2b_template_failed]', { message: String(error?.message || error).slice(0, 300) });
      templateReady = null;
      return undefined;
    }
  })();
  return templateReady;
}

/** The E2B SDK, loaded only when a VM is actually needed. */
export const e2bFactory: RemoteSandboxFactory = async options => {
  const { Sandbox } = await import('e2b');
  const template = options.template ?? await (templateReady ?? Promise.resolve(undefined));
  const opts = {
    apiKey: process.env.E2B_API_KEY,
    timeoutMs: options.timeoutMs,
    metadata: options.metadata,
    envs: options.envs,
    allowInternetAccess: true,
  };
  const sandbox = template ? await Sandbox.create(template, opts) : await Sandbox.create(opts);
  // Start from the preinstalled tree when the image has one.
  await sandbox.commands.run(
    `mkdir -p ${APP_DIR} && if [ -d ${PREINSTALLED_DEPS}/node_modules ] && [ ! -d ${APP_DIR}/node_modules ]; then cp -r ${PREINSTALLED_DEPS}/node_modules ${APP_DIR}/; fi`,
    { timeoutMs: 120_000 },
  ).catch(() => undefined);
  return sandbox as unknown as RemoteSandboxClient;
};

let activeFactory: RemoteSandboxFactory = e2bFactory;
/** Swap the VM provider (tests use an in-memory stand-in). Returns the previous one. */
export function setRemoteSandboxFactory(factory: RemoteSandboxFactory): RemoteSandboxFactory {
  const previous = activeFactory;
  activeFactory = factory;
  return previous;
}

/** One shell word, quoted so nothing in it is interpreted. */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The environment a VM process gets: the project's variables, and ours for Node. */
export function remoteEnv(projectEnv: Record<string, string>, domain = process.env.E2B_DOMAIN || 'e2b.app'): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(projectEnv)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (/^(?:PATH|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_.+)$/i.test(key)) continue;
    env[key] = String(value);
  }
  return {
    ...env,
    NODE_ENV: 'development',
    CI: '1',
    NO_COLOR: '1',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    // Vite refuses requests for a Host it does not know; the preview arrives
    // on the VM's public host name.
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: `.${domain}`,
  };
}

// Bytes, not text: an image or a font written as UTF-8 arrives corrupted.
async function hostFiles(dir: string): Promise<Map<string, Buffer>> {
  const found = new Map<string, Buffer>();
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), rel);
      else found.set(rel, await readFile(path.join(current, entry.name)));
    }
  };
  await walk(dir, '');
  return found;
}

const digest = (content: Buffer) => createHash('sha256').update(content).digest('hex');
const toArrayBuffer = (content: Buffer): ArrayBuffer => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;

export class RemoteExecutor {
  private client: RemoteSandboxClient | null = null;
  private creating: Promise<RemoteSandboxClient> | null = null;
  /** What the VM holds, by path and content hash, as of the last sync. */
  private synced = new Map<string, string>();
  private server: { kill(): Promise<boolean> } | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private lastExtendedAt = 0;
  /** The package.json this VM last installed successfully, by hash. */
  installedManifest: string | null = null;

  readonly projectId: string;
  private readonly hostDir: string;
  private readonly factory: RemoteSandboxFactory;
  private readonly options: { vmTimeoutMs?: number; idleReleaseMs?: number; template?: string };

  // Plain fields, not parameter properties: Node's type stripping runs this file as-is.
  constructor(
    projectId: string,
    hostDir: string,
    factory: RemoteSandboxFactory = activeFactory,
    options: { vmTimeoutMs?: number; idleReleaseMs?: number; template?: string } = {},
  ) {
    this.projectId = projectId;
    this.hostDir = hostDir;
    this.factory = factory;
    this.options = options;
  }

  private get vmTimeoutMs() { return this.options.vmTimeoutMs ?? Number(process.env.CODEN_E2B_TIMEOUT_MS || 30 * 60_000); }
  private get idleReleaseMs() { return this.options.idleReleaseMs ?? Number(process.env.CODEN_E2B_IDLE_RELEASE_MS || 5 * 60_000); }

  get sandboxId(): string | null { return this.client?.sandboxId ?? null; }

  private async vm(env: Record<string, string>): Promise<RemoteSandboxClient> {
    this.cancelRelease();
    if (this.client) {
      // Kept alive while in use; throttled so a burst of commands is one call.
      if (Date.now() - this.lastExtendedAt > 60_000) {
        this.lastExtendedAt = Date.now();
        await this.client.setTimeout(this.vmTimeoutMs).catch(() => undefined);
      }
      return this.client;
    }
    this.creating ??= this.factory({
      template: this.options.template ?? (process.env.CODEN_E2B_TEMPLATE || undefined),
      timeoutMs: this.vmTimeoutMs,
      metadata: { coden_project: this.projectId },
      envs: remoteEnv(env),
    }).then(client => {
      this.client = client;
      this.synced.clear();
      this.installedManifest = null;
      this.lastExtendedAt = Date.now();
      return client;
    }).finally(() => { this.creating = null; });
    return this.creating;
  }

  /** Push what changed on the host since the last sync; remove what was deleted. */
  async sync(env: Record<string, string> = {}): Promise<{ written: number; removed: number }> {
    const client = await this.vm(env);
    const files = await hostFiles(this.hostDir);
    const changed: Array<{ path: string; data: ArrayBuffer }> = [];
    const hashes = new Map<string, string>();
    for (const [rel, content] of files) {
      const hash = digest(content);
      hashes.set(rel, hash);
      if (this.synced.get(rel) !== hash) changed.push({ path: `${APP_DIR}/${rel}`, data: toArrayBuffer(content) });
    }
    const removed = [...this.synced.keys()].filter(rel => !files.has(rel));
    for (let index = 0; index < changed.length; index += 50) {
      await client.files.write(changed.slice(index, index + 50));
    }
    for (const rel of removed) await client.files.remove(`${APP_DIR}/${rel}`).catch(() => undefined);
    this.synced = hashes;
    return { written: changed.length, removed: removed.length };
  }

  /** Run one command to completion in the VM, with the project's files current. */
  async run(
    binary: string,
    args: readonly string[],
    options: { env?: Record<string, string>; timeoutMs: number; signal?: AbortSignal; onOutput?: (stream: 'stdout' | 'stderr', text: string) => void },
  ): Promise<RemoteCommandResult> {
    options.signal?.throwIfAborted();
    await this.sync(options.env);
    const client = await this.vm(options.env || {});
    let output = '';
    const collect = (stream: 'stdout' | 'stderr') => (data: string) => {
      output = (output + data).slice(-256_000);
      options.onOutput?.(stream, data);
    };
    try {
      const result = await client.commands.run([binary, ...args].map(shellQuote).join(' '), {
        cwd: APP_DIR,
        envs: remoteEnv(options.env || {}),
        timeoutMs: options.timeoutMs,
        signal: options.signal,
        onStdout: collect('stdout'),
        onStderr: collect('stderr'),
      });
      return { code: Number(result?.exitCode ?? 0), output: output || `${result?.stdout || ''}${result?.stderr || ''}`, timedOut: false };
    } catch (error: any) {
      if (options.signal?.aborted) throw new Error('Command cancelled.');
      // A non-zero exit is a result, not a failure of the runner.
      if (typeof error?.exitCode === 'number') {
        return { code: error.exitCode, output: output || `${error.stdout || ''}${error.stderr || ''}`, timedOut: false };
      }
      if (/timeout|deadline/i.test(String(error?.name || '') + String(error?.message || ''))) {
        return { code: null, output, timedOut: true };
      }
      throw error;
    }
  }

  /**
   * Start the dev server in the VM and resolve with its public origin once it
   * reports its URL. The caller probes the origin before calling it ready.
   */
  async startServer(options: {
    script: string;
    basePath: string;
    env?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
    onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
    onExit?: (code: number | null) => void;
  }): Promise<{ port: number; origin: string }> {
    await this.stopServer();
    await this.sync(options.env);
    const client = await this.vm(options.env || {});
    const args = ['npm', 'run', options.script, '--', '--host', '0.0.0.0', '--port', String(DEV_PORT), '--strictPort'];
    if (options.basePath) args.push(`--base=${options.basePath}`);
    let resolveReady!: (port: number) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<number>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const scan = (stream: 'stdout' | 'stderr') => (data: string) => {
      options.onOutput?.(stream, data);
      const match = READY_URL.exec(data.replace(ANSI, ''));
      if (match) resolveReady(Number(match[1]) || DEV_PORT);
    };
    const handle = await client.commands.run(args.map(shellQuote).join(' '), {
      background: true,
      cwd: APP_DIR,
      envs: remoteEnv(options.env || {}),
      timeoutMs: 0,
      onStdout: scan('stdout'),
      onStderr: scan('stderr'),
    });
    this.server = handle;
    void Promise.resolve(handle?.wait?.()).then(
      (result: any) => { if (this.server === handle) { this.server = null; options.onExit?.(Number(result?.exitCode ?? 0)); } rejectReady(new Error('The dev server exited before it was ready.')); },
      (error: any) => { if (this.server === handle) { this.server = null; options.onExit?.(typeof error?.exitCode === 'number' ? error.exitCode : null); } rejectReady(new Error(`The dev server exited before it was ready${typeof error?.exitCode === 'number' ? ` (code ${error.exitCode})` : ''}.`)); },
    );
    const timer = setTimeout(() => rejectReady(new Error(`The dev server did not report a URL within ${Math.round(options.timeoutMs / 1000)}s.`)), options.timeoutMs);
    const onAbort = () => rejectReady(new Error('Preview start cancelled.'));
    options.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const port = await ready;
      return { port, origin: `https://${client.getHost(port)}` };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Stop the dev server; the VM is released if nothing uses it again soon. */
  async stopServer(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (server) await server.kill().catch(() => false);
    this.scheduleRelease();
  }

  private scheduleRelease() {
    this.cancelRelease();
    if (!this.client) return;
    this.releaseTimer = setTimeout(() => { void this.destroy(); }, this.idleReleaseMs);
    this.releaseTimer.unref?.();
  }

  private cancelRelease() {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
  }

  /** Release the VM now. Its files are the host's; nothing is lost. */
  async destroy(): Promise<void> {
    this.cancelRelease();
    const client = this.client;
    this.client = null;
    this.server = null;
    this.synced.clear();
    this.installedManifest = null;
    if (client) await client.kill().catch(() => false);
  }
}
