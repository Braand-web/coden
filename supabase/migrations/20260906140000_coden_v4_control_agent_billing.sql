-- Coden V4 additive control-plane, durable stream and unified billing ledger.
-- The legacy wallets remain untouched for shadow comparison and rollback.

create table if not exists public.billing_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  currency text not null default 'usd' check (currency = 'usd'),
  status text not null default 'active' check (status in ('active', 'past_due', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_provider_customers (
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  provider text not null check (provider = 'stripe'),
  provider_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, provider)
);

create table if not exists public.plan_catalog (
  id text primary key,
  plan_key text not null check (plan_key in ('free', 'pro', 'business', 'enterprise')),
  version text not null,
  name text not null,
  active boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (plan_key, version)
);

create table if not exists public.price_versions (
  id text primary key,
  plan_id text not null references public.plan_catalog(id),
  interval text not null check (interval in ('monthly', 'annual', 'one_time', 'contract')),
  credits numeric(16, 4),
  amount_usd numeric(16, 4) not null check (amount_usd >= 0),
  stripe_price_id text,
  effective_from timestamptz not null,
  effective_until timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_subscriptions_v2 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  plan_id text not null references public.plan_catalog(id),
  price_version_id text references public.price_versions(id),
  provider text not null default 'stripe' check (provider = 'stripe'),
  provider_customer_id text,
  provider_subscription_id text unique,
  credit_tier numeric(16, 4),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'annual', 'contract')),
  status text not null default 'inactive',
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_credit_grant_at timestamptz,
  next_credit_grant_at timestamptz,
  monthly_net_revenue_usd numeric(16, 8) not null default 0 check (monthly_net_revenue_usd >= 0),
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_grants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  kind text not null check (kind in ('daily_build', 'monthly_cloud', 'monthly_ai', 'monthly_plan', 'rollover', 'bonus', 'topup', 'commitment', 'email')),
  usage_restriction text not null check (usage_restriction in ('build', 'cloud', 'ai_gateway', 'general', 'email')),
  credits_issued numeric(16, 4) not null check (credits_issued > 0),
  credits_remaining numeric(16, 4) not null check (credits_remaining >= 0 and credits_remaining <= credits_issued),
  net_revenue_usd numeric(16, 8) not null default 0 check (net_revenue_usd >= 0),
  max_cogs_usd numeric(16, 8) not null check (max_cogs_usd >= 0),
  max_cogs_remaining_usd numeric(16, 8) not null check (max_cogs_remaining_usd >= 0 and max_cogs_remaining_usd <= max_cogs_usd),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  frozen_at timestamptz,
  source_reference text not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  workspace_id uuid,
  project_id uuid references public.projects(id) on delete set null,
  run_id text,
  category text not null check (category in ('build', 'cloud', 'ai_gateway', 'email')),
  resource text not null,
  provider text not null,
  model text,
  quantity numeric(24, 8) not null default 0 check (quantity >= 0),
  unit text not null,
  provider_cost_usd numeric(18, 10) not null default 0 check (provider_cost_usd >= 0),
  allocated_platform_cost_usd numeric(18, 10) not null default 0 check (allocated_platform_cost_usd >= 0),
  complete_cost_usd numeric(18, 10) not null default 0 check (complete_cost_usd >= 0),
  price_version_id text,
  idempotency_key text not null unique,
  provider_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- `usage_events` predates V4 in this project. Extend it in place so its
-- historical rows remain queryable while the V4 metering contract gets the
-- fields it needs. Legacy rows intentionally keep a null account_id.
alter table public.usage_events add column if not exists account_id uuid references public.billing_accounts(id) on delete set null;
alter table public.usage_events add column if not exists workspace_id uuid;
alter table public.usage_events add column if not exists run_id text;
alter table public.usage_events add column if not exists category text not null default 'legacy';
alter table public.usage_events add column if not exists resource text not null default 'legacy';
alter table public.usage_events add column if not exists provider text not null default 'legacy';
alter table public.usage_events add column if not exists model text;
alter table public.usage_events add column if not exists quantity numeric(24, 8) not null default 1;
alter table public.usage_events add column if not exists unit text not null default 'event';
alter table public.usage_events add column if not exists provider_cost_usd numeric(18, 10) not null default 0;
alter table public.usage_events add column if not exists allocated_platform_cost_usd numeric(18, 10) not null default 0;
alter table public.usage_events add column if not exists complete_cost_usd numeric(18, 10) not null default 0;
alter table public.usage_events add column if not exists price_version_id text;
alter table public.usage_events add column if not exists idempotency_key text;
alter table public.usage_events add column if not exists provider_payload jsonb not null default '{}'::jsonb;
alter table public.usage_events add column if not exists occurred_at timestamptz not null default now();

