-- Coden Agent V2 control-plane tables.
-- Idempotent by design: safe to run on fresh and existing Supabase projects.

create extension if not exists pgcrypto;

create table if not exists public.agent_runs (
  id text primary key,
  request_id text not null,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  intent text not null,
  mode text not null default 'build',
  model_id text,
  status text not null default 'running',
  diagnostic_code text,
  suggested_action text,
  duration_ms integer,
  context_summary jsonb not null default '{}'::jsonb,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz
);

create table if not exists public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  agent_run_id text not null references public.agent_runs(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  sequence_number integer not null,
  event_type text not null,
  status text not null default 'completed',
  message text not null default '',
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_memories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  memory_type text not null default 'project_summary',
  summary text not null default '',
  architecture jsonb not null default '{}'::jsonb,
  ui_preferences jsonb not null default '{}'::jsonb,
  known_errors jsonb not null default '[]'::jsonb,
  recent_decisions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_verifications (
  id uuid primary key default gen_random_uuid(),
  agent_run_id text references public.agent_runs(id) on delete set null,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  check_type text not null,
  status text not null,
  severity text not null default 'info',
  message text not null default '',
  file_path text,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runs_project_created on public.agent_runs(project_id, created_at desc);
create index if not exists idx_agent_runs_user_created on public.agent_runs(user_id, created_at desc);
create index if not exists idx_agent_runs_request_id on public.agent_runs(request_id);
create index if not exists idx_agent_run_steps_run_sequence on public.agent_run_steps(agent_run_id, sequence_number);
create index if not exists idx_agent_memories_project_type on public.agent_memories(project_id, memory_type);
create unique index if not exists idx_agent_memories_project_type_unique on public.agent_memories(project_id, memory_type);
create index if not exists idx_agent_verifications_project_created on public.agent_verifications(project_id, created_at desc);
create index if not exists idx_agent_verifications_run on public.agent_verifications(agent_run_id);

alter table if exists public.project_messages
  add column if not exists intent text,
  add column if not exists requested_mode text,
  add column if not exists organization_id uuid;

alter table if exists public.agent_events
  add column if not exists agent_run_id text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists request_id text;

alter table if exists public.build_sessions
  add column if not exists agent_run_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists diagnostic_code text,
  add column if not exists suggested_action text;

alter table if exists public.project_versions
  add column if not exists agent_run_id text,
  add column if not exists verification_summary jsonb not null default '{}'::jsonb;

alter table if exists public.project_workspace_state
  add column if not exists agent_memory_summary text,
  add column if not exists last_agent_run_id text;
