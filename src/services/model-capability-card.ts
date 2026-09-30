/**
 * What a model can do, read from the provider — not from a table someone wrote.
 *
 * The registry (config/ai-models.ts) is the offline fallback: it says what we
 * believed when it was last edited. The card is what OpenRouter's live catalogue
 * says now — context window, output ceiling, modalities, the parameters the
 * model really accepts, and its prices including the cache tiers — with the
 * source of every field named, so a value that came from the fallback is never
 * mistaken for one the provider confirmed. A capability announced by the
 * catalogue is then *verified* by a probe (model-conformance.ts) and the result
 * is kept on the card: announced, and proven.
 *
 * Adding a model therefore means adding its slug. Its numbers arrive from the
 * catalogue; nothing here is hand-copied from a vendor's page.
 */
import { AI_MODEL_CAPABILITIES, MODEL_REGISTRY, type AllowedModelId } from '../config/ai-models.ts';
import { openRouterCatalog, type CatalogModel, type OpenRouterCapabilities } from './openrouter-capabilities.ts';

export type FieldSource = 'live' | 'declared' | 'unknown';

export type ProbeName = 'simple' | 'streaming' | 'image' | 'pdf' | 'tools' | 'parallel_tools' | 'reasoning' | 'json' | 'long_context' | 'prompt_cache';
export type ProbeResult = { name: ProbeName; status: 'passed' | 'failed' | 'skipped'; ms?: number; detail?: string; at: string };

export type CapabilityCard = {
  id: string;
  label: string;
  /** False only when a loaded catalogue does not list the slug. */
  available: boolean;
  /** Where the numbers came from: the live catalogue, or the registry while none is loaded. */
  source: 'live' | 'declared';
  contextLength: number;
  maxCompletionTokens: number;
  modalities: { input: string[]; output: string[] };
  /** The parameters the model accepts, as the catalogue lists them. */
  parameters: {
    tools: boolean;
    toolChoice: boolean;
    /** null: the catalogue does not say, so it is verified by probe rather than assumed. */
    parallelToolCalls: boolean | null;
    reasoning: boolean;
    structuredOutputs: boolean;
    responseFormat: boolean;
    temperature: boolean;
    all: string[];
  };
  pricing: null | {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    cacheReadUsdPerMillion: number | null;
    cacheWriteUsdPerMillion: number | null;
    reasoningUsdPerMillion: number | null;
  };
  /** Which fields the card holds from the provider and which from the fallback. */
  provenance: Record<'context' | 'modalities' | 'parameters' | 'pricing', FieldSource>;
  /** What was declared in the registry, for comparison with what the provider says. */
  declared: { vision: boolean; tools: boolean; contextWindow: number } | null;
  /** Where the two disagree: the reason to look at a model before trusting a label. */
  drift: string[];
  probes: Partial<Record<ProbeName, ProbeResult>>;
};

const perMillion = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1_000_000 * 1e6) / 1e6 : null;
};

/** Probe results by model, kept for the life of the process (and reported through the admin route). */
const probeStore = new Map<string, Partial<Record<ProbeName, ProbeResult>>>();
export function recordProbeResults(modelId: string, results: ProbeResult[]) {
  const current = probeStore.get(modelId) || {};
  for (const result of results) current[result.name] = result;
  probeStore.set(modelId, current);
}
export function probeResultsFor(modelId: string) {
  return { ...(probeStore.get(modelId) || {}) };
}
export function clearProbeResults() { probeStore.clear(); }

