/** Server-only Decisions transport. This model must never enter the chat/coding catalogue. */
import { cleanOpenRouterHeaderValue } from './openrouter-service.ts';
import { ProviderCancelledError, ProviderTimeoutError } from './provider-errors.ts';
import { observeProviderCost } from './cost-observability.ts';

export const DECISIONS_MODEL = 'openai/gpt-6-luna-decisions';
export const DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
export const DECISIONS_CATALOG_URL = 'https://openrouter.ai/api/v1/models?output_modalities=decisions';
export const INTERNAL_ROUTING_CALL_LIMIT = 2;
export const INTERNAL_ROUTING_CALL_USD = 0.05;

export class InternalRoutingBudget {
  used = 0;
  claim() {
    if (this.used >= INTERNAL_ROUTING_CALL_LIMIT) throw new DecisionsError('DECISIONS_CALL_LIMIT');
    this.used += 1;
  }
  get remaining() { return INTERNAL_ROUTING_CALL_LIMIT - this.used; }
}

export class DecisionsError extends Error {
  readonly diagnosticCode: string;
  constructor(code: string) { super(code); this.name = 'DecisionsError'; this.diagnosticCode = code; }
}

export type DecisionQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };
export type ChoiceAnswer = { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };
export type DecisionAnswer = ChoiceAnswer | { type: 'noul'; noul: number };
export type DecisionsResult = {
  answers: Record<string, DecisionAnswer>;
  latencyMs: number;
  costUsd: number | null;
  inputTokens: number | null;
};
type Pricing = { prompt: number; contextLength: number; canonicalModel?: string };
const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const probability = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Reject missing questions, refusals, foreign options, inconsistent distributions and NaN. */
export function validateDecisionAnswers(raw: unknown, questions: Record<string, DecisionQuestion>): Record<string, DecisionAnswer> {
  if (!object(raw)) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
  const answers: Record<string, DecisionAnswer> = {};
  for (const [name, question] of Object.entries(questions)) {
    const answer = raw[name];
    if (!object(answer) || answer.type !== question.type) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
    if (question.type === 'noul') {
      if (!probability(answer.noul)) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
      answers[name] = { type: 'noul', noul: answer.noul };
      continue;
    }
    const options = Object.keys(question.criteria);
    if (typeof answer.choice !== 'string' || !options.includes(answer.choice) || !probability(answer.confidence)
      || !object(answer.probabilities) || Object.keys(answer.probabilities).length !== options.length
      || options.some(option => !probability(answer.probabilities[option]))) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
    const values = options.map(option => answer.probabilities[option] as number);
    if (Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.02
      || answer.probabilities[answer.choice] + 1e-6 < Math.max(...values)) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
    answers[name] = { type: 'choice', choice: answer.choice, confidence: answer.confidence,
      probabilities: Object.fromEntries(options.map(option => [option, answer.probabilities[option]])) };
  }
  return answers;
}

export function decisionsPricing(catalog: unknown): Pricing {
  const model = object(catalog) && Array.isArray(catalog.data)
    ? catalog.data.find((row: any) => row?.id === DECISIONS_MODEL) : null;
  const raw = model?.pricing;
  const price = (value: unknown) => (typeof value === 'string' && value.trim()) || typeof value === 'number' ? Number(value) : NaN;
  const prompt = price(raw?.prompt);
  const completion = price(raw?.completion);
  const contextLength = Number(model?.context_length);
  const canonicalModel = model?.canonical_slug ?? DECISIONS_MODEL;
  if (!model?.architecture?.output_modalities?.includes('decisions') || !Number.isFinite(prompt) || prompt < 0
    || completion !== 0 || !Number.isFinite(contextLength) || contextLength <= 0
    || (canonicalModel !== DECISIONS_MODEL && (typeof canonicalModel !== 'string' || !/^openai\/gpt-6-luna-decisions-\d{8}$/.test(canonicalModel)))
    || (raw?.request !== undefined && price(raw.request) !== 0)
    || (raw?.overrides != null && (!Array.isArray(raw.overrides) || raw.overrides.length > 0))) {
    throw new DecisionsError('DECISIONS_CATALOG_UNAVAILABLE');
  }
  return { prompt, contextLength, canonicalModel };
}

