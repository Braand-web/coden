-- Durable recovery snapshots for Coden projects.
-- Normalized project tables remain the source of truth. This snapshot is the
-- recovery layer used when a partial persistence failure would otherwise leave
-- the builder empty after refresh or reconnect.

create extension if not exists pgcrypto;

create table if not exists public.project_state_snapshots (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null,
  organization_id uuid,
  revision bigint not null default 1,
  project_snapshot jsonb not null default '{}'::jsonb,
  files_snapshot jsonb not null default '[]'::jsonb,
  messages_snapshot jsonb not null default '[]'::jsonb,
  events_snapshot jsonb not null default '[]'::jsonb,
  workspace_snapshot jsonb not null default '{}'::jsonb,
  preview_snapshot jsonb not null default '{}'::jsonb,
  last_agent_run_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_state_snapshots enable row level security;

drop policy if exists "Project state snapshots owner isolation" on public.project_state_snapshots;
create policy "Project state snapshots owner isolation" on public.project_state_snapshots
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists project_state_snapshots_owner_updated_idx
  on public.project_state_snapshots (owner_id, updated_at desc);

grant select, insert, update, delete on public.project_state_snapshots to authenticated;
grant all on public.project_state_snapshots to service_role;

comment on table public.project_state_snapshots is
  'Last complete recoverable Coden builder state. Used only as a fallback when normalized project state is partial or unavailable.';
