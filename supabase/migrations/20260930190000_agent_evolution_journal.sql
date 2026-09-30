-- The evolution journal: every change the agents make to their own skills, sub-agents, prompts, routing and
-- catalogues — adopted, rolled back, blocked by the protected core or the freeze, or proposed — with the reason
-- and the measure behind it. RLS on, no policy: only the server, with the service role, writes or reads it.
create table if not exists public.agent_evolution_journal (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('skill', 'subagent', 'prompt', 'routing', 'catalog', 'code')),
  target text not null,
  decision text not null check (decision in ('adopted', 'rolled_back', 'blocked', 'proposed')),
  reason text not null,
  rule text,
  baseline jsonb,
  candidate jsonb,
  version integer
);
create index if not exists agent_evolution_journal_created_idx on public.agent_evolution_journal (created_at desc);
create index if not exists agent_evolution_journal_decision_idx on public.agent_evolution_journal (decision, created_at desc);
alter table public.agent_evolution_journal enable row level security;
revoke all on public.agent_evolution_journal from anon, authenticated;
