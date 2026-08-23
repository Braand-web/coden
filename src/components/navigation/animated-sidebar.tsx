import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_DRAWER, SPRING_LAYOUT, SPRING_PRESS } from "../../lib/ease";
import { focusFirst, setInertExcept, trapFocus } from "../../lib/focus-management";
import { cn } from "../../lib/utils";

type SidebarMode = "expanded" | "collapsed";
type SidebarContextValue = {
  mode: SidebarMode;
  mobileOpen: boolean;
  setMode: (mode: SidebarMode) => void;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useAnimatedSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error("useAnimatedSidebar must be used inside AnimatedSidebarProvider");
  return context;
}

type ProviderProps = {
  children: React.ReactNode;
  storageKey?: string;
  defaultCollapsed?: boolean;
};

export function AnimatedSidebarProvider({ children, storageKey = "coden-sidebar-collapsed", defaultCollapsed = false }: ProviderProps) {
  const [mode, setModeState] = React.useState<SidebarMode>(defaultCollapsed ? "collapsed" : "expanded");
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "true") setModeState("collapsed");
  }, [storageKey]);

  const setMode = React.useCallback((next: SidebarMode) => {
    setModeState(next);
    window.localStorage.setItem(storageKey, String(next === "collapsed"));
  }, [storageKey]);
  const toggle = React.useCallback(() => setMode(mode === "expanded" ? "collapsed" : "expanded"), [mode, setMode]);

  return <SidebarContext.Provider value={{ mode, mobileOpen, setMode, toggle, setMobileOpen }}>{children}</SidebarContext.Provider>;
}

export function AnimatedSidebar({ children, className, label = "Navigation principale" }: { children: React.ReactNode; className?: string; label?: string }) {
  const { mode, mobileOpen, setMobileOpen } = useAnimatedSidebar();
  const reduceMotion = useReducedMotion();
  const panelRef = React.useRef<HTMLElement>(null);
  const openerRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!mobileOpen) return undefined;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreInert = setInertExcept(panelRef.current);
    const timer = window.setTimeout(() => focusFirst(panelRef.current), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
      if (panelRef.current) trapFocus(event, panelRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      restoreInert();
      openerRef.current?.focus({ preventScroll: true });
    };
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      <AnimatePresence>
        {mobileOpen ? (
          <motion.button
            type="button"
            className="coden-sidebar-backdrop"
            aria-label="Fermer la navigation"
            onClick={() => setMobileOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          />
        ) : null}
      </AnimatePresence>
      <motion.aside
        ref={panelRef}
        className={cn("coden-animated-sidebar", mode === "collapsed" && "is-collapsed", mobileOpen && "is-mobile-open", className)}
        aria-label={label}
        data-sidebar-mode={mode}
        initial={false}
        animate={{ width: mode === "collapsed" ? 72 : 256 }}
        transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
      >
        {children}
      </motion.aside>
    </>
  );
}

export function AnimatedSidebarInset({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={cn("coden-animated-sidebar-inset", className)}>{children}</main>;
}

export function AnimatedSidebarRail({ children, className }: { children?: React.ReactNode; className?: string }) {
  const { mode } = useAnimatedSidebar();
  return <div className={cn("coden-animated-sidebar-rail", mode === "collapsed" && "is-visible", className)} aria-hidden={mode !== "collapsed"}>{children}</div>;
}

export function AnimatedSidebarTrigger({ className, label = "Ouvrir la navigation" }: { className?: string; label?: string }) {
  const { toggle, setMobileOpen } = useAnimatedSidebar();
  return (
    <motion.button
      type="button"
      className={cn("coden-sidebar-trigger", className)}
      aria-label={label}
      title={label}
      onClick={() => {
        if (window.matchMedia("(max-width: 899px)").matches) setMobileOpen(true);
        else toggle();
      }}
      whileTap={{ scale: 0.96 }}
      transition={SPRING_PRESS}
    >
      <span aria-hidden="true">☰</span>
    </motion.button>
  );
}

export const SidebarTrigger = AnimatedSidebarTrigger;
