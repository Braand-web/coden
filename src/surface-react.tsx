import { createRoot, type Root } from "react-dom/client";
import { MarketingHeader } from "./components/shells";

let marketingRoot: Root | null = null;

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
  document.body.classList.add("coden-react-surface-home");
}
