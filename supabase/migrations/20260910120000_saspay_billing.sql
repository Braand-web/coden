-- Move Coden checkout settlement to Saspay while preserving Stripe rows as
-- immutable billing history. Internal cost accounting remains USD based.

alter table public.billing_provider_customers
  drop constraint if exists billing_provider_customers_provider_check;
alter table public.billing_provider_customers
  add constraint billing_provider_customers_provider_check
  check (provider in ('stripe', 'saspay'));

alter table public.billing_subscriptions_v2
  drop constraint if exists billing_subscriptions_v2_provider_check;
alter table public.billing_subscriptions_v2
  add constraint billing_subscriptions_v2_provider_check
  check (provider in ('stripe', 'saspay'));

create table if not exists public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  provider text not null default 'saspay' check (provider = 'saspay'),
  kind text not null check (kind in ('subscription', 'topup')),
  plan_id text not null references public.plan_catalog(id),
  plan_key text not null check (plan_key in ('pro', 'business')),
  credit_tier numeric(16, 4) not null check (credit_tier > 0),
  billing_interval text not null check (billing_interval in ('monthly', 'annual', 'one_time')),
  amount numeric(18, 2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  price_version_id text not null,
  provider_checkout_id text unique,
  provider_transaction_id text unique,
  provider_reference text,
  checkout_url text,
  customer_email text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'expired')),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_billing_checkout_intents_account_time
  on public.billing_checkout_intents (account_id, created_at desc);
create index if not exists idx_billing_checkout_intents_pending
  on public.billing_checkout_intents (status, expires_at)
  where status = 'pending';

alter table public.billing_checkout_intents enable row level security;
drop policy if exists billing_checkout_intents_owner_select on public.billing_checkout_intents;
create policy billing_checkout_intents_owner_select
  on public.billing_checkout_intents
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.billing_accounts account
      where account.id = billing_checkout_intents.account_id
        and account.owner_user_id = (select auth.uid())
    )
  );

grant select on public.billing_checkout_intents to authenticated;

update public.plan_catalog
set version = '2026-09-10.saspay-v1',
    configuration = case plan_key
      when 'free' then '{"daily_build":5,"daily_monthly_cap":30,"monthly_cloud":20,"monthly_ai":4,"provider":"saspay"}'::jsonb
      when 'pro' then '{"base_credits":100,"base_monthly_usd":25,"base_monthly_xaf":15000,"annual_discount":0.20,"email_grant":1000,"provider":"saspay"}'::jsonb
      when 'business' then '{"base_credits":100,"base_monthly_usd":50,"base_monthly_xaf":30000,"annual_discount":0.20,"email_grant":1000,"astra_manual":true,"provider":"saspay"}'::jsonb
      else configuration
    end
where id in ('coden_free_v2', 'coden_pro_v2', 'coden_business_v2');

with tiers(credits) as (
  values (100::numeric),(200),(400),(800),(1200),(2000),(3000),(4000),(5000),(7500),(10000)
), public_plans(plan_id, plan_key, base_usd, base_xaf) as (
  values
    ('coden_pro_v2','pro',25::numeric,15000::numeric),
    ('coden_business_v2','business',50::numeric,30000::numeric)
), intervals(interval_name, multiplier) as (
  values ('monthly',1::numeric), ('annual',9.6::numeric)
)
insert into public.price_versions (
  id, plan_id, interval, credits, amount_usd, effective_from, metadata
)
select
  format('%s_%s_%s_2026-09-10.saspay-v1', plan_key, credits::int, interval_name),
  plan_id,
  interval_name,
  credits,
  round(base_usd * credits / 100 * multiplier, 2),
  '2026-09-10T00:00:00Z'::timestamptz,
  jsonb_build_object(
    'version','2026-09-10.saspay-v1',
    'provider','saspay',
    'currency','XAF',
    'amount',round(base_xaf * credits / 100 * multiplier, 0)
  )
from tiers cross join public_plans cross join intervals
on conflict (id) do nothing;

with topup_tiers(credits) as (
  values (50::numeric),(100),(150),(200),(250),(300),(400),(500),(1000),(2000),(3000),(5000),(10000)
), public_plans(plan_id, plan_key, base_usd, base_xaf) as (
  values
    ('coden_pro_v2','pro',25::numeric,15000::numeric),
    ('coden_business_v2','business',50::numeric,30000::numeric)
)
insert into public.price_versions (
  id, plan_id, interval, credits, amount_usd, effective_from, metadata
)
select
  format('topup_%s_%s_2026-09-10.saspay-v1', plan_key, credits::int),
  plan_id,
  'one_time',
  credits,
  round(base_usd * credits / 100 * 1.25, 2),
  '2026-09-10T00:00:00Z'::timestamptz,
  jsonb_build_object(
    'version','2026-09-10.saspay-v1',
    'provider','saspay',
    'currency','XAF',
    'amount',round(base_xaf * credits / 100 * 1.25, 0),
    'expires_months',12
  )
from topup_tiers cross join public_plans
on conflict (id) do nothing;
