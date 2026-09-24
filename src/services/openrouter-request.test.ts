import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY, PUBLIC_MODEL_CATALOG } from '../config/ai-models';
import type { CatalogModel } from './openrouter-capabilities';
import { REASONING_LEVELS, answerReserve, buildOpenRouterRequest, estimatePromptTokens, maxReasoningBudget, promptSafetyMargin } from './openrouter-request';
import { adjustForRefusal } from './openrouter-service';
import { reasoningLevelForEffort, AGENT_EFFORT_LEVELS } from './agent-effort';

/*
 * Every model in the catalogue, at every reasoning level.
 *
 * The catalogue entries stand in for `GET /api/v1/models`: the model's own
 * context and output ceiling, and the parameters it advertises. Half the
 * models are declared without `reasoning` and without `tools`, so both
 * branches are exercised on every model.
 */
const messages = [
  { role: 'system' as const, content: 'You build web apps.' },
  { role: 'user' as const, content: 'Build a kanban board with drag and drop.' },
];
const tools = [{ type: 'function', function: { name: 'write_file', description: 'Write a file', parameters: { type: 'object', properties: {} } } }];

function liveEntry(id: string, index: number): CatalogModel {
  const definition = MODEL_REGISTRY.find(model => model.id === id)!;
  const full = index % 2 === 0;
  return {
    id,
    context_length: definition.contextWindow,
    supported_parameters: full
      ? ['tools', 'tool_choice', 'reasoning', 'include_reasoning', 'response_format', 'structured_outputs', 'max_tokens']
      : ['response_format', 'max_tokens'],
    architecture: { input_modalities: ['text', 'image'] },
    top_provider: { context_length: definition.contextWindow, max_completion_tokens: definition.maxOutputTokens },
  };
}

