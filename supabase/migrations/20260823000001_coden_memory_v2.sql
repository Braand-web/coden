-- Coden memory v2: provenance, confidence, lifecycle and verified-fact links.
-- Idempotent and safe on both fresh and existing projects.

alter table if exists public.project_memory
  add column if not exists source text not null default 'legacy',
  add column if not exists confidence numeric(4,3) not null default 0.5,
  add column if not exists verified boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists supersedes_id uuid references public.project_memory(id) on delete set null,
  add column if not exists verified_fact_ids text[] not null default '{}',
  add column if not exists content_hash text;

alter table if exists public.project_memory
  drop constraint if exists project_memory_memory_type_check;

alter table if exists public.project_memory
  add constraint project_memory_memory_type_check
  check (memory_type in (
    'adr', 'preference', 'blocker', 'pattern', 'design_token',
    'user_instruction', 'failure'
  ));

alter table if exists public.project_memory
  drop constraint if exists project_memory_source_check;

alter table if exists public.project_memory
  add constraint project_memory_source_check
  check (source in ('user', 'filesystem', 'verified_run', 'model_candidate', 'legacy'));

alter table if exists public.project_memory
  drop constraint if exists project_memory_confidence_check;

alter table if exists public.project_memory
  add constraint project_memory_confidence_check
  check (confidence >= 0 and confidence <= 1);

create unique index if not exists project_memory_project_hash_unique
  on public.project_memory(project_id, content_hash)
  where content_hash is not null and supersedes_id is null;

create index if not exists project_memory_retrieval_idx
  on public.project_memory(project_id, verified desc, memory_type, updated_at desc);

comment on table public.project_memory is
  'Bounded project memory candidates. Verified facts remain authoritative in the run ledger.';
