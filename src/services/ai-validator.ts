import { AI_ALLOWED_MODELS, type AllowedModelId } from '../config/ai-models.ts';

export class ForbiddenModelError extends Error {
  constructor(modelId: string) {
    super(`Model is not authorized in whitelist: ${modelId}`);
    this.name = 'ForbiddenModelError';
  }
}

export class ModelUnavailableError extends Error {
  constructor(modelId: string) {
    super(`Model is currently unavailable: ${modelId}`);
    this.name = 'ModelUnavailableError';
  }
}

export class ModelNotAllowedForPlanError extends Error {
  constructor(modelId: string, plan: string) {
    super(`Model ${modelId} is not available for your current plan: ${plan}`);
    this.name = 'ModelNotAllowedForPlanError';
  }
}

export class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits to perform this AI request.');
    this.name = 'InsufficientCreditsError';
  }
}

export class NegativeMarginBlockedError extends Error {
  constructor(modelId: string) {
    super(`Request blocked due to negative margin on model: ${modelId}`);
    this.name = 'NegativeMarginBlockedError';
  }
}

export function validateAllowedModel(modelId: string): asserts modelId is AllowedModelId {
  if (!(AI_ALLOWED_MODELS as readonly string[]).includes(modelId)) {
    console.error(`[SECURITY AUDIT] Attempted access to unauthorized model: ${modelId}`);
    throw new ForbiddenModelError(modelId);
  }
}