export function buildCapabilityCard(id: string, catalog: Pick<OpenRouterCapabilities, 'peek' | 'loaded'> = openRouterCatalog): CapabilityCard {
  const entry = MODEL_REGISTRY.find(model => model.id === id);
  const caps = AI_MODEL_CAPABILITIES[id as AllowedModelId];
  const live: CatalogModel | undefined = catalog.peek(id);
  const declared = entry ? { vision: caps.supportsVision, tools: caps.supportsToolCalling, contextWindow: entry.contextWindow } : null;

  if (!live) {
    return {
      id,
      label: entry?.label || id,
      available: !catalog.loaded,
      source: 'declared',
      contextLength: entry?.contextWindow || 0,
      maxCompletionTokens: entry?.maxOutputTokens || 0,
      modalities: { input: ['text', ...(caps?.supportsVision ? ['image'] : [])], output: ['text'] },
      parameters: { tools: Boolean(caps?.supportsToolCalling), toolChoice: Boolean(caps?.supportsToolCalling), parallelToolCalls: null, reasoning: Boolean(caps?.supportsReasoningControl), structuredOutputs: Boolean(caps?.supportsStructuredOutput), responseFormat: Boolean(caps?.supportsJsonMode), temperature: true, all: [] },
      pricing: entry ? { inputUsdPerMillion: entry.inputUsdPerMillion, outputUsdPerMillion: entry.outputUsdPerMillion, cacheReadUsdPerMillion: null, cacheWriteUsdPerMillion: null, reasoningUsdPerMillion: null } : null,
      provenance: { context: 'declared', modalities: 'declared', parameters: 'declared', pricing: entry ? 'declared' : 'unknown' },
      declared,
      drift: catalog.loaded ? ['absent from the live catalogue'] : [],
      probes: probeResultsFor(id),
    };
  }

  const parameters = new Set(live.supported_parameters || []);
  const input = live.architecture?.input_modalities || ['text'];
  const contextLength = Number(live.top_provider?.context_length || live.context_length) || live.context_length;
  const inputPrice = perMillion(live.pricing?.prompt);
  const outputPrice = perMillion(live.pricing?.completion);
  const card: CapabilityCard = {
    id,
    label: entry?.label || live.name || id,
    available: true,
    source: 'live',
    contextLength,
    maxCompletionTokens: Number(live.top_provider?.max_completion_tokens) || Math.min(contextLength, entry?.maxOutputTokens || contextLength),
    modalities: { input, output: live.architecture?.output_modalities || ['text'] },
    parameters: {
      tools: parameters.has('tools'),
      toolChoice: parameters.has('tool_choice'),
      parallelToolCalls: parameters.has('parallel_tool_calls') ? true : null,
      reasoning: parameters.has('reasoning') || parameters.has('include_reasoning'),
      structuredOutputs: parameters.has('structured_outputs'),
      responseFormat: parameters.has('response_format'),
      temperature: parameters.has('temperature'),
      all: [...parameters].sort(),
    },
    pricing: inputPrice !== null && outputPrice !== null
      ? {
        inputUsdPerMillion: inputPrice,
        outputUsdPerMillion: outputPrice,
        cacheReadUsdPerMillion: perMillion(live.pricing?.input_cache_read),
        cacheWriteUsdPerMillion: perMillion(live.pricing?.input_cache_write),
        reasoningUsdPerMillion: perMillion(live.pricing?.internal_reasoning),
      }
      : null,
    provenance: { context: 'live', modalities: 'live', parameters: 'live', pricing: inputPrice !== null && outputPrice !== null ? 'live' : 'unknown' },
    declared,
    drift: [],
    probes: probeResultsFor(id),
  };
  if (declared) {
    if (declared.vision && !input.includes('image')) card.drift.push('declared to read images, the catalogue says it does not');
    if (!declared.vision && input.includes('image')) card.drift.push('reads images per the catalogue, declared as text-only');
    if (declared.tools && !card.parameters.tools) card.drift.push('declared to call tools, the catalogue does not list `tools`');
    if (declared.contextWindow && Math.abs(declared.contextWindow - contextLength) / declared.contextWindow > 0.1) card.drift.push(`context window ${contextLength.toLocaleString('en')} tokens per the catalogue, ${declared.contextWindow.toLocaleString('en')} declared`);
    const declaredEntry = entry!;
    if (card.pricing && declaredEntry.inputUsdPerMillion > 0 && Math.abs(card.pricing.outputUsdPerMillion - declaredEntry.outputUsdPerMillion) / declaredEntry.outputUsdPerMillion > 0.15) {
      card.drift.push(`output price $${card.pricing.outputUsdPerMillion}/M per the catalogue, $${declaredEntry.outputUsdPerMillion}/M declared`);
    }
  }
  return card;
}

/**
 * The parameters a request wants that this model does not accept.
 *
 * The caller drops them and says so (a request never carries an unsupported
 * parameter, and never has one ignored without a trace). `tools` is not
 * droppable for a coder — that is a refusal, not an adaptation — so the
 * caller decides; this only reports.
 */
export function unsupportedParameters(card: CapabilityCard, wanted: string[]): string[] {
  if (card.source !== 'live') return [];
  const accepted = new Set(card.parameters.all);
  return wanted.filter(parameter => !accepted.has(parameter));
}

/** What a cached prefix is worth on this model: the share of the input price saved on a cache hit. */
export function cacheSavingRatio(card: CapabilityCard): number | null {
  if (!card.pricing || !card.pricing.cacheReadUsdPerMillion || !card.pricing.inputUsdPerMillion) return null;
  return Math.max(0, 1 - card.pricing.cacheReadUsdPerMillion / card.pricing.inputUsdPerMillion);
}
