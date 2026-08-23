create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid references public.projects(id) on delete cascade,
  user_id uuid not null,
  asset_type text not null check (asset_type in ('image', 'video')),
  provider text not null default 'fal.ai',
  model_id text not null,
  prompt text not null default '',
  format text not null default '9:16',
  duration text not null default '8s',
  asset_url text not null,
  thumbnail_url text,
  status text not null default 'completed',
  credits_charged integer not null default 0,
  public_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.media_assets add column if not exists organization_id uuid;
alter table public.media_assets add column if not exists project_id uuid references public.projects(id) on delete cascade;
alter table public.media_assets add column if not exists user_id uuid;
alter table public.media_assets add column if not exists asset_type text default 'image';
alter table public.media_assets add column if not exists provider text default 'fal.ai';
alter table public.media_assets add column if not exists model_id text default '';
alter table public.media_assets add column if not exists prompt text default '';
alter table public.media_assets add column if not exists format text default '9:16';
alter table public.media_assets add column if not exists duration text default '8s';
alter table public.media_assets add column if not exists asset_url text default '';
alter table public.media_assets add column if not exists thumbnail_url text;
alter table public.media_assets add column if not exists status text default 'completed';
alter table public.media_assets add column if not exists credits_charged integer default 0;
alter table public.media_assets add column if not exists public_metadata jsonb default '{}'::jsonb;
alter table public.media_assets add column if not exists created_at timestamptz default now();
alter table public.media_assets add column if not exists updated_at timestamptz default now();

create index if not exists media_assets_project_created_idx
  on public.media_assets (project_id, created_at desc);

create index if not exists media_assets_user_created_idx
  on public.media_assets (user_id, created_at desc);

alter table public.media_assets enable row level security;

do $$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'media_assets'
      and policyname = 'Media assets owner isolation'
  ) then
    drop policy "Media assets owner isolation" on public.media_assets;
  end if;
end $$;

create policy "Media assets owner isolation" on public.media_assets
  for all
  using (auth.uid() = user_id or auth.uid() = organization_id)
  with check (auth.uid() = user_id or auth.uid() = organization_id);

grant select, insert, update, delete on public.media_assets to authenticated;
