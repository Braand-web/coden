import { motion, useReducedMotion } from 'motion/react';
import { ShimmeringText } from '../ui/shimmering-text';

/**
 * What the run says it is doing, from the click onwards.
 *
 * Nothing is known about the work for the first few seconds — auth, the
 * project lookup, the harness turn and the intent round all happen before the
 * first `activity` event, four to eight seconds by the run ledger. That gap
 * used to be three static bullets, which say "waiting" rather than "working".
 * It now says the same thing the server will say when it finally speaks.
 *
 * Deliberately the exact string the server sends as its own first label: the
 * caller keys this component on the text being shown, so the handover from the
 * placeholder to the real event changes neither the key nor the glyphs, and
 * the shimmer carries on uninterrupted instead of crossfading into itself.
 */
export const THINKING_LABEL = 'Coden réfléchit…';

/**
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
    <ShimmeringText text={label?.trim() || THINKING_LABEL} />
  </motion.div>;
}
