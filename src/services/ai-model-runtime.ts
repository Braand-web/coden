import {
  AI_MODEL_CAPABILITIES,
  AI_MODEL_FALLBACKS,
  DEFAULT_PROVIDER_MODEL_ID,
  MODEL_ACTION_CREDIT_FLOORS,
  MODEL_REGISTRY,
  type AllowedModelId,
  type ModelProvider,
} from '../config/ai-models.ts';
export { publicRuntimeErrorMessage } from '../lib/runtime-error-presentation.ts';
import { normalizeAgentEffort, reasoningLevelForEffort, type AgentEffort } from './agent-effort.ts';
import { normalizeReasoningLevel, type ReasoningLevel } from './openrouter-request.ts';

export type AIWorkflowTask =
  | 'conversation'
  | 'clarification'
  | 'intent'
  | 'planning'
  | 'frontend_generation'
  | 'backend_generation'
  | 'database'
  | 'debug'
  | 'design'
  | 'security'
  | 'streaming'
  | 'summary'
  | 'tests'
  | 'deploy'
  | 'vision'
  | 'long_context';

export type RuntimeStrength = 'none' | 'low' | 'medium' | 'high' | 'frontier';

export type RuntimeProviderAdapter =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'xai'
  | 'fal';

export type RuntimeResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; schemaName: string; schema: Record<string, unknown> };

export type RuntimeToolDefinition = {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  needsApproval?: boolean;
  approvalReason?: string;
};

export type AIModelCapabilityProfile = {
  id: AllowedModelId;
  provider: ModelProvider;
  adapter: RuntimeProviderAdapter;
  displayName: string;
  enabled: true;
  bestUse: string[];
  reasoning: RuntimeStrength;
  code: RuntimeStrength;
  comprehension: RuntimeStrength;
  agentic: RuntimeStrength;
  design: RuntimeStrength;
  security: RuntimeStrength;
  supports: {
    streaming: boolean;
    toolCalling: boolean;
    structuredOutput: boolean;
    jsonMode: boolean;
    vision: boolean;
    longContext: boolean;
    reasoningControl: boolean;
  };
  recommended: {
    /** The model's advertised output ceiling — informational; the request reads the live catalogue. */
    maxTokens: number;
    timeoutMs: number;
    streamingTimeoutMs: number;
  };
  limits: {
    contextTokens: number;
    known: string[];
  };
  creditCost: number;
  speed: 'fast' | 'balanced' | 'deliberate';
  reliability: 'standard' | 'high' | 'experimental';
  fallbackPrimary: AllowedModelId | null;
  fallbackSecondary: AllowedModelId | null;
};

export type AIModelRuntimeConfig = {
  profile: AIModelCapabilityProfile;
  task: AIWorkflowTask;
  stream: boolean;
  timeoutMs: number;
  responseFormat: RuntimeResponseFormat;
  tools: RuntimeToolDefinition[];
  toolChoice: 'auto' | 'none';
  /**
   * The reasoning level, exactly as the user (or Auto) chose it. Translated
   * into the request by `buildOpenRouterRequest`, and nowhere else.
   */
  reasoningLevel: ReasoningLevel;
  vision: {
    enabled: boolean;
  };
  longContext: {
    enabled: boolean;
    maxInputTokens: number;
  };
  fallbacks: AllowedModelId[];
  privateRuntimeNotes: string[];
};

const PROVIDER_ADAPTERS: Record<ModelProvider, RuntimeProviderAdapter> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'gemini',
  // Moonshot has no first-party adapter here; it is reached through OpenRouter
  // like any other model without a direct integration.
  moonshot: 'openrouter',
  xai: 'xai',
};

function asRuntimeStrength(value: string | undefined): RuntimeStrength {
  if (value === 'frontier' || value === 'high' || value === 'medium' || value === 'low') return value;
  return 'none';
}

