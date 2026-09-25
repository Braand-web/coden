/**
 * The one place a model is chosen.
 *
 * Selection used to live in five hardcoded preference lists inside the router
 * plus a weighted scoring function, all answering the same question and free to
 * disagree — and they did: 'Balanced' preferred a model that the Auto path of
 * the same complexity ranked fourth. Changing policy meant finding every list.
 *
 * Prefer the specialist assigned to the task when eligible, then consider the
 * remaining Auto catalogue in cost order. Every candidate must satisfy the
 * capability, context, plan and budget gates. Historical manual selections
 * do not enlarge the Auto pool.
 *
 * Cost comes from the catalogue's real per-million prices. Competence comes
 * from a bar per task and complexity. Both are data; this file is the policy
 * that reads them, and it is the only such file.
 */

import {
  AI_MODEL_CAPABILITIES,
  AUTO_MODEL_IDS,
  AUTO_MODEL_ROLES,
  AI_MODEL_PLAN_ACCESS,
  DEFAULT_PROVIDER_MODEL_ID,
  MODEL_ACTION_CREDIT_FLOORS,
  MODEL_REGISTRY,
  PUBLIC_MODEL_CATALOG,
  UserPlan,
  normalizeUserPlan,
  type AllowedModelId,
  type ModelStrength,
} from '../config/ai-models.ts';
import { modelAvailability } from './openrouter-capabilities.ts';
import { getLearnedModelStats, learnedPreference } from './agent-learning.ts';
import type { ReasoningLevel } from './openrouter-request.ts';

/** What the platform actually asks a model to do. */
export type TaskKind =
  | 'classification'      // intent routing, labelling, yes/no judgements
  | 'conversation'        // chat replies, clarifying questions
  | 'summary'             // recaps, release notes, commit messages
  | 'planning'            // turning a request into an ordered plan
  | 'code_generation'     // writing or rewriting application files
  | 'code_edit'           // a small, local change to existing files
  | 'debug'               // reading an error and repairing the cause
  | 'review'              // judging someone else's output
  | 'architecture'        // system shape, migrations, data modelling
  | 'security'            // finding exploitable defects
  | 'design'              // interface and visual composition
  | 'research';           // gathering external information

export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'extreme';

export type CapabilityNeeds = {
  vision?: boolean;
  tools?: boolean;
  structuredOutput?: boolean;
  longContext?: boolean;
  audio?: boolean;
  video?: boolean;
};

export type SelectionRequest = {
  task: TaskKind;
  complexity?: TaskComplexity;
  plan?: UserPlan | string;
  /** Credits the user actually has. Omitted means the gate does not apply. */
  credits?: number;
  needs?: CapabilityNeeds;
  /** Latency matters here; deferred `:batch` tiers are excluded. */
  interactive?: boolean;
  /** Estimated prompt size, to rule out models that cannot hold it. */
  estimatedInputTokens?: number;
  /** Explicit selection remains pinned, but never bypasses access or capabilities. */
  requestedModel?: string;
  /**
   * Whether a model below the preferred strength may be returned.
   *
   * Default. Refusing a turn because the *best* model is out of reach trades a
   * weaker answer for no answer, and that trade emptied the product for five
   * days: every `code_generation` at `complex` needs a frontier model, every
   * frontier model needs a paid plan, and every organization was on `free`.
   *
   * Escalation is the one caller that must set this false. It does not ask
   * "what can I use?" but "what is stronger than the model that just failed?",
   * and a `false` that quietly answers with the same model is a retry loop the
   * caller cannot tell apart from progress — spending money to fail the same
   * way twice.
   */
  allowDegradation?: boolean;
};

export type SelectionResult = {
  modelId: AllowedModelId;
  /** Why this one — the cheaper models and the reason each was rejected. */
  reason: string;
  rejected: Array<{ modelId: AllowedModelId; because: string }>;
  estimatedUsdPerMillionBlended: number;
  /**
   * The reasoning level Auto chose with the model. A pinned model keeps the
   * user's level; callers ignore this field then.
   */
  reasoningLevel: ReasoningLevel;
};

