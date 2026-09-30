import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ModelRouter } from './model-router';
import { currentRoutingMode, runWithRoutingMode } from './routing-request-context';
import { normalizeRoutingMode, ROUTING_MODES } from '../lib/routing-mode';
import { selectModel } from './model-selection';
import { replayRouting } from './routing-reference-set';

const pick = (routingMode: string | undefined, plan: string, task: any, taskComplexity: any) =>
  new ModelRouter().selectModel({ plan: plan as any, mode: 'Auto', userCredits: 500, task, taskComplexity, interactive: true, routingMode: routingMode as any });

describe('Économique / Équilibré / Performance', () => {
  it('changes the model on the conversational path, where it used to change nothing', async () => {
    const economy = await pick('economy', 'pro', 'conversation', 'simple');
    const performance = await pick('performance', 'pro', 'conversation', 'simple');
    expect(economy).not.toBe(performance);
    const business = { economy: await pick('economy', 'business', 'planning', 'complex'), performance: await pick('performance', 'business', 'planning', 'complex') };
    expect(business.economy).not.toBe(business.performance);
  });

  it('a request that names no mode routes exactly as before', async () => {
    expect(await pick(undefined, 'pro', 'planning', 'complex')).toBe(await pick('balanced', 'pro', 'planning', 'complex'));
  });

  it('never buys a model the plan does not reach, in any mode', async () => {
    for (const mode of ROUTING_MODES) {
      const chosen = await pick(mode, 'free', 'architecture', 'extreme');
      expect(chosen).toBe(await pick('balanced', 'free', 'architecture', 'extreme'));
    }
  });

  it('the pipeline path is monotonic too: economy is never dearer than performance', () => {
    for (const [task, complexity] of [['code_generation', 'medium'], ['planning', 'complex'], ['debug', 'complex']] as const) {
      const price = (mode: any) => selectModel({ task, complexity, plan: 'business', credits: 500, mode, interactive: true }).estimatedUsdPerMillionBlended;
      expect(price('economy')).toBeLessThanOrEqual(price('balanced'));
      expect(price('balanced')).toBeLessThanOrEqual(price('performance'));
    }
    // And over the 30 reference requests, the mean price never goes down as the mode goes up.
    const mean = (mode: any) => replayRouting({ mode }).meanUsdPerMillion;
    expect(mean('economy')).toBeLessThanOrEqual(mean('balanced'));
    expect(mean('balanced')).toBeLessThanOrEqual(mean('performance'));
  });

  it('accepts every spelling the composer or an old client may send, and falls back to the middle', () => {
    expect(['Économique', 'economique', 'eco', 'economy'].map(normalizeRoutingMode)).toEqual(['economy', 'economy', 'economy', 'economy']);
    expect(['Performance', 'perf'].map(normalizeRoutingMode)).toEqual(['performance', 'performance']);
    expect(['', 'nonsense', undefined, null, 42].map(normalizeRoutingMode)).toEqual(['balanced', 'balanced', 'balanced', 'balanced', 'balanced']);
  });

  it('is carried through the request, and only when the request names one', async () => {
    expect(currentRoutingMode()).toBeUndefined();
    await runWithRoutingMode('Performance', async () => {
      await Promise.resolve();
      expect(currentRoutingMode()).toBe('performance');
    });
    await runWithRoutingMode(undefined, async () => expect(currentRoutingMode()).toBeUndefined());
    expect(currentRoutingMode()).toBeUndefined();
  });

  it('is wired from the composer to the router: stored, sent on both requests, applied to every route', () => {
    const composer = readFileSync('src/components/ui/ai-chat-input.tsx', 'utf8');
    const builder = readFileSync('src/builder-live.ts', 'utf8');
    const server = readFileSync('server.ts', 'utf8');
    const pipeline = readFileSync('src/services/multi-agent-pipeline.ts', 'utf8');
    expect(composer).toMatch(/setRoutingMode\(next\);\s*writeRoutingMode\(next\)/);
    expect((builder.match(/routingMode: readRoutingMode\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(server).toMatch(/app\.use\(\['\/api\/assistant\/chat', '\/api\/projects\/:id\/generate'\]/);
    expect((server.match(/routingMode: currentRoutingMode\(\)/g) || []).length).toBe(2);
    expect(server).toMatch(/routingMode: typeof req\.body\?\.routingMode === 'string'/);
    expect(pipeline).toMatch(/const routingMode = normalizeRoutingMode\(input\.routingMode\)/);
  });
});
