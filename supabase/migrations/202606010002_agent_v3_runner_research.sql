-- Coden Agent V3 runner and research persistence.
-- Idempotent and safe for existing projects.

create extension if not exists pgcrypto;

alter table if exists public.agent_runs
  add column if not exists tool_budget jsonb not null default '{}'::jsonb,
  add column if not exists research_used boolean not null default false,
  add column if not exists runner_status text;

create table if not exists public.agent_runner_results (
  id uuid primary key default gen_random_uuid(),
  agent_run_id text references public.agent_runs(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  check_type text not null,
  status text not null,
  severity text not null default 'info',
  message text not null default '',
  file_path text,
  command text,
  duration_ms integer,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_research_results (
  id uuid primary key default gen_random_uuid(),
  agent_run_id text references public.agent_runs(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  user_id uuid not null,
  query text not null default '',
  provider text not null default 'none',
  status text not null default 'skipped',
  diagnostic_code text,
  message text not null default '',
  title text,
  url text,
  snippet text,
  published_at text,
  public_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_runner_results_project_created on public.agent_runner_results(project_id, created_at desc);
create index if not exists idx_agent_runner_results_run_created on public.agent_runner_results(agent_run_id, created_at desc);
create index if not exists idx_agent_research_results_project_created on public.agent_research_results(project_id, created_at desc);
create index if not exists idx_agent_research_results_run_created on public.agent_research_results(agent_run_id, created_at desc);

alter table public.agent_runner_results enable row level security;
alter table public.agent_research_results enable row level security;
