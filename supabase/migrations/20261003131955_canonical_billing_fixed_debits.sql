begin;

alter table public.provider_webhook_events add column if not exists processing_started_at timestamptz not null default now();

-- Preserve all historical prices and measurements, but make V3 unactivatable.
update public.billing_pricing_versions set status = 'archived' where status <> 'archived';
create or replace function public.coden_pricing_version_guard() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Historical pricing versions are read-only; use the canonical catalogue'; end;
$$;
drop trigger if exists billing_pricing_versions_guard on public.billing_pricing_versions;
create trigger billing_pricing_versions_guard before insert or update or delete on public.billing_pricing_versions
for each row execute function public.coden_pricing_version_guard();
create or replace function public.coden_activate_pricing_version(p_id uuid, p_actor text) returns integer
language plpgsql security definer set search_path = '' as $$
begin raise exception 'V3 pricing is permanently retired'; end;
$$;
revoke all on function public.coden_activate_pricing_version(uuid,text) from public, anon, authenticated, service_role;
revoke insert, update, delete on public.billing_pricing_versions from service_role;

-- Preserve fractions rather than rounding every infrastructure request up.
alter table public.credit_grants alter column credits_issued type numeric(22,10), alter column credits_remaining type numeric(22,10);
alter table public.usage_reservations alter column credits_reserved type numeric(22,10);
alter table public.usage_reservation_lines alter column credits_reserved type numeric(22,10);
alter table public.usage_settlements alter column credits_charged type numeric(22,10);
alter table public.usage_settlements alter column realized_margin type numeric(20,10);
alter table public.credit_ledger_entries alter column amount_credits type numeric(22,10), alter column balance_after type numeric(22,10);

-- Already-delivered results have a durable, retriable settlement; never a second charge.
create table public.billing_delivery_checkpoints (
  reservation_id uuid primary key references public.usage_reservations(id),
  account_id uuid not null references public.billing_accounts(id),
  usage_payload jsonb not null,
  credits_charged numeric(22,10) not null check(credits_charged>0),
  complete_cost_usd numeric(18,10) not null check(complete_cost_usd>=0),
  status text not null default 'pending' check(status in ('pending','settled')),
  created_at timestamptz not null default now(),
  check(usage_payload ? 'account_id' and (usage_payload->>'account_id')::uuid=account_id)
);
alter table public.billing_delivery_checkpoints enable row level security;
revoke all on public.billing_delivery_checkpoints from public,anon,authenticated,service_role;
grant select,insert on public.billing_delivery_checkpoints to service_role;
create index billing_delivery_pending_idx on public.billing_delivery_checkpoints(created_at) where status='pending';

