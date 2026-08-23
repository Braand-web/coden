-- Canonical streamed chat message shape.
-- Keeps legacy `content` for compatibility while preserving AI/UI parts.

alter table if exists public.project_messages
  add column if not exists ai_message_id text,
  add column if not exists parts jsonb not null default '[]'::jsonb,
  add column if not exists metadata jsonb;

create unique index if not exists project_messages_project_ai_message_id_unique
  on public.project_messages(project_id, ai_message_id)
  where ai_message_id is not null;

create index if not exists project_messages_project_created_at_idx
  on public.project_messages(project_id, created_at);
