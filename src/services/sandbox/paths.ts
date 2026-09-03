/**
 * Where a project's files live, and the guarantee that they stay there.
 *
 * Every path a generated project names — a file the model writes, a path a
 * tool reads — is attacker-controlled input as far as this process is
 * concerned: the model is told what to produce but nothing stops it emitting
 * `../../etc/passwd` or an absolute path. One project reaching another
 * project's directory is the failure this module exists to make impossible,
 * so resolution is centralised here rather than repeated at each call site.
 */

import path from 'node:path';
import os from 'node:os';

/** The root every sandbox lives under. One directory, one owner. */
export function sandboxRoot(): string {
  return process.env.CODEN_SANDBOX_ROOT || path.join(os.tmpdir(), 'coden-sandboxes');
}

/**
 * A project id reduced to something safe to use as a directory name.
 *
 * Not a hash: the directory name has to be recognisable in a process list and
 * in `du -sh` output when a sandbox misbehaves. Anything outside the allowed
 * set becomes `-`, and the result is bounded so a long id cannot blow past the
 * filesystem's name limit.
 */
export function sandboxDirName(projectId: string): string {
  const cleaned = String(projectId || '').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');
  if (!cleaned) throw new Error('A sandbox needs a project id.');
  return cleaned.slice(0, 96);
}

/** The directory this project owns. */
export function sandboxDir(projectId: string): string {
  return path.join(sandboxRoot(), sandboxDirName(projectId));
}

/**
 * Resolve a project-relative path inside its own sandbox, or refuse.
 *
 * Refuses absolute paths, refuses anything that climbs out with `..`, and
 * refuses the sandbox directory itself — a caller asking to write "" or "."
 * means a bug, not a file. The check is on the *resolved* path, so a path that
 * only escapes after normalisation (`a/../../b`) is caught too.
 */
export function resolveInSandbox(projectId: string, relativePath: string): string {
  const base = sandboxDir(projectId);
  const requested = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
  if (!requested) throw new Error('A file path is required.');
  if (path.posix.isAbsolute(requested) || path.win32.isAbsolute(requested)) {
    throw new Error(`Absolute paths are not allowed in a sandbox: ${relativePath}`);
  }
  const resolved = path.resolve(base, requested);
  if (resolved === base || !resolved.startsWith(base + path.sep)) {
    throw new Error(`Path escapes the project sandbox: ${relativePath}`);
  }
  return resolved;
}

/** True when `candidate` is inside this project's sandbox. */
export function isInsideSandbox(projectId: string, candidate: string): boolean {
  const base = sandboxDir(projectId);
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(base + path.sep);
}
