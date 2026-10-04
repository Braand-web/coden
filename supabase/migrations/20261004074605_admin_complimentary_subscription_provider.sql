-- Complimentary entitlements are not payment-provider transactions.
-- Existing RLS and service-role-only write privileges remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $migration$
declare provider_constraint text;
begin
  select conname into strict provider_constraint from pg_constraint
  where conrelid = 'public.billing_subscriptions_v2'::regclass and contype = 'c'
    and conkey = array[(select attnum from pg_attribute where attrelid = 'public.billing_subscriptions_v2'::regclass and attname = 'provider')]::smallint[];
  execute format('alter table public.billing_subscriptions_v2 drop constraint %I', provider_constraint);
end;
$migration$;
alter table public.billing_subscriptions_v2 add constraint billing_subscriptions_v2_provider_check
  check (provider in ('stripe', 'saspay', 'admin'));
alter table public.billing_subscriptions_v2 drop constraint if exists billing_subscriptions_v2_admin_contract_check;
alter table public.billing_subscriptions_v2 add constraint billing_subscriptions_v2_admin_contract_check check (
  provider <> 'admin' or (
    monthly_net_revenue_usd = 0 and next_credit_grant_at is null
    and cancel_at_period_end = true and billing_interval = 'contract'
    and provider_subscription_id is not null and provider_subscription_id like 'admin:%'
    and current_period_start is not null and current_period_end is not null and current_period_end > current_period_start
  )
);
commit;
