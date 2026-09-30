/**
 * The JavaScript half of the shimmer glow: the off switch, and the pauses.
 *
 * The glow itself is CSS (`styles/shimmer-glow.css`). This only
 *  - reads the off switch (localStorage `coden-shimmer-glow` = `off`, or the build flag `VITE_CODEN_SHIMMER_GLOW=0`)
 *    and marks `<html data-shimmer-glow="off">`,
 *  - marks `<html data-tab-hidden>` while the tab is in the background,
 *  - marks a shimmer `data-glow-paused` while it is off screen.
 * Idempotent: any entry can call it.
 */
const HOSTS = '.coden-shimmer-text, .coden-shimmer, .coden-skeleton, .coden-ui-shimmer';
let installed = false;

export function shimmerGlowEnabled(): boolean {
  try {
    if ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_CODEN_SHIMMER_GLOW === '0') return false;
    return window.localStorage.getItem('coden-shimmer-glow') !== 'off';
  } catch {
    return true;
  }
}

export function installShimmerGlow(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const root = document.documentElement;
  if (!shimmerGlowEnabled()) { root.dataset.shimmerGlow = 'off'; return; }
  root.dataset.shimmerGlow = 'on';

  const syncTab = () => { if (document.hidden) root.dataset.tabHidden = ''; else delete root.dataset.tabHidden; };
  document.addEventListener('visibilitychange', syncTab);
  syncTab();

  if (!('IntersectionObserver' in window) || !('MutationObserver' in window)) return;
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.removeAttribute('data-glow-paused');
      else entry.target.setAttribute('data-glow-paused', '');
    }
  });
  const watch = (node: Element) => { if (node.matches?.(HOSTS)) seen.observe(node); node.querySelectorAll?.(HOSTS).forEach(host => seen.observe(host)); };
  const unwatch = (node: Element) => { if (node.matches?.(HOSTS)) seen.unobserve(node); node.querySelectorAll?.(HOSTS).forEach(host => seen.unobserve(host)); };
  new MutationObserver(records => {
    for (const record of records) {
      record.addedNodes.forEach(node => { if (node.nodeType === 1) watch(node as Element); });
      record.removedNodes.forEach(node => { if (node.nodeType === 1) unwatch(node as Element); });
    }
  }).observe(root, { childList: true, subtree: true });
  watch(root);
}
