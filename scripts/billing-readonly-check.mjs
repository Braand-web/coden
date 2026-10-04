/** Read-only financial preflight. Credentials arrive on stdin, never in arguments or files. */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const env = JSON.parse(Buffer.concat(input).toString('utf8').replace(/^\uFEFF/, ''));
const ref = 'ftmbiocvslxctldfihcp';
const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
if (new URL(base).hostname !== `${ref}.supabase.co`) throw new Error('Central Coden database required.');
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const tables = ['billing_accounts', 'credit_wallets', 'credit_transactions', 'credit_grants', 'credit_ledger_entries', 'usage_reservations', 'usage_reservation_lines', 'usage_settlements', 'usage_events', 'billing_subscriptions_v2', 'billing_checkout_intents', 'provider_webhook_events', 'plan_catalog', 'price_versions', 'billing_pricing_versions'];
const backup = { capturedAt: new Date().toISOString(), projectRef: ref, tables: {}, definitions: null, schemaMetadata: null, snapshot: null };
const summary = { capturedAt: backup.capturedAt, tables: {}, sqlAccess: null };
for (const table of tables) {
  const rows = [];
  const order = table === 'provider_webhook_events' ? 'provider,event_id' : table === 'credit_wallets' ? 'organization_id' : 'id';
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const r = await fetch(`${base}/rest/v1/${table}?select=*&order=${order}&limit=1000&offset=${offset}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { summary.tables[table] = { status: r.status }; break; }
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error('Unexpected database response');
    rows.push(...data);
    if (data.length < 1000) { backup.tables[table] = rows; summary.tables[table] = { rows: rows.length, sha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }; break; }
    if (offset === 49_000) throw new Error('Incomplete financial backup: row ceiling reached');
  }
}
if (env.CODEN_SUPABASE_MGMT_TOKEN) {
  // One statement = one MVCC snapshot: concurrent grants and reservations cannot
  // make a multi-request REST export look like a financial discrepancy.
  const present = tables.filter(table => Array.isArray(backup.tables[table]));
  const quoted = present.map(table => `'${table}'`).join(',');
  const tablePairs = present.map(table => `'${table}',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.${table} t)`).join(',');
  const query = `select jsonb_build_object('tables',jsonb_build_object(${tablePairs}),
    'snapshot',pg_current_snapshot()::text,'capturedAt',statement_timestamp(),
    'definitions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))),'[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
        and (p.proname like 'coden_billing_%' or p.proname like 'coden_pricing_%' or p.proname='coden_activate_pricing_version' or p.proname='coden_ledger_immutable')),
    'schemaMetadata',jsonb_build_object(
      'tables',(select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl)),'[]'::jsonb) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted})),
      'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,'definition',pg_get_constraintdef(x.oid))),'[]'::jsonb) from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in (${quoted})),
      'indexes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from pg_indexes x where schemaname='public' and tablename in (${quoted})),
      'policies',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from pg_policies x where schemaname='public' and tablename in (${quoted})),
      'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_triggerdef(t.oid))),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public' and c.relname in (${quoted})))) as financial_snapshot`;
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.CODEN_SUPABASE_MGMT_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(20_000) });
  summary.sqlAccess = r.status;
  if (r.ok) {
    const data=await r.json(), snapshot=data?.[0]?.financial_snapshot;
    if (!snapshot?.tables || !snapshot?.definitions || !snapshot?.schemaMetadata) throw new Error('Incomplete atomic financial export');
    backup.tables=snapshot.tables; backup.definitions=snapshot.definitions; backup.schemaMetadata=snapshot.schemaMetadata;
    backup.snapshot=snapshot.snapshot; backup.capturedAt=snapshot.capturedAt;
    summary.capturedAt=backup.capturedAt;
    for (const [table,rows] of Object.entries(backup.tables)) summary.tables[table]={rows:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
}
const grants = backup.tables.credit_grants || [];
const ledger = backup.tables.credit_ledger_entries || [];
const byAccount = new Map();
const add = (id, field, value) => { const row = byAccount.get(id) || { ledgerNet: 0, grantRemainder: 0, reserved: 0 }; row[field] += Number(value) || 0; byAccount.set(id, row); };
for (const g of grants) add(g.account_id, 'grantRemainder', g.credits_remaining);
for (const l of ledger) if (['grant','refund','usage','freeze','expiry','expiration','adjustment'].includes(l.entry_type)) add(l.account_id, 'ledgerNet', l.amount_credits);
for (const r of backup.tables.usage_reservations || []) if (r.status === 'reserved') add(r.account_id, 'reserved', r.credits_reserved);
const differences = [...byAccount.values()].filter(row => Math.abs(row.ledgerNet - row.grantRemainder - row.reserved) > 0.0001);
summary.reconciliation = { accounts: byAccount.size, unexplainedAccounts: differences.length, unexplainedCreditDelta: differences.reduce((sum,row) => sum + row.ledgerNet - row.grantRemainder - row.reserved, 0), note: 'All grants including frozen/expired; historical freezes/expiries must be classified before cutover.' };
summary.reservations = { total: (backup.tables.usage_reservations || []).length, open: (backup.tables.usage_reservations || []).filter(r => r.status === 'reserved').length };
summary.reservations.expiredOpen = (backup.tables.usage_reservations || []).filter(r => r.status === 'reserved' && Date.parse(r.expires_at) < Date.now()).length;
summary.grants = {
  total: grants.length,
  frozen: grants.filter(g => g.frozen_at || g.status === 'frozen').length,
  expiredWithRemainder: grants.filter(g => Date.parse(g.expires_at) < Date.now() && Number(g.credits_remaining) > 0).length,
};
summary.subscriptions = { total: (backup.tables.billing_subscriptions_v2 || []).length };
summary.atomicSnapshot=Boolean(backup.snapshot);
summary.safeForMigration = Boolean(backup.snapshot && backup.definitions && backup.schemaMetadata && differences.length === 0
  && summary.reservations.expiredOpen===0 && tables.filter(t => !['credit_transactions','credit_wallets'].includes(t)).every(t => backup.tables[t]));
summary.migrationBlockers=[...(!backup.snapshot?['atomic_export_missing']:[]),...(differences.length?['unexplained_balance_delta']:[]),
  ...(summary.reservations.expiredOpen?['expired_reservations_require_delivery_reconciliation']:[])];
if (process.argv.includes('--backup')) {
  const destination = resolve(process.env.USERPROFILE || process.env.HOME, '.codex/private/coden-billing', `before-${Date.now()}.json`);
  await mkdir(resolve(destination, '..'), { recursive: true, mode: 0o700 });
  await writeFile(destination, JSON.stringify(backup), { flag: 'wx', mode: 0o600 });
  summary.backupPath = destination;
}
console.log(JSON.stringify(summary, null, 2));
