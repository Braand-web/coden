/**
 * Legacy compatibility entry point.
 *
 * Older page controllers still call this initializer. The old implementation
 * injected broad selectors such as `button:hover` and animated entire page
 * trees, which caused double transitions with component-level Motion. The
 * shared tokens now live in CSS and individual components own their motion.
 */
let installed = false;

export function initCodenMotion(root: ParentNode = document) {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.add('coden-motion-ready');
  document.body?.classList.add('coden-modern-shell');
  if (installed) return;
  installed = true;
  if (root instanceof Document) {
    document.documentElement.dataset.motionSystem = 'shared';
  }
}
