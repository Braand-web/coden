import type { AIModelRuntimeConfig, RuntimeToolDefinition } from './ai-model-runtime.ts';

import type { ReasoningLevel } from './openrouter-request.ts';

/**
 * What a caller wants from one provider request — never how big it may be.
 *
 * This used to carry `maxTokens`, `temperature`, a reasoning effort and a
 * thinking budget, each chosen upstream by a guess about the model and then
 * copied into the payload. Those are exactly the limits that made models
 * smaller than they are. The size of a request is now decided in one place,
 * `buildOpenRouterRequest`, from the model's own advertised capabilities; this
 * says only what the request is for.
 */
export type ProviderRequestConfig = {
  adapter: AIModelRuntimeConfig['profile']['adapter'];
  /**
   * How long this model may take to answer. A transport concern, never
   * copied into the request body.
   */
  timeoutMs?: number;
  /** The level the user chose, or the one Auto chose. */
  reasoningLevel?: ReasoningLevel;
  /** OpenAI-compatible `response_format`. */
  responseFormat?: Record<string, unknown>;
  /** OpenAI-compatible function tools. */
  tools?: Record<string, unknown>[];
  toolChoice?: 'auto' | 'none';
  /** OpenRouter `models` fallback chain, for Auto only. */
  fallbackModels?: string[];
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

/**
 * The runtime's intent, in the shape `buildOpenRouterRequest` reads.
 *
 * Every text model is reached through OpenRouter's OpenAI-compatible API, so
 * tools and structured output always use that one format; the publisher only
 * matters for prompt-caching markers.
 */
export function buildProviderRequestConfig(runtime: AIModelRuntimeConfig): ProviderRequestConfig {
  const tools = runtime.tools.map(normalizeTool);
  return {
    adapter: runtime.profile.adapter,
    timeoutMs: runtime.timeoutMs,
    reasoningLevel: runtime.reasoningLevel,
    responseFormat: openAiCompatibleResponseFormat(runtime),
    tools: tools.length ? tools : undefined,
    toolChoice: tools.length ? runtime.toolChoice : 'none',
    metadata: {
      task: runtime.task,
      model_id: runtime.profile.id,
      provider: runtime.profile.provider,
    },
  };
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
