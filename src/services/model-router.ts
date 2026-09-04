import { 
  AI_ALLOWED_MODELS, 
  AUTO_MODEL_IDS,
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
import { MODELS_BY_COST, selectModel, type SelectionResult, type TaskComplexity, type TaskKind } from './model-selection.ts';

export interface RoutingContext {
  plan: UserPlan | 'free' | 'pro' | 'scale' | 'enterprise';
  mode: 'Auto' | 'Fast' | 'Balanced' | 'Pro' | 'Premium' | 'Max Quality' | 'Custom';
  userCredits: number;
  taskComplexity?: TaskComplexity;
  /** What the caller is actually asking for. Drives the competence bar. */
  task?: TaskKind;
  /** Someone is waiting on this answer, so deferred tiers are excluded. */
  interactive?: boolean;
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

    // 4. One selection policy, applied here.
    //
    // This used to be five hardcoded preference lists plus a scoring function,
    // each free to disagree with the others about the same request. They are
    // gone: `selectModel` walks the catalogue cheapest-first and returns the
    // first model good enough for the task, so a mode is now nothing more than
    // a floor on complexity.
    let selectedModel: AllowedModelId;
    const preferredModel = context.preferredModels?.find(modelId => affordableModels.includes(modelId) && (AUTO_MODEL_IDS as readonly string[]).includes(modelId));

    if (context.mode === 'Custom' || (context.mode === 'Auto' && preferredModel)) {
      selectedModel = preferredModel || DEFAULT_PROVIDER_MODEL_ID;
    } else {
      const decision = selectModel({
        task: context.task || inferTaskFromCapabilities(context),
        complexity: complexityForMode(context.mode, context.taskComplexity),
        plan: context.plan,
        credits: context.userCredits,
        interactive: context.interactive,
        needs: {
          vision: context.requiredCapabilities?.vision,
          tools: context.requiredCapabilities?.tools,
          structuredOutput: context.requiredCapabilities?.structuredOutput,
          longContext: context.requiredCapabilities?.longContext,
        },
      });
      this.lastDecision = decision;
      selectedModel = decision.modelId;
    }

    // Double check compatibility filtering
    if (!capableModels.includes(selectedModel)) {
       throw new Error('MODEL_CAPABILITY_UNAVAILABLE: selected model does not meet every required capability.');
    }

    validateAllowedModel(selectedModel);

    return selectedModel;
  }

  /** The reasoning behind the most recent Auto choice, for logs and events. */
  lastDecision: SelectionResult | null = null;

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
    // The judge is a `review` task, so it goes through the same selector as
    // everything else — a second hardcoded preference list here is how the
    // policy drifted apart in the first place. The only extra constraint is
    // independence: a model reviewing its own output is not a second opinion,
    // so the generator is excluded and the next cheapest qualified model wins.
    const decision = selectModel({ task: 'review', plan, credits: userCredits });
    if (decision.modelId !== generatorModelId) return decision.modelId;

    const alternatives = MODELS_BY_COST.filter(modelId => (
      modelId !== generatorModelId
      && this.isPlanSufficient(plan, AI_MODEL_PLAN_ACCESS[modelId])
      && MODEL_ACTION_CREDIT_FLOORS[modelId] <= userCredits
      && AI_MODEL_CAPABILITIES[modelId].reasoningLevel !== 'low'
    ));
    return alternatives[0] || DEFAULT_PROVIDER_MODEL_ID;
  }
}


/**
 * A mode is a floor on complexity, not a model list.
 *
 * 'Fast' asks for the simplest treatment the task allows and 'Max Quality' for
 * the most thorough; the selector still picks the cheapest model that clears
 * the resulting bar, so a mode can never name a model.
 */
function complexityForMode(mode: RoutingContext['mode'], declared?: TaskComplexity): TaskComplexity {
  const order: TaskComplexity[] = ['simple', 'medium', 'complex', 'extreme'];
  const base = order.indexOf(declared || 'medium');
  const floor = mode === 'Fast' ? 0
    : mode === 'Balanced' ? 1
    : mode === 'Pro' ? 2
    : mode === 'Premium' || mode === 'Max Quality' ? 3
    : base;
  return order[Math.max(base >= 0 ? base : 1, floor)] || 'medium';
}

/** Infer the task when a caller only stated the capabilities it needs. */
function inferTaskFromCapabilities(context: RoutingContext): TaskKind {
  const needs = context.requiredCapabilities || {};
  if (needs.security) return 'security';
  if (needs.design) return 'design';
  if (needs.code) return 'code_generation';
  if (needs.agentic) return 'research';
  if (needs.reasoning) return 'planning';
  return 'conversation';
}
