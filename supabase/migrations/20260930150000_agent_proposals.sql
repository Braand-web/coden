-- Ideas the agent proposes during a session, and how many a person wants.
--
-- One row per proposal: what it is, the instruction it applies, and what became
-- of it (new, applied, later, dismissed). Read and written by the server with
-- the service role only, after it has checked the person can see the project.
create table if not exists public.agent_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  project_id uuid not null,
  user_id uuid not null,
  batch_id uuid not null,
  title text not null check (char_length(title) <= 80),
  why text not null check (char_length(why) <= 200),
  detail text not null check (char_length(detail) <= 700),
  prompt text not null check (char_length(prompt) <= 900),
  category text not null default 'feature' check (category in ('feature', 'design', 'quality', 'performance', 'growth')),
  status text not null default 'new' check (status in ('new', 'applied', 'later', 'dismissed'))
);

create index if not exists agent_proposals_project_idx on public.agent_proposals (project_id, created_at desc);
create index if not exists agent_proposals_user_day_idx on public.agent_proposals (user_id, created_at desc);

alter table public.agent_proposals enable row level security;
revoke all on public.agent_proposals from anon, authenticated;

-- "Propose less": normal (default), fewer, or off.
alter table public.user_agent_preferences
  add column if not exists proposal_level text not null default 'normal'
  check (proposal_level in ('normal', 'fewer', 'off'));