const STRENGTH_ORDER: Record<ModelStrength, number> = { low: 0, medium: 1, high: 2, frontier: 3 };

/**
 * The competence bar per task.
 *
 * `dimension` is the capability that actually decides the outcome for that kind
 * of work; `floor` is the least strength that does the job acceptably at medium
 * complexity. Complexity raises the floor from there.
 *
 * The floors are deliberately low. A bar set at `frontier` for everything would
 * be a router that always picks the most expensive model, which is the
 * behaviour this replaces.
 */
const TASK_BAR: Record<TaskKind, { dimension: keyof typeof DIMENSIONS; floor: ModelStrength }> = {
  classification: { dimension: 'reasoning', floor: 'low' },
  conversation: { dimension: 'reasoning', floor: 'medium' },
  summary: { dimension: 'reasoning', floor: 'low' },
  planning: { dimension: 'reasoning', floor: 'medium' },
  code_generation: { dimension: 'code', floor: 'high' },
  code_edit: { dimension: 'code', floor: 'medium' },
  debug: { dimension: 'code', floor: 'high' },
  review: { dimension: 'reasoning', floor: 'high' },
  architecture: { dimension: 'reasoning', floor: 'frontier' },
  security: { dimension: 'security', floor: 'high' },
  design: { dimension: 'design', floor: 'high' },
  research: { dimension: 'agentic', floor: 'high' },
};

const DIMENSIONS = {
  reasoning: 'reasoningLevel',
  code: 'codeLevel',
  agentic: 'agenticLevel',
  design: 'designLevel',
  security: 'securityLevel',
} as const;

/** Complexity moves the bar; it never selects a model by itself. */
const COMPLEXITY_SHIFT: Record<TaskComplexity, number> = { simple: -1, medium: 0, complex: 1, extreme: 2 };

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 };

/** Blended price, weighting output more heavily because generations are output-heavy. */
export function blendedCost(modelId: AllowedModelId): number {
  const model = MODEL_REGISTRY.find(entry => entry.id === modelId);
  if (!model) return Number.POSITIVE_INFINITY;
  return model.inputUsdPerMillion * 0.25 + model.outputUsdPerMillion * 0.75;
}

/** The catalogue, cheapest first. The order the selector walks. */
export const MODELS_BY_COST: AllowedModelId[] = MODEL_REGISTRY
  .map(model => model.id as AllowedModelId)
  .sort((a, b) => blendedCost(a) - blendedCost(b));

function isDeferredTier(modelId: AllowedModelId): boolean {
  return modelId.endsWith(':batch');
}

/**
 * Tasks where somebody is waiting on the answer.
 *
 * A deferred tier answers minutes later. That is fine for a background job and
 * wrong for a chat reply, and relying on every caller to remember the flag
 * means it gets forgotten — a chat request that omits it would be routed to a
 * batch model and appear to hang. The property belongs to the task, so it is
 * declared here once.
 */
const INHERENTLY_INTERACTIVE: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'conversation',
  'code_edit',
]);

function planAllows(userPlan: string, modelId: AllowedModelId): boolean {
  const required = AI_MODEL_PLAN_ACCESS[modelId];
  return (PLAN_RANK[normalizeUserPlan(userPlan)] ?? 0) >= (PLAN_RANK[normalizeUserPlan(required)] ?? 0);
}

/**
 * Choose a model, and be able to say why.
 *
 * Walks the catalogue cheapest-first and returns the first model that clears
 * every gate. The rejections are carried out with the result: a routing
 * decision nobody can explain is a routing decision nobody can correct.
 */
