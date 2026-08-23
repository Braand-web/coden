-- Coden Cloud metering: real consumption debit + suspension.
-- The cloud_usage_ledger already accepts consumption usage_types
-- (database_storage, file_storage, network, compute, live_updates, ai_app_usage).
-- This migration adds: a status flag on the wallet, and an ATOMIC debit function
-- that prevents the lost-update race of a read-then-write code path.

alter table public.cloud_wallets
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended'));

alter table public.cloud_wallets
  add column if not exists last_metered_at timestamptz;

-- Atomic debit. Returns the new balance. Suspends the wallet when it hits 0 and
-- auto-topup is disabled. amount_usd is stored NEGATIVE in the ledger for spend.
create or replace function public.debit_cloud_balance(
  org_id uuid,
  spend_usd numeric,
  category text,
  qty numeric default null,
  unit_label text default null,
  note text default null,
  ref text default null,
  proj_id uuid default null
) returns numeric
language plpgsql
security definer
as $$
declare
  current_balance numeric;
  auto_topup boolean;
  new_balance numeric;
begin
  if spend_usd is null or spend_usd <= 0 then
    return (select balance_usd from public.cloud_wallets where organization_id = org_id);
  end if;

  -- Lock the row to serialize concurrent meter writers.
  select balance_usd, auto_topup_enabled
    into current_balance, auto_topup
  from public.cloud_wallets
  where organization_id = org_id
  for update;

  if not found then
    insert into public.cloud_wallets (organization_id, balance_usd)
    values (org_id, 0)
    on conflict (organization_id) do nothing;
    current_balance := 0;
    auto_topup := false;
  end if;

  new_balance := greatest(0, current_balance - spend_usd);

  update public.cloud_wallets
  set balance_usd = new_balance,
      status = case
        when new_balance <= 0 and coalesce(auto_topup, false) = false then 'suspended'
        else status
      end,
      last_metered_at = now(),
      updated_at = now()
  where organization_id = org_id;

  insert into public.cloud_usage_ledger
    (organization_id, project_id, usage_type, amount_usd, quantity, unit, description, reference_id)
  values
    (org_id, proj_id, category, -spend_usd, qty, unit_label, note, ref);

  return new_balance;
end;
$$;

-- Reactivate a wallet after a successful top-up (call from the Stripe webhook).
create or replace function public.reactivate_cloud_wallet(org_id uuid)
returns void
language sql
security definer
as $$
  update public.cloud_wallets
  set status = 'active', updated_at = now()
  where organization_id = org_id and balance_usd > 0;
$$;

-- Shared-mode storage collector: total on-disk bytes per app_* schema.
-- Map schema -> organization via your project registry before debiting.
create or replace function public.collect_app_schema_bytes()
returns table(schema_name text, total_bytes bigint)
language sql
stable
as $$
  select n.nspname as schema_name,
         coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as total_bytes
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname like 'app\_%' escape '\'
    and c.relkind in ('r', 'm', 't')
  group by n.nspname;
$$;
