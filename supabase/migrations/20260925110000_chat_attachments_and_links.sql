-- Composer attachments and analysed links.
--
-- One row per file or link sent with a message. The file itself, its derived
-- images (normalised picture, video key frames, page screenshots) and its
-- soundtrack live in the private bucket `chat-attachments`, one folder per
-- user. Only the server (service role) reads and writes either: the browser
-- goes through /api/attachments, which checks ownership.

create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  project_id uuid null,
  kind text not null check (kind in ('image', 'video', 'document', 'spreadsheet', 'text', 'code', 'archive', 'link')),
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  storage_path text null,
  source_url text null,
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  error text null,
  summary text not null default '',
  extracted_text text not null default '',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_attachments_project_idx on public.chat_attachments (project_id, created_at desc);
create index if not exists chat_attachments_user_idx on public.chat_attachments (user_id, created_at desc);

alter table public.chat_attachments enable row level security;
-- No policy: only the service role (the Coden server) may read or write.

insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
