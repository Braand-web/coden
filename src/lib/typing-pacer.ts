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
 * Pure and clock-injected: `now` is a parameter, so the whole thing is
 * testable without timers.
 */

import type { ChatEvent } from './agent-chat-protocol';

export const DEFAULT_CHARS_PER_SECOND = 64;

/** Events that end a run. Nothing may still be queued behind them. */
const TERMINAL = new Set(['run_finished', 'run_failed', 'run_cancelled']);

export type TypingPacer = {
  /** Queue an event. Returns true when the caller should start draining. */
  push: (event: ChatEvent) => void;
  /** Whatever is due at `now`, in order. */
  drain: (now: number) => ChatEvent[];
  /** Everything left, at once. */
  flush: () => ChatEvent[];
  /** Whether anything is still waiting. */
  readonly pending: boolean;
};

export function createTypingPacer(charsPerSecond = DEFAULT_CHARS_PER_SECOND): TypingPacer {
  const rate = charsPerSecond > 0 ? charsPerSecond : DEFAULT_CHARS_PER_SECOND;
  let queue: ChatEvent[] = [];
  let lastAt: number | null = null;
  let budget = 0;
  /*
   * A run that has ended stops being paced.
   *
   * Holding text back after `run_finished` would leave the message visibly
   * writing itself after the spinner stopped — and if the tab is backgrounded
   * the interval may not fire again at all, so the paced remainder would never
   * arrive. The end of a run releases everything.
   */
  let ended = false;

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
      released.push({ type: 'text_delta', delta: head.delta.slice(0, allowed) });
      queue[0] = { type: 'text_delta', delta: head.delta.slice(allowed) };
      budget -= allowed;
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
      if (ended) return everything();
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
       * A backgrounded tab does not get its timers, and comes back with a gap
       * of minutes. Without a ceiling the first tick after that dumps the
       * whole queue, which is the burst this exists to remove.
       */
      budget = Math.min(budget, rate);
      return take();
    },
    flush: everything,
    get pending() { return queue.length > 0; },
  };
}