export function selectModel(request: SelectionRequest): SelectionResult {
  const complexity = request.complexity || 'medium';
  const plan = String(request.plan || UserPlan.FREE).toLowerCase();
  const bar = TASK_BAR[request.task];
  const requiredStrength = Math.max(0, Math.min(3, STRENGTH_ORDER[bar.floor] + COMPLEXITY_SHIFT[complexity]));
  const dimensionKey = DIMENSIONS[bar.dimension];
  const rejected: SelectionResult['rejected'] = [];

  const preferred = request.needs?.vision ? AUTO_MODEL_ROLES.visual
    : ['classification','conversation','summary'].includes(request.task) ? AUTO_MODEL_ROLES.router
    : ['planning','architecture','security'].includes(request.task) ? AUTO_MODEL_ROLES.lead
    : request.task === 'review' ? AUTO_MODEL_ROLES.premium
    : complexity === 'simple' ? AUTO_MODEL_ROLES.worker : AUTO_MODEL_ROLES.lead;
  if (request.requestedModel && !MODELS_BY_COST.includes(request.requestedModel as AllowedModelId)) {
    throw Object.assign(new Error('The selected model is not available.'), { diagnosticCode: 'MODEL_CAPABILITY_UNAVAILABLE' });
  }
  const reasoningLevel = autoReasoningLevel(request.task, complexity);
  /*
   * Auto chooses from the whole validated catalogue, not five fixed roles.
   *
   * Simple and medium work walks it cheapest-first behind the role model — the
   * fastest model that clears the bar wins. Complex and extreme work walks it
   * strongest-first: the point of Auto on a hard task is the best answer the
   * user's plan and credits allow, and a cheap model that scrapes the bar is
   * exactly what makes hard tasks fail. The decision is local and synchronous:
   * no model is asked which model to use.
   */
  const pool = AUTO_POOL.filter(id => {
    if (modelAvailability(id, MODEL_REGISTRY.find(entry => entry.id === id)).available) return true;
    rejected.push({ modelId: id, because: 'absent from the OpenRouter catalogue' });
    return false;
  });
  const strongestFirst = complexity === 'complex' || complexity === 'extreme';
  // Complex: the strongest tier on the dimension that decides the task — the
  // role model when it is in that tier, else the best value in it. Extreme:
  // the strongest model outright.
  const ordered = strongestFirst
    ? [...pool].sort((a, b) => complexity === 'extreme'
      ? strengthScore(b, dimensionKey) - strengthScore(a, dimensionKey) || blendedCost(b) - blendedCost(a)
      : STRENGTH_ORDER[AI_MODEL_CAPABILITIES[b][dimensionKey]] - STRENGTH_ORDER[AI_MODEL_CAPABILITIES[a][dimensionKey]]
        || Number(b === preferred) - Number(a === preferred)
        || blendedCost(a) - blendedCost(b))
    : [preferred, ...pool.filter(id => id !== preferred)].filter(id => pool.includes(id));
  const candidates = request.requestedModel ? [request.requestedModel as AllowedModelId] : ordered;
  const gate = (modelId: AllowedModelId): string | null => {
    const caps = AI_MODEL_CAPABILITIES[modelId];
    if (!planAllows(plan, modelId)) return `requires the ${AI_MODEL_PLAN_ACCESS[modelId]} plan`;
    if (typeof request.credits === 'number' && request.credits < MODEL_ACTION_CREDIT_FLOORS[modelId]) return `costs ${MODEL_ACTION_CREDIT_FLOORS[modelId]} credits, ${request.credits} available`;
    // A deferred tier answers minutes later. That is fine for a background
    // job and unacceptable for someone watching a cursor blink.
    if ((request.interactive || INHERENTLY_INTERACTIVE.has(request.task)) && isDeferredTier(modelId)) return 'deferred execution tier, not usable interactively';
    if (!request.requestedModel && STRENGTH_ORDER[caps[dimensionKey]] < requiredStrength) return `${bar.dimension} is ${caps[dimensionKey]}, ${request.task} at ${complexity} needs at least ${strengthName(requiredStrength)}`;
    if (request.needs?.vision && !caps.supportsVision) return 'no vision support';
    if (request.needs?.audio && !caps.supportsAudio) return 'no audio support';
    if (request.needs?.video && !caps.supportsVideo) return 'no video support';
    if (request.needs?.tools && !caps.supportsToolCalling) return 'no tool calling';
    if (request.needs?.longContext && !caps.supportsLongContext) return 'no long context support';
    if (request.needs?.structuredOutput && !caps.supportsStructuredOutput) return 'no structured output';
    if (request.estimatedInputTokens && request.estimatedInputTokens > caps.maxContextTokens) return `context window ${caps.maxContextTokens} is smaller than the ${request.estimatedInputTokens} tokens required`;
    return null;
  };
  /*
   * The first model to clear every gate is the default. Its next few eligible
   * neighbours in the same order are collected too, so measured success rates
   * (agent-learning.ts) can prefer one of them when the evidence is clear. An
   * explicitly requested model is never second-guessed.
   */
  const eligible: AllowedModelId[] = [];
  for (const modelId of candidates) {
    const because = gate(modelId);
    if (because) {
      if (!eligible.length) rejected.push({ modelId, because });
      continue;
    }
    eligible.push(modelId);
    if (request.requestedModel || eligible.length >= 4) break;
  }
  if (eligible.length) {
    const learned = request.requestedModel ? null : learnedPreference(eligible, request.task, getLearnedModelStats());
    const modelId = (learned?.modelId || eligible[0]) as AllowedModelId;
    const caps = AI_MODEL_CAPABILITIES[modelId];
    return {
      modelId,
      reason: learned?.learned
        ? `measured to succeed more often on ${request.task} than ${eligible[0]} (Coden run history)`
        : strongestFirst
          ? `strongest eligible model for ${request.task}/${complexity} (${bar.dimension} ${caps[dimensionKey]})`
          : `fastest model clearing ${request.task}/${complexity} (${bar.dimension} ≥ ${strengthName(requiredStrength)})`,
      rejected,
      estimatedUsdPerMillionBlended: Number(blendedCost(modelId).toFixed(3)),
      reasoningLevel: affordableReasoning(reasoningLevel, modelId, request.credits),
    };
  }

  /*
   * The strength bar is a preference. The capability gates are not.
   *
   * Everything above this line is objective — the plan grants access or it
   * does not, the model calls tools or it does not, the context fits or it
   * does not. The strength bar is different: it says which model would be
   * *best*, and refusing the turn because the best one is out of reach trades
   * a weaker answer for no answer at all.
   *
   * That trade emptied the product. `code_generation` at `complex` demands a
   * frontier model, every frontier model needs a paid plan, and every
   * organization on this deployment is on `free` — so the throw below fired on
   * every generation for five days, and not one project created in that window
   * has a file in it.
   *
   * So the fallback that already existed for design and research now covers
   * every task: keep every objective gate, relax only the preference, take the
   * strongest model that remains, and say so in `reason` so the degradation is
   * on the record rather than silent.
   *
   * `security` stays fail-closed, and it is the one task where that is right:
   * a weaker model returning "nothing found" reads exactly like a real audit
   * that found nothing, and a false all-clear is worse than an honest refusal.
   * Nowhere else does a weaker answer masquerade as a stronger one — the user
   * can see an application and judge it.
   */
  if (request.task !== 'security' && request.allowDegradation !== false) {
    const fallback = candidates
      .filter((modelId) => {
        const caps = AI_MODEL_CAPABILITIES[modelId];
        if (!planAllows(plan, modelId)) return false;
        if (typeof request.credits === 'number' && request.credits < MODEL_ACTION_CREDIT_FLOORS[modelId]) return false;
        if ((request.interactive || INHERENTLY_INTERACTIVE.has(request.task)) && isDeferredTier(modelId)) return false;
        if (request.needs?.vision && !caps.supportsVision) return false;
        if (request.needs?.audio && !caps.supportsAudio) return false;
        if (request.needs?.video && !caps.supportsVideo) return false;
        if (request.needs?.tools && !caps.supportsToolCalling) return false;
        if (request.needs?.longContext && !caps.supportsLongContext) return false;
        if (request.needs?.structuredOutput && !caps.supportsStructuredOutput) return false;
        return !request.estimatedInputTokens || request.estimatedInputTokens <= caps.maxContextTokens;
      })
      .sort((a, b) => STRENGTH_ORDER[AI_MODEL_CAPABILITIES[b][dimensionKey]] - STRENGTH_ORDER[AI_MODEL_CAPABILITIES[a][dimensionKey]])[0];

    if (fallback) {
      return {
        modelId: fallback,
        reason: `best accessible model for ${request.task}/${complexity}; preferred ${bar.dimension} strength is unavailable on this plan`,
        rejected,
        estimatedUsdPerMillionBlended: Number(blendedCost(fallback).toFixed(3)),
        // A weaker model than the task deserves: let it think as hard as it can afford.
        reasoningLevel: affordableReasoning(reasoningLevel === 'max' ? 'max' : 'high', fallback, request.credits),
      };
    }
  }

  // No eligible candidate: surface the constraint instead of silently using
  // a model that lacks a required capability or exceeds the user's access.
  throw Object.assign(new Error(`No eligible model satisfies ${request.task}/${complexity}.`), { diagnosticCode:'MODEL_CAPABILITY_UNAVAILABLE', rejected });
}

