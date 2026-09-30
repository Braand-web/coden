import { describe, expect, it } from 'vitest';
import type { AllowedModelId } from '../config/ai-models';
import { buildHandoffBrief, ModelSupervisor, type ModelPick, type SupervisorPicks, type SupervisionSignal } from './model-supervisor';

const M = (id: string) => id as AllowedModelId;

/** A catalogue of four models in two families, strongest last, to drive the ladder. */
const CHAIN = ['weak-a', 'mid-a', 'strong-a', 'strong-b', 'design-c', 'cheap-a'].map(M);
const FAMILY: Record<string, string> = { 'weak-a': 'a', 'mid-a': 'a', 'strong-a': 'a', 'strong-b': 'b', 'design-c': 'c', 'cheap-a': 'a' };
const POWER: Record<string, number> = { 'weak-a': 1, 'mid-a': 2, 'strong-a': 3, 'strong-b': 3, 'design-c': 3, 'cheap-a': 1 };

function picks(calls: Array<{ kind: string; exclude: readonly string[] }> = []): SupervisorPicks {
  const first = (candidates: string[], exclude: readonly string[]): ModelPick => {
    const id = candidates.find(candidate => !exclude.includes(candidate));
    return id ? { modelId: M(id), reasoningLevel: 'high' } : null;
  };
  return {
    stronger(from, exclude) {
      calls.push({ kind: 'stronger', exclude });
      return first(['mid-a', 'strong-a'].filter(id => POWER[id] > POWER[from]), exclude);
    },
    otherFamily(from, exclude) {
      calls.push({ kind: 'family', exclude });
      return first(['strong-b', 'design-c', 'strong-a'].filter(id => FAMILY[id] !== FAMILY[from]), exclude);
    },
    specialist(need, exclude) {
      calls.push({ kind: `specialist:${need}`, exclude });
      return need === 'design' ? first(['design-c'], exclude) : need === 'long_context' ? first(['strong-b'], exclude) : null;
    },
    cheaper(from, exclude) {
      calls.push({ kind: 'cheaper', exclude });
      return first(['cheap-a', 'weak-a'].filter(id => POWER[id] < POWER[from]), exclude);
    },
    opinion(from, exclude) {
      calls.push({ kind: 'opinion', exclude });
      return first(['strong-b'].filter(id => FAMILY[id] !== FAMILY[from]), exclude)?.modelId ?? null;
    },
  };
}

const POLICY = { maxEscalations: 3, minRoundsBetweenSwitches: 1, cleanRoundsToDeescalate: 2 };
const supervisor = (overrides: Partial<ConstructorParameters<typeof ModelSupervisor>[0]> = {}, calls?: Array<{ kind: string; exclude: readonly string[] }>) =>
  new ModelSupervisor({ policy: POLICY, initial: { modelId: M('weak-a'), reasoningLevel: 'low' }, picks: picks(calls), ...overrides });
const stalled = (round: number): SupervisionSignal => ({ kind: 'no_progress', round, errorsBefore: 4, errorsAfter: 4 });

