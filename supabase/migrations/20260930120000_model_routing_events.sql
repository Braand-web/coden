-- The record of every routing decision.
--
-- `ai_routing_decisions` (supabase-schema.sql) has held no row since it was
-- created: it requires a row in the legacy `ai_requests` table, which the live
-- generation path never writes. This is the table the live path writes to: the
-- model a run started on and why, every switch with the signal that caused it,
-- and one summary per run with its real cost, tokens, cache hits and duration.
--
-- Identifiers, model names, reasons and numbers only — never a prompt, a file,
-- an attachment or a preview capture.
create table if not exists public.model_routing_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('initial', 'supervision', 'fallback', 'substitution', 'summary')),
  run_id text,
  project_id uuid,
  user_id uuid,
  task text,
  complexity text,
  mode text,
  policy text,
  from_model text,
  to_model text not null,
  reasoning_level text,
  signal text,
  action text,
  reason text,
  considered jsonb,
  rejected_count integer,
  decision_ms numeric,
  pinned boolean,
  ok boolean,
  cost_usd numeric,
  latency_ms integer,
  prompt_tokens integer,
  cached_tokens integer,
  escalations integer
);

-- Written and read by the server with the service role only: no policy is
-- created, so no signed-in user can read or write another person's routing.
alter table public.model_routing_events enable row level security;

create index if not exists model_routing_events_created_idx on public.model_routing_events (created_at desc);
create index if not exists model_routing_events_kind_idx on public.model_routing_events (kind, created_at desc);
create index if not exists model_routing_events_model_idx on public.model_routing_events (to_model, created_at desc);
create index if not exists model_routing_events_run_idx on public.model_routing_events (run_id);

comment on table public.model_routing_events is
  'Every model routing decision of a generation run: initial choice, supervisor switches, gateway fallbacks, and one summary per run (cost, tokens, cache hits, duration).';
