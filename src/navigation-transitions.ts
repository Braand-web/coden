import { prefersReducedMotion } from './lib/motion-preferences';

let navigationInstalled = false;
const EXIT_DELAY_MS = 120;

function isModifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function isNavigableLink(link: HTMLAnchorElement): boolean {
  if (!link.href || link.target === '_blank' || link.hasAttribute('download')) return false;
  if (link.dataset.noTransition === 'true' || link.getAttribute('aria-disabled') === 'true') return false;
  const destination = new URL(link.href, window.location.href);
  if (destination.origin !== window.location.origin) return false;
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) {
    return destination.hash.length > 0;
  }
  return destination.protocol === window.location.protocol;
}

function installNavigationStyles() {
  if (document.getElementById('coden-navigation-style')) return;
  const style = document.createElement('style');
  style.id = 'coden-navigation-style';
  style.textContent = `
    @view-transition { navigation: auto; }
    ::view-transition-old(root) { animation: coden-view-old 180ms cubic-bezier(.16,1,.3,1) both; }
    ::view-transition-new(root) { animation: coden-view-new 280ms cubic-bezier(.16,1,.3,1) 60ms both; }
    @keyframes coden-view-old { to { opacity: 0; transform: translateY(-8px); filter: blur(4px); } }
    @keyframes coden-view-new {
      from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
      to { opacity: 1; transform: translateY(0); filter: blur(0); }
    }
    html[data-navigation-state="leaving"] body { animation: coden-navigation-leave 120ms cubic-bezier(.16,1,.3,1) both; }
    html[data-navigation-state="entering"] body { animation: coden-navigation-enter 280ms cubic-bezier(.16,1,.3,1) both; }
    @keyframes coden-navigation-leave { to { opacity: .72; transform: translateY(-4px); filter: blur(2px); } }
    @keyframes coden-navigation-enter {
      from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
      to { opacity: 1; transform: translateY(0); filter: blur(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root), ::view-transition-new(root),
      html[data-navigation-state="leaving"] body,
      html[data-navigation-state="entering"] body { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}

function markEntering() {
  const root = document.documentElement;
  root.dataset.navigationState = prefersReducedMotion() ? 'reduced' : 'entering';
  window.requestAnimationFrame(() => {
    if (root.dataset.navigationState === 'entering') delete root.dataset.navigationState;
  });
}

export function initCodenNavigationTransitions(): void {
  if (navigationInstalled || typeof document === 'undefined') return;
  navigationInstalled = true;
  installNavigationStyles();
  markEntering();

  document.addEventListener('click', (event) => {
    if (!(event instanceof MouseEvent) || isModifiedClick(event)) return;
    const target = event.target instanceof Element ? event.target.closest('a') : null;
    if (!(target instanceof HTMLAnchorElement) || !isNavigableLink(target)) return;

    const destination = new URL(target.href, window.location.href);
    if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
    if (document.documentElement.dataset.navigationState === 'leaving') {
      event.preventDefault();
      return;
    }
    if (prefersReducedMotion()) return;

    event.preventDefault();
    document.documentElement.dataset.navigationState = 'leaving';
    window.setTimeout(() => window.location.assign(destination.href), EXIT_DELAY_MS);
  }, { capture: true });

  window.addEventListener('pageshow', markEntering);
}
