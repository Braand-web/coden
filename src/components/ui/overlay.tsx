import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EASE_DRAWER } from "../../lib/ease";
import { focusFirst, setInertExcept, trapFocus } from "../../lib/focus-management";
import { cn } from "../../lib/utils";

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
  mobileSheet?: boolean;
};

export function CodenOverlay({ open, onClose, title, children, className, mobileSheet = false }: OverlayProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLElement | null>(null);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreInert = setInertExcept(panelRef.current);
    const focusTimer = window.setTimeout(() => focusFirst(panelRef.current), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (panelRef.current) trapFocus(event, panelRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      restoreInert();
      triggerRef.current?.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="coden-overlay-root"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: EASE_DRAWER }}
          onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
          <motion.div
            ref={panelRef}
            className={cn("coden-overlay-panel", mobileSheet && "coden-overlay-sheet", className)}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: mobileSheet ? 18 : 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: mobileSheet ? 18 : 8, scale: 0.985 }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: EASE_DRAWER }}
          >
            {title ? <h2 className="coden-overlay-title">{title}</h2> : null}
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
