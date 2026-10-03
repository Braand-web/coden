/** A working checkpoint must not be mixed into the last committed app. */
export function authoritativeProjectFiles<T>(committed: T[], checkpoint: T[]): T[] {
  return committed.length > 0 ? committed : checkpoint;
}

/** Resume the first interrupted build instead of starting over from an empty scaffold. */
export async function loadGenerationFiles<T>(input: {
  committed: () => Promise<T[]>;
  checkpoint: () => Promise<T[]>;
}): Promise<T[]> {
  const committed = await input.committed();
  if (committed.length) return committed;
  // A read failure is not an empty project. Let the caller stop safely.
  return input.checkpoint();
}
