import type { AIModelRuntimeConfig, RuntimeToolDefinition } from './ai-model-runtime.ts';

export type ProviderRequestConfig = {
  adapter: AIModelRuntimeConfig['profile']['adapter'];
  temperature?: number;
  maxTokens?: number;
  /**
   * How long this particular model may take to answer.
   *
   * `buildAIModelRuntimeConfig` already derives it from the model's own speed
   * — 45s for a fast one, up to 240s for a streaming frontier model — and that
   * number used to stop here, because this config carried no field for it.
   * Every caller then invented its own constant, and the coder loop gave a
   * frontier model 60s. It is a transport concern, not a payload one:
   * `toOpenRouterChatPayloadExtras` never copies it into the request body.
   */
  timeoutMs?: number;
  responseFormat?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  toolChoice?: 'auto' | 'none';
  reasoning?: Record<string, unknown>;
  thinking_budget?: number;
  include_reasoning?: boolean;
  metadata?: Record<string, unknown>;
};

function normalizeTool(tool: RuntimeToolDefinition) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} },
    },
  };
}

function openAiCompatibleResponseFormat(runtime: AIModelRuntimeConfig) {
  if (runtime.responseFormat.type === 'json_object') return { type: 'json_object' };
  if (runtime.responseFormat.type === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: {
        name: runtime.responseFormat.schemaName,
        strict: true,
        schema: runtime.responseFormat.schema,
      },
    };
  }
  return undefined;
}

export function buildProviderRequestConfig(runtime: AIModelRuntimeConfig): ProviderRequestConfig {
  const adapter = runtime.profile.adapter;

  // Temperature safety: reasoning/thinking models often require temperature=1.0
  const safeTemperature = runtime.thinking?.enabled && adapter !== 'gemini'
    ? 1.0
    : runtime.temperature;

  const base: ProviderRequestConfig = {
    adapter,
    temperature: safeTemperature,
    maxTokens: runtime.maxTokens,
    timeoutMs: runtime.timeoutMs,
    metadata: {
      task: runtime.task,
      model_id: runtime.profile.id,
      provider: runtime.profile.provider,
    },
  };

  if (adapter === 'openai' || adapter === 'openrouter' || adapter === 'deepseek' || adapter === 'xai') {
    const responseFormat = openAiCompatibleResponseFormat(runtime);
    const tools = runtime.tools.map(normalizeTool);
    return {
      ...base,
      responseFormat,
      tools: tools.length ? tools : undefined,
      toolChoice: tools.length ? runtime.toolChoice : 'none',
      reasoning: runtime.reasoning.enabled ? { effort: runtime.reasoning.effort } : undefined,
      thinking_budget: runtime.thinking?.enabled ? runtime.thinking.budgetTokens : undefined,
      include_reasoning: runtime.thinking?.enabled ? runtime.thinking.includeInResponse : undefined,
    };
  }

  if (adapter === 'anthropic') {
    return {
      ...base,
      tools: runtime.tools.length
        ? runtime.tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters || { type: 'object', properties: {} },
        }))
        : undefined,
      toolChoice: runtime.tools.length ? runtime.toolChoice : 'none',
      // Anthropic-compatible requests should not receive OpenAI response_format.
      responseFormat: runtime.responseFormat.type === 'text' ? undefined : { type: 'json_instruction' },
      thinking_budget: runtime.thinking?.enabled ? runtime.thinking.budgetTokens : undefined,
      include_reasoning: runtime.thinking?.enabled ? runtime.thinking.includeInResponse : undefined,
    };
  }

  if (adapter === 'gemini') {
    return {
      ...base,
      responseFormat: runtime.responseFormat.type === 'text'
        ? undefined
        : { response_mime_type: 'application/json' },
      tools: runtime.tools.length
        ? runtime.tools.map(tool => ({
          functionDeclarations: [{
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters || { type: 'object', properties: {} },
          }],
        }))
        : undefined,
      toolChoice: runtime.tools.length ? runtime.toolChoice : 'none',
      thinking_budget: runtime.thinking?.enabled ? runtime.thinking.budgetTokens : undefined,
    };
  }

  return base;
}

export function toOpenRouterChatPayloadExtras(config?: ProviderRequestConfig) {
  if (!config) return {};
  const extras: Record<string, unknown> = {};
  if (Number.isFinite(config.temperature)) extras.temperature = config.temperature;
  if (Number.isFinite(config.maxTokens)) extras.max_tokens = config.maxTokens;
  if (config.responseFormat) {
    extras.response_format = (config.responseFormat as any).response_mime_type === 'application/json'
      ? { type: 'json_object' }
      : (config.responseFormat as any).type === 'json_instruction' ? { type: 'json_object' } : config.responseFormat;
  }
  if (config.tools?.length) {
    extras.tools = config.tools.map(tool => {
      if ((tool as any)?.type === 'function') return tool;
      if ((tool as any)?.name) {
        return {
          type: 'function',
          function: {
            name: (tool as any).name,
            description: (tool as any).description || '',
            parameters: (tool as any).input_schema || { type: 'object', properties: {} },
          },
        };
      }
      const declaration = (tool as any)?.functionDeclarations?.[0];
      if (declaration?.name) {
        return {
          type: 'function',
          function: {
            name: declaration.name,
            description: declaration.description || '',
            parameters: declaration.parameters || { type: 'object', properties: {} },
          },
        };
      }
      return tool;
    });
    if (config.toolChoice && config.toolChoice !== 'none') extras.tool_choice = config.toolChoice;
  }
  if (config.reasoning) extras.reasoning = { ...config.reasoning, exclude: true };
  else if (config.thinking_budget) extras.reasoning = { max_tokens: config.thinking_budget, exclude: true };
  return extras;
}

export function classifyProviderAdapterError(error: unknown) {
  const message = String((error as any)?.message || error || '');
  if (/unsupported parameter|unsupported.*response_format|tool_choice|tools|reasoning|json_schema/i.test(message)) {
    return {
      diagnosticCode: 'PROVIDER_UNSUPPORTED_RUNTIME_CONFIG',
      retryable: true,
    };
  }
  if (/quota|billing|payment required|402/i.test(message)) {
    return {
      diagnosticCode: 'PROVIDER_QUOTA_OR_BILLING',
      retryable: false,
    };
  }
  if (/timeout|abort|aborted/i.test(message)) {
    return {
      diagnosticCode: 'PROVIDER_TIMEOUT',
      retryable: true,
    };
  }
  return {
    diagnosticCode: 'PROVIDER_REQUEST_FAILED',
    retryable: false,
  };
}
