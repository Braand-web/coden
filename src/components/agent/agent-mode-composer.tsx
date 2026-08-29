import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BookOpen, Bug, ChevronDown, Check, MessageCircle, ScanSearch, ShieldCheck, WandSparkles, ListChecks } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { EASE_OUT, SPRING_PRESS } from '../../lib/ease';
import { cn } from '../../lib/utils';
import { modeLabel, normalizeAgentMode, type AgentMode } from '../../services/agent-run-contract';
import '../../styles/agent-conversation.css';

type AgentModeComposerProps = {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
  locale?: 'fr' | 'en';
  className?: string;
  triggerId?: string;
};

const MODE_DETAILS = {
  auto: { icon: WandSparkles, fr: 'Coden choisit la meilleure action selon votre demande.', en: 'Coden chooses the best action for your request.' },
  build: { icon: ShieldCheck, fr: 'Coden modifie le projet et vérifie le résultat.', en: 'Coden edits the project and verifies the result.' },
  plan: { icon: ListChecks, fr: 'Coden prépare un plan sans modifier les fichiers.', en: 'Coden prepares a plan without changing files.' },
  ask: { icon: MessageCircle, fr: 'Répondre et expliquer sans modifier le projet.', en: 'Answer and explain without changing the project.' },
  fix: { icon: Bug, fr: 'Reproduire le bug, corriger puis retester.', en: 'Reproduce the bug, fix it, then retest.' },
  review: { icon: ScanSearch, fr: 'Auditer le code et la preview sans modification.', en: 'Audit code and preview without making changes.' },
  research: { icon: BookOpen, fr: 'Rechercher avec des sources réelles, sans modification.', en: 'Research with real sources, without making changes.' },
} as const;

const PRIMARY_MODES: AgentMode[] = ['auto', 'build', 'plan'];
const ADVANCED_MODES: AgentMode[] = ['ask', 'fix', 'review', 'research'];
const MODE_OPTIONS: AgentMode[] = [...PRIMARY_MODES, ...ADVANCED_MODES];

export function AgentModeComposer({ mode, onModeChange, disabled = false, locale = 'fr', className, triggerId }: AgentModeComposerProps) {
  const [open, setOpen] = useState(false);
  const [selectedMode, setSelectedMode] = useState<AgentMode>(normalizeAgentMode(mode));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduced = useReducedMotion();
  const normalized = selectedMode;
  const options = MODE_OPTIONS;

  useEffect(() => setSelectedMode(normalizeAgentMode(mode)), [mode]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const next = normalizeAgentMode((event as CustomEvent<{ mode?: string }>).detail?.mode);
      setSelectedMode(next);
    };
    window.addEventListener('coden-agent-mode-sync', onSync);
    return () => window.removeEventListener('coden-agent-mode-sync', onSync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const current = options.indexOf(normalized);
        const next = event.key === 'ArrowDown' ? (current + 1) % options.length : (current - 1 + options.length) % options.length;
        onModeChange(options[next]);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, normalized, onModeChange]);

  const CurrentIcon = MODE_DETAILS[normalized].icon;
  return (
    <div className={cn('coden-agent-mode-composer', className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="coden-agent-mode-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title={MODE_DETAILS[normalized][locale]}
      >
        <CurrentIcon aria-hidden="true" size={14} />
        <span>{modeLabel(normalized, locale)}</span>
        <ChevronDown aria-hidden="true" size={14} className={cn(open && 'is-open')} />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            ref={menuRef}
            id={menuId}
            role="menu"
            className="coden-agent-mode-menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 5, scale: .98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 5, scale: .98 }}
            transition={reduced ? { duration: 0 } : { duration: .18, ease: EASE_OUT }}
          >
            {options.map((option) => {
              const Icon = MODE_DETAILS[option].icon;
              const active = option === normalized;
              return (
                <React.Fragment key={option}>
                {option === 'ask' ? <div className="coden-agent-mode-section-label" role="presentation">{locale === 'fr' ? 'Avancé' : 'Advanced'}</div> : null}
                <motion.button
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={cn('coden-agent-mode-option', active && 'is-active')}
                  whileTap={reduced ? undefined : { scale: .98 }}
                  transition={SPRING_PRESS}
                  onClick={() => {
                    setSelectedMode(option);
                    onModeChange(option);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <Icon aria-hidden="true" size={15} />
                  <span className="coden-agent-mode-option-copy">
                    <strong>{modeLabel(option, locale)}</strong>
                    <small>{MODE_DETAILS[option][locale]}</small>
                  </span>
                  {active ? <Check aria-hidden="true" size={15} /> : null}
                </motion.button>
                </React.Fragment>
              );
            })}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function mountAgentModeComposer(host: HTMLElement, props: AgentModeComposerProps) {
  // This adapter lets the existing Vite MPA shells use the shared React control
  // without forcing a page-wide React migration.
  const root = createRoot(host);
  root.render(<AgentModeComposer {...props} />);
  return () => root.unmount();
}
