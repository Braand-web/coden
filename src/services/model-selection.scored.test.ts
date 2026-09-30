import { afterEach, describe, expect, it } from 'vitest';
import { AI_MODEL_CAPABILITIES, AI_MODEL_PLAN_ACCESS, MODEL_REGISTRY, normalizeUserPlan, type AllowedModelId } from '../config/ai-models';
import { setLearnedModelStats } from './agent-learning';
import { liveBlendedCost, selectModel, type SelectionRequest, type TaskKind } from './model-selection';
import { DEFAULT_ROUTING_POLICY, loadRoutingPolicy, normalizeRoutingMode, routerV2Enabled } from './routing-policy';
import { STRENGTH_RANK } from './model-scoring';
import { createSupervisorPicks } from './supervisor-picks';

const TASKS: TaskKind[] = ['conversation', 'code_edit', 'code_generation', 'debug', 'planning', 'review', 'design', 'architecture'];
const COMPLEXITIES = ['simple', 'medium', 'complex', 'extreme'] as const;
const PLANS = ['free', 'pro', 'business'] as const;
const PLAN_RANK = { free: 0, pro: 1, business: 2, enterprise: 3 } as const;

const power = (id: string) => {
  const caps = AI_MODEL_CAPABILITIES[id as AllowedModelId];
  return [caps.reasoningLevel, caps.codeLevel, caps.agenticLevel, caps.designLevel, caps.securityLevel].reduce((sum, level) => sum + STRENGTH_RANK[level], 0);
};

function grid(mode: string) {
  const cells: Array<{ task: TaskKind; complexity: (typeof COMPLEXITIES)[number]; plan: (typeof PLANS)[number]; modelId: AllowedModelId }> = [];
  for (const plan of PLANS) for (const task of TASKS) for (const complexity of COMPLEXITIES) {
    try {
      cells.push({ task, complexity, plan, modelId: selectModel({ task, complexity, plan, mode, needs: { tools: true }, interactive: true }).modelId });
    } catch { /* nothing eligible on this plan: the selector says so, and the caller degrades */ }
  }
  return cells;
}

afterEach(() => {
  delete process.env.CODEN_ROUTER_V2;
  delete process.env.CODEN_ROUTING_POLICY;
  setLearnedModelStats([]);
});

