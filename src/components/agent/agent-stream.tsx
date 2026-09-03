'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AgentResponse } from './agent-response';
import { ShimmeringText } from '../ui/shimmering-text';
import type { AgentRunViewModel } from '../../services/agent-run-store';

type AgentPublicActivity = NonNullable<AgentRunViewModel['publicActivity']>;

/**
 * One flowing area for the run's live text: a shimmer while there is
 * nothing to show yet, real text growing token by token the moment there
 * is. `AgentRunPanel` used to render `AgentActivityShimmer` and
 * `AgentResponse` as two separate, sequential blocks — correct, but a
 * visible jump rather than one continuous stream. This crossfades the same
 * two pieces (both kept as-is, and still directly tested on their own) in a
 * single slot instead.
 */

export type AgentStreamProps = {
  runId: string;
  activity?: AgentPublicActivity | null;
  showActivity: boolean;
  content: string;
  streaming: boolean;
  reducedMotion?: boolean;
};

export function AgentStream({ runId, activity, showActivity, content, streaming, reducedMotion }: AgentStreamProps) {
  const systemReducedMotion = useReducedMotion();
  const reduced = reducedMotion ?? Boolean(systemReducedMotion);
  // Real text always wins: a shimmer masking content that has already
  // arrived would be exactly the fake-progress feel this rebuild exists to
  // remove. Shimmer only fills the slot while there is nothing to show yet.
  const showShimmer = !content && showActivity && Boolean(activity?.message);
  if (!showShimmer && !content) return null;

  return (
    <div className="coden-agent-stream" aria-live="polite" aria-atomic="true">
      <AnimatePresence mode="wait" initial={false}>
        {content ? (
          <motion.div
            key={`response:${runId}`}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.15 }}
          >
            <AgentResponse content={content} streaming={streaming} />
          </motion.div>
        ) : showShimmer ? (
          <motion.div
            key={`shimmer:${runId}:${activity!.phase}:${activity!.message}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: reduced ? 0 : 0.2 }}
          >
            <ShimmeringText text={activity!.message} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
