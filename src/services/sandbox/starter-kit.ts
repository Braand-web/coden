/**
 * The building blocks every generated application starts with.
 *
 * Left to itself the model rewrites a button, a modal and a toast for every
 * project — slowly, with a different bug each time, and usually without the
 * parts nobody sees: focus handling, Escape to close, a label wired to its
 * input, a loading state, reduced motion. Each of those is a repair round or
 * an accessibility failure waiting to happen.
 *
 * So the scaffold ships them, already on the project's tokens, and the prompt
 * lists them. The model composes an interface from finished parts and spends
 * its budget on the product. None of these paths is reserved: an app that
 * needs a different button changes this one.
 *
 * Everything here typechecks under the scaffold's strict tsconfig and uses only
 * the starter's pinned dependencies (react, motion, lucide-react,
 * react-router-dom).
 */

import type { SandboxFile } from './project-sandbox.ts';

const CN = `/** Join class names, skipping falsy values. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
`;

const STORAGE = `import { useEffect, useState } from 'react';

/**
 * State that survives a reload, stored in localStorage under \`key\`.
 * Use it for anything the user creates (items, settings, drafts) when the app
 * has no backend, so their work is still there when they come back.
 *
 * Pass realistic sample records as \`initial\`: they appear on a first visit
 * only (nothing stored yet), so the app opens showing itself at work, and
 * whatever the user does afterwards — clearing everything included — is what
 * persists.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (next: T | ((previous: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be full or blocked (private mode); the app keeps working in memory.
    }
  }, [key, value]);
  return [value, setValue];
}

/** A short unique id for new records. */
export function createId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
`;

const USE_THEME = `import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/** The current colour theme, persisted, applied as data-theme on <html>. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = window.localStorage.getItem('app-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Ignore unavailable storage.
    }
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('app-theme', theme);
    } catch {
      // Ignore unavailable storage.
    }
  }, [theme]);
  return [theme, () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))];
}
`;

const BUTTON = `import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-card',
  secondary: 'bg-surface-raised text-content border border-border hover:border-accent/50',
  ghost: 'bg-transparent text-secondary hover:bg-surface-raised hover:text-content',
  danger: 'bg-error text-on-accent hover:opacity-90',
};

const sizes: Record<Size, string> = {
  sm: 'min-h-[36px] px-3 text-sm gap-1.5',
  md: 'min-h-[44px] px-4 text-sm gap-2',
  lg: 'min-h-[52px] px-6 text-base gap-2.5',
};

/** The one button. Every action in the app uses it, so every action looks and behaves alike. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, iconRight, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-control font-medium',
        'transition-[background-color,border-color,color,transform,box-shadow] duration-micro ease-standard',
        'active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});
`;

const FIELD = `import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const control = cn(
  'w-full rounded-control border border-border bg-surface px-3 text-sm text-content placeholder:text-tertiary',
  'transition-[border-color,box-shadow] duration-micro ease-standard',
  'focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15',
  'aria-[invalid=true]:border-error',
);

type FieldProps = { label?: string; hint?: string; error?: string; children: (id: string, describedBy: string | undefined) => ReactNode };

/** A label, the control, and its hint or error — wired together for screen readers. */
export function Field({ label, hint, error, children }: FieldProps) {
  const id = useId();
  const describedBy = error || hint ? id + '-desc' : undefined;
  return (
    <div className="grid gap-1.5">
      {label ? <label htmlFor={id} className="text-sm font-medium text-content">{label}</label> : null}
      {children(id, describedBy)}
      {error ? <p id={describedBy} className="text-xs text-error">{error}</p> : hint ? <p id={describedBy} className="text-xs text-tertiary">{hint}</p> : null}
    </div>
  );
}

type Common = { label?: string; hint?: string; error?: string };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(function Input({ label, hint, error, className, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => <input ref={ref} id={props.id || id} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} className={cn(control, 'min-h-[44px]', className)} {...props} />}
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(function Textarea({ label, hint, error, className, rows = 4, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => <textarea ref={ref} id={props.id || id} rows={rows} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} className={cn(control, 'py-2.5', className)} {...props} />}
    </Field>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common>(function Select({ label, hint, error, className, children, ...props }, ref) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, describedBy) => <select ref={ref} id={props.id || id} aria-invalid={Boolean(error) || undefined} aria-describedby={describedBy} className={cn(control, 'min-h-[44px] pr-8', className)} {...props}>{children}</select>}
    </Field>
  );
});
`;

