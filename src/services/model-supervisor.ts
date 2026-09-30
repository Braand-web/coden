/**
 * Watching a run, and changing the model when the run needs it.
 *
 * Auto used to choose a model once and change it in exactly one situation: a
 * repair round that removed no errors, at most twice, first by adding
 * reasoning and then by taking a stronger model. It could not react to a
 * provider going down, a model refusing or answering nothing, the same error
 * coming back, or a reviewer scoring the result low — and it could never come
 * back down once the hard part was over.
 *
 * The supervisor is that decision, pulled out of the pipeline so it can be
 * tested on its own. It is a pure state machine: signals in, at most one
 * decision out, no I/O. The pipeline feeds it what it observes and applies
 * what it answers. Models are found through the `pick` callbacks the caller
 * supplies (which go through `selectModel`, so plan, credits, capability and
 * the live catalogue are all still respected).
 *
 * The ladder, in order — each rung only when the cheaper one has been tried:
 *   1. retry once with the failure spelled out (no model change)
 *   2. think harder on the same model
 *   3. a stronger model
 *   4. a model from another family or provider
 *   5. a specialist for what is going wrong
 *   6. a second opinion from another model, fed into the next round
 *   ... and when nothing is left, say so honestly rather than loop.
 *
 * Guardrails, because a supervisor that switches freely is worse than none:
 *   - a model that has been left is never returned to (no ping-pong);
 *   - a minimum number of rounds between two switches (except when the
 *     provider itself is failing);
 *   - a cap on escalations per run, from the routing policy;
 *   - stepping back down needs several clean rounds in a row — a higher bar
 *     than stepping up needs failures;
 *   - a model the user pinned is never changed, only suggested against once;
 *   - every decision carries a reason in the user's language, for the trace
 *     and for the line the chat shows.
 */
import type { AllowedModelId } from '../config/ai-models.ts';
import { REASONING_LEVELS, type ReasoningLevel } from './openrouter-request.ts';
import type { RoutingPolicy } from './routing-policy.ts';

export type SupervisionSignal =
  /** A repair round that removed no error. */
  | { kind: 'no_progress'; round: number; errorsBefore: number; errorsAfter: number }
  /** The same error, verbatim, after a fix attempt. */
  | { kind: 'same_error_twice'; round: number; signature: string }
  /** The model answered, but not in a usable shape (broken JSON, no tool call). */
  | { kind: 'invalid_output'; round: number; detail?: string }
  /** Nothing came back, or the model declined the work. */
  | { kind: 'empty_or_refusal'; round: number; detail?: string }
  /** The provider, not the model: timeout, outage, rate limit, or a context that no longer fits. */
  | { kind: 'provider_failure'; round: number; cause: 'timeout' | 'down' | 'rate_limited' | 'context_saturated' }
  /** A reviewer graded the result under its threshold. */
  | { kind: 'low_review_score'; round: number; score: number; threshold: number; focus?: 'design' | 'functionality' | 'security' | 'performance' }
  /** The person says it still does not work, again. */
  | { kind: 'user_dissatisfied'; round: number }
  /** A round that reduced the errors or finished clean. */
  | { kind: 'round_clean'; round: number; errorsAfter: number };

export type SupervisorAction =
  | 'retry_with_correction'
  | 'raise_reasoning'
  | 'escalate_model'
  | 'switch_family'
  | 'specialist'
  | 'second_opinion'
  | 'deescalate'
  | 'suggest_switch'
  | 'exhausted'
  | 'hold';

export type SupervisorDecision = {
  action: SupervisorAction;
  /** The model to run the next round on (equal to the current one when it does not change). */
  modelId: AllowedModelId;
  reasoningLevel: ReasoningLevel;
  /** Whether the model or the level changed: what the chat announces. */
  changed: boolean;
  /** Why, in French, for the person. */
  reason: string;
  /** Why, in short machine terms, for the trace. */
  signal: SupervisionSignal['kind'];
  /** For `retry_with_correction`: what to add to the next instruction. */
  correction?: string;
  /** For `second_opinion`: the model to ask. */
  opinionFrom?: AllowedModelId;
};

export type ModelPick = { modelId: AllowedModelId; reasoningLevel?: ReasoningLevel } | null;

export type SupervisorPicks = {
  /** A stronger model than `from`, never one in `exclude`. */
  stronger(from: AllowedModelId, exclude: readonly AllowedModelId[]): ModelPick;
  /** A model of another provider than `from`, at least as strong on the deciding dimension. */
  otherFamily(from: AllowedModelId, exclude: readonly AllowedModelId[]): ModelPick;
  /** A model suited to what is going wrong (design, security, long context…), or null. */
  specialist(need: 'design' | 'functionality' | 'security' | 'performance' | 'long_context', exclude: readonly AllowedModelId[]): ModelPick;
  /** A cheaper model than `from` that still clears the bar, never one in `exclude`. */
  cheaper(from: AllowedModelId, exclude: readonly AllowedModelId[]): ModelPick;
  /** Whether asking another model for a second opinion is available. Optional. */
  opinion?(from: AllowedModelId, exclude: readonly AllowedModelId[]): AllowedModelId | null;
};

