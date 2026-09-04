import {
  AI_MODEL_FALLBACKS,
  DEFAULT_PROVIDER_MODEL_ID,
  isAllowedModelId,
  type AllowedModelId,
} from '../config/ai-models.ts';
import { validateAllowedModel } from './ai-validator.ts';
import type { ChatCompletionResult, ChatMessage, OpenRouterService, StreamChatEvent } from './openrouter-service.ts';
import type { AnthropicService } from './anthropic-service.ts';
import type { ProviderRequestConfig } from './provider-adapters.ts';
import { ProviderCancelledError, ProviderHttpError, ProviderTimeoutError, isRetryableStatus } from './provider-errors.ts';

type CircuitState = {
  failures: number;
  blockedUntil: number;
};

type ModelRuntimeMetric = {
  model_id: string;
  requests: number;
  successes: number;
  failures: number;
  retries: number;
  fallback_uses: number;
  total_latency_ms: number;
  last_error_code: string | null;
  last_used_at: string | null;
};

export class ProviderGatewayError extends Error {
  diagnosticCode: string;
  statusCode: number;
  retryable: boolean;
  modelId?: string;

  constructor(message: string, options: { diagnosticCode: string; statusCode?: number; retryable?: boolean; modelId?: string }) {
    super(message);
    this.name = 'ProviderGatewayError';
    this.diagnosticCode = options.diagnosticCode;
    this.statusCode = options.statusCode || 502;
    this.retryable = Boolean(options.retryable);
    this.modelId = options.modelId;
  }
}

/** A stream failure that arrived after output was already yielded. */
class StreamAlreadyStarted extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super('stream failed after emitting output');
    this.cause = cause;
  }
}

export class ProviderGateway {
  private circuits = new Map<string, CircuitState>();
  private metrics = new Map<string, ModelRuntimeMetric>();
  private openRouter: OpenRouterService;
  private options: { breakerMs?: number; failureThreshold?: number; anthropic?: AnthropicService };

  constructor(openRouter: OpenRouterService, options: { breakerMs?: number; failureThreshold?: number; anthropic?: AnthropicService } = {}) {
    this.openRouter = openRouter;
    this.options = options;
  }

  resolveAutoModel(policy: 'economy' | 'balanced' | 'premium' | 'auto' = 'auto'): AllowedModelId {
    if (policy === 'premium') return 'openai/gpt-5.6-sol';
    if (policy === 'balanced') return 'openai/gpt-5.6-terra';
    return 'openai/gpt-5.6-luna';
  }

  async chat(modelId: string, messages: ChatMessage[], options: {
    timeoutMs?: number;
    maxAttempts?: number;
    runtimeConfig?: ProviderRequestConfig;
    runtimeConfigForModel?: (modelId: AllowedModelId) => ProviderRequestConfig | undefined;
    allowFallback?: boolean;
    onFallback?: (event: { from: AllowedModelId; to: AllowedModelId; reason: string }) => void;
    validateResult?: (result: ChatCompletionResult) => void;
    signal?: AbortSignal;
  } = {}): Promise<ChatCompletionResult> {
    const primary = this.requireProviderModel(modelId);
    // Cross-model recovery is opt-in. Callers enable it only for Auto before
    // a user-visible result exists; every other request remains model-pinned.
    const candidates = this.candidatesFor(primary, options.allowFallback === true);
    const maxAttempts = Math.max(1, options.maxAttempts || 2);
    let lastError: any = null;

    for (const candidate of candidates) {
      const candidateRuntimeConfig = options.runtimeConfigForModel?.(candidate) || options.runtimeConfig;
      if (candidate !== primary) {
        this.noteFallbackUse(candidate);
        try {
          options.onFallback?.({
            from: primary,
            to: candidate,
            reason: this.classifyError(lastError, primary).diagnosticCode,
          });
        } catch {
          // Observability must never break the recovery path.
        }
      }
      const circuitError = this.getCircuitError(candidate);
      if (circuitError) {
        lastError = circuitError;
        continue;
      }
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const startedAt = Date.now();
        this.noteRequest(candidate);
        try {
          const result = await this.chatWithProvider(candidate, messages, options.timeoutMs || 45_000, candidateRuntimeConfig, options.signal);
          options.validateResult?.(result);
          this.noteMetricSuccess(candidate, Date.now() - startedAt);
          this.noteSuccess(candidate);
          return result;
        } catch (error: any) {
          lastError = error;
          const classified = this.classifyError(error, candidate);
          this.noteFailure(candidate, classified.retryable);
          this.noteMetricFailure(candidate, classified.diagnosticCode, Date.now() - startedAt);
          if (!classified.retryable) {
            throw classified;
          }
          if (attempt >= maxAttempts) break;
          this.noteRetry(candidate);
          await sleep(250 * attempt);
        }
      }
    }

