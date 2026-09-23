import { validateAllowedModel } from './ai-validator.ts';
import { MODEL_REGISTRY, getModelTokenPricing } from '../config/ai-models.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';
import { ToolCallStreamAccumulator, type AssembledToolCall } from './tool-call-stream-accumulator.ts';
import { ProviderCancelledError, ProviderHttpError, ProviderTimeoutError, isRetryableStatus } from './provider-errors.ts';
import { openRouterCatalog, type OpenRouterCapabilities } from './openrouter-capabilities.ts';
import { buildOpenRouterRequest, DEFAULT_REASONING_LEVEL, maxReasoningBudget } from './openrouter-request.ts';
import { decryptSecret } from '../lib/secret-box.ts';
import { readProviderSse } from './provider-sse.ts';

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

/**
 * The platform key, read on the server only.
 *
 * `OPENROUTER_API_KEY_ENCRYPTED` (AES-256-GCM, sealed with `CODEN_SECRETS_KEY`
 * by `npm run secret:encrypt`) wins over a plain variable, so the key can be
 * stored at rest encrypted. Neither value is ever serialised to a client.
 */
export function resolveOpenRouterApiKey(env: OpenRouterEnv = process.env, fallback = ''): string {
  const sealed = cleanOpenRouterHeaderValue(env.OPENROUTER_API_KEY_ENCRYPTED);
  if (sealed) {
    const opened = cleanOpenRouterHeaderValue(decryptSecret(sealed, env.CODEN_SECRETS_KEY));
    if (opened) return opened;
  }
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
  /**
   * The provider's reasoning blocks, handed back unchanged on the assistant
   * turn that made tool calls. Some providers (Anthropic, Gemini) need them to
   * continue a reasoning chain across a tool result.
   */
  reasoning_details?: unknown[];
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
  /** The reasoning the model returned, when it returned any. */
  reasoning?: string;
  reasoning_details?: unknown[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cached_tokens?: number;
    /**
     * Private reasoning the model was paid for.
     *
     * Providers bill these at the output rate and report them inside
     * `completion_tokens_details`. Nothing read them, so a run at high effort
     * was costed as though it had not reasoned at all — the one number that
     * grows fastest with the effort control and the only one that was missing.
     *
     * They are part of `completion_tokens`, not additional to it: kept as a
     * separate figure for attribution, never added to the total again.
     */
    reasoning_tokens?: number;
  };
  cost_usd: number;
}

export type StreamChatEvent =
  | { type: 'token'; text: string; model: string }
  | { type: 'reasoning'; text: string; model: string }
  | { type: 'usage'; usage: ChatCompletionResult['usage']; cost_usd: number; model: string }
  | { type: 'tool_calls'; tool_calls: AssembledToolCall[]; model: string; reasoning_details?: unknown[] };

const CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Exponential with full jitter, so a burst of 429s from many runs does not
 * come back in lockstep; a provider's own `Retry-After` wins when it sends one.
 */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null, random = Math.random, baseMs = BASE_BACKOFF_MS): number {
  const retryAfter = parseRetryAfter(retryAfterHeader);
  if (retryAfter !== null) return Math.min(30_000, retryAfter);
  const ceiling = Math.min(MAX_BACKOFF_MS, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + random() * ceiling / 2);
}

function parseRetryAfter(value?: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isRetryableFailure(error: any, signal?: AbortSignal): boolean {
  if (signal?.aborted || error instanceof ProviderCancelledError) return false;
  if (error instanceof ProviderHttpError) return isRetryableStatus(error.status);
  if (error instanceof ProviderTimeoutError) return true;
  // A dropped connection before the model finished is worth one more try;
  // a refusal on the merits (capability, truncation, bad JSON) is not.
  return /PROVIDER_STREAM_INTERRUPTED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network/i.test(String(error?.message || ''));
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal?.aborted) return reject(new ProviderCancelledError());
  const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
  const onAbort = () => { clearTimeout(timer); reject(new ProviderCancelledError()); };
  signal?.addEventListener('abort', onAbort, { once: true });
});

