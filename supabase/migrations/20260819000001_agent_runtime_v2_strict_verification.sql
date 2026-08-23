-- Strict Agent Runtime V2 metadata and ordered public stream events.
-- This migration is additive and safe to apply after 202606010001_agent_v2.sql.

alter table if exists public.agent_runs
  add column if not exists runtime_version text not null default 'v2',
  add column if not exists requested_model text,
  add column if not exists effective_model text,
  add column if not exists verification_status text not null default 'unknown',
  add column if not exists stream_status text not null default 'unknown',
  add column if not exists facts_count integer not null default 0,
  add column if not exists tokens_in integer,
  add column if not exists tokens_out integer,
  add column if not exists real_cost_usd numeric,
  add column if not exists cancelled_at timestamptz;

create table if not exists public.agent_run_events (
  id uuid primary key default gen_random_uuid(),
  agent_run_id text not null references public.agent_runs(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  sequence integer not null,
  event_type text not null,
  model text not null default '',
  content text,
  payload jsonb not null default '{}'::jsonb,
  verified_fact_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (agent_run_id, sequence)
);

create index if not exists idx_agent_run_events_project_created
  on public.agent_run_events(project_id, created_at desc);
create index if not exists idx_agent_run_events_run_sequence
  on public.agent_run_events(agent_run_id, sequence);

alter table if exists public.agent_runs enable row level security;
alter table public.agent_run_events enable row level security;

drop policy if exists agent_run_events_member_access on public.agent_run_events;
create policy agent_run_events_member_access on public.agent_run_events
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = agent_run_events.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = agent_run_events.project_id
        and p.owner_id = auth.uid()
    )
  );

grant select, insert on public.agent_run_events to authenticated;
