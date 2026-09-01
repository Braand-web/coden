// WebContainer preview runner (StackBlitz).
//
// Replaces the in-browser Babel transpile preview with a REAL Node runtime in
// the browser: npm install + Vite dev server. What runs in the preview is then
// identical to production, which removes the "works in preview, breaks on
// Vercel" class of bugs.
//
// Requirements (wired in server.ts):
//   - Cross-origin isolation headers on the page that hosts the iframe:
//       Cross-Origin-Opener-Policy: same-origin
//       Cross-Origin-Embedder-Policy: require-corp
//   - The @webcontainer/api dependency.
//
// Gated by CODEN_WEBCONTAINER_PREVIEW so the existing Babel preview stays the
// default until this is validated in a real build.
//
// The file→tree conversion is a pure function and is unit-tested; the boot path
// runs only in a cross-origin-isolated browser.

export type RunnerFile = { path: string; content: string };

// WebContainer FileSystemTree shape (subset we emit).
export type WCNode =
  | { file: { contents: string } }
  | { directory: WCTree };
export type WCTree = Record<string, WCNode>;

/** Pure: convert a flat [{path, content}] list into a nested WebContainer tree. */
export function filesToWebContainerTree(files: RunnerFile[]): WCTree {
  const root: WCTree = {};
  for (const file of files || []) {
    const clean = String(file.path || '').replace(/^\.?\//, '').replace(/\\/g, '/').trim();
    if (!clean) continue;
    const parts = clean.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const existing = cursor[segment];
      if (existing && 'directory' in existing) {
        cursor = existing.directory;
      } else {
        const dir: { directory: WCTree } = { directory: {} };
        cursor[segment] = dir;
        cursor = dir.directory;
      }
    }
    cursor[parts[parts.length - 1]] = { file: { contents: String(file.content ?? '') } };
  }
  return root;
}

/** True when the browser can run WebContainers (needs cross-origin isolation). */
export function webContainersSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof (globalThis as any).crossOriginIsolated !== 'undefined'
    && (globalThis as any).crossOriginIsolated === true
    && typeof SharedArrayBuffer !== 'undefined';
}

/**
 * True when the feature flag is on. Three sources are checked, any one wins:
 *   - window.__CODEN_FLAGS__.webcontainerPreview (server-side injected flag)
 *   - <meta name="coden-webcontainer-preview" content="1"> in the page
 *   - the URL query string ?webcontainers=1 (handy for opt-in testing)
 */
export function webContainerPreviewEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window as any).__CODEN_FLAGS__?.webcontainerPreview) return true;
  if ((globalThis as any).crossOriginIsolated === true) return true;
  try {
    const meta = document.querySelector('meta[name="coden-webcontainer-preview"]') as HTMLMetaElement | null;
    if (meta && meta.content === '1') return true;
    if (window.location && /[?&]webcontainers?=1\b/.test(window.location.search)) return true;
  } catch { /* SSR or strict CSP */ }
  return false;
}

export type BootResult =
  | { ok: true; url: string; teardown: () => void }
  | { ok: false; reason: string };

export type BootOptions = {
  files: RunnerFile[];
  installCmd?: [string, string[]];
  devCmd?: [string, string[]];
  onLog?: (line: string) => void;
  onStatus?: (status: 'booting' | 'mounting' | 'installing' | 'starting' | 'ready' | 'error') => void;
};

export type WebContainerLaunchPlan = {
  frontend: [string, string[]];
  backend?: [string, string[], Record<string, string>];
  frontendPort: number;
  backendPort?: number;
  fullstack: boolean;
};

