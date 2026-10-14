-- Apply only to Coden's CENTRAL project, never the generated-app runtime.
begin;
create table public.coden_media_jobs (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_id text not null check (length(message_id) between 1 and 160),
  fingerprint text not null,
  revision bigint not null default 0 check (revision >= 0),
  state text not null check (state in ('awaiting_approval','approved','submitting','queued','ready','failed','declined','unknown')),
  settled boolean not null default false,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, message_id)
);
create index coden_media_jobs_worker on public.coden_media_jobs (updated_at) where not settled;
create table public.coden_media_files (
  id uuid primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.coden_media_jobs(id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);
create index coden_media_files_project on public.coden_media_files (project_id,user_id);
alter table public.coden_media_jobs enable row level security;
alter table public.coden_media_files enable row level security;
-- Supplier identities, prompts, quotes, requests and billing internals are server-only.
-- The authenticated application server separately verifies project ownership.
revoke all on public.coden_media_jobs, public.coden_media_files from public, anon, authenticated;
grant select, insert, update, delete on public.coden_media_jobs, public.coden_media_files to service_role;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('coden-generated-media','coden-generated-media',false,20971520,array['image/webp','video/mp4'])
on conflict (id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['image/webp','video/mp4'];
-- No browser object policy grants access to this bucket. Also fence it against
-- any existing broad permissive Storage policies; the service role bypasses RLS.
create policy coden_media_private_storage on storage.objects as restrictive
for all to anon, authenticated
using (bucket_id <> 'coden-generated-media')
with check (bucket_id <> 'coden-generated-media');
-- Older media records contain supplier fields and temporary links too.
revoke all on public.media_assets from anon, authenticated;
-- Ordinary receipts are served by Coden DTOs, never by selecting supplier rows.
create policy coden_media_private_usage on public.usage_events as restrictive
for select to anon, authenticated
using (coalesce(resource,'') not like 'media.%');
commit;
