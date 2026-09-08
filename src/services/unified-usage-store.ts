import type { SupabaseClient } from '@supabase/supabase-js';

type UsageRow = Record<string, unknown> & {
  account_id: string;
  category: string;
  model: string | null;
  complete_cost_usd: number;
  idempotency_key: string;
};

/** Preserve the tenant contract of the pre-V4 usage table during dual read. */
export async function insertUnifiedUsageEvent(client: Pick<SupabaseClient, 'from'>, row: UsageRow): Promise<string> {
  const account = await client.from('billing_accounts').select('organization_id').eq('id', row.account_id).maybeSingle();
  if (account.error || !account.data?.organization_id) {
    throw new Error(`Measured usage account lookup failed: ${account.error?.message || 'billing account missing'}`);
  }
  const organizationId = String(account.data.organization_id);
  const inserted = await client.from('usage_events').insert([{
    ...row,
    organization_id: organizationId,
    workspace_id: organizationId,
    action_type: row.category,
    model_used: row.model,
    cost_usd: row.complete_cost_usd,
  }]).select('id').maybeSingle();
  if (!inserted.error && inserted.data?.id) return String(inserted.data.id);
  if (inserted.error?.code === '23505') {
    const existing = await client.from('usage_events').select('id')
      .eq('account_id', row.account_id)
      .eq('organization_id', organizationId)
      .eq('idempotency_key', row.idempotency_key).maybeSingle();
    if (!existing.error && existing.data?.id) return String(existing.data.id);
  }
  throw new Error(`Measured usage persistence failed: ${inserted.error?.message || 'no usage event returned'}`);
}
