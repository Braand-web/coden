import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { AgentActivityItem } from '../../services/agent-run-store';

/**
 * The run's steps, with their real states.
 *
 * The server emits eight phases with active/done/failed states and the run
 * store turns them into this list — and nothing rendered it. The user could see
 * what Coden was doing right now, through the shimmer, but never what had
 * already run or where it had failed. That is the half of the pipeline that was
 * missing from the screen.
 *
 * Only the phases are shown. The same list also collects a row per generated
 * file and per verification check, which is useful data and the wrong shape for
 * this spine: twenty file rows between "Building" and "Verifying" turn a
 * readable pipeline into a log.
 */

export type AgentStepsProps = {
  activities: AgentActivityItem[];
  locale?: 'fr' | 'en';
};

const PHASE_PREFIX = 'phase:';

function StepMarker({ status }: { status: AgentActivityItem['status'] }) {
  if (status === 'done') {
    return (
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 8.5 6.2 12 13 4.5" />
      </svg>
    );
  }
  if (status === 'failed') {
    return (
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" />
      </svg>
    );
  }
  // Active and pending share the dot; the pulse is what separates them, and it
  // is a CSS animation so a reduced-motion reader simply sees a steady dot.
  return <span className="coden-agent-step__dot" />;
}

export function AgentSteps({ activities, locale = 'fr' }: AgentStepsProps) {
  const reduced = Boolean(useReducedMotion());
  const steps = (activities || []).filter(item => String(item.id || '').startsWith(PHASE_PREFIX));
  if (!steps.length) return null;

  return (
    <ol
      className="coden-agent-steps"
      aria-label={locale === 'fr' ? 'Étapes de la génération' : 'Generation steps'}
    >
      <AnimatePresence initial={false}>
        {steps.map(step => (
          <motion.li
            key={step.id}
            className="coden-agent-step"
            data-status={step.status}
            layout={!reduced}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="coden-agent-step__marker" aria-hidden="true"><StepMarker status={step.status} /></span>
            <span className="coden-agent-step__label">{step.label}</span>
            {step.detail ? <span className="coden-agent-step__detail">{step.detail}</span> : null}
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
