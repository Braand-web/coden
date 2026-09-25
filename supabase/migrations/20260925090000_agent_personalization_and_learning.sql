-- Personalisation and the agent's own learning layer.
--
-- user_agent_preferences  one row per person: their instructions (injected in
--                         every session) and whether their runs may improve
--                         the shared agent (on by default).
-- agent_quality_signals   what happened on each run: success, fixed build
--                         errors, retries, feedback, reverts. Structured and
--                         content-free. `shared` is false for people who opted
--                         out; the Auto router only learns from shared rows.
-- agent_knowledge         the global, anonymised knowledge base: normalised
--                         error signatures with the fix that worked, stacks
--                         that verified. `contributor` is a salted hash, so a
--                         person's contributions can be purged without the
--                         base ever holding their identity.
-- user_agent_memory       private memory per person (stack, style, language),
--                         read only for that person's own sessions.
--
-- All four are server-only: RLS on, no policies, reached through the service
-- role by server.ts. Idempotent.

create table if not exists public.user_agent_preferences (
  user_id uuid primary key,
  instructions text not null default '',
  share_improvement boolean not null default true,
  share_changed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint user_agent_preferences_instructions_length check (char_length(instructions) <= 4000)
);

create table if not exists public.agent_quality_signals (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  project_id uuid,
  kind text not null,
  task_type text not null default 'general',
  model_id text,
  success boolean,
  shared boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agent_quality_signals_kind_check check (kind in ('run', 'error_fixed', 'retry', 'feedback', 'revert'))
);

create index if not exists agent_quality_signals_routing_idx
  on public.agent_quality_signals (task_type, model_id, created_at desc)
  where shared and kind = 'run';
create index if not exists agent_quality_signals_user_idx
  on public.agent_quality_signals (user_id, created_at desc);

create table if not exists public.agent_knowledge (
  id bigint generated always as identity primary key,
  contributor text,
  kind text not null,
  task_type text not null default 'general',
  signature text not null,
  content text not null,
  created_at timestamptz not null default now(),
  constraint agent_knowledge_kind_check check (kind in ('error_fix', 'stack_pattern', 'routing')),
  constraint agent_knowledge_content_length check (char_length(content) <= 600),
  constraint agent_knowledge_signature_length check (char_length(signature) <= 300)
);

create index if not exists agent_knowledge_lookup_idx
  on public.agent_knowledge (kind, task_type, created_at desc);
create index if not exists agent_knowledge_signature_idx
  on public.agent_knowledge (signature);
create index if not exists agent_knowledge_contributor_idx
  on public.agent_knowledge (contributor);

create table if not exists public.user_agent_memory (
  user_id uuid not null,
  key text not null,
  kind text not null,
  content text not null,
  weight real not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, key),
  constraint user_agent_memory_kind_check check (kind in ('stack', 'preference', 'style', 'language')),
  constraint user_agent_memory_content_length check (char_length(content) <= 300)
);

-- Success rate per model and task type over a window, from shared runs only.
create or replace function public.agent_model_success_stats(window_days integer default 30)
returns table (task_type text, model_id text, runs bigint, successes bigint)
language sql
stable
set search_path = public
as $$
  select s.task_type, s.model_id, count(*)::bigint as runs, count(*) filter (where s.success)::bigint as successes
  from public.agent_quality_signals s
  where s.kind = 'run'
    and s.shared
    and s.model_id is not null
    and s.created_at > now() - make_interval(days => greatest(1, least(window_days, 365)))
  group by s.task_type, s.model_id;
$$;

alter table public.user_agent_preferences enable row level security;
alter table public.agent_quality_signals enable row level security;
alter table public.agent_knowledge enable row level security;
alter table public.user_agent_memory enable row level security;

revoke all on public.user_agent_preferences, public.agent_quality_signals, public.agent_knowledge, public.user_agent_memory from anon, authenticated;
revoke all on function public.agent_model_success_stats(integer) from public, anon, authenticated;
grant execute on function public.agent_model_success_stats(integer) to service_role;

comment on table public.agent_knowledge is
  'Global anonymised agent knowledge. Content is template-built from normalised signals, never user text; contributor is a salted hash so opted-out users can be purged.';
