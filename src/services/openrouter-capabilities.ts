/** Live capability contract. Manufacturer labels never imply API support. */
export type CatalogModel = {
  id: string;
  name?: string;
  context_length: number;
  supported_parameters: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null; context_length?: number | null };
  /** USD per token, as strings, exactly as OpenRouter publishes them. */
  pricing?: { prompt?: string | number; completion?: string | number; internal_reasoning?: string | number };
};
export class CapabilityError extends Error {
  readonly diagnosticCode: string;
  constructor(code: string, message: string) { super(message); this.name = 'CapabilityError'; this.diagnosticCode = code; }
}
export class OpenRouterCapabilities {
  private models = new Map<string, CatalogModel>();
  private expires = 0;
  private staleUntil = 0;
  private retryAfter = 0;
  private pending?: Promise<void>;
  private readonly request: typeof fetch;
  private readonly ttlMs: number;
  private readonly staleMs: number;
  constructor(request: typeof fetch = fetch, ttlMs = 300_000, staleMs = 24 * 3_600_000) { this.request=request; this.ttlMs=ttlMs; this.staleMs=staleMs; }

  /**
   * Every provider call in the product passes through here, so a catalog
   * outage used to be a total outage: the fetch failed, `MODEL_CATALOG_
   * UNAVAILABLE` was thrown, and nobody could generate anything — while a
   * perfectly good catalog sat in memory, discarded for being five minutes
   * old. Model capabilities change on the order of weeks; five minutes of
   * freshness is not worth the whole service.
   *
   * A catalog we already hold is served past its refresh deadline for as long
   * as `staleMs`, and the failing refresh is not retried on every single
   * request while the catalog is down. Failing closed remains the rule for the
   * one case where it is the only honest answer: we have never had a catalog,
   * so nothing is known about the model being called.
   */
  async get(id: string, signal?: AbortSignal): Promise<CatalogModel> {
    signal?.throwIfAborted();
    const now = Date.now();
    if (now >= this.expires && now >= this.retryAfter) {
      this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
      try {
        await this.pending;
      } catch (error) {
        if (!this.models.size || Date.now() >= this.staleUntil) throw error;
        console.warn('[coden:model_catalog_stale]', { reason: 'refresh_failed', models: this.models.size });
      }
    }
    signal?.throwIfAborted();
    const model = this.models.get(id);
    if (!model) throw new CapabilityError('MODEL_UNAVAILABLE', `Model ${id} is absent from the OpenRouter catalog.`);
    return model;
  }

  /** What is already known about a model, without touching the network. */
  peek(id: string): CatalogModel | undefined {
    return this.models.get(id);
  }

  /** Whether a catalogue has ever been loaded. Before that, nothing is known. */
  get loaded(): boolean {
    return this.models.size > 0;
  }

  /** Refresh if due, keeping the last good catalogue on failure. */
  async ensure(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    if (now < this.expires || now < this.retryAfter) return;
    this.pending ??= this.refresh().finally(() => { this.pending = undefined; });
    try {
      await this.pending;
    } catch (error) {
      if (!this.models.size) throw error;
    }
    signal?.throwIfAborted();
  }

  private async refresh() {
    try {
      const response = await this.request('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { data?: CatalogModel[] };
      if (!Array.isArray(body.data) || !body.data.length) throw new Error('Empty catalog');
      const models = body.data.filter(m => typeof m.id === 'string' && Array.isArray(m.supported_parameters) && Number.isFinite(m.context_length));
      if (!models.length) throw new Error('Invalid catalog');
      this.models = new Map(models.map(m => [m.id, m]));
      this.expires = Date.now() + this.ttlMs;
      this.staleUntil = Date.now() + this.staleMs;
      this.retryAfter = 0;
    } catch {
      // Hammering a catalog that is down turns one outage into two.
      this.retryAfter = Date.now() + 30_000;
      throw new CapabilityError('MODEL_CATALOG_UNAVAILABLE', 'OpenRouter capabilities could not be verified. Retry when the catalog is available.');
    }
  }
}

/** The one catalogue the whole server reads: requests, Auto, the model list. */
export const openRouterCatalog = new OpenRouterCapabilities();

export type ModelAvailability = {
  id: string;
  /** False only when a loaded catalogue does not list the slug. */
  available: boolean;
  reason?: string;
  contextLength: number;
  maxCompletionTokens: number;
  supportsReasoning: boolean;
  supportsTools: boolean;
  supportsStructuredOutputs: boolean;
  supportsVision: boolean;
  /** Reads a video as such (otherwise Coden sends its key frames and transcript). */
  supportsVideo: boolean;
  supportsAudio: boolean;
  /** Reads a PDF natively, scanned pages included. */
  supportsFile: boolean;
  pricing: { inputUsdPerMillion: number; outputUsdPerMillion: number } | null;
};

const perMillion = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1_000_000 * 1e6) / 1e6 : NaN;
};

