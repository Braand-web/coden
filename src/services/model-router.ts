import { 
  AI_ALLOWED_MODELS, 
  AI_MODEL_PLAN_ACCESS, 
  AI_MODEL_CAPABILITIES, 
  AI_MODEL_TIERS, 
  DEFAULT_PROVIDER_MODEL_ID,
  MODEL_ACTION_CREDIT_FLOORS,
  UserPlan, 
  type AllowedModelId 
} from '../config/ai-models.ts';
import { 
  validateAllowedModel, 
  ModelNotAllowedForPlanError, 
} from './ai-validator.ts';

export interface RoutingContext {
  plan: UserPlan | 'free' | 'pro' | 'scale' | 'enterprise';
  mode: 'Auto' | 'Fast' | 'Balanced' | 'Pro' | 'Premium' | 'Max Quality' | 'Custom';
  userCredits: number;
  taskComplexity?: 'simple' | 'medium' | 'complex' | 'extreme';
  preferredModels?: AllowedModelId[];
  requiredCapabilities?: {
    vision?: boolean;
    tools?: boolean;
    structuredOutput?: boolean;
    longContext?: boolean;
    reasoning?: boolean;
    code?: boolean;
    agentic?: boolean;
    design?: boolean;
    security?: boolean;
  };
}

/** Hard-task signals that justify escalating to a frontier model. */
export interface EscalationSignals {
  /** A large or multi-file build was detected. */
  heavyBuild?: boolean;
  /** Consecutive auto-debug iterations that failed to produce a passing build. */
  autofixFailures?: number;
  /** The app type is known to be complex (e.g. crm_erp, fintech_billing, ai_tool). */
  complexAppType?: boolean;
}

