/**
 * The state machine for a generation run.
 *
 * The stream protocol has always declared eight phases with three states —
 * understand → decide → plan → reason → build → verify → fix → recap, each
 * active / done / failed — and the server never emitted one. What the user saw
 * instead was four fixed labels for a run lasting minutes, so a five-minute
 * build and a five-minute stall looked identical.
 *
 * This tracker owns the transitions so the route does not have to. Three rules
 * it guarantees, because each was a real failure of the ad-hoc version:
 *
 *  - Exactly one phase is active. Starting a phase closes the one before it, so
 *    a step can never be left spinning because an early return skipped its
 *    completion.
 *  - A failed phase does not end the run. The run continues and later phases
 *    still report, which is the difference between "the verification failed"
 *    and "the product stopped talking to you".
 *  - A stage can be re-entered. A run really does verify, repair, then verify
 *    again, so reopening `verify` is the correction loop working, not a
 *    contradiction. What may not happen is two outcomes for the same visit:
 *    once a visit is closed, a second `done` or `fail` is ignored rather than
 *    allowed to overwrite what was reported.
 *  - Emitting can never throw into the run. Progress reporting must not be able
 *    to fail a generation that is otherwise fine.
 */

export type GenerationPhase =
  | 'understand'
  | 'decide'
  | 'plan'
  | 'reason'
  | 'build'
  | 'verify'
  | 'fix'
  | 'recap';

export type GenerationPhaseState = 'active' | 'done' | 'failed';

export const GENERATION_PHASE_ORDER: readonly GenerationPhase[] = [
  'understand', 'decide', 'plan', 'reason', 'build', 'verify', 'fix', 'recap',
];

export type GenerationPhaseEmit = (
  phase: GenerationPhase,
  state: GenerationPhaseState,
  label: string,
) => void;

/** What the user reads. Written as outcomes, never as internal mechanics. */
const LABELS: Record<GenerationPhase, { fr: string; en: string }> = {
  understand: { fr: 'Analyse de votre demande', en: 'Understanding your request' },
  decide: { fr: 'Choix de l’approche', en: 'Choosing the approach' },
  plan: { fr: 'Plan de l’application', en: 'Planning the application' },
  reason: { fr: 'Préparation de l’architecture', en: 'Preparing the architecture' },
  build: { fr: 'Création de l’application', en: 'Building the application' },
  verify: { fr: 'Vérification de l’application', en: 'Verifying the application' },
  fix: { fr: 'Correction des problèmes détectés', en: 'Fixing the detected issues' },
  recap: { fr: 'Application prête', en: 'Application ready' },
};

export function generationPhaseLabel(phase: GenerationPhase, language: 'fr' | 'en'): string {
  return LABELS[phase][language];
}

export class GenerationPhaseTracker {
  private readonly emit: GenerationPhaseEmit;
  private readonly language: 'fr' | 'en';
  private readonly states = new Map<GenerationPhase, GenerationPhaseState>();
  private activePhase: GenerationPhase | null = null;

  constructor(emit: GenerationPhaseEmit, language: 'fr' | 'en' = 'fr') {
    this.emit = emit;
    this.language = language;
  }

  /** The state of every phase that has been reached, in run order. */
  snapshot(): Array<{ phase: GenerationPhase; state: GenerationPhaseState }> {
    return GENERATION_PHASE_ORDER
      .filter(phase => this.states.has(phase))
      .map(phase => ({ phase, state: this.states.get(phase)! }));
  }

  /** True once the phase has reported an outcome, whichever it was. */
  isSettled(phase: GenerationPhase): boolean {
    const state = this.states.get(phase);
    return state === 'done' || state === 'failed';
  }

  /** True once the phase has been reached at all, in any state. */
  has(phase: GenerationPhase): boolean {
    return this.states.has(phase);
  }

  /**
   * Enter a phase, closing whichever one was running.
   *
   * A stage that already reported is reopened: the run genuinely loops through
   * verify and fix, and the step must show that it is running again.
   */
  start(phase: GenerationPhase, label?: string): void {
    if (this.activePhase === phase) return;
    if (this.activePhase) this.settle(this.activePhase, 'done');
    this.activePhase = phase;
    this.write(phase, 'active', label);
  }

  /** Close a phase successfully. Starting it first is not required. */
  done(phase: GenerationPhase, label?: string): void {
    this.settle(phase, 'done', label);
  }

  /**
   * Close a phase as failed, and keep going.
   *
   * A failed step is information, not the end of the run — the next phase still
   * reports, so the user sees the repair happen rather than a frozen stream.
   */
  fail(phase: GenerationPhase, label?: string): void {
    this.settle(phase, 'failed', label);
  }

  /**
   * Close the run. A phase still running when the route returns had no explicit
   * outcome, so it takes the run's: done on success, failed otherwise.
   */
  finish(outcome: 'done' | 'failed' = 'done'): void {
    if (this.activePhase) this.settle(this.activePhase, outcome);
  }

  /**
   * Close the current visit to a phase.
   *
   * Allowed while the phase is running, or for a phase never reached — a step
   * whose outcome is known without it having been entered still belongs in the
   * list. Refused once its visit is closed, so a late report cannot overwrite
   * the outcome that was already shown.
   */
  private settle(phase: GenerationPhase, state: 'done' | 'failed', label?: string): void {
    const isRunning = this.activePhase === phase;
    if (!isRunning && this.states.has(phase)) return;
    if (isRunning) this.activePhase = null;
    this.write(phase, state, label);
  }

  private write(phase: GenerationPhase, state: GenerationPhaseState, label?: string): void {
    this.states.set(phase, state);
    try {
      this.emit(phase, state, label || generationPhaseLabel(phase, this.language));
    } catch {
      // Progress reporting must never be able to fail a run that is otherwise fine.
    }
  }
}