export function buildDecisionsRequest(state: unknown, questions: Record<string, DecisionQuestion>, pricing: Pricing,
  maxCostUsd = INTERNAL_ROUTING_CALL_USD) {
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > INTERNAL_ROUTING_CALL_USD) throw new DecisionsError('DECISIONS_BUDGET_EXCEEDED');
  if (!Number.isFinite(pricing.prompt) || pricing.prompt < 0 || !Number.isFinite(pricing.contextLength) || pricing.contextLength <= 0) {
    throw new DecisionsError('DECISIONS_CATALOG_UNAVAILABLE');
  }
  const count = Object.keys(questions).length;
  if (!count || count > 8) throw new DecisionsError('DECISIONS_QUESTION_LIMIT');
  const bytes = new TextEncoder().encode(JSON.stringify({ state, questions })).length;
  if (bytes > 32_000) throw new DecisionsError('DECISIONS_INPUT_LIMIT');
  // Pessimistic: a token per UTF-8 byte, repeated for every question, plus framing.
  // Zero-priced output and no per-request fee are verified from the live catalogue.
  const upperTokens = (bytes + 4096) * count;
  if (upperTokens > pricing.contextLength || upperTokens * pricing.prompt * 1.055 > maxCostUsd) {
    throw new DecisionsError('DECISIONS_BUDGET_EXCEEDED');
  }
  return { model: DECISIONS_MODEL, state, questions, provider: {
    only: ['openai'], allow_fallbacks: false, require_parameters: true,
    max_price: { prompt: Number((pricing.prompt * 1_000_000).toPrecision(12)), completion: 0, request: 0 },
  } };
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!response.body) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new DecisionsError('DECISIONS_RESPONSE_LIMIT'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(buffer)); }
  catch { throw new DecisionsError('DECISIONS_INVALID_RESPONSE'); }
}

