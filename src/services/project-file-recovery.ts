/** A working checkpoint must not be mixed into the last committed app. */
export function authoritativeProjectFiles<T>(committed: T[], checkpoint: T[]): T[] {
  return committed.length > 0 ? committed : checkpoint;
}