describe('buildOpenRouterRequest — every model × every level', () => {
  const models = MODEL_REGISTRY.map((model, index) => liveEntry(model.id, index));

  for (const model of models) {
    const supportsReasoning = model.supported_parameters.includes('reasoning');
    const supportsTools = model.supported_parameters.includes('tools');
    for (const level of REASONING_LEVELS) {
      it(`${model.id} at ${level}`, () => {
        const body: any = buildOpenRouterRequest(model, level, messages, supportsTools ? { tools, toolChoice: 'auto' } : {});
        const ceiling = model.top_provider!.max_completion_tokens!;
        const room = model.context_length - estimatePromptTokens(messages) - promptSafetyMargin(model.context_length);

        // Full power: the model's own output ceiling, bounded only by what fits.
        expect(body.max_tokens).toBe(Math.min(ceiling, room));
        // No forced sampling.
        expect(body.temperature).toBeUndefined();
        expect(body.top_p).toBeUndefined();
        // Always streamed, always with its real usage.
        expect(body.stream).toBe(true);
        expect(body.stream_options).toEqual({ include_usage: true });
        expect(body.usage).toEqual({ include: true });
        expect(body.provider).toEqual({ require_parameters: true });
        // Tools wherever supported, never elsewhere.
        if (supportsTools) expect(body.tools).toHaveLength(1);
        else expect(body.tools).toBeUndefined();

        if (!supportsReasoning) {
          expect(body.reasoning).toBeUndefined();
          return;
        }
        if (level === 'none') expect(body.reasoning).toEqual({ enabled: false });
        else if (level === 'max') {
          expect(body.reasoning.max_tokens).toBe(maxReasoningBudget(body.max_tokens));
          // The answer always keeps room after the thinking.
          expect(body.reasoning.max_tokens).toBeLessThan(body.max_tokens);
          expect(body.max_tokens - body.reasoning.max_tokens).toBeGreaterThanOrEqual(Math.min(answerReserve(body.max_tokens), body.max_tokens - 1024));
        } else expect(body.reasoning).toEqual({ effort: level });
      });
    }
  }

  it('lowers max_tokens only when the prompt leaves less room than the ceiling', () => {
    const model: CatalogModel = { id: 'x/small', context_length: 20_000, supported_parameters: ['reasoning'], top_provider: { max_completion_tokens: 16_000 } };
    const long = [{ role: 'user' as const, content: 'a'.repeat(35_000) }];
    const body: any = buildOpenRouterRequest(model, 'max', long, {});
    expect(body.max_tokens).toBe(20_000 - estimatePromptTokens(long) - promptSafetyMargin(20_000));
    expect(body.reasoning.max_tokens).toBeLessThan(body.max_tokens);
  });

  it('recovers once from a mandatory-reasoning refusal and from an unaffordable max_tokens', () => {
    const none: any = { model: 'm', max_tokens: 64_000, reasoning: { enabled: false } };
    expect(adjustForRefusal(none, 400, 'Reasoning is mandatory for this endpoint and cannot be disabled.')).toBe(true);
    expect(none.reasoning).toBeUndefined();
    const max: any = { model: 'm', max_tokens: 128_000, reasoning: { max_tokens: 100_000 } };
    expect(adjustForRefusal(max, 402, 'This request requires more credits, or fewer max_tokens. You requested up to 128000 tokens, but can only afford 20000.')).toBe(true);
    expect(max.max_tokens).toBe(20_000);
    expect(max.reasoning.max_tokens).toBeLessThan(20_000);
    expect(adjustForRefusal({ model: 'm', max_tokens: 1000 }, 500, 'upstream')).toBe(false);
  });

  it('asks for less when a credit refusal names no number, and never retries an empty account', () => {
    const unnamed: any = { model: 'm', max_tokens: 128_000, reasoning: { max_tokens: 100_000 } };
    expect(adjustForRefusal(unnamed, 402, 'This request requires more credits, or fewer max_tokens.')).toBe(true);
    expect(unnamed.max_tokens).toBe(16_000);
    expect(unnamed.reasoning.max_tokens).toBeLessThan(16_000);
    expect(adjustForRefusal({ model: 'm', max_tokens: 128_000 }, 402, 'Insufficient credits. Add more using https://openrouter.ai/credits')).toBe(false);
    expect(adjustForRefusal({ model: 'm', max_tokens: 128_000 }, 402, 'You requested up to 128000 tokens, but can only afford 12.')).toBe(false);
  });

  it('sends the fallback chain as `models`, without the primary twice', () => {
    const body: any = buildOpenRouterRequest(liveEntry(MODEL_REGISTRY[0].id, 0), 'medium', messages, { fallbackModels: [MODEL_REGISTRY[0].id, 'b/one', 'b/one', 'c/two'] });
    expect(body.models).toEqual([MODEL_REGISTRY[0].id, 'b/one', 'c/two']);
  });

  it('downgrades a JSON schema to JSON mode when the model has no structured outputs', () => {
    const body: any = buildOpenRouterRequest(liveEntry(MODEL_REGISTRY[1].id, 1), 'low', messages, { responseFormat: { type: 'json_schema', json_schema: { name: 'x', schema: {} } } });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('maps the five composer levels onto the five request levels, one to one', () => {
    expect(AGENT_EFFORT_LEVELS.map(reasoningLevelForEffort)).toEqual([...REASONING_LEVELS]);
  });

  it('lists each model once, and includes the new slugs', () => {
    const ids = PUBLIC_MODEL_CATALOG.map(model => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some(id => id.endsWith(':batch'))).toBe(false);
    for (const id of ['openai/gpt-6-sol', 'openai/gpt-6-luna', 'anthropic/claude-opus-5.5']) expect(ids).toContain(id);
  });
});

/*
 * One builder. Anything else that writes an OpenRouter request body is a
 * second source of limits, and the reason this module exists.
 */
describe('single request builder', () => {
  const root = join(__dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(path);
    }
  };
  walk(root);

  it('no other module posts to the chat completions endpoint or sets sampling', () => {
    const offenders = files.filter(path => {
      if (/openrouter-(request|service)\.ts$|fullstack-generation\.ts$/.test(path)) return false;
      const source = readFileSync(path, 'utf8');
      return /openrouter\.ai\/api\/v1\/chat\/completions/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('the OpenRouter service delegates the body to buildOpenRouterRequest', () => {
    const source = readFileSync(join(root, 'services', 'openrouter-service.ts'), 'utf8');
    expect(source).toContain('buildOpenRouterRequest(');
    // No fixed sizes and no sampling of its own; it only ever lowers a size
    // the provider itself named (see adjustForRefusal).
    expect(source).not.toMatch(/\bmax_tokens\s*:\s*\d/);
    expect(source).not.toMatch(/\b(temperature|top_p)\s*:/);
  });
});
