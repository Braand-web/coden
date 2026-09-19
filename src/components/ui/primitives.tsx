import * as React from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { EASE_DRAWER, EASE_OUT, SPRING_LAYOUT, SPRING_PRESS } from "../../lib/ease";
import { cn } from "../../lib/utils";
import { focusFirst, setInertExcept, trapFocus } from "../../lib/focus-management";

export function Card({ children, className, as: Tag = "article" }: { children: React.ReactNode; className?: string; as?: React.ElementType }) { return <Tag className={cn("coden-ui-card", className)}>{children}</Tag>; }

export const Button = React.forwardRef<HTMLButtonElement, Omit<HTMLMotionProps<"button">, "children"> & { children?: React.ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; loading?: boolean }>(function Button({ children, variant = "primary", loading = false, className, ...props }, ref) {
  const reduced = useReducedMotion();
  return <motion.button ref={ref} type="button" {...props} disabled={props.disabled || loading} aria-busy={loading || undefined} className={cn("coden-ui-button", `coden-ui-button-${variant}`, className)} whileTap={props.disabled || loading || reduced ? undefined : { scale: .98 }} transition={SPRING_PRESS}>{loading ? "Chargement…" : children}</motion.button>;
});
Button.displayName = "Button";

export const IconButton = React.forwardRef<HTMLButtonElement, Omit<HTMLMotionProps<"button">, "children"> & { label: string; children?: React.ReactNode }>(function IconButton({ label, children, className, ...props }, ref) { return <Button ref={ref} {...props} aria-label={label} title={label} variant="ghost" className={cn("coden-icon-button", className)}>{children}</Button>; });
IconButton.displayName = "IconButton";
export function Badge({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "success" | "warning" | "danger" }) { return <span className={cn("coden-ui-badge", `is-${tone}`)}>{children}</span>; }

export function Tabs({ items, value, onChange, className }: { items: Array<{ id: string; label: React.ReactNode; disabled?: boolean }>; value: string; onChange: (value: string) => void; className?: string }) {
  const reduced = useReducedMotion();
  return <LayoutGroup><div className={cn("coden-ui-tabs", className)} role="tablist">{items.map(item => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} disabled={item.disabled} className={cn("coden-ui-tab", value === item.id && "is-active")} onClick={() => onChange(item.id)}>{value === item.id ? <motion.span layoutId="coden-tab-indicator" className="coden-ui-tab-indicator" transition={reduced ? { duration: 0 } : SPRING_LAYOUT} /> : null}<span>{item.label}</span></button>)}</div></LayoutGroup>;
}

export function Dropdown({ trigger, children, open, onOpenChange, className }: { trigger: React.ReactNode; children: React.ReactNode; open: boolean; onOpenChange: (open: boolean) => void; className?: string }) { return <div className={cn("coden-ui-dropdown", className)}><button type="button" className="coden-ui-dropdown-trigger" aria-expanded={open} onClick={() => onOpenChange(!open)}>{trigger}</button><AnimatePresence>{open ? <motion.div className="coden-ui-dropdown-panel" initial={{ opacity: 0, y: -4, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: .98 }} transition={{ duration: .18, ease: EASE_OUT }} role="menu">{children}</motion.div> : null}</AnimatePresence></div>; }

export function Overlay({ open, onClose, title, children, sheet = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; sheet?: boolean }) {
  const panelRef = React.useRef<HTMLDivElement>(null); const triggerRef = React.useRef<HTMLElement | null>(null); const reduced = useReducedMotion();
  React.useEffect(() => { if (!open) return; triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; const restore = setInertExcept(panelRef.current); const timer = window.setTimeout(() => focusFirst(panelRef.current), 0); const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); if (panelRef.current) trapFocus(event, panelRef.current); }; document.addEventListener("keydown", handler); return () => { window.clearTimeout(timer); document.removeEventListener("keydown", handler); restore(); triggerRef.current?.focus({ preventScroll: true }); }; }, [open, onClose]);
  return <AnimatePresence>{open ? <motion.div className="coden-ui-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .18, ease: EASE_DRAWER }}><motion.div ref={panelRef} className={cn("coden-ui-overlay-panel", sheet && "is-sheet")} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} initial={reduced ? { opacity: 1 } : { opacity: 0, y: sheet ? 20 : 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: sheet ? 20 : 8, scale: .985 }} transition={{ duration: reduced ? 0 : .28, ease: EASE_DRAWER }}><div className="coden-ui-overlay-header"><h2>{title}</h2><IconButton label="Fermer" onClick={onClose}>×</IconButton></div>{children}</motion.div></motion.div> : null}</AnimatePresence>;
}