create table public.billing_settlement_outbox (
  reservation_id uuid primary key references public.usage_reservations(id),
  usage_event_id uuid not null references public.usage_events(id),
  credits_charged numeric(22,10) not null check (credits_charged >= 0),
  complete_cost_usd numeric(18,10) not null check (complete_cost_usd >= 0),
  status text not null default 'pending' check (status in ('pending','settled')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.billing_settlement_outbox enable row level security;
revoke all on public.billing_settlement_outbox from public, anon, authenticated,service_role;
grant select, insert on public.billing_settlement_outbox to service_role;
create index billing_settlement_pending_idx on public.billing_settlement_outbox(created_at) where status='pending';

-- A server defect must not bind another account's event to this reservation.
-- Serialize with reserve/settle/release using their account-before-row lock order.
create or replace function public.coden_billing_delivery_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations%rowtype; e public.usage_events%rowtype;
begin
  select * into r from public.usage_reservations where id=new.reservation_id;
  if not found then raise exception 'Delivery reservation missing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||r.account_id::text,0));
  select * into r from public.usage_reservations where id=new.reservation_id for update;
  if r.status not in ('reserved','settled') or new.credits_charged<>r.credits_reserved
    or new.credits_charged::text in ('NaN','Infinity','-Infinity')
    or new.complete_cost_usd::text in ('NaN','Infinity','-Infinity')
    then raise exception 'Delivery price or reservation state conflict'; end if;
  if tg_table_name='billing_delivery_checkpoints' then
    if new.account_id<>r.account_id or new.usage_payload->>'category' is distinct from r.category
      or length(coalesce(new.usage_payload->>'idempotency_key','')) not between 8 and 200
      then raise exception 'Delivery account or category conflict'; end if;
  else
    select * into e from public.usage_events where id=new.usage_event_id;
    if not found or e.account_id<>r.account_id or e.category<>r.category
      then raise exception 'Settlement event account or category conflict'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.coden_billing_delivery_guard() from public,anon,authenticated,service_role;
create trigger billing_delivery_checkpoints_guard before insert on public.billing_delivery_checkpoints
for each row execute function public.coden_billing_delivery_guard();
create trigger billing_settlement_outbox_guard before insert on public.billing_settlement_outbox
for each row execute function public.coden_billing_delivery_guard();

create table public.billing_action_requests (
  id text primary key check (length(id)=64),
  account_id uuid not null references public.billing_accounts(id),
  fingerprint text not null check (length(fingerprint)=64),
  state text not null default 'processing' check (state in ('processing','delivered','failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.billing_action_requests enable row level security;
revoke all on public.billing_action_requests from public,anon,authenticated,service_role;
grant select on public.billing_action_requests to service_role;
grant update(state,result,updated_at) on public.billing_action_requests to service_role;
create or replace function public.coden_billing_claim_action(p_id text,p_account_id uuid,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare prior public.billing_action_requests%rowtype;
begin
  if p_id is null or p_id !~ '^[a-f0-9]{64}$' or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid action identifier'; end if;
  insert into public.billing_action_requests(id,account_id,fingerprint) values(p_id,p_account_id,p_fingerprint)
    on conflict(id) do nothing;
  if found then return jsonb_build_object('claimed',true); end if;
  select * into prior from public.billing_action_requests where id=p_id;
  if prior.account_id<>p_account_id or prior.fingerprint<>p_fingerprint then raise exception 'Action identity conflict'; end if;
  return jsonb_build_object('claimed',false,'state',prior.state,'result',prior.result);
end;
$$;
revoke all on function public.coden_billing_claim_action(text,uuid,text) from public,anon,authenticated;
grant execute on function public.coden_billing_claim_action(text,uuid,text) to service_role;

-- A verified app and its answer are recoverable in the same transaction as
-- financial delivery, even if normalized file mirroring is interrupted.
alter table public.project_state_snapshots add column billing_delivery_action_id text references public.billing_action_requests(id);

-- The recoverable result and its financial delivery checkpoint commit together.
-- If either insert fails, no delivered action can silently lose its settlement.
create or replace function public.coden_billing_complete_action(
  p_action_id text,p_account_id uuid,p_result jsonb,p_reservation_id uuid,
  p_usage_payload jsonb,p_credits numeric,p_complete_cost_usd numeric,p_delivery jsonb default null
) returns void language plpgsql security definer set search_path='' as $$
declare a public.billing_action_requests%rowtype; r public.usage_reservations%rowtype;
  p public.projects%rowtype; message_id uuid; m jsonb;
begin
  if p_result is null or p_result='null'::jsonb then raise exception 'A durable action result is required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||p_account_id::text,0));
  select * into a from public.billing_action_requests where id=p_action_id for update;
  if not found or a.account_id<>p_account_id then raise exception 'Action owner conflict'; end if;
  if a.state='delivered' then
    if a.result is distinct from p_result then raise exception 'Delivered action result is immutable'; end if;
    return;
  end if;
  if a.state<>'processing' then raise exception 'Action is not deliverable'; end if;
  if p_reservation_id is not null then
    select * into r from public.usage_reservations where id=p_reservation_id for update;
    if not found or r.account_id<>p_account_id or p_usage_payload->>'account_id' is distinct from p_account_id::text
      then raise exception 'Delivery reservation owner conflict'; end if;
    insert into public.billing_delivery_checkpoints(reservation_id,account_id,usage_payload,credits_charged,complete_cost_usd)
      values(p_reservation_id,p_account_id,p_usage_payload,p_credits,p_complete_cost_usd);
  end if;
  if p_delivery is not null then
    select * into p from public.projects where id=(p_delivery->>'project_id')::uuid for update;
    if not found or (p.owner_id is distinct from p_account_id and p.organization_id is distinct from p_account_id)
      or (p_usage_payload is not null and p_usage_payload->>'project_id' is distinct from p.id::text)
      then raise exception 'Delivery project owner conflict'; end if;
    if p_delivery ? 'files' then
      if jsonb_typeof(p_delivery->'files')<>'array' or jsonb_typeof(p_delivery->'project')<>'object'
        or p_delivery->'project'->>'id' is distinct from p.id::text then raise exception 'Invalid app delivery snapshot'; end if;
      insert into public.project_state_snapshots(project_id,owner_id,organization_id,revision,
        project_snapshot,files_snapshot,preview_snapshot,billing_delivery_action_id)
      values(p.id,p.owner_id,p.organization_id,(extract(epoch from clock_timestamp())*1000)::bigint,
        (p_delivery->'project')||jsonb_build_object('owner_id',p.owner_id,'organization_id',p.organization_id),p_delivery->'files',
        jsonb_build_object('status',p_delivery->'project'->>'preview_status','html',p_delivery->'project'->>'preview_html'),p_action_id)
      on conflict(project_id) do update set project_snapshot=excluded.project_snapshot,files_snapshot=excluded.files_snapshot,
        preview_snapshot=excluded.preview_snapshot,revision=excluded.revision,billing_delivery_action_id=p_action_id,updated_at=now();
      update public.projects set preview_html=p_delivery->'project'->>'preview_html',
        preview_status=p_delivery->'project'->>'preview_status',model_id=coalesce(p_delivery->'project'->>'model_id',model_id),updated_at=now() where id=p.id;
    end if;
    if p_delivery ? 'message' then
      m=p_delivery->'message';
      if nullif(btrim(m->>'content'),'') is null then raise exception 'Empty delivered answer'; end if;
      message_id=(substr(p_action_id,1,8)||'-'||substr(p_action_id,9,4)||'-'||substr(p_action_id,13,4)||'-'||substr(p_action_id,17,4)||'-'||substr(p_action_id,21,12))::uuid;
      insert into public.project_messages(id,organization_id,project_id,user_id,role,content,intent,requested_mode,ai_message_id,metadata)
      values(message_id,p.organization_id,p.id,(p_delivery->>'actor_id')::uuid,'assistant',m->>'content',m->>'intent',m->>'requested_mode',
        coalesce(m->>'ai_message_id',p_action_id),coalesce(m->'metadata','{}'::jsonb)) on conflict(id) do nothing;
    end if;
  end if;
  update public.billing_action_requests set state='delivered',result=p_result,updated_at=now() where id=p_action_id;
end;
$$;
revoke all on function public.coden_billing_complete_action(text,uuid,jsonb,uuid,jsonb,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.coden_billing_complete_action(text,uuid,jsonb,uuid,jsonb,numeric,numeric,jsonb) to service_role;

-- A replay preserves the original expiry and cannot mint a second signup gift.
create or replace function public.coden_billing_grant(
  p_account_id uuid,p_kind text,p_restriction text,p_credits numeric,p_net_revenue_usd numeric,
  p_max_cogs_usd numeric,p_expires_at timestamptz,p_source_reference text,p_idempotency_key text,p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare prior public.credit_grants%rowtype; grant_id uuid; balance numeric;
begin
  if p_account_id is null or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 200
    or p_credits is null or p_credits<=0 or p_credits::text in ('NaN','Infinity','-Infinity')
    or p_net_revenue_usd is null or p_net_revenue_usd<0 or p_net_revenue_usd::text in ('NaN','Infinity','-Infinity')
    or p_max_cogs_usd is null or p_max_cogs_usd<0 or p_max_cogs_usd::text in ('NaN','Infinity','-Infinity')
  then raise exception 'Invalid credit grant'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||p_account_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-grant:'||p_idempotency_key,0));
  select * into prior from public.credit_grants where idempotency_key=p_idempotency_key;
  if found then
    if prior.account_id<>p_account_id or prior.kind<>p_kind or prior.usage_restriction<>p_restriction
      or prior.credits_issued<>p_credits or prior.source_reference is distinct from p_source_reference
    then raise exception 'Credit grant identity conflict'; end if;
    return prior.id;
  end if;
  if p_kind='signup_free' then
    select * into prior from public.credit_grants where account_id=p_account_id and kind='signup_free' order by issued_at,id limit 1;
    if found then return prior.id; end if;
  end if;
  if p_expires_at is null or p_expires_at<=now() then raise exception 'Invalid credit expiry'; end if;
  insert into public.credit_grants(account_id,kind,usage_restriction,credits_issued,credits_remaining,
    net_revenue_usd,max_cogs_usd,max_cogs_remaining_usd,expires_at,source_reference,idempotency_key,metadata)
  values(p_account_id,p_kind,p_restriction,p_credits,p_credits,p_net_revenue_usd,p_max_cogs_usd,p_max_cogs_usd,
    p_expires_at,p_source_reference,p_idempotency_key,coalesce(p_metadata,'{}'::jsonb)) returning id into grant_id;
  select coalesce(sum(credits_remaining),0) into balance from public.credit_grants
    where account_id=p_account_id and frozen_at is null and expires_at>now();
  insert into public.credit_ledger_entries(account_id,grant_id,entry_type,amount_credits,balance_after,description,idempotency_key)
    values(p_account_id,grant_id,case when p_kind='refund' then 'refund' else 'grant' end,p_credits,balance,p_source_reference,p_idempotency_key||':ledger');
  return grant_id;
end;
$$;
revoke all on function public.coden_billing_grant(uuid,text,text,numeric,numeric,numeric,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.coden_billing_grant(uuid,text,text,numeric,numeric,numeric,timestamptz,text,text,jsonb) to service_role;

create or replace function public.coden_billing_reserve(
  p_account_id uuid, p_category text, p_credits numeric, p_estimated_cogs_usd numeric,
  p_idempotency_key text, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  prior public.usage_reservations%rowtype;
  reservation_id uuid;
  g record;
  remaining numeric := p_credits;
  take numeric;
  cogs_take numeric;
  specific text[] := case when p_category in ('chat','ai_gateway') then array['chat','ai_gateway'] else array[p_category] end;
begin
  if p_account_id is null or p_category not in ('build','chat','ai_gateway','cloud','app_ai','email')
    or p_credits is null or p_credits::text in ('NaN','Infinity','-Infinity') or p_credits <= 0
    or p_credits <> round(p_credits,10) or p_estimated_cogs_usd is null or p_estimated_cogs_usd < 0
    or p_estimated_cogs_usd::text in ('NaN','Infinity','-Infinity')
    or p_expires_at is null or p_expires_at <= now() or length(coalesce(p_idempotency_key,'')) not between 8 and 200
  then raise exception 'Invalid usage reservation'; end if;
  -- One lock order for reserve, release and settlement, across all server instances.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||p_account_id::text,0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-action:'||p_idempotency_key,0));
  select * into prior from public.usage_reservations where idempotency_key=p_idempotency_key;
  if found then
    if prior.account_id <> p_account_id or prior.category <> p_category or prior.credits_reserved <> p_credits
    then raise exception 'Idempotency key belongs to a different action'; end if;
    if prior.status in ('released','expired') then raise exception 'This action was cancelled; use a new action identifier'; end if;
    return prior.id;
  end if;
  insert into public.usage_reservations(account_id,category,idempotency_key,expires_at)
    values(p_account_id,p_category,p_idempotency_key,p_expires_at) returning id into reservation_id;
  for g in select * from public.credit_grants
    where account_id=p_account_id and frozen_at is null and expires_at>now() and credits_remaining>0
      and (usage_restriction=any(specific) or usage_restriction='general'
        or (p_category in ('build','chat','ai_gateway') and usage_restriction='agent'))
    order by case when usage_restriction=any(specific) then 0 when usage_restriction='agent' then 1 else 2 end,
      expires_at, case when kind in ('bonus','refund') then 0 when kind='topup' then 2 else 1 end, issued_at, id
    for update
  loop
    exit when remaining=0;
    take := least(g.credits_remaining,remaining);
    -- COGS is accounting data, never authority to inflate the customer's price.
    cogs_take := least(g.max_cogs_remaining_usd, round(take*g.max_cogs_remaining_usd/g.credits_remaining,8));
    update public.credit_grants set credits_remaining=credits_remaining-take,
      max_cogs_remaining_usd=greatest(0,max_cogs_remaining_usd-cogs_take) where id=g.id;
    insert into public.usage_reservation_lines(reservation_id,grant_id,credits_reserved,cogs_reserved_usd)
      values(reservation_id,g.id,take,cogs_take);
    remaining := remaining-take;
  end loop;
  if remaining>0 then raise exception 'Insufficient eligible credits'; end if;
  update public.usage_reservations r set credits_reserved=p_credits,
    cogs_reserved_usd=(select coalesce(sum(l.cogs_reserved_usd),0) from public.usage_reservation_lines l where l.reservation_id=r.id)
    where r.id=reservation_id;
  return reservation_id;
end;
$$;

create or replace function public.coden_billing_settle(
  p_reservation_id uuid,p_usage_event_id uuid,p_credits_charged numeric,p_complete_cost_usd numeric,p_realized_revenue_usd numeric
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  r public.usage_reservations%rowtype;
  s public.usage_settlements%rowtype;
  l record;
  account_id uuid;
  remaining numeric := p_credits_charged;
  used numeric;
  used_cogs numeric;
  cost_remaining numeric := p_complete_cost_usd;
  revenue numeric := 0;
  balance numeric;
  result uuid;
begin
  if p_credits_charged is null or p_complete_cost_usd is null or p_credits_charged<0 or p_complete_cost_usd<0
    or p_credits_charged::text in ('NaN','Infinity','-Infinity') or p_complete_cost_usd::text in ('NaN','Infinity','-Infinity')
  then raise exception 'Invalid settlement'; end if;
  select x.account_id into account_id from public.usage_reservations x where x.id=p_reservation_id;
  if account_id is null then raise exception 'Reservation not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||account_id::text,0));
  select * into r from public.usage_reservations where id=p_reservation_id for update;
  select * into s from public.usage_settlements where reservation_id=p_reservation_id;
  if found then
    if s.usage_event_id is distinct from p_usage_event_id or s.credits_charged<>p_credits_charged
      or s.complete_cost_usd<>p_complete_cost_usd then raise exception 'Settlement payload changed'; end if;
    return s.id;
  end if;
  if r.status<>'reserved' or p_credits_charged>r.credits_reserved then raise exception 'Reservation is not settleable'; end if;
  if not exists(select 1 from public.usage_events e where e.id=p_usage_event_id and e.account_id=r.account_id and e.category=r.category)
    then raise exception 'Usage event does not belong to this reservation'; end if;
  if exists(select 1 from public.usage_settlements where usage_event_id=p_usage_event_id)
    then raise exception 'Usage event was already settled'; end if;
  for l in select x.*,g.net_revenue_usd,g.credits_issued from public.usage_reservation_lines x
    join public.credit_grants g on g.id=x.grant_id where x.reservation_id=p_reservation_id order by x.grant_id
  loop
    used := least(l.credits_reserved,remaining);
    used_cogs := least(l.cogs_reserved_usd,cost_remaining);
    revenue := revenue + used*l.net_revenue_usd/l.credits_issued;
    update public.credit_grants set credits_remaining=credits_remaining+l.credits_reserved-used,
      max_cogs_remaining_usd=least(max_cogs_usd,max_cogs_remaining_usd+l.cogs_reserved_usd-used_cogs) where id=l.grant_id;
    remaining := remaining-used;
    cost_remaining := greatest(0,cost_remaining-used_cogs);
  end loop;
  if remaining<>0 then raise exception 'Incomplete reservation'; end if;
  insert into public.usage_settlements(reservation_id,usage_event_id,credits_charged,complete_cost_usd,realized_revenue_usd,realized_margin)
    values(p_reservation_id,p_usage_event_id,p_credits_charged,p_complete_cost_usd,revenue,
      case when revenue>0 then (revenue-p_complete_cost_usd)/revenue else null end) returning id into result;
  update public.usage_reservations set status='settled',settled_at=now() where id=p_reservation_id;
  select coalesce(sum(credits_remaining),0) into balance from public.credit_grants
    where credit_grants.account_id=r.account_id and frozen_at is null and expires_at>now();
  insert into public.credit_ledger_entries(account_id,reservation_id,usage_event_id,entry_type,amount_credits,balance_after,description,idempotency_key)
    values(r.account_id,p_reservation_id,p_usage_event_id,'usage',-p_credits_charged,balance,'Canonical action settlement',p_reservation_id::text||':settle');
  update public.billing_settlement_outbox set status='settled',settled_at=now() where reservation_id=p_reservation_id;
  update public.billing_delivery_checkpoints set status='settled' where reservation_id=p_reservation_id;
  return result;
end;
$$;

create or replace function public.coden_billing_release(p_reservation_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r public.usage_reservations%rowtype; l record; account_id uuid; balance numeric;
begin
  select x.account_id into account_id from public.usage_reservations x where x.id=p_reservation_id;
  if account_id is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('coden-billing:'||account_id::text,0));
  select * into r from public.usage_reservations where id=p_reservation_id for update;
  if r.status<>'reserved' then return; end if;
  if exists(select 1 from public.billing_settlement_outbox where reservation_id=p_reservation_id)
    or exists(select 1 from public.billing_delivery_checkpoints where reservation_id=p_reservation_id)
    then raise exception 'Delivered action cannot be released'; end if;
  for l in select * from public.usage_reservation_lines where reservation_id=p_reservation_id order by grant_id loop
    update public.credit_grants set credits_remaining=credits_remaining+l.credits_reserved,
      max_cogs_remaining_usd=least(max_cogs_usd,max_cogs_remaining_usd+l.cogs_reserved_usd) where id=l.grant_id;
  end loop;
  update public.usage_reservations set status='released',settled_at=now() where id=p_reservation_id;
  select coalesce(sum(credits_remaining),0) into balance from public.credit_grants
    where credit_grants.account_id=r.account_id and frozen_at is null and expires_at>now();
  insert into public.credit_ledger_entries(account_id,reservation_id,entry_type,amount_credits,balance_after,description,idempotency_key)
    values(r.account_id,p_reservation_id,'release',r.credits_reserved,balance,left(p_reason,200),p_reservation_id::text||':release');
end;
$$;

revoke all on function public.coden_billing_reserve(uuid,text,numeric,numeric,text,timestamptz) from public,anon,authenticated;
revoke all on function public.coden_billing_settle(uuid,uuid,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.coden_billing_release(uuid,text) from public,anon,authenticated;
grant execute on function public.coden_billing_reserve(uuid,text,numeric,numeric,text,timestamptz) to service_role;
grant execute on function public.coden_billing_settle(uuid,uuid,numeric,numeric,numeric) to service_role;
grant execute on function public.coden_billing_release(uuid,text) to service_role;

commit;
