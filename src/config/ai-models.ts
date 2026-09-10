export const UserPlan = {
  FREE: 'free',
  PRO: 'pro',
  BUSINESS: 'business',
  /** Historical persisted value. New configuration uses `business`. */
  SCALE: 'scale',
  ENTERPRISE: 'enterprise',
} as const;
export type UserPlan = (typeof UserPlan)[keyof typeof UserPlan];
export type CanonicalUserPlan = Exclude<UserPlan, 'scale'>;

const PLAN_RANK: Record<CanonicalUserPlan, number> = {
  free: 0,
  pro: 1,
  business: 2,
  enterprise: 3,
};

/** Keep old `scale` subscriptions readable without creating a second tier. */
export function normalizeUserPlan(value: unknown): CanonicalUserPlan {
  const plan = String(value || '').trim().toLowerCase();
  if (plan === 'scale') return UserPlan.BUSINESS;
  if (plan === 'pro' || plan === 'business' || plan === 'enterprise') return plan;
  return UserPlan.FREE;
}

export function userPlanRank(value: unknown): number {
  return PLAN_RANK[normalizeUserPlan(value)];
}

export function isPlanAtLeast(userPlan: unknown, requiredPlan: unknown): boolean {
  return userPlanRank(userPlan) >= userPlanRank(requiredPlan);
}

export const AIModelTier = { ECONOMY: 'Economy', STANDARD: 'Standard', PRO: 'Pro', PREMIUM: 'Premium' } as const;
export type AIModelTier = (typeof AIModelTier)[keyof typeof AIModelTier];
export type ModelProvider = 'anthropic' | 'openai' | 'google' | 'moonshot' | 'xai';
export type ModelRouteProvider = 'openrouter';
export type ModelStrength = 'low' | 'medium' | 'high' | 'frontier';
export type ModelSpeed = 'fast' | 'balanced' | 'deliberate';
export type ModelReliability = 'standard' | 'high' | 'experimental';

export interface ModelCapabilities {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsFiles: boolean;
  supportsAudio: boolean;
  supportsVideo: boolean;
  supportsJsonMode: boolean;
  supportsStructuredOutput: boolean;
  supportsToolCalling: boolean;
  supportsParallelToolCalling: boolean;
  supportsLongContext: boolean;
  supportsReasoningControl: boolean;
  supportsPromptCaching: boolean;
  reasoningLevel: ModelStrength;
  codeLevel: ModelStrength;
  agenticLevel: ModelStrength;
  designLevel: ModelStrength;
  securityLevel: ModelStrength;
  speed: ModelSpeed;
  reliability: ModelReliability;
  bestFor: string[];
  maxContextTokens: number;
  maxOutputTokens: number;
}

export interface ModelDefinition {
  id: string;
  label: string;
  /** Model publisher, used for display and capability adaptation. */
  provider: ModelProvider;
  /** All text-model execution stays behind the OpenRouter gateway. */
  routeProvider: ModelRouteProvider;
  contextWindow: number;
  maxOutputTokens: number;
  tier: AIModelTier;
  minPlan: CanonicalUserPlan;
  creditFloor: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  pricingTiers?: readonly {
    minInputTokens: number;
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }[];
  isNew?: boolean;
  isFast?: boolean;
  isPremium?: boolean;
  isRecommended?: boolean;
  autoRole?: AutoModelRole;
  description: string;
  capabilities: Omit<ModelCapabilities, 'maxContextTokens' | 'maxOutputTokens'>;
}

export const AutoModelRole = {
  ROUTER: 'router',
  WORKER: 'worker',
  VISUAL: 'visual',
  LEAD: 'lead',
  PREMIUM: 'premium',
} as const;
export type AutoModelRole = (typeof AutoModelRole)[keyof typeof AutoModelRole];

export const AUTO_MODEL_ROLE_ORDER = [
  AutoModelRole.ROUTER,
  AutoModelRole.WORKER,
  AutoModelRole.VISUAL,
  AutoModelRole.LEAD,
  AutoModelRole.PREMIUM,
] as const;

export const ASTRA_MODEL_ID = 'openai/gpt-6-astra' as const;

const viaOpenRouter = { routeProvider: 'openrouter' } as const;

const commonTextTools = {
  supportsStreaming: true,
  supportsTools: true,
  supportsVision: false,
  supportsFiles: false,
  supportsAudio: false,
  supportsVideo: false,
  supportsJsonMode: true,
  supportsStructuredOutput: true,
  supportsToolCalling: true,
  supportsParallelToolCalling: true,
  supportsLongContext: true,
  supportsReasoningControl: true,
  supportsPromptCaching: true,
} as const;

