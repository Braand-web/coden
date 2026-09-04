import { motion, useReducedMotion } from 'motion/react';
import { ShimmeringText } from '../ui/shimmering-text';
export function AgentThinkingLine({ label }: { label?: string | null }) {
  const reduced = useReducedMotion();
  return <motion.div className="coden-thinking-line" role="status" aria-live="polite" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : .2 }}>
    <ShimmeringText text={label || 'Traitement en cours'} />
  </motion.div>;
}
