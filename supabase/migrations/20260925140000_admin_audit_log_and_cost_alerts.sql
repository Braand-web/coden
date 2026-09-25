-- Admin audit log: who did what, and when, in the admin console.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);
alter table public.admin_audit_log enable row level security;
-- No policy: only the service role (the server) reads or writes it.

-- Spending alerts: a monthly OpenRouter budget per user, and a global one.
create table if not exists public.admin_cost_alerts (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'user', 'model')),
  target_id text,
  monthly_budget_usd numeric(12, 4) not null check (monthly_budget_usd > 0),
  enabled boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists admin_cost_alerts_scope_target_idx on public.admin_cost_alerts (scope, coalesce(target_id, ''));
alter table public.admin_cost_alerts enable row level security;
