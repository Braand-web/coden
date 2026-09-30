/**
 * How the streaming is holding up, counted where it happens.
 *
 * A run's stream can be cut (a network change, a proxy, a closed tab) and the
 * page then follows the run again from where it stopped. Two numbers say
 * whether that works: how many streams were interrupted, and how many of the
 * follow-ups reached the end of the run. Counted in memory since the process
 * started and also logged, one structured line per event, so the log holds the
 * history across deploys.
 */
export type StreamEvent = 'started' | 'completed' | 'interrupted' | 'resume_started' | 'resume_completed' | 'resume_abandoned';

const counters: Record<StreamEvent, number> = { started: 0, completed: 0, interrupted: 0, resume_started: 0, resume_completed: 0, resume_abandoned: 0 };
const since = Date.now();

export function recordStream(event: StreamEvent, detail: Record<string, unknown> = {}) {
  counters[event] += 1;
  console.info('[coden:stream_metric]', { event, ...detail });
}

const rate = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 1000 : null);

export function streamMetrics() {
  return {
    sinceMs: Date.now() - since,
    ...counters,
    /** Streams cut before the run ended, among those that started. */
    interruptedRate: rate(counters.interrupted, counters.started),
    /** Follow-ups that reached the end of the run, among those that began. */
    resumeSuccessRate: rate(counters.resume_completed, counters.resume_started),
  };
}

/** For tests. */
export function resetStreamMetrics() {
  for (const key of Object.keys(counters) as StreamEvent[]) counters[key] = 0;
}