function comprehensionForProfile(modelId: AllowedModelId): RuntimeStrength {
  const caps = AI_MODEL_CAPABILITIES[modelId];
  if (caps.supportsLongContext && caps.reasoningLevel !== 'low') return 'high';
  if (caps.maxContextTokens >= 128_000) return 'medium';
  return asRuntimeStrength(caps.reasoningLevel);
}

function knownLimitsForProvider(provider: ModelProvider, modelId: AllowedModelId) {
  const limits: string[] = [];
  if (provider === 'moonshot') limits.push('text-only input');
  if (provider === 'xai') limits.push('500k context window');
  if (modelId.includes('fable')) {
    limits.push('enterprise-only, high-cost and opt-in');
  }
  return limits;
}

function supportsReasoningControl(provider: ModelProvider, modelId: AllowedModelId) {
  return AI_MODEL_CAPABILITIES[modelId]?.supportsReasoningControl === true;
}

export function getAIModelCapabilityProfile(modelId: AllowedModelId): AIModelCapabilityProfile {
  const definition = MODEL_REGISTRY.find(model => model.id === modelId);
  if (!definition) {
    return getAIModelCapabilityProfile(DEFAULT_PROVIDER_MODEL_ID);
  }
  const caps = AI_MODEL_CAPABILITIES[modelId];
  const fallbacks = AI_MODEL_FALLBACKS[modelId]?.filter(Boolean) || [];
  const isFrontier = caps.reasoningLevel === 'frontier' || caps.codeLevel === 'frontier';
  const isHigh = caps.reasoningLevel === 'high' || caps.codeLevel === 'high';

  return {
    id: modelId,
    provider: definition.provider,
    adapter: PROVIDER_ADAPTERS[definition.provider],
    displayName: definition.label,
    enabled: true,
    bestUse: caps.bestFor,
    reasoning: asRuntimeStrength(caps.reasoningLevel),
    code: asRuntimeStrength(caps.codeLevel),
    comprehension: comprehensionForProfile(modelId),
    agentic: asRuntimeStrength(caps.agenticLevel),
    design: asRuntimeStrength(caps.designLevel),
    security: asRuntimeStrength(caps.securityLevel),
    supports: {
      streaming: caps.supportsStreaming,
      toolCalling: caps.supportsToolCalling,
      structuredOutput: caps.supportsStructuredOutput,
      jsonMode: caps.supportsJsonMode,
      vision: caps.supportsVision,
      longContext: caps.supportsLongContext,
      reasoningControl: supportsReasoningControl(definition.provider, modelId),
    },
    recommended: {
      maxTokens: caps.maxOutputTokens,
      // ✅ Timeout scaled to model speed AND output size expectations
      timeoutMs: isFrontier ? 180_000 : caps.speed === 'deliberate' ? 120_000 : caps.speed === 'balanced' ? 75_000 : 45_000,
      streamingTimeoutMs: isFrontier ? 240_000 : caps.speed === 'deliberate' ? 180_000 : caps.speed === 'balanced' ? 120_000 : 75_000,
    },
    limits: {
      contextTokens: caps.maxContextTokens,
      known: knownLimitsForProvider(definition.provider, modelId),
    },
    creditCost: MODEL_ACTION_CREDIT_FLOORS[modelId],
    speed: caps.speed,
    reliability: caps.reliability,
    fallbackPrimary: fallbacks[0] || null,
    fallbackSecondary: fallbacks[1] || null,
  };
}

export function getAllAIModelCapabilityProfiles() {
  return MODEL_REGISTRY.map(model => getAIModelCapabilityProfile(model.id as AllowedModelId));
}

function taskNeedsStructuredOutput(task: AIWorkflowTask) {
  return [
    'intent',
    'planning',
    'frontend_generation',
    'backend_generation',
    'design',
    'database',
    'security',
    'tests',
    'deploy',
  ].includes(task);
}

function taskNeedsToolCalling(task: AIWorkflowTask) {
  return ['frontend_generation', 'backend_generation', 'database', 'debug', 'security', 'tests', 'deploy'].includes(task);
}