/**
 * Adjust a refused request once, in place, when the refusal names its own fix.
 *
 *   - Some models reason unconditionally ("reasoning is mandatory"): at the
 *     "Aucun" level the request then omits `reasoning` and lets the model use
 *     its minimum, instead of failing the turn.
 *   - OpenRouter refuses a `max_tokens` the account cannot cover and says how
 *     many it can ("can only afford N"): the request asks for exactly that,
 *     with the reasoning budget kept strictly below it.
 */
export function adjustForRefusal(payload: Record<string, any>, status: number, message: string): boolean {
  if (status === 400 && payload.reasoning?.enabled === false && /reasoning/i.test(message) && /mandatory|required|cannot be disabled|must be enabled/i.test(message)) {
    delete payload.reasoning;
    return true;
  }
  const affordable = status === 402 ? Number(/can only afford (\d+)/i.exec(message)?.[1]) : NaN;
  if (Number.isFinite(affordable) && affordable >= 256 && affordable < Number(payload.max_tokens)) {
    payload.max_tokens = affordable;
    if (payload.reasoning?.max_tokens) payload.reasoning = { max_tokens: maxReasoningBudget(affordable) };
    console.warn('[coden:openrouter_max_tokens_reduced]', { model: payload.model, max_tokens: affordable });
    return true;
  }
  return false;
}

/** The readable text of a reasoning delta, whichever shape the provider used. */
function reasoningText(delta: any): string {
  if (typeof delta?.reasoning === 'string' && delta.reasoning) return delta.reasoning;
  if (!Array.isArray(delta?.reasoning_details)) return '';
  return delta.reasoning_details
    .map((detail: any) => detail?.type === 'reasoning.text' ? detail.text : detail?.type === 'reasoning.summary' ? detail.summary : '')
    .filter((text: unknown) => typeof text === 'string' && text)
    .join('');
}

export class OpenRouterService {
  private config: OpenRouterConfig;
  private capabilities: OpenRouterCapabilities;

  constructor(config: OpenRouterConfig, capabilities: OpenRouterCapabilities = openRouterCatalog) {
    this.config = {
      apiKey: this.cleanHeaderValue(config.apiKey),
      siteUrl: this.cleanHeaderValue(config.siteUrl) || 'https://coden.fun',
      appName: this.cleanHeaderValue(config.appName) || 'Coden',
    };
    this.capabilities = capabilities;
  }

