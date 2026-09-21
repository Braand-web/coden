-- Canonical customer-credit policy and paid publication entitlements.
-- Additive/history-preserving migration: legacy rows remain queryable, but
-- recurring Free grants are frozen and can no longer affect the live balance.

begin;

alter table public.credit_grants
  drop constraint if exists credit_grants_kind_check;
alter table public.credit_grants
  add constraint credit_grants_kind_check check (
    kind in ('signup_free', 'daily_build', 'monthly_cloud', 'monthly_ai', 'monthly_plan', 'rollover', 'bonus', 'topup', 'commitment', 'email')
  );

update public.plan_catalog
set version = '2026-09-19.canonical-v1',
    configuration = case plan_key
      when 'free' then '{"signup_credits":5,"grant_once":true,"published_sites":0,"custom_domains":0,"preview":"private","provider":"saspay"}'::jsonb
      when 'pro' then '{"credit_tiers":[25,60,100],"monthly_xaf":[5000,10000,15000],"published_sites":{"25":1,"60":3,"100":null},"custom_domains":{"25":1,"60":3,"100":10},"annual_discount":0.20,"provider":"saspay"}'::jsonb
      when 'business' then '{"base_credits":250,"base_monthly_xaf":30000,"published_sites":null,"custom_domains":null,"annual_discount":0.20,"provider":"saspay"}'::jsonb
      else configuration
    end,
    active = true
where plan_key in ('free', 'pro', 'business');

update public.price_versions
set effective_until = coalesce(effective_until, now())
where effective_until is null
  and plan_id in ('coden_pro_v2', 'coden_business_v2')
  and id not like '%2026-09-19.canonical-v1';