const LEVELS: readonly ReasoningLevel[] = REASONING_LEVELS;
const rank = (level: ReasoningLevel) => Math.max(0, LEVELS.indexOf(level));

export type SupervisorOptions = {
  policy: Pick<RoutingPolicy, 'maxEscalations' | 'minRoundsBetweenSwitches' | 'cleanRoundsToDeescalate'>;
  initial: { modelId: AllowedModelId; reasoningLevel: ReasoningLevel };
  /** The person chose this model: it is never changed, only suggested against once. */
  locked?: boolean;
  picks: SupervisorPicks;
  /** Whether a level above this one is affordable on this model with the credits left. */
  affordable?: (level: ReasoningLevel, modelId: AllowedModelId) => boolean;
};

export class ModelSupervisor {
  private modelId: AllowedModelId;
  private reasoningLevel: ReasoningLevel;
  private readonly initialModel: AllowedModelId;
  private readonly abandoned = new Set<AllowedModelId>();
  private escalations = 0;
  private rung = 0;
  private lastSwitchRound = -Infinity;
  private cleanStreak = 0;
  private suggested = false;
  private exhaustedSaid = false;
  private opinionAsked = false;
  /** The trail of what was done and why, for the handoff to the next model and the trace. */
  readonly history: Array<{ round: number; action: SupervisorAction; from: AllowedModelId; to: AllowedModelId; signal: SupervisionSignal['kind'] }> = [];

  private readonly options: SupervisorOptions;

  constructor(options: SupervisorOptions) {
    this.options = options;
    this.modelId = options.initial.modelId;
    this.reasoningLevel = options.initial.reasoningLevel;
    this.initialModel = options.initial.modelId;
  }

  get current() { return { modelId: this.modelId, reasoningLevel: this.reasoningLevel }; }
  get escalationCount() { return this.escalations; }
  /** Models this run has left behind; a handoff tells the next one not to redo what they did. */
  get leftBehind(): AllowedModelId[] { return [...this.abandoned]; }

  /**
   * Records a move the gateway already made (a provider failed and the chain
   * carried on with another model). It is not an escalation — nothing about
   * the work got harder — but the run has left the first model, and must not
   * be sent back to it by a later step down.
   */
  adopt(modelId: AllowedModelId, round: number): void {
    if (modelId === this.modelId) return;
    const from = this.modelId;
    this.abandoned.add(from);
    this.modelId = modelId;
    this.lastSwitchRound = round;
    this.history.push({ round, action: 'switch_family', from, to: modelId, signal: 'provider_failure' });
  }

  observe(signal: SupervisionSignal): SupervisorDecision {
    if (signal.kind === 'round_clean') return this.onClean(signal);
    this.cleanStreak = 0;

    if (this.options.locked) return this.onLocked(signal);

    const urgent = signal.kind === 'provider_failure' || signal.kind === 'empty_or_refusal';
    if (!urgent && signal.round - this.lastSwitchRound <= this.options.policy.minRoundsBetweenSwitches) {
      return this.hold(signal, 'Le changement précédent vient d’avoir lieu : je laisse une manche au nouveau modèle.');
    }
    if (this.escalations >= this.options.policy.maxEscalations) return this.exhausted(signal);

    // A failing provider or a model that says nothing is not fixed by asking the same one again.
    if (signal.kind === 'provider_failure') return this.onProvider(signal);
    if (signal.kind === 'empty_or_refusal') return this.switchFamily(signal, 'Le modèle n’a rien produit d’utilisable : je passe à un autre.');

    return this.climb(signal);
  }

  /* ------------------------------------------------------------------ */

