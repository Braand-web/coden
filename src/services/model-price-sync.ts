/**
 * Model prices: what the registry says against what OpenRouter publishes now, with a history.
 *
 * A model's price is the biggest lever on the margin and the one Coden does not control. The registry
 * (`src/config/ai-models.ts`) carries the price used for estimates; the live catalogue carries the price that is
 * actually charged. When they drift apart an estimate is wrong without anyone noticing. This reports the drift and
 * keeps the live price, dated, in `provider_cost_catalog` (effective_from / effective_until) so a change of tariff is
 * visible afterwards. It never edits the registry: a price change that matters is a decision for a person.
 */

export type PriceRow = { id: string; inputUsdPerMillion: number; outputUsdPerMillion: number };
export type PriceDrift = { id: string; field: 'input' | 'output'; registryUsdPerMillion: number; liveUsdPerMillion: number; ratio: number };

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Every model whose live price is further than `tolerance` (a share) from the registry's. Only models the catalogue lists. */
export function priceDrift(registry: readonly PriceRow[], live: (id: string) => PriceRow | null | undefined, tolerance = 0.02): PriceDrift[] {
  const drifts: PriceDrift[] = [];
  for (const entry of registry) {
    const current = live(entry.id);
    if (!current) continue;
    for (const field of ['input', 'output'] as const) {
      const registryValue = field === 'input' ? entry.inputUsdPerMillion : entry.outputUsdPerMillion;
      const liveValue = field === 'input' ? current.inputUsdPerMillion : current.outputUsdPerMillion;
      if (!Number.isFinite(registryValue) || !Number.isFinite(liveValue) || registryValue <= 0) continue;
      const ratio = liveValue / registryValue;
      if (Math.abs(ratio - 1) > tolerance) drifts.push({ id: entry.id, field, registryUsdPerMillion: registryValue, liveUsdPerMillion: liveValue, ratio: round(ratio, 3) });
    }
  }
  return drifts.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
}

export type CatalogRow = { id: string; resource: string; unit_cost_usd: number | string; effective_until: string | null };

export type CatalogChange = { closeIds: string[]; inserts: Array<Record<string, unknown>> };

/** The rows to close and to add so the catalogue holds today's live price, one row per model and direction. */
export function catalogChanges(current: readonly CatalogRow[], live: readonly PriceRow[], now: Date, minChange = 0.01): CatalogChange {
  const open = new Map(current.filter(row => !row.effective_until).map(row => [row.resource, row]));
  const closeIds: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const at = now.toISOString();
  for (const model of live) {
    for (const field of ['input', 'output'] as const) {
      const perMillion = field === 'input' ? model.inputUsdPerMillion : model.outputUsdPerMillion;
      if (!Number.isFinite(perMillion) || perMillion < 0) continue;
      const perToken = round(perMillion / 1_000_000, 12);
      const resource = `${model.id}:${field}`;
      const existing = open.get(resource);
      if (existing) {
        const old = Number(existing.unit_cost_usd);
        if (old > 0 && Math.abs(perToken / old - 1) <= minChange) continue;
        closeIds.push(existing.id);
      }
      inserts.push({
        provider: 'openrouter', resource, unit: 'token', unit_cost_usd: perToken, currency: 'USD',
        effective_from: at, effective_until: null,
        source_url: 'https://openrouter.ai/api/v1/models', source_revision: at.slice(0, 10),
        metadata: { synced_by: 'model-price-sync.v1', source: 'live_catalog' },
      });
    }
  }
  return { closeIds, inserts };
}

type Client = { from: (table: string) => any };

/** One sync: write the changes and report the drift against the registry. */
export async function syncModelPrices(client: Client, input: { registry: readonly PriceRow[]; live: (id: string) => PriceRow | null | undefined; now?: Date }) {
  const now = input.now || new Date();
  const livePrices = input.registry.map(entry => input.live(entry.id)).filter((row): row is PriceRow => Boolean(row));
  const drift = priceDrift(input.registry, input.live);
  if (!livePrices.length) return { listed: 0, changed: 0, drift };

  const existing = await client.from('provider_cost_catalog').select('id,resource,unit_cost_usd,effective_until').eq('provider', 'openrouter').is('effective_until', null).limit(2000);
  if (existing.error) throw new Error(`Price sync could not read the catalogue: ${existing.error.message}`);
  const changes = catalogChanges((existing.data || []) as CatalogRow[], livePrices, now);
  for (const id of changes.closeIds) {
    const closed = await client.from('provider_cost_catalog').update({ effective_until: now.toISOString() }).eq('id', id);
    if (closed.error) throw new Error(`Price sync could not close a price: ${closed.error.message}`);
  }
  if (changes.inserts.length) {
    const inserted = await client.from('provider_cost_catalog').insert(changes.inserts);
    if (inserted.error) throw new Error(`Price sync could not save prices: ${inserted.error.message}`);
  }
  return { listed: livePrices.length, changed: changes.inserts.length, drift };
}

export function priceSyncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CODEN_PRICE_SYNC ?? '1').trim() !== '0';
}

/** A drift worth a message: a price that moved by more than a tenth moves the margin. */
export function priceDriftMessage(drifts: readonly PriceDrift[], threshold = 0.1): string | null {
  const big = drifts.filter(drift => Math.abs(drift.ratio - 1) > threshold).slice(0, 6);
  if (!big.length) return null;
  const lines = big.map(drift => `${drift.id} (${drift.field}) : ${drift.registryUsdPerMillion} $ → ${drift.liveUsdPerMillion} $ par million (${drift.ratio > 1 ? '+' : ''}${Math.round((drift.ratio - 1) * 100)} %)`);
  return `Prix de modèles différents du registre : ${lines.join(' ; ')}. Les estimations utilisent le registre ; vérifiez la marge.`;
}