function readPackage(files: RunnerFile[]) {
  try {
    return JSON.parse(files.find(file => file.path.replace(/^\.\//, '') === 'package.json')?.content || '{}') as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return {};
  }
}

function readDeclaredPreviewPort(files: RunnerFile[]) {
  try {
    const raw = files.find(file => file.path.replace(/^\.\//, '') === 'coden.project.json')?.content;
    const port = raw ? Number(JSON.parse(raw)?.preview?.port) : NaN;
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  } catch {
    return undefined;
  }
}

/** Pure launch-plan inference, kept separate so the real browser boot is testable. */
export function inferWebContainerLaunchPlan(files: RunnerFile[]): WebContainerLaunchPlan {
  const pkg = readPackage(files);
  const scripts = pkg.scripts || {};
  const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const paths = new Set(files.map(file => file.path.replace(/^\.\//, '').replace(/\\/g, '/')));
  const serverEntry = ['server/index.ts', 'server/server.ts', 'server/app.ts', 'server.ts', 'api/index.ts', 'server/index.js', 'server.js']
    .find(path => paths.has(path));
  const fullstack = Boolean(serverEntry && (dependencies.express || dependencies.fastify || dependencies.hono || dependencies.koa));
  const frontendPort = readDeclaredPreviewPort(files) || (dependencies.next ? 3000 : 5173);
  const backendPort = fullstack ? 3001 : undefined;
  const devScript = String(scripts.dev || '');
  const devStartsBoth = fullstack && /concurrently|npm-run-all|run-p\b/i.test(devScript) && /server|backend|dev:server/i.test(devScript);
  const frontend: [string, string[]] = devStartsBoth
    ? ['npm', ['run', 'dev']]
    : ['npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', String(frontendPort), '--strictPort']];

  let backend: WebContainerLaunchPlan['backend'];
  if (fullstack && !devStartsBoth && backendPort) {
    const backendEnv = { PORT: String(backendPort), HOST: '0.0.0.0', NODE_ENV: 'development' };
    const devServerName = Object.keys(scripts).find(name => /^dev:(?:server|backend|api)$/i.test(name));
    if (devServerName) {
      backend = ['npm', ['run', devServerName], backendEnv];
    } else if (/\b(?:tsx|ts-node|node\s+--experimental-strip-types)\b/i.test(String(scripts.start || '')) && /server|api/i.test(String(scripts.start || ''))) {
      backend = ['npm', ['run', 'start'], backendEnv];
    } else if (serverEntry?.endsWith('.ts')) {
      backend = ['npx', ['tsx', serverEntry], backendEnv];
    } else if (serverEntry) {
      backend = ['node', [serverEntry], backendEnv];
    }
  }

  return { frontend, backend, frontendPort, backendPort, fullstack };
}

let bootedContainer: any = null;

/**
 * Boot a WebContainer, mount the files, install deps, start the dev server, and
 * resolve with the preview URL. Returns a structured failure (never throws) so
 * the caller can fall back to the Babel preview.
 */
export async function bootCodenWebContainer(options: BootOptions): Promise<BootResult> {
  if (!webContainersSupported()) {
    return { ok: false, reason: 'WebContainers require a cross-origin-isolated context (COOP/COEP headers).' };
  }
  const installCmd = options.installCmd || ['npm', ['install', '--no-audit', '--no-fund']];
  const launchPlan = inferWebContainerLaunchPlan(options.files);
  const devCmd = options.devCmd || launchPlan.frontend;
  const log = options.onLog || (() => {});
  const status = options.onStatus || (() => {});

  try {
    status('booting');
    // Dynamic import so the heavy dependency only loads when the flag is on.
    const mod: any = await import('@webcontainer/api');
    const WebContainer = mod.WebContainer;
    if (bootedContainer) { try { await bootedContainer.teardown(); } catch { /* ignore */ } bootedContainer = null; }
    const container = await WebContainer.boot();
    bootedContainer = container;

    status('mounting');
    await container.mount(filesToWebContainerTree(options.files));

    status('installing');
    const install = await container.spawn(installCmd[0], installCmd[1]);
    install.output.pipeTo(new WritableStream({ write: chunk => log(String(chunk)) }));
    const installExit = await install.exit;
    if (installExit !== 0) {
      status('error');
      return { ok: false, reason: `Dependency install failed (exit ${installExit}).` };
    }

    status('starting');
    const expectedPorts = new Set<number>([launchPlan.frontendPort]);
    if (launchPlan.backendPort) expectedPorts.add(launchPlan.backendPort);
    const readyUrls = new Map<number, string>();
    const ready = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dev server did not become ready in time.')), 90_000);
      container.on('server-ready', (port: number, readyUrl: string) => {
        readyUrls.set(port, readyUrl);
        if ([...expectedPorts].every(expectedPort => readyUrls.has(expectedPort))) {
          clearTimeout(timer);
          resolve(readyUrls.get(launchPlan.frontendPort) || readyUrl);
        }
      });
      container.on('error', (err: any) => {
        clearTimeout(timer);
        reject(new Error(String(err?.message || err)));
      });
    });

    const earlyExits: Promise<never>[] = [];
    const rejectOnEarlyExit = (process: any, label: string) => {
      earlyExits.push(process.exit.then((code: number) => {
        throw new Error(`${label} exited before preview readiness (exit ${code}).`);
      }));
    };
    if (launchPlan.backend) {
      const [backendCommand, backendArgs, backendEnv] = launchPlan.backend;
      const backend = await container.spawn(backendCommand, backendArgs, { env: backendEnv });
      backend.output.pipeTo(new WritableStream({ write: chunk => log(String(chunk)) }));
      rejectOnEarlyExit(backend, 'Backend server');
    }
    const dev = await container.spawn(devCmd[0], devCmd[1]);
    dev.output.pipeTo(new WritableStream({ write: chunk => log(String(chunk)) }));
    rejectOnEarlyExit(dev, 'Frontend server');
    const url = await Promise.race([ready, ...earlyExits]);

    status('ready');
    return {
      ok: true,
      url,
      teardown: () => { try { container.teardown(); } catch { /* ignore */ } bootedContainer = null; },
    };
  } catch (error: any) {
    status('error');
    return { ok: false, reason: String(error?.message || error || 'WebContainer boot failed.') };
  }
}
