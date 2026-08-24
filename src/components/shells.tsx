import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_DRAWER } from "../lib/ease";
import { cn } from "../lib/utils";
import { CodenBrand } from "./brand/coden-logo";
import { Button, IconButton } from "./ui/primitives";
import { focusFirst, setInertExcept, trapFocus } from "../lib/focus-management";

export function MarketingShell({ children, className }: { children: React.ReactNode; className?: string }) { return <div className={cn("coden-marketing-shell", className)}>{children}</div>; }
export function AuthShell({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) { return <div className={cn("coden-auth-shell", className)}><main className="coden-auth-main">{children}</main>{aside ? <aside className="coden-auth-aside">{aside}</aside> : null}</div>; }
export function DashboardShell({ sidebar, children, className }: { sidebar: React.ReactNode; children: React.ReactNode; className?: string }) { return <div className={cn("coden-dashboard-shell", className)}>{sidebar}<main className="coden-dashboard-main">{children}</main></div>; }
export function BuilderShell({ toolbar, sidebar, conversation, preview, className }: { toolbar: React.ReactNode; sidebar?: React.ReactNode; conversation: React.ReactNode; preview: React.ReactNode; className?: string }) { return <div className={cn("coden-builder-shell", className)}><header className="coden-builder-toolbar">{toolbar}</header><div className="coden-builder-grid">{sidebar ? <aside className="coden-builder-sidebar">{sidebar}</aside> : null}<section className="coden-builder-conversation">{conversation}</section><section className="coden-builder-preview">{preview}</section></div></div>; }

export function MarketingHeader({ signInLabel = "Créer mon application" }: { signInLabel?: string }) {
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [locale, setLocale] = React.useState<"fr" | "en">(() => {
    if (typeof document === "undefined") return "fr";
    return document.documentElement.dataset.lang === "en" ? "en" : "fr";
  });
  const reduced = useReducedMotion();
  const headerRef = React.useRef<HTMLElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const labels = locale === "fr"
    ? { features: "Fonctionnalités", pricing: "Tarifs", documentation: "Documentation", cta: signInLabel, open: "Ouvrir la navigation", close: "Fermer la navigation", theme: "Changer de thème" }
    : { features: "Features", pricing: "Pricing", documentation: "Documentation", cta: "Create my app", open: "Open navigation", close: "Close navigation", theme: "Change theme" };
  const links = [
    { href: "/features.html", label: labels.features, match: "/features.html" },
    { href: "/pricing.html", label: labels.pricing, match: "/pricing.html" },
    { href: "/documentation.html", label: labels.documentation, match: "/documentation.html" },
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
      <button type="button" className="coden-react-theme-toggle" data-theme-toggle aria-label={labels.theme} title={labels.theme}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
          <path d="M20.8 15.1A8.5 8.5 0 0 1 8.9 3.2 8.5 8.5 0 1 0 20.8 15.1Z" />
        </svg>
      </button>
      <a className="coden-react-cta sign-in-btn" data-conversion-event="sign_in_click" data-conversion-place="navbar" href="/auth.html">{labels.cta}</a>
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
          <a className="coden-react-cta" data-conversion-event="sign_in_click" data-conversion-place="mobile_nav" href="/auth.html" onClick={() => closeMenu(false)}>{labels.cta}</a>
        </motion.div>
      </> : null}
    </AnimatePresence>
  </header>;
}

export function MarketingFooter() {
  return <footer className="coden-react-footer"><div className="coden-react-footer-top"><div><CodenBrand className="coden-react-brand" /><p>De l’idée au produit web vérifié.</p></div><div className="coden-react-footer-cta"><span>Votre idée mérite un premier prototype.</span><Button onClick={() => { window.location.href = "/auth.html"; }}>Créer mon application</Button></div></div><div className="coden-react-footer-grid"><div><h2>Produit</h2><a href="/features.html">Fonctionnalités</a><a href="/pricing.html">Tarifs</a></div><div><h2>Ressources</h2><a href="/documentation.html">Documentation</a></div><div><h2>Confiance</h2><a href="/security.html">Sécurité</a></div><div><h2>Légal</h2><a href="/privacy.html">Confidentialité</a><a href="/terms.html">Conditions</a><a href="mailto:contact@coden.fun">Contact</a></div></div><div className="coden-react-footer-bottom"><span>© {new Date().getFullYear()} Coden</span><span>Construire avec clarté.</span></div></footer>;
}