describe('the model supervisor', () => {
  it('climbs one rung at a time: correct, think harder, stronger model, other family', () => {
    const s = supervisor();
    const first = s.observe(stalled(2));
    expect(first).toMatchObject({ action: 'retry_with_correction', changed: false, modelId: 'weak-a' });
    expect(first.correction).toMatch(/did not|none of these errors/i);
    const second = s.observe(stalled(4));
    expect(second).toMatchObject({ action: 'raise_reasoning', changed: true, modelId: 'weak-a', reasoningLevel: 'medium' });
    const third = s.observe(stalled(6));
    expect(third).toMatchObject({ action: 'escalate_model', changed: true, modelId: 'mid-a', reasoningLevel: 'high' });
    const fourth = s.observe(stalled(8));
    // The stronger model of the same family is out (three escalations already): another family.
    expect(['switch_family', 'exhausted']).toContain(fourth.action);
    expect(s.escalationCount).toBeLessThanOrEqual(3);
  });

  it('gives every decision a reason in French and names the signal', () => {
    const s = supervisor();
    for (const round of [2, 4, 6]) {
      const decision = s.observe(stalled(round));
      expect(decision.reason.length).toBeGreaterThan(10);
      expect(decision.signal).toBe('no_progress');
    }
  });

  it('leaves a run alone for a round after a switch, so a new model gets a chance', () => {
    const s = supervisor();
    s.observe(stalled(2));
    const switched = s.observe(stalled(4));
    expect(switched.changed).toBe(true);
    // Round 5 is the very next one: still hold.
    expect(s.observe(stalled(5))).toMatchObject({ action: 'hold', changed: false });
  });

  it('never returns to a model it has left (no ping-pong)', () => {
    const calls: Array<{ kind: string; exclude: readonly string[] }> = [];
    const s = supervisor({ policy: { ...POLICY, maxEscalations: 5 } }, calls);
    const visited = new Set<string>(['weak-a']);
    let previous = 'weak-a';
    for (let round = 2; round <= 30; round += 2) {
      const decision = s.observe(stalled(round));
      if (decision.modelId !== previous) {
        expect(visited.has(decision.modelId)).toBe(false);
        visited.add(decision.modelId);
        previous = decision.modelId;
      }
    }
    // Every pick asked for was told which models to keep away from.
    const asked = calls.filter(call => call.kind === 'stronger' || call.kind === 'family');
    for (const call of asked) expect(call.exclude).toContain('weak-a');
  });

  it('stops climbing at the escalation cap and says so honestly, once', () => {
    const s = supervisor({ policy: { ...POLICY, maxEscalations: 1 } });
    s.observe(stalled(2)); // retry (free)
    const raised = s.observe(stalled(4)); // the one escalation allowed
    expect(raised.action).toBe('raise_reasoning');
    const capped = s.observe(stalled(6));
    expect(capped.action).toBe('exhausted');
    expect(capped.reason).toMatch(/meilleur résultat/);
    // Said once: later signals hold, they do not repeat the apology.
    expect(s.observe(stalled(8)).action).toBe('hold');
  });

  it('switches family at once when the provider fails, without retrying the same one', () => {
    const s = supervisor();
    const decision = s.observe({ kind: 'provider_failure', round: 1, cause: 'down' });
    expect(decision).toMatchObject({ action: 'switch_family', changed: true });
    expect(FAMILY[decision.modelId]).not.toBe('a');
    expect(decision.reason).toMatch(/indisponible/);
    // A provider failure is not made to wait for the minimum delay.
    const again = s.observe({ kind: 'provider_failure', round: 2, cause: 'timeout' });
    expect(again.changed).toBe(true);
    expect(again.modelId).not.toBe(decision.modelId);
  });

  it('moves to a long-context model when the context no longer fits', () => {
    const s = supervisor();
    const decision = s.observe({ kind: 'provider_failure', round: 1, cause: 'context_saturated' });
    expect(decision).toMatchObject({ action: 'specialist', modelId: 'strong-b' });
    expect(decision.reason).toMatch(/contexte/);
  });

  it('changes model on an empty answer or a refusal instead of asking again', () => {
    const s = supervisor();
    expect(s.observe({ kind: 'empty_or_refusal', round: 1 })).toMatchObject({ action: 'switch_family', changed: true });
  });

  it('sends a design problem to a design specialist once the ladder reaches it', () => {
    const s = supervisor({ policy: { ...POLICY, maxEscalations: 6 } });
    const decisions: string[] = [];
    let model = 'weak-a';
    for (let round = 2; round <= 24 && model !== 'design-c'; round += 2) {
      const decision = s.observe({ kind: 'low_review_score', round, score: 4, threshold: 7, focus: 'design' });
      decisions.push(decision.action);
      model = decision.modelId;
    }
    expect(decisions[0]).toBe('retry_with_correction');
    expect(decisions).toContain('specialist');
    expect(model).toBe('design-c');
  });

  it('asks for a second opinion, once, before giving up', () => {
    const s = supervisor({
      policy: { ...POLICY, maxEscalations: 9 },
      picks: { ...picks(), stronger: () => null, otherFamily: () => null, specialist: () => null },
    });
    const actions = [2, 4, 6, 8, 10].map(round => s.observe(stalled(round)));
    const asked = actions.filter(decision => decision.action === 'second_opinion');
    expect(asked).toHaveLength(1);
    expect(asked[0].opinionFrom).toBe('strong-b');
    expect(actions.some(decision => decision.action === 'exhausted')).toBe(true);
  });

  it('never changes a model the person chose, and suggests Auto only once', () => {
    const s = supervisor({ locked: true });
    const first = s.observe(stalled(2));
    expect(first).toMatchObject({ action: 'suggest_switch', changed: false, modelId: 'weak-a' });
    expect(first.reason).toMatch(/Auto/);
    for (let round = 3; round <= 12; round += 1) {
      const decision = s.observe(round % 2 ? stalled(round) : { kind: 'provider_failure', round, cause: 'down' });
      expect(decision.changed).toBe(false);
      expect(decision.modelId).toBe('weak-a');
      expect(decision.action).toBe('hold');
    }
  });

  it('steps back down only after several clean rounds, and only when little is left', () => {
    const s = supervisor();
    s.observe(stalled(2));
    s.observe(stalled(4));
    const up = s.observe(stalled(6));
    expect(up.action).toBe('escalate_model');
    // One failure was enough to climb; one clean round is not enough to descend.
    expect(s.observe({ kind: 'round_clean', round: 8, errorsAfter: 1 }).action).toBe('hold');
    // Two in a row, but a lot still to fix: stay.
    const busy = supervisor();
    busy.observe(stalled(2)); busy.observe(stalled(4)); busy.observe(stalled(6));
    busy.observe({ kind: 'round_clean', round: 8, errorsAfter: 9 });
    expect(busy.observe({ kind: 'round_clean', round: 9, errorsAfter: 9 }).action).toBe('hold');
    // Two clean rounds with few errors left: back to a cheaper model.
    const down = s.observe({ kind: 'round_clean', round: 9, errorsAfter: 0 });
    expect(down).toMatchObject({ action: 'deescalate', changed: true });
    expect(down.modelId).not.toBe(up.modelId);
    expect(down.reason).toMatch(/économique/);
  });

  it('does not step back down to a model it abandoned for failing', () => {
    const s = supervisor();
    s.observe(stalled(2)); s.observe(stalled(4));
    s.observe(stalled(6)); // weak-a is now left behind
    expect(s.leftBehind).toContain('weak-a');
    s.observe({ kind: 'round_clean', round: 8, errorsAfter: 0 });
    const down = s.observe({ kind: 'round_clean', round: 9, errorsAfter: 0 });
    expect(down.modelId).not.toBe('weak-a');
  });

  it('records what it did, for the trace and the handoff', () => {
    const s = supervisor();
    s.observe(stalled(2)); s.observe(stalled(4)); s.observe(stalled(6));
    expect(s.history.map(entry => entry.action)).toEqual(['raise_reasoning', 'escalate_model']);
    expect(s.history[1]).toMatchObject({ from: 'weak-a', to: 'mid-a', signal: 'no_progress' });
  });
});

