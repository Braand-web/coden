-- The action guard's decision journal and the rules people set for it.
--
-- action_guard_events: one row per judged action — which tool, what kind of
-- action, the decision, why, how long it took. The action is a short redacted
-- summary: never a file body, a tool result or a secret. `label` is what an
-- admin later says about a decision (ok, false_positive, false_negative), which
-- is how the corpus grows from real cases.
--
-- agent_guard_rules: a person's or a project's own rules in their words
-- ("never touch production without asking me"), read by the guard.
--
-- Both: RLS on, no policy — the server reaches them with the service role only.
create table if not exists public.action_guard_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  run_id text,
  project_id uuid,
  user_id uuid,
  tool text not null,
  category text not null,
  tier smallint not null check (tier in (1, 2, 3)),
  decision text not null check (decision in ('allow', 'block', 'ask', 'pause')),
  stage text not null,
  rule text,
  reason text,
  latency_ms numeric,
  cached boolean not null default false,
  mode text,
  shadow_decision text,
  actor text,
  summary text,
  label text check (label in ('ok', 'false_positive', 'false_negative'))
);
create index if not exists action_guard_events_created_idx on public.action_guard_events (created_at desc);
create index if not exists action_guard_events_decision_idx on public.action_guard_events (decision, created_at desc);
alter table public.action_guard_events enable row level security;
revoke all on public.action_guard_events from anon, authenticated;

create table if not exists public.agent_guard_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null,
  project_id uuid,
  rule text not null check (char_length(rule) between 4 and 300)
);
create index if not exists agent_guard_rules_user_idx on public.agent_guard_rules (user_id, project_id);
alter table public.agent_guard_rules enable row level security;
revoke all on public.agent_guard_rules from anon, authenticated;
