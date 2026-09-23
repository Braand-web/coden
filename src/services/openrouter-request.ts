/**
 * The only place an OpenRouter request body is built.
 *
 * Every limit in a request used to be chosen somewhere else: `max_tokens`
 * tiered at 16k/24k/32k/64k by a guess about the model, temperatures set per
 * "personality", reasoning switched off for tasks judged simple, every
 * reasoning trace thrown away with `exclude: true`, and each caller free to
 * pass its own `maxTokens` on top. None of it came from the model; all of it
 * made the model smaller than it is.
 *
 * Here the request is derived from what OpenRouter says the model can do
 * (`GET /api/v1/models`), and from the one choice that belongs to the user or
 * to Auto — the reasoning level:
 *
 *   - `max_tokens` is the model's own `max_completion_tokens`, reduced only
 *     when the prompt leaves less room than that in its context window
 *     (asking for more than fits is a hard provider error, not more power);
 *   - tools, structured output and reasoning are sent when the model lists
 *     them in `supported_parameters`, and never otherwise;
 *   - no temperature, no top_p: the provider's defaults for the model;
 *   - the reasoning trace is kept, so the interface can show it;
 *   - every request streams, and reports its real cost.
 */

import type { ChatMessage } from './openrouter-service.ts';
import { CapabilityError, type CatalogModel } from './openrouter-capabilities.ts';
import { applyPromptCaching, type CacheableMessage } from './prompt-caching.ts';

export const REASONING_LEVELS = ['none', 'low', 'medium', 'high', 'max'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];
/** Reasoning is on unless someone chose otherwise. */
export const DEFAULT_REASONING_LEVEL: ReasoningLevel = 'medium';

export function normalizeReasoningLevel(value: unknown): ReasoningLevel {
  return (REASONING_LEVELS as readonly string[]).includes(String(value)) ? (value as ReasoningLevel) : DEFAULT_REASONING_LEVEL;
}

export type OpenRouterRequestOptions = {
  /** OpenAI function-calling tools. Sent only to a model that supports them. */
  tools?: Array<Record<string, unknown>>;
  toolChoice?: 'auto' | 'none' | 'required';
  /** `{type:'json_object'}` or `{type:'json_schema', json_schema:{…}}`. */
  responseFormat?: Record<string, unknown>;
  /** OpenRouter's own fallback chain, tried in order if the model is unavailable. */
  fallbackModels?: string[];
  /** Publisher adapter, for prompt caching markers. */
  adapter?: string;
  /** Default true: every response streams. */
  stream?: boolean;
};

/**
 * A deliberately high estimate: three characters to the token (code and JSON
 * run denser than prose), an image priced like a page of text. Over-counting
 * costs a little output room; under-counting is a hard context-length error.
 */
export function estimatePromptTokens(messages: readonly ChatMessage[]): number {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    if (typeof message.content === 'string') chars += message.content.length;
    else for (const part of message.content || []) {
      if (part.type === 'text') chars += part.text.length;
      else images += 1;
    }
    if (message.tool_calls) chars += JSON.stringify(message.tool_calls).length;
  }
  return Math.ceil(chars / 3) + images * 1_500;
}

/** Tokens held back for the answer when the reasoning budget is set to its ceiling. */
export function answerReserve(maxTokens: number): number {
  return Math.min(32_768, Math.max(4_096, Math.floor(maxTokens * 0.2)));
}

/**
 * The reasoning budget at "Maximum": everything the output window allows
 * except the room the final answer needs. `max_tokens` counts reasoning and
 * answer together, so the budget must stay strictly below it or the answer is
 * cut off after the thinking.
 */
export function maxReasoningBudget(maxTokens: number): number {
  return Math.max(1_024, maxTokens - answerReserve(maxTokens));
}

/** Headroom between the estimated prompt and the context window. */
export function promptSafetyMargin(contextLength: number): number {
  return Math.max(1_024, Math.floor(contextLength * 0.02));
}

