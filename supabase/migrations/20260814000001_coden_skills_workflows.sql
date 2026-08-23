-- Native Coden skills and bounded workspace workflows.
alter table if exists public.agent_jobs drop constraint if exists agent_jobs_type_check;
alter table if exists public.agent_jobs add constraint agent_jobs_type_check check (type in ('generate','auto_fix','security_scan','publish','media_gen','research','workflow_run'));

alter table public.agent_runs
  add column if not exists skill_id text,
  add column if not exists skill_version text,
  add column if not exists workflow_id uuid,
  add column if not exists skill_budget jsonb not null default '{}'::jsonb,
  add column if not exists skill_budget_used jsonb not null default '{}'::jsonb;

create table if not exists public.agent_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(name) between 2 and 80),
  skill_id text not null,
  trigger_type text not null check (trigger_type in ('manual','schedule','project_change','build_failed','preview_invalid')),
  cron text,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  budget jsonb not null default '{}'::jsonb,
  next_run_at timestamptz,
  last_run_at timestamptz,
  failure_count integer not null default 0,
  max_failures integer not null default 3 check (max_failures between 1 and 10),
  lease_owner text,
  lease_until timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((trigger_type = 'schedule' and cron is not null) or (trigger_type <> 'schedule'))
);

create index if not exists agent_workflows_project_idx on public.agent_workflows(project_id, status);
create index if not exists agent_workflows_due_idx on public.agent_workflows(status, next_run_at);

create table if not exists public.agent_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.agent_workflows(id) on delete cascade,
  agent_run_id text references public.agent_runs(id) on delete set null,
  trigger_type text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  cost_usd numeric(12,6),
  result jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists agent_workflow_runs_workflow_idx on public.agent_workflow_runs(workflow_id, created_at desc);

alter table public.agent_workflows enable row level security;
alter table public.agent_workflow_runs enable row level security;

drop policy if exists agent_workflows_member_select on public.agent_workflows;
create policy agent_workflows_member_select on public.agent_workflows for select using (
  exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid() or p.user_id = auth.uid()))
  or exists (select 1 from public.project_members pm where pm.project_id = agent_workflows.project_id and pm.user_id = auth.uid())
);
drop policy if exists agent_workflows_member_write on public.agent_workflows;
create policy agent_workflows_member_write on public.agent_workflows for all using (
  exists (select 1 from public.projects p where p.id = project_id and (p.owner_id = auth.uid() or p.created_by = auth.uid() or p.user_id = auth.uid()))
  or exists (select 1 from public.project_members pm where pm.project_id = agent_workflows.project_id and pm.user_id = auth.uid() and pm.role in ('owner','admin'))
) with check (created_by = auth.uid() or exists (select 1 from public.project_members pm where pm.project_id = agent_workflows.project_id and pm.user_id = auth.uid() and pm.role in ('owner','admin')));

drop policy if exists agent_workflow_runs_member_select on public.agent_workflow_runs;
create policy agent_workflow_runs_member_select on public.agent_workflow_runs for select using (
  exists (select 1 from public.agent_workflows w join public.projects p on p.id = w.project_id where w.id = workflow_id and (p.owner_id = auth.uid() or p.created_by = auth.uid() or p.user_id = auth.uid()))
);

-- Atomic lease claim for one process-safe scheduler pass.
create or replace function public.claim_due_coden_workflows(p_worker_id text, p_limit integer default 10)
returns setof public.agent_workflows
language sql security definer set search_path = public
as $$
  update public.agent_workflows w
  set lease_owner = p_worker_id, lease_until = now() + interval '2 minutes', updated_at = now()
  where w.id in (
    select id from public.agent_workflows
    where status = 'active' and trigger_type = 'schedule' and next_run_at <= now()
      and (lease_until is null or lease_until < now())
    order by next_run_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 25))
  )
  returning w.*;
$$;