// The authorised catalogue. Nothing outside this list may be called: the
// allowlist is derived from it, `validateAllowedModel` enforces it, and the
// router only ever chooses from it.
//
// Ordered cheapest-first by blended cost, because that is the order the router
// walks: it takes the first model that clears the task's competence bar, so a
// cheap model that is good enough always wins over an expensive one that is
// merely better. `:batch` variants are the provider's deferred-execution tier —
// materially cheaper, higher latency — which is why they sit at the economy end
// and are kept off the interactive paths.
const LEGACY_MODEL_REGISTRY = [
  {
    ...viaOpenRouter,
    id: 'google/gemini-3.8-flash:batch', label: 'Gemini 3.8 Flash', provider: 'google',
    contextWindow: 1_048_576, maxOutputTokens: 65_536,
    tier: AIModelTier.ECONOMY, minPlan: UserPlan.FREE, creditFloor: 1,
    inputUsdPerMillion: 0.19, outputUsdPerMillion: 0.94, isFast: true, isNew: true,
    description: 'Le moins cher du catalogue : classification, résumés, analyses de fichiers et travaux de fond.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true, supportsAudio: true, supportsVideo: true,
      reasoningLevel: 'medium', codeLevel: 'medium', agenticLevel: 'medium', designLevel: 'medium', securityLevel: 'medium',
      speed: 'balanced', reliability: 'high', bestFor: ['classification', 'summary', 'vision', 'long_context', 'background_work'] },
  },
  {
    ...viaOpenRouter,
    id: 'openai/gpt-5.6-luna-pro', label: 'Luna Pro', provider: 'openai',
    contextWindow: 1_050_000, maxOutputTokens: 128_000,
    tier: AIModelTier.ECONOMY, minPlan: UserPlan.FREE, creditFloor: 2,
    inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2,
    pricingTiers: [{ minInputTokens: 272_000, inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.8 }],
    isFast: true, isNew: true,
    description: 'Rapide et économique pour la conversation, les clarifications et les petites modifications.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'medium', codeLevel: 'high', agenticLevel: 'medium', designLevel: 'medium', securityLevel: 'medium',
      speed: 'fast', reliability: 'high', bestFor: ['conversation', 'clarification', 'classification', 'summary', 'small_edits'] },
  },
  {
    ...viaOpenRouter,
    id: 'moonshotai/kimi-k3', label: 'Kimi K3', provider: 'moonshot',
    contextWindow: 262_144, maxOutputTokens: 65_536,
    tier: AIModelTier.STANDARD, minPlan: UserPlan.FREE, creditFloor: 3,
    inputUsdPerMillion: 3, outputUsdPerMillion: 15, isNew: true,
    description: 'Bon rapport qualité-prix pour le code, le debug et les boucles d’outils longues.',
    capabilities: { ...commonTextTools,
      reasoningLevel: 'high', codeLevel: 'high', agenticLevel: 'high', designLevel: 'medium', securityLevel: 'high',
      speed: 'balanced', reliability: 'high', bestFor: ['code_generation', 'debug', 'tests', 'tool_use', 'economy'] },
  },
  {
    ...viaOpenRouter,
    id: 'openai/gpt-5.6-terra-pro', label: 'Terra Pro', provider: 'openai',
    contextWindow: 1_050_000, maxOutputTokens: 128_000,
    tier: AIModelTier.STANDARD, minPlan: UserPlan.PRO, creditFloor: 5,
    inputUsdPerMillion: 2, outputUsdPerMillion: 12, isNew: true,
    pricingTiers: [{ minInputTokens: 272_000, inputUsdPerMillion: 4, outputUsdPerMillion: 18 }],
    description: 'Équilibre qualité, vitesse et coût pour les builds quotidiens.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'high', codeLevel: 'high', agenticLevel: 'high', designLevel: 'high', securityLevel: 'high',
      speed: 'balanced', reliability: 'high', bestFor: ['full_stack_generation', 'multi_file_edits', 'product_reasoning', 'routine_builds'] },
  },
  {
    ...viaOpenRouter,
    id: 'anthropic/claude-sonnet-5', label: 'Sonnet 5', provider: 'anthropic',
    contextWindow: 1_000_000, maxOutputTokens: 128_000,
    tier: AIModelTier.PRO, minPlan: UserPlan.PRO, creditFloor: 7,
    inputUsdPerMillion: 2, outputUsdPerMillion: 10, isNew: true, isRecommended: true,
    description: 'Recommandé pour les applications fullstack, le produit et les interfaces soignées.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'frontier', agenticLevel: 'frontier', designLevel: 'frontier', securityLevel: 'high',
      speed: 'balanced', reliability: 'high', bestFor: ['full_stack_generation', 'frontend_generation', 'product_design', 'refactor', 'debug', 'tool_use'] },
  },
  {
    ...viaOpenRouter,
    id: 'x-ai/grok-4.6', label: 'Grok 4.6', provider: 'xai',
    contextWindow: 500_000, maxOutputTokens: 65_536,
    tier: AIModelTier.PRO, minPlan: UserPlan.PRO, creditFloor: 7,
    inputUsdPerMillion: 2, outputUsdPerMillion: 6, isNew: true,
    pricingTiers: [{ minInputTokens: 200_000, inputUsdPerMillion: 4, outputUsdPerMillion: 12 }],
    description: 'Agent multimodal robuste pour la recherche, les outils et la résolution technique.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'high', agenticLevel: 'frontier', designLevel: 'high', securityLevel: 'high',
      speed: 'balanced', reliability: 'high', bestFor: ['research', 'tool_use', 'current_information', 'debug', 'vision'] },
  },
  {
    ...viaOpenRouter,
    id: 'openai/gpt-5.6-sol-pro', label: 'Sol Pro', provider: 'openai',
    contextWindow: 1_050_000, maxOutputTokens: 128_000,
    tier: AIModelTier.PREMIUM, minPlan: UserPlan.BUSINESS, creditFloor: 11,
    inputUsdPerMillion: 2, outputUsdPerMillion: 10,
    pricingTiers: [{ minInputTokens: 272_000, inputUsdPerMillion: 4, outputUsdPerMillion: 15 }],
    isPremium: true, isNew: true,
    description: 'Qualité premium pour l’architecture, les migrations et les problèmes complexes.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'frontier', agenticLevel: 'frontier', designLevel: 'high', securityLevel: 'frontier',
      speed: 'deliberate', reliability: 'high', bestFor: ['architecture', 'complex_debug', 'security', 'migrations', 'long_horizon_coding'] },
  },
  {
    ...viaOpenRouter,
    id: 'anthropic/claude-opus-5', label: 'Opus 5', provider: 'anthropic',
    contextWindow: 1_000_000, maxOutputTokens: 128_000,
    tier: AIModelTier.PREMIUM, minPlan: UserPlan.BUSINESS, creditFloor: 15,
    inputUsdPerMillion: 5, outputUsdPerMillion: 25, isPremium: true, isNew: true,
    description: 'Pour les revues, l’architecture et les corrections les plus difficiles.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'frontier', agenticLevel: 'frontier', designLevel: 'frontier', securityLevel: 'frontier',
      speed: 'deliberate', reliability: 'high', bestFor: ['architecture', 'deep_debug', 'review', 'security', 'complex_reasoning'] },
  },
  {
    ...viaOpenRouter,
    id: 'anthropic/claude-fable-5.1:batch', label: 'Fable 5.1', provider: 'anthropic',
    contextWindow: 1_000_000, maxOutputTokens: 128_000,
    tier: AIModelTier.PREMIUM, minPlan: UserPlan.ENTERPRISE, creditFloor: 22,
    inputUsdPerMillion: 5, outputUsdPerMillion: 25, isPremium: true, isNew: true,
    description: 'Traitement différé pour les workflows enterprise longs et fortement supervisés.',
    capabilities: { ...commonTextTools, supportsVision: true, supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'frontier', agenticLevel: 'frontier', designLevel: 'frontier', securityLevel: 'frontier',
      speed: 'deliberate', reliability: 'standard', bestFor: ['enterprise_workflows', 'long_running_agents', 'massive_context', 'architecture', 'research'] },
  },
] as const satisfies readonly ModelDefinition[];

