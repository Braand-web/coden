/**
 * What the live OpenRouter catalogue says each model can do, as the server
 * reports it on `/api/ai/models`.
 *
 * Read once per page and shared. Until it answers — or if it cannot — every
 * model is treated as available and able to reason: the server still refuses
 * what a model cannot do, and hiding the whole menu on a slow request would
 * be worse than showing one entry too many.
 */
import { useEffect, useState } from 'react';

export type ModelAvailabilityInfo = { available: boolean; supportsReasoning: boolean };
export type ModelAvailabilityMap = ReadonlyMap<string, ModelAvailabilityInfo>;

let pending: Promise<ModelAvailabilityMap> | null = null;
let cached: ModelAvailabilityMap | null = null;

export function parseModelAvailability(payload: unknown): ModelAvailabilityMap {
  const models = Array.isArray((payload as { models?: unknown })?.models) ? (payload as { models: any[] }).models : [];
  return new Map(models
    .filter(model => model && typeof model.id === 'string' && model.id !== 'auto')
    .map(model => [model.id, {
      available: model.available !== false,
      supportsReasoning: model.supports_reasoning !== false,
    }]));
}

export function loadModelAvailability(): Promise<ModelAvailabilityMap> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetch('/api/ai/models', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
    .then(response => (response.ok ? response.json() : null))
    .then(payload => (cached = parseModelAvailability(payload)))
    .catch(() => {
      pending = null;
      return new Map();
    });
  return pending;
}

export function useModelAvailability(): ModelAvailabilityMap | null {
  const [map, setMap] = useState<ModelAvailabilityMap | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void loadModelAvailability().then(result => { if (alive) setMap(result); });
    return () => { alive = false; };
  }, []);
  return map;
}