  private climb(signal: SupervisionSignal): SupervisorDecision {
    // Rung 1: say precisely what failed, once, on the same model.
    if (this.rung === 0) {
      this.rung = 1;
      return this.decision('retry_with_correction', signal, false, this.describe(signal), { correction: this.correctionFor(signal) });
    }
    // Rung 2: the same model, thinking harder.
    if (this.rung <= 1) {
      this.rung = 2;
      const next = LEVELS.find(level => rank(level) > rank(this.reasoningLevel) && rank(level) <= rank('high'));
      if (next && (this.options.affordable?.(next, this.modelId) ?? true)) {
        this.reasoningLevel = next;
        this.escalations += 1;
        this.markSwitch(signal, 'raise_reasoning', this.modelId);
        return this.decision('raise_reasoning', signal, true, 'La correction n’aboutit pas : le modèle réfléchit davantage.');
      }
    }
    // Rung 3: a stronger model.
    if (this.rung <= 2) {
      this.rung = 3;
      const stronger = this.options.picks.stronger(this.modelId, this.excluded());
      if (stronger) return this.moveTo('escalate_model', signal, stronger, 'Le modèle bloque sur cette étape : je passe à un modèle plus puissant.');
    }
    // Rung 4: another family.
    if (this.rung <= 3) {
      this.rung = 4;
      const decided = this.trySwitchFamily(signal, 'Un modèle plus puissant n’est pas disponible : j’essaie un modèle d’une autre famille.');
      if (decided) return decided;
    }
    // Rung 5: a specialist for what is going wrong.
    if (this.rung <= 4) {
      this.rung = 5;
      const need = signal.kind === 'low_review_score' ? signal.focus || 'functionality' : 'functionality';
      const specialist = this.options.picks.specialist(need, this.excluded());
      if (specialist) return this.moveTo('specialist', signal, specialist, `Je confie cette étape à un modèle plus adapté (${need === 'design' ? 'design' : need === 'security' ? 'sécurité' : need === 'performance' ? 'performance' : 'fonctionnel'}).`);
    }
    // Rung 6: a second opinion, once, fed into the next round.
    if (this.rung <= 5 && !this.opinionAsked) {
      this.rung = 6;
      const from = this.options.picks.opinion?.(this.modelId, this.excluded()) ?? null;
      if (from) {
        this.opinionAsked = true;
        return this.decision('second_opinion', signal, false, 'Je demande un second avis à un autre modèle avant la prochaine tentative.', { opinionFrom: from });
      }
    }
    return this.exhausted(signal);
  }

  private onProvider(signal: Extract<SupervisionSignal, { kind: 'provider_failure' }>): SupervisorDecision {
    if (signal.cause === 'context_saturated') {
      const long = this.options.picks.specialist('long_context', this.excluded());
      if (long) return this.moveTo('specialist', signal, long, 'Le contexte est trop grand pour ce modèle : je passe à un modèle à contexte long.');
    }
    const why = signal.cause === 'timeout' ? 'Le modèle ne répond pas à temps' : signal.cause === 'rate_limited' ? 'Le fournisseur limite les appels' : signal.cause === 'down' ? 'Le fournisseur est indisponible' : 'Le contexte est saturé';
    return this.switchFamily(signal, `${why} : je passe à un modèle d’un autre fournisseur.`);
  }

  private switchFamily(signal: SupervisionSignal, reason: string): SupervisorDecision {
    return this.trySwitchFamily(signal, reason) ?? this.exhausted(signal);
  }

  private trySwitchFamily(signal: SupervisionSignal, reason: string): SupervisorDecision | null {
    const other = this.options.picks.otherFamily(this.modelId, this.excluded());
    return other ? this.moveTo('switch_family', signal, other, reason) : null;
  }

  private onClean(signal: Extract<SupervisionSignal, { kind: 'round_clean' }>): SupervisorDecision {
    this.cleanStreak += 1;
    this.rung = 0;
    const policy = this.options.policy;
    const stepDown = !this.options.locked
      && this.modelId !== this.initialModel
      && this.cleanStreak >= policy.cleanRoundsToDeescalate
      && signal.round - this.lastSwitchRound > policy.minRoundsBetweenSwitches
      // Only when little is left to do: the hard part is over.
      && signal.errorsAfter <= 2;
    if (!stepDown) return this.hold(signal, '');
    const cheaper = this.options.picks.cheaper(this.modelId, this.excluded());
    if (!cheaper) return this.hold(signal, '');
    this.cleanStreak = 0;
    return this.moveTo('deescalate', signal, cheaper, 'Le plus dur est fait : je reviens à un modèle plus économique pour la suite.', false);
  }

  private onLocked(signal: SupervisionSignal): SupervisorDecision {
    if (this.suggested) return this.hold(signal, '');
    this.suggested = true;
    return this.decision('suggest_switch', signal, false, 'Ce modèle bloque sur cette étape. Vous l’avez choisi, je le garde : passez en Auto pour laisser Coden en essayer un autre.');
  }

  private exhausted(signal: SupervisionSignal): SupervisorDecision {
    if (this.exhaustedSaid) return this.hold(signal, '');
    this.exhaustedSaid = true;
    return this.decision('exhausted', signal, false, 'J’ai essayé les modèles à ma disposition sur cette étape sans la faire aboutir : je continue avec le meilleur résultat obtenu et je vous dis précisément ce qui reste à corriger.');
  }

  /* ------------------------------------------------------------------ */

