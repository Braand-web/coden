import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_DRAWER } from "../lib/ease";
import { cn } from "../lib/utils";
import "../styles/site-footer.css";
import { CodenBrand } from "./brand/coden-logo";
import { Button, IconButton } from "./ui/primitives";
import { focusFirst, setInertExcept, trapFocus } from "../lib/focus-management";


export function MarketingHeader({ signInLabel }: { signInLabel?: string }) {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [locale, setLocale] = React.useState<"fr" | "en">(() => {
    if (typeof document === "undefined") return "fr";
    return document.documentElement.dataset.lang === "en" || document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "fr";
  });
  const reduced = useReducedMotion();
  const headerRef = React.useRef<HTMLElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const labels = locale === "fr"
    ? { product: "Produit", examples: "Exemples", pricing: "Tarifs", faq: "FAQ", signIn: "Connexion", cta: signInLabel || "Essayer", open: "Ouvrir la navigation", close: "Fermer la navigation", theme: "Changer de thème" }
    : { product: "Product", examples: "Examples", pricing: "Pricing", faq: "FAQ", signIn: "Sign in", cta: signInLabel || "Try it", open: "Open navigation", close: "Close navigation", theme: "Change theme" };
  /*
   * The same navigation the landing draws, not a second one.
   *
   * The landing carries its header in its own markup and lists Produit,
   * Exemples, Tarifs, FAQ; this component listed Fonctionnalités, Tarifs,
   * Documentation. So following "Tarifs" from the home page landed on a page
   * whose header offered a different site — which reads as an older version
   * of the product, because that is what it was.
   *
   * The anchors are absolute: they point back at the landing sections, which
   * do not exist on the page this header is drawn on.
   */
  const links = [
    { href: "/#produit", label: labels.product, match: "/#produit" },
    { href: "/#exemples", label: labels.examples, match: "/#exemples" },
    { href: "/pricing.html", label: labels.pricing, match: "/pricing.html" },
    { href: "/#faq", label: labels.faq, match: "/#faq" },
  ];

  const closeMenu = React.useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 0);
  }, []);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    const onLanguage = () => setLocale(document.documentElement.dataset.lang === "en" ? "en" : "fr");
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("coden-language-change", onLanguage);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("coden-language-change", onLanguage);
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const restoreInert = setInertExcept(menuRef.current);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => focusFirst(menuRef.current));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu(true);
        return;
      }
      if (menuRef.current) trapFocus(event, menuRef.current);
    };
    const onResize = () => {
      if (window.innerWidth > 899) closeMenu(false);
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      restoreInert();
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, open]);

  return <header
    ref={headerRef}
    id="landing-navbar"
    className={cn("coden-react-marketing-header", open && "is-open")}
    data-header-state={scrolled ? "scrolled" : "top"}
    data-locale={locale}
  >
    <CodenBrand className="coden-react-brand" label={locale === "fr" ? "Accueil Coden" : "Coden home"} />
    <nav className="coden-react-nav" id="landing-nav-menu" aria-label={locale === "fr" ? "Navigation principale" : "Main navigation"}>
      {links.map(link => <a key={link.href} href={link.href} aria-current={pathname === link.match ? "page" : undefined}>{link.label}</a>)}
    </nav>
      <div className="coden-react-header-actions">
      <a className="coden-react-signin" data-conversion-event="sign_in_click" data-conversion-place="navbar" href="/auth.html">{labels.signIn}</a>
      <a className="coden-react-cta sign-in-btn" data-conversion-event="start_building_click" data-conversion-place="navbar" href="/auth.html?mode=signup&redirect=%2Fdashboard.html">{labels.cta}</a>
      <IconButton
        ref={triggerRef}
        id="landing-nav-toggle"
        className="coden-react-menu"
        label={open ? labels.close : labels.open}
        aria-controls="landing-nav-menu-mobile"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        <span className="coden-menu-icon" aria-hidden="true"><i></i><i></i><i></i></span>
      </IconButton>
    </div>
    <AnimatePresence initial={false}>
      {open ? <>
        <motion.div className="coden-react-mobile-backdrop" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18, ease: EASE_DRAWER }} onMouseDown={() => closeMenu(true)} />
        <motion.div ref={menuRef} id="landing-nav-menu-mobile" className="coden-react-mobile-nav" role="dialog" aria-modal="true" aria-label={locale === "fr" ? "Navigation mobile" : "Mobile navigation"} tabIndex={-1} initial={reduced ? { opacity: 1 } : { opacity: 0, y: -6, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6, scale: .985 }} transition={{ duration: reduced ? 0 : .24, ease: EASE_DRAWER }}>
          {links.map(link => <a key={link.href} href={link.href} aria-current={pathname === link.match ? "page" : undefined} onClick={() => closeMenu(false)}>{link.label}</a>)}
          <a className="coden-react-signin" data-conversion-event="sign_in_click" data-conversion-place="mobile_nav" href="/auth.html" onClick={() => closeMenu(false)}>{labels.signIn}</a>
          <a className="coden-react-cta" data-conversion-event="start_building_click" data-conversion-place="mobile_nav" href="/auth.html?mode=signup&redirect=%2Fdashboard.html" onClick={() => closeMenu(false)}>{labels.cta}</a>
        </motion.div>
      </> : null}
    </AnimatePresence>
  </header>;
}

/**
 * The same footer the landing draws.
 *
 * This was a four-column sitemap — brand statement, Produit, Ressources,
 * Confiance, Légal, plus its own call to action — while the landing ended on
 * one quiet line. Two footers for one site, so following any link out of the
 * home page changed the furniture underneath you.
 *
 * The landing's is the one that survived, so this is it: the year, the theme
 * control, and the three links somebody actually goes looking for down here.
 * Everything the columns listed is in the header or on the page above.
 */
export function MarketingFooter() {
  const english = typeof document !== "undefined" && (document.documentElement.dataset.lang === "en" || document.documentElement.lang.toLowerCase().startsWith("en"));
  const copy = english
    ? { theme: "Toggle theme", privacy: "Privacy", terms: "Terms", contact: "Contact" }
    : { theme: "Changer de thème", privacy: "Confidentialité", terms: "Conditions", contact: "Contact" };
  return <footer className="coden-site-footer">
    <div className="coden-site-footer-bottom">
      <span>@coden{new Date().getFullYear()}</span>
      <span>
        {/*
          * `data-theme-toggle` is the contract `initThemeController` binds to,
          * and it is the same attribute the landing's own button carries — one
          * controller, both surfaces.
          */}
        <button className="coden-site-theme-toggle" data-theme-toggle type="button" aria-label={copy.theme} title={copy.theme}>
          <svg data-theme-icon="dark" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 15.3A8.5 8.5 0 1 1 8.7 3.5 8.5 8.5 0 0 0 20.5 15.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <svg data-theme-icon="light" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </button>
        <a href="/privacy.html">{copy.privacy}</a>
        <a href="/terms.html">{copy.terms}</a>
        <a href="mailto:contact@coden.fun">{copy.contact}</a>
      </span>
    </div>
  </footer>;
}