  /**
   * One complete answer, read from a stream.
   *
   * Every request streams — a long answer arrives as it is written instead of
   * holding a socket silent until a proxy closes it — and this collects the
   * pieces. A transient failure (429, 5xx, timeout, dropped stream) is retried
   * with exponential backoff; nothing has reached the caller yet, so a retry
   * is invisible.
   */
  async chat(
    modelId: string,
    messages: ChatMessage[],
    retryAttempts = 3,
    timeoutMs = 45000,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    validateAllowedModel(modelId);
    const attempts = Math.max(1, retryAttempts);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.collect(modelId, messages, timeoutMs, runtimeConfig, signal);
      } catch (error: any) {
        if (attempt >= attempts || !isRetryableFailure(error, signal)) throw error;
        const delay = retryDelayMs(attempt, (error as any)?.retryAfter);
        console.warn(`[OPENROUTER CLIENT] Attempt ${attempt} failed: ${error?.message}. Retrying in ${delay}ms...`);
        await sleep(delay, signal);
      }
    }
  }

  private async collect(
    modelId: string,
    messages: ChatMessage[],
    timeoutMs: number,
    runtimeConfig: ProviderRequestConfig | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ChatCompletionResult> {
    let text = '';
    let reasoning = '';
    let model = modelId;
    let usage: ChatCompletionResult['usage'] = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let cost = 0;
    let tool_calls: ToolCall[] | undefined;
    let reasoning_details: unknown[] | undefined;
    for await (const event of this.streamChat(modelId, messages, timeoutMs, runtimeConfig, signal, 1)) {
      model = event.model || model;
      if (event.type === 'token') text += event.text;
      else if (event.type === 'reasoning') reasoning += event.text;
      else if (event.type === 'usage') { usage = event.usage; cost = event.cost_usd; }
      else if (event.type === 'tool_calls') {
        tool_calls = event.tool_calls.map(call => ({ id: call.id, type: 'function' as const, function: { name: call.function.name, arguments: call.function.arguments || '{}' } }));
        reasoning_details = event.reasoning_details;
      }
    }
    return {
      text,
      model,
      ...(tool_calls?.length ? { tool_calls } : {}),
      ...(reasoning ? { reasoning } : {}),
      ...(reasoning_details?.length ? { reasoning_details } : {}),
      usage,
      cost_usd: cost,
    };
  }

  async getCatalog() {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) throw new Error('Failed to fetch OpenRouter catalog');
    return await response.json();
  }

  /**
   * The request is built by `buildOpenRouterRequest` from the live catalogue
   * entry — the model's own limits, reasoning, tools — and nothing else.
   */
  private async buildRequest(modelId: string, messages: ChatMessage[], runtimeConfig: ProviderRequestConfig | undefined, signal?: AbortSignal) {
    const model = await this.capabilities.get(modelId, signal);
    return buildOpenRouterRequest(model, runtimeConfig?.reasoningLevel ?? DEFAULT_REASONING_LEVEL, messages, {
      tools: runtimeConfig?.tools,
      toolChoice: runtimeConfig?.toolChoice,
      responseFormat: runtimeConfig?.responseFormat,
      fallbackModels: runtimeConfig?.fallbackModels,
      adapter: runtimeConfig?.adapter,
      stream: true,
    });
  }

  /**
   * Stream one answer: text, reasoning, tool calls and the real cost.
   *
   * Connection failures (429, 5xx, timeouts before the first byte) are retried
   * here with exponential backoff, because nothing has been shown yet. Once
   * the first byte has arrived a failure is surfaced: the caller has already
   * displayed part of the answer and must decide what a retry means.
   */
  async *streamChat(
    modelId: string,
    messages: ChatMessage[],
    timeoutMs = 120_000,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
    connectAttempts = 3,
  ): AsyncGenerator<StreamChatEvent> {
    validateAllowedModel(modelId);
    const payload = await this.buildRequest(modelId, messages, runtimeConfig, signal);

    const controller = new AbortController();
    // A healthy large code generation can exceed the conversational timeout,
    // but it must never remain silent or run forever. Reset the idle timer on
    // every network chunk and retain a separate hard deadline.
    let idleTimeout: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimeout = () => {
      if (idleTimeout) clearTimeout(idleTimeout);
      idleTimeout = setTimeout(() => controller.abort(), timeoutMs);
    };
    const hardTimeoutMs = Math.max(timeoutMs, Math.min(timeoutMs * 3, 600_000));
    const hardTimeout = setTimeout(() => controller.abort(), hardTimeoutMs);

    try {
      let response: Response | undefined;
      let adjusted = false;
      for (let attempt = 1; ; attempt += 1) {
        armIdleTimeout();
        try {
          response = await fetch(CHAT_COMPLETIONS_URL, {
            method: 'POST',
            headers: this.buildHeaders(),
            signal: combineAbortSignals(signal, controller.signal) as any,
            body: JSON.stringify(payload),
          });
          if (!response.ok) {
            const errMsg = await this.readProviderError(response);
            // Two refusals the same request can recover from at once, before
            // anything is shown: see `adjustForRefusal`.
            if (!adjusted && adjustForRefusal(payload, response.status, errMsg)) {
              adjusted = true;
              attempt -= 1;
              continue;
            }
            const error = new ProviderHttpError('OpenRouter', response.status, errMsg || response.statusText);
            (error as any).retryAfter = response.headers?.get?.('retry-after');
            throw error;
          }
          break;
        } catch (error: any) {
          const normalized = error?.name === 'AbortError'
            ? (signal?.aborted ? new ProviderCancelledError() : new ProviderTimeoutError('OpenRouter', timeoutMs))
            : error;
          if (attempt >= connectAttempts || !isRetryableFailure(normalized, signal) || controller.signal.aborted) throw normalized;
          const delay = retryDelayMs(attempt, (error as any)?.retryAfter);
          console.warn(`[OPENROUTER CLIENT] Connection attempt ${attempt} failed: ${normalized?.message}. Retrying in ${delay}ms...`);
          await sleep(delay, signal);
        }
      }

      if (!response?.body) {
        throw new Error('OpenRouter streaming response body is empty');
      }

      let model = modelId;
      let completed = false;
      let finishReason = '';
      // Structured tool-call accumulator: stitches fragmented delta.tool_calls
      // chunks back into complete calls (parallel-call safe by index).
      const toolCalls = new ToolCallStreamAccumulator();
      const reasoningDetails: unknown[] = [];

      for await (const raw of readProviderSse(response.body as any, armIdleTimeout)) {
        if (!raw.trim()) continue;
        if (raw.trim() === '[DONE]') { completed = true; break; }
        let data: any;
        try {
          data = JSON.parse(raw);
        } catch {
          throw new Error('PROVIDER_STREAM_INVALID_JSON');
        }

        if (data?.error) {
          throw new Error(`OpenRouter API Error: ${data.error.message || JSON.stringify(data.error)}`);
        }
        model = data?.model || model;
        const choice = data?.choices?.[0];
        if (choice?.finish_reason) finishReason = String(choice.finish_reason);
        const delta = choice?.delta;
        const thought = reasoningText(delta);
        if (thought) yield { type: 'reasoning', text: thought, model };
        if (Array.isArray(delta?.reasoning_details)) reasoningDetails.push(...delta.reasoning_details);
        const text = delta?.content || choice?.text || '';
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
          const reported = Number(usage?.cost ?? data?.cost ?? data?.price);
          yield {
            type: 'usage',
            model,
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: usage.total_tokens || promptTokens + completionTokens,
              cached_tokens: usage?.prompt_tokens_details?.cached_tokens || usage?.prompt_tokens_details?.cached || 0,
              reasoning_tokens: Number(usage?.completion_tokens_details?.reasoning_tokens || 0) || 0,
            },
            cost_usd: Number.isFinite(reported) ? reported : this.estimateUsdCost(model, promptTokens, completionTokens),
          };
        }
      }
      if (!completed) throw new Error('PROVIDER_STREAM_INTERRUPTED: terminal marker missing.');
      // `max_tokens` is already the model's own ceiling: reaching it is a real
      // truncation, reported as one rather than passed off as a full answer.
      if (finishReason === 'length') throw new Error('MODEL_OUTPUT_TRUNCATED: completion token limit reached.');
      // Emit any accumulated tool calls once the stream is done.
      if (toolCalls.hasCalls()) {
        const finalized = toolCalls.finalize();
        if (finalized.length > 0) {
          yield { type: 'tool_calls', tool_calls: finalized, model, ...(reasoningDetails.length ? { reasoning_details: reasoningDetails } : {}) };
        }
      }
    } catch (err: any) {
      // An abort is two different events wearing one name: the user pressing
      // stop, and our own timeout. Only the second is a transient failure.
      if (err?.name === 'AbortError') {
        if (signal?.aborted) throw new ProviderCancelledError();
        throw new ProviderTimeoutError('OpenRouter', timeoutMs);
      }
      throw err;
    } finally {
      if (idleTimeout) clearTimeout(idleTimeout);
      clearTimeout(hardTimeout);
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

  /** Used only when OpenRouter did not report the cost: live pricing first, the registry second. */
  private estimateUsdCost(model: string, prompt: number, completion: number): number {
    const live = this.capabilities.peek(model)?.pricing;
    const liveInput = Number(live?.prompt);
    const liveOutput = Number(live?.completion);
    if (Number.isFinite(liveInput) && Number.isFinite(liveOutput) && liveInput >= 0 && liveOutput >= 0) {
      return prompt * liveInput + completion * liveOutput;
    }
    const definition = MODEL_REGISTRY.find(item => item.id === model);
    if (!definition) return 0;
    const pricing = getModelTokenPricing(definition, prompt);
    return (prompt * pricing.inputUsdPerMillion / 1_000_000)
      + (completion * pricing.outputUsdPerMillion / 1_000_000);
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
