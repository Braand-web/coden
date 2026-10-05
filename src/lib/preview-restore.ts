/** Restore the saved document before a network check or a cold runtime boot. */
export async function restoreProjectPreview(input: {
  html?: string;
  status?: string;
  hasFiles: boolean;
  isUsable: (html: string) => boolean;
  renderSaved: (html: string, status: string) => void;
  resumeLive: () => Promise<boolean>;
  startLive: () => void;
  showLoading: () => void;
  isCurrent: () => boolean;
}): Promise<void> {
  const html = String(input.html || '');
  const saved = input.isUsable(html);
  if (!input.isCurrent()) return;
  if (saved) {
    // A stale run status must not hide real HTML or pretend it was verified.
    const status = input.status === 'verified' ? 'verified' : 'needs_fix';
    input.renderSaved(html, status);
  }
  let resumed = false;
  try { resumed = await input.resumeLive(); } catch { /* retain the saved app */ }
  if (!input.isCurrent() || resumed) return;
  if (!saved) input.showLoading();
  // Restore existing files, never request a new model generation.
  if (input.hasFiles) input.startLive();
}