function taskNeedsLongContext(task: AIWorkflowTask) {
  return ['long_context', 'debug', 'frontend_generation', 'backend_generation', 'security'].includes(task);
}

function responseFormatForTask(profile: AIModelCapabilityProfile, task: AIWorkflowTask): RuntimeResponseFormat {
  if (!taskNeedsStructuredOutput(task) || !profile.supports.structuredOutput) return { type: 'text' };
  if (task === 'intent') {
    return {
      type: 'json_schema',
      schemaName: 'coden_intent_decision',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent: {
            type: 'string',
            enum: [
              'conversation',
              'clarification_required',
              'plan',
              'build',
              'edit',
              'debug_fix',
              'verify',
              'deploy_assist',
              'external_keys_required',
              'credits_required',
            ],
          },
          intent_category: { type: 'string' },
          confidence: { type: 'number' },
          auto_plan_required: { type: 'boolean' },
          selected_model_policy: { type: 'string', enum: ['economy', 'balanced', 'premium'] },
          reason: { type: 'string' },
          user_visible_reason: { type: 'string' },
          normalized_prompt: { type: 'string' },
          required_capabilities: { type: 'array', items: { type: 'string' } },
          objective: {
            type: 'object',
            additionalProperties: false,
            properties: {
              goal: { type: 'string' },
              scope: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  included: { type: 'array', items: { type: 'string' } },
                  excluded: { type: 'array', items: { type: 'string' } },
                },
                required: ['included', 'excluded'],
              },
              constraints: { type: 'array', items: { type: 'string' } },
              assumptions: { type: 'array', items: { type: 'string' } },
              acceptanceCriteria: { type: 'array', items: { type: 'string' } },
              risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
            },
            required: ['goal', 'scope', 'constraints', 'assumptions', 'acceptanceCriteria', 'risk'],
          },
          clarification: {
            type: 'object',
            additionalProperties: false,
            properties: {
              question: { type: 'string' },
              choices: { type: 'array', items: { type: 'string' } },
              recommendation: { type: 'string' },
            },
            required: ['question', 'choices', 'recommendation'],
          },
        },
        required: [
          'intent', 'intent_category', 'confidence', 'auto_plan_required',
          'selected_model_policy', 'reason', 'user_visible_reason', 'normalized_prompt',
          'required_capabilities', 'objective', 'clarification',
        ],
      },
    };
  }
  return { type: 'json_object' };
}

function toolsForTask(profile: AIModelCapabilityProfile, task: AIWorkflowTask): RuntimeToolDefinition[] {
  if (!taskNeedsToolCalling(task) || !profile.supports.toolCalling) return [];
  const shared: RuntimeToolDefinition[] = [
    {
      name: 'inspect_project_files',
      description: 'Read relevant project files before deciding what to change.',
      parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } } },
    },
    {
      name: 'summarize_change_plan',
      description: 'Return a concise, structured plan for the intended change.',
      parameters: { type: 'object', properties: { goal: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } } },
    },
  ];
  if (task === 'debug' || task === 'tests') {
    shared.push({
      name: 'interpret_check_failure',
      description: 'Classify a build, lint, runtime or preview failure and propose a safe fix.',
      parameters: { type: 'object', properties: { diagnostic: { type: 'string' }, likely_file: { type: 'string' } } },
    });
  }
  // ✅ Design-specific tools for frontier models on design tasks
  if (task === 'design' && (profile.design === 'frontier' || profile.design === 'high')) {
    shared.push({
      name: 'audit_design_system',
      description: 'Evaluate visual hierarchy, spacing consistency, responsive breakpoints, and accessibility contrast before finalizing UI.',
      parameters: {
        type: 'object',
        properties: {
          platform_type: { type: 'string', description: 'e.g. saas_dashboard, ecommerce, landing_page' },
          issues_found: { type: 'array', items: { type: 'string' } },
          fixes_applied: { type: 'array', items: { type: 'string' } },
        },
      },
    });
  }
  // ✅ Security audit tool for security/backend tasks on capable models
  if ((task === 'security' || task === 'backend_generation') && (profile.security === 'frontier' || profile.security === 'high')) {
    shared.push({
      name: 'security_audit_checklist',
      description: 'Run an OWASP-aligned security check on the generated code before delivery.',
      parameters: {
        type: 'object',
        properties: {
          checks_passed: { type: 'array', items: { type: 'string' } },
          vulnerabilities_found: { type: 'array', items: { type: 'string' } },
          mitigations_applied: { type: 'array', items: { type: 'string' } },
        },
      },
    });
  }
  return shared;
}