describe('the handoff brief', () => {
  it('tells the next model why it is here, what failed, and what is already changed', () => {
    const brief = buildHandoffBrief({
      from: 'Luna',
      to: 'Sonnet 5',
      reason: 'the same error came back twice',
      failedAttempts: [
        { round: 2, model: 'Luna', errorsBefore: 4, errorsAfter: 4, note: 'edited src/App.tsx imports' },
        { round: 3, model: 'Luna', errorsBefore: 4, errorsAfter: 5 },
      ],
      filesTouched: ['src/App.tsx', 'src/lib/api.ts'],
    });
    expect(brief).toContain('taking over');
    expect(brief).toContain('the same error came back twice');
    expect(brief).toContain('round 2 (Luna): 4 → 4 errors. edited src/App.tsx imports');
    expect(brief).toContain('src/App.tsx, src/lib/api.ts');
    expect(brief).toContain('design contract');
  });

  it('stays short however long the run was', () => {
    const attempts = Array.from({ length: 40 }, (_, index) => ({ round: index + 1, model: 'm', errorsBefore: 3, errorsAfter: 3 }));
    const brief = buildHandoffBrief({ from: 'a', to: 'b', reason: 'r', failedAttempts: attempts, filesTouched: Array.from({ length: 80 }, (_, index) => `f${index}.ts`) });
    expect(brief.split('\n').length).toBeLessThan(14);
    expect(brief.length).toBeLessThan(1_500);
  });
});
