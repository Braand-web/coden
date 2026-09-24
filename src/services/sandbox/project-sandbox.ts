/**
 * One project, one directory, one dev server.
 *
 * This is the piece the preview was missing. Before it, generated code was
 * stored in the database and re-implemented in the browser by a hand-written
 * module loader on top of Babel: React was pinned to whatever the loader's
 * import map said, every other dependency was fetched from a CDN per import,
 * and nothing the project declared in package.json was ever installed. A
 * "preview" could therefore succeed while the real application did not build,
 * and fail while it did.
 *
 * Here the project is written to disk, its own dependencies are installed, and
 * its own dev server runs it. What the preview shows is the application.
 *
 * The lifecycle is explicit because every state in it is one a user can see
 * and wait on:
 *
 *   idle -> installing -> starting -> running -> stopped
 *                                        |
 *                                     crashed
 *
 * Restarts are deliberate, not automatic. A dev server with hot reload does
 * not need restarting when a component changes -- that is the whole point of
 * it -- so `writeFiles` never touches the process. Only the caller, on the
 * signals that genuinely require it (a new dependency, a changed config),
 * asks for a restart.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, writeFile, readFile, rm, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { decideCommand } from './command-policy.ts';
import { resolveInSandbox, sandboxDir } from './paths.ts';
import { restoreDependencies, saveDependencies } from './dependency-cache.ts';
import { RemoteExecutor, remoteSandboxConfigured } from './remote-executor.ts';
import { createHash } from 'node:crypto';

const manifestHash = (manifest: string) => createHash('sha256').update(manifest).digest('hex');

export type SandboxState = 'idle' | 'installing' | 'starting' | 'running' | 'stopped' | 'crashed';

export type SandboxFile = { path: string; content: string };

export type SandboxLog = { stream: 'stdout' | 'stderr' | 'system'; line: string; at: number };

export type SandboxStatus = {
  projectId: string;
  state: SandboxState;
  url: string | null;
  port: number | null;
  pid: number | null;
  lastError: string | null;
  /** The prefix the dev server was told to serve under, so the proxy agrees with it. */
  basePath: string | null;
  /** Where the dev server answers when it runs in a remote VM (https://…); null when local. */
  origin: string | null;
  startedAt: number | null;
  lastUsedAt: number;
};

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_START_TIMEOUT_MS = 90_000;
const MAX_LOG_LINES = 400;

/** Whether generated code may run here at all. The pipeline needs it; the legacy path does not. */
export function hostSandboxExecutionAllowed(): boolean {
  // An E2B microVM is the isolation boundary: code runs there, never here.
  if (remoteSandboxConfigured()) return true;
  return process.env.NODE_ENV !== 'production' || process.env.CODEN_SANDBOX_ISOLATION === 'container';
}

function assertHostSandboxExecutionAllowed(): void {
  if (!hostSandboxExecutionAllowed()) {
    throw new Error('SECURE_SANDBOX_REQUIRED: generated code execution needs an isolated container or VM runner.');
  }
}

/**
 * The URL a dev server prints when it is ready.
 *
 * Read from stdout rather than assumed, because the port a server actually
 * binds is not the port it was asked for: Vite walks forward when one is
 * taken, and a project may configure its own. The value we proxy has to be the
 * one the process reports, or the preview points at someone else's server.
 */
const READY_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/i;

/** Strip ANSI colour so a printed URL is still matchable. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
function plain(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * What a sandboxed process needs to exist: a shell's worth of context, and
 * nothing that identifies us to anyone.
 */
const BASE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'USER', 'SystemRoot', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'];

/** Launch npm through Node on Windows: no .cmd shell interpolation of tool arguments. */
function executable(binary: string, args: readonly string[]) {
  if (process.platform === 'win32' && binary === 'npm') {
    const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
    const cli = candidates.find(value => value && /npm-cli\.js$/i.test(value) && existsSync(value));
    if (!cli) throw new Error('NPM_EXECUTABLE_UNAVAILABLE');
    return { binary:process.execPath, args:[cli,...args] };
  }
  return { binary, args:[...args] };
}