export function buildAIModelRuntimeConfig(input: {
  modelId: AllowedModelId;
  task: AIWorkflowTask;
  stream?: boolean;
  preferStructuredOutput?: boolean;
  allowTools?: boolean;
  hasVisionInput?: boolean;
  estimatedInputTokens?: number;
  timeoutMs?: number;
  /** The level the user chose. Wins over `effort`. */
  reasoningLevel?: ReasoningLevel;
  /** The composer's effort; mapped one-to-one onto a reasoning level. */
  effort?: AgentEffort;
}): AIModelRuntimeConfig {
  const profile = getAIModelCapabilityProfile(input.modelId);
  const task = input.task;
  const responseFormat = input.preferStructuredOutput === false
    ? { type: 'text' } as RuntimeResponseFormat
    : responseFormatForTask(profile, task);
  const tools = input.allowTools === false ? [] : toolsForTask(profile, task);
  const requestedEffort = normalizeAgentEffort(input.effort);
  const reasoningLevel = input.reasoningLevel
    ? normalizeReasoningLevel(input.reasoningLevel)
    : reasoningLevelForEffort(requestedEffort);
  const stream = Boolean(input.stream && profile.supports.streaming);
  const longContextEnabled = profile.supports.longContext && (
    taskNeedsLongContext(task) || Number(input.estimatedInputTokens || 0) > 90_000
  );

  const notes: string[] = [
    `adapter:${profile.adapter}`,
    `task:${task}`,
    `reasoning:${profile.reasoning}`,
    `code:${profile.code}`,
  ];
  if (responseFormat.type !== 'text') notes.push(`structured:${responseFormat.type}`);
  if (tools.length) notes.push(`tools:${tools.length}`);
  if (input.hasVisionInput && profile.supports.vision) notes.push('vision:enabled');
  if (longContextEnabled) notes.push('long_context:enabled');
  notes.push(`reasoning_level:${reasoningLevel}`);
  notes.push(`effort:${requestedEffort}`);

  return {
    profile,
    task,
    stream,
    timeoutMs: input.timeoutMs || (stream ? profile.recommended.streamingTimeoutMs : profile.recommended.timeoutMs),
    responseFormat,
    tools,
    toolChoice: tools.length ? 'auto' : 'none',
    reasoningLevel,
    vision: {
      enabled: Boolean(input.hasVisionInput && profile.supports.vision),
    },
    longContext: {
      enabled: longContextEnabled,
      maxInputTokens: profile.limits.contextTokens,
    },
    fallbacks: [profile.fallbackPrimary, profile.fallbackSecondary]
      .filter((id): id is AllowedModelId => Boolean(id))
      .filter((id, index, list) => list.indexOf(id) === index),
    privateRuntimeNotes: notes,
  };
}

/**
 * What a failed run says to the person waiting for it.
 *
 * Technical causes belong in the log; the interface gets a sentence that says
 * what happened and what is left to do. Production had shipped the raw cause
 * instead — a run ended with `TOOL_BUDGET_EXCEEDED` written across the
 * conversation — which reads as a crash even when the work was recoverable.
 *
 * Every branch is matched on the diagnostic code rather than the message, so
 * a new failure inside a known family stays readable without being renamed.
 */