/**
 * What a model can do, read from the live catalogue.
 *
 * `fallback` is the static registry entry, used only while no catalogue has
 * been loaded (a cold start with OpenRouter unreachable). Once one has, a slug
 * it does not list is unavailable — hidden from pickers and never chosen by
 * Auto — rather than called and left to fail.
 */
export function modelAvailability(
  id: string,
  fallback: { contextWindow: number; maxOutputTokens: number; supportsVision?: boolean } | undefined,
  catalog: OpenRouterCapabilities = openRouterCatalog,
): ModelAvailability {
  const live = catalog.peek(id);
  if (live) {
    const parameters = new Set(live.supported_parameters || []);
    const input = perMillion(live.pricing?.prompt);
    const output = perMillion(live.pricing?.completion);
    const contextLength = Number(live.top_provider?.context_length || live.context_length) || live.context_length;
    return {
      id,
      available: true,
      contextLength,
      maxCompletionTokens: Number(live.top_provider?.max_completion_tokens) || Math.min(contextLength, fallback?.maxOutputTokens || contextLength),
      supportsReasoning: parameters.has('reasoning') || parameters.has('include_reasoning'),
      supportsTools: parameters.has('tools'),
      supportsStructuredOutputs: parameters.has('structured_outputs') || parameters.has('response_format'),
      supportsVision: (live.architecture?.input_modalities || []).includes('image'),
      supportsVideo: (live.architecture?.input_modalities || []).includes('video'),
      supportsAudio: (live.architecture?.input_modalities || []).includes('audio'),
      supportsFile: (live.architecture?.input_modalities || []).includes('file'),
      pricing: Number.isFinite(input) && Number.isFinite(output) ? { inputUsdPerMillion: input, outputUsdPerMillion: output } : null,
    };
  }
  return {
    id,
    available: !catalog.loaded,
    ...(catalog.loaded ? { reason: 'absent from the OpenRouter catalogue' } : {}),
    contextLength: fallback?.contextWindow || 0,
    maxCompletionTokens: fallback?.maxOutputTokens || 0,
    // Unknown until the catalogue answers: offered, never assumed wrongly off.
    supportsReasoning: true,
    supportsTools: true,
    supportsStructuredOutputs: true,
    supportsVision: Boolean(fallback?.supportsVision),
    supportsVideo: false,
    supportsAudio: false,
    supportsFile: false,
    pricing: null,
  };
}

/**
 * Check every slug the product can call against the live catalogue.
 *
 * Called at boot. A missing slug is a configuration error worth a clear log
 * line — the model is then hidden, and nothing that depends on it crashes.
 */
export async function validateCatalogModels(
  ids: readonly string[],
  catalog: OpenRouterCapabilities = openRouterCatalog,
): Promise<{ available: string[]; missing: string[] }> {
  try {
    await catalog.ensure();
  } catch (error) {
    console.error('[coden:model_catalog_unavailable]', { message: error instanceof Error ? error.message : String(error), models: ids.length });
    return { available: [...ids], missing: [] };
  }
  const missing = ids.filter(id => !catalog.peek(id));
  for (const id of missing) {
    console.error('[coden:model_slug_unavailable]', { model: id, action: 'hidden from pickers and Auto', hint: 'Check the slug on https://openrouter.ai/models' });
  }
  return { available: ids.filter(id => !missing.includes(id)), missing };
}
