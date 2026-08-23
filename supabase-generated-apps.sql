-- Coden generated-app persistence schema.
-- Safe to run multiple times; compatible with an existing public.projects table.

create extension if not exists "uuid-ossp";

create table if not exists public.organizations (
  id uuid primary key references auth.users(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Personal workspace',
  slug text not null unique,
  type text not null default 'personal',
  status text not null default 'active',
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
drop policy if exists "Organizations owner isolation" on public.organizations;
create policy "Organizations owner isolation" on public.organizations
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and id = auth.uid());
grant select, insert, update on public.organizations to authenticated;

create table if not exists public.projects (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz default now() not null
);

alter table public.projects add column if not exists owner_id uuid;
alter table public.projects add column if not exists organization_id uuid;
alter table public.projects add column if not exists name text;
alter table public.projects add column if not exists slug text;
alter table public.projects add column if not exists prompt text;
alter table public.projects add column if not exists template text default 'custom';
alter table public.projects add column if not exists theme text default 'light';
alter table public.projects alter column theme set default 'light';
alter table public.projects add column if not exists model_id text default 'auto';
alter table public.projects add column if not exists status text default 'draft';
alter table public.projects add column if not exists preview_status text default 'idle';
alter table public.projects add column if not exists preview_html text;
alter table public.projects add column if not exists updated_at timestamptz default now();
-- Showcase opt-in: a project is only ever eligible for the public Discover feed
-- when its owner has explicitly consented. Default false = never exposed.
alter table public.projects add column if not exists showcase_consent boolean default false;
update public.projects set showcase_consent = coalesce(showcase_consent, false) where showcase_consent is null;
create index if not exists projects_showcase_consent_idx on public.projects (showcase_consent, status) where showcase_consent = true;

update public.projects set owner_id = organization_id where owner_id is null and organization_id is not null;
update public.projects set organization_id = owner_id where organization_id is null and owner_id is not null;
update public.projects set name = coalesce(name, 'Untitled project') where name is null;
update public.projects set slug = coalesce(slug, 'project-' || left(id::text, 8)) where slug is null;
update public.projects set status = coalesce(status, 'draft') where status is null;
update public.projects set preview_status = coalesce(preview_status, 'idle') where preview_status is null;
update public.projects set updated_at = coalesce(updated_at, now()) where updated_at is null;

create table if not exists public.project_files (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  path text not null,
  content text not null,
  language text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.project_files add column if not exists language text;
alter table public.project_files add column if not exists updated_at timestamptz default now();

create table if not exists public.deployments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid,
  project_id uuid not null references public.projects(id) on delete cascade,
  provider text default 'cloudflare' not null,
  provider_deployment_id text,
  deployment_url text,
  status text not null default 'unknown',
  commit_hash text,
  branch text default 'main',
  created_at timestamptz default now() not null
);

create table if not exists public.agent_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  sequence_number integer not null,
  event_type text not null,
  message text not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null,
  unique (project_id, sequence_number)
);

alter table public.deployments add column if not exists organization_id uuid;
alter table public.deployments add column if not exists provider text default 'cloudflare';
alter table public.deployments add column if not exists provider_deployment_id text;
alter table public.deployments add column if not exists deployment_url text;
alter table public.deployments add column if not exists public_url text;
alter table public.deployments add column if not exists custom_domain text;
alter table public.deployments add column if not exists badge_required boolean default false;
alter table public.deployments add column if not exists commit_hash text;
alter table public.deployments add column if not exists branch text default 'main';
alter table public.deployments add column if not exists updated_at timestamptz default now();

alter table public.projects enable row level security;
alter table public.project_files enable row level security;
alter table public.deployments enable row level security;
alter table public.agent_events enable row level security;

drop policy if exists "Projects owner isolation" on public.projects;
create policy "Projects owner isolation" on public.projects
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Project files owner isolation" on public.project_files;
create policy "Project files owner isolation" on public.project_files
  for all using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

drop policy if exists "Deployments owner isolation" on public.deployments;
create policy "Deployments owner isolation" on public.deployments
  for all using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