/**
 * How this host reaches the network.
 *
 * Deliberately separate from the list above, because it is the one category
 * that is tempting to wave through wholesale and must not be. A sandbox behind
 * a corporate or agent proxy cannot resolve the npm registry without the
 * proxy address and the CA bundle that signs it -- dropping them turns every
 * install into `SELF_SIGNED_CERT_IN_CHAIN`, which reads like a broken sandbox
 * rather than a missing variable.
 *
 * These are routing and trust configuration, not credentials. Everything that
 * authenticates *us* -- provider keys, the Supabase service role, Cloudflare
 * and cloud tokens -- stays in the parent process, which is why this is a list
 * of names and not a prefix match.
 */
const NETWORK_ENV_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy',
  'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_noproxy',
  'npm_config_cafile', 'npm_config_registry', 'npm_config_strict_ssl',
];

/**
 * The environment a sandboxed process gets.
 *
 * An allow-list: the parent process holds provider keys, the Supabase service
 * role and Cloudflare credentials, and a generated project has no business
 * reading any of them. Only what a package manager and a dev server need to
 * function is passed through, plus the project's own variables.
 */
function sandboxEnv(extra: Record<string, string> = {}, npmCache?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...BASE_ENV_KEYS, ...NETWORK_ENV_KEYS]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const projectEnv: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (/^(?:PATH|PATHEXT|COMSPEC|SHELL|NODE_OPTIONS|NODE_PATH|NPM_CONFIG_.+)$/i.test(key)) continue;
    projectEnv[key] = String(value);
  }
  return {
    ...env,
    ...projectEnv,
    NODE_ENV: 'development',
    CI: '1',
    NO_COLOR: '1',
    // The cache stores integrity-addressed registry blobs, not project files.
    // Keeping one cache per runner avoids repeated downloads; retry logic
    // below verifies it before retrying a damaged or interrupted entry.
    npm_config_cache: npmCache || process.env.CODEN_SANDBOX_NPM_CACHE || path.join(os.tmpdir(), 'coden-npm-cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_prefer_offline: 'true',
    npm_config_fetch_retries: '3',
    npm_config_fetch_retry_factor: '2',
  };
}

export class ProjectSandbox {
  readonly projectId: string;
  readonly dir: string;

  private state: SandboxState = 'idle';
  private child: ChildProcessWithoutNullStreams | null = null;
  private port: number | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  /** The path prefix the proxy mounts this server under, and the base it emits. */
  private basePath = '';
  private logs: SandboxLog[] = [];
  private env: Record<string, string> = {};
  /** Set when execution happens in an isolated VM rather than on this host. */
  private readonly remote: RemoteExecutor | null;
  private origin: string | null = null;
  /** Serialises install/start/stop so two requests cannot race the process. */
  private queue: Promise<unknown> = Promise.resolve();

  lastUsedAt = Date.now();

  constructor(projectId: string) {
    this.projectId = projectId;
    this.dir = sandboxDir(projectId);
    this.remote = remoteSandboxConfigured() ? new RemoteExecutor(projectId, this.dir) : null;
  }

  /** Whether commands and the dev server run in an isolated VM. */
  get isRemote(): boolean {
    return Boolean(this.remote);
  }

  // -- state -----------------------------------------------------------

  status(): SandboxStatus {
    return {
      projectId: this.projectId,
      state: this.state,
      url: this.origin || (this.port ? `http://127.0.0.1:${this.port}` : null),
      basePath: this.basePath || null,
      origin: this.origin,
      port: this.port,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      startedAt: this.startedAt,
      lastUsedAt: this.lastUsedAt,
    };
  }

