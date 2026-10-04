import { isStarterEntryUntouched, STARTERS } from './sandbox/starters.ts';

type SourceFile = { path: string; content: string };

/** One captured tree per publication, never a mixture of revisions. */
export async function loadPublicationFiles<T extends SourceFile>(input: {
  committed: () => Promise<T[]>;
  checkpoint: () => Promise<T[]>;
}): Promise<T[]> {
  const committed = await input.committed();
  const files = committed.length ? committed : await input.checkpoint();
  // A later generation write cannot change the artifact being published.
  return files.map(file => ({ ...file }));
}

/** Eligibility to attempt a build, not a claim that publication succeeded. */
export function publicationSourceReady(files: SourceFile[]): boolean {
  if (!files.some(file => /\.(?:html?|[jt]sx?|vue|svelte|astro)$/i.test(file.path) && file.content.trim())) return false;
  // A running starter saying "Building…" is not the user's generated site.
  return !Object.values(STARTERS).some(starter => isStarterEntryUntouched(files, starter));
}
