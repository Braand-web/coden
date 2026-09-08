import { createRoot, type Root } from "react-dom/client";
import { MarketingFooter, MarketingHeader } from "./components/shells";
import { initThemeController } from "./theme-controller";

let marketingRoot: Root | null = null;
let marketingFooterRoot: Root | null = null;

/** Mounts only the shared React chrome. Existing prompt and business adapters
 * remain in place until their surface migration is validated. */
export function mountMarketingReactShell(): void {
  const isPrivate = /\/(auth|builder|dashboard|admin|checkout)\.html$/.test(window.location.pathname);
  if (isPrivate) return;
  // The legacy public nav is static markup kept only for migration safety.
  // Remove it before React mounts so duplicate IDs/listeners cannot survive.
  document.querySelectorAll('.navbar, .seo-nav, .navbar-line').forEach((node) => node.remove());
  let host = document.getElementById("coden-marketing-header-root") || document.getElementById("coden-react-marketing-root");
  if (!host) {
    host = document.createElement("div");
    host.id = "coden-marketing-header-root";
    host.setAttribute("aria-live", "off");
    document.body.prepend(host);
  }
  if (!host || marketingRoot) return;
  marketingRoot = createRoot(host);
  marketingRoot.render(<MarketingHeader />);
  // React commits the header after the shell mount call. Bind the theme
  // control on the next frame so public pages can toggle immediately.
  window.requestAnimationFrame(() => initThemeController());
  const legacyFooter = document.querySelector<HTMLElement>('.footer, .seo-footer, .pricing-footer');
  let footerHost = document.getElementById('coden-marketing-footer-root');
  if (!footerHost) {
    footerHost = document.createElement('div');
    footerHost.id = 'coden-marketing-footer-root';
    if (legacyFooter?.parentElement) legacyFooter.parentElement.insertBefore(footerHost, legacyFooter);
    else document.body.appendChild(footerHost);
  }
  legacyFooter?.remove();
  if (!marketingFooterRoot) {
    marketingFooterRoot = createRoot(footerHost);
    marketingFooterRoot.render(<MarketingFooter />);
  }
  document.body.classList.add("coden-react-surface-home");
}
