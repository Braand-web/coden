-- Restore every historical subscription tier and add the two new entry offers.
-- Pro gains 25 credits / 5 000 XAF and 60 credits / 10 000 XAF without
-- removing the existing 100 through 10 000-credit choices.

begin;

update public.plan_catalog
set version = '2026-09-21.canonical-v2',
    configuration = case plan_key
      when 'free' then '{"signup_credits":5,"grant_once":true,"published_sites":0,"custom_domains":0,"preview":"private","provider":"saspay"}'::jsonb
      when 'pro' then '{"base_credits":100,"credit_tiers":[25,60,100,200,400,800,1200,2000,3000,4000,5000,7500,10000],"entry_monthly_xaf":{"25":5000,"60":10000},"standard_xaf_per_credit":150,"published_sites":{"25":1,"60":3,"100+":null},"custom_domains":{"25":1,"60":3,"100+":10},"annual_discount":0.20,"provider":"saspay"}'::jsonb
      when 'business' then '{"base_credits":100,"credit_tiers":[100,200,400,800,1200,2000,3000,4000,5000,7500,10000],"standard_xaf_per_credit":300,"published_sites":null,"custom_domains":null,"annual_discount":0.20,"provider":"saspay"}'::jsonb
      else configuration
    end,
    active = true
where plan_key in ('free', 'pro', 'business');

update public.price_versions
set effective_until = coalesce(effective_until, now())
where effective_until is null
  and plan_id in ('coden_pro_v2', 'coden_business_v2')
  and id not like '%2026-09-21.canonical-v2';

with tier_prices(plan_id, plan_key, credits, monthly_xaf) as (
  values
    ('coden_pro_v2', 'pro', 25, 5000),
    ('coden_pro_v2', 'pro', 60, 10000),
    ('coden_pro_v2', 'pro', 100, 15000),
    ('coden_pro_v2', 'pro', 200, 30000),
    ('coden_pro_v2', 'pro', 400, 60000),
    ('coden_pro_v2', 'pro', 800, 120000),
    ('coden_pro_v2', 'pro', 1200, 180000),
    ('coden_pro_v2', 'pro', 2000, 300000),
    ('coden_pro_v2', 'pro', 3000, 450000),
    ('coden_pro_v2', 'pro', 4000, 600000),
    ('coden_pro_v2', 'pro', 5000, 750000),
    ('coden_pro_v2', 'pro', 7500, 1125000),
    ('coden_pro_v2', 'pro', 10000, 1500000),
    ('coden_business_v2', 'business', 100, 30000),
    ('coden_business_v2', 'business', 200, 60000),
    ('coden_business_v2', 'business', 400, 120000),
    ('coden_business_v2', 'business', 800, 240000),
    ('coden_business_v2', 'business', 1200, 360000),
    ('coden_business_v2', 'business', 2000, 600000),
    ('coden_business_v2', 'business', 3000, 900000),
    ('coden_business_v2', 'business', 4000, 1200000),
    ('coden_business_v2', 'business', 5000, 1500000),
    ('coden_business_v2', 'business', 7500, 2250000),
    ('coden_business_v2', 'business', 10000, 3000000)
), billing_intervals(interval, multiplier) as (
  values ('monthly', 1::numeric), ('annual', 9.6::numeric)
)
insert into public.price_versions (
  id,
  plan_id,
  interval,
  credits,
  amount_usd,
  effective_from,
  metadata
)
select
  tier_price.plan_key || '_' || tier_price.credits::text || '_' || billing_interval.interval || '_2026-09-21.canonical-v2',
  tier_price.plan_id,
  billing_interval.interval,
  tier_price.credits,
  round((tier_price.monthly_xaf::numeric * billing_interval.multiplier) / 600, 4),
  '2026-09-21T00:00:00Z'::timestamptz,
  jsonb_build_object(
    'amount_xaf', round(tier_price.monthly_xaf::numeric * billing_interval.multiplier),
    'provider', 'saspay',
    'version', '2026-09-21.canonical-v2'
  )
from tier_prices as tier_price
cross join billing_intervals as billing_interval
on conflict (id) do update set
  amount_usd = excluded.amount_usd,
  effective_from = excluded.effective_from,
  effective_until = null,
  metadata = excluded.metadata;

commit;
