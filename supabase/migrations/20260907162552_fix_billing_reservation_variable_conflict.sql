-- Additive function replacement only. Existing balances, grants and history are unchanged.
-- Prior definition: 20260906140000_coden_v4_control_agent_billing.sql.
create or replace function public.coden_billing_reserve(
  p_account_id uuid,
  p_category text,
  p_credits numeric,
  p_estimated_cogs_usd numeric,
  p_idempotency_key text,
  p_expires_at timestamptz
) returns uuid
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
      and usage_restriction in (p_category, 'general')
    order by case when usage_restriction = p_category then 0 else 1 end, expires_at, issued_at
    for update
  loop
    exit when credit_need <= 0 and cogs_need <= 0;
    cogs_per_credit := case when grant_row.credits_remaining > 0 then grant_row.max_cogs_remaining_usd / grant_row.credits_remaining else 0 end;
    credit_take := least(
      grant_row.credits_remaining,
      greatest(credit_need, case when cogs_per_credit > 0 then cogs_need / cogs_per_credit else 0 end)
    );
    credit_take := ceil(credit_take * 10000) / 10000;
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
