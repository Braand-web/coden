import { describe, expect, it, vi } from 'vitest';
import { InternalRoutingBudget, type ChoiceAnswer, type DecisionsResult } from './openrouter-decisions.ts';
import { INTENT_QUESTIONS, decisionsMode, decisionsSampleRate, intentDecisionState, judgementRejection,
  readIntentJudgement, routeIntentWithDecisions, type DecisionRouterInput, type DecisionsObservation } from './decisions-intent-router.ts';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateModelDecision } from './agent-runtime-v2.ts';

const input: DecisionRouterInput = { prompt: 'Change la couleur du bouton principal en bleu.', hasFiles: true };
function result(intent = 'edit', context = 'standalone'): DecisionsResult {
  const winners: Record<string, string> = { intent, context, complexity: 'simple', media: 'none' };
  return { latencyMs: 120, costUsd: 0.0002, inputTokens: 2000,
    answers: Object.fromEntries(Object.entries(INTENT_QUESTIONS).map(([name, question]) => question.type === 'noul'
      ? [name, { type: 'noul', noul: 0.01 }]
      : [name, { type: 'choice', choice: winners[name], confidence: 0.99,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(key => [key, key === winners[name] ? 1 : 0])) }])) };
}
function harness(answer = result()) {
  const observation: DecisionsObservation[] = [];
  const legacy = vi.fn(async (budget: InternalRoutingBudget) => { budget.claim(); return { intent: 'edit', source: 'chat' }; });
  const decide = vi.fn(async (_state: unknown, _questions: unknown, budget: InternalRoutingBudget) => { budget.claim(); return answer; });
  const accept = vi.fn(judgement => ({ intent: judgement.intent, source: 'decisions' }));
  return { observation, legacy, decide, accept, options: { mode: 'active' as const, client: { decide }, legacy, accept,
    observe: (o: DecisionsObservation) => observation.push(o) } };
}

