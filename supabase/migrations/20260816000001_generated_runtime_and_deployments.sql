-- Generated application runtime and Cloudflare publication metadata.
-- Safe to apply after the existing project/deployment migrations.

create extension if not exists pgcrypto;

create table if not exists public.project_runtime_profiles (
  project_id uuid primary key,
  organization_id uuid,
  profile text not null check (profile in ('tanstack-fullstack','vite-static','legacy-vite-fullstack')),
  framework text not null check (framework in ('tanstack-start','vite-react')),
  runtime text not null check (runtime in ('cloudflare-workers','static-assets','legacy-vercel')),
  backend text not null check (backend in ('coden-cloud-supabase','none')),
  manifest jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.generated_app_manifests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid,
  profile text not null,
  framework text not null,
  runtime text not null,
  backend text not null,
  manifest jsonb not null,
  source_run_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.deployment_builds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid,
  build_id text not null,
  profile text not null,
  status text not null default 'queued' check (status in ('queued','running','passed','failed','cancelled')),
  output_directory text,
  commit_hash text,
  logs jsonb not null default '[]'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, build_id)
);

create table if not exists public.deployment_checks (
  id uuid primary key default gen_random_uuid(),
  build_id uuid references public.deployment_builds(id) on delete cascade,
  project_id uuid not null,
  organization_id uuid,
  check_type text not null,
  status text not null check (status in ('passed','failed','warning','skipped')),
  message text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.deployment_domains (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid,
  provider text not null default 'cloudflare-workers',
  hostname text not null,
  domain_type text not null default 'coden' check (domain_type in ('coden','custom')),
  status text not null default 'pending' check (status in ('pending','verifying','active','failed','removed')),
  certificate_status text,
  verification_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, hostname)
);

create table if not exists public.deployment_environment_variables (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  organization_id uuid,
  variable_name text not null check (variable_name ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  scope text not null default 'server' check (scope in ('public','server')),
  value_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, variable_name)
);

create index if not exists generated_app_manifests_project_created_idx
  on public.generated_app_manifests(project_id, created_at desc);
create index if not exists deployment_builds_project_created_idx
  on public.deployment_builds(project_id, created_at desc);
create index if not exists deployment_checks_project_created_idx
  on public.deployment_checks(project_id, created_at desc);
create index if not exists deployment_domains_project_status_idx
  on public.deployment_domains(project_id, status);

do $$
declare
  table_name text;
begin
  if to_regclass('public.projects') is not null then
    for table_name in select unnest(array[
      'project_runtime_profiles',
      'generated_app_manifests',
      'deployment_builds',
      'deployment_checks',
      'deployment_domains',
      'deployment_environment_variables'
    ]) loop
      execute format('alter table public.%I add constraint %I_project_fk foreign key (project_id) references public.projects(id) on delete cascade', table_name, table_name);
    end loop;
  end if;
exception when duplicate_object then
  null;
end $$;

do $$
declare
  table_name text;
begin
  for table_name in select unnest(array[
    'project_runtime_profiles',
    'generated_app_manifests',
    'deployment_builds',
    'deployment_checks',
    'deployment_domains',
    'deployment_environment_variables'
  ]) loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I_member_access on public.%I', table_name, table_name);
    execute format($policy$
      create policy %I_member_access on public.%I for all using (
        exists (select 1 from public.projects p
          where p.id = %I.project_id
            and (p.owner_id = auth.uid() or p.created_by = auth.uid() or p.user_id = auth.uid()))
        or exists (select 1 from public.project_members pm
          where pm.project_id = %I.project_id and pm.user_id = auth.uid())
      ) with check (
        exists (select 1 from public.projects p
          where p.id = %I.project_id
            and (p.owner_id = auth.uid() or p.created_by = auth.uid() or p.user_id = auth.uid()))
      )
    $policy$, table_name, table_name, table_name, table_name, table_name);
  end loop;
end $$;

-- Environment values are intentionally not granted to authenticated clients.
revoke all on public.deployment_environment_variables from authenticated;
grant select, insert, update, delete on public.project_runtime_profiles to authenticated;
grant select, insert, update, delete on public.generated_app_manifests to authenticated;
grant select, insert, update, delete on public.deployment_builds to authenticated;
grant select, insert, update, delete on public.deployment_checks to authenticated;
grant select, insert, update, delete on public.deployment_domains to authenticated;
