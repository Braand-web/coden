import { describe, expect, it } from 'vitest';
import { AI_ALLOWED_MODELS, AI_MODEL_FALLBACKS, MODEL_REGISTRY, PUBLIC_MODEL_CATALOG, AUTO_MODEL_IDS, ASTRA_MODEL_ID, getModelTokenPricing, isFlaggedModel, isModelEnabled, normalizeModelSelectionId, MODEL_ACTION_CREDIT_FLOORS } from './ai-models';
import { selectModel } from '../services/model-selection';

/**
 * The authorised catalogue, pinned exactly.
 *
 * This is the enforcement point for "only these models may be called". The
 * allowlist, the validator and the router all derive from MODEL_REGISTRY, so an
 * unauthorised model can only enter the system by being added here — and this
 * test is what stops that being a quiet edit.
 */
const AUTHORISED = [
  'openai/gpt-5.6-luna', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-sol',
  'anthropic/claude-fable-5.1',
  'anthropic/claude-fable-5.1:batch',
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-5.6-luna-pro',
  'moonshotai/kimi-k3',
  'x-ai/grok-4.6',
  'openai/gpt-6-astra',
  // Added on request; validated against the live OpenRouter catalogue at boot.
  'openai/gpt-6-sol',
  'openai/gpt-6-luna',
  'anthropic/claude-opus-5.5',
  // Behind CODEN_MODEL_SONNET_5_5; its numbers come from the live catalogue, not from here.
  'anthropic/claude-sonnet-5.5',
  'anthropic/claude-haiku-5.5',
];

describe('Coden production model registry', () => {
  it('preserves historical model IDs and adds only the verified interactive models', () => {
    expect([...AI_ALLOWED_MODELS].sort()).toEqual([...AUTHORISED].sort());
    expect(MODEL_REGISTRY).toHaveLength(18);
    expect(new Set(AI_ALLOWED_MODELS).size).toBe(AI_ALLOWED_MODELS.length);
  });
  it('limits Auto to five roles and keeps Astra as a replacement escalation', () => {
    expect([...AUTO_MODEL_IDS].sort()).toEqual(['openai/gpt-5.6-luna','openai/gpt-5.6-terra','openai/gpt-5.6-sol','openai/gpt-6-luna','anthropic/claude-opus-5'].sort());
    expect(AUTO_MODEL_IDS).not.toContain(ASTRA_MODEL_ID);
    expect(AI_ALLOWED_MODELS).toContain(ASTRA_MODEL_ID);
  });

  it('prices every model, because the router chooses on cost', () => {
    for (const model of MODEL_REGISTRY) {
      expect(model.inputUsdPerMillion, model.id).toBeGreaterThan(0);
      expect(model.outputUsdPerMillion, model.id).toBeGreaterThan(0);
      // Output is never cheaper than input on any real provider; an inverted
      // pair would make the cheapest-first ordering silently wrong.
      expect(model.outputUsdPerMillion, model.id).toBeGreaterThanOrEqual(model.inputUsdPerMillion);
    }
  });

  it('retires Flash and its batch variant without offering an unverified Argon model', () => {
    for (const id of ['google/gemini-3.8-flash', 'google/gemini-3.8-flash:batch']) {
      expect(AI_ALLOWED_MODELS).not.toContain(id);
      expect(PUBLIC_MODEL_CATALOG.some(model => model.id === id)).toBe(false);
      expect(isModelEnabled(id)).toBe(false);
      expect(normalizeModelSelectionId(id)).toBe('auto');
      expect(() => selectModel({ task: 'conversation', requestedModel: id, plan: 'enterprise' }))
        .toThrow('The selected model is not available.');
    }
    expect(AI_ALLOWED_MODELS.some(id => /argon|gemini-4/.test(id))).toBe(false);
  });

  it('uses OpenRouter long-context override pricing when the prompt crosses the provider threshold', () => {
    const astra = MODEL_REGISTRY.find(model => model.id === ASTRA_MODEL_ID)!;
    expect(getModelTokenPricing(astra, 271_999)).toMatchObject({ inputUsdPerMillion: 10, outputUsdPerMillion: 50 });
    expect(getModelTokenPricing(astra, 272_000)).toMatchObject({ inputUsdPerMillion: 20, outputUsdPerMillion: 75 });
    const kimi = MODEL_REGISTRY.find(model => model.id === 'moonshotai/kimi-k3')!;
    expect(kimi).toMatchObject({ inputUsdPerMillion: 3, outputUsdPerMillion: 15 });
  });

  it('never falls back to a model outside the catalogue', () => {
    for (const [from, chain] of Object.entries(AI_MODEL_FALLBACKS)) {
      expect(AUTHORISED, from).toContain(from);
      for (const to of chain) {
        expect(AUTHORISED, `${from} -> ${to}`).toContain(to);
        expect(to, 'a model must not fall back to itself').not.toBe(from);
      }
    }
  });

  it('offers the verified interactive Haiku 5.5 through OpenRouter with bounded pricing and capabilities', () => {
    const id = 'anthropic/claude-haiku-5.5';
    const haiku = MODEL_REGISTRY.find(model => model.id === id)!;
    expect(PUBLIC_MODEL_CATALOG.filter(model => model.id === id)).toHaveLength(1);
    expect(haiku).toMatchObject({ label: 'Haiku 5.5', provider: 'anthropic', routeProvider: 'openrouter', minPlan: 'free', tier: 'Economy', contextWindow: 1_000_000, maxOutputTokens: 128_000 });
    expect(haiku.capabilities).toMatchObject({ supportsStreaming: true, supportsVision: true, supportsFiles: true, supportsTools: true, supportsReasoningControl: true, supportsStructuredOutput: true, supportsAudio: false, supportsVideo: false });
    expect(isModelEnabled(id, {})).toBe(true);
    expect(normalizeModelSelectionId(id)).toBe(id);
    expect(MODEL_ACTION_CREDIT_FLOORS[id]).toBe(1);
    expect(getModelTokenPricing(haiku, 99_999)).toMatchObject({ inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 });
    expect(getModelTokenPricing(haiku, 100_000)).toMatchObject({ inputUsdPerMillion: 0.5, outputUsdPerMillion: 2.5 });
    expect(selectModel({ task: 'code_edit', requestedModel: id, plan: 'free', credits: 5 }).modelId).toBe(id);
  });

  it('keeps Sonnet 5.5 behind its flag, offered to Pro and above, and never as an Auto role', () => {
    const id = 'anthropic/claude-sonnet-5.5';
    expect(isFlaggedModel(id)).toBe(true);
    expect(isModelEnabled(id, {})).toBe(false);
    expect(isModelEnabled(id, { CODEN_MODEL_SONNET_5_5: '0' })).toBe(false);
    expect(isModelEnabled(id, { CODEN_MODEL_SONNET_5_5: '1' })).toBe(true);
    // Every other model is unaffected by the flag.
    expect(MODEL_REGISTRY.filter(model => isFlaggedModel(model.id)).map(model => model.id)).toEqual([id]);
    expect(isModelEnabled('anthropic/claude-sonnet-5', {})).toBe(true);
    const entry = MODEL_REGISTRY.find(model => model.id === id)!;
    expect(entry.minPlan).toBe('pro');
    expect(AUTO_MODEL_IDS).not.toContain(id);
    // The interactive slug only: the batch variant has its own id and is not an interactive model.
    expect(AI_ALLOWED_MODELS.filter(model => model.includes('sonnet-5.5'))).toEqual([id]);
  });
});
