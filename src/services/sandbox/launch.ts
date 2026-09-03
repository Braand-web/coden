/**
 * Bringing a generation's output up as a running application.
 *
 * The generation route already knows the files; this is what turns them into
 * something a browser can open. It exists as its own module because the same
 * three steps -- write, install if needed, start -- are wanted from three
 * places (a fresh generation, an incremental edit, reopening a project) and
 * differ only in how much of the work is already done.
 *
 * Two decisions live here rather than at the call sites:
 *
 * Installing is skipped when the tree is already on disk. That is the whole
 * difference between reopening a project in a second and reopening it in a
 * minute, and it is safe because a changed dependency list is detected
 * explicitly rather than assumed.
 *
 * Restarting is likewise not the default. A dev server with hot reload absorbs
 * a component edit without being touched; only a changed dependency list or
 * build config genuinely requires a new process, and `needsRestart` names
 * exactly those.
 */

import { sandboxRegistry } from './sandbox-registry.ts';
import type { SandboxFile, SandboxStatus } from './project-sandbox.ts';
import { issuePreviewToken } from './preview-token.ts';

export type LaunchEvent =
  | { type: 'sandbox_writing'; files: number }
  | { type: 'sandbox_installing' }
  | { type: 'sandbox_installed'; durationMs: number }
  | { type: 'sandbox_starting' }
  | { type: 'preview_ready'; url: string; port: number }
  | { type: 'sandbox_failed'; stage: 'install' | 'start'; message: string; logs: string[] };

export type LaunchResult = {
  ok: boolean;
  state: SandboxStatus['state'];
  previewUrl: string | null;
  port: number | null;
  installDurationMs: number | null;
  startDurationMs: number | null;
  error: string | null;
  logs: string[];
};

/**
 * Files whose change the running process cannot absorb.
 *
 * Everything else -- components, styles, routes, assets -- is what hot reload
 * is for. Restarting on every write would throw away the entire benefit of
 * running a dev server in the first place.
 */
const RESTART_TRIGGERS = /^(?:package\.json|package-lock\.json|(?:vite|next|astro|svelte|nuxt|tailwind|postcss)\.config\.[cm]?[jt]s|\.env(?:\.[a-z]+)?)$/i;

export function needsRestart(changedPaths: readonly string[]): boolean {
  return (changedPaths || []).some(path => RESTART_TRIGGERS.test(String(path || '').replace(/^\.\//, '')));
}

/** True when a dependency tree is already present. */
async function hasDependencies(sandbox: { hasFile(path: string): Promise<boolean> }): Promise<boolean> {
  return (await sandbox.hasFile('node_modules/.package-lock.json')) || (await sandbox.hasFile('node_modules/.bin'));
}

/**
 * Write the project into its sandbox and get its dev server answering.
 *
 * `onEvent` is called as each stage begins so the interface can show the
 * pipeline as it happens rather than after it. Nothing here waits for the
 * whole thing to finish before saying anything.
 */
export async function launchProjectPreview(input: {
  projectId: string;
  userId: string;
  files: readonly SandboxFile[];
  env?: Record<string, string>;
  /** Force a fresh install and a fresh process, whatever is already there. */
  reinstall?: boolean;
  onEvent?: (event: LaunchEvent) => void;
}): Promise<LaunchResult> {
  const emit = input.onEvent || (() => {});
  const sandbox = sandboxRegistry.get(input.projectId);
  const fail = (stage: 'install' | 'start', message: string, state: SandboxStatus['state']): LaunchResult => {
    const logs = sandbox.getLogs(60).map(entry => entry.line);
    emit({ type: 'sandbox_failed', stage, message, logs });
    return { ok: false, state, previewUrl: null, port: null, installDurationMs: null, startDurationMs: null, error: message, logs };
  };

  // Making room before starting, not after: exceeding the host's limit and
  // then trimming makes the busiest moment the one where it is most loaded.
  await sandboxRegistry.makeRoomFor(input.projectId);
  if (input.env) sandbox.setEnv(input.env);

  emit({ type: 'sandbox_writing', files: input.files.length });
  await sandbox.writeFiles(input.files);

  let installDurationMs: number | null = null;
  if (input.reinstall || !(await hasDependencies(sandbox))) {
    emit({ type: 'sandbox_installing' });
    const install = await sandbox.install();
    installDurationMs = install.durationMs;
    if (!install.ok) return fail('install', 'The project dependencies could not be installed.', 'crashed');
    emit({ type: 'sandbox_installed', durationMs: install.durationMs });
  }

  emit({ type: 'sandbox_starting' });
  // The token is minted before the start because it is also the path the dev
  // server is told to serve under: a server behind a prefix writes absolute
  // URLs for its own modules, so it has to know that prefix or every module
  // 404s behind a document that loaded fine.
  const token = issuePreviewToken({ projectId: input.projectId, userId: input.userId });
  const basePath = `/preview/${token}/`;
  const startedAt = Date.now();
  const status = await sandbox.start({ basePath });
  const startDurationMs = Date.now() - startedAt;
  if (status.state !== 'running' || !status.port) {
    return fail('start', status.lastError || 'The dev server did not start.', status.state);
  }

  emit({ type: 'preview_ready', url: basePath, port: status.port });
  return {
    ok: true,
    state: status.state,
    previewUrl: basePath,
    port: status.port,
    installDurationMs,
    startDurationMs,
    error: null,
    logs: sandbox.getLogs(30).map(entry => entry.line),
  };
}

/**
 * Apply an edit to a running project.
 *
 * The fast path — and the one that makes a change appear in a second rather
 * than a minute: the files are written and the dev server's own watcher does
 * the rest. It falls back to a full launch only when the sandbox is not
 * running, or when what changed is something hot reload cannot absorb.
 */
export async function applyProjectEdit(input: {
  projectId: string;
  userId: string;
  files: readonly SandboxFile[];
  env?: Record<string, string>;
  onEvent?: (event: LaunchEvent) => void;
}): Promise<LaunchResult & { hotReloaded: boolean }> {
  const sandbox = sandboxRegistry.peek(input.projectId);
  const paths = input.files.map(file => file.path);
  const running = sandbox?.status().state === 'running';

  if (running && !needsRestart(paths)) {
    await sandbox!.writeFiles(input.files);
    const status = sandbox!.status();
    return {
      ok: true, hotReloaded: true, state: status.state,
      previewUrl: status.basePath, port: status.port,
      installDurationMs: null, startDurationMs: null, error: null,
      logs: sandbox!.getLogs(20).map(entry => entry.line),
    };
  }

  // A changed dependency list needs the tree brought up to date before the
  // server comes back, or the restart fails on an import that is not there.
  const reinstall = running && needsRestart(paths);
  const result = await launchProjectPreview({ ...input, reinstall });
  return { ...result, hotReloaded: false };
}
