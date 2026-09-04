/** Live capability contract. Manufacturer labels never imply API support. */
export type CatalogModel = {
  id: string;
  context_length: number;
  supported_parameters: string[];
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  top_provider?: { max_completion_tokens?: number | null };
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

export function enforceModelCapabilities(model: CatalogModel, payload: Record<string, any>) {
  const supported = new Set(model.supported_parameters);
  const body: Record<string, any> = { ...payload, provider: { require_parameters: true } };
  for (const parameter of ['tools', 'response_format', 'reasoning']) {
    if (body[parameter] !== undefined && !supported.has(parameter)) {
      throw new CapabilityError('MODEL_CAPABILITY_UNAVAILABLE', `${model.id} does not advertise ${parameter} support.`);
    }
  }
  // Automatic choice is implicit when this parameter is not advertised (Fable).
  if (!supported.has('tool_choice') && body.tool_choice === 'auto') delete body.tool_choice;
  if (!supported.has('temperature') && body.temperature !== undefined) {
    console.info('[coden:provider_parameter_omitted]', { model: model.id, parameter: 'temperature', reason: 'not advertised by OpenRouter' });
    delete body.temperature;
  }
  const modalities = new Set(model.architecture?.input_modalities || ['text']);
  for (const message of payload.messages || []) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const modality = ({ image_url:'image', input_audio:'audio', video_url:'video', file:'file', text:'text' } as Record<string,string>)[part.type];
      if (!modality || !modalities.has(modality)) throw new CapabilityError('MODEL_MODALITY_UNAVAILABLE', `${model.id} cannot accept ${part.type}.`);
    }
  }
  const limit = model.top_provider?.max_completion_tokens;
  if (limit && body.max_tokens > limit) throw new CapabilityError('MODEL_OUTPUT_LIMIT', `Requested output exceeds ${model.id}'s advertised output limit.`);
  return body;
}