    throw this.classifyError(lastError, primary);
  }

  async *streamChat(modelId: string, messages: ChatMessage[], options: {
    timeoutMs?: number;
    runtimeConfig?: ProviderRequestConfig;
    runtimeConfigForModel?: (modelId: AllowedModelId) => ProviderRequestConfig | undefined;
    allowFallback?: boolean;
    onFallback?: (event: { from: AllowedModelId; to: AllowedModelId; reason: string }) => void;
    signal?: AbortSignal;
  } = {}): AsyncGenerator<StreamChatEvent> {
    const primary = this.requireProviderModel(modelId);
    // A stream can recover only when its Auto caller explicitly opts in.
    const candidates = this.candidatesFor(primary, options.allowFallback === true);
    let lastError: any = null;

    for (const candidate of candidates) {
      const candidateRuntimeConfig = options.runtimeConfigForModel?.(candidate) || options.runtimeConfig;
      if (candidate !== primary) {
        this.noteFallbackUse(candidate);
        try {
          options.onFallback?.({
            from: primary,
            to: candidate,
            reason: this.classifyError(lastError, primary).diagnosticCode,
          });
        } catch {
          // Observability must never break provider recovery.
        }
      }
      const circuitError = this.getCircuitError(candidate);
      if (circuitError) {
        lastError = circuitError;
        continue;
      }
      let yieldedAnyEvent = false;
      const startedAt = Date.now();
      this.noteRequest(candidate);
      try {
        yield* this.streamAttempts(candidate, messages, options, candidateRuntimeConfig, () => { yieldedAnyEvent = true; });
        this.noteMetricSuccess(candidate, Date.now() - startedAt);
        this.noteSuccess(candidate);
        return;
      } catch (error: any) {
        if (error instanceof StreamAlreadyStarted) {
          yieldedAnyEvent = true;
          throw this.classifyError(error.cause, candidate);
        }
        lastError = error;
        const classified = this.classifyError(error, candidate);
        this.noteFailure(candidate, classified.retryable);
        this.noteMetricFailure(candidate, classified.diagnosticCode, Date.now() - startedAt);
        if (yieldedAnyEvent || !classified.retryable) throw classified;
      }
    }

    throw this.classifyError(lastError, primary);
  }

  /**
   * Collect a provider stream into one atomic completion.
   *
   * Project generation must remain atomic because partial JSON cannot be
   * applied safely, but it should not use a non-streaming HTTP request that
   * can sit silent until a large artifact is complete. This method consumes
   * the provider stream privately, validates the complete artifact, and only
   * then returns it to the caller. Since no partial output escapes, Auto may
   * safely try one configured fallback after a provider or validation error.
   */
  async streamingCompletion(modelId: string, messages: ChatMessage[], options: {
    timeoutMs?: number;
    runtimeConfig?: ProviderRequestConfig;
    runtimeConfigForModel?: (modelId: AllowedModelId) => ProviderRequestConfig | undefined;
    allowFallback?: boolean;
    onFallback?: (event: { from: AllowedModelId; to: AllowedModelId; reason: string }) => void;
    validateResult?: (result: ChatCompletionResult) => void;
    signal?: AbortSignal;
    /**
     * Observes the answer as it arrives, for progress reporting only. It never
     * influences the result, and a throw inside it is swallowed so a display
     * concern can never fail a generation.
     */
    onChunk?: (accumulated: string) => void;
  } = {}): Promise<ChatCompletionResult> {
    const primary = this.requireProviderModel(modelId);
    const candidates = this.candidatesFor(primary, options.allowFallback === true);
    let lastError: any = null;

    const collect = async (
      candidate: AllowedModelId,
      runtimeConfig?: ProviderRequestConfig,
    ): Promise<ChatCompletionResult> => {
      let text = '';
      let model: string = candidate;
      let usage: ChatCompletionResult['usage'] = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      let costUsd = 0;
      let toolCalls: ChatCompletionResult['tool_calls'];

      for await (const event of this.streamWithProvider(
        candidate,
        messages,
        options.timeoutMs || 90_000,
        runtimeConfig,
        options.signal,
      )) {
        model = event.model || model;
        if (event.type === 'token') {
          text += event.text;
          if (options.onChunk) {
            try { options.onChunk(text); } catch { /* progress reporting must never break a run */ }
          }
        }
        if (event.type === 'usage') {
          usage = event.usage;
          costUsd = event.cost_usd;
        }
        if (event.type === 'tool_calls') {
          toolCalls = event.tool_calls as ChatCompletionResult['tool_calls'];
        }
      }

      return {
        text,
        model,
        tool_calls: toolCalls,
        usage,
        cost_usd: costUsd,
      };
    };

    for (const candidate of candidates) {
      const candidateRuntimeConfig = options.runtimeConfigForModel?.(candidate) || options.runtimeConfig;
      if (candidate !== primary) {
        this.noteFallbackUse(candidate);
        try {
          options.onFallback?.({
            from: primary,
            to: candidate,
            reason: this.classifyError(lastError, primary).diagnosticCode,
          });
        } catch {
          // Observability must never break recovery.
        }
      }

      const circuitError = this.getCircuitError(candidate);
      if (circuitError) {
        lastError = circuitError;
        continue;
      }

      const startedAt = Date.now();
      this.noteRequest(candidate);
      try {
        const result = await collect(candidate, candidateRuntimeConfig);
        options.validateResult?.(result);
        this.noteMetricSuccess(candidate, Date.now() - startedAt);
        this.noteSuccess(candidate);
        return result;
      } catch (error: any) {
        lastError = error;
        let classified = this.classifyError(error, candidate);
        this.noteFailure(candidate, classified.retryable);
        this.noteMetricFailure(candidate, classified.diagnosticCode, Date.now() - startedAt);
        if (!classified.retryable) throw classified;
      }
    }

    throw this.classifyError(lastError, primary);
  }

  getCircuitSnapshot() {
    const now = Date.now();
    return Array.from(this.circuits.entries()).map(([model_id, state]) => ({
      model_id,
      failures: state.failures,
      blocked: state.blockedUntil > now,
      blocked_until: state.blockedUntil > now ? new Date(state.blockedUntil).toISOString() : null,
    }));
  }

  getRuntimeMetricsSnapshot() {
    return Array.from(this.metrics.values()).map(item => ({
      ...item,
      average_latency_ms: item.requests ? Math.round(item.total_latency_ms / item.requests) : 0,
    }));
  }

  private requireProviderModel(modelId: string): AllowedModelId {
    if (!modelId || modelId === 'auto') {
      throw new ProviderGatewayError('Internal model routing error: auto must be resolved before provider calls.', {
        diagnosticCode: 'AUTO_MODEL_NOT_RESOLVED',
        statusCode: 500,
        retryable: false,
        modelId,
      });
    }
    validateAllowedModel(modelId);
    if (!isAllowedModelId(modelId)) {
      throw new ProviderGatewayError('Selected model is not allowed.', {
        diagnosticCode: 'MODEL_NOT_ALLOWED',
        statusCode: 403,
        retryable: false,
        modelId,
      });
    }
    return modelId;
  }

  private candidatesFor(modelId: AllowedModelId, allowFallback: boolean): AllowedModelId[] {
    if (!allowFallback) return [modelId];
    return [modelId, ...(AI_MODEL_FALLBACKS[modelId] || [])]
      .filter((candidate, index, list) => list.indexOf(candidate) === index)
      .filter(isAllowedModelId);
  }

  /**
   * Try one model's stream a bounded number of times, before any token escapes.
   *
   * A stream had no retry at all: the loop above only moves to the *next*
   * model, and only when the caller opted into fallback. So an explicitly
   * pinned model that hit one 503 — the failure the classifier now finally
   * reports correctly — ended the generation, even though nothing had been
   * shown to the user yet and repeating the request was free of consequence.
   *
   * The moment a token is yielded the retries stop for good. Restarting a
   * stream that has already emitted output would replay it, and the caller has
   * no way to tell the duplicate from the original.
   */
  private async *streamAttempts(
    candidate: AllowedModelId,
    messages: ChatMessage[],
    options: { timeoutMs?: number; signal?: AbortSignal; maxAttempts?: number },
    runtimeConfig: ProviderRequestConfig | undefined,
    markStarted: () => void,
  ): AsyncGenerator<StreamChatEvent> {
    const maxAttempts = Math.max(1, options.maxAttempts || 2);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let started = false;
      try {
        for await (const event of this.streamWithProvider(candidate, messages, options.timeoutMs || 90_000, runtimeConfig, options.signal)) {
          if (!started) { started = true; markStarted(); }
          yield event;
        }
        return;
      } catch (error: any) {
        // Past the first token this is no longer retryable by construction,
        // whatever the error says: the caller has already seen output.
        if (started) throw new StreamAlreadyStarted(error);
        const classified = this.classifyError(error, candidate);
        if (!classified.retryable || attempt >= maxAttempts) throw error;
        this.noteRetry(candidate);
        await sleep(250 * attempt);
      }
    }
  }

  private chatWithProvider(
    modelId: AllowedModelId,
    messages: ChatMessage[],
    timeoutMs: number,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ) {
    return this.openRouter.chat(modelId, messages, 1, timeoutMs, runtimeConfig, signal);
  }

  private streamWithProvider(
    modelId: AllowedModelId,
    messages: ChatMessage[],
    timeoutMs: number,
    runtimeConfig?: ProviderRequestConfig,
    signal?: AbortSignal,
  ) {
    return this.openRouter.streamChat(modelId, messages, timeoutMs, runtimeConfig, signal);
  }

  private getCircuitError(modelId: AllowedModelId): ProviderGatewayError | null {
    const state = this.circuits.get(modelId);
    if (state && state.blockedUntil > Date.now()) {
      return new ProviderGatewayError('The selected AI model is temporarily paused after repeated provider failures. Choose Auto or retry shortly.', {
        diagnosticCode: 'PROVIDER_CIRCUIT_OPEN',
        statusCode: 503,
        retryable: true,
        modelId,
      });
    }
    return null;
  }

  private noteSuccess(modelId: AllowedModelId) {
    this.circuits.delete(modelId);
  }

  private noteFailure(modelId: AllowedModelId, retryable: boolean) {
    if (!retryable) return;
    const threshold = this.options.failureThreshold || 3;
    const current = this.circuits.get(modelId) || { failures: 0, blockedUntil: 0 };
    const failures = current.failures + 1;
    this.circuits.set(modelId, {
      failures,
      blockedUntil: failures >= threshold ? Date.now() + (this.options.breakerMs || 90_000) : 0,
    });
  }

  private metricFor(modelId: string): ModelRuntimeMetric {
    const current = this.metrics.get(modelId);
    if (current) return current;
    const next: ModelRuntimeMetric = {
      model_id: modelId,
      requests: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      fallback_uses: 0,
      total_latency_ms: 0,
      last_error_code: null,
      last_used_at: null,
    };
    this.metrics.set(modelId, next);
    return next;
  }

  private noteRequest(modelId: string) {
    const metric = this.metricFor(modelId);
    metric.requests += 1;
    metric.last_used_at = new Date().toISOString();
  }

  private noteRetry(modelId: string) {
    this.metricFor(modelId).retries += 1;
  }

  private noteFallbackUse(modelId: string) {
    this.metricFor(modelId).fallback_uses += 1;
  }

  private noteMetricSuccess(modelId: string, latencyMs: number) {
    const metric = this.metricFor(modelId);
    metric.successes += 1;
    metric.total_latency_ms += Math.max(0, latencyMs);
    metric.last_error_code = null;
  }

  private noteMetricFailure(modelId: string, diagnosticCode: string, latencyMs: number) {
    const metric = this.metricFor(modelId);
    metric.failures += 1;
    metric.total_latency_ms += Math.max(0, latencyMs);
    metric.last_error_code = diagnosticCode;
  }

  /** Map a provider's own status code onto a diagnostic and a retry verdict. */
  private classifyHttpStatus(error: ProviderHttpError, modelId: string): ProviderGatewayError {
    const status = error.status;
    const retryable = isRetryableStatus(status);
    const detail = error.body ? ` (${error.body.slice(0, 160)})` : '';

    if (status === 401 || status === 403) {
      const anthropic = error.provider === 'Anthropic';
      return new ProviderGatewayError(anthropic
        ? 'Anthropic key invalid or unauthorized. Update ANTHROPIC_API_KEY on Railway and redeploy.'
        : 'OpenRouter key invalid or unauthorized. Update OPENROUTER_API_KEY on Railway and redeploy.', {
        diagnosticCode: anthropic ? 'ANTHROPIC_KEY_INVALID' : 'OPENROUTER_KEY_INVALID',
        statusCode: 503, retryable: false, modelId,
      });
    }
    if (status === 402) {
      return new ProviderGatewayError('The AI provider rejected the request because the provider account has insufficient credits or quota.', {
        diagnosticCode: 'PROVIDER_QUOTA_OR_BILLING', statusCode: 503, retryable: false, modelId,
      });
    }
    if (status === 404) {
      return new ProviderGatewayError('The selected AI model is unavailable on the provider. Choose Auto or another allowed model.', {
        diagnosticCode: 'MODEL_UNAVAILABLE', statusCode: 502, retryable: true, modelId,
      });
    }
    if (status === 429) {
      return new ProviderGatewayError('The AI provider rate limit was reached. Coden will retry shortly.', {
        diagnosticCode: 'PROVIDER_RATE_LIMITED', statusCode: 429, retryable: true, modelId,
      });
    }
    if (status === 400 || status === 422) {
      // Keep required capabilities intact. A retry must not silently drop them.
      if (/unsupported|not supported|response_format|tool_choice|json_schema|reasoning/i.test(error.body)) {
        return new ProviderGatewayError('The selected model rejected a required runtime option. The request was stopped without removing capabilities.', {
          diagnosticCode: 'PROVIDER_UNSUPPORTED_RUNTIME_CONFIG', statusCode: 502, retryable: false, modelId,
        });
      }
      return new ProviderGatewayError(`The AI provider rejected the request format.${detail}`, {
        diagnosticCode: 'PROVIDER_BAD_REQUEST', statusCode: 502, retryable: false, modelId,
      });
    }
    if (status === 408 || status === 504) {
      return new ProviderGatewayError('The selected AI model did not answer in time.', {
        diagnosticCode: 'PROVIDER_TIMEOUT', statusCode: 504, retryable: true, modelId,
      });
    }
    if (status >= 500) {
      // 529 is Anthropic's overloaded signal and the commonest failure on
      // frontier models. It is temporary by definition.
      return new ProviderGatewayError('The selected AI model is temporarily unavailable.', {
        diagnosticCode: 'PROVIDER_UNAVAILABLE', statusCode: 502, retryable: true, modelId,
      });
    }
    return new ProviderGatewayError(`The AI provider request failed.${detail}`, {
      diagnosticCode: 'PROVIDER_REQUEST_FAILED', statusCode: 502, retryable, modelId,
    });
  }

  /**
   * Decide what a provider failure was, and whether it is worth another try.
   *
   * Typed failures answer first. Everything below them is text matching, which
   * is what this used to do exclusively and why the retry machinery almost
   * never fired: the patterns are unanchored substrings, so `/400/` matched
   * the "40000" in "upstream timeout after 40000ms" and turned a 503 into a
   * non-retryable bad request, while `/402/` matched a request id and told the
   * user their account was out of credits. Every one of those failures was
   * transient and every one of them was reported as permanent.
   *
   * The text rules are kept for callers that still throw plain Errors, but
   * they now only ever see messages that carry no status code, so they can no
   * longer misread one.
   */
  private classifyError(error: any, modelId: string): ProviderGatewayError {
    if (error instanceof ProviderGatewayError) return error;

    // The user pressed stop. Not a failure, and above all not something to
    // retry or fall back from — that would spend their credits on work they
    // just cancelled.
    if (error instanceof ProviderCancelledError) {
      return new ProviderGatewayError('The request was cancelled.', {
        diagnosticCode: 'REQUEST_CANCELLED', statusCode: 499, retryable: false, modelId,
      });
    }

    if (error instanceof ProviderTimeoutError) {
      return new ProviderGatewayError('The selected AI model did not answer in time.', {
        diagnosticCode: 'PROVIDER_TIMEOUT', statusCode: 504, retryable: true, modelId,
      });
    }

    // A status code is a fact. Reading it beats inferring it from prose.
    if (error instanceof ProviderHttpError) return this.classifyHttpStatus(error, modelId);

    if (/^MODEL_(?:UNAVAILABLE|CATALOG_UNAVAILABLE|CAPABILITY_UNAVAILABLE|MODALITY_UNAVAILABLE|OUTPUT_LIMIT)$/.test(String(error?.diagnosticCode || ''))) {
      return new ProviderGatewayError(error.message, { diagnosticCode:error.diagnosticCode, statusCode:503, retryable:false, modelId });
    }
    if (String(error?.diagnosticCode || '') === 'MODEL_OUTPUT_PARSE_FAILED') {
      return new ProviderGatewayError('The selected AI model returned an unusable project artifact.', {
        diagnosticCode: 'MODEL_OUTPUT_PARSE_FAILED',
        statusCode: 502,
        retryable: true,
        modelId,
      });
    }
    const message = String(error?.message || error || 'AI provider request failed.');
    if (/auto must be resolved/i.test(message)) {
      return new ProviderGatewayError(message, { diagnosticCode: 'AUTO_MODEL_NOT_RESOLVED', statusCode: 500, retryable: false, modelId });
    }
    if (/OpenRouter.*not configured|OPENROUTER_API_KEY/i.test(message)) {
      return new ProviderGatewayError('OpenRouter is not configured. Add OPENROUTER_API_KEY on Railway and redeploy. The backend also accepts OPEN_ROUTER_API_KEY, OPENROUTER_KEY, or OPENROUTER_TOKEN.', {
        diagnosticCode: 'OPENROUTER_NOT_CONFIGURED',
        statusCode: 503,
        retryable: false,
        modelId,
      });
    }
    if (/Anthropic API key is not configured/i.test(message)) {
      return new ProviderGatewayError('Anthropic direct is not configured. Add ANTHROPIC_API_KEY on Railway and redeploy.', {
        diagnosticCode: 'ANTHROPIC_NOT_CONFIGURED',
        statusCode: 503,
        retryable: false,
        modelId,
      });
    }
    if (/Anthropic.*invalid api key|Anthropic.*unauthorized/i.test(message)) {
      return new ProviderGatewayError('Anthropic key invalid or unauthorized. Update ANTHROPIC_API_KEY on Railway and redeploy.', {
        diagnosticCode: 'ANTHROPIC_KEY_INVALID',
        statusCode: 503,
        retryable: false,
        modelId,
      });
    }
    if (/invalid api key|unauthorized|insufficient permission/i.test(message)) {
      return new ProviderGatewayError('OpenRouter key invalid or unauthorized. Update OPENROUTER_API_KEY on Railway and redeploy.', {
        diagnosticCode: 'OPENROUTER_KEY_INVALID',
        statusCode: 503,
        retryable: false,
        modelId,
      });
    }
    if (/quota|billing|insufficient.*credit|payment required/i.test(message)) {
      return new ProviderGatewayError('The AI provider rejected the request because the provider account has insufficient credits or quota.', {
        diagnosticCode: 'PROVIDER_QUOTA_OR_BILLING',
        statusCode: 503,
        retryable: false,
        modelId,
      });
    }
    if (/model.*not.*found|model.*not available/i.test(message)) {
      return new ProviderGatewayError('The selected AI model is unavailable on OpenRouter. Choose Auto or another allowed model.', {
        diagnosticCode: 'MODEL_UNAVAILABLE',
        statusCode: 502,
        retryable: true,
        modelId,
      });
    }
    if (/rate limit|too many requests/i.test(message)) {
      return new ProviderGatewayError('OpenRouter rate limit reached. Please wait a moment and try again.', {
        diagnosticCode: 'PROVIDER_RATE_LIMITED',
        statusCode: 429,
        retryable: true,
        modelId,
      });
    }
    if (/unsupported parameter|unsupported.*response_format|tool_choice|tools|reasoning|json_schema/i.test(message)) {
      return new ProviderGatewayError('The selected model rejected a required runtime option. The request was stopped without removing capabilities.', {
        diagnosticCode: 'PROVIDER_UNSUPPORTED_RUNTIME_CONFIG',
        statusCode: 502,
        retryable: false,
        modelId,
      });
    }
    if (/bad request|invalid request|provider rejected/i.test(message)) {
      return new ProviderGatewayError('OpenRouter rejected the AI request format. Retry with Auto; if it keeps happening, check the selected model and Railway logs.', {
        diagnosticCode: 'PROVIDER_BAD_REQUEST',
        statusCode: 502,
        retryable: false,
        modelId,
      });
    }
    if (/timeout|AbortError|aborted|ECONNRESET|ENOTFOUND|fetch failed|network error|upstream/i.test(message)) {
      const isTimeout = /timeout|AbortError|aborted/i.test(message);
      return new ProviderGatewayError(isTimeout
        ? 'The selected AI model did not answer in time.'
        : 'The selected AI model is temporarily unavailable.', {
        diagnosticCode: isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE',
        statusCode: isTimeout ? 504 : 502,
        retryable: true,
        modelId,
      });
    }
    return new ProviderGatewayError(message, {
      diagnosticCode: 'PROVIDER_REQUEST_FAILED',
      statusCode: error?.statusCode || 502,
      retryable: false,
      modelId,
    });
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
