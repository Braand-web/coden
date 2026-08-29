'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ShimmeringText } from '../ui/shimmering-text';
import type { AgentPublicPhase } from '../../services/agent-run-contract';

export type AgentActivityShimmerProps = {
  runId: string;
  phase: AgentPublicPhase;
  message: string;
  active: boolean;
  reducedMotion?: boolean;
};

export function AgentActivityShimmer({ runId, phase, message, active, reducedMotion }: AgentActivityShimmerProps) {
  const systemReducedMotion = useReducedMotion();
  const reduced = reducedMotion ?? Boolean(systemReducedMotion);
  return (
    <div className="coden-agent-activity" aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="wait" initial={false}>
        {active && message ? (
          <motion.div
            key={`${runId}:${phase}:${message}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <ShimmeringText text={message} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
