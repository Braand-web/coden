import { describe, expect, it } from 'vitest';
import { AI_ALLOWED_MODELS, MODEL_REGISTRY } from './ai-models';

describe('Coden production model registry', () => {
  it('contains the eleven role-based models without fictitious local aliases', () => {
    expect(MODEL_REGISTRY).toHaveLength(11);
    expect(AI_ALLOWED_MODELS).toContain('deepseek/deepseek-v4-pro-0813');
    expect(AI_ALLOWED_MODELS).toContain('qwen/qwen3.8-27b');
    expect(AI_ALLOWED_MODELS).toContain('z-ai/glm-5.3');
    expect(new Set(AI_ALLOWED_MODELS).size).toBe(AI_ALLOWED_MODELS.length);
  });
});
