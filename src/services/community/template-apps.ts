/**
 * Template apps: complete, tested apps that anyone may start from, as opposed to a brief the agent builds from.
 *
 * An app is the starter's own files plus the app's files on top (`templates/community/<slug>/`, versioned with the
 * code). The same assembly is built, type-checked and run in a browser by `scripts/community/test-template-apps.mjs`, so
 * what a person receives is exactly what was tested. Nothing in an app is personal data, a key or a connection: they keep
 * their data in the visitor's own browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STARTERS } from '../sandbox/starters.ts';

export type TemplateFile = { path: string; content: string };

const ROOT_CANDIDATES = [path.resolve(process.cwd(), 'templates/community'), path.resolve(import.meta.dirname, '../../../templates/community')];

export function templatesRoot(): string | null {
  return ROOT_CANDIDATES.find(candidate => fs.existsSync(candidate)) || null;
}

const SLUG = /^[a-z0-9-]+$/;

/** The app's own files, relative to its folder. Empty when the slug has no folder. */
export function templateOverlay(slug: string, root = templatesRoot()): TemplateFile[] {
  if (!root || !SLUG.test(slug)) return [];
  const base = path.join(root, slug);
  if (!fs.existsSync(base)) return [];
  const files: TemplateFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push({ path: path.relative(base, full).split(path.sep).join('/'), content: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(base);
  return files;
}

/** The starter's files, with the app's files replacing those of the same path. */
export function assembleTemplate(slug: string, root = templatesRoot()): TemplateFile[] {
  const overlay = templateOverlay(slug, root);
  if (!overlay.length) return [];
  const byPath = new Map<string, string>();
  for (const file of STARTERS['react-vite'].files) byPath.set(file.path, file.content);
  for (const file of overlay) byPath.set(file.path, file.content);
  return [...byPath.entries()].map(([filePath, content]) => ({ path: filePath, content }));
}
