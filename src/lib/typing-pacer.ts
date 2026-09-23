/**
 * Turning bursts of tokens back into typing.
 *
 * A provider does not stream one character at a time: deltas arrive in clumps,
 * a paragraph landing in three or four events. Applied as they come, the reply
 * appears in blocks — which is not what reading someone write looks like, and
 * makes the run feel like it stalled between clumps.
 *
 * So the deltas are queued and released at a steady rate. The hard part is not
 * the rate, it is the order: a tool line or an activity label that arrives
 * while text is still draining must not overtake it, or the message assembles
 * itself in the wrong sequence — the file line landing above the sentence that
 * introduces it. Everything therefore goes through one queue, and a non-text
 * event is only released once the text queued ahead of it has been.
 *
 * The rate follows the backlog. A fixed rate either crawls behind a fast model
 * — the reply falls further and further back and the rest has to be dumped at
 * the end — or races ahead of a slow one and stutters between clumps. Here the
 * floor is a comfortable reading speed and the queue is never allowed to hold
 * more than about a second of text.
 *
 * The end of a run is not a dump either. A run's closing summary often arrives
 * as a single block immediately followed by `run_finished`; releasing the
 * queue on that event drew the whole summary in one frame, the burst this
 * exists to remove. The terminal event waits behind the text like any other,
 * and the text behind it catches up quickly instead.
 *
 * Pure and clock-injected: `now` is a parameter, so the whole thing is
 * testable without timers.
 */

import type { ChatEvent } from './agent-chat-protocol';

/** The floor: a comfortable reading pace when the model is slow. */
export const DEFAULT_CHARS_PER_SECOND = 90;
/** At most this much text is held back while the run is live. */
const LIVE_BACKLOG_SECONDS = 1;
/** Once the run has ended, whatever is left is out within this. */
const ENDED_BACKLOG_SECONDS = 0.6;

/** Events that end a run. */
const TERMINAL = new Set(['run_finished', 'run_failed', 'run_cancelled']);

export type TypingPacer = {
  /** Queue an event. */
  push: (event: ChatEvent) => void;
  /** Whatever is due at `now`, in order. */
  drain: (now: number) => ChatEvent[];
  /** Everything left, at once. */
  flush: () => ChatEvent[];
  /** Whether anything is still waiting. */
  readonly pending: boolean;
};

export function createTypingPacer(charsPerSecond = DEFAULT_CHARS_PER_SECOND): TypingPacer {
  const floor = charsPerSecond > 0 ? charsPerSecond : DEFAULT_CHARS_PER_SECOND;
  let queue: ChatEvent[] = [];
  let lastAt: number | null = null;
  let budget = 0;
  let ended = false;

  const backlog = () => queue.reduce((total, event) => total + (event.type === 'text_delta' ? event.delta.length : 0), 0);

  /*
   * Split on a word boundary when one is close.
   *
   * Cutting at an exact character count can stop mid-word for a frame, and a
   * half word flickering at the end of the line is precisely the jitter the
   * pacing is meant to hide. Up to eight characters of slack either way keeps
   * the rate honest while landing on whole words.
   */
  const cutAt = (text: string, allowed: number) => {
    if (allowed >= text.length) return text.length;
    const ahead = text.slice(allowed, allowed + 8).search(/\s/);
    if (ahead >= 0) return allowed + ahead + 1;
    const behind = text.slice(Math.max(0, allowed - 8), allowed).search(/\s\S*$/);
    if (behind >= 0) return Math.max(1, allowed - 8 + behind + 1);
    return allowed;
  };

  const take = (): ChatEvent[] => {
    const released: ChatEvent[] = [];
    while (queue.length) {
      const head = queue[0];
      if (head.type !== 'text_delta') {
        released.push(head);
        queue.shift();
        continue;
      }
      if (budget < 1) break;
      const allowed = Math.floor(budget);
      if (head.delta.length <= allowed) {
        budget -= head.delta.length;
        released.push(head);
        queue.shift();
        continue;
      }
      // A delta longer than the budget is split; the rest stays at the head.
      const cut = cutAt(head.delta, allowed);
      released.push({ type: 'text_delta', delta: head.delta.slice(0, cut) });
      queue[0] = { type: 'text_delta', delta: head.delta.slice(cut) };
      budget -= cut;
      break;
    }
    return released;
  };

  const everything = (): ChatEvent[] => {
    const released = queue;
    queue = [];
    budget = 0;
    return released;
  };

  return {
    push(event) {
      if (event.type === 'run_started') {
        queue = [];
        budget = 0;
        lastAt = null;
        ended = false;
      }
      if (TERMINAL.has(event.type)) ended = true;
      queue.push(event);
    },
    drain(now) {
      const waiting = backlog();
      const rate = Math.max(floor, waiting / (ended ? ENDED_BACKLOG_SECONDS : LIVE_BACKLOG_SECONDS));
      if (lastAt === null) {
        lastAt = now;
        /*
         * The first tick pays no wait.
         *
         * Starting with an empty budget would hold the opening characters
         * until the following tick, so every reply began with a stutter.
         */
        budget += rate / 20;
      } else {
        const elapsed = Math.max(0, now - lastAt);
        lastAt = now;
        budget += (elapsed * rate) / 1000;
      }
      /*
       * A backgrounded tab does not get its frames, and comes back with a gap
       * of minutes. Without a ceiling the first tick after that dumps the
       * whole queue. The caller flushes outright while the page is hidden, so
       * this only has to cover a long frame.
       */
      budget = Math.min(budget, rate / 2);
      return take();
    },
    flush: everything,
    get pending() { return queue.length > 0; },
  };
}