export function buildOpenRouterRequest(
  model: CatalogModel,
  reasoningLevel: ReasoningLevel,
  messages: ChatMessage[],
  options: OpenRouterRequestOptions = {},
): Record<string, unknown> {
  const supported = new Set(model.supported_parameters || []);

  // A modality the model cannot read is refused here, before any cost.
  const modalities = new Set(model.architecture?.input_modalities || ['text']);
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content as Array<{ type: string }>) {
      const modality = ({ image_url: 'image', input_audio: 'audio', video_url: 'video', file: 'file', text: 'text' } as Record<string, string>)[part.type];
      if (!modality || !modalities.has(modality)) {
        throw new CapabilityError('MODEL_MODALITY_UNAVAILABLE', `${model.id} cannot accept ${part.type}.`);
      }
    }
  }

  const contextLength = Number(model.top_provider?.context_length || model.context_length) || model.context_length;
  const maxCompletion = Number(model.top_provider?.max_completion_tokens) || contextLength;
  const room = contextLength - estimatePromptTokens(messages) - promptSafetyMargin(contextLength);
  const maxTokens = Math.max(256, Math.min(maxCompletion, room));

  const body: Record<string, unknown> = {
    model: model.id,
    messages: applyPromptCaching(messages as unknown as CacheableMessage[], options.adapter || 'openrouter', model.id),
    max_tokens: maxTokens,
    // Every parameter sent must be honoured by the provider that serves it.
    provider: { require_parameters: true },
    // The real cost of the call, returned with the usage block.
    usage: { include: true },
  };

  const fallbacks = [...new Set((options.fallbackModels || []).filter(id => id && id !== model.id))];
  if (fallbacks.length) body.models = [model.id, ...fallbacks];

  if (options.tools?.length) {
    // Tools are a contract: a coder with no tools cannot write a file. The
    // gateway treats this as the model's failure and moves to one that can.
    if (!supported.has('tools')) {
      throw new CapabilityError('MODEL_CAPABILITY_UNAVAILABLE', `${model.id} does not advertise tools support.`);
    }
    body.tools = options.tools;
    if (options.toolChoice && options.toolChoice !== 'none' && supported.has('tool_choice')) body.tool_choice = options.toolChoice;
  }

  if (options.responseFormat) {
    const wantsSchema = (options.responseFormat as { type?: string }).type === 'json_schema';
    if (wantsSchema && supported.has('structured_outputs')) body.response_format = options.responseFormat;
    else if (supported.has('response_format')) body.response_format = wantsSchema ? { type: 'json_object' } : options.responseFormat;
    // Otherwise omitted: every caller that asks for JSON already survives prose.
  }

  if (supported.has('reasoning')) {
    body.reasoning = reasoningLevel === 'none'
      ? { enabled: false }
      : reasoningLevel === 'max'
        ? { max_tokens: maxReasoningBudget(maxTokens) }
        : { effort: reasoningLevel };
  }

  if (options.stream !== false) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  logOpenRouterRequest(body, reasoningLevel);
  return body;
}

/**
 * In development, the request as sent — minus the conversation itself.
 *
 * What it proves is the part that used to be wrong: the level the user chose
 * and the limits the model allows actually reach the wire.
 */
export function describeOpenRouterRequest(body: Record<string, unknown>, reasoningLevel: ReasoningLevel) {
  return {
    model: body.model,
    fallbacks: Array.isArray(body.models) ? (body.models as string[]).slice(1) : [],
    reasoning_level: reasoningLevel,
    reasoning: body.reasoning ?? null,
    max_tokens: body.max_tokens,
    tools: Array.isArray(body.tools) ? body.tools.length : 0,
    tool_choice: body.tool_choice ?? null,
    response_format: (body.response_format as { type?: string } | undefined)?.type ?? null,
    stream: body.stream === true,
    messages: Array.isArray(body.messages) ? body.messages.length : 0,
  };
}

function logOpenRouterRequest(body: Record<string, unknown>, reasoningLevel: ReasoningLevel) {
  const enabled = process.env.CODEN_LOG_OPENROUTER_REQUESTS === '1'
    || (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test' && process.env.CODEN_LOG_OPENROUTER_REQUESTS !== '0');
  if (enabled) console.info('[coden:openrouter_request]', describeOpenRouterRequest(body, reasoningLevel));
}