// Run the production wrapper and its actual contract helpers, not a second mapper.
function serverRouter(answer = result()) {
  const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const names = new Set(['classifyIntentWithAi', 'buildDecisionFromAi', 'completeIntentRouterOutput', 'runtimeActionForIntent']);
  const functions = ast.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.has(statement.name?.text || ''));
  expect(functions).toHaveLength(names.size);
  const code = ts.transpileModule(functions.map(fn => fn.getText(ast)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const h = harness(answer);
  const guard = vi.fn((decision: any) => decision);
  const deps = { hasLiveAiProvider: () => true, agentIntentNeedsAiRouter: () => true,
    decisionsMode: () => 'active', decisionsSampleRate: () => 0.1,
    decisionsIntentClient: h.options.client, routeIntentWithDecisions,
    classifyIntentWithChat: h.legacy, isLikelyFrenchPrompt: () => true, isGreetingPrompt: () => false,
    guardAiDecisionWithUnderstanding: guard, validateModelDecision, console: { info: vi.fn() } };
  const classify = new Function(...Object.keys(deps), `${code}\nreturn classifyIntentWithAi;`)(...Object.values(deps));
  return { ...h, classify, guard };
}

describe('Decisions intent routing and conversation continuity', () => {
  it('directly routes a strong standalone request through Decisions', async () => {
    const h = harness();
    expect(await routeIntentWithDecisions(input, h.options)).toEqual({ intent: 'edit', source: 'decisions' });
    expect(h.legacy).not.toHaveBeenCalled();
    expect(h.observation[0]).toMatchObject({ outcome: 'selected', calls: 1 });
  });

  it('passes the actual server contract and keeps an entire standalone request beyond 4000 characters', async () => {
    const h = serverRouter();
    const prompt = 'Change le bouton principal en bleu.\n' + 'Conserve les exigences détaillées. '.repeat(150);
    expect(prompt.length).toBeGreaterThan(4000);
    const decision = await h.classify({ ...input, prompt }, { intent: 'conversation', selectedModelPolicy: 'auto' });
    expect(decision).toMatchObject({ intent: 'edit', requiresFileChanges: true, requiresPreviewRebuild: true,
      resolvedPrompt: prompt, routingComplexity: 'simple', requiredCapabilities: ['code'], routingSource: 'ai' });
    expect(decision.modelObjective.goal).toBe(prompt.trim());
    expect(h.guard).toHaveBeenCalledOnce();
    expect(h.legacy).not.toHaveBeenCalled();
  });

  it('cannot promote a read-only request to a premium model on uncertain complexity', async () => {
    const answer = result('conversation');
    (answer.answers.complexity as ChoiceAnswer).confidence = 0.1;
    const h = serverRouter(answer);
    const decision = await h.classify({ ...input, prompt: 'Explique ce bouton.' }, { intent: 'conversation', selectedModelPolicy: 'economy' });
    expect(decision.intent).toBe('conversation');
    expect(decision.routingComplexity).toBeUndefined();
    expect(decision.selectedModelPolicy).toBe('economy');
    expect(decision.requiresFileChanges).toBe(false);
  });

  it.each([
    ['oui', 'build'], ['continue', 'edit'], ['ok', 'edit'], ['la deuxième', 'build'], ['vas-y', 'build'],
    ['continu', 'edit'], ["d’accord", 'edit'], ['2', 'build'], ['cest fait', 'edit'],
  ])('retains the complete original context for "%s"', async (prompt, intent) => {
    const h = harness(result(intent, 'previous'));
    const contextual = { ...input, prompt, lastPlan: 'Créer une application restaurant avec réservation.',
      recentHistory: [{ role: 'assistant' as const, content: 'Veux-tu que je construise la réservation ?' }] };
    await routeIntentWithDecisions(contextual, h.options);
    expect(h.legacy).toHaveBeenCalledOnce(); expect(h.accept).not.toHaveBeenCalled(); expect(h.decide).not.toHaveBeenCalled();
    expect(h.observation[0]).toMatchObject({ outcome: 'skipped', reason: 'context_requires_chat', calls: 0 });
    expect(intentDecisionState(contextual)).toMatchObject({ prompt, lastPlan: contextual.lastPlan, recentHistory: contextual.recentHistory });
  });

  it('requires both distribution probability and confidence, with stricter mutation thresholds', () => {
    const judgement = readIntentJudgement(result());
    expect(judgementRejection(judgement, input)).toBeNull();
    expect(judgementRejection({ ...judgement, confidence: 0.89 }, input)).toBe('low_confidence');
    expect(judgementRejection({ ...judgement, probability: 0.6, confidence: 0.99 }, input)).toBe('low_confidence');
    expect(judgementRejection({ ...judgement, margin: 0.1 }, input)).toBe('low_confidence');
    expect(judgementRejection({ ...judgement, planningProbability: 0.5 }, input)).toBe('uncertain_implementation_scope');
    expect(judgementRejection({ ...judgement, complexityConfidence: 0.8 }, input)).toBe('uncertain_implementation_scope');
    expect(judgementRejection({ ...judgement, intent: 'conversation', confidence: 0.85, probability: 0.85 }, input)).toBeNull();
  });

  it.each(['clarification_required', 'deploy_assist'])('retains the generative/confirmation flow for %s', async intent => {
    const h = harness(result(intent));
    await routeIntentWithDecisions(input, h.options);
    expect(h.accept).not.toHaveBeenCalled(); expect(h.legacy).toHaveBeenCalledOnce();
  });

  it('rejects editing/verification of a project without files', () => {
    for (const intent of ['edit', 'debug_fix', 'verify']) expect(judgementRejection(readIntentJudgement(result(intent)), { ...input, hasFiles: false })).toBe('missing_project_target');
  });

  it('does not change actions or wait for Decisions in shadow mode', async () => {
    const h = harness(result('conversation'));
    let finish!: (r: DecisionsResult) => void;
    h.decide.mockImplementation(async (_s, _q, budget) => { budget.claim(); return new Promise(resolve => { finish = resolve; }); });
    const routed = await routeIntentWithDecisions(input, { ...h.options, mode: 'shadow', sampleRate: 1, random: () => 0 });
    expect(routed.source).toBe('chat'); expect(h.observation).toHaveLength(0);
    finish(result('conversation'));
    await vi.waitFor(() => expect(h.observation).toHaveLength(1));
    expect(h.accept).not.toHaveBeenCalled();
    expect(h.observation[0]).toMatchObject({ outcome: 'observed', agreement: false, calls: 2 });
  });

  it('shares the two-call limit with the chat repair and skips extra observation', async () => {
    const h = harness();
    h.legacy.mockImplementation(async budget => { budget.claim(); budget.claim(); return { intent: 'edit', source: 'chat' }; });
    await routeIntentWithDecisions(input, { ...h.options, mode: 'shadow', sampleRate: 1, random: () => 0 });
    expect(h.decide).not.toHaveBeenCalled();
    expect(h.observation[0]).toMatchObject({ outcome: 'skipped', reason: 'call_limit', calls: 2 });
  });

  it('limits active fallback to one chat request after a paid Decisions failure', async () => {
    const h = harness();
    h.decide.mockImplementation(async (_s, _q, budget) => { budget.claim(); throw new Error('provider failed with private prompt'); });
    h.legacy.mockImplementation(async budget => { budget.claim(); expect(() => budget.claim()).toThrow('CALL_LIMIT'); return { intent: 'edit', source: 'chat' }; });
    expect((await routeIntentWithDecisions(input, h.options)).source).toBe('chat');
    expect(h.observation[0]).toMatchObject({ outcome: 'failed', reason: 'DECISIONS_UNAVAILABLE' });
    expect(JSON.stringify(h.observation)).not.toContain('private prompt');
  });

  it('supports immediate rollback and bounded shadow sampling', async () => {
    const h = harness();
    await routeIntentWithDecisions(input, { ...h.options, mode: 'off' }); expect(h.decide).not.toHaveBeenCalled();
    await routeIntentWithDecisions(input, { ...h.options, mode: 'shadow', sampleRate: 0.1, random: () => 0.5 }); expect(h.decide).not.toHaveBeenCalled();
    expect(decisionsMode({})).toBe('active'); expect(decisionsMode({ CODEN_DECISIONS_ROUTER_MODE: 'garbage' })).toBe('off');
    expect(decisionsSampleRate({ CODEN_DECISIONS_ROUTER_SAMPLE_RATE: '9' })).toBe(1);
    expect(decisionsSampleRate({ CODEN_DECISIONS_ROUTER_SAMPLE_RATE: '-1' })).toBe(0);
  });

  it('preserves the full current request, bounds history and redacts keys before transmission', () => {
    const state = intentDecisionState({ ...input, prompt: 'Analyse API_KEY=sk-or-v1-' + 'a'.repeat(40),
      recentHistory: Array.from({ length: 10 }, () => ({ role: 'user', content: 'x'.repeat(3000) })) });
    expect(state.recentHistory).toHaveLength(6); expect(state.recentHistory[0].content).toHaveLength(1500);
    expect(state.prompt).not.toContain('sk-or-v1');
    expect(() => intentDecisionState({ ...input, prompt: 'x'.repeat(8001) })).toThrow('INPUT_LIMIT');
  });

  it('cannot grant consent or touch paid media/billing; server applies the existing execution contract', () => {
    const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
    const integration = source.slice(source.indexOf('async function classifyIntentWithAi('), source.indexOf('async function classifyIntentWithChat('));
    expect(integration).toContain('guardAiDecisionWithUnderstanding');
    expect(integration).not.toMatch(/builderMediaService|reserveUnifiedUsage|settleUnifiedUsage|requestedMedia|prepare_media/);
    expect(source.slice(source.indexOf('async function resolveAgentDecision('), source.indexOf('function isLikelyFrenchPrompt(')))
      .toContain('return finalize(modelDecision)');
  });
});