// Preserve historical explicit selections. Auto uses only the interactive pool
// below; legacy batch and retired role assignments cannot leak into new runs.
export const MODEL_REGISTRY = [
  ...LEGACY_MODEL_REGISTRY,
  { ...LEGACY_MODEL_REGISTRY[1], id:'openai/gpt-5.6-luna', label:'Luna', inputUsdPerMillion:0.2, outputUsdPerMillion:1.2 },
  { ...LEGACY_MODEL_REGISTRY[3], id:'openai/gpt-5.6-terra', label:'Terra' },
  { ...LEGACY_MODEL_REGISTRY[6], id:'openai/gpt-5.6-sol', label:'Sol' },
  { ...LEGACY_MODEL_REGISTRY[0], id:'google/gemini-3.8-flash', label:'Gemini 3.8 Flash', inputUsdPerMillion:0.75, outputUsdPerMillion:3.75,
    capabilities:{ ...LEGACY_MODEL_REGISTRY[0].capabilities, codeLevel:'high', agenticLevel:'high', designLevel:'high' } },
  { ...LEGACY_MODEL_REGISTRY[8], id:'anthropic/claude-fable-5.1', label:'Fable 5.1', inputUsdPerMillion:10, outputUsdPerMillion:50 },
  {
    ...viaOpenRouter,
    id: ASTRA_MODEL_ID,
    label: 'GPT-6 Astra',
    provider: 'openai',
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    tier: AIModelTier.PREMIUM,
    minPlan: UserPlan.BUSINESS,
    creditFloor: 20,
    inputUsdPerMillion: 10,
    outputUsdPerMillion: 50,
    pricingTiers: [{ minInputTokens: 272_000, inputUsdPerMillion: 20, outputUsdPerMillion: 75 }],
    isPremium: true,
    isNew: true,
    description: 'Escalade contrôlée pour architecture, diagnostic et synthèse critiques.',
    capabilities: {
      ...commonTextTools,
      supportsVision: true,
      supportsFiles: true,
      reasoningLevel: 'frontier', codeLevel: 'frontier', agenticLevel: 'frontier', designLevel: 'frontier', securityLevel: 'frontier',
      speed: 'deliberate', reliability: 'high', bestFor: ['critical_architecture', 'complex_debug', 'critical_synthesis', 'manual_premium'],
    },
  },
] as const satisfies readonly ModelDefinition[];

