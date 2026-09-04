import { describe, expect, it } from 'vitest';
import { AI_ALLOWED_MODELS, AI_MODEL_FALLBACKS, MODEL_REGISTRY, AUTO_MODEL_IDS, UNAVAILABLE_MODEL_ROLES } from './ai-models';

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
  'google/gemini-3.8-flash', 'anthropic/claude-fable-5.1',
  'google/gemini-3.8-flash:batch',
  'anthropic/claude-fable-5.1:batch',
  'anthropic/claude-opus-5',
  'anthropic/claude-sonnet-5',
  'openai/gpt-5.6-sol-pro',
  'openai/gpt-5.6-terra-pro',
  'openai/gpt-5.6-luna-pro',
  'moonshotai/kimi-k3',
  'x-ai/grok-4.6',
];

describe('Coden production model registry', () => {
  it('preserves historical model IDs and adds only the verified interactive models', () => {
    expect([...AI_ALLOWED_MODELS].sort()).toEqual([...AUTHORISED].sort());
    expect(MODEL_REGISTRY).toHaveLength(14);
    expect(new Set(AI_ALLOWED_MODELS).size).toBe(AI_ALLOWED_MODELS.length);
  });
  it('limits Auto to the seven available roles, excluding deferred tiers and Astra', () => {
    expect([...AUTO_MODEL_IDS].sort()).toEqual(['openai/gpt-5.6-luna','openai/gpt-5.6-terra','openai/gpt-5.6-sol','google/gemini-3.8-flash','x-ai/grok-4.6','anthropic/claude-opus-5','anthropic/claude-fable-5.1'].sort());
    expect(UNAVAILABLE_MODEL_ROLES.ultimate.reason).toBe('not_in_openrouter_catalog');
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

  it('never falls back to a model outside the catalogue', () => {
    for (const [from, chain] of Object.entries(AI_MODEL_FALLBACKS)) {
      expect(AUTHORISED, from).toContain(from);
      for (const to of chain) {
        expect(AUTHORISED, `${from} -> ${to}`).toContain(to);
        expect(to, 'a model must not fall back to itself').not.toBe(from);
      }
    }
  });
});
