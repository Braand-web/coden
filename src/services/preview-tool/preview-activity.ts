/**
 * Whether the person is using the preview themselves.
 *
 * The agent's browser is its own, so it cannot step on the user's clicks — but
 * both reach the same app and the same data. When the person has just clicked
 * or typed in the preview, the agent waits its turn before operating the app.
 * The builder reports activity (the window loses focus to the preview frame);
 * this remembers it for a few seconds.
 */
const activeUntil = new Map<string, number>();
const HOLD_MS = 8_000;

export function markPreviewUserActive(projectId: string, now = Date.now()): void {
  if (!projectId) return;
  activeUntil.set(projectId, now + HOLD_MS);
  // Nothing accumulates: an entry that has lapsed is dropped on the next mark.
  for (const [key, until] of activeUntil) if (until < now - 60_000) activeUntil.delete(key);
}

export function previewUserActiveUntil(projectId: string): number {
  return activeUntil.get(projectId) ?? 0;
}