update public.usage_events
set model = coalesce(model, model_used),
    category = case when category = 'legacy' then coalesce(action_type, 'legacy') else category end,
    resource = case when resource = 'legacy' then coalesce(action_type, 'legacy') else resource end,
    quantity = case when quantity = 1 and cost_credits is not null then greatest(cost_credits, 1) else quantity end,
    provider_cost_usd = case when provider_cost_usd = 0 then coalesce(cost_usd, 0) else provider_cost_usd end,
    complete_cost_usd = case when complete_cost_usd = 0 then coalesce(cost_usd, 0) else complete_cost_usd end,
    occurred_at = coalesce(occurred_at, created_at)
where account_id is null;

create unique index if not exists idx_usage_events_idempotency
  on public.usage_events (idempotency_key)
  where idempotency_key is not null;

create table if not exists public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  category text not null check (category in ('build', 'cloud', 'ai_gateway', 'email')),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'expired')),
  credits_reserved numeric(16, 4) not null default 0 check (credits_reserved >= 0),
  cogs_reserved_usd numeric(18, 10) not null default 0 check (cogs_reserved_usd >= 0),
  idempotency_key text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists public.usage_reservation_lines (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.usage_reservations(id) on delete cascade,
  grant_id uuid not null references public.credit_grants(id),
  credits_reserved numeric(16, 4) not null check (credits_reserved > 0),
  cogs_reserved_usd numeric(18, 10) not null check (cogs_reserved_usd >= 0),
  created_at timestamptz not null default now(),
  unique (reservation_id, grant_id)
);

