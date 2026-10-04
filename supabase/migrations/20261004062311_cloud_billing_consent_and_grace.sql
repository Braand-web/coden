begin;
-- Consent alone does not enable collection. No unvalidated collector is enabled.
create table public.cloud_billing_consents (
  project_id uuid primary key references public.projects(id),
  account_id uuid not null references public.billing_accounts(id),
  tariff_version text not null,
  accepted_by uuid not null references auth.users(id),
  accepted_at timestamptz not null default now()
);
create table public.cloud_billing_grace (
  account_id uuid primary key references public.billing_accounts(id),
  started_at timestamptz not null default now(),
  budget_credits numeric(22,10) not null check(budget_credits in (1,5,10)),
  used_credits numeric(22,10) not null default 0 check(used_credits>=0 and used_credits<=budget_credits),
  paid_replenishment_id uuid references public.credit_grants(id),
  updated_at timestamptz not null default now()
);
create table public.cloud_meter_collectors (
  collector_id text primary key,
  enabled boolean not null default false,
  attribution_verified boolean not null default false,
  validation_reference text,
  check(not enabled or (attribution_verified and coalesce(length(validation_reference),0)>0))
);
create table public.cloud_grace_usage_events (
  idempotency_key text primary key,
  account_id uuid not null references public.billing_accounts(id),
  project_id uuid not null references public.projects(id),
  credits numeric(22,10) not null check(credits>0),
  created_at timestamptz not null default now()
);
alter table public.cloud_billing_consents enable row level security;
alter table public.cloud_billing_grace enable row level security;
alter table public.cloud_meter_collectors enable row level security;
alter table public.cloud_grace_usage_events enable row level security;
revoke all on public.cloud_billing_consents,public.cloud_billing_grace,public.cloud_meter_collectors from public,anon,authenticated,service_role;
revoke all on public.cloud_grace_usage_events from public,anon,authenticated,service_role;
grant select,insert,update on public.cloud_billing_consents to service_role;
grant select on public.cloud_billing_grace,public.cloud_meter_collectors to service_role;
grant select on public.cloud_grace_usage_events to service_role;

-- Used only by an independently validated server collector, never by the browser.
create or replace function public.coden_cloud_consume_grace(
  p_account_id uuid,p_project_id uuid,p_collector_id text,p_idempotency_key text,p_credits numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare g public.cloud_billing_grace%rowtype; prior public.cloud_grace_usage_events%rowtype;
  paid_id uuid; paid_at timestamptz; plan text; budget numeric; balance numeric;
begin
  if p_credits is null or p_credits<=0 or p_credits::text in ('NaN','Infinity','-Infinity')
    or p_credits<>round(p_credits,10) or length(coalesce(p_idempotency_key,'')) not between 8 and 200
  then raise exception 'Invalid Cloud measurement'; end if;
  if not exists(select 1 from public.cloud_meter_collectors where collector_id=p_collector_id and enabled and attribution_verified)
    then return jsonb_build_object('allowed',false,'reason','collector_not_validated'); end if;
  if not exists(select 1 from public.cloud_billing_consents c join public.projects p on p.id=c.project_id
    where c.project_id=p_project_id and c.account_id=p_account_id and p.organization_id=p_account_id and c.accepted_by=p.owner_id
      and c.tariff_version='2026-10-04.cloud-reference-v1')
    then return jsonb_build_object('allowed',false,'reason','owner_consent_required'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||p_account_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-cloud:'||p_idempotency_key,0));
  select * into prior from public.cloud_grace_usage_events where idempotency_key=p_idempotency_key;
  if found then
    if prior.account_id<>p_account_id or prior.project_id<>p_project_id or prior.credits<>p_credits
      then raise exception 'Cloud measurement identity conflict'; end if;
    return jsonb_build_object('allowed',true,'replayed',true,'sponsored_credits',prior.credits);
  end if;
  select coalesce(sum(credits_remaining),0) into balance from public.credit_grants
    where account_id=p_account_id and frozen_at is null and expires_at>now() and usage_restriction in ('cloud','general');
  if balance>=p_credits then return jsonb_build_object('allowed',false,'reason','wallet_payment_required'); end if;
  select lower(o.plan) into plan from public.organizations o where o.id=p_account_id;
  budget:=case when plan in ('business','enterprise') then 10 when plan='pro' then 5 else 1 end;
  select x.id,x.issued_at into paid_id,paid_at from public.credit_grants x
    join public.billing_checkout_intents c on c.account_id=x.account_id and c.status='paid' and c.provider_transaction_id is not null
      and (x.source_reference='saspay:'||c.provider_transaction_id or x.source_reference='saspay:'||c.provider_transaction_id||':initial'
        or x.source_reference like 'saspay-annual:'||c.provider_checkout_id||':%')
    where x.account_id=p_account_id and x.kind in ('topup','monthly_plan') and x.net_revenue_usd>0
    order by x.issued_at desc,x.id limit 1;
  select * into g from public.cloud_billing_grace where account_id=p_account_id for update;
  if not found then
    insert into public.cloud_billing_grace(account_id,budget_credits,paid_replenishment_id) values(p_account_id,budget,paid_id) returning * into g;
  elsif paid_id is not null and paid_id is distinct from g.paid_replenishment_id and paid_at>g.started_at then
    update public.cloud_billing_grace set started_at=now(),budget_credits=budget,used_credits=0,paid_replenishment_id=paid_id,updated_at=now()
      where account_id=p_account_id returning * into g;
  end if;
  if now()>=g.started_at+interval '72 hours' or g.used_credits+p_credits>g.budget_credits
    then return jsonb_build_object('allowed',false,'reason','cloud_grace_exhausted','expires_at',g.started_at+interval '72 hours'); end if;
  insert into public.cloud_grace_usage_events(idempotency_key,account_id,project_id,credits)
    values(p_idempotency_key,p_account_id,p_project_id,p_credits);
  update public.cloud_billing_grace set used_credits=used_credits+p_credits,updated_at=now() where account_id=p_account_id;
  return jsonb_build_object('allowed',true,'replayed',false,'sponsored_credits',p_credits,'expires_at',g.started_at+interval '72 hours');
end;
$$;
revoke all on function public.coden_cloud_consume_grace(uuid,uuid,text,text,numeric) from public,anon,authenticated;
grant execute on function public.coden_cloud_consume_grace(uuid,uuid,text,text,numeric) to service_role;
commit;