drop policy if exists "Agent events owner isolation" on public.agent_events;
create policy "Agent events owner isolation" on public.agent_events
  for all using (
    project_id in (select id from public.projects where owner_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
  );

create unique index if not exists projects_owner_slug_idx on public.projects (owner_id, slug);
create unique index if not exists project_files_project_path_unique_idx on public.project_files (project_id, path);
create index if not exists projects_owner_updated_idx on public.projects (owner_id, updated_at desc);
create index if not exists deployments_project_created_idx on public.deployments (project_id, created_at desc);
create index if not exists agent_events_project_sequence_idx on public.agent_events (project_id, sequence_number);

create table if not exists public.project_messages (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  intent text,
  requested_mode text,
  created_at timestamptz default now() not null
);

create table if not exists public.project_versions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  version_number integer not null,
  reason text,
  files_snapshot jsonb default '[]'::jsonb not null,
  diff_summary jsonb default '{}'::jsonb not null,
  created_at timestamptz default now() not null
);

create table if not exists public.build_sessions (
  id text primary key,
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  status text not null default 'running',
  created_at timestamptz default now() not null,
  cancelled_at timestamptz
);

create table if not exists public.build_errors (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  file text,
  message text not null,
  severity text default 'medium',
  status text default 'detected',
  created_at timestamptz default now() not null
);

create table if not exists public.auto_fix_attempts (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  error_id uuid,
  status text not null,
  summary text,
  created_at timestamptz default now() not null
);

create table if not exists public.project_patches (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid,
  project_id uuid not null references public.projects(id) on delete cascade,
  target_file text,
  summary text,
  created_at timestamptz default now() not null
);

