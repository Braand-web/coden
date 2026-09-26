-- Facturation v3, étapes 2 et 3 : catégories, ordre de consommation,
-- journal immuable, remboursements et mesure au coût réel (observation).
--
-- Tout est additif : les catégories v2 (build, ai_gateway, cloud, email)
-- restent valides, et `ai_gateway` est l'ancien nom du Chat.

-- 1. Catégories v3 sur les octrois et les réservations.
alter table public.credit_grants drop constraint if exists credit_grants_usage_restriction_check;
alter table public.credit_grants add constraint credit_grants_usage_restriction_check
  check (usage_restriction = any (array['build','chat','ai_gateway','agent','cloud','app_ai','connectors','general','email']));

alter table public.credit_grants drop constraint if exists credit_grants_kind_check;
alter table public.credit_grants add constraint credit_grants_kind_check
  check (kind = any (array['signup_free','daily_build','monthly_cloud','monthly_ai','monthly_plan','rollover','bonus','topup','commitment','email','refund']));

alter table public.usage_reservations drop constraint if exists usage_reservations_category_check;
alter table public.usage_reservations add constraint usage_reservations_category_check
  check (category = any (array['build','chat','ai_gateway','cloud','app_ai','connectors','email']));

-- 2. Le registre des crédits ne se réécrit pas : aucune modification, et une
--    suppression seulement quand le compte lui-même disparaît (suppression
--    du compte utilisateur, en cascade).
create or replace function public.coden_ledger_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.billing_accounts where id = old.account_id) then
    return old;
  end if;
  raise exception 'credit_ledger_entries is append-only';
end;
$$;

drop trigger if exists coden_ledger_immutable on public.credit_ledger_entries;
create trigger coden_ledger_immutable
  before update or delete on public.credit_ledger_entries
  for each row execute function public.coden_ledger_immutable();

