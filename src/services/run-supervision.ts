/**
 * The supervisor, wired to one run.
 *
 * `model-supervisor.ts` decides; this applies. It receives what the run
 * observes — a repair round that finished, a provider that failed and made the
 * gateway move to another model, the instruction a round was given — asks the
 * supervisor what to do, and carries the answer out: updates the model and
 * effort the next round runs on, tells the person in one line, writes the
 * trace, prepares the handoff the next model reads, and, when asked, gets a
 * second opinion from another model. Kept apart from the pipeline so that this
 * behaviour — including that a handoff or a correction is delivered exactly
 * once — is tested without a sandbox.
 */
import type { AllowedModelId } from '../config/ai-models.ts';
import type { ReasoningLevel } from './openrouter-request.ts';
import { buildHandoffBrief, type ModelSupervisor, type SupervisionSignal, type SupervisorDecision } from './model-supervisor.ts';
import type { RoutingTraceEvent } from './routing-trace.ts';

export type FailedAttempt = { round: number; model: string; errorsBefore: number; errorsAfter: number; note?: string };

export type RunSupervisionInput = {
  /** Null when the previous behaviour is in force (CODEN_ROUTER_V2=0). */
  supervisor: ModelSupervisor | null;
  /** The model and effort the next round runs on; the coder loop reads it at the start of each round. */
  current: { modelId: AllowedModelId; reasoningLevel: ReasoningLevel };
  modelLabel: (modelId: string) => string;
  /** The chat's one quiet line about a change of model or effort. */
  announce: (reason: 'supervision' | 'fallback' | 'suggestion', extra: { from?: string; detail?: string }) => void;
  /** The status line ("Coden is adjusting its approach…"). */
  activity: (french: string, english: string) => void;
  trace: (event: Omit<RoutingTraceEvent, 'projectId' | 'userId' | 'task' | 'complexity' | 'mode' | 'policy' | 'arm'>) => void;
  /** Asks another model for advice on a fix that keeps failing. Returns the advice, or '' when none could be had. */
  secondOpinion?: (from: AllowedModelId, context: { errors: string; failedAttempts: FailedAttempt[] }) => Promise<string>;
  /** The previous escalation, used when there is no supervisor. */
  legacyEscalate: () => void;
};

export type RepairRoundEvent = { round: number; errorsBefore: number; errorsAfter: number; filesTouched?: string[] };

/** The lines of an instruction that name an error, to tell whether the same one came back. */
export function errorSignatureOf(instruction: string): string {
  return instruction.split('\n')
    .filter(line => /error|TS\d{3,5}|cannot |not found|failed|unexpected/i.test(line))
    .slice(0, 4).map(line => line.trim().slice(0, 120)).join('|');
}

