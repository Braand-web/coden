-- Share a project by link: the recipient may open a read-only view and make their own copy.
-- Only a hash of the link's secret is stored; the link itself is shown once, to the person who creates it.
-- Reached only by the server (service role): row level security is on, with no policy.
create table if not exists public.project_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  copy_count integer not null default 0,
  last_copied_at timestamptz
);
create index if not exists project_shares_active_idx on public.project_shares (project_id) where revoked_at is null;
alter table public.project_shares enable row level security;
