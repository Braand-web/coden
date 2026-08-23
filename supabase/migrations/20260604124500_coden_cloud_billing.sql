-- Coden Cloud billing foundation.
-- User-facing Cloud balance is separate from AI build credits.

create table if not exists public.cloud_wallets (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  balance_usd numeric(12, 2) not null default 0,
  included_balance_usd numeric(12, 2) not null default 0,
  ai_app_balance_usd numeric(12, 2) not null default 0,
  auto_topup_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_usage_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  usage_type text not null check (
    usage_type in (
      'included_grant',
      'topup',
      'database_server',
      'database_storage',
      'compute',
      'file_storage',
      'live_updates',
      'network',
      'ai_app_usage',
      'adjustment',
      'refund'
    )
  ),
  amount_usd numeric(12, 4) not null default 0,
  quantity numeric(14, 4),
  unit text,
  description text,
  reference_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cloud_usage_ledger_org_created
  on public.cloud_usage_ledger (organization_id, created_at desc);

create index if not exists idx_cloud_usage_ledger_project_created
  on public.cloud_usage_ledger (project_id, created_at desc)
  where project_id is not null;

alter table public.cloud_wallets enable row level security;
alter table public.cloud_usage_ledger enable row level security;

drop policy if exists "Users can read own cloud wallet" on public.cloud_wallets;
create policy "Users can read own cloud wallet"
  on public.cloud_wallets
  for select
  to authenticated
  using (organization_id = auth.uid());

drop policy if exists "Users can read own cloud usage ledger" on public.cloud_usage_ledger;
create policy "Users can read own cloud usage ledger"
  on public.cloud_usage_ledger
  for select
  to authenticated
  using (organization_id = auth.uid());

grant select on public.cloud_wallets to authenticated;
grant select on public.cloud_usage_ledger to authenticated;
grant all on public.cloud_wallets to service_role;
grant all on public.cloud_usage_ledger to service_role;
