-- Publish persistence hardening for Coden live deployments.
-- Safe to run multiple times and compatible with older deployments schemas.

create extension if not exists pgcrypto;

create table if not exists public.deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  project_id uuid not null,
  provider text default 'vercel',
  provider_deployment_id text,
  deployment_url text,
  public_url text,
  custom_domain text,
  badge_required boolean default false,
  status text default 'ready',
  commit_hash text,
  branch text default 'main',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.deployments add column if not exists organization_id uuid;
alter table public.deployments add column if not exists project_id uuid;
alter table public.deployments add column if not exists provider text default 'vercel';
alter table public.deployments add column if not exists provider_deployment_id text;
alter table public.deployments add column if not exists deployment_url text;
alter table public.deployments add column if not exists public_url text;
alter table public.deployments add column if not exists custom_domain text;
alter table public.deployments add column if not exists badge_required boolean default false;
alter table public.deployments add column if not exists status text default 'ready';
alter table public.deployments add column if not exists commit_hash text;
alter table public.deployments add column if not exists branch text default 'main';
alter table public.deployments add column if not exists created_at timestamptz default now();
alter table public.deployments add column if not exists updated_at timestamptz default now();

update public.deployments
set
  provider = coalesce(provider, 'vercel'),
  status = coalesce(status, 'ready'),
  branch = coalesce(branch, 'main'),
  badge_required = coalesce(badge_required, false),
  created_at = coalesce(created_at, now()),
  updated_at = coalesce(updated_at, created_at, now());

create index if not exists deployments_project_created_idx
  on public.deployments (project_id, created_at desc);

create index if not exists deployments_provider_deployment_idx
  on public.deployments (provider, provider_deployment_id)
  where provider_deployment_id is not null;

do $$
begin
  if to_regclass('public.projects') is not null
     and not exists (
       select 1
       from pg_constraint
       where conname = 'deployments_project_id_fkey'
         and conrelid = 'public.deployments'::regclass
     ) then
    alter table public.deployments
      add constraint deployments_project_id_fkey
      foreign key (project_id) references public.projects(id) on delete cascade;
  end if;
end $$;

alter table public.deployments enable row level security;

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
    drop policy if exists "Deployments owner isolation" on public.deployments;
    create policy "Deployments owner isolation" on public.deployments
      for all
      using (project_id in (select id from public.projects where owner_id = auth.uid()))
      with check (project_id in (select id from public.projects where owner_id = auth.uid()));
  end if;
end $$;

grant select, insert, update, delete on public.deployments to authenticated;
