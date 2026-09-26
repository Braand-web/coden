-- Security hardening and admin budget features.
--
-- 1. Project secrets are read and written by the server only (service role),
--    which validates names, encrypts values and checks project roles. The
--    owner-wide ALL policy let a signed-in owner write rows directly through
--    the REST API, around every one of those checks.
drop policy if exists "Project secrets owner isolation" on public.project_secrets;
revoke all on public.project_secrets from anon, authenticated;

-- 2. The Cloud backend row decides which Supabase project an app is wired to.
--    Owners may read it; only the server may change it.
drop policy if exists "Coden Cloud project owner isolation" on public.coden_cloud_projects;
create policy "Coden Cloud project owner read"
  on public.coden_cloud_projects
  for select
  to authenticated
  using (project_id in (select projects.id from public.projects where projects.owner_id = (select auth.uid())));
revoke insert, update, delete on public.coden_cloud_projects from anon, authenticated;

-- 3. Admin tables: no client role has any business here (RLS already denies;
--    privileges are removed as well, as a second lock).
revoke all on public.admin_audit_log from anon, authenticated;
revoke all on public.admin_cost_alerts from anon, authenticated;

-- 4. Hard budgets: a user rule can stop paid generation once the month's
--    spend reaches it (checked by the server before any provider call).
alter table public.admin_cost_alerts add column if not exists hard_limit boolean not null default false;

-- 5. One notification per rule, month and level, whatever the number of
--    server instances or restarts.
create table if not exists public.admin_cost_alert_notifications (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.admin_cost_alerts(id) on delete cascade,
  period text not null,
  level text not null check (level in ('warning', 'exceeded')),
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (rule_id, period, level)
);
alter table public.admin_cost_alert_notifications enable row level security;
revoke all on public.admin_cost_alert_notifications from anon, authenticated;

-- 6. Revoking a bonus granted from the admin console: atomic, limited to such
--    grants, recorded in the ledger. Executable by the server only.
create or replace function public.coden_admin_revoke_bonus(p_grant_id uuid, p_idempotency_key text)
returns numeric
language plpgsql
security definer
set search_path to ''
as $function$
declare
  revoked numeric;
  target_account uuid;
  account_balance numeric;
begin
  update public.credit_grants
     set frozen_at = now()
   where id = p_grant_id
     and kind = 'bonus'
     and metadata->>'source' = 'admin_console'
     and frozen_at is null
  returning credits_remaining, account_id into revoked, target_account;

  if target_account is null then
    raise exception 'Grant not revocable';
  end if;

  select coalesce(sum(credits_remaining), 0) into account_balance
    from public.credit_grants
   where account_id = target_account and frozen_at is null and expires_at > now();

  insert into public.credit_ledger_entries (account_id, grant_id, entry_type, amount_credits, balance_after, description, idempotency_key)
  values (target_account, p_grant_id, 'freeze', -revoked, account_balance, 'admin_bonus_revoked', p_idempotency_key)
  on conflict (idempotency_key) do nothing;

  return revoked;
end;
$function$;

revoke all on function public.coden_admin_revoke_bonus(uuid, text) from public, anon, authenticated;
grant execute on function public.coden_admin_revoke_bonus(uuid, text) to service_role;