/**
 * The models Auto may choose: the public catalogue (one entry per model, no
 * deferred `:batch` duplicates), plus the role models it was built around.
 */
const AUTO_POOL: AllowedModelId[] = [...new Set([
  ...(AUTO_MODEL_IDS as readonly AllowedModelId[]),
  ...PUBLIC_MODEL_CATALOG.map(model => model.id as AllowedModelId).filter(id => !isDeferredTier(id)),
// Fable is opt-in by contract (enterprise-only, highest cost): a user picks it,
// Auto never spends it on their behalf.
])].filter(id => !id.includes('fable'));

function strengthScore(modelId: AllowedModelId, dimensionKey: (typeof DIMENSIONS)[keyof typeof DIMENSIONS]): number {
  const caps = AI_MODEL_CAPABILITIES[modelId];
  // The deciding dimension first; the others break ties between equals.
  const others = Object.values(DIMENSIONS).reduce((sum, key) => sum + STRENGTH_ORDER[caps[key]], 0);
  return STRENGTH_ORDER[caps[dimensionKey]] * 100 + others;
}

/**
 * How hard Auto lets the model think.
 *
 * Routing and recaps are answered fastest with little reasoning; the harder
 * the task, the more the answer depends on it.
 */
export function autoReasoningLevel(task: TaskKind, complexity: TaskComplexity): ReasoningLevel {
  if (task === 'classification' || task === 'summary') return 'low';
  if (task === 'security' || task === 'architecture') return complexity === 'extreme' || complexity === 'complex' ? 'max' : 'high';
  return ({ simple: 'low', medium: 'medium', complex: 'high', extreme: 'max' } as const)[complexity];
}

