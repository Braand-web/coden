/**
 * Duplicating a project: what is copied and what is not.
 *
 * Copied: the files and the look (name, prompt, template, theme, model, the saved preview). Not copied: the
 * conversation (a copy starts a fresh one), the published site and its domains (the copy is unpublished), and the
 * backend — its database, accounts and secrets stay with the original, so the copy can never write into them.
 */
export const COPY_SUFFIX = 'copie';

/** « Site » → « Site (copie) »; if taken, « Site (copie 2) », « Site (copie 3) »… A copy of a copy stays « Site (copie 2) », not « Site (copie) (copie) ». */
export function duplicateProjectName(name: string, existing: string[]): string {
  const base = String(name || 'Projet').replace(new RegExp(`\\s*\\(${COPY_SUFFIX}(?:\\s+\\d+)?\\)\\s*$`, 'i'), '').trim() || 'Projet';
  const taken = new Set(existing.map(value => String(value || '').trim().toLowerCase()));
  const first = `${base} (${COPY_SUFFIX})`;
  if (!taken.has(first.toLowerCase())) return first.slice(0, 120);
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base} (${COPY_SUFFIX} ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, 120);
  }
  return `${base} (${COPY_SUFFIX} ${Date.now() % 100000})`.slice(0, 120);
}

/** Only someone who can change the project may copy it: a viewer of someone else's work may not. */
export function canDuplicateProject(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
