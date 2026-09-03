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
import { decideCommand } from './command-policy.ts';
import { resolveInSandbox, sandboxDir } from './paths.ts';

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
  startedAt: number | null;
  lastUsedAt: number;
};

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_START_TIMEOUT_MS = 90_000;
const MAX_LOG_LINES = 400;

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
const BASE_ENV_KEYS = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'USER'];

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
function sandboxEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [...BASE_ENV_KEYS, ...NETWORK_ENV_KEYS]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.NODE_ENV = 'development';
  env.CI = '1';
  env.NO_COLOR = '1';
  // A shared cache turns the second install of React or Vite into a copy
  // instead of a download. Installing the same dependency tree from the
  // network for every generated project is the single slowest thing a
  // sandbox can do.
  env.npm_config_cache = process.env.CODEN_SANDBOX_NPM_CACHE || path.join(os.tmpdir(), 'coden-npm-cache');
  env.npm_config_audit = 'false';
  env.npm_config_fund = 'false';
  env.npm_config_update_notifier = 'false';
  return { ...env, ...extra };
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
  /** Serialises install/start/stop so two requests cannot race the process. */
  private queue: Promise<unknown> = Promise.resolve();

  lastUsedAt = Date.now();

  constructor(projectId: string) {
    this.projectId = projectId;
    this.dir = sandboxDir(projectId);
  }

  // -- state -----------------------------------------------------------

  status(): SandboxStatus {
    return {
      projectId: this.projectId,
      state: this.state,
      url: this.port ? `http://127.0.0.1:${this.port}` : null,
      basePath: this.basePath || null,
      port: this.port,
      pid: this.child?.pid ?? null,
      lastError: this.lastError,
      startedAt: this.startedAt,
      lastUsedAt: this.lastUsedAt,
    };
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
    await rm(resolveInSandbox(this.projectId, relativePath), { recursive: true, force: true });
  }

  /** Every project file, excluding what a package manager owns. */
  async listFiles(): Promise<string[]> {
    this.lastUsedAt = Date.now();
    const skip = new Set(['node_modules', '.git', 'dist', '.vite', '.next', 'coverage']);
    const found: string[] = [];
    const walk = async (dir: string, prefix: string): Promise<void> => {
      let entries;
      try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (skip.has(entry.name)) continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
        else found.push(rel);
      }
    };
    await walk(this.dir, '');
    return found.sort();
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
    const decision = decideCommand(binary, args);
    if (decision.verdict === 'blocked' || (decision.verdict === 'review' && !options.allowReview)) {
      return Promise.reject(new Error(`Command refused (${decision.verdict}): ${decision.reason}`));
    }
    this.lastUsedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [...args], {
        cwd: this.dir,
        env: sandboxEnv(this.env),
        shell: false,
        windowsHide: true,
      });
      let output = '';
      let timedOut = false;
      let settled = false;
      const done = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
      const onAbort = () => { child.kill('SIGKILL'); done(() => reject(new Error('Command cancelled.'))); };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
        const text = String(chunk);
        output += text;
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
      const useCi = await this.hasFile('package-lock.json');
      const args = useCi ? ['ci'] : ['install', '--no-audit', '--no-fund'];
      try {
        const result = await this.runCommand('npm', args, {
          timeoutMs: options.timeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
          allowReview: true,
          signal: options.signal,
        });
        const ok = result.code === 0;
        if (!ok) {
          this.state = 'crashed';
          this.lastError = result.timedOut ? 'Dependency installation timed out.' : `npm ${args[0]} exited with code ${result.code}.`;
        } else {
          this.state = 'idle';
        }
        return { ok, output: result.output, durationMs: Date.now() - startedAt };
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
  start(options: { script?: string; timeoutMs?: number; basePath?: string } = {}): Promise<SandboxStatus> {
    return this.serialise(async () => {
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
      const child = spawn('npm', args, {
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
        const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); fn(); } };
        const timer = setTimeout(
          () => finish(() => reject(new Error(`The dev server did not report a URL within ${Math.round(timeoutMs / 1000)}s.`))),
          timeoutMs,
        );
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
      await waitForHttp(`http://127.0.0.1:${port}${this.basePath || '/'}`, Math.min(20_000, timeoutMs));
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
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) return;
    const pid = child.pid;
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
    await rm(this.dir, { recursive: true, force: true });
    this.state = 'idle';
    this.logs = [];
  }
}

/** Poll until the server answers, or give up. A connection refusal is normal here. */
async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
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
