-- Facturation v3, étape 1 : la configuration des tarifs.
--
-- Un document validé par version (src/services/billing/pricing-config.ts).
-- L'admin prépare un brouillon, puis l'active : l'ancienne version active
-- est archivée dans la même transaction. Une version activée ne change
-- plus jamais, pour que chaque débit reste explicable par la version qui
-- l'a calculé.
create table if not exists public.billing_pricing_versions (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  status text not null check (status in ('draft', 'active', 'archived')),
  config jsonb not null check (jsonb_typeof(config) = 'object' and (config->>'schema_version') = '1'),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  activated_by text,
  activated_at timestamptz
);
create unique index if not exists billing_pricing_one_active on public.billing_pricing_versions ((status)) where status = 'active';
alter table public.billing_pricing_versions enable row level security;
revoke all on public.billing_pricing_versions from anon, authenticated;

-- Une version qui n'est plus un brouillon est figée : seule la transition
-- active -> archived est permise, et rien n'est jamais supprimé.
create or replace function public.coden_pricing_version_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Pricing version % is locked', old.version; end if;
    return old;
  end if;
  if old.status = 'draft' then return new; end if;
  if old.status = 'active' and new.status = 'archived'
     and new.config = old.config and new.version = old.version then
    return new;
  end if;
  raise exception 'Pricing version % is locked', old.version;
end;
$function$;
drop trigger if exists billing_pricing_versions_guard on public.billing_pricing_versions;
create trigger billing_pricing_versions_guard before update or delete on public.billing_pricing_versions
  for each row execute function public.coden_pricing_version_guard();

-- Activation atomique d'un brouillon.
create or replace function public.coden_activate_pricing_version(p_id uuid, p_actor text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  target_version integer;
begin
  select version into target_version from public.billing_pricing_versions where id = p_id and status = 'draft' for update;
  if target_version is null then raise exception 'Only a draft can be activated'; end if;
  update public.billing_pricing_versions set status = 'archived' where status = 'active';
  update public.billing_pricing_versions set status = 'active', activated_by = left(p_actor, 200), activated_at = now() where id = p_id;
  return target_version;
end;
$function$;
revoke all on function public.coden_activate_pricing_version(uuid, text) from public, anon, authenticated;
grant execute on function public.coden_activate_pricing_version(uuid, text) to service_role;

-- Version 1 : les tarifs initiaux (section 3 bis), active d'emblée.
insert into public.billing_pricing_versions (version, status, config, note, created_by, activated_by, activated_at)
select 1, 'active', '{"schema_version":1,"currency":{"base":"USD","secondary":"XAF","secondary_label":"FCFA","secondary_per_usd":600,"display_round_secondary":100},"credit":{"reference_price_usd":0.144,"max_cost_ratio":0.4,"provider_fee_rate":0.055,"rounding":0.01,"minimum":{"build":0.1,"chat":0.05,"app_ai":0.01,"connectors":0.01}},"plans":{"free":{"label":"Gratuit","monthly_usd":0,"annual_monthly_usd":null,"monthly_credits":0,"signup_credits":5,"daily_credits":0,"daily_credits_monthly_cap":null,"topup_price_usd":null,"rollover_months":0,"per_seat":false,"team_features":false,"custom":false,"public":true},"pro":{"label":"Pro","monthly_usd":20,"annual_monthly_usd":16,"monthly_credits":100,"signup_credits":0,"daily_credits":5,"daily_credits_monthly_cap":null,"topup_price_usd":0.25,"rollover_months":1,"per_seat":false,"team_features":false,"custom":false,"public":true},"pro_plus":{"label":"Pro+","monthly_usd":45,"annual_monthly_usd":36,"monthly_credits":250,"signup_credits":0,"daily_credits":5,"daily_credits_monthly_cap":null,"topup_price_usd":0.22,"rollover_months":1,"per_seat":false,"team_features":false,"custom":false,"public":true},"business":{"label":"Business","monthly_usd":40,"annual_monthly_usd":32,"monthly_credits":100,"signup_credits":0,"daily_credits":5,"daily_credits_monthly_cap":null,"topup_price_usd":0.22,"rollover_months":1,"per_seat":true,"team_features":true,"custom":false,"public":true},"enterprise":{"label":"Enterprise","monthly_usd":null,"annual_monthly_usd":null,"monthly_credits":0,"signup_credits":0,"daily_credits":0,"daily_credits_monthly_cap":null,"topup_price_usd":null,"rollover_months":0,"per_seat":true,"team_features":true,"custom":true,"public":true}},"topup":{"tiers":[50,100,250,500,1000],"validity_months":12},"monthly_grants":{"cloud":20,"app_ai":5,"rollover":false},"daily_credits_scope":"agent","indicative":{"small_edit":[0.3,0.5],"medium_feature":[1,2],"full_page":[2,3],"chat":[0.05,0.2]},"cloud":{"db_instance_month":{"small":10,"medium":30,"large":80},"small_instance_mode":"shared_schema","db_storage_gb_month":1,"file_storage_gb_month":0.5,"egress_gb":0.5,"functions_per_100k":1,"realtime_per_million":1,"warn_at_ratio":[0.1,0],"grace_hours":72},"transparency":{"default_confirm_above":5,"default_pause_above":20},"alerts":{"low_balance_credits":10,"expiring_within_days":7,"spike_factor":3}}'::jsonb, 'Tarifs initiaux (section 3 bis), décisions du 26/09/2026', 'migration', 'migration', now()
where not exists (select 1 from public.billing_pricing_versions);
