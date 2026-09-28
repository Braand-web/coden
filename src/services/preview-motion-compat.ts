/** The saved, lightweight preview does not run Motion's animation engine. */
export const REDUCED_MOTION_PREVIEW_HOOK =
  'useReducedMotion: function() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); },';

/**
 * Older preview_html rows contain a Motion shim without this hook. Repair the
 * rendered document in memory so existing projects recover without changing
 * their source files, version history, or requiring a database migration.
 */
export function restoreLegacyMotionPreview(html: string): string {
  const source = String(html || '');
  const start = source.indexOf('window.MotionMock = {');
  if (start < 0) return source;
  const end = source.indexOf('window.require = function', start);
  if (end < 0) return source;
  const shim = source.slice(start, end);
  if (/\buseReducedMotion\s*:/.test(shim)) return source;
  const anchor = /(AnimatePresence: function\(props\) \{ return props\.children; \},\r?\n)/;
  if (!anchor.test(shim)) return source;
  return source.slice(0, start)
    + shim.replace(anchor, `$1      ${REDUCED_MOTION_PREVIEW_HOOK}\n`)
    + source.slice(end);
}
