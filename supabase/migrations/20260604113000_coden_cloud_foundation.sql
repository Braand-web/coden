-- Coden Cloud foundation.
-- Tracks managed backend needs and planned/active resources without exposing secrets.
-- Idempotent and compatible with existing projects.

create extension if not exists pgcrypto;

create table if not exists public.coden_cloud_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  project_id uuid not null,
  provider text not null default 'coden_cloud',
  mode text not null default 'shared',
  status text not null default 'planned',
  region text not null default 'auto',
  schema_name text,
  supabase_project_ref text,
  supabase_url text,
  anon_key_encrypted text,
  service_role_key_encrypted text,
  public_runtime_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coden_cloud_migrations (
  id uuid primary key default gen_random_uuid(),
  cloud_project_id uuid references public.coden_cloud_projects(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  name text not null,
  sql text not null default '',
  checksum text not null default '',
  status text not null default 'pending',
  applied_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coden_cloud_resources (
  id uuid primary key default gen_random_uuid(),
  cloud_project_id uuid references public.coden_cloud_projects(id) on delete cascade,
  organization_id uuid,
  project_id uuid not null,
  resource_type text not null,
  resource_name text not null,
  schema_name text,
  table_name text,
  status text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_backend_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  project_id uuid not null,
  needs_database boolean not null default false,
  needs_auth boolean not null default false,
  needs_storage boolean not null default false,
  needs_edge_functions boolean not null default false,
  needs_secrets boolean not null default false,
  detected_from_prompt text[] not null default '{}'::text[],
  recommended_mode text not null default 'shared',
  status text not null default 'detected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.coden_cloud_projects add column if not exists organization_id uuid;
alter table public.coden_cloud_projects add column if not exists project_id uuid;
alter table public.coden_cloud_projects add column if not exists provider text default 'coden_cloud';
alter table public.coden_cloud_projects add column if not exists mode text default 'shared';
alter table public.coden_cloud_projects add column if not exists status text default 'planned';
alter table public.coden_cloud_projects add column if not exists region text default 'auto';
alter table public.coden_cloud_projects add column if not exists schema_name text;
alter table public.coden_cloud_projects add column if not exists supabase_project_ref text;
alter table public.coden_cloud_projects add column if not exists supabase_url text;
alter table public.coden_cloud_projects add column if not exists anon_key_encrypted text;
alter table public.coden_cloud_projects add column if not exists service_role_key_encrypted text;
alter table public.coden_cloud_projects add column if not exists public_runtime_config jsonb default '{}'::jsonb;
alter table public.coden_cloud_projects add column if not exists created_at timestamptz default now();
alter table public.coden_cloud_projects add column if not exists updated_at timestamptz default now();

alter table public.coden_cloud_migrations add column if not exists organization_id uuid;
alter table public.coden_cloud_migrations add column if not exists project_id uuid;
alter table public.coden_cloud_migrations add column if not exists name text;
alter table public.coden_cloud_migrations add column if not exists sql text default '';
alter table public.coden_cloud_migrations add column if not exists checksum text default '';
alter table public.coden_cloud_migrations add column if not exists status text default 'pending';
alter table public.coden_cloud_migrations add column if not exists applied_at timestamptz;
alter table public.coden_cloud_migrations add column if not exists error_message text;
alter table public.coden_cloud_migrations add column if not exists created_at timestamptz default now();
alter table public.coden_cloud_migrations add column if not exists updated_at timestamptz default now();

alter table public.coden_cloud_resources add column if not exists organization_id uuid;
alter table public.coden_cloud_resources add column if not exists project_id uuid;
alter table public.coden_cloud_resources add column if not exists resource_type text;
alter table public.coden_cloud_resources add column if not exists resource_name text;
alter table public.coden_cloud_resources add column if not exists schema_name text;
alter table public.coden_cloud_resources add column if not exists table_name text;
alter table public.coden_cloud_resources add column if not exists status text default 'planned';
alter table public.coden_cloud_resources add column if not exists metadata jsonb default '{}'::jsonb;
alter table public.coden_cloud_resources add column if not exists created_at timestamptz default now();
alter table public.coden_cloud_resources add column if not exists updated_at timestamptz default now();

alter table public.project_backend_requirements add column if not exists organization_id uuid;
alter table public.project_backend_requirements add column if not exists project_id uuid;
alter table public.project_backend_requirements add column if not exists needs_database boolean default false;
alter table public.project_backend_requirements add column if not exists needs_auth boolean default false;
alter table public.project_backend_requirements add column if not exists needs_storage boolean default false;
alter table public.project_backend_requirements add column if not exists needs_edge_functions boolean default false;
alter table public.project_backend_requirements add column if not exists needs_secrets boolean default false;
alter table public.project_backend_requirements add column if not exists detected_from_prompt text[] default '{}'::text[];
alter table public.project_backend_requirements add column if not exists recommended_mode text default 'shared';
alter table public.project_backend_requirements add column if not exists status text default 'detected';
alter table public.project_backend_requirements add column if not exists created_at timestamptz default now();
alter table public.project_backend_requirements add column if not exists updated_at timestamptz default now();

create unique index if not exists coden_cloud_projects_project_unique
  on public.coden_cloud_projects (project_id);

create index if not exists coden_cloud_projects_org_status_idx
  on public.coden_cloud_projects (organization_id, status);

create unique index if not exists coden_cloud_migrations_cloud_checksum_unique
  on public.coden_cloud_migrations (cloud_project_id, checksum)
  where checksum <> '';

create index if not exists coden_cloud_migrations_project_created_idx
  on public.coden_cloud_migrations (project_id, created_at desc);

create index if not exists coden_cloud_resources_project_type_idx
  on public.coden_cloud_resources (project_id, resource_type);

create unique index if not exists project_backend_requirements_project_unique
  on public.project_backend_requirements (project_id);

do $$
begin
  if to_regclass('public.projects') is not null then
    if not exists (
      select 1 from pg_constraint
      where conname = 'coden_cloud_projects_project_id_fkey'
        and conrelid = 'public.coden_cloud_projects'::regclass
    ) then
      alter table public.coden_cloud_projects
        add constraint coden_cloud_projects_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;
    end if;

    if not exists (
      select 1 from pg_constraint
      where conname = 'project_backend_requirements_project_id_fkey'
        and conrelid = 'public.project_backend_requirements'::regclass
    ) then
      alter table public.project_backend_requirements
        add constraint project_backend_requirements_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;
    end if;
  end if;
end $$;

alter table public.coden_cloud_projects enable row level security;
alter table public.coden_cloud_migrations enable row level security;
alter table public.coden_cloud_resources enable row level security;
alter table public.project_backend_requirements enable row level security;

do $$
begin
  if to_regclass('public.projects') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'projects'
         and column_name = 'owner_id'
     ) then
    drop policy if exists "Coden Cloud project owner isolation" on public.coden_cloud_projects;
    create policy "Coden Cloud project owner isolation" on public.coden_cloud_projects
      for all
      using (project_id in (select id from public.projects where owner_id = auth.uid()))
      with check (project_id in (select id from public.projects where owner_id = auth.uid()));

    drop policy if exists "Coden Cloud migration owner isolation" on public.coden_cloud_migrations;
    create policy "Coden Cloud migration owner isolation" on public.coden_cloud_migrations
      for all
      using (project_id in (select id from public.projects where owner_id = auth.uid()))
      with check (project_id in (select id from public.projects where owner_id = auth.uid()));

    drop policy if exists "Coden Cloud resource owner isolation" on public.coden_cloud_resources;
    create policy "Coden Cloud resource owner isolation" on public.coden_cloud_resources
      for all
      using (project_id in (select id from public.projects where owner_id = auth.uid()))
      with check (project_id in (select id from public.projects where owner_id = auth.uid()));

    drop policy if exists "Project backend requirements owner isolation" on public.project_backend_requirements;
    create policy "Project backend requirements owner isolation" on public.project_backend_requirements
      for all
      using (project_id in (select id from public.projects where owner_id = auth.uid()))
      with check (project_id in (select id from public.projects where owner_id = auth.uid()));
  end if;
end $$;

grant select, insert, update, delete on public.coden_cloud_projects to authenticated;
grant select, insert, update, delete on public.coden_cloud_migrations to authenticated;
grant select, insert, update, delete on public.coden_cloud_resources to authenticated;
grant select, insert, update, delete on public.project_backend_requirements to authenticated;
