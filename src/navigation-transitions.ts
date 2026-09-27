let navigationStylesInstalled = false;

/**
 * Let same-origin links navigate immediately. The browser's cross-document
 * View Transition API supplies the transition where supported; older browsers
 * fall back to normal navigation without waiting on a JavaScript timer.
 */
export function initCodenNavigationTransitions(): void {
  if (navigationStylesInstalled || typeof document === 'undefined') return;
  navigationStylesInstalled = true;

  const style = document.createElement('style');
  style.id = 'coden-navigation-style';
  style.textContent = `
    @view-transition { navigation: auto; }

    ::view-transition-old(root) {
      animation: coden-view-old 140ms cubic-bezier(.32,.72,0,1) both;
    }

    ::view-transition-new(root) {
      animation: coden-view-new 220ms cubic-bezier(.32,.72,0,1) both;
    }

    @keyframes coden-view-old {
      to { opacity: 0; transform: translateY(-4px); }
    }

    @keyframes coden-view-new {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (prefers-reduced-motion: reduce) {
      ::view-transition-old(root),
      ::view-transition-new(root) { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}