  /**
   * Record that the dev server cannot be reached, even though this object
   * still believes it is running.
   *
   * `child.on('close')` is the only thing that corrects the state, and it
   * fires only when Node itself reaps the child. A server whose process
   * survives but whose socket is gone — OOM-killed inside its own tree, a port
   * taken over, a container that restarted the process group out from under us
   * — leaves `state: 'running'` and a port pointing at nothing. The proxy then
   * fails on every request, forever, and `resumeLivePreview` keeps reattaching
   * to it because the status says running: the one thing that would fix it,
   * an automatic restart, is never triggered.
   *
   * So the proxy tells the sandbox when reality disagrees with it, and the
   * next status read sends the client down the restart path instead.
   */
  /**
   * The preview is being looked at. Locally that only postpones idle
   * eviction; in a VM it also keeps the machine itself alive, and finds out
   * when it is not — the next status read then sends the page to a restart
   * instead of an iframe pointed at a machine that no longer exists.
   */
  touch(): void {
    this.lastUsedAt = Date.now();
    if (!this.remote) return;
    void this.remote.keepAlive().then(alive => {
      if (!alive) this.markUnreachable('La machine de l’aperçu a expiré ; elle est recréée au prochain démarrage.');
    }).catch(() => undefined);
  }

  markUnreachable(reason: string): void {
    if (this.state !== 'running' && this.state !== 'starting') return;
    this.state = 'crashed';
    this.port = null;
    this.origin = null;
    this.lastError = reason;
    this.log('system', `Preview unreachable: ${reason}`);
  }

  getLogs(limit = 120): SandboxLog[] {
    return this.logs.slice(-Math.max(1, limit));
  }

  setEnv(vars: Record<string, string>): void {
    // Per project, never shared: this is what keeps one generated app's
    // Supabase keys out of another's process.
    this.env = { ...vars };
  }

  private log(stream: SandboxLog['stream'], line: string): void {
    for (const part of plain(line).split(/\r?\n/)) {
      const text = part.trimEnd();
      if (!text) continue;
      this.logs.push({ stream, line: text, at: Date.now() });
    }
    if (this.logs.length > MAX_LOG_LINES) this.logs = this.logs.slice(-MAX_LOG_LINES);
  }

  /** Run `task` after whatever is already queued, whether that succeeded or not. */
  private serialise<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // -- files -----------------------------------------------------------

  async writeFiles(files: readonly SandboxFile[]): Promise<string[]> {
    this.lastUsedAt = Date.now();
    await mkdir(this.dir, { recursive: true });
    const written: string[] = [];
    for (const file of files || []) {
      if (!file || typeof file.path !== 'string') continue;
      const target = resolveInSandbox(this.projectId, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, typeof file.content === 'string' ? file.content : '', 'utf8');
      written.push(file.path);
    }
    return written;
  }

  async readProjectFile(relativePath: string): Promise<string> {
    this.lastUsedAt = Date.now();
    return readFile(resolveInSandbox(this.projectId, relativePath), 'utf8');
  }

  async deleteProjectFile(relativePath: string): Promise<void> {
    this.lastUsedAt = Date.now();
    await rm(resolveInSandbox(this.projectId, relativePath), {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 5 : 0,
      retryDelay: 100,
    });
  }