export function createRunSupervision(input: RunSupervisionInput) {
  const { supervisor, current } = input;
  let currentRound = 1;
  let lastInstruction = '';
  let previousSignature = '';
  let pendingHandoff = '';
  const pendingNotes: string[] = [];
  let pendingOpinion: Promise<string> | null = null;
  const failedAttempts: FailedAttempt[] = [];
  const touchedInRun = new Set<string>();

  const apply = (decision: SupervisorDecision, before: { modelId: AllowedModelId; reasoningLevel: ReasoningLevel }) => {
    if (decision.action === 'hold' && !decision.reason) return;
    if (decision.changed) {
      current.modelId = decision.modelId;
      current.reasoningLevel = decision.reasoningLevel;
      if (before.modelId !== current.modelId) {
        pendingHandoff = buildHandoffBrief({
          from: input.modelLabel(before.modelId),
          to: input.modelLabel(current.modelId),
          reason: decision.reason,
          failedAttempts,
          filesTouched: [...touchedInRun],
        });
      }
      input.announce('supervision', { from: before.modelId, detail: decision.reason });
    } else if (decision.action === 'suggest_switch') {
      input.announce('suggestion', { detail: decision.reason });
    } else if (decision.reason) {
      input.activity(decision.reason, 'Coden is adjusting its approach…');
    }
    if (decision.correction) pendingNotes.push(`## Note from the supervisor\n${decision.correction}`);
    if (decision.action === 'second_opinion' && decision.opinionFrom && input.secondOpinion) {
      pendingOpinion = input.secondOpinion(decision.opinionFrom, { errors: lastInstruction.slice(-5_000), failedAttempts: [...failedAttempts] }).catch(() => '');
    }
    input.trace({
      kind: 'supervision',
      fromModel: before.modelId,
      toModel: current.modelId,
      reasoningLevel: current.reasoningLevel,
      signal: decision.signal,
      action: decision.action,
      reason: decision.reason,
    });
  };

  const supervise = (signal: SupervisionSignal) => {
    if (!supervisor) return;
    const before = { modelId: current.modelId, reasoningLevel: current.reasoningLevel };
    apply(supervisor.observe(signal), before);
  };

  return {
    failedAttempts,
    get round() { return currentRound; },
    supervise,

    /** The instruction a round was given, kept to read the errors it carried. */
    onInstruction(instruction: string) { lastInstruction = instruction; },

    /** A round started or finished in the repair loop. */
    onRepairEvent(event: { type: string } & Partial<RepairRoundEvent>) {
      if (event.type === 'repair_round_started' && typeof event.round === 'number') {
        currentRound = event.round;
        return;
      }
      if (event.type !== 'repair_round_finished' || typeof event.round !== 'number') return;
      const { round, errorsBefore = 0, errorsAfter = 0 } = event as RepairRoundEvent;
      for (const path of event.filesTouched || []) touchedInRun.add(path);
      // A repair round that removed nothing.
      const stalled = round > 1 && errorsBefore > 0 && errorsAfter >= errorsBefore;
      if (!supervisor) {
        if (stalled) input.legacyEscalate();
        return;
      }
      if (stalled) {
        failedAttempts.push({
          round,
          model: input.modelLabel(current.modelId),
          errorsBefore,
          errorsAfter,
          note: event.filesTouched?.length ? `changed ${event.filesTouched.slice(0, 4).join(', ')}` : 'changed no file',
        });
        const signature = errorSignatureOf(lastInstruction);
        const repeated = Boolean(signature) && signature === previousSignature;
        previousSignature = signature;
        supervise(repeated ? { kind: 'same_error_twice', round, signature } : { kind: 'no_progress', round, errorsBefore, errorsAfter });
      } else if (errorsAfter < errorsBefore || errorsAfter === 0) {
        previousSignature = '';
        supervise({ kind: 'round_clean', round, errorsAfter });
      }
    },

    /** The gateway moved to another model after a failure: the run follows, says so, and does not go back. */
    onFallback(event: { from: string; to: string; reason: string }) {
      if (!supervisor) return;
      const to = event.to as AllowedModelId;
      supervisor.adopt(to, currentRound);
      current.modelId = to;
      input.announce('fallback', { from: event.from, detail: `${input.modelLabel(event.from)} n’a pas pu répondre (${event.reason}) : ${input.modelLabel(to)} prend le relais.` });
      input.trace({ kind: 'fallback', fromModel: event.from, toModel: to, signal: 'provider_failure', action: 'switch_family', reason: event.reason });
    },

    /** What the next round must be told beyond the mission. Read once: delivering it clears it. */
    async takeRoundNote(): Promise<string> {
      const parts: string[] = [];
      if (pendingHandoff) { parts.push(pendingHandoff); pendingHandoff = ''; }
      if (pendingNotes.length) parts.push(pendingNotes.splice(0).join('\n\n'));
      if (pendingOpinion) {
        const opinion = await pendingOpinion;
        pendingOpinion = null;
        if (opinion) parts.push(opinion);
      }
      return parts.join('\n\n');
    },
  };
}