export function getModelTokenPricing(model: ModelDefinition, inputTokens: number) {
  const tier = [...(model.pricingTiers || [])]
    .sort((a, b) => b.minInputTokens - a.minInputTokens)
    .find(candidate => inputTokens >= candidate.minInputTokens);
  return tier || {
    minInputTokens: 0,
    inputUsdPerMillion: model.inputUsdPerMillion,
    outputUsdPerMillion: model.outputUsdPerMillion,
  };
}

export const AUTO_MODEL_ROLES = {
  router: 'openai/gpt-5.6-luna',
  worker: 'openai/gpt-5.6-terra',
  visual: 'google/gemini-3.8-flash',
  lead: 'openai/gpt-5.6-sol',
  premium: 'anthropic/claude-opus-5',
} as const;
export const UNAVAILABLE_MODEL_ROLES = {} as const;
export const AUTO_MODEL_IDS = Object.values(AUTO_MODEL_ROLES);

export type AllowedModelId = (typeof MODEL_REGISTRY)[number]['id'];
export type ModelSelectionId = AllowedModelId | 'auto';
export const DEFAULT_PROVIDER_MODEL_ID: AllowedModelId = 'openai/gpt-5.6-luna-pro';
export const AI_ALLOWED_MODELS = MODEL_REGISTRY.map(model => model.id) as AllowedModelId[];

export const AI_AUTO_MODEL_OPTION = {
  id: 'auto', display_name: 'Auto', label: 'Auto', provider: 'auto', tier: 'Auto',
  description: 'Coden choisit le modèle le plus fiable et rentable compatible avec la demande.',
} as const;

export const PROVIDER_META: Record<ModelProvider, { label: string; color: string; textColor: string; icon: string }> = {
  anthropic: { label: 'Anthropic', color: '#CC785C', textColor: '#fff', icon: 'anthropic' },
  openai: { label: 'OpenAI', color: '#0F9F7A', textColor: '#fff', icon: 'openai' },
  google: { label: 'Google', color: '#4285F4', textColor: '#fff', icon: 'google' },
  moonshot: { label: 'Moonshot AI', color: '#1F2937', textColor: '#fff', icon: 'moonshot' },
  xai: { label: 'xAI', color: '#111827', textColor: '#fff', icon: 'xai' },
};

export function getModelsByProvider() {
  const initial: Record<ModelProvider, ModelDefinition[]> = { anthropic: [], openai: [], google: [], moonshot: [], xai: [] };
  return MODEL_REGISTRY.reduce<Record<ModelProvider, ModelDefinition[]>>((acc, model) => {
    acc[model.provider].push(model);
    return acc;
  }, initial);
}

