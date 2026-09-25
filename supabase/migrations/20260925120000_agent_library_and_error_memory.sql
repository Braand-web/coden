-- The shared library of sub-agents and skills, and the error memory.
--
-- Written only by the Coden server (service role): RLS on, no policy. Nothing
-- here holds a user's content — definitions and rules are generic methods,
-- anonymised before they are stored — and contributors are salted hashes, so
-- a user who turns sharing off is purged without the tables ever naming them.

create table if not exists public.agent_library_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('agent', 'skill')),
  slug text not null,
  name text not null,
  description text not null default '',
  version integer not null default 1,
  status text not null default 'candidate' check (status in ('candidate', 'active', 'disabled', 'archived')),
  is_latest boolean not null default true,
  parent_id uuid null references public.agent_library_items(id) on delete set null,
  definition jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  embedding jsonb null,
  uses integer not null default 0,
  successes integer not null default 0,
  failures integer not null default 0,
  contributors text[] not null default '{}',
  created_by text not null default 'agent' check (created_by in ('agent', 'admin', 'curated')),
  disabled_reason text null,
  last_used_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, slug, version)
);
create index if not exists agent_library_items_lookup_idx on public.agent_library_items (kind, status, is_latest);

create table if not exists public.agent_library_usage (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.agent_library_items(id) on delete cascade,
  request_id text not null,
  contributor text null,
  outcome text not null default 'pending' check (outcome in ('pending', 'success', 'failure', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists agent_library_usage_item_idx on public.agent_library_usage (item_id, created_at desc);
create index if not exists agent_library_usage_request_idx on public.agent_library_usage (request_id);

create table if not exists public.agent_error_memory (
  id uuid primary key default gen_random_uuid(),
  signature text not null unique,
  category text not null check (category in ('build', 'runtime', 'test', 'mishandling', 'user_correction')),
  error_message text not null default '',
  context jsonb not null default '{}'::jsonb,
  cause text not null default '',
  fix text not null default '',
  rule text not null default '',
  status text not null default 'candidate' check (status in ('candidate', 'active', 'needs_review', 'disabled')),
  permanent boolean not null default false,
  occurrences integer not null default 1,
  confirmations integer not null default 0,
  recurrences_after_rule integer not null default 0,
  skill_id uuid null references public.agent_library_items(id) on delete set null,
  contributors text[] not null default '{}',
  embedding jsonb null,
  edited_by_admin boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_recurrence_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists agent_error_memory_status_idx on public.agent_error_memory (status, permanent);

alter table public.agent_library_items enable row level security;
alter table public.agent_library_usage enable row level security;
alter table public.agent_error_memory enable row level security;