-- 3. Ordre de consommation : les crédits propres à la catégorie d'abord, puis
--    les crédits quotidiens de l'agent (Build et Chat), puis les crédits
--    généraux ; à chaque rang, le plus proche de l'expiration d'abord, et à
--    échéance égale bonus, puis forfait, puis recharge.
create or replace function public.coden_billing_reserve(
  p_account_id uuid,
  p_category text,
  p_credits numeric,
  p_estimated_cogs_usd numeric,
  p_idempotency_key text,
  p_expires_at timestamp with time zone
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation_id uuid;
  grant_row record;
  credit_need numeric := greatest(coalesce(p_credits, 0), 0);
  cogs_need numeric := greatest(coalesce(p_estimated_cogs_usd, 0), 0);
  credit_take numeric;
  cogs_take numeric;
  cogs_per_credit numeric;
  -- Le Chat porte deux noms : `chat` (v3) et `ai_gateway` (v2).
  specific text[] := case when p_category in ('chat', 'ai_gateway') then array['chat', 'ai_gateway'] else array[p_category] end;
  agent_scope boolean := p_category in ('build', 'chat', 'ai_gateway');
begin
  select id into v_reservation_id from public.usage_reservations where idempotency_key = p_idempotency_key;
  if v_reservation_id is not null then return v_reservation_id; end if;
  if credit_need <= 0 or p_expires_at <= now() then raise exception 'Invalid usage reservation'; end if;

  insert into public.usage_reservations (account_id, category, idempotency_key, expires_at)
  values (p_account_id, p_category, p_idempotency_key, p_expires_at)
  returning id into v_reservation_id;

  for grant_row in
    select * from public.credit_grants
    where account_id = p_account_id
      and frozen_at is null and expires_at > now()
      and credits_remaining > 0
      and (usage_restriction = any (specific)
        or usage_restriction = 'general'
        or (agent_scope and usage_restriction = 'agent'))
    order by
      case when usage_restriction = any (specific) then 0 when usage_restriction = 'agent' then 1 else 2 end,
      expires_at,
      case when kind in ('bonus', 'refund') then 0 when kind = 'topup' then 2 else 1 end,
      issued_at
    for update
  loop
    exit when credit_need <= 0 and cogs_need <= 0;
    cogs_per_credit := case when grant_row.credits_remaining > 0 then grant_row.max_cogs_remaining_usd / grant_row.credits_remaining else 0 end;
    credit_take := least(
      grant_row.credits_remaining,
      greatest(credit_need, case when cogs_per_credit > 0 then cogs_need / cogs_per_credit else 0 end)
    );
    credit_take := ceil(credit_take * 10000) / 10000;
    credit_take := least(credit_take, grant_row.credits_remaining);
    if credit_take <= 0 then continue; end if;
    cogs_take := least(grant_row.max_cogs_remaining_usd, credit_take * cogs_per_credit);

    update public.credit_grants
      set credits_remaining = credits_remaining - credit_take,
          max_cogs_remaining_usd = greatest(0, max_cogs_remaining_usd - cogs_take)
      where id = grant_row.id;

    insert into public.usage_reservation_lines (reservation_id, grant_id, credits_reserved, cogs_reserved_usd)
    values (v_reservation_id, grant_row.id, credit_take, cogs_take);
    credit_need := greatest(0, credit_need - credit_take);
    cogs_need := greatest(0, cogs_need - cogs_take);
  end loop;

  if credit_need > 0.0001 or cogs_need > 0.00000001 then
    raise exception 'Insufficient eligible credits or COGS capacity';
  end if;

  update public.usage_reservations
    set credits_reserved = (select coalesce(sum(credits_reserved), 0) from public.usage_reservation_lines where usage_reservation_lines.reservation_id = usage_reservations.id),
        cogs_reserved_usd = (select coalesce(sum(cogs_reserved_usd), 0) from public.usage_reservation_lines where usage_reservation_lines.reservation_id = usage_reservations.id)
    where id = v_reservation_id;
  return v_reservation_id;
end;
$$;

-- 4. Un remboursement est un octroi de genre `refund`, inscrit au registre
--    comme `refund` (et non `grant`) pour que l'historique le montre.
create or replace function public.coden_billing_grant(
  p_account_id uuid,
  p_kind text,
  p_restriction text,
  p_credits numeric,
  p_net_revenue_usd numeric,
  p_max_cogs_usd numeric,
  p_expires_at timestamp with time zone,
  p_source_reference text,
  p_idempotency_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_id uuid;
  account_balance numeric;
begin
  if p_credits <= 0 or p_max_cogs_usd < 0 or p_expires_at <= now() then
    raise exception 'Invalid credit grant';
  end if;

  insert into public.credit_grants (
    account_id, kind, usage_restriction, credits_issued, credits_remaining,
    net_revenue_usd, max_cogs_usd, max_cogs_remaining_usd, expires_at,
    source_reference, idempotency_key, metadata
  ) values (
    p_account_id, p_kind, p_restriction, p_credits, p_credits,
    p_net_revenue_usd, p_max_cogs_usd, p_max_cogs_usd, p_expires_at,
    p_source_reference, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  ) on conflict (idempotency_key) do nothing
  returning id into grant_id;

  if grant_id is null then
    select id into grant_id from public.credit_grants where idempotency_key = p_idempotency_key;
    return grant_id;
  end if;

  select coalesce(sum(credits_remaining), 0) into account_balance
  from public.credit_grants
  where account_id = p_account_id and frozen_at is null and expires_at > now();

  insert into public.credit_ledger_entries (
    account_id, grant_id, entry_type, amount_credits, balance_after, description, idempotency_key
  ) values (
    p_account_id, grant_id, case when p_kind = 'refund' then 'refund' else 'grant' end,
    p_credits, account_balance, p_source_reference, p_idempotency_key || ':ledger'
  ) on conflict (idempotency_key) do nothing;

  return grant_id;
end;
$$;

-- Les crédits remboursés depuis la console se révoquent comme un bonus.
create or replace function public.coden_admin_revoke_bonus(p_grant_id uuid, p_idempotency_key text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked numeric;
  target_account uuid;
  account_balance numeric;
begin
  update public.credit_grants
     set frozen_at = now()
   where id = p_grant_id
     and kind in ('bonus', 'refund')
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
$$;

revoke all on function public.coden_billing_reserve(uuid, text, numeric, numeric, text, timestamp with time zone) from public, anon, authenticated;
revoke all on function public.coden_billing_grant(uuid, text, text, numeric, numeric, numeric, timestamp with time zone, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.coden_admin_revoke_bonus(uuid, text) from public, anon, authenticated;
revoke all on function public.coden_ledger_immutable() from public, anon, authenticated;
grant execute on function public.coden_billing_reserve(uuid, text, numeric, numeric, text, timestamp with time zone) to service_role;
grant execute on function public.coden_billing_grant(uuid, text, text, numeric, numeric, numeric, timestamp with time zone, text, text, jsonb) to service_role;
grant execute on function public.coden_admin_revoke_bonus(uuid, text) to service_role;

-- 5. Mesure au coût réel, en observation : à côté de ce qui est facturé
--    aujourd'hui, ce que la grille v3 aurait facturé pour le même appel.
alter table public.usage_events
  add column if not exists prompt_tokens integer,
  add column if not exists completion_tokens integer,
  add column if not exists v3_credits numeric(14, 4),
  add column if not exists v3_pricing_version integer;

create index if not exists usage_events_v3_created_idx
  on public.usage_events (created_at desc) where v3_credits is not null;