  /** Every project file, excluding what a package manager owns. */
  async listFiles(): Promise<string[]> {
    this.lastUsedAt = Date.now();
    const skip = new Set(['node_modules', '.npm-cache', '.git', 'dist', '.vite', '.next', 'coverage']);
    const found: string[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (skip.has(entry.name) || entry.isSymbolicLink()) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
        else found.push(rel);
      }
    };
    await walk(this.dir, '');
    return found.sort();
  }

  /**
   * Whether this project's dependencies are installed where its code runs.
   * Locally that is the host's node_modules; in a VM it is what the VM itself
   * installed for the current package.json — the host holds no node_modules.
   */
  async hasDependencies(): Promise<boolean> {
    if (this.remote) {
      const manifest = await this.readProjectFile('package.json').catch(() => '');
      return Boolean(manifest) && this.remote.installedManifest === manifestHash(manifest);
    }
    return (await this.hasFile('node_modules/.package-lock.json')) || (await this.hasFile('node_modules/.bin'));
  }

  async hasFile(relativePath: string): Promise<boolean> {
    try {
      await stat(resolveInSandbox(this.projectId, relativePath));
      return true;
    } catch { return false; }
  }

  // -- commands --------------------------------------------------------

  /**
   * Run a command to completion inside the sandbox.
   *
   * `allowReview` is the caller taking responsibility for a command that
   * fetches and runs third-party code -- an install. Nothing blocked by the
   * policy can be unlocked by it.
   */
  runCommand(
    binary: string,
    args: readonly string[],
    options: { timeoutMs?: number; allowReview?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ code: number | null; output: string; timedOut: boolean }> {
    const installCommand = binary === 'npm' && ['install', 'i', 'ci', 'add'].includes(String(args[0] || ''));
    const effectiveArgs = installCommand
      ? [...args, ...['--ignore-scripts', '--no-audit', '--no-fund'].filter(flag => !args.includes(flag))]
      : [...args];
    return this.runCommandOnce(binary, effectiveArgs, options).then(async first => {
      const retryable = installCommand
        && !first.timedOut
        && first.code !== 0
        && (first.code === null
          || !first.output.trim()
          || /\b(?:EAI_AGAIN|ECONNRESET|ETIMEDOUT|ENETUNREACH|network|ENOENT|EINTEGRITY|cache)\b/i.test(first.output));
      if (!retryable || options.signal?.aborted) return first;

      this.log('system', 'Dependency installation hit a transient registry/cache error; verifying the cache and retrying once.');
      if (/\b(?:ENOENT|EINTEGRITY|cache)\b/i.test(first.output)) {
        await this.runCommandOnce('npm', ['cache', 'verify'], {
          timeoutMs: Math.min(options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS, 60_000),
          signal: options.signal,
        }).catch(() => null);
      }
      return this.runCommandOnce(binary, effectiveArgs, options);
    });
  }

  private runCommandOnce(
    binary: string,
    args: readonly string[],
    options: { timeoutMs?: number; allowReview?: boolean; signal?: AbortSignal } = {},
  ): Promise<{ code: number | null; output: string; timedOut: boolean }> {
    options.signal?.throwIfAborted();
    const decision = decideCommand(binary, args);
    if (decision.verdict === 'blocked' || (decision.verdict === 'review' && !options.allowReview)) {
      return Promise.reject(new Error(`Command refused (${decision.verdict}): ${decision.reason}`));
    }
    this.lastUsedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
    // Same policy, same result shape — executed in the project's VM.
    if (this.remote) {
      return this.remote.run(binary, args, {
        env: this.env,
        timeoutMs,
        signal: options.signal,
        onOutput: (stream, text) => this.log(stream, text),
      });
    }
    assertHostSandboxExecutionAllowed();
    return new Promise((resolve, reject) => {
      const command = executable(binary,args);
      const child = spawn(command.binary, command.args, {
        cwd: this.dir,
        env: sandboxEnv(this.env),
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      let output = '';
      let timedOut = false;
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); fn(); } };
      const killTree = () => {
        if (!child.pid) return;
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, shell: false, stdio: 'ignore' });
          killer.on('error', () => { child.kill('SIGKILL'); });
        } else {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
        }
      };
      const timer = setTimeout(() => { timedOut = true; killTree(); }, timeoutMs);
      const onAbort = () => { killTree(); done(() => reject(new Error('Command cancelled.'))); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const text = String(chunk);
        output = (output + text).slice(-256_000);
        this.log(stream, text);
      };
      child.stdout.on('data', c => collect(c, 'stdout'));
      child.stderr.on('data', c => collect(c, 'stderr'));
      child.on('error', error => done(() => reject(error)));
      child.on('close', code => done(() => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve({ code, output, timedOut });
      }));
    });
  }

  // -- lifecycle -------------------------------------------------------

  /** Install the project's own dependencies. `npm ci` when a lockfile allows it. */
  install(options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<{ ok: boolean; output: string; durationMs: number }> {
    return this.serialise(async () => {
      const startedAt = Date.now();
      this.state = 'installing';
      this.lastError = null;
      this.log('system', 'Installing dependencies...');
      // Same manifest as an earlier project: copy its installed tree. Local
      // only — a VM installs into its own disk, and a host copy would never reach it.
      if (!this.remote && await restoreDependencies(this.dir)) {
        this.state = 'idle';
        this.log('system', 'Dependencies restored from the install cache.');
        return { ok: true, output: 'Dependencies restored from the install cache.', durationMs: Date.now() - startedAt };
      }
      // A VM starts with the image's tree; when it already is this project's,
      // the install would change nothing and cost half a minute.
      if (this.remote && await this.remote.imageSatisfiesDependencies(this.env, options.signal)) {
        this.remote.installedManifest = manifestHash(await this.readProjectFile('package.json').catch(() => ''));
        this.state = 'idle';
        this.log('system', 'Dependencies already present in the sandbox image.');
        return { ok: true, output: 'Dependencies already present in the sandbox image.', durationMs: Date.now() - startedAt };
      }
      const useCi = await this.hasFile('package-lock.json');
      // Generated package lifecycle hooks are untrusted code. They must not
      // execute while dependencies are installed in the host process.
      const args = useCi ? ['ci', '--ignore-scripts'] : ['install', '--no-audit', '--no-fund', '--ignore-scripts'];
      try {
        const result = await this.runCommand('npm', args, {
          timeoutMs: options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
          allowReview: true,
          signal: options.signal,
        });
        const ok = result.code === 0;
        if (!ok) {
          this.state = 'crashed';
          this.lastError = result.timedOut
            ? 'Dependency installation timed out.'
            : `npm ${args[0]} exited with code ${result.code ?? 'unknown'}.`;
        } else {
          this.state = 'idle';
          // Kept in the background for the next project with this manifest.
          if (!this.remote) void saveDependencies(this.dir).catch(() => undefined);
          else this.remote.installedManifest = manifestHash(await this.readProjectFile('package.json').catch(() => ''));
        }
        return {
          ok,
          output: result.output.trim() || (ok ? '' : this.lastError || 'Dependency installation failed without output.'),
          durationMs: Date.now() - startedAt,
        };
      } catch (error: any) {
        this.state = 'crashed';
        this.lastError = error?.message || 'Dependency installation failed.';
        return { ok: false, output: this.lastError!, durationMs: Date.now() - startedAt };
      }
    });
  }

  /**
   * Start the dev server and wait until it reports a URL that answers.
   *
   * Two conditions, not one: the process printing a URL says it thinks it is
   * ready, and an HTTP request coming back says it is. Reporting a preview
   * ready on the first alone is how a user gets an iframe pointed at a socket
   * that refuses connections.
   */
  start(options: { script?: string; timeoutMs?: number; basePath?: string; signal?: AbortSignal } = {}): Promise<SandboxStatus> {
    return this.serialise(async () => {
      options.signal?.throwIfAborted();
      if (this.remote) return this.startRemote(options);
      assertHostSandboxExecutionAllowed();
      if (this.child && this.state === 'running') return this.status();
      await this.stopProcess();
      const script = options.script || 'dev';
      const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
      this.state = 'starting';
      this.lastError = null;
      this.port = null;
      this.basePath = normaliseBase(options.basePath);
      this.log('system', `Starting the dev server (npm run ${script})...`);

      // `--host 127.0.0.1` keeps a generated project's dev server off every
      // other interface: it is reachable through our proxy and from nowhere
      // else. `--port 0` lets the OS pick a free one, so two projects starting
      // at the same moment cannot collide on a default.
      //
      // `--base` is the one that decides whether the preview works at all.
      // The proxy mounts the app under a path prefix, but the dev server
      // writes absolute URLs into the document it serves -- `/src/main.jsx`,
      // `/@vite/client`, `/@react-refresh`. Without a base it emits them
      // rooted at `/`, the browser requests them from our origin instead of
      // through the prefix, and every one 404s: the document loads, no module
      // does, and the iframe shows an empty page with no error in it. Told the
      // prefix, the server writes URLs that come back to it.
      const args = ['run', script, '--', '--host', '127.0.0.1', '--port', '0'];
      if (this.basePath) args.push(`--base=${this.basePath}`);
      const command = executable('npm',args);
      const child = spawn(command.binary, command.args, {
        cwd: this.dir,
        env: sandboxEnv(this.env),
        shell: false,
        windowsHide: true,
        // `npm run dev` is not the dev server: npm is, and Vite is its child.
        // Signalling npm alone leaves Vite running, orphaned, still holding
        // the port -- so a "stopped" sandbox goes on serving the old build
        // and the host leaks a process per start. Its own process group makes
        // the whole tree addressable, which is what stopProcess() signals.
        detached: process.platform !== 'win32',
      });
      this.child = child;
      this.startedAt = Date.now();

      const ready = new Promise<number>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); fn(); } };
        const onAbort = () => finish(() => reject(new Error('Preview start cancelled.')));
        const timer = setTimeout(
          () => finish(() => reject(new Error(`The dev server did not report a URL within ${Math.round(timeoutMs / 1000)}s.`))),
          timeoutMs,
        );
        options.signal?.addEventListener('abort', onAbort, {once:true});
        if (options.signal?.aborted) onAbort();
        const scan = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
          const text = String(chunk);
          this.log(stream, text);
          const match = READY_URL.exec(plain(text));
          if (match) finish(() => resolve(Number(match[1])));
        };
        child.stdout.on('data', c => scan(c, 'stdout'));
        child.stderr.on('data', c => scan(c, 'stderr'));
        child.on('error', error => finish(() => reject(error)));
        child.on('close', code => finish(() => reject(new Error(`The dev server exited with code ${code} before it was ready.`))));
      });

      try {
        const port = await ready;
        // Probe the base the server was actually told to serve, not `/`: with a
      // base set, `/` is a 404 and would look like a server that never came up.
      await waitForHttp(`http://127.0.0.1:${port}${this.basePath || '/'}`, Math.min(20_000, timeoutMs), options.signal);
        this.port = port;
        this.state = 'running';
        this.lastUsedAt = Date.now();
        this.log('system', `Preview ready on port ${port}.`);
        // A server that dies later must not leave the status reading "running".
        child.on('close', code => {
          if (this.child !== child) return;
          this.state = code === 0 ? 'stopped' : 'crashed';
          this.port = null;
          this.child = null;
          if (code !== 0) this.lastError = `The dev server stopped with code ${code}.`;
        });
        return this.status();
      } catch (error: any) {
        this.lastError = error?.message || 'The dev server failed to start.';
        this.state = 'crashed';
        await this.stopProcess();
        return this.status();
      }
    });
  }

  /** The dev server in the project's VM, reached at its HTTPS origin. */
  private async startRemote(options: { script?: string; timeoutMs?: number; basePath?: string; signal?: AbortSignal }): Promise<SandboxStatus> {
    if (this.state === 'running' && this.origin) return this.status();
    const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.state = 'starting';
    this.lastError = null;
    this.port = null;
    this.origin = null;
    this.basePath = normaliseBase(options.basePath);
    this.startedAt = Date.now();
    this.log('system', `Starting the dev server in the isolated sandbox (npm run ${options.script || 'dev'})...`);
    try {
      const { port, origin } = await this.remote!.startServer({
        script: options.script || 'dev',
        basePath: this.basePath,
        env: this.env,
        timeoutMs,
        signal: options.signal,
        onOutput: (stream, text) => this.log(stream, text),
        onExit: code => {
          if (this.state !== 'running') return;
          this.state = code === 0 ? 'stopped' : 'crashed';
          this.port = null;
          this.origin = null;
          if (code !== 0) this.lastError = `The dev server stopped with code ${code ?? 'unknown'}.`;
        },
      });
      await waitForHttp(`${origin}${this.basePath || '/'}`, Math.min(30_000, timeoutMs), options.signal);
      this.port = port;
      this.origin = origin;
      this.state = 'running';
      this.lastUsedAt = Date.now();
      this.log('system', 'Preview ready in the isolated sandbox.');
      return this.status();
    } catch (error: any) {
      this.lastError = error?.message || 'The dev server failed to start.';
      this.state = 'crashed';
      await this.remote!.stopServer().catch(() => undefined);
      return this.status();
    }
  }

  stop(): Promise<SandboxStatus> {
    return this.serialise(async () => {
      await this.stopProcess();
      this.state = 'stopped';
      return this.status();
    });
  }

  /**
   * Kill the whole dev-server process tree and wait for the port to go with it.
   *
   * Signalling the process group rather than the child, because the child is
   * npm and the server is its descendant: `child.kill()` reaps the launcher
   * and leaves the thing that holds the socket. Falling back to the child
   * alone covers the case where the group was never created (Windows, or a
   * process that already detached itself).
   */
  private async stopProcess(): Promise<void> {
    if (this.remote) {
      this.port = null;
      this.origin = null;
      await this.remote.stopServer();
      return;
    }
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) return;
    const pid = child.pid;
    if (pid && process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const killer = spawn('taskkill', ['/pid',String(pid),'/t','/f'], { windowsHide:true, shell:false, stdio:'ignore' });
        const timer = setTimeout(() => { killer.kill(); reject(new Error('Sandbox process tree did not stop.')); }, 5000);
        killer.once('error', error => { clearTimeout(timer); reject(error); });
        killer.once('close', () => { clearTimeout(timer); resolve(); });
      });
      return;
    }
    const signal = (which: NodeJS.Signals) => {
      if (pid && process.platform !== 'win32') {
        // Negative pid addresses the group. ESRCH here means it is already
        // gone, which is the outcome we wanted.
        try { process.kill(-pid, which); return; } catch { /* fall through */ }
      }
      try { child.kill(which); } catch { /* already gone */ }
    };
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(hard); resolve(); };
      child.once('close', done);
      // SIGTERM first so a dev server can close its sockets; SIGKILL if it
      // will not, so a stuck process cannot hold the sandbox forever.
      const hard = setTimeout(() => { signal('SIGKILL'); resolve(); }, 4_000);
      signal('SIGTERM');
    });
  }

  /** Stop the server and delete everything this project owns. */
  async destroy(): Promise<void> {
    await this.stop();
    await this.remote?.destroy();
    await rm(this.dir, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 8 : 0,
      retryDelay: 125,
    });
    this.state = 'idle';
    this.logs = [];
  }
}

/** Poll until the server answers, or give up. A connection refusal is normal here. */
async function waitForHttp(url: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const timeoutSignal = AbortSignal.timeout(2_000);
      const response = await fetch(url, { signal: signal ? AbortSignal.any([signal,timeoutSignal]) : timeoutSignal });
      // Any answer proves the socket is live and routed. A dev server is
      // entitled to 404 the root while still serving the app.
      if (response.status > 0) return;
    } catch (error: any) {
      lastError = error?.message || String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`The dev server never answered on ${url} (${lastError}).`);
}

/**
 * A base path Vite will accept: leading and trailing slash, or empty.
 *
 * Vite warns and self-corrects on a base without them, but the corrected value
 * is what ends up in the URLs it emits -- so normalising here keeps the proxy
 * and the dev server describing the same prefix.
 */
function normaliseBase(value: string | undefined): string {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  const withLeading = raw.startsWith('/') ? raw : `/${raw}`;
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`;
}
