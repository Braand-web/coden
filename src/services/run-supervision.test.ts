import { describe, expect, it, vi } from 'vitest';
import type { AllowedModelId } from '../config/ai-models';
import { ModelSupervisor, type ModelPick, type SupervisorPicks } from './model-supervisor';
import { createRunSupervision, errorSignatureOf } from './run-supervision';
import type { ReasoningLevel } from './openrouter-request';

const M = (id: string) => id as AllowedModelId;
const FAMILY: Record<string, string> = { weak: 'a', strong: 'a', other: 'b', cheap: 'a' };
const POWER: Record<string, number> = { weak: 1, strong: 3, other: 3, cheap: 1 };

const picks = (overrides: Partial<SupervisorPicks> = {}): SupervisorPicks => {
  const first = (candidates: string[], exclude: readonly string[]): ModelPick => {
    const id = candidates.find(candidate => !exclude.includes(candidate));
    return id ? { modelId: M(id), reasoningLevel: 'high' } : null;
  };
  return {
    stronger: (from, exclude) => first(['strong'].filter(id => POWER[id] > POWER[from]), exclude),
    otherFamily: (from, exclude) => first(['other'].filter(id => FAMILY[id] !== FAMILY[from]), exclude),
    specialist: () => null,
    cheaper: (from, exclude) => first(['cheap'].filter(id => POWER[id] < POWER[from]), exclude),
    opinion: (from, exclude) => first(['other'].filter(id => FAMILY[id] !== FAMILY[from]), exclude)?.modelId ?? null,
    ...overrides,
  };
};

function setup(options: { locked?: boolean; noSupervisor?: boolean; picks?: SupervisorPicks; secondOpinion?: (from: AllowedModelId) => Promise<string> } = {}) {
  const current = { modelId: M('weak'), reasoningLevel: 'low' as ReasoningLevel };
  const announced: Array<{ reason: string; from?: string; detail?: string }> = [];
  const activities: string[] = [];
  const traces: any[] = [];
  const legacyEscalate = vi.fn();
  const supervisor = options.noSupervisor ? null : new ModelSupervisor({
    policy: { maxEscalations: 3, minRoundsBetweenSwitches: 1, cleanRoundsToDeescalate: 2 },
    initial: { modelId: current.modelId, reasoningLevel: current.reasoningLevel },
    locked: options.locked,
    picks: options.picks || picks(),
  });
  const supervision = createRunSupervision({
    supervisor,
    current,
    modelLabel: id => id.toUpperCase(),
    announce: (reason, extra) => announced.push({ reason, ...extra }),
    activity: french => activities.push(french),
    trace: event => traces.push(event),
    legacyEscalate,
    secondOpinion: options.secondOpinion ? (from) => options.secondOpinion!(from) : undefined,
  });
  const finish = (round: number, before: number, after: number, files: string[] = ['src/App.tsx']) => {
    supervision.onRepairEvent({ type: 'repair_round_started', round });
    supervision.onRepairEvent({ type: 'repair_round_finished', round, errorsBefore: before, errorsAfter: after, filesTouched: files });
  };
  return { current, announced, activities, traces, legacyEscalate, supervision, finish };
}

