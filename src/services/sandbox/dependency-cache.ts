/**
 * An installed dependency tree, reused instead of reinstalled.
 *
 * Every new project starts from the same scaffold, so every new project ran
 * the same `npm install` — sixteen seconds and more on a warm npm cache, far
 * longer on a cold one — to produce a byte-identical `node_modules`. That
 * install sat on the critical path of every first build.
 *
 * The tree is kept per exact manifest (package.json and lockfile, hashed) and
 * copied — never linked — into the next sandbox that asks for the same one.
 * A copy keeps projects isolated: a generated app that writes into its own
 * `node_modules` cannot reach another project's tree or the template.
 *
 * Everything here is best effort. A cache that cannot be read or written
 * falls back to the ordinary install; it never fails a run.
 */

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER = '.coden-complete';
/** Enough for the scaffolds and a few common variants, not a registry mirror. */
const MAX_ENTRIES = 4;

function cacheRoot(): string {
  return process.env.CODEN_SANDBOX_DEPS_CACHE || path.join(os.tmpdir(), 'coden-deps-cache');
}

async function manifestKey(projectDir: string): Promise<string | null> {
  try {
    const manifest = await readFile(path.join(projectDir, 'package.json'), 'utf8');
    const lock = await readFile(path.join(projectDir, 'package-lock.json'), 'utf8').catch(() => '');
    return createHash('sha256').update(manifest).update('\0').update(lock).digest('hex').slice(0, 32);
  } catch {
    return null;
  }
}

/** Copy a cached tree into the project. True when the project now has one. */
export async function restoreDependencies(projectDir: string): Promise<boolean> {
  if (process.env.CODEN_SANDBOX_DEPS_CACHE === 'off') return false;
  const key = await manifestKey(projectDir);
  if (!key) return false;
  const entry = path.join(cacheRoot(), key);
  if (!existsSync(path.join(entry, MARKER))) return false;
  try {
    const target = path.join(projectDir, 'node_modules');
    await rm(target, { recursive: true, force: true });
    await cp(path.join(entry, 'node_modules'), target, { recursive: true, force: true, verbatimSymlinks: true });
    const now = new Date();
    await utimes(entry, now, now).catch(() => undefined);
    return true;
  } catch {
    await rm(path.join(projectDir, 'node_modules'), { recursive: true, force: true }).catch(() => undefined);
    return false;
  }
}

/** Keep a freshly installed tree for the next project with the same manifest. */
export async function saveDependencies(projectDir: string): Promise<void> {
  if (process.env.CODEN_SANDBOX_DEPS_CACHE === 'off') return;
  const key = await manifestKey(projectDir);
  if (!key) return;
  const root = cacheRoot();
  const entry = path.join(root, key);
  if (existsSync(path.join(entry, MARKER))) return;
  const staging = path.join(root, `.staging-${key}-${process.pid}-${Date.now()}`);
  try {
    await mkdir(staging, { recursive: true });
    await cp(path.join(projectDir, 'node_modules'), path.join(staging, 'node_modules'), { recursive: true, verbatimSymlinks: true });
    await writeFile(path.join(staging, MARKER), new Date().toISOString());
    // Rename is atomic: a reader sees a complete entry or none at all.
    await rename(staging, entry).catch(async () => { await rm(staging, { recursive: true, force: true }); });
    await prune(root);
  } catch {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function prune(root: string): Promise<void> {
  const entries = await readdir(root).catch(() => [] as string[]);
  const complete = await Promise.all(entries
    .filter(name => !name.startsWith('.'))
    .map(async name => ({ name, at: (await stat(path.join(root, name)).catch(() => null))?.mtimeMs ?? 0 })));
  const stale = complete.sort((a, b) => b.at - a.at).slice(MAX_ENTRIES);
  await Promise.all(stale.map(item => rm(path.join(root, item.name), { recursive: true, force: true }).catch(() => undefined)));
}

/**
 * Install the scaffolds' trees once, when the server boots.
 *
 * A deploy starts a fresh container with an empty cache, so without this the
 * first new project after every deploy paid the full install. Runs in the
 * background, one scaffold after another, through the same sandbox install
 * path (same flags, same `--ignore-scripts`), and never blocks or fails boot.
 */
export async function warmScaffoldDependencies(
  scaffolds: ReadonlyArray<{ id: string; files: ReadonlyArray<{ path: string; content: string }> }>,
  createSandbox: (id: string) => {
    readonly dir: string;
    writeFiles(files: ReadonlyArray<{ path: string; content: string }>): Promise<unknown>;
    install(options?: { timeoutMs?: number }): Promise<{ ok: boolean }>;
    destroy(): Promise<void>;
  },
): Promise<void> {
  if (process.env.CODEN_SANDBOX_DEPS_CACHE === 'off' || process.env.CODEN_SANDBOX_WARM === 'off') return;
  for (const scaffold of scaffolds) {
    const sandbox = createSandbox(`__warm_${scaffold.id}`);
    try {
      await sandbox.writeFiles(scaffold.files.filter(file => file.path === 'package.json' || file.path === 'package-lock.json'));
      const installed = await sandbox.install({ timeoutMs: 240_000 });
      // Saved here and awaited, so the tree is kept before the directory goes.
      if (installed.ok) await saveDependencies(sandbox.dir);
    } catch {
      // Best effort: the first real project installs as it always did.
    } finally {
      await sandbox.destroy().catch(() => undefined);
    }
  }
}