export class OpenRouterDecisions {
  private cached: { pricing: Pricing; expiresAt: number } | null = null;
  private catalogPending: Promise<Pricing> | null = null;
  private blockedUntil = 0;
  private failures = 0;
  private failureSince = 0;
  private inFlight = 0;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly options: {
    apiKey: () => string; fetch?: typeof fetch; now?: () => number;
    observe?: typeof observeProviderCost;
  }) { this.fetcher = options.fetch || fetch; this.now = options.now || Date.now; }

  private async pricing(signal: AbortSignal): Promise<Pricing> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.pricing;
    if (this.catalogPending) return this.catalogPending;
    const pending = (async () => {
      const response = await this.fetcher(DECISIONS_CATALOG_URL, { signal });
      if (!response.ok) throw new DecisionsError(`DECISIONS_CATALOG_HTTP_${response.status}`);
      const pricing = decisionsPricing(await boundedJson(response, 512_000));
      this.cached = { pricing, expiresAt: this.now() + 5 * 60_000 };
      return pricing;
    })();
    this.catalogPending = pending;
    try { return await pending; }
    finally { if (this.catalogPending === pending) this.catalogPending = null; }
  }

  /** One request, no paid retry. A breaker and concurrency cap bound observation traffic. */
  async decide(state: unknown, questions: Record<string, DecisionQuestion>, budget: InternalRoutingBudget,
    options: { signal?: AbortSignal; timeoutMs?: number; maxCostUsd?: number } = {}): Promise<DecisionsResult> {
    if (options.signal?.aborted) throw new ProviderCancelledError();
    if (this.blockedUntil > this.now()) throw new DecisionsError('DECISIONS_CIRCUIT_OPEN');
    if (this.inFlight >= 4) throw new DecisionsError('DECISIONS_BUSY');
    const apiKey = cleanOpenRouterHeaderValue(this.options.apiKey());
    if (!apiKey) throw new DecisionsError('DECISIONS_NOT_CONFIGURED');
    const timeoutMs = Math.max(250, Math.min(5000, options.timeoutMs || 5000));
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    const startedAt = this.now();
    let attempted = false;
    let usage: Record<string, any> | undefined;
    let servedModel = DECISIONS_MODEL;
    let provider: string | undefined;
    let succeeded = false;
    this.inFlight += 1;
    try {
      const pricing = await this.pricing(controller.signal);
      if (controller.signal.aborted) throw new ProviderTimeoutError('OpenRouter Decisions', timeoutMs);
      const maxCostUsd = options.maxCostUsd ?? INTERNAL_ROUTING_CALL_USD;
      const body = buildDecisionsRequest(state, questions, pricing, maxCostUsd);
      budget.claim();
      attempted = true;
      const response = await this.fetcher(DECISIONS_URL, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json',
          'HTTP-Referer': 'https://coden.fun', 'X-Title': 'Coden' }, body: JSON.stringify(body) });
      // Never retain or log an upstream error body: it may echo private input.
      if (!response.ok) { await response.body?.cancel(); throw new DecisionsError(`DECISIONS_HTTP_${response.status}`); }
      const payload = await boundedJson(response, 64_000);
      if (!object(payload)) throw new DecisionsError('DECISIONS_INVALID_RESPONSE');
      if (object(payload.usage)) usage = payload.usage;
      if ((payload.model !== DECISIONS_MODEL && payload.model !== pricing.canonicalModel)
        || typeof payload.model !== 'string' || (payload.provider !== undefined && payload.provider !== 'OpenAI')) {
        // Never pass an untrusted echoed model/provider string to diagnostics.
        servedModel = 'unknown';
        throw new DecisionsError('DECISIONS_MODEL_MISMATCH');
      }
      servedModel = payload.model;
      provider = payload.provider === 'OpenAI' ? 'OpenAI' : undefined;
      const answers = validateDecisionAnswers(payload.answers, questions);
      const costUsd = nonnegative(usage?.cost) ? usage.cost : null;
      if (costUsd !== null && costUsd * 1.055 > maxCostUsd) throw new DecisionsError('DECISIONS_BUDGET_EXCEEDED');
      this.failures = 0;
      succeeded = true;
      return { answers, latencyMs: this.now() - startedAt, costUsd,
        inputTokens: nonnegative(usage?.input_tokens ?? usage?.prompt_tokens) ? (usage!.input_tokens ?? usage!.prompt_tokens) : null };
    } catch (error) {
      const localRejection = !attempted && error instanceof DecisionsError
        && ['DECISIONS_INPUT_LIMIT', 'DECISIONS_QUESTION_LIMIT', 'DECISIONS_BUDGET_EXCEEDED', 'DECISIONS_CALL_LIMIT'].includes(error.diagnosticCode);
      if (!options.signal?.aborted && !localRejection) {
        const now = this.now();
        if (now - this.failureSince > 60_000) { this.failures = 0; this.failureSince = now; }
        if (++this.failures >= 3) { this.blockedUntil = now + 60_000; this.cached = null; }
      }
      if (options.signal?.aborted) throw new ProviderCancelledError();
      if (controller.signal.aborted) throw new ProviderTimeoutError('OpenRouter Decisions', timeoutMs);
      throw error instanceof DecisionsError ? error : new DecisionsError('DECISIONS_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      this.inFlight -= 1;
      if (attempted) {
        try {
          (this.options.observe || observeProviderCost)({ requestedModel: DECISIONS_MODEL, servedModel, provider,
            metadata: { task: 'classification', prompt_version: 'v1' }, result: succeeded ? 'succeeded' : options.signal?.aborted ? 'cancelled' : 'failed',
            latencyMs: this.now() - startedAt, usage: usage ? { ...usage,
              prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
              completion_tokens: usage.completion_tokens ?? usage.output_tokens } : undefined });
        } catch { /* Measurement cannot change the decision or billing. */ }
      }
    }
  }
}
