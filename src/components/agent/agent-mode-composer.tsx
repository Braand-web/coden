import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WandSparkles, ListChecks } from 'lucide-react';
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
  auto: { icon: WandSparkles, fr: 'Coden choisit la meilleure action.', en: 'Coden chooses the best action.' },
  plan: { icon: ListChecks, fr: 'Préparer le travail sans modifier le projet.', en: 'Prepare the work without changing the project.' },
} as const;

export const COMPOSER_AGENT_MODES = ['auto', 'plan'] as const satisfies readonly AgentMode[];
type VisibleAgentMode = (typeof COMPOSER_AGENT_MODES)[number];

function visibleMode(mode: AgentMode): VisibleAgentMode {
  return COMPOSER_AGENT_MODES.includes(mode as VisibleAgentMode) ? mode as VisibleAgentMode : 'auto';
}

export function AgentModeComposer({ mode, onModeChange, disabled = false, locale = 'fr', className, triggerId }: AgentModeComposerProps) {
  const [selectedMode, setSelectedMode] = useState<VisibleAgentMode>(visibleMode(normalizeAgentMode(mode)));
  const reduced = useReducedMotion();
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

  const CurrentIcon = MODE_DETAILS[normalized].icon;
  const nextMode: VisibleAgentMode = normalized === 'auto' ? 'plan' : 'auto';
  const actionLabel = locale === 'fr'
    ? (nextMode === 'plan' ? 'Passer en mode Plan' : 'Revenir au mode Auto')
    : (nextMode === 'plan' ? 'Switch to Plan mode' : 'Return to Auto mode');

  return (
    <div className={cn('coden-agent-mode-composer', className)}>
      <motion.button
        id={triggerId}
        type="button"
        className="coden-agent-mode-trigger"
        aria-label={actionLabel}
        aria-pressed={normalized === 'plan'}
        disabled={disabled}
        whileTap={reduced ? undefined : { scale: .98 }}
        transition={SPRING_PRESS}
        onClick={() => {
          setSelectedMode(nextMode);
          onModeChange(nextMode);
        }}
        title={MODE_DETAILS[normalized][locale]}
      >
        <CurrentIcon aria-hidden="true" size={14} />
        <span>{modeLabel(normalized, locale)}</span>
      </motion.button>
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
