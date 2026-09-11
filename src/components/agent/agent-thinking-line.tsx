import { motion, useReducedMotion } from 'motion/react';
import { ShimmeringText } from '../ui/shimmering-text';

/**
 * The line that says what the run is doing right now.
 *
 * One label at a time, and each one leaves before the next arrives: the
 * transition is a crossfade with a direction — the outgoing phrase lifts away,
 * the incoming one rises into its place. Without it the text was replaced in
 * situ mid-shimmer, which reads as a glitch rather than as progress.
 *
 * The remount is driven by the caller keying this on the label itself
 * (`agent-message.tsx`); this component only owns what entering and leaving
 * look like. `aria-live` re-announcing on each remount is the wanted
 * behaviour — the status genuinely changed.
 */
export function AgentThinkingLine({ label }: { label?: string | null }) {
  const reduced = useReducedMotion();
  return <motion.div
    className="coden-thinking-line"
    role="status"
    aria-live="polite"
    initial={reduced ? false : { opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    exit={reduced ? { opacity: 0 } : { opacity: 0, y: -10 }}
    transition={{ duration: reduced ? 0 : 0.3 }}
  >
    {label ? <ShimmeringText text={label} /> : <span aria-hidden="true">•••</span>}
  </motion.div>;
}