  private moveTo(action: SupervisorAction, signal: SupervisionSignal, pick: NonNullable<ModelPick>, reason: string, counts = true): SupervisorDecision {
    const from = this.modelId;
    // Never go back to a model this run has already left.
    if (action !== 'deescalate') this.abandoned.add(from);
    else this.abandoned.add(from);
    this.modelId = pick.modelId;
    if (pick.reasoningLevel) this.reasoningLevel = pick.reasoningLevel;
    if (counts) this.escalations += 1;
    this.rung = Math.max(this.rung, action === 'escalate_model' ? 3 : action === 'switch_family' ? 4 : action === 'specialist' ? 5 : this.rung);
    this.markSwitch(signal, action, from);
    return this.decision(action, signal, true, reason);
  }

  private markSwitch(signal: SupervisionSignal, action: SupervisorAction, from: AllowedModelId) {
    this.lastSwitchRound = signal.round;
    this.history.push({ round: signal.round, action, from, to: this.modelId, signal: signal.kind });
  }

  private excluded(): AllowedModelId[] {
    return [...new Set([this.modelId, ...this.abandoned])];
  }

  private hold(signal: SupervisionSignal, reason: string): SupervisorDecision {
    return this.decision('hold', signal, false, reason);
  }

  private decision(action: SupervisorAction, signal: SupervisionSignal, changed: boolean, reason: string, extra: Partial<SupervisorDecision> = {}): SupervisorDecision {
    return { action, modelId: this.modelId, reasoningLevel: this.reasoningLevel, changed, reason, signal: signal.kind, ...extra };
  }

  private describe(signal: SupervisionSignal): string {
    switch (signal.kind) {
      case 'no_progress': return `La dernière correction n’a supprimé aucune des ${signal.errorsBefore} erreurs : je relance en précisant ce qui a échoué.`;
      case 'same_error_twice': return 'La même erreur revient : je relance en la citant et en interdisant de refaire la même modification.';
      case 'invalid_output': return 'La réponse n’était pas exploitable : je relance en précisant le format attendu.';
      case 'low_review_score': return `Le contrôle qualité donne ${signal.score}/${signal.threshold} : je relance avec ses remarques.`;
      case 'user_dissatisfied': return 'Vous signalez que ça ne fonctionne toujours pas : je repars de ce qui a été observé plutôt que de refaire la même chose.';
      default: return 'Je relance en précisant ce qui a échoué.';
    }
  }

  private correctionFor(signal: SupervisionSignal): string {
    switch (signal.kind) {
      case 'no_progress': return 'Your previous attempt removed none of these errors. Do not repeat the same edit: read the failing file and what it imports, name the actual cause, then change the cause rather than the symptom.';
      case 'same_error_twice': return `The same error came back after your fix (${signal.signature.slice(0, 160)}). Whatever you changed did not address its cause. Try a different approach.`;
      case 'invalid_output': return 'Your last answer was not usable. Use the tools to make changes and end with a short plain-text report.';
      case 'low_review_score': return `The quality review scored the result ${signal.score} out of ${signal.threshold}. Address its remarks point by point before anything else.`;
      case 'user_dissatisfied': return 'The user says this still does not work. Do not assume the previous fix was right: reproduce the problem from the running preview first.';
      default: return 'The previous attempt did not work. Take a different approach.';
    }
  }
}

/**
 * What the next model is told when a run changes hands.
 *
 * The transcript of the last rounds travels with the run, and the design
 * contract, the attachments and the mission are in the system message and the
 * instruction of every round already. What a new model lacks is *why* it is
 * here: what was tried, what did not work, and which files are already
 * touched. That is this block — compact, and independent of any one model's
 * message format, so it reads the same to every family.
 */
export function buildHandoffBrief(input: {
  from: string;
  to: string;
  reason: string;
  failedAttempts: Array<{ round: number; model: string; errorsBefore: number; errorsAfter: number; note?: string }>;
  filesTouched: string[];
}): string {
  const attempts = input.failedAttempts.slice(-5).map(attempt =>
    `- round ${attempt.round} (${attempt.model}): ${attempt.errorsBefore} → ${attempt.errorsAfter} errors${attempt.note ? `. ${attempt.note}` : ''}`);
  return [
    `## Handoff — you are taking over this run`,
    `The previous model (${input.from}) was replaced because: ${input.reason}`,
    attempts.length ? `What was already tried and did not fix it (do not repeat it):\n${attempts.join('\n')}` : '',
    input.filesTouched.length ? `Files already changed in this run: ${input.filesTouched.slice(0, 20).join(', ')}${input.filesTouched.length > 20 ? ', …' : ''}. The files on disk are the source of truth.` : '',
    'The design contract, the user\'s attachments and the mission below are unchanged and still binding.',
  ].filter(Boolean).join('\n');
}
