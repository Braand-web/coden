import assert from 'node:assert/strict';
import { insertUnifiedUsageEvent } from './src/services/unified-usage-store.ts';

const row = { account_id: 'account', category: 'build', model: 'model', complete_cost_usd: 0.01, idempotency_key: 'request' };
function mock(options: { missing?: boolean; duplicate?: boolean; foreignDuplicate?: boolean; insertError?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  const filters: Record<string, unknown>[] = [];
  const client = { from(table: string) {
    let inserted = false;
    const where: Record<string, unknown> = {};
    const q = {
      select() { return q; },
      eq(key: string, value: unknown) { where[key] = value; return q; },
      insert(rows: Record<string, unknown>[]) { inserted = true; writes.push(...rows); return q; },
      async maybeSingle() {
        filters.push({ table, ...where });
        if (table === 'billing_accounts') return { data: options.missing ? null : { organization_id: 'organization' }, error: null };
        if (inserted) {
          if (options.duplicate) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (options.insertError) return { data: null, error: { code: '23502', message: 'not null violation' } };
          assert.equal(writes[0].organization_id, 'organization');
          assert.equal(writes[0].action_type, 'build');
          return { data: { id: 'event' }, error: null };
        }
        assert.equal(where.account_id, 'account');
        assert.equal(where.organization_id, 'organization');
        assert.equal(where.idempotency_key, 'request');
        return { data: options.foreignDuplicate ? null : { id: 'event' }, error: null };
      },
    };
    return q;
  } } as unknown as Parameters<typeof insertUnifiedUsageEvent>[0];
  return { client, writes, filters };
}
const normal = mock();
assert.equal(await insertUnifiedUsageEvent(normal.client, row), 'event');
assert.equal(normal.writes[0].workspace_id, 'organization');
assert.equal(normal.writes[0].cost_usd, 0.01);
assert.equal(normal.writes[0].model_used, 'model');
assert.equal(normal.writes[0].account_id, 'account');
assert.equal(await insertUnifiedUsageEvent(mock({ duplicate: true }).client, row), 'event');
await assert.rejects(insertUnifiedUsageEvent(mock({ duplicate: true, foreignDuplicate: true }).client, row), /persistence failed/);
const missing = mock({ missing: true });
await assert.rejects(insertUnifiedUsageEvent(missing.client, row), /account lookup failed/);
assert.equal(missing.writes.length, 0);
await assert.rejects(insertUnifiedUsageEvent(mock({ insertError: true }).client, row), /persistence failed/);
console.log('Unified usage store: legacy tenant fields, account mapping, replay isolation and fail-closed persistence passed.');
