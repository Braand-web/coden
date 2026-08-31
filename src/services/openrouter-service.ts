import { validateAllowedModel } from './ai-validator.ts';
import { MODEL_REGISTRY } from '../config/ai-models.ts';
import { toOpenRouterChatPayloadExtras, type ProviderRequestConfig } from './provider-adapters.ts';
import { applyPromptCaching, type CacheableMessage } from './prompt-caching.ts';
import { ToolCallStreamAccumulator, type AssembledToolCall } from './tool-call-stream-accumulator.ts';

export const OPENROUTER_API_KEY_ENV_NAMES = [
  'OPENROUTER_API_KEY',
  'OPEN_ROUTER_API_KEY',
  'OPENROUTER_KEY',
  'OPENROUTER_TOKEN',
] as const;

type OpenRouterEnv = Record<string, string | undefined>;

export function cleanOpenRouterHeaderValue(value: unknown): string {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
}

export function resolveOpenRouterApiKey(env: OpenRouterEnv = process.env, fallback = ''): string {
  const candidates = [
    ...OPENROUTER_API_KEY_ENV_NAMES.map(name => env[name]),
    fallback,
  ];
  for (const value of candidates) {
    const clean = cleanOpenRouterHeaderValue(value);
    if (clean && !clean.includes('***')) return clean;
  }
  return '';
}

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ChatContentPart[];
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export function buildVisionMessageContent(
  text: string,
  images: Array<{ url: string; detail?: 'auto' | 'low' | 'high' }> = [],
): ChatContentPart[] {
  return [
    { type: 'text', text: String(text || '') },
    ...images
      .filter(image => /^https?:\/\/|^data:image\//i.test(String(image.url || '')))
      .slice(0, 8)
      .map(image => ({
        type: 'image_url' as const,
        image_url: { url: image.url, detail: image.detail || 'auto' },
      })),
  ];
}

export interface OpenRouterConfig {
  apiKey: string;
  siteUrl: string;
  appName: string;
}

export interface ChatCompletionResult {
  text: string;
  model: string;
  tool_calls?: ToolCall[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
  };
  cost_usd: number;
}

export type StreamChatEvent =
  | { type: 'token'; text: string; model: string }
  | { type: 'usage'; usage: ChatCompletionResult['usage']; cost_usd: number; model: string }
  | { type: 'tool_calls'; tool_calls: AssembledToolCall[]; model: string };

export class OpenRouterService {
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = {
      apiKey: this.cleanHeaderValue(config.apiKey),
      siteUrl: this.cleanHeaderValue(config.siteUrl) || 'https://coden.fun',
      appName: this.cleanHeaderValue(config.appName) || 'Coden',
    };
  }

  /**
   * Main chat completion logic with exponential backoff retries, robust timeouts, and full token tracking.
   */
  async chat(
    modelId: string,
    messages: ChatMessage[],
    retryAttempts = 3,
    timeoutMs = 45000,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    // 1. Validate models against strict allowlist
    validateAllowedModel(modelId);

    const payload = this.buildChatPayload(modelId, messages, runtimeConfig);

    let attempt = 0;
    let delay = 1000; // start with 1s backoff

    while (attempt < retryAttempts) {
      attempt++;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: this.buildHeaders(),
          signal: combineAbortSignals(signal, controller.signal) as any,
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errMsg = await this.readProviderError(response);
          throw new Error(`OpenRouter HTTP ${response.status}: ${errMsg || response.statusText}`);
        }

        const data: any = await response.json();

        if (data?.error) {
          throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`);
        }

        const choice = data?.choices?.[0];
        const text = typeof choice?.message?.content === 'string' ? choice.message.content : choice?.text || '';
        const tool_calls = Array.isArray(choice?.message?.tool_calls)
          ? choice.message.tool_calls
            .filter((call: any) => call?.id && call?.function?.name)
            .map((call: any) => ({
              id: String(call.id),
              type: 'function' as const,
              function: {
                name: String(call.function.name),
                arguments: String(call.function.arguments || '{}'),
              },
            }))
          : undefined;
        
        // Extract token usage metrics
        const usage = data?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const prompt_tokens = usage.prompt_tokens || 0;
        const completion_tokens = usage.completion_tokens || 0;
        const total_tokens = usage.total_tokens || 0;
        const cached_tokens = data?.usage?.prompt_tokens_details?.cached || 0;

        // Custom price lookup matching OpenRouter standard rates where possible
        // or using estimated average fallback ($10 / million tokens for standard pro models)
        const realCost = Number(data?.usage?.cost ?? data?.cost ?? data?.price);
        const real_or_est_cost = Number.isFinite(realCost)
          ? realCost
          : this.estimateUsdCost(data?.model || modelId, prompt_tokens, completion_tokens);

        return {
          text,
          model: data?.model || modelId,
          tool_calls,
          usage: {
            prompt_tokens,
            completion_tokens,
            total_tokens,
            cached_tokens
          },
          cost_usd: real_or_est_cost
        };

      } catch (err: any) {
        if (attempt >= retryAttempts || err?.name === 'AbortError') {
          throw new Error(`Failed AI response after ${attempt} attempts: ${err.message}`);
        }
        console.warn(`[OPENROUTER CLIENT] Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // exponential backoff
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    throw new Error('Fallback block unreachable state.');
  }

  async getCatalog() {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) throw new Error('Failed to fetch OpenRouter catalog');
    return await response.json();
  }

  async *streamChat(
    modelId: string,
    messages: ChatMessage[],
    timeoutMs = 120_000,  // increased from 90s — long code generations can take 2-3min
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChatEvent> {
    validateAllowedModel(modelId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: this.buildHeaders(),
        signal: combineAbortSignals(signal, controller.signal) as any,
        body: JSON.stringify({
          ...this.buildChatPayload(modelId, messages, runtimeConfig),
          stream: true,
          stream_options: { include_usage: true }
        })
      });

      if (!response.ok) {
        const errMsg = await this.readProviderError(response);
        throw new Error(`OpenRouter HTTP ${response.status}: ${errMsg || response.statusText}`);
      }

      if (!response.body) {
        throw new Error('OpenRouter streaming response body is empty');
      }

      let buffer = '';
      let model = modelId;
      // Partial-JSON accumulator for cross-chunk SSE data fragments
      let partialData = '';
      // Structured tool-call accumulator: stitches fragmented delta.tool_calls
      // chunks back into complete calls (parallel-call safe by index).
      const toolCalls = new ToolCallStreamAccumulator();

      for await (const chunk of response.body as any) {
        buffer += Buffer.from(chunk).toString('utf8');
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          // Skip SSE comment/heartbeat lines
          if (!part.trim() || part.trim().startsWith(':')) continue;

          const lines = part.split('\n').filter(line => line.startsWith('data:'));
          for (const line of lines) {
            const raw = line.replace(/^data:\s*/, '').trim();
            if (!raw || raw === '[DONE]') {
              partialData = '';
              continue;
            }

            // Robust JSON parse with partial-data recovery
            const candidate = partialData + raw;
            let data: any;
            try {
              data = JSON.parse(candidate);
              partialData = ''; // reset on success
            } catch {
              // Accumulate if it looks like a partial JSON object/array
              if (candidate.trim().startsWith('{') || candidate.trim().startsWith('[')) {
                partialData = candidate;
                continue;
              }
              // Not recoverable — skip and reset
              partialData = '';
              continue;
            }

            if (data?.error) {
              throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`);
            }
            model = data?.model || model;
            const delta = data?.choices?.[0]?.delta;
            const text = delta?.content || data?.choices?.[0]?.text || '';
            if (text) {
              yield { type: 'token', text, model };
            }
            // Accumulate streamed tool_calls deltas — emitted at end of stream.
            if (Array.isArray(delta?.tool_calls)) {
              toolCalls.ingestDeltaArray(delta.tool_calls);
            }

            if (data?.usage) {
              const usage = data.usage;
              const promptTokens = usage.prompt_tokens || 0;
              const completionTokens = usage.completion_tokens || 0;
              yield {
                type: 'usage',
                model,
                usage: {
                  prompt_tokens: promptTokens,
                  completion_tokens: completionTokens,
                  total_tokens: usage.total_tokens || promptTokens + completionTokens,
                  cached_tokens: usage?.prompt_tokens_details?.cached || 0,
                },
                cost_usd: Number.isFinite(Number(data?.usage?.cost ?? data?.cost ?? data?.price))
                  ? Number(data?.usage?.cost ?? data?.cost ?? data?.price)
                  : this.estimateUsdCost(model, promptTokens, completionTokens),
              };
            }
          }
        }
      }
      // Emit any accumulated tool calls once the stream is done.
      if (toolCalls.hasCalls()) {
        const finalized = toolCalls.finalize();
        if (finalized.length > 0) {
          yield { type: 'tool_calls', tool_calls: finalized, model };
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private cleanHeaderValue(value: string): string {
    return cleanOpenRouterHeaderValue(value);
  }

  private resolveApiKey(): string {
    return resolveOpenRouterApiKey(process.env, this.config.apiKey);
  }

  private buildHeaders() {
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured.');
    }

    return {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': this.config.siteUrl,
      'X-Title': this.config.appName,
      'Content-Type': 'application/json',
    };
  }

  private buildChatPayload(modelId: string, messages: ChatMessage[], runtimeConfig?: ProviderRequestConfig) {
    // ProviderGateway already performs strict, allowlisted fallback one model at
    // a time. Sending OpenRouter's multi-model `models` body here makes
    // diagnostics opaque and some providers reject the request shape during
    // streaming. Keep the provider payload OpenAI-compatible and simple.
    // Anthropic prompt caching: mark the large stable blocks so Claude reuses
    // them at ~10% input price. No-op for other adapters.
    const cachedMessages = applyPromptCaching(messages as unknown as CacheableMessage[], runtimeConfig?.adapter || 'openrouter');
    return {
      model: modelId,
      messages: cachedMessages,
      ...toOpenRouterChatPayloadExtras(runtimeConfig),
    };
  }

  private async readProviderError(response: any): Promise<string> {
    const raw = await response.text().catch(() => '');
    if (!raw) return response.statusText || 'Provider returned an empty error response';

    try {
      const parsed = JSON.parse(raw);
      const error = parsed?.error || parsed;
      const message = String(error?.message || parsed?.message || '').trim();
      const code = String(error?.code || parsed?.code || '').trim();
      const metadata = code ? ` (${code})` : '';
      if (message) return `${message}${metadata}`;
    } catch {
      // Fall through to a bounded raw message. OpenRouter error bodies can be
      // verbose; never propagate arbitrary provider payloads into public UI.
    }

    return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
  }

  private estimateUsdCost(model: string, prompt: number, completion: number): number {
    const definition = MODEL_REGISTRY.find(item => item.id === model);
    if (!definition) return 0;
    return (prompt * definition.inputUsdPerMillion / 1_000_000)
      + (completion * definition.outputUsdPerMillion / 1_000_000);
  }
}

function combineAbortSignals(external: AbortSignal | undefined, timeout: AbortSignal): AbortSignal {
  if (!external) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([external, timeout]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  external.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', abort, { once: true });
  return controller.signal;
}