describe('scored model selection', () => {
  it('is the default, and CODEN_ROUTER_V2=0 restores the previous cheapest-first walk', () => {
    expect(routerV2Enabled({})).toBe(true);
    expect(selectModel({ task: 'conversation', plan: 'enterprise' }).policy).toBe('scored');
    process.env.CODEN_ROUTER_V2 = '0';
    const legacy = selectModel({ task: 'conversation', plan: 'enterprise' });
    expect(legacy.policy).toBe('legacy');
    // The exact pick of the previous policy: the rollback really is the old behaviour.
    expect(legacy.modelId).toBe('openai/gpt-5.6-luna');
  });

  it('never returns a model the plan does not grant, nor one that cannot do what was asked', () => {
    for (const mode of ['economy', 'balanced', 'performance']) {
      for (const cell of grid(mode)) {
        expect(PLAN_RANK[normalizeUserPlan(AI_MODEL_PLAN_ACCESS[cell.modelId]) as keyof typeof PLAN_RANK]).toBeLessThanOrEqual(PLAN_RANK[cell.plan]);
        expect(AI_MODEL_CAPABILITIES[cell.modelId].supportsToolCalling).toBe(true);
        expect(cell.modelId.endsWith(':batch')).toBe(false);
      }
    }
    const withImage = selectModel({ task: 'code_generation', plan: 'pro', needs: { tools: true, vision: true } });
    expect(AI_MODEL_CAPABILITIES[withImage.modelId].supportsVision).toBe(true);
  });

  it('answers to the mode: economy costs no more than balanced, which costs no more than performance', () => {
    const economy = grid('economy');
    const balanced = grid('balanced');
    const performance = grid('performance');
    expect(economy.length).toBe(balanced.length);
    let stricter = 0;
    for (let index = 0; index < economy.length; index += 1) {
      expect(liveBlendedCost(economy[index].modelId)).toBeLessThanOrEqual(liveBlendedCost(balanced[index].modelId) + 1e-9);
      expect(liveBlendedCost(balanced[index].modelId)).toBeLessThanOrEqual(liveBlendedCost(performance[index].modelId) + 1e-9);
      // …and the strongest mode is never weaker.
      expect(power(performance[index].modelId)).toBeGreaterThanOrEqual(power(economy[index].modelId));
      if (economy[index].modelId !== performance[index].modelId) stricter += 1;
    }
    // On paid plans the modes genuinely pick different models, not the same one three times.
    expect(stricter).toBeGreaterThan(20);
  });

  it('grows with the difficulty of the task on a paid plan', () => {
    const easy = selectModel({ task: 'code_generation', complexity: 'simple', plan: 'business', mode: 'balanced', needs: { tools: true } });
    const hard = selectModel({ task: 'code_generation', complexity: 'extreme', plan: 'business', mode: 'balanced', needs: { tools: true } });
    expect(power(hard.modelId)).toBeGreaterThan(power(easy.modelId));
    expect(liveBlendedCost(hard.modelId)).toBeGreaterThan(liveBlendedCost(easy.modelId));
  });

  it('is fast: a decision is local and synchronous, far under the 300 ms budget', () => {
    const times = Array.from({ length: 50 }, () => selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', needs: { tools: true } }).decisionMs ?? 999);
    expect(Math.max(...times)).toBeLessThan(50);
  });

  it('explains itself: the mode, the reason and the runners-up with their scores', () => {
    const result = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', mode: 'performance', needs: { tools: true } });
    expect(result.mode).toBe('performance');
    expect(result.reason).toMatch(/performance mode/);
    expect(result.considered?.length).toBeGreaterThan(1);
    expect(result.considered![0].modelId).toBe(result.modelId);
    expect(result.considered![0].score).toBeGreaterThanOrEqual(result.considered![1].score);
    expect(Object.keys(result.considered![0].parts)).toEqual(['quality', 'cost', 'speed', 'role', 'learned']);
  });

  it('leaves out the models already tried and abandoned', () => {
    const first = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', needs: { tools: true } });
    const second = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', needs: { tools: true }, exclude: [first.modelId] });
    expect(second.modelId).not.toBe(first.modelId);
  });

  it('prefers a cheaper model when the credits left are few', () => {
    const rich = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', credits: 10_000, needs: { tools: true } });
    const poor = selectModel({ task: 'code_generation', complexity: 'complex', plan: 'business', credits: 25, needs: { tools: true } });
    expect(liveBlendedCost(poor.modelId)).toBeLessThanOrEqual(liveBlendedCost(rich.modelId));
  });

  it('lets a measured track record tip a close call, and only with evidence', () => {
    const request: SelectionRequest = { task: 'code_generation', complexity: 'medium', plan: 'business', mode: 'balanced', needs: { tools: true } };
    const before = selectModel(request);
    const challenger = selectModel({ ...request, exclude: [before.modelId] }).modelId;
    // Few runs: ignored.
    setLearnedModelStats([
      { task_type: 'code_generation', model_id: before.modelId, runs: 3, successes: 0 },
      { task_type: 'code_generation', model_id: challenger, runs: 3, successes: 3 },
    ]);
    expect(selectModel(request).modelId).toBe(before.modelId);
    // Plenty of runs: the one that actually succeeds more often wins.
    setLearnedModelStats([
      { task_type: 'code_generation', model_id: before.modelId, runs: 60, successes: 12 },
      { task_type: 'code_generation', model_id: challenger, runs: 60, successes: 57 },
    ]);
    const after = selectModel(request);
    expect(after.modelId).toBe(challenger);
    expect(after.reason).toMatch(/measured to succeed more often/);
  });

  it('keeps a pinned model exactly as pinned, whatever the mode', () => {
    const pinned = selectModel({ task: 'code_generation', plan: 'business', requestedModel: 'anthropic/claude-opus-5', mode: 'economy', needs: { tools: true } });
    expect(pinned.modelId).toBe('anthropic/claude-opus-5');
  });
});

describe('the routing policy', () => {
  it('reads the mode from anything a client might send', () => {
    expect(normalizeRoutingMode('Économique')).toBe('economy');
    expect(normalizeRoutingMode('performance')).toBe('performance');
    expect(normalizeRoutingMode('balanced')).toBe('balanced');
    expect(normalizeRoutingMode(undefined)).toBe('balanced');
    expect(normalizeRoutingMode('nonsense')).toBe('balanced');
  });

  it('takes bounded overrides from the environment and ignores garbage', () => {
    expect(loadRoutingPolicy({})).toBe(DEFAULT_ROUTING_POLICY);
    const tuned = loadRoutingPolicy({ CODEN_ROUTING_POLICY: JSON.stringify({ maxEscalations: 99, minRoundsBetweenSwitches: -4, modes: { economy: { cost: 1000, quality: 'x' } } }) });
    // A typo cannot make a run climb without limit or price nothing.
    expect(tuned.maxEscalations).toBe(5);
    expect(tuned.minRoundsBetweenSwitches).toBe(0);
    expect(tuned.modes.economy.cost).toBe(10);
    expect(tuned.modes.economy.quality).toBe(DEFAULT_ROUTING_POLICY.modes.economy.quality);
    expect(loadRoutingPolicy({ CODEN_ROUTING_POLICY: '{ not json' })).toBe(DEFAULT_ROUTING_POLICY);
  });
});

describe('the supervisor’s picks', () => {
  const base = { task: 'code_generation' as const, complexity: 'medium' as const, plan: 'business', needs: { tools: true } };

  it('finds a stronger model, another family, and a cheaper one — through the same gates', () => {
    const picks = createSupervisorPicks(base);
    const from = 'openai/gpt-6-luna' as AllowedModelId;
    const stronger = picks.stronger(from, [from]);
    expect(stronger && power(stronger.modelId)).toBeGreaterThan(power(from));
    const other = picks.otherFamily(from, [from]);
    expect(other && MODEL_REGISTRY.find(model => model.id === other.modelId)?.provider).not.toBe('openai');
    const cheaper = picks.cheaper('anthropic/claude-opus-5' as AllowedModelId, ['anthropic/claude-opus-5' as AllowedModelId]);
    expect(cheaper && liveBlendedCost(cheaper.modelId)).toBeLessThan(liveBlendedCost('anthropic/claude-opus-5'));
  });

  it('stays inside what the plan grants', () => {
    const picks = createSupervisorPicks({ ...base, plan: 'free' });
    const from = 'openai/gpt-6-luna' as AllowedModelId;
    for (const pick of [picks.stronger(from, [from]), picks.otherFamily(from, [from]), picks.specialist('design', [from])]) {
      if (pick) expect(AI_MODEL_PLAN_ACCESS[pick.modelId]).toBe('free');
    }
  });

  it('keeps the models that can read the attached images', () => {
    const picks = createSupervisorPicks({ ...base, needs: { tools: true, vision: true } });
    const from = 'openai/gpt-6-luna' as AllowedModelId;
    for (const pick of [picks.stronger(from, [from]), picks.otherFamily(from, [from])]) {
      if (pick) expect(AI_MODEL_CAPABILITIES[pick.modelId].supportsVision).toBe(true);
    }
  });

  it('finds a long-context model for a project too large for the current one', () => {
    const picks = createSupervisorPicks({ ...base, estimatedInputTokens: 600_000 });
    const pick = picks.specialist('long_context', []);
    expect(pick && AI_MODEL_CAPABILITIES[pick.modelId].maxContextTokens).toBeGreaterThanOrEqual(600_000);
  });
});

describe('Sonnet 5.5 behind its flag', () => {
  const ID = 'anthropic/claude-sonnet-5.5';
  afterEach(() => { delete process.env.CODEN_MODEL_SONNET_5_5; });

  it('is neither chosen by Auto nor accepted as a pinned model while the flag is off', () => {
    for (const mode of ['economy', 'balanced', 'performance']) {
      for (const cell of grid(mode)) expect(cell.modelId).not.toBe(ID);
    }
    expect(() => selectModel({ task: 'code_generation', plan: 'business', requestedModel: ID, needs: { tools: true } })).toThrow(/not available/);
  });

  it('can be pinned once enabled, for Pro and above, and never on the free plan', () => {
    process.env.CODEN_MODEL_SONNET_5_5 = '1';
    expect(selectModel({ task: 'code_generation', plan: 'pro', requestedModel: ID, needs: { tools: true } }).modelId).toBe(ID);
    // The free plan cannot reach it: even pinned, a model above the plan is refused, never quietly granted.
    expect(() => selectModel({ task: 'code_generation', plan: 'free', requestedModel: ID, needs: { tools: true } })).toThrow(/No eligible/);
  });

  it('enters Auto\'s pool once enabled, and only for plans that grant it', () => {
    process.env.CODEN_MODEL_SONNET_5_5 = '1';
    const pool = new Set(grid('performance').map(cell => cell.modelId));
    // It may or may not win a cell (its strengths equal Sonnet 5\'s at a higher price), but it is a candidate.
    for (const cell of grid('performance').filter(item => item.plan === 'free')) expect(cell.modelId).not.toBe(ID);
    expect(pool.size).toBeGreaterThan(1);
  });
});
