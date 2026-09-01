-- Coden Agent Harness V3
-- Durable Thread -> Turn -> Item primitives with an append-only ordered event log.
-- Client roles are read-only. All writes are performed by the backend service role.

create table if not exists public.agent_threads (
  id text primary key,
  organization_id uuid,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'archived', 'completed')),
  title text not null default 'Coden mission',
  active_turn_id text,
  next_sequence bigint not null default 1 check (next_sequence > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_turns (
  id text primary key,
  thread_id text not null references public.agent_threads(id) on delete cascade,
  parent_turn_id text references public.agent_turns(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'waiting_for_user', 'verifying', 'completed', 'failed', 'cancelled', 'blocked')),
  requested_mode text not null default 'auto',
  resolved_action text,
  prompt text not null,
  idempotency_key text not null,
  definition_of_done jsonb not null default '[]'::jsonb,
  budget jsonb not null default '{}'::jsonb,
  budget_used jsonb not null default '{}'::jsonb,
  checkpoint jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (thread_id, idempotency_key)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_threads_active_turn_id_fkey'
      and conrelid = 'public.agent_threads'::regclass
  ) then
    alter table public.agent_threads
      add constraint agent_threads_active_turn_id_fkey
      foreign key (active_turn_id) references public.agent_turns(id) on delete set null
      deferrable initially deferred;
  end if;
end;
$$;

create table if not exists public.agent_items (
  id text primary key,
  thread_id text not null references public.agent_threads(id) on delete cascade,
  turn_id text not null references public.agent_turns(id) on delete cascade,
  parent_item_id text references public.agent_items(id) on delete set null,
  kind text not null check (kind in ('user_message', 'assistant_message', 'plan', 'tool_call', 'tool_result', 'command', 'patch', 'subagent', 'verification', 'approval', 'checkpoint')),
  role text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed', 'cancelled', 'blocked')),
  title text,
  content text,
  resource_keys text[] not null default '{}',
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_harness_events (
  id uuid primary key default gen_random_uuid(),
  thread_id text not null references public.agent_threads(id) on delete cascade,
  turn_id text references public.agent_turns(id) on delete cascade,
  item_id text references public.agent_items(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  event_type text not null,
  visibility text not null default 'technical' check (visibility in ('public', 'technical', 'private')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (thread_id, sequence)
);

create table if not exists public.agent_instructions (
  id text primary key,
  thread_id text not null references public.agent_threads(id) on delete cascade,
  turn_id text not null references public.agent_turns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  instruction text not null check (char_length(instruction) between 1 and 4000),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'superseded')),
  apply_at text not null default 'next_safe_checkpoint' check (apply_at in ('next_safe_checkpoint', 'immediate')),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create unique index if not exists idx_agent_threads_one_active_turn
  on public.agent_threads(active_turn_id)
  where active_turn_id is not null;
create index if not exists idx_agent_threads_project_updated
  on public.agent_threads(project_id, updated_at desc);
create index if not exists idx_agent_turns_thread_created
  on public.agent_turns(thread_id, created_at desc);
create index if not exists idx_agent_items_turn_created
  on public.agent_items(turn_id, created_at);
create index if not exists idx_agent_harness_events_replay
  on public.agent_harness_events(thread_id, sequence);
create index if not exists idx_agent_instructions_pending
  on public.agent_instructions(turn_id, created_at)
  where status = 'pending';

alter table public.agent_threads enable row level security;
alter table public.agent_turns enable row level security;
alter table public.agent_items enable row level security;
alter table public.agent_harness_events enable row level security;
alter table public.agent_instructions enable row level security;

revoke all on table public.agent_threads from anon, authenticated;
revoke all on table public.agent_turns from anon, authenticated;
revoke all on table public.agent_items from anon, authenticated;
revoke all on table public.agent_harness_events from anon, authenticated;
revoke all on table public.agent_instructions from anon, authenticated;

grant select on table public.agent_threads to authenticated;
grant select on table public.agent_turns to authenticated;
grant select on table public.agent_items to authenticated;
grant select on table public.agent_harness_events to authenticated;
grant select on table public.agent_instructions to authenticated;

grant all on table public.agent_threads to service_role;
grant all on table public.agent_turns to service_role;
grant all on table public.agent_items to service_role;
grant all on table public.agent_harness_events to service_role;
grant all on table public.agent_instructions to service_role;

drop policy if exists agent_threads_owner_select on public.agent_threads;
create policy agent_threads_owner_select on public.agent_threads
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists agent_turns_owner_select on public.agent_turns;
create policy agent_turns_owner_select on public.agent_turns
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists agent_items_owner_select on public.agent_items;
create policy agent_items_owner_select on public.agent_items
  for select to authenticated
  using (
    kind in ('user_message', 'assistant_message', 'plan', 'approval')
    and
    exists (
      select 1 from public.agent_threads thread
      where thread.id = agent_items.thread_id
        and thread.user_id = (select auth.uid())
    )
  );

drop policy if exists agent_harness_events_owner_select on public.agent_harness_events;
create policy agent_harness_events_owner_select on public.agent_harness_events
  for select to authenticated
  using (
    visibility = 'public'
    and
    exists (
      select 1 from public.agent_threads thread
      where thread.id = agent_harness_events.thread_id
        and thread.user_id = (select auth.uid())
    )
  );

drop policy if exists agent_instructions_owner_select on public.agent_instructions;
create policy agent_instructions_owner_select on public.agent_instructions
  for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.append_agent_harness_event(
  p_thread_id text,
  p_turn_id text,
  p_item_id text,
  p_event_type text,
  p_visibility text,
  p_payload jsonb
)
returns setof public.agent_harness_events
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_event_sequence bigint;
begin
  update public.agent_threads
    set next_sequence = next_sequence + 1,
        updated_at = now()
    where id = p_thread_id
    returning next_sequence - 1 into next_event_sequence;

  if next_event_sequence is null then
    raise exception 'Agent harness thread not found: %', p_thread_id using errcode = 'P0002';
  end if;

  return query
    insert into public.agent_harness_events (
      thread_id, turn_id, item_id, sequence, event_type, visibility, payload
    ) values (
      p_thread_id, p_turn_id, p_item_id, next_event_sequence, p_event_type, p_visibility, coalesce(p_payload, '{}'::jsonb)
    )
    returning *;
end;
$$;

revoke all on function public.append_agent_harness_event(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_agent_harness_event(text, text, text, text, text, jsonb) to service_role;

comment on table public.agent_threads is 'Persistent Coden missions. One active turn per thread.';
comment on table public.agent_turns is 'A user request plus all agent work caused by that request.';
comment on table public.agent_items is 'Messages, tools, patches, subagents and verifications belonging to a turn.';
comment on table public.agent_harness_events is 'Append-only ordered event log used for durable replay and observability.';