describe('supervision wired to a run', () => {
  it('first says what failed, once, then thinks harder, then changes model with a handoff', async () => {
    const run = setup();
    run.supervision.onInstruction('Fix these errors:\nsrc/App.tsx: error TS2304: Cannot find name foo');

    run.finish(2, 4, 4);
    expect(run.current).toMatchObject({ modelId: 'weak', reasoningLevel: 'low' });
    expect(run.activities).toHaveLength(1);
    const first = await run.supervision.takeRoundNote();
    expect(first).toContain('Note from the supervisor');
    expect(first).toMatch(/removed none|did not|same error/i);
    // Delivered once: the next read is empty.
    expect(await run.supervision.takeRoundNote()).toBe('');

    run.supervision.onInstruction('Fix these errors:\nsrc/App.tsx: error TS2304: Cannot find name bar');
    run.finish(4, 4, 4);
    expect(run.current).toMatchObject({ modelId: 'weak', reasoningLevel: 'medium' });
    expect(run.announced.at(-1)).toMatchObject({ reason: 'supervision', from: 'weak' });
    // Same model: nothing to hand off.
    expect(await run.supervision.takeRoundNote()).toBe('');

    run.supervision.onInstruction('Fix these errors:\nsrc/lib/api.ts: error TS2322: Type mismatch');
    run.finish(6, 4, 5, ['src/lib/api.ts', 'src/App.tsx']);
    expect(run.current.modelId).toBe('strong');
    expect(run.announced.at(-1)).toMatchObject({ reason: 'supervision', from: 'weak' });
    const handoff = await run.supervision.takeRoundNote();
    expect(handoff).toContain('taking over');
    expect(handoff).toContain('WEAK');
    expect(handoff).toContain('src/lib/api.ts');
    expect(handoff).toMatch(/round 6 \(WEAK\): 4 → 5 errors/);
    expect(await run.supervision.takeRoundNote()).toBe('');
    // Every step is in the trace with the signal that caused it.
    expect(run.traces.map(trace => trace.action)).toEqual(['retry_with_correction', 'raise_reasoning', 'escalate_model']);
    expect(run.traces.every(trace => trace.kind === 'supervision' && trace.signal === 'no_progress')).toBe(true);
  });

  it('recognises the same error coming back and quotes it', async () => {
    const run = setup();
    const instruction = 'Fix these errors:\nsrc/App.tsx: error TS2304: Cannot find name foo\nsrc/main.tsx: error TS2307: Cannot find module x';
    run.supervision.onInstruction(instruction);
    run.finish(2, 3, 3);
    await run.supervision.takeRoundNote();
    run.supervision.onInstruction(instruction);
    run.finish(4, 3, 3);
    expect(run.traces.map(trace => trace.signal)).toEqual(['no_progress', 'same_error_twice']);
    expect(errorSignatureOf(instruction)).toContain('TS2304');
  });

  it('says nothing when a round makes progress', () => {
    const run = setup();
    run.finish(2, 5, 2);
    run.finish(3, 2, 0);
    expect(run.announced).toEqual([]);
    expect(run.activities).toEqual([]);
    expect(run.traces).toEqual([]);
  });

  it('follows a provider failure the gateway already recovered from, and never goes back to that model', async () => {
    const run = setup();
    run.supervision.onFallback({ from: 'weak', to: 'other', reason: 'PROVIDER_TIMEOUT' });
    expect(run.current.modelId).toBe('other');
    expect(run.announced.at(-1)).toMatchObject({ reason: 'fallback', from: 'weak' });
    expect(run.announced.at(-1)!.detail).toMatch(/WEAK n’a pas pu répondre \(PROVIDER_TIMEOUT\) : OTHER prend le relais/);
    expect(run.traces.at(-1)).toMatchObject({ kind: 'fallback', fromModel: 'weak', toModel: 'other', signal: 'provider_failure' });
    // Two clean rounds later the run steps down — but not to the model that failed.
    run.finish(2, 4, 1);
    run.finish(3, 1, 0);
    run.finish(4, 0, 0);
    expect(run.current.modelId).not.toBe('weak');
  });

  it('never changes a model the person chose, and suggests Auto once', () => {
    const run = setup({ locked: true });
    run.finish(2, 4, 4);
    run.finish(4, 4, 4);
    run.finish(6, 4, 4);
    expect(run.current.modelId).toBe('weak');
    expect(run.announced).toHaveLength(1);
    expect(run.announced[0]).toMatchObject({ reason: 'suggestion' });
    expect(run.announced[0].detail).toMatch(/passez en Auto/);
  });

  it('keeps the previous escalation when the supervisor is off (CODEN_ROUTER_V2=0)', () => {
    const run = setup({ noSupervisor: true });
    run.finish(1, 4, 4); // the first round builds: never judged
    run.finish(2, 4, 2); // progress
    expect(run.legacyEscalate).not.toHaveBeenCalled();
    run.finish(3, 2, 2); // stalled
    expect(run.legacyEscalate).toHaveBeenCalledTimes(1);
    expect(run.announced).toEqual([]);
  });

  it('brings a second opinion into the next round, and carries on if none can be had', async () => {
    const asked: string[] = [];
    const run = setup({
      picks: picks({ stronger: () => null, otherFamily: () => null }),
      secondOpinion: async from => { asked.push(from); return '## Second opinion\nThe import path is wrong.'; },
    });
    run.supervision.onInstruction('Fix these errors:\nsrc/App.tsx: error TS2304: Cannot find name foo');
    let opinion = '';
    for (const round of [2, 4, 6, 8, 10]) {
      run.finish(round, 4, 4);
      const note = await run.supervision.takeRoundNote();
      if (note.includes('Second opinion')) opinion = note;
    }
    expect(asked).toEqual(['other']);
    expect(opinion).toContain('The import path is wrong.');

    const failing = setup({
      picks: picks({ stronger: () => null, otherFamily: () => null }),
      secondOpinion: async () => { throw new Error('provider down'); },
    });
    for (const round of [2, 4, 6, 8, 10]) {
      failing.finish(round, 4, 4);
      await expect(failing.supervision.takeRoundNote()).resolves.not.toContain('Second opinion');
    }
  });

  it('records the files touched across the run for the handoff', async () => {
    const run = setup({ picks: picks({ stronger: () => null, otherFamily: () => ({ modelId: M('other'), reasoningLevel: 'high' }) }) });
    run.supervision.onInstruction('errors');
    run.finish(2, 3, 3, ['a.ts']);
    run.finish(4, 3, 3, ['b.ts']);
    run.finish(6, 3, 3, ['c.ts']);
    const note = await run.supervision.takeRoundNote();
    expect(note).toMatch(/a\.ts/);
    expect(note).toMatch(/c\.ts/);
    expect(run.supervision.failedAttempts.length).toBeGreaterThanOrEqual(3);
  });
});