create table if not exists public.project_integrations (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  service text not null,
  status text not null default 'missing',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.project_secrets (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  service text not null,
  variable text not null,
  encrypted_value text,
  masked_value text not null,
  status text not null default 'configured',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.project_secrets add column if not exists organization_id uuid;
alter table public.project_secrets add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.project_secrets add column if not exists service text default 'Custom';
alter table public.project_secrets add column if not exists variable text default 'CUSTOM_API_KEY';
alter table public.project_secrets add column if not exists encrypted_value text;
alter table public.project_secrets add column if not exists masked_value text default '••••';
alter table public.project_secrets add column if not exists status text default 'configured';
alter table public.project_secrets add column if not exists created_at timestamptz default now();
alter table public.project_secrets add column if not exists updated_at timestamptz default now();

create table if not exists public.project_assets (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  url text,
  kind text default 'image',
  mime_type text,
  size_bytes bigint default 0,
  status text default 'uploaded',
  storage_path text,
  created_at timestamptz default now() not null
);

alter table public.project_assets add column if not exists mime_type text;
alter table public.project_assets add column if not exists size_bytes bigint default 0;
alter table public.project_assets add column if not exists status text default 'uploaded';
alter table public.project_assets add column if not exists storage_path text;

alter table public.project_messages enable row level security;
alter table public.project_versions enable row level security;
alter table public.build_sessions enable row level security;
alter table public.build_errors enable row level security;
alter table public.auto_fix_attempts enable row level security;
alter table public.project_patches enable row level security;
alter table public.project_integrations enable row level security;
alter table public.project_secrets enable row level security;
alter table public.project_assets enable row level security;

drop policy if exists "Project messages owner isolation" on public.project_messages;
create policy "Project messages owner isolation" on public.project_messages
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project versions owner isolation" on public.project_versions;
create policy "Project versions owner isolation" on public.project_versions
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Build sessions owner isolation" on public.build_sessions;
create policy "Build sessions owner isolation" on public.build_sessions
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Build errors owner isolation" on public.build_errors;
create policy "Build errors owner isolation" on public.build_errors
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Auto fix attempts owner isolation" on public.auto_fix_attempts;
create policy "Auto fix attempts owner isolation" on public.auto_fix_attempts
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project patches owner isolation" on public.project_patches;
create policy "Project patches owner isolation" on public.project_patches
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project integrations owner isolation" on public.project_integrations;
create policy "Project integrations owner isolation" on public.project_integrations
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project secrets owner isolation" on public.project_secrets;
create policy "Project secrets owner isolation" on public.project_secrets
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project assets owner isolation" on public.project_assets;
create policy "Project assets owner isolation" on public.project_assets
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

create index if not exists project_messages_project_created_idx on public.project_messages (project_id, created_at);
create index if not exists project_versions_project_number_idx on public.project_versions (project_id, version_number desc);
create index if not exists build_errors_project_created_idx on public.build_errors (project_id, created_at desc);
create index if not exists project_secrets_project_variable_idx on public.project_secrets (project_id, variable);
create unique index if not exists project_integrations_project_service_idx on public.project_integrations (project_id, service);

grant select, insert, update, delete on public.project_messages to authenticated;
grant select, insert, update, delete on public.project_versions to authenticated;
grant select, insert, update, delete on public.build_sessions to authenticated;
grant select, insert, update, delete on public.build_errors to authenticated;
grant select, insert, update, delete on public.auto_fix_attempts to authenticated;
grant select, insert, update, delete on public.project_patches to authenticated;
grant select, insert, update, delete on public.project_integrations to authenticated;
grant select, insert, update, delete on public.project_secrets to authenticated;
grant select, insert, update, delete on public.project_assets to authenticated;

create table if not exists public.project_analytics_sessions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id text not null,
  visitor_id text not null,
  environment text not null default 'preview',
  source text not null default 'Direct',
  country_code text not null default 'UN',
  country_name text not null default 'Unknown',
  device text not null default 'Unknown',
  pageviews integer not null default 0,
  duration_seconds integer not null default 0,
  first_seen_at timestamptz default now() not null,
  last_seen_at timestamptz default now() not null
);

create table if not exists public.project_analytics_events (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid,
  project_id uuid not null references public.projects(id) on delete cascade,
  session_id text not null,
  visitor_id text not null,
  event_type text not null default 'pageview',
  page_path text not null default '/',
  source text not null default 'Direct',
  country_code text not null default 'UN',
  country_name text not null default 'Unknown',
  device text not null default 'Unknown',
  environment text not null default 'preview',
  duration_seconds integer not null default 0,
  occurred_at timestamptz default now() not null
);

alter table public.project_analytics_sessions add column if not exists organization_id uuid;
alter table public.project_analytics_sessions add column if not exists environment text not null default 'preview';
alter table public.project_analytics_sessions add column if not exists source text not null default 'Direct';
alter table public.project_analytics_sessions add column if not exists country_code text not null default 'UN';
alter table public.project_analytics_sessions add column if not exists country_name text not null default 'Unknown';
alter table public.project_analytics_sessions add column if not exists device text not null default 'Unknown';
alter table public.project_analytics_sessions add column if not exists pageviews integer not null default 0;
alter table public.project_analytics_sessions add column if not exists duration_seconds integer not null default 0;
alter table public.project_analytics_sessions add column if not exists first_seen_at timestamptz default now();
alter table public.project_analytics_sessions add column if not exists last_seen_at timestamptz default now();

alter table public.project_analytics_events add column if not exists organization_id uuid;
alter table public.project_analytics_events add column if not exists environment text not null default 'preview';
alter table public.project_analytics_events add column if not exists duration_seconds integer not null default 0;

alter table public.project_analytics_sessions enable row level security;
alter table public.project_analytics_events enable row level security;

drop policy if exists "Project analytics sessions owner isolation" on public.project_analytics_sessions;
create policy "Project analytics sessions owner isolation" on public.project_analytics_sessions
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

drop policy if exists "Project analytics events owner isolation" on public.project_analytics_events;
create policy "Project analytics events owner isolation" on public.project_analytics_events
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

create unique index if not exists project_analytics_sessions_project_session_idx on public.project_analytics_sessions (project_id, session_id);
create index if not exists project_analytics_sessions_project_last_seen_idx on public.project_analytics_sessions (project_id, last_seen_at desc);
create index if not exists project_analytics_events_project_occurred_idx on public.project_analytics_events (project_id, occurred_at desc);
create index if not exists project_analytics_events_project_session_idx on public.project_analytics_events (project_id, session_id);

grant select, insert, update, delete on public.project_analytics_sessions to authenticated;
grant select, insert, update, delete on public.project_analytics_events to authenticated;

create table if not exists public.user_workspace_state (
  owner_id uuid primary key,
  last_project_id uuid references public.projects(id) on delete set null,
  dashboard_draft_prompt text default '',
  dashboard_selected_mode text default 'build',
  builder_draft_prompt text default '',
  builder_selected_mode text default 'build',
  builder_selected_model text default 'auto',
  builder_active_tab text default 'preview',
  builder_preview_device text default 'desktop',
  theme text default 'light',
  last_route text default '/dashboard.html',
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table if not exists public.project_workspace_state (
  project_id uuid primary key references public.projects(id) on delete cascade,
  owner_id uuid not null,
  draft_prompt text default '',
  selected_mode text default 'build',
  selected_model text default 'auto',
  active_tab text default 'preview',
  preview_device text default 'desktop',
  sidebar_width integer default 380,
  pending_clarification jsonb,
  last_opened_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.user_workspace_state add column if not exists last_project_id uuid references public.projects(id) on delete set null;
alter table public.user_workspace_state add column if not exists dashboard_draft_prompt text default '';
alter table public.user_workspace_state add column if not exists dashboard_selected_mode text default 'build';
alter table public.user_workspace_state add column if not exists builder_draft_prompt text default '';
alter table public.user_workspace_state add column if not exists builder_selected_mode text default 'build';
alter table public.user_workspace_state add column if not exists builder_selected_model text default 'auto';
alter table public.user_workspace_state add column if not exists builder_active_tab text default 'preview';
alter table public.user_workspace_state add column if not exists builder_preview_device text default 'desktop';
alter table public.user_workspace_state add column if not exists theme text default 'light';
alter table public.user_workspace_state add column if not exists last_route text default '/dashboard.html';
alter table public.user_workspace_state add column if not exists created_at timestamptz default now();
alter table public.user_workspace_state add column if not exists updated_at timestamptz default now();

alter table public.project_workspace_state add column if not exists owner_id uuid;
alter table public.project_workspace_state add column if not exists draft_prompt text default '';
alter table public.project_workspace_state add column if not exists selected_mode text default 'build';
alter table public.project_workspace_state add column if not exists selected_model text default 'auto';
alter table public.project_workspace_state add column if not exists active_tab text default 'preview';
alter table public.project_workspace_state add column if not exists preview_device text default 'desktop';
alter table public.project_workspace_state add column if not exists sidebar_width integer default 380;
alter table public.project_workspace_state add column if not exists pending_clarification jsonb;
alter table public.project_workspace_state add column if not exists last_opened_at timestamptz default now();
alter table public.project_workspace_state add column if not exists created_at timestamptz default now();
alter table public.project_workspace_state add column if not exists updated_at timestamptz default now();

alter table public.user_workspace_state enable row level security;
alter table public.project_workspace_state enable row level security;

drop policy if exists "User workspace owner isolation" on public.user_workspace_state;
create policy "User workspace owner isolation" on public.user_workspace_state
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Project workspace owner isolation" on public.project_workspace_state;
create policy "Project workspace owner isolation" on public.project_workspace_state
  for all using (project_id in (select id from public.projects where owner_id = auth.uid()))
  with check (project_id in (select id from public.projects where owner_id = auth.uid()));

create index if not exists user_workspace_last_project_idx on public.user_workspace_state (last_project_id);
create index if not exists project_workspace_owner_updated_idx on public.project_workspace_state (owner_id, updated_at desc);

grant select, insert, update, delete on public.user_workspace_state to authenticated;
grant select, insert, update, delete on public.project_workspace_state to authenticated;

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
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create index if not exists project_state_snapshots_owner_updated_idx
  on public.project_state_snapshots (owner_id, updated_at desc);

grant select, insert, update, delete on public.project_state_snapshots to authenticated;
grant all on public.project_state_snapshots to service_role;