/**
 * Maximum reasoning is billed at the output rate and can run to the model's
 * whole output window. With too few credits to cover that, Auto thinks at
 * `high` instead of starting a run it would have to stop.
 */
export function affordableReasoning(level: ReasoningLevel, modelId: AllowedModelId, credits?: number): ReasoningLevel {
  if (level !== 'max' || typeof credits !== 'number') return level;
  return credits >= MODEL_ACTION_CREDIT_FLOORS[modelId] * 4 ? 'max' : 'high';
}

function strengthName(rank: number): ModelStrength {
  return (Object.keys(STRENGTH_ORDER) as ModelStrength[]).find(key => STRENGTH_ORDER[key] === rank) || 'low';
}

/**
 * The task a named agent performs.
 *
 * Agents name themselves; this maps those names onto the twelve task kinds so
 * a new agent inherits a sensible bar instead of hardcoding a model.
 */
export const AGENT_TASK: Record<string, TaskKind> = {
  router: 'classification',
  intent: 'classification',
  conversation: 'conversation',
  clarifier: 'conversation',
  planner: 'planning',
  architect: 'architecture',
  generator: 'code_generation',
  builder: 'code_generation',
  editor: 'code_edit',
  fixer: 'debug',
  autofix: 'debug',
  repair: 'debug',
  reviewer: 'review',
  auditor: 'review',
  security: 'security',
  designer: 'design',
  researcher: 'research',
  summarizer: 'summary',
};

/** Select for a named agent, falling back to a conversation-grade bar. */
export function selectModelForAgent(agent: string, request: Omit<SelectionRequest, 'task'>): SelectionResult {
  return selectModel({ ...request, task: AGENT_TASK[agent] || 'conversation' });
}