export class ModelRouter {
  async selectModel(context: RoutingContext, requestedCustomModelId?: string): Promise<AllowedModelId> {
    // 1. Direct validation of custom model choice if in Custom mode
    if (context.mode === 'Custom' && requestedCustomModelId && requestedCustomModelId !== 'auto') {
      validateAllowedModel(requestedCustomModelId);
      
      const minPlan = AI_MODEL_PLAN_ACCESS[requestedCustomModelId as AllowedModelId];
      if (!this.isPlanSufficient(context.plan, minPlan)) {
        throw new ModelNotAllowedForPlanError(requestedCustomModelId, context.plan);
      }
      
      // Credit check threshold for custom selection
      if (context.userCredits < MODEL_ACTION_CREDIT_FLOORS[requestedCustomModelId as AllowedModelId]) {
        throw new Error('Action unavailable with current plan. Please use Auto or upgrade.');
      }

      return requestedCustomModelId as AllowedModelId;
    }

    // 2. Filter available models based on Plan access
    const planAccessibleModels = AI_ALLOWED_MODELS.filter(modelId => {
      const minPlan = AI_MODEL_PLAN_ACCESS[modelId];
      return this.isPlanSufficient(context.plan, minPlan);
    });

    // 3. Filter by required capabilities
    let capableModels = planAccessibleModels.filter(modelId => {
      const caps = AI_MODEL_CAPABILITIES[modelId];
      if (context.requiredCapabilities?.vision && !caps.supportsVision) return false;
      if (context.requiredCapabilities?.tools && !caps.supportsTools) return false;
      if (context.requiredCapabilities?.structuredOutput && !caps.supportsStructuredOutput) return false;
      if (context.requiredCapabilities?.longContext && !caps.supportsLongContext) return false;
      if (context.requiredCapabilities?.reasoning && caps.reasoningLevel === 'low') return false;
      if (context.requiredCapabilities?.code && caps.codeLevel === 'low') return false;
      if (context.requiredCapabilities?.agentic && caps.agenticLevel === 'low') return false;
      if (context.requiredCapabilities?.design && caps.designLevel === 'low') return false;
      if (context.requiredCapabilities?.security && caps.securityLevel === 'low') return false;
      return true;
    });

    if (capableModels.length === 0) {
      throw new Error('Aucun modèle autorisé ne possède toutes les capacités requises pour ce run.');
    }

    const affordableModels = capableModels
      .filter(modelId => MODEL_ACTION_CREDIT_FLOORS[modelId] <= context.userCredits)
      .sort((a, b) => MODEL_ACTION_CREDIT_FLOORS[a] - MODEL_ACTION_CREDIT_FLOORS[b]);

    if (affordableModels.length === 0) {
      throw new Error('Action unavailable with current plan. Please use Auto or upgrade.');
    }

    const firstAffordable = (preferred: AllowedModelId[]) => (
      preferred.find(modelId => affordableModels.includes(modelId)) || this.selectBestAutoModel(affordableModels, context)
    );

    // 4. Smart Router Mode Selection logic
    let selectedModel: AllowedModelId;
    const preferredModel = context.preferredModels?.find(modelId => affordableModels.includes(modelId));

    if (context.mode === 'Auto' && preferredModel) {
      selectedModel = preferredModel;
    } else {

      switch (context.mode) {
        case 'Fast':
          selectedModel = firstAffordable(['openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'deepseek/deepseek-v4-pro']);
          break;

        case 'Balanced':
          selectedModel = firstAffordable(['openai/gpt-5.6-terra', 'anthropic/claude-sonnet-5', 'deepseek/deepseek-v4-pro']);
          break;

        case 'Pro':
          selectedModel = firstAffordable(['anthropic/claude-sonnet-5', 'openai/gpt-5.6-terra', 'x-ai/grok-4.6']);
          break;

        case 'Premium':
        case 'Max Quality':
          selectedModel = firstAffordable(['openai/gpt-5.6-sol', 'anthropic/claude-opus-5', 'anthropic/claude-fable-5']);
          break;

        case 'Auto':
        default: {
          selectedModel = this.selectBestAutoModel(affordableModels, context);
          break;
        }
      }
    }

    // Double check compatibility filtering
    if (!capableModels.includes(selectedModel)) {
       selectedModel = capableModels.includes(DEFAULT_PROVIDER_MODEL_ID) 
        ? DEFAULT_PROVIDER_MODEL_ID 
        : capableModels[0] as AllowedModelId;
    }

    validateAllowedModel(selectedModel);

    return selectedModel;
  }

  private selectBestAutoModel(models: AllowedModelId[], context: RoutingContext): AllowedModelId {
    if (!models.length) return DEFAULT_PROVIDER_MODEL_ID;
    const complexity = context.taskComplexity || 'medium';
    if (!this.hasSpecificCapabilityNeeds(context)) {
      if (complexity === 'simple') {
        return this.firstAvailable(models, ['openai/gpt-5.6-luna', 'google/gemini-3.7-flash', 'deepseek/deepseek-v4-pro']);
      }
      if (complexity === 'complex') {
        return this.firstAvailable(models, ['anthropic/claude-sonnet-5', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-sol', 'deepseek/deepseek-v4-pro']);
      }
      if (complexity === 'extreme') {
        return this.firstAvailable(models, ['openai/gpt-5.6-sol', 'anthropic/claude-opus-5', 'anthropic/claude-fable-5', 'anthropic/claude-sonnet-5']);
      }
      return this.firstAvailable(models, ['openai/gpt-5.6-terra', 'anthropic/claude-sonnet-5', 'openai/gpt-5.6-luna', 'deepseek/deepseek-v4-pro']);
    }
    const scored = models.map(modelId => ({
      modelId,
      score: this.scoreModel(modelId, context, complexity),
    })).sort((a, b) => b.score - a.score);
    return scored[0]?.modelId || models[0];
  }

  private firstAvailable(models: AllowedModelId[], preferred: AllowedModelId[]) {
    return preferred.find(modelId => models.includes(modelId)) || models[0];
  }

  private hasSpecificCapabilityNeeds(context: RoutingContext) {
    const required = context.requiredCapabilities || {};
    return Object.values(required).some(Boolean);
  }

  private scoreModel(modelId: AllowedModelId, context: RoutingContext, complexity: RoutingContext['taskComplexity']) {
    const caps = AI_MODEL_CAPABILITIES[modelId];
    const creditCost = MODEL_ACTION_CREDIT_FLOORS[modelId] || 1;
    let score = 0;

    score += this.strengthScore(caps.reasoningLevel) * (context.requiredCapabilities?.reasoning ? 3 : complexity === 'simple' ? 0.6 : 1.4);
    score += this.strengthScore(caps.codeLevel) * (context.requiredCapabilities?.code ? 3 : complexity === 'simple' ? 0.6 : 1.6);
    score += this.strengthScore(caps.agenticLevel) * (context.requiredCapabilities?.agentic ? 2.6 : complexity === 'extreme' ? 1.7 : 0.9);
    score += this.strengthScore(caps.designLevel) * (context.requiredCapabilities?.design ? 2.2 : 0.7);
    score += this.strengthScore(caps.securityLevel) * (context.requiredCapabilities?.security ? 2.2 : 0.6);

    if (context.requiredCapabilities?.vision && caps.supportsVision) score += 14;
    if (context.requiredCapabilities?.tools && caps.supportsToolCalling) score += 10;
    if (context.requiredCapabilities?.structuredOutput && caps.supportsStructuredOutput) score += 8;
    if (context.requiredCapabilities?.longContext && caps.supportsLongContext) score += 8;

    if (complexity === 'simple') {
      score += caps.speed === 'fast' ? 12 : caps.speed === 'balanced' ? 6 : 0;
      score -= creditCost * 1.4;
    } else if (complexity === 'extreme') {
      score += caps.reasoningLevel === 'frontier' ? 18 : caps.reasoningLevel === 'high' ? 10 : 0;
      score += caps.codeLevel === 'frontier' ? 14 : caps.codeLevel === 'high' ? 9 : 0;
      score -= creditCost * 0.15;
    } else if (complexity === 'complex') {
      score += caps.codeLevel === 'frontier' ? 10 : caps.codeLevel === 'high' ? 8 : 0;
      score += caps.reasoningLevel === 'frontier' ? 8 : caps.reasoningLevel === 'high' ? 6 : 0;
      score -= creditCost * 0.35;
    } else {
      score += caps.speed === 'fast' ? 5 : 2;
      score += caps.reliability === 'high' ? 4 : caps.reliability === 'standard' ? 2 : 0;
      score -= creditCost * 0.7;
    }

    if (caps.reliability === 'experimental') score -= complexity === 'simple' ? 2 : 0.5;
    if (context.userCredits < creditCost * 4) score -= creditCost;
    return score;
  }

  private strengthScore(value: string) {
    if (value === 'frontier') return 10;
    if (value === 'high') return 7;
    if (value === 'medium') return 4;
    return 1;
  }

  private isPlanSufficient(userPlan: string, requiredPlan: string): boolean {
    const tierValue = (p: string) => {
      const lower = p.toLowerCase();
      if (lower === 'enterprise') return 3;
      if (lower === 'scale') return 2;
      if (lower === 'pro') return 1;
      return 0;
    };

    return tierValue(userPlan) >= tierValue(requiredPlan);
  }

  /**
   * Selective frontier escalation. The default routing for small/normal actions
   * is untouched: this only bumps the effective task complexity (and nudges
   * code/reasoning needs) when a hard signal is present — a heavy build, repeated
   * auto-debug failures, or a known-complex app type. Plan access and credit/cost
   * floors are still enforced by selectModel, so escalation can never pick a model
   * the plan or balance cannot afford (it falls back); the monthly AI/Cloud
   * exposure cap stays enforced upstream in the generation gate.
   */
  shouldEscalateToFrontier(signals: EscalationSignals): boolean {
    return Boolean(signals.heavyBuild)
      || (signals.autofixFailures ?? 0) >= 2
      || Boolean(signals.complexAppType);
  }

  async selectModelEscalated(
    context: RoutingContext,
    signals: EscalationSignals,
    requestedCustomModelId?: string,
  ): Promise<AllowedModelId> {
    // Respect explicit custom choices and skip escalation when no hard signal.
    if (context.mode === 'Custom' || !this.shouldEscalateToFrontier(signals)) {
      return this.selectModel(context, requestedCustomModelId);
    }
    const escalated: RoutingContext = {
      ...context,
      taskComplexity: 'extreme',
      requiredCapabilities: { ...context.requiredCapabilities, code: true, reasoning: true },
    };
    return this.selectModel(escalated, requestedCustomModelId);
  }

  /**
   * Selects the best model to act as LLM-as-judge (second-opinion quality reviewer).
   * The judge should be a different model from the generator, reasoning-capable,
   * fast enough to not add major latency, and affordable enough for all plans.
   *
   * Logic:
   * - Prefers a reasoning-capable Balanced model (Claude Sonnet / GPT-5 / Gemini Pro)
   * - Never picks the same model as the primary generator
   * - Falls back to the default model if no better option is available
   */
  selectJudgeModel(generatorModelId: string, userCredits: number, plan: string): AllowedModelId {
    // Ordered preference: good reasoning, mid-tier cost, different from generator
    const judgePreferences: AllowedModelId[] = [
      'anthropic/claude-sonnet-5',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-terra',
      'deepseek/deepseek-v4-pro',
      'x-ai/grok-4.6',
      'google/gemini-3.7-flash',
      'openai/gpt-5.6-luna',
    ];

    const planAccessibleModels = AI_ALLOWED_MODELS.filter(modelId => {
      const minPlan = AI_MODEL_PLAN_ACCESS[modelId];
      return this.isPlanSufficient(plan, minPlan);
    });

    for (const candidate of judgePreferences) {
      if (
        candidate !== generatorModelId &&
        planAccessibleModels.includes(candidate) &&
        MODEL_ACTION_CREDIT_FLOORS[candidate] <= userCredits
      ) {
        return candidate;
      }
    }

    // Last resort: any different affordable model
    const fallback = planAccessibleModels.find(m =>
      m !== generatorModelId && MODEL_ACTION_CREDIT_FLOORS[m] <= userCredits
    );
    return (fallback as AllowedModelId) || DEFAULT_PROVIDER_MODEL_ID;
  }
}