const CARD = `import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, interactive = false, ...props }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-card border border-border-subtle bg-surface p-5 shadow-card',
        interactive && 'transition-[transform,box-shadow,border-color] duration-state ease-standard hover:-translate-y-0.5 hover:border-border hover:shadow-card-hover',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ className, tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'error' }) {
  const tones = {
    neutral: 'bg-surface-raised text-secondary',
    accent: 'bg-accent/15 text-accent',
    success: 'bg-success/15 text-success',
    warning: 'bg-warning/15 text-warning',
    error: 'bg-error/15 text-error',
  } as const;
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone], className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-control bg-surface-raised', className)} />;
}
`;

const EMPTY_STATE = `import type { ReactNode } from 'react';

/** What a list says when it has nothing in it yet — never a blank area. */
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-raised text-secondary">{icon}</div> : null}
      <h3 className="text-base font-semibold text-content">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-secondary">{description}</p> : null}
      {action}
    </div>
  );
}
`;

const DIALOG = `import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';

/** An accessible modal: Escape and backdrop close it, focus moves in and comes back. */
export function Dialog({ open, onClose, title, description, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => panel.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className="relative w-full max-w-lg rounded-modal border border-border bg-surface p-6 shadow-card-hover outline-none"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-content">{title}</h2>
                {description ? <p className="mt-1 text-sm text-secondary">{description}</p> : null}
              </div>
              <button type="button" onClick={onClose} aria-label="Close" className="-m-2 flex h-10 min-h-0 w-10 items-center justify-center rounded-control text-secondary hover:bg-surface-raised hover:text-content">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            {children}
            {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div> : null}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
`;

const TOAST = `import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, XCircle } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
type Toast = { id: number; message: string; tone: Tone };
const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Wrap the app once; then \`const toast = useToast(); toast('Saved')\` anywhere. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Tone = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3200);
  }, []);
  const value = useMemo(() => push, [push]);
  const icons = { success: CheckCircle2, error: XCircle, info: Info } as const;
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = icons[toast.tone];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-card border border-border bg-surface-raised px-4 py-3 text-sm text-content shadow-card-hover"
              >
                <Icon className={toast.tone === 'error' ? 'h-4 w-4 text-error' : toast.tone === 'info' ? 'h-4 w-4 text-info' : 'h-4 w-4 text-success'} aria-hidden="true" />
                {toast.message}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
`;

const TABS = `import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

/** Segmented tabs with a sliding indicator. Controlled: pass value and onChange. */
export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: Array<{ value: T; label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const group = useId();
  return (
    <div role="tablist" className={cn('inline-flex rounded-control border border-border-subtle bg-surface-raised p-1', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn('relative min-h-[36px] rounded-[calc(var(--radius-control)-2px)] px-3 text-sm font-medium transition-colors duration-micro', active ? 'text-content' : 'text-secondary hover:text-content')}
          >
            {active ? <motion.span layoutId={group + '-indicator'} className="absolute inset-0 rounded-[calc(var(--radius-control)-2px)] bg-surface shadow-card" transition={{ type: 'spring', bounce: 0.18, duration: 0.4 }} /> : null}
            <span className="relative">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
`;

const REVEAL = `import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * Fades and lifts its content into place the first time it scrolls into view.
 * Use it on sections and cards; stagger siblings with \`delay\` (e.g. index * 0.06).
 */
export function Reveal({ children, delay = 0, y = 16, className }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.5, delay, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Page-level enter transition, for the top element of each route or view. */
export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }}
    >
      {children}
    </motion.div>
  );
}
`;

