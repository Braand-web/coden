-- Additive observation projection of the existing usage ledger. Never settles
-- credits and never includes raw users, prompts, responses or provider payloads.
create table if not exists public.provider_cost_observations (
  event_key uuid primary key,
  schema_version integer not null check (schema_version = 1),
  occurred_at timestamptz not null,
  actor_key text check (actor_key is null or actor_key ~ '^[a-f0-9]{64}$'),
  project_key text check (project_key is null or project_key ~ '^[a-f0-9]{64}$'),
  task_key text check (task_key is null or task_key ~ '^[a-f0-9]{64}$'),
  plan text check (plan in ('free','pro','pro_plus','business','enterprise')),
  credit_tier numeric check (credit_tier >= 0),
  billing_period text check (billing_period in ('monthly','annual')),
  mode text check (mode in ('economy','balanced','performance')),
  selection text check (selection in ('auto','explicit')),
  requested_model text not null,
  served_model text not null,
  gateway text not null check (gateway = 'openrouter'),
  provider text,
  stage text,
  prompt_version text,
  result text not null check (result in ('succeeded','failed','cancelled')),
  latency_ms bigint not null check (latency_ms >= 0),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cached_read_tokens bigint check (cached_read_tokens >= 0),
  cached_write_tokens bigint check (cached_write_tokens >= 0),
  reasoning_tokens bigint check (reasoning_tokens >= 0),
  cost_usd numeric(20,10) check (cost_usd >= 0),
  cost_source text not null check (cost_source in ('gateway','estimated','unknown')),
  check (cost_source <> 'unknown' or cost_usd is null)
);
alter table public.provider_cost_observations enable row level security;
revoke all on public.provider_cost_observations from public, anon, authenticated;
grant select, insert on public.provider_cost_observations to service_role;
-- No browser policy; admin reads through the authenticated server endpoint only.
create index if not exists provider_cost_observations_time_idx on public.provider_cost_observations (occurred_at);
create index if not exists provider_cost_observations_actor_time_idx on public.provider_cost_observations (actor_key, occurred_at);
comment on table public.provider_cost_observations is 'Unbilled, pseudonymized per-attempt provider observations. Do not add these costs to usage_events totals: they describe the same inference spend at finer granularity.';

-- Model price history reuses the existing provider_cost_catalog and its notifier.
-- No second model-price ledger is created.
