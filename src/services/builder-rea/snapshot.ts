import { constants, type Dirent } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REA_LIMITS, reaFileAllowed, reaRelativePath } from './policy.ts';

/** Copy only inventoried, non-secret files; never give REA the live project root. */
export async function snapshotReaArtifact(projectRoot: string, relativePath: unknown, destination: string) {
  const relative = reaRelativePath(relativePath);
  const root = await realpath(projectRoot);
  const target = path.resolve(root, relative);
  const boundary = (candidate: string) => candidate === root || candidate.startsWith(root + path.sep);
  if (!boundary(target)) throw new Error('REA_SCOPE_DENIED');
  // Reject every symbolic path component before dereferencing the target.
  let cursor = root;
  for (const part of relative.split('/').filter(part => part && part !== '.')) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('REA_SCOPE_DENIED');
  }
  const targetStat = await lstat(target);
  if (!targetStat.isDirectory() && (!targetStat.isFile() || !/\.asar$/i.test(relative))) throw new Error('REA_ARTIFACT_REQUIRED');
  let entries = 0, files = 0, bytes = 0, excludedFiles = 0;
  const digest = createHash('sha256');
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const copy = async (source: string, filename: string) => {
    if (!boundary(await realpath(source))) throw new Error('REA_SCOPE_DENIED');
    const stat = await lstat(source);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('REA_SCOPE_DENIED');
    if (++files > REA_LIMITS.files || stat.size > REA_LIMITS.fileBytes || (bytes += stat.size) > REA_LIMITS.bytes) throw new Error('REA_INPUT_LIMIT');
    const handle = await open(source, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      // Recheck the open descriptor, not just metadata obtained before opening.
      const opened = await handle.stat();
      if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size !== stat.size) throw new Error('REA_SCOPE_DENIED');
      const data = Buffer.alloc(opened.size + 1);
      const read = await handle.read(data, 0, data.length, 0);
      if (read.bytesRead !== opened.size) throw new Error('REA_INPUT_CHANGED');
      if (!boundary(await realpath(source))) throw new Error('REA_SCOPE_DENIED');
      digest.update(filename).update('\0').update(data.subarray(0, read.bytesRead));
      const output = path.join(destination, filename);
      await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
      await writeFile(output, data.subarray(0, read.bytesRead), { mode: 0o600 });
    } finally { await handle.close(); }
  };
  const walk = async (directory: string, prefix = '', depth = 0): Promise<void> => {
    if (depth > 12) throw new Error('REA_INPUT_LIMIT');
    // Enumerate incrementally: even a directory containing only excluded files
    // must not allocate an unbounded array in the Coden server process.
    const children: Dirent[] = [];
    for await (const entry of await opendir(directory)) {
      if (++entries > REA_LIMITS.entries) throw new Error('REA_INPUT_LIMIT');
      children.push(entry);
    }
    for (const entry of children.sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = prefix ? `${prefix}/${entry.name}` : entry.name;
      try { reaRelativePath(filename); } catch { excludedFiles++; continue; }
      const source = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('REA_SCOPE_DENIED');
      if (entry.isDirectory()) await walk(source, filename, depth + 1);
      else if (reaFileAllowed(filename)) await copy(source, filename);
      else excludedFiles++;
    }
  };
  let inputPath = destination;
  if (targetStat.isDirectory()) await walk(target);
  else { await copy(target, path.basename(relative)); inputPath = path.join(destination, path.basename(relative)); }
  if (!files) throw new Error('REA_NO_ARTIFACT_FILES');
  return { inputPath, files, bytes, excludedFiles, selectedPath: relative, sha256: digest.digest('hex') };
}