export function isAllowedModelId(value: unknown): value is AllowedModelId {
  return typeof value === 'string' && (AI_ALLOWED_MODELS as readonly string[]).includes(value);
}

export function normalizeModelSelectionId(value: unknown): ModelSelectionId {
  if (value === 'auto' || value === '' || value == null) return 'auto';
  return isAllowedModelId(value) ? value : 'auto';
}

const buildRecord = <T>(mapper: (model: ModelDefinition) => T) => (
  Object.fromEntries(MODEL_REGISTRY.map(model => [model.id, mapper(model)])) as Record<AllowedModelId, T>
);

export const AI_MODEL_DISPLAY_NAMES = buildRecord(model => model.label);
export const AI_MODEL_TIERS = buildRecord(model => model.tier);
export const AI_MODEL_PLAN_ACCESS = buildRecord(model => model.minPlan);
export const MODEL_ACTION_CREDIT_FLOORS = buildRecord(model => model.creditFloor);
export const AI_MODEL_CAPABILITIES = buildRecord<ModelCapabilities>(model => ({
  ...model.capabilities,
  maxContextTokens: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
}));

// A fallback is allowed only for an Auto-routed request that has not produced
// usable user-visible output yet. Explicit model choices stay pinned. Keep the
// chains short and within the same or a lower accessible tier so a recovery is
// bounded, explainable and never turns into an unbounded multi-model run. Two
// independent candidates are deliberate: a single provider outage used to make
// Auto behave like a pinned model after just one fallback failed.
export const AI_MODEL_FALLBACKS: Record<AllowedModelId, AllowedModelId[]> = {
  'openai/gpt-5.6-luna':['google/gemini-3.8-flash', 'openai/gpt-5.6-luna-pro'],
  'openai/gpt-5.6-terra':['moonshotai/kimi-k3', 'google/gemini-3.8-flash'],
  'openai/gpt-5.6-sol':['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
  'google/gemini-3.8-flash':['openai/gpt-5.6-luna', 'openai/gpt-5.6-luna-pro'],
  'anthropic/claude-fable-5.1':['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
  [ASTRA_MODEL_ID]: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
  'google/gemini-3.8-flash:batch': ['openai/gpt-5.6-luna-pro', 'openai/gpt-5.6-luna'],
  'openai/gpt-5.6-luna-pro': ['openai/gpt-5.6-luna', 'google/gemini-3.8-flash'],
  'moonshotai/kimi-k3': ['openai/gpt-5.6-luna', 'google/gemini-3.8-flash'],
  'openai/gpt-5.6-terra-pro': ['anthropic/claude-sonnet-5', 'moonshotai/kimi-k3'],
  'anthropic/claude-sonnet-5': ['openai/gpt-5.6-terra-pro', 'moonshotai/kimi-k3'],
  'x-ai/grok-4.6': ['anthropic/claude-sonnet-5', 'moonshotai/kimi-k3'],
  'openai/gpt-5.6-sol-pro': ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
  'anthropic/claude-opus-5': ['openai/gpt-5.6-sol-pro', 'anthropic/claude-sonnet-5'],
  // Fable is the deferred tier; its recovery is the interactive model of the
  // same family, never another batch model that would defer a second time.
  'anthropic/claude-fable-5.1:batch': ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-5'],
};

export type ModelCreditRate = {
  id: ModelSelectionId;
  display_name: string;
  tier: AIModelTier | 'Auto';
  availability: UserPlan | 'all';
  credits: { plan: string; build: string; fix: string; deploy: string };
};

const formatCredit = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
export const MODEL_CREDIT_RATES: ModelCreditRate[] = [
  { id: 'auto', display_name: 'Auto', tier: 'Auto', availability: 'all', credits: { plan: 'Réduit', build: 'Adaptatif', fix: 'Adaptatif', deploy: '1–3' } },
  ...MODEL_REGISTRY.map(model => ({
    id: model.id as AllowedModelId, display_name: model.label, tier: model.tier, availability: model.minPlan,
    credits: {
      plan: `~${formatCredit(Math.max(1, model.creditFloor * 0.55))}`,
      build: `dès ${formatCredit(model.creditFloor)}`,
      fix: `dès ${formatCredit(Math.max(1, model.creditFloor * 0.45))}`,
      deploy: '1–3',
    },
  })),
];
