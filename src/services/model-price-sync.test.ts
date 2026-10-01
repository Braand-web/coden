import { describe, expect, it } from 'vitest';
import { catalogChanges, priceDrift, priceDriftMessage, priceSyncEnabled, syncModelPrices, type PriceRow } from './model-price-sync.ts';

const registry: PriceRow[] = [
  { id: 'a/cheap', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  { id: 'b/moved', inputUsdPerMillion: 3, outputUsdPerMillion: 15 },
  { id: 'c/absent', inputUsdPerMillion: 1, outputUsdPerMillion: 2 },
];
const live = (id: string): PriceRow | null => ({
  'a/cheap': { id, inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 },
  'b/moved': { id, inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5 },
} as Record<string, PriceRow>)[id] || null;

describe('price drift', () => {
  it('reports a model whose live price moved, biggest first, and ignores one the catalogue does not list', () => {
    const drift = priceDrift(registry, live);
    expect(drift.map(entry => `${entry.id}:${entry.field}`)).toEqual(['b/moved:output', 'b/moved:input']);
    expect(drift[1]).toMatchObject({ registryUsdPerMillion: 3, liveUsdPerMillion: 0.6, ratio: 0.2 });
  });

  it('says nothing inside the tolerance', () => {
    expect(priceDrift([{ id: 'a/cheap', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2 }], () => ({ id: 'a/cheap', inputUsdPerMillion: 0.2005, outputUsdPerMillion: 1.205 }))).toEqual([]);
  });

  it('writes a message only for a move of more than a tenth', () => {
    expect(priceDriftMessage(priceDrift(registry, live))).toContain('b/moved');
    expect(priceDriftMessage([{ id: 'x', field: 'input', registryUsdPerMillion: 1, liveUsdPerMillion: 1.05, ratio: 1.05 }])).toBeNull();
  });
});

describe('the dated catalogue', () => {
  const now = new Date('2026-10-02T00:00:00Z');
  const liveRows = [{ id: 'b/moved', inputUsdPerMillion: 0.6, outputUsdPerMillion: 2.5 }];

  it('adds the first price of a model, one row per direction, per token', () => {
    const { closeIds, inserts } = catalogChanges([], liveRows, now);
    expect(closeIds).toEqual([]);
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({ provider: 'openrouter', resource: 'b/moved:input', unit: 'token', unit_cost_usd: 6e-7, effective_until: null });
  });

  it('closes the old price and adds the new one when it changed, and leaves an unchanged price alone', () => {
    const current = [
      { id: 'row1', resource: 'b/moved:input', unit_cost_usd: 0.000003, effective_until: null },
      { id: 'row2', resource: 'b/moved:output', unit_cost_usd: 0.0000025, effective_until: null },
    ];
    const { closeIds, inserts } = catalogChanges(current, liveRows, now);
    expect(closeIds).toEqual(['row1']);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ resource: 'b/moved:input' });
  });

  it('keeps a closed row out of the comparison', () => {
    const current = [{ id: 'old', resource: 'b/moved:input', unit_cost_usd: 0.000003, effective_until: '2026-09-01T00:00:00Z' }];
    expect(catalogChanges(current, liveRows, now).closeIds).toEqual([]);
  });
});

describe('one sync', () => {
  it('writes the changes and returns the drift', async () => {
    const calls: string[] = [];
    const client: any = {
      from: () => {
        const builder: any = {
          select: () => builder, eq: () => builder, is: () => builder,
          limit: () => Promise.resolve({ data: [{ id: 'row1', resource: 'b/moved:input', unit_cost_usd: 0.000003, effective_until: null }], error: null }),
          update: () => { calls.push('update'); return { eq: () => Promise.resolve({ error: null }) }; },
          insert: (rows: unknown[]) => { calls.push(`insert:${rows.length}`); return Promise.resolve({ error: null }); },
        };
        return builder;
      },
    };
    const result = await syncModelPrices(client, { registry, live, now: new Date('2026-10-02T00:00:00Z') });
    expect(result.listed).toBe(2);
    expect(result.drift).toHaveLength(2);
    expect(calls).toEqual(['update', 'insert:4']);
  });

  it('does nothing when the catalogue lists none of the models', async () => {
    const result = await syncModelPrices({ from: () => { throw new Error('should not be called'); } }, { registry, live: () => null });
    expect(result).toMatchObject({ listed: 0, changed: 0 });
  });

  it('is on unless CODEN_PRICE_SYNC=0', () => {
    expect(priceSyncEnabled({})).toBe(true);
    expect(priceSyncEnabled({ CODEN_PRICE_SYNC: '0' })).toBe(false);
  });
});