const NAVBAR = `import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export type NavItem = { label: string; href: string };

/**
 * A responsive top bar: links inline on desktop, a menu button and panel on
 * mobile. With react-router, pass \`renderLink\` to render a <NavLink>.
 */
export function Navbar({ brand, links, actions, renderLink, className }: {
  brand: ReactNode;
  links: NavItem[];
  actions?: ReactNode;
  renderLink?: (item: NavItem, props: { className: string; onClick: () => void }) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const link = (item: NavItem, extra: string) => {
    const props = { className: cn('rounded-control px-3 py-2 text-sm text-secondary transition-colors duration-micro hover:text-content', extra), onClick: () => setOpen(false) };
    return renderLink ? renderLink(item, props) : <a href={item.href} {...props}>{item.label}</a>;
  };
  return (
    <header className={cn('sticky top-0 z-40 border-b border-border-subtle bg-bg/80 backdrop-blur-md', className)}>
      <nav className="mx-auto flex h-16 max-w-container items-center justify-between gap-4 px-4 sm:px-6" aria-label="Main">
        <div className="flex min-w-0 items-center gap-2 font-display text-lg font-semibold text-content">{brand}</div>
        <div className="hidden items-center gap-1 md:flex">{links.map((item) => <span key={item.href}>{link(item, '')}</span>)}</div>
        <div className="hidden items-center gap-2 md:flex">{actions}</div>
        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-control text-content hover:bg-surface-raised md:hidden" aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((value) => !value)}>
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </nav>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="overflow-hidden border-t border-border-subtle bg-bg md:hidden"
          >
            <div className="grid gap-1 px-4 py-3">
              {links.map((item) => <span key={item.href}>{link(item, 'block')}</span>)}
              {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
`;

export const STARTER_KIT_FILES: readonly SandboxFile[] = [
  { path: 'src/lib/cn.ts', content: CN },
  { path: 'src/lib/storage.ts', content: STORAGE },
  { path: 'src/hooks/useTheme.ts', content: USE_THEME },
  { path: 'src/components/ui/Button.tsx', content: BUTTON },
  { path: 'src/components/ui/Field.tsx', content: FIELD },
  { path: 'src/components/ui/Card.tsx', content: CARD },
  { path: 'src/components/ui/EmptyState.tsx', content: EMPTY_STATE },
  { path: 'src/components/ui/Dialog.tsx', content: DIALOG },
  { path: 'src/components/ui/Toast.tsx', content: TOAST },
  { path: 'src/components/ui/Tabs.tsx', content: TABS },
  { path: 'src/components/motion/Reveal.tsx', content: REVEAL },
  { path: 'src/components/layout/Navbar.tsx', content: NAVBAR },
];

/** What the kit offers, in as few tokens as it can be said: this rides on every build prompt. */
export const STARTER_KIT_GUIDE = [
  'Ready-made building blocks (use them instead of rewriting; extend them if needed):',
  "- '@/components/ui/Button': <Button variant='primary|secondary|ghost|danger' size='sm|md|lg' loading icon={<Plus/>}>",
  "- '@/components/ui/Field': <Input label hint error />, <Textarea />, <Select /> (labels and errors wired for accessibility)",
  "- '@/components/ui/Card': <Card interactive />, <Badge tone='accent|success|warning|error' />, <Skeleton className='h-4 w-32' />",
  "- '@/components/ui/EmptyState': <EmptyState icon title description action />",
  "- '@/components/ui/Dialog': <Dialog open onClose title description footer> (Escape, focus, animation)",
  "- '@/components/ui/Toast': wrap the app in <ToastProvider>, then const toast = useToast(); toast('Saved', 'success')",
  "- '@/components/ui/Tabs': <Tabs tabs={[{value,label}]} value onChange /> with an animated indicator",
  "- '@/components/motion/Reveal': <Reveal delay={i*0.06}> for scroll entrances, <PageTransition> per view",
  "- '@/components/layout/Navbar': <Navbar brand links={[{label,href}]} actions renderLink? /> responsive with a mobile menu",
  "- '@/lib/storage': usePersistentState(key, initial) keeps user data across reloads; createId() for new records",
  "- '@/hooks/useTheme': const [theme, toggleTheme] = useTheme()",
  "Installed libraries: lucide-react (icons: import { Plus } from 'lucide-react'), motion (import { motion, AnimatePresence } from 'motion/react'), react-router-dom v6 (BrowserRouter, Routes, Route, NavLink, useNavigate).",
].join('\n');
