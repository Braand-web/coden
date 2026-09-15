import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Check, ChevronDown, Lightbulb, ListChecks } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { SPRING_PRESS } from '../../lib/ease';
import { cn } from '../../lib/utils';
import { modeLabel, normalizeAgentMode, type AgentMode } from '../../services/agent-mode';
import '../../styles/agent-conversation.css';
import '../../styles/agent-surface.css';

type AgentModeComposerProps = {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
  locale?: 'fr' | 'en';
  className?: string;
  triggerId?: string;
};

const MODE_DETAILS = {
  auto: { icon: Lightbulb, fr: 'Coden choisit la meilleure action.', en: 'Coden chooses the best action.' },
  plan: { icon: ListChecks, fr: 'Préparer le travail sans modifier le projet.', en: 'Prepare the work without changing the project.' },
} as const;

export const COMPOSER_AGENT_MODES = ['auto', 'plan'] as const satisfies readonly AgentMode[];
type VisibleAgentMode = (typeof COMPOSER_AGENT_MODES)[number];

function visibleMode(mode: AgentMode): VisibleAgentMode {
  return COMPOSER_AGENT_MODES.includes(mode as VisibleAgentMode) ? mode as VisibleAgentMode : 'auto';
}

export function AgentModeComposer({ mode, onModeChange, disabled = false, locale = 'fr', className, triggerId }: AgentModeComposerProps) {
  const [selectedMode, setSelectedMode] = useState<VisibleAgentMode>(visibleMode(normalizeAgentMode(mode)));
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const normalized = selectedMode;

  useEffect(() => setSelectedMode(visibleMode(normalizeAgentMode(mode))), [mode]);

  useEffect(() => {
    const onSync = (event: Event) => {
      const next = visibleMode(normalizeAgentMode((event as CustomEvent<{ mode?: string }>).detail?.mode));
      setSelectedMode(next);
    };
    window.addEventListener('coden-agent-mode-sync', onSync);
    return () => window.removeEventListener('coden-agent-mode-sync', onSync);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const CurrentIcon = MODE_DETAILS[normalized].icon;
  const actionLabel = locale === 'fr' ? 'Choisir le mode de travail' : 'Choose work mode';

  const chooseMode = (next: VisibleAgentMode) => {
    if (next !== normalized) {
      setSelectedMode(next);
      onModeChange(next);
    }
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('coden-agent-mode-composer', className)}>
      <motion.button
        id={triggerId}
        type="button"
        className="coden-agent-mode-trigger"
        aria-label={actionLabel}
        aria-pressed={normalized === 'plan'}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="menu"
        disabled={disabled}
        whileTap={reduced ? undefined : { scale: .98 }}
        transition={SPRING_PRESS}
        onClick={() => setOpen(value => !value)}
        title={MODE_DETAILS[normalized][locale]}
      >
        <CurrentIcon aria-hidden="true" size={14} />
        <span>{modeLabel(normalized, locale)}</span>
        <ChevronDown className={open ? 'is-open' : undefined} aria-hidden="true" size={13} />
      </motion.button>
      {open ? (
        <div id={menuId} className="coden-agent-mode-menu" role="menu" aria-label={actionLabel}>
          {COMPOSER_AGENT_MODES.map((candidate) => {
            const CandidateIcon = MODE_DETAILS[candidate].icon;
            const active = candidate === normalized;
            return (
              <button
                key={candidate}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={cn('coden-agent-mode-option', active && 'is-active')}
                onClick={() => chooseMode(candidate)}
              >
                <CandidateIcon aria-hidden="true" size={16} />
                <span className="coden-agent-mode-option-copy">
                  <strong>{modeLabel(candidate, locale)}</strong>
                  <small>{MODE_DETAILS[candidate][locale]}</small>
                </span>
                {active ? <Check aria-hidden="true" size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
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