create table if not exists public.usage_settlements (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.usage_reservations(id),
  usage_event_id uuid references public.usage_events(id),
  credits_charged numeric(16, 4) not null check (credits_charged >= 0),
  complete_cost_usd numeric(18, 10) not null check (complete_cost_usd >= 0),
  realized_revenue_usd numeric(18, 10) not null default 0,
  realized_margin numeric(10, 8),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  grant_id uuid references public.credit_grants(id),
  reservation_id uuid references public.usage_reservations(id),
  usage_event_id uuid references public.usage_events(id),
  entry_type text not null check (entry_type in ('grant', 'reservation', 'usage', 'release', 'expiration', 'refund', 'adjustment', 'freeze', 'unfreeze')),
  amount_credits numeric(16, 4) not null,
  balance_after numeric(16, 4) not null check (balance_after >= 0),
  description text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_cost_catalog (
  id text primary key,
  provider text not null,
  resource text not null,
  unit text not null,
  unit_cost_usd numeric(22, 12) not null check (unit_cost_usd >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  source_url text not null,
  source_revision text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (provider, resource, effective_from)
);

create table if not exists public.provider_invoice_imports (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_usd numeric(18, 8) not null check (amount_usd >= 0),
  source_reference text not null unique,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.provider_reconciliations (
  id uuid primary key default gen_random_uuid(),
  invoice_import_id uuid not null references public.provider_invoice_imports(id) on delete cascade,
  metered_cost_usd numeric(18, 8) not null,
  invoiced_cost_usd numeric(18, 8) not null,
  variance_usd numeric(18, 8) not null,
  status text not null check (status in ('matched', 'review', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.auto_topup_configs (
  account_id uuid primary key references public.billing_accounts(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  enabled boolean not null default false,
  credits_to_add numeric(16, 4) not null default 0,
  threshold_credits numeric(16, 4) not null default 0,
  monthly_cap_credits numeric(16, 4) not null default 0,
  credits_added_this_month numeric(16, 4) not null default 0,
  usage_month date not null default date_trunc('month', now())::date,
  provider_payment_method_id text,
  in_progress_key text,
  in_progress_started_at timestamptz,
  last_triggered_at timestamptz,
  last_error text,
  price_version_id text references public.price_versions(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.spend_limits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  scope text not null check (scope in ('account', 'workspace', 'project', 'member')),
  scope_id uuid,
  category text check (category in ('build', 'cloud', 'ai_gateway', 'email')),
  period text not null check (period in ('day', 'month', 'run')),
  credit_limit numeric(16, 4),
  cogs_limit_usd numeric(18, 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_alerts_v2 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.billing_accounts(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.billing_audit_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.billing_accounts(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  trace_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.provider_webhook_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

create table if not exists public.agent_stream_events (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  message_id text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  channel text not null check (channel in ('chat', 'workspace')),
  event_type text not null,
  envelope jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);

create table if not exists public.agent_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('plan', 'specification', 'report', 'diff', 'screenshot')),
  title text not null,
  version integer not null check (version > 0),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, kind, version)
);

create table if not exists public.agent_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  selected_value text,
  freeform_value text,
  status text not null default 'pending' check (status in ('pending', 'answered', 'dismissed')),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_grants_available on public.credit_grants (account_id, usage_restriction, expires_at) where credits_remaining > 0 and frozen_at is null;
create index if not exists idx_usage_events_account_time on public.usage_events (account_id, occurred_at desc);
create index if not exists idx_usage_events_project_time on public.usage_events (project_id, occurred_at desc) where project_id is not null;
create index if not exists idx_credit_ledger_account_time on public.credit_ledger_entries (account_id, created_at desc);
create index if not exists idx_agent_stream_replay on public.agent_stream_events (run_id, sequence);
create index if not exists idx_agent_artifacts_project_time on public.agent_artifacts (project_id, created_at desc);

insert into public.plan_catalog (id, plan_key, version, name, configuration) values
  ('coden_free_v2', 'free', '2026-09-06.v1', 'Free', '{"daily_build":5,"daily_monthly_cap":30,"monthly_cloud":20,"monthly_ai":4}'::jsonb),
  ('coden_pro_v2', 'pro', '2026-09-06.v1', 'Pro', '{"base_credits":100,"base_monthly_usd":25,"annual_discount":0.20,"email_grant":1000}'::jsonb),
  ('coden_business_v2', 'business', '2026-09-06.v1', 'Business', '{"base_credits":100,"base_monthly_usd":50,"annual_discount":0.20,"email_grant":1000,"astra_manual":true}'::jsonb),
  ('coden_enterprise_v2', 'enterprise', '2026-09-06.v1', 'Enterprise', '{"contracted":true}'::jsonb)
on conflict (id) do update set configuration = excluded.configuration, active = true;

with tiers(credits) as (
  values (100::numeric),(200),(400),(800),(1200),(2000),(3000),(4000),(5000),(7500),(10000)
), public_plans(plan_id, plan_key, base_usd) as (
  values ('coden_pro_v2','pro',25::numeric), ('coden_business_v2','business',50::numeric)
), intervals(interval_name, multiplier) as (
  values ('monthly',1::numeric), ('annual',9.6::numeric)
)
insert into public.price_versions (
  id, plan_id, interval, credits, amount_usd, effective_from, metadata
)
select
  format('%s_%s_%s_20260906', plan_key, credits::int, interval_name),
  plan_id,
  interval_name,
  credits,
  round(base_usd * credits / 100 * multiplier, 2),
  '2026-09-06T00:00:00Z'::timestamptz,
  jsonb_build_object(
    'version','2026-09-06.v1',
    'stripe_price_env',format('STRIPE_PRICE_%s_%s_%s',upper(plan_key),credits::int,upper(interval_name))
  )
from tiers cross join public_plans cross join intervals
on conflict (id) do nothing;

with topup_tiers(credits) as (
  values (50::numeric),(100),(150),(200),(250),(300),(400),(500),(1000),(2000),(3000),(5000),(10000)
), public_plans(plan_id, plan_key, base_usd) as (
  values ('coden_pro_v2','pro',25::numeric), ('coden_business_v2','business',50::numeric)
)
insert into public.price_versions (
  id, plan_id, interval, credits, amount_usd, effective_from, metadata
)
select
  format('topup_%s_%s_20260906', plan_key, credits::int),
  plan_id,
  'one_time',
  credits,
  round(base_usd * credits / 100 * 1.25, 2),
  '2026-09-06T00:00:00Z'::timestamptz,
  jsonb_build_object(
    'version','2026-09-06.v1',
    'expires_months',12,
    'stripe_price_env',format('STRIPE_PRICE_TOPUP_%s_%s',upper(plan_key),credits::int)
  )
from topup_tiers cross join public_plans
on conflict (id) do nothing;

insert into public.provider_cost_catalog (id, provider, resource, unit, unit_cost_usd, effective_from, source_url, source_revision, metadata) values
  ('openrouter_astra_input_20260906', 'openrouter', 'openai/gpt-6-astra:input', 'token', 0.000010000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/model/openai/gpt-6-astra', '2026-09-06', '{"input_cache_read":0.000001,"input_cache_write":0.0000125,"override":{"min_prompt_tokens":272000,"prompt":0.00002,"completion":0.000075,"input_cache_read":0.000002,"input_cache_write":0.000025}}'::jsonb),
  ('openrouter_astra_output_20260906', 'openrouter', 'openai/gpt-6-astra:output', 'token', 0.000050000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_gemini38_input_20260906', 'openrouter', 'google/gemini-3.8-flash:input', 'token', 0.000000750000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_gemini38_output_20260906', 'openrouter', 'google/gemini-3.8-flash:output', 'token', 0.000003750000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_gemini38_batch_input_20260906', 'openrouter', 'google/gemini-3.8-flash:batch:input', 'token', 0.000000375000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_gemini38_batch_output_20260906', 'openrouter', 'google/gemini-3.8-flash:batch:output', 'token', 0.000001875000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_luna_input_20260906', 'openrouter', 'openai/gpt-5.6-luna:input', 'token', 0.000000200000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{"override":{"min_prompt_tokens":272000,"prompt":0.0000004,"completion":0.0000018}}'::jsonb),
  ('openrouter_luna_output_20260906', 'openrouter', 'openai/gpt-5.6-luna:output', 'token', 0.000001200000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_luna_pro_input_20260906', 'openrouter', 'openai/gpt-5.6-luna-pro:input', 'token', 0.000000200000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_luna_pro_output_20260906', 'openrouter', 'openai/gpt-5.6-luna-pro:output', 'token', 0.000001200000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_terra_input_20260906', 'openrouter', 'openai/gpt-5.6-terra:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{"override":{"min_prompt_tokens":272000,"prompt":0.000004,"completion":0.000018}}'::jsonb),
  ('openrouter_terra_output_20260906', 'openrouter', 'openai/gpt-5.6-terra:output', 'token', 0.000012000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_terra_pro_input_20260906', 'openrouter', 'openai/gpt-5.6-terra-pro:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_terra_pro_output_20260906', 'openrouter', 'openai/gpt-5.6-terra-pro:output', 'token', 0.000012000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_sol_input_20260906', 'openrouter', 'openai/gpt-5.6-sol:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{"override":{"min_prompt_tokens":272000,"prompt":0.000004,"completion":0.000015}}'::jsonb),
  ('openrouter_sol_output_20260906', 'openrouter', 'openai/gpt-5.6-sol:output', 'token', 0.000010000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_sol_pro_input_20260906', 'openrouter', 'openai/gpt-5.6-sol-pro:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_sol_pro_output_20260906', 'openrouter', 'openai/gpt-5.6-sol-pro:output', 'token', 0.000010000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_sonnet5_input_20260906', 'openrouter', 'anthropic/claude-sonnet-5:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_sonnet5_output_20260906', 'openrouter', 'anthropic/claude-sonnet-5:output', 'token', 0.000010000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_opus5_input_20260906', 'openrouter', 'anthropic/claude-opus-5:input', 'token', 0.000005000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_opus5_output_20260906', 'openrouter', 'anthropic/claude-opus-5:output', 'token', 0.000025000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_fable51_input_20260906', 'openrouter', 'anthropic/claude-fable-5.1:input', 'token', 0.000010000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_fable51_output_20260906', 'openrouter', 'anthropic/claude-fable-5.1:output', 'token', 0.000050000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_fable51_batch_input_20260906', 'openrouter', 'anthropic/claude-fable-5.1:batch:input', 'token', 0.000005000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_fable51_batch_output_20260906', 'openrouter', 'anthropic/claude-fable-5.1:batch:output', 'token', 0.000025000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_kimik3_input_20260906', 'openrouter', 'moonshotai/kimi-k3:input', 'token', 0.000003000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_kimik3_output_20260906', 'openrouter', 'moonshotai/kimi-k3:output', 'token', 0.000015000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_grok46_input_20260906', 'openrouter', 'x-ai/grok-4.6:input', 'token', 0.000002000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{"override":{"min_prompt_tokens":200000,"prompt":0.000004,"completion":0.000012}}'::jsonb),
  ('openrouter_grok46_output_20260906', 'openrouter', 'x-ai/grok-4.6:output', 'token', 0.000006000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/api/v1/models', '2026-09-06', '{}'::jsonb),
  ('openrouter_purchase_fee_20260906', 'openrouter', 'credit_purchase_fee', 'usd', 0.055000000000, '2026-09-06T00:00:00Z', 'https://openrouter.ai/docs/faq', '2026-09-06', '{"minimum_usd":0.80}'::jsonb),
  ('cloudflare_workers_base_20260906', 'cloudflare', 'workers_paid_plan', 'account_month', 5.000000000000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/workers/platform/pricing/', '2026-08-28', '{}'::jsonb),
  ('cloudflare_workers_request_20260906', 'cloudflare', 'worker_request', 'request', 0.000000300000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/workers/platform/pricing/', '2026-08-28', '{"included_per_month":10000000}'::jsonb),
  ('cloudflare_workers_cpu_20260906', 'cloudflare', 'worker_cpu', 'cpu_ms', 0.000000020000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/workers/platform/pricing/', '2026-08-28', '{"included_per_month":30000000}'::jsonb),
  ('cloudflare_r2_storage_20260906', 'cloudflare', 'r2_storage', 'gb_month', 0.015000000000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/r2/pricing/', '2026-09-06', '{}'::jsonb),
  ('cloudflare_r2_class_a_20260906', 'cloudflare', 'r2_class_a', 'operation', 0.000004500000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/r2/pricing/', '2026-09-06', '{}'::jsonb),
  ('cloudflare_r2_class_b_20260906', 'cloudflare', 'r2_class_b', 'operation', 0.000000360000, '2026-09-06T00:00:00Z', 'https://developers.cloudflare.com/r2/pricing/', '2026-09-06', '{}'::jsonb),
  ('supabase_micro_compute_20260906', 'supabase', 'compute_micro', 'hour', 0.013440000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/compute', '2026-09-06', '{}'::jsonb),
  ('supabase_database_disk_20260906', 'supabase', 'database_disk', 'gb_month', 0.125000000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/billing-on-supabase', '2026-09-06', '{}'::jsonb),
  ('supabase_storage_20260906', 'supabase', 'file_storage', 'gb_hour', 0.000029190000, '2026-09-06T00:00:00Z', 'https://supabase.com/changelog/28339-moving-to-hourly-billing-for-storage-size', '2026-09-06', '{}'::jsonb),
  ('supabase_egress_20260906', 'supabase', 'uncached_egress', 'gb', 0.090000000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/egress', '2026-09-06', '{}'::jsonb),
  ('supabase_cached_egress_20260906', 'supabase', 'cached_egress', 'gb', 0.030000000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/egress', '2026-09-06', '{}'::jsonb),
  ('supabase_mau_20260906', 'supabase', 'monthly_active_user', 'mau', 0.003250000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users', '2026-09-06', '{}'::jsonb),
  ('supabase_function_20260906', 'supabase', 'edge_function_invocation', 'invocation', 0.000002000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations', '2026-09-06', '{}'::jsonb),
  ('supabase_realtime_message_20260906', 'supabase', 'realtime_message', 'message', 0.000002500000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages', '2026-09-06', '{}'::jsonb),
  ('supabase_realtime_peak_20260906', 'supabase', 'realtime_peak_connection', 'connection', 0.010000000000, '2026-09-06T00:00:00Z', 'https://supabase.com/docs/guides/realtime/pricing', '2026-09-06', '{}'::jsonb),
  ('resend_base_20260906', 'resend', 'transactional_email_plan', 'month', 20.000000000000, '2026-09-06T00:00:00Z', 'https://resend.com/docs/knowledge-base/what-is-resend-pricing', '2026-09-06', '{"included_emails":50000}'::jsonb),
  ('resend_email_overage_20260906', 'resend', 'transactional_email', 'email', 0.000900000000, '2026-09-06T00:00:00Z', 'https://resend.com/pricing', '2026-09-06', '{}'::jsonb)
on conflict (id) do nothing;

create or replace function public.coden_billing_grant(
  p_account_id uuid,
  p_kind text,
  p_restriction text,
  p_credits numeric,
  p_net_revenue_usd numeric,
  p_max_cogs_usd numeric,
  p_expires_at timestamptz,
  p_source_reference text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
  account_balance numeric;
begin
  if p_credits <= 0 or p_max_cogs_usd < 0 or p_expires_at <= now() then
    raise exception 'Invalid credit grant';
  end if;

  insert into public.credit_grants (
    account_id, kind, usage_restriction, credits_issued, credits_remaining,
    net_revenue_usd, max_cogs_usd, max_cogs_remaining_usd, expires_at,
    source_reference, idempotency_key, metadata
  ) values (
    p_account_id, p_kind, p_restriction, p_credits, p_credits,
    p_net_revenue_usd, p_max_cogs_usd, p_max_cogs_usd, p_expires_at,
    p_source_reference, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (idempotency_key) do nothing
  returning id into grant_id;

  if grant_id is null then
    select id into grant_id from public.credit_grants where idempotency_key = p_idempotency_key;
    return grant_id;
  end if;

  select coalesce(sum(credits_remaining), 0) into account_balance
  from public.credit_grants
  where account_id = p_account_id and frozen_at is null and expires_at > now();

  insert into public.credit_ledger_entries (
    account_id, grant_id, entry_type, amount_credits, balance_after, description, idempotency_key
  ) values (
    p_account_id, grant_id, 'grant', p_credits, account_balance, p_source_reference, p_idempotency_key || ':ledger'
  ) on conflict (idempotency_key) do nothing;

  return grant_id;
end;
$$;

create or replace function public.coden_billing_reserve(
  p_account_id uuid,
  p_category text,
  p_credits numeric,
  p_estimated_cogs_usd numeric,
  p_idempotency_key text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_id uuid;
  grant_row record;
  credit_need numeric := greatest(coalesce(p_credits, 0), 0);
  cogs_need numeric := greatest(coalesce(p_estimated_cogs_usd, 0), 0);
  credit_take numeric;
  cogs_take numeric;
  cogs_per_credit numeric;
begin
  select id into reservation_id from public.usage_reservations where idempotency_key = p_idempotency_key;
  if reservation_id is not null then return reservation_id; end if;
  if credit_need <= 0 or p_expires_at <= now() then raise exception 'Invalid usage reservation'; end if;

  insert into public.usage_reservations (account_id, category, idempotency_key, expires_at)
  values (p_account_id, p_category, p_idempotency_key, p_expires_at)
  returning id into reservation_id;

  for grant_row in
    select * from public.credit_grants
    where account_id = p_account_id
      and frozen_at is null and expires_at > now()
      and credits_remaining > 0
      and usage_restriction in (p_category, 'general')
    order by case when usage_restriction = p_category then 0 else 1 end, expires_at, issued_at
    for update
  loop
    exit when credit_need <= 0 and cogs_need <= 0;
    cogs_per_credit := case when grant_row.credits_remaining > 0 then grant_row.max_cogs_remaining_usd / grant_row.credits_remaining else 0 end;
    credit_take := least(
      grant_row.credits_remaining,
      greatest(credit_need, case when cogs_per_credit > 0 then cogs_need / cogs_per_credit else 0 end)
    );
    credit_take := ceil(credit_take * 10000) / 10000;
    if credit_take <= 0 then continue; end if;
    cogs_take := least(grant_row.max_cogs_remaining_usd, credit_take * cogs_per_credit);

    update public.credit_grants
      set credits_remaining = credits_remaining - credit_take,
          max_cogs_remaining_usd = greatest(0, max_cogs_remaining_usd - cogs_take)
      where id = grant_row.id;

    insert into public.usage_reservation_lines (reservation_id, grant_id, credits_reserved, cogs_reserved_usd)
    values (reservation_id, grant_row.id, credit_take, cogs_take);
    credit_need := greatest(0, credit_need - credit_take);
    cogs_need := greatest(0, cogs_need - cogs_take);
  end loop;

  if credit_need > 0.0001 or cogs_need > 0.00000001 then
    raise exception 'Insufficient eligible credits or COGS capacity';
  end if;

  update public.usage_reservations
    set credits_reserved = (select coalesce(sum(credits_reserved), 0) from public.usage_reservation_lines where reservation_id = usage_reservations.id),
        cogs_reserved_usd = (select coalesce(sum(cogs_reserved_usd), 0) from public.usage_reservation_lines where reservation_id = usage_reservations.id)
    where id = reservation_id;
  return reservation_id;
end;
$$;

create or replace function public.coden_billing_release(
  p_reservation_id uuid,
  p_reason text default 'reservation released'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_row record;
  line_row record;
  account_balance numeric;
begin
  select * into reservation_row from public.usage_reservations where id = p_reservation_id for update;
  if not found or reservation_row.status <> 'reserved' then return; end if;
  for line_row in select * from public.usage_reservation_lines where reservation_id = p_reservation_id loop
    update public.credit_grants set
      credits_remaining = credits_remaining + line_row.credits_reserved,
      max_cogs_remaining_usd = max_cogs_remaining_usd + line_row.cogs_reserved_usd
    where id = line_row.grant_id;
  end loop;
  update public.usage_reservations set status = 'released', settled_at = now() where id = p_reservation_id;
  select coalesce(sum(credits_remaining), 0) into account_balance from public.credit_grants
    where account_id = reservation_row.account_id and frozen_at is null and expires_at > now();
  insert into public.credit_ledger_entries (account_id, reservation_id, entry_type, amount_credits, balance_after, description, idempotency_key)
  values (reservation_row.account_id, p_reservation_id, 'release', reservation_row.credits_reserved, account_balance, p_reason, p_reservation_id::text || ':release')
  on conflict (idempotency_key) do nothing;
end;
$$;

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
  account_balance numeric;
  settlement_id uuid;
begin
  select id into settlement_id from public.usage_settlements where reservation_id = p_reservation_id;
  if settlement_id is not null then return settlement_id; end if;
  select * into reservation_row from public.usage_reservations where id = p_reservation_id for update;
  if not found or reservation_row.status <> 'reserved' then raise exception 'Reservation is not settleable'; end if;
  if p_credits_charged > reservation_row.credits_reserved or p_complete_cost_usd > reservation_row.cogs_reserved_usd then
    raise exception 'Actual usage exceeds reserved upper bound';
  end if;

  for line_row in select * from public.usage_reservation_lines where reservation_id = p_reservation_id order by created_at, id loop
    used_credit := least(line_row.credits_reserved, credit_left);
    used_cogs := least(line_row.cogs_reserved_usd, cogs_left);
    update public.credit_grants set
      credits_remaining = credits_remaining + (line_row.credits_reserved - used_credit),
      max_cogs_remaining_usd = max_cogs_remaining_usd + (line_row.cogs_reserved_usd - used_cogs)
    where id = line_row.grant_id;
    credit_left := greatest(0, credit_left - used_credit);
    cogs_left := greatest(0, cogs_left - used_cogs);
  end loop;

  if credit_left > 0.0001 or cogs_left > 0.00000001 then raise exception 'Reservation lines do not cover settlement'; end if;
  update public.usage_reservations set status = 'settled', settled_at = now() where id = p_reservation_id;
  insert into public.usage_settlements (reservation_id, usage_event_id, credits_charged, complete_cost_usd, realized_revenue_usd, realized_margin)
  values (p_reservation_id, p_usage_event_id, p_credits_charged, p_complete_cost_usd, p_realized_revenue_usd,
    case when p_realized_revenue_usd > 0 then (p_realized_revenue_usd - p_complete_cost_usd) / p_realized_revenue_usd else null end)
  returning id into settlement_id;
  select coalesce(sum(credits_remaining), 0) into account_balance from public.credit_grants
    where account_id = reservation_row.account_id and frozen_at is null and expires_at > now();
  insert into public.credit_ledger_entries (account_id, reservation_id, usage_event_id, entry_type, amount_credits, balance_after, description, idempotency_key)
  values (reservation_row.account_id, p_reservation_id, p_usage_event_id, 'usage', -p_credits_charged, account_balance, 'Usage settled from measured provider cost', p_reservation_id::text || ':settle')
  on conflict (idempotency_key) do nothing;
  return settlement_id;
end;
$$;

create or replace function public.append_agent_stream_event(
  p_run_id text,
  p_message_id text,
  p_owner_user_id uuid,
  p_sequence bigint,
  p_channel text,
  p_event_type text,
  p_envelope jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
begin
  insert into public.agent_stream_events (run_id, message_id, owner_user_id, sequence, channel, event_type, envelope)
  values (p_run_id, p_message_id, p_owner_user_id, p_sequence, p_channel, p_event_type, p_envelope)
  on conflict (run_id, sequence) do update set envelope = excluded.envelope
  returning id into event_id;
  return event_id;
end;
$$;

create or replace function public.coden_claim_auto_topup(
  p_account_id uuid,
  p_trigger_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  config_row public.auto_topup_configs%rowtype;
  account_balance numeric;
  current_month date := date_trunc('month', now())::date;
begin
  select * into config_row
  from public.auto_topup_configs
  where account_id = p_account_id
  for update;

  if not found or not config_row.enabled or config_row.provider_payment_method_id is null then
    return null;
  end if;

  if config_row.usage_month <> current_month then
    update public.auto_topup_configs
      set usage_month = current_month,
          credits_added_this_month = 0,
          updated_at = now()
      where account_id = p_account_id
      returning * into config_row;
  end if;

  if config_row.in_progress_key is not null
     and config_row.in_progress_started_at > now() - interval '20 minutes' then
    return null;
  end if;

  select coalesce(sum(credits_remaining), 0) into account_balance
  from public.credit_grants
  where account_id = p_account_id
    and frozen_at is null
    and expires_at > now();

  if account_balance >= config_row.threshold_credits
     or config_row.credits_to_add <= 0
     or config_row.credits_added_this_month + config_row.credits_to_add > config_row.monthly_cap_credits then
    return null;
  end if;

  update public.auto_topup_configs
    set in_progress_key = p_trigger_key,
        in_progress_started_at = now(),
        last_error = null,
        updated_at = now()
    where account_id = p_account_id
    returning * into config_row;

  return to_jsonb(config_row) || jsonb_build_object('balance_before', account_balance);
end;
$$;

create or replace function public.coden_complete_auto_topup(
  p_account_id uuid,
  p_trigger_key text,
  p_credits numeric
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare updated_count integer;
begin
  update public.auto_topup_configs
    set credits_added_this_month = credits_added_this_month + greatest(p_credits, 0),
        last_triggered_at = now(),
        in_progress_key = null,
        in_progress_started_at = null,
        last_error = null,
        updated_at = now()
    where account_id = p_account_id and in_progress_key = p_trigger_key;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function public.coden_fail_auto_topup(
  p_account_id uuid,
  p_trigger_key text,
  p_error text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare updated_count integer;
begin
  update public.auto_topup_configs
    set enabled = false,
        in_progress_key = null,
        in_progress_started_at = null,
        last_error = left(coalesce(p_error, 'Auto top-up failed'), 500),
        updated_at = now()
    where account_id = p_account_id and in_progress_key = p_trigger_key;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'billing_accounts','billing_provider_customers','plan_catalog','price_versions','billing_subscriptions_v2','credit_grants',
    'usage_events','usage_reservations','usage_reservation_lines','usage_settlements','credit_ledger_entries',
    'provider_cost_catalog','provider_invoice_imports','provider_reconciliations','auto_topup_configs',
    'spend_limits','billing_alerts_v2','billing_audit_events','provider_webhook_events',
    'agent_stream_events','agent_artifacts','agent_decisions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;
end $$;

grant select on public.billing_accounts, public.billing_provider_customers, public.plan_catalog, public.price_versions, public.billing_subscriptions_v2,
  public.credit_grants, public.usage_events, public.usage_reservations, public.usage_settlements,
  public.credit_ledger_entries, public.auto_topup_configs, public.spend_limits, public.billing_alerts_v2,
  public.agent_stream_events, public.agent_artifacts, public.agent_decisions to authenticated;

drop policy if exists billing_accounts_owner_select on public.billing_accounts;
create policy billing_accounts_owner_select on public.billing_accounts for select to authenticated using ((select auth.uid()) = owner_user_id);
drop policy if exists billing_provider_customers_owner_select on public.billing_provider_customers;
create policy billing_provider_customers_owner_select on public.billing_provider_customers for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.billing_provider_customers.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists billing_subscriptions_owner_select on public.billing_subscriptions_v2;
create policy billing_subscriptions_owner_select on public.billing_subscriptions_v2 for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.billing_subscriptions_v2.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists credit_grants_owner_select on public.credit_grants;
create policy credit_grants_owner_select on public.credit_grants for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.credit_grants.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists usage_events_owner_select on public.usage_events;
create policy usage_events_owner_select on public.usage_events for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.usage_events.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists usage_reservations_owner_select on public.usage_reservations;
create policy usage_reservations_owner_select on public.usage_reservations for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.usage_reservations.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists usage_settlements_owner_select on public.usage_settlements;
create policy usage_settlements_owner_select on public.usage_settlements for select to authenticated using (exists (select 1 from public.usage_reservations r join public.billing_accounts a on a.id = r.account_id where r.id = public.usage_settlements.reservation_id and a.owner_user_id = (select auth.uid())));
drop policy if exists credit_ledger_owner_select on public.credit_ledger_entries;
create policy credit_ledger_owner_select on public.credit_ledger_entries for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.credit_ledger_entries.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists auto_topup_owner_select on public.auto_topup_configs;
create policy auto_topup_owner_select on public.auto_topup_configs for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.auto_topup_configs.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists spend_limits_owner_select on public.spend_limits;
create policy spend_limits_owner_select on public.spend_limits for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.spend_limits.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists billing_alerts_owner_select on public.billing_alerts_v2;
create policy billing_alerts_owner_select on public.billing_alerts_v2 for select to authenticated using (exists (select 1 from public.billing_accounts a where a.id = public.billing_alerts_v2.account_id and a.owner_user_id = (select auth.uid())));
drop policy if exists stream_owner_select on public.agent_stream_events;
create policy stream_owner_select on public.agent_stream_events for select to authenticated using ((select auth.uid()) = owner_user_id);
drop policy if exists artifacts_owner_select on public.agent_artifacts;
create policy artifacts_owner_select on public.agent_artifacts for select to authenticated using ((select auth.uid()) = owner_user_id);
drop policy if exists decisions_owner_select on public.agent_decisions;
create policy decisions_owner_select on public.agent_decisions for select to authenticated using ((select auth.uid()) = owner_user_id);

drop policy if exists plan_catalog_authenticated_select on public.plan_catalog;
create policy plan_catalog_authenticated_select on public.plan_catalog for select to authenticated using (active = true);
drop policy if exists price_versions_authenticated_select on public.price_versions;
create policy price_versions_authenticated_select on public.price_versions for select to authenticated using (effective_from <= now() and (effective_until is null or effective_until > now()));

revoke all on function public.coden_billing_grant(uuid, text, text, numeric, numeric, numeric, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.coden_billing_reserve(uuid, text, numeric, numeric, text, timestamptz) from public, anon, authenticated;
revoke all on function public.coden_billing_release(uuid, text) from public, anon, authenticated;
revoke all on function public.coden_billing_settle(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.append_agent_stream_event(text, text, uuid, bigint, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.coden_claim_auto_topup(uuid, text) from public, anon, authenticated;
revoke all on function public.coden_complete_auto_topup(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.coden_fail_auto_topup(uuid, text, text) from public, anon, authenticated;
grant execute on function public.coden_billing_grant(uuid, text, text, numeric, numeric, numeric, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.coden_billing_reserve(uuid, text, numeric, numeric, text, timestamptz) to service_role;
grant execute on function public.coden_billing_release(uuid, text) to service_role;
grant execute on function public.coden_billing_settle(uuid, uuid, numeric, numeric, numeric) to service_role;
grant execute on function public.append_agent_stream_event(text, text, uuid, bigint, text, text, jsonb) to service_role;
grant execute on function public.coden_claim_auto_topup(uuid, text) to service_role;
grant execute on function public.coden_complete_auto_topup(uuid, text, numeric) to service_role;
grant execute on function public.coden_fail_auto_topup(uuid, text, text) to service_role;

comment on table public.credit_grants is 'Unified Coden V4 grants. Specialized grants are consumed before general grants.';
comment on table public.usage_events is 'Measured provider usage; estimates never become authoritative usage.';
comment on table public.agent_stream_events is 'Durable two-channel SSE envelopes for idempotent replay.';