insert into public.price_versions (
  id, plan_id, interval, credits, amount_usd, effective_from, metadata
) values
  ('pro_25_monthly_2026-09-19.canonical-v1', 'coden_pro_v2', 'monthly', 25, 8.3333, '2026-09-19T00:00:00Z', '{"amount_xaf":5000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('pro_25_annual_2026-09-19.canonical-v1', 'coden_pro_v2', 'annual', 25, 80.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":48000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('pro_60_monthly_2026-09-19.canonical-v1', 'coden_pro_v2', 'monthly', 60, 16.6667, '2026-09-19T00:00:00Z', '{"amount_xaf":10000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('pro_60_annual_2026-09-19.canonical-v1', 'coden_pro_v2', 'annual', 60, 160.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":96000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('pro_100_monthly_2026-09-19.canonical-v1', 'coden_pro_v2', 'monthly', 100, 25.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":15000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('pro_100_annual_2026-09-19.canonical-v1', 'coden_pro_v2', 'annual', 100, 240.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":144000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('business_250_monthly_2026-09-19.canonical-v1', 'coden_business_v2', 'monthly', 250, 50.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":30000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb),
  ('business_250_annual_2026-09-19.canonical-v1', 'coden_business_v2', 'annual', 250, 480.0000, '2026-09-19T00:00:00Z', '{"amount_xaf":288000,"provider":"saspay","version":"2026-09-19.canonical-v1"}'::jsonb)
on conflict (id) do update set
  amount_usd = excluded.amount_usd,
  effective_from = excluded.effective_from,
  effective_until = null,
  metadata = excluded.metadata;

-- Recurrent Free buckets are historical facts, not current entitlement.
update public.credit_grants as grant_row
set frozen_at = coalesce(grant_row.frozen_at, now()),
    metadata = coalesce(grant_row.metadata, '{}'::jsonb) || '{"frozen_reason":"free_policy_replaced_2026-09-19"}'::jsonb
from public.billing_accounts as account_row
join public.organizations as organization_row on organization_row.id = account_row.organization_id
where grant_row.account_id = account_row.id
  and coalesce(organization_row.plan, 'free') = 'free'
  and grant_row.kind in ('daily_build', 'monthly_cloud', 'monthly_ai')
  and grant_row.frozen_at is null;

-- Existing Free accounts receive the same one-time grant as future accounts.
-- The source/idempotency key makes the statement safe to replay.
select public.coden_billing_grant(
  account_row.id,
  'signup_free',
  'general',
  5,
  0,
  1,
  '2099-12-31T23:59:59.999Z'::timestamptz,
  'signup_free:' || account_row.id::text || ':v1',
  'signup_free:' || account_row.id::text || ':v1',
  '{"provider":"coden","policy":"one_time_free_5","version":"2026-09-19.canonical-v1"}'::jsonb
)
from public.billing_accounts as account_row
join public.organizations as organization_row on organization_row.id = account_row.organization_id
where coalesce(organization_row.plan, 'free') = 'free';

create index if not exists idx_billing_subscriptions_account_entitlement
  on public.billing_subscriptions_v2 (account_id, current_period_end desc);

create table if not exists public.publication_entitlement_suspensions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  vercel_project text not null,
  status text not null default 'paused' check (status in ('paused', 'active', 'missing', 'error')),
  reason text not null default 'subscription_inactive_after_grace',
  paused_at timestamptz,
  resumed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique (project_id)
);
create index if not exists idx_publication_suspensions_account_status
  on public.publication_entitlement_suspensions (account_id, status, updated_at desc);
alter table public.publication_entitlement_suspensions enable row level security;
revoke all on table public.publication_entitlement_suspensions from public, anon, authenticated;
grant select, insert, update, delete on table public.publication_entitlement_suspensions to service_role;

-- Revenue is derived from the exact grants consumed. The caller-supplied
-- value is retained in the signature for compatibility but is not trusted.
create or replace function public.coden_billing_settle(
  p_reservation_id uuid,
  p_usage_event_id uuid,
  p_credits_charged numeric,
  p_complete_cost_usd numeric,
  p_realized_revenue_usd numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row record;
  line_row record;
  credit_left numeric := greatest(coalesce(p_credits_charged, 0), 0);
  cogs_left numeric := greatest(coalesce(p_complete_cost_usd, 0), 0);
  used_credit numeric;
  used_cogs numeric;
  realized_revenue numeric := 0;
  account_balance numeric;
  settlement_id uuid;
begin
  select id into settlement_id from public.usage_settlements where reservation_id = p_reservation_id;
  if settlement_id is not null then return settlement_id; end if;
  select * into reservation_row from public.usage_reservations where id = p_reservation_id for update;
  if not found or reservation_row.status <> 'reserved' then raise exception 'Reservation is not settleable'; end if;
  if p_credits_charged > reservation_row.credits_reserved then
    raise exception 'Actual credit usage exceeds reserved upper bound';
  end if;

  for line_row in
    select reservation_line.*, credit_grant.net_revenue_usd, credit_grant.credits_issued
    from public.usage_reservation_lines as reservation_line
    join public.credit_grants as credit_grant on credit_grant.id = reservation_line.grant_id
    where reservation_line.reservation_id = p_reservation_id
    order by reservation_line.created_at, reservation_line.id
  loop
    used_credit := least(line_row.credits_reserved, credit_left);
    used_cogs := least(line_row.cogs_reserved_usd, cogs_left);
    realized_revenue := realized_revenue + case
      when line_row.credits_issued > 0 then used_credit * line_row.net_revenue_usd / line_row.credits_issued
      else 0
    end;
    update public.credit_grants set
      credits_remaining = credits_remaining + (line_row.credits_reserved - used_credit),
      max_cogs_remaining_usd = max_cogs_remaining_usd + (line_row.cogs_reserved_usd - used_cogs)
    where id = line_row.grant_id;
    credit_left := greatest(0, credit_left - used_credit);
    cogs_left := greatest(0, cogs_left - used_cogs);
  end loop;

  if credit_left > 0.0001 then raise exception 'Reservation lines do not cover settlement'; end if;
  update public.usage_reservations set status = 'settled', settled_at = now() where id = p_reservation_id;
  insert into public.usage_settlements (reservation_id, usage_event_id, credits_charged, complete_cost_usd, realized_revenue_usd, realized_margin)
  values (
    p_reservation_id,
    p_usage_event_id,
    p_credits_charged,
    p_complete_cost_usd,
    realized_revenue,
    case when realized_revenue > 0 then (realized_revenue - p_complete_cost_usd) / realized_revenue else null end
  )
  returning id into settlement_id;
  select coalesce(sum(credits_remaining), 0) into account_balance from public.credit_grants
    where account_id = reservation_row.account_id and frozen_at is null and expires_at > now();
  insert into public.credit_ledger_entries (account_id, reservation_id, usage_event_id, entry_type, amount_credits, balance_after, description, idempotency_key)
  values (reservation_row.account_id, p_reservation_id, p_usage_event_id, 'usage', -p_credits_charged, account_balance, 'Usage settled from canonical grant revenue and measured provider cost', p_reservation_id::text || ':settle')
  on conflict (idempotency_key) do nothing;
  return settlement_id;
end;
$$;

revoke all on function public.coden_billing_settle(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.coden_billing_settle(uuid, uuid, numeric, numeric, numeric) to service_role;

commit;
