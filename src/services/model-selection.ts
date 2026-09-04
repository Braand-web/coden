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
  UserPlan,
  type AllowedModelId,
  type ModelStrength,
} from '../config/ai-models.ts';

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
};

export type SelectionResult = {
  modelId: AllowedModelId;
  /** Why this one — the cheaper models and the reason each was rejected. */
  reason: string;
  rejected: Array<{ modelId: AllowedModelId; because: string }>;
  estimatedUsdPerMillionBlended: number;
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

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, scale: 2, enterprise: 3 };

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
  return (PLAN_RANK[String(userPlan).toLowerCase()] ?? 0) >= (PLAN_RANK[required] ?? 0);
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
    : request.task === 'review' ? AUTO_MODEL_ROLES.senior
    : complexity === 'simple' ? AUTO_MODEL_ROLES.worker : AUTO_MODEL_ROLES.builder;
  const candidates = [preferred, ...MODELS_BY_COST.filter(id => (AUTO_MODEL_IDS as readonly string[]).includes(id) && id !== preferred)];
  for (const modelId of candidates) {
    const caps = AI_MODEL_CAPABILITIES[modelId];

    if (!planAllows(plan, modelId)) {
      rejected.push({ modelId, because: `requires the ${AI_MODEL_PLAN_ACCESS[modelId]} plan` });
      continue;
    }
    if (typeof request.credits === 'number' && request.credits < MODEL_ACTION_CREDIT_FLOORS[modelId]) {
      rejected.push({ modelId, because: `costs ${MODEL_ACTION_CREDIT_FLOORS[modelId]} credits, ${request.credits} available` });
      continue;
    }
    // A deferred tier answers minutes later. That is fine for a background
    // job and unacceptable for someone watching a cursor blink.
    if ((request.interactive || INHERENTLY_INTERACTIVE.has(request.task)) && isDeferredTier(modelId)) {
      rejected.push({ modelId, because: 'deferred execution tier, not usable interactively' });
      continue;
    }
    if (STRENGTH_ORDER[caps[dimensionKey]] < requiredStrength) {
      rejected.push({ modelId, because: `${bar.dimension} is ${caps[dimensionKey]}, ${request.task} at ${complexity} needs at least ${strengthName(requiredStrength)}` });
      continue;
    }
    if (request.needs?.vision && !caps.supportsVision) { rejected.push({ modelId, because: 'no vision support' }); continue; }
    if (request.needs?.audio && !caps.supportsAudio) { rejected.push({ modelId, because: 'no audio support' }); continue; }
    if (request.needs?.video && !caps.supportsVideo) { rejected.push({ modelId, because: 'no video support' }); continue; }
    if (request.needs?.tools && !caps.supportsToolCalling) { rejected.push({ modelId, because: 'no tool calling' }); continue; }
    if (request.needs?.longContext && !caps.supportsLongContext) { rejected.push({ modelId, because: 'no long context support' }); continue; }
    if (request.needs?.structuredOutput && !caps.supportsStructuredOutput) { rejected.push({ modelId, because: 'no structured output' }); continue; }
    if (request.estimatedInputTokens && request.estimatedInputTokens > caps.maxContextTokens) {
      rejected.push({ modelId, because: `context window ${caps.maxContextTokens} is smaller than the ${request.estimatedInputTokens} tokens required` });
      continue;
    }

    return {
      modelId,
      reason: `role-compatible model clearing ${request.task}/${complexity} (${bar.dimension} ≥ ${strengthName(requiredStrength)})`,
      rejected,
      estimatedUsdPerMillionBlended: Number(blendedCost(modelId).toFixed(3)),
    };
  }

  // No eligible candidate: surface the constraint instead of silently using
  // a model that lacks a required capability or exceeds the user's access.
  throw Object.assign(new Error(`No eligible model satisfies ${request.task}/${complexity}.`), { diagnosticCode:'MODEL_CAPABILITY_UNAVAILABLE', rejected });
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
