import { afterEach, describe, expect, it } from 'vitest';
import { AI_MODEL_CAPABILITIES, AI_MODEL_PLAN_ACCESS, normalizeUserPlan } from '../config/ai-models';
import { REFERENCE_SET, replayRouting } from './routing-reference-set';
import { assignArm, bucketOf, sonnet55Experiment, SONNET_55_ID } from './routing-experiments';

const PLAN_RANK = { free: 0, pro: 1, business: 2, enterprise: 3 } as const;

afterEach(() => {
  delete process.env.CODEN_MODEL_SONNET_5_5;
});

describe('the 30-request reference set', () => {
  it('has thirty requests with unique ids across all plans and routes', () => {
    expect(REFERENCE_SET).toHaveLength(30);
    expect(new Set(REFERENCE_SET.map(item => item.id)).size).toBe(30);
    expect(new Set(REFERENCE_SET.map(item => item.plan))).toEqual(new Set(['free', 'pro', 'business']));
    expect(new Set(REFERENCE_SET.map(item => item.route))).toEqual(new Set(['new_project', 'small_edit', 'large_change']));
    expect(REFERENCE_SET.filter(item => item.images).length).toBeGreaterThanOrEqual(3);
  });

  it('resolves every request to a model the plan grants, in every mode, well inside the routing budget', () => {
    for (const mode of ['economy', 'balanced', 'performance'] as const) {
      const replay = replayRouting({ mode });
      expect(replay.unresolved, `${mode}: ${replay.unresolved.join(', ')}`).toEqual([]);
      expect(replay.maxDecisionMs).toBeLessThan(300);
      for (const decision of replay.decisions) {
        const plan = normalizeUserPlan(decision.plan) as keyof typeof PLAN_RANK;
        expect(PLAN_RANK[normalizeUserPlan(AI_MODEL_PLAN_ACCESS[decision.modelId as keyof typeof AI_MODEL_PLAN_ACCESS]) as keyof typeof PLAN_RANK], `${mode}/${decision.id}`).toBeLessThanOrEqual(PLAN_RANK[plan]);
      }
    }
  });

  it('routes a mock-up to a model that sees it, and a huge project to one that can hold it', () => {
    const replay = replayRouting({ mode: 'balanced' });
    for (const id of ['mockup-dashboard', 'mockup-landing', 'mockup-app-business']) {
      const decision = replay.decisions.find(item => item.id === id)!;
      expect(AI_MODEL_CAPABILITIES[decision.modelId as keyof typeof AI_MODEL_CAPABILITIES].supportsVision, id).toBe(true);
    }
    const huge = replay.decisions.find(item => item.id === 'huge-project-edit')!;
    expect(AI_MODEL_CAPABILITIES[huge.modelId as keyof typeof AI_MODEL_CAPABILITIES].maxContextTokens).toBeGreaterThanOrEqual(620_000);
  });

  it('costs least in Économique and most in Performance, on the same thirty requests', () => {
    const economy = replayRouting({ mode: 'economy' });
    const balanced = replayRouting({ mode: 'balanced' });
    const performance = replayRouting({ mode: 'performance' });
    expect(economy.meanUsdPerMillion).toBeLessThanOrEqual(balanced.meanUsdPerMillion);
    expect(balanced.meanUsdPerMillion).toBeLessThanOrEqual(performance.meanUsdPerMillion);
    expect(performance.meanUsdPerMillion).toBeGreaterThan(economy.meanUsdPerMillion);
    // More than one model is really in use: Auto routes, it does not always answer the same.
    expect(balanced.modelShare.length).toBeGreaterThanOrEqual(3);
    expect(balanced.modelShare[0].share).toBeLessThan(0.7);
  });
});

describe('the Sonnet 5.5 experiment', () => {
  it('runs only with its flag on and a share set, and keeps a project in one arm', () => {
    expect(sonnet55Experiment({}, 'p:u').arm).toBeNull();
    expect(sonnet55Experiment({ CODEN_MODEL_SONNET_5_5: '1' }, 'p:u').arm).toBeNull();
    expect(sonnet55Experiment({ CODEN_AB_SONNET_55_PERCENT: '50' }, 'p:u').arm).toBeNull();
    const env = { CODEN_MODEL_SONNET_5_5: '1', CODEN_AB_SONNET_55_PERCENT: '50' };
    const first = sonnet55Experiment(env, 'project-1:user-1').arm;
    for (let i = 0; i < 5; i += 1) expect(sonnet55Experiment(env, 'project-1:user-1').arm).toBe(first);
  });

  it('splits close to the requested share', () => {
    let treatment = 0;
    for (let i = 0; i < 2_000; i += 1) if (assignArm('x', `seed-${i}`, 30) === 'treatment') treatment += 1;
    expect(treatment / 2_000).toBeGreaterThan(0.26);
    expect(treatment / 2_000).toBeLessThan(0.34);
    expect(bucketOf('x', 'a')).toBeGreaterThanOrEqual(0);
    expect(bucketOf('x', 'a')).toBeLessThan(100);
    expect(assignArm('x', 'anything', 0)).toBe('control');
    expect(assignArm('x', 'anything', 100)).toBe('treatment');
  });

  it('pushes the treatment arm toward Sonnet 5.5 on plans that reach it, and never onto the free plan', () => {
    process.env.CODEN_MODEL_SONNET_5_5 = '1';
    const control = replayRouting({ mode: 'balanced' });
    const treatment = replayRouting({ mode: 'balanced', boost: { [SONNET_55_ID]: 2.5 } });
    const chosenBy = (replay: ReturnType<typeof replayRouting>) => replay.decisions.filter(decision => decision.modelId === SONNET_55_ID);
    expect(chosenBy(control)).toHaveLength(0);
    expect(chosenBy(treatment).length).toBeGreaterThan(3);
    // The gates still hold: plan access, and the mock-up still goes to a model that sees.
    for (const decision of chosenBy(treatment)) expect(decision.plan).not.toBe('free');
    for (const id of ['mockup-dashboard', 'mockup-landing', 'mockup-app-business']) {
      const decision = treatment.decisions.find(item => item.id === id)!;
      expect(AI_MODEL_CAPABILITIES[decision.modelId as keyof typeof AI_MODEL_CAPABILITIES].supportsVision).toBe(true);
    }
  });
});
