/** Synthetic local fixture only: extracts real ledger DDL; never restores customer rows. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = process.argv[2];
if (!destination) throw new Error('A private output directory is required.');
const base = await readFile('supabase/migrations/20260906140000_coden_v4_control_agent_billing.sql','utf8');
const pricing = await readFile('supabase/migrations/20260926120000_billing_pricing_config.sql','utf8');
const grantMigration = await readFile('supabase/migrations/20260926130000_billing_v3_deduction_engine.sql','utf8');
const table = (source,name) => {
  const found = source.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`));
  if (!found) throw new Error(`DDL missing: ${name}`);
  return found[0];
};
const fn = (source,name) => {
  const a=source.indexOf(`create or replace function public.${name}(`);
  const b=source.indexOf('$$;',a);
  if (a<0 || b<0) throw new Error('Function missing');
  return source.slice(a,b+3);
};
let sql = `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$;
create schema auth; create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,plan text default 'free'); create table public.projects(id uuid primary key,organization_id uuid,owner_id uuid,preview_html text,preview_status text,model_id text,updated_at timestamptz default now());
create table public.project_state_snapshots(project_id uuid primary key references public.projects(id),owner_id uuid not null,organization_id uuid,revision bigint,project_snapshot jsonb,files_snapshot jsonb,preview_snapshot jsonb,updated_at timestamptz default now());
create table public.project_messages(id uuid primary key,organization_id uuid not null,project_id uuid not null,user_id uuid not null,role text,content text,intent text,requested_mode text,ai_message_id text,metadata jsonb);
create table public.billing_checkout_intents(id uuid primary key default gen_random_uuid(),account_id uuid,status text,provider_transaction_id text,provider_checkout_id text);
`;
for (const name of ['billing_accounts','credit_grants','usage_events','usage_reservations','usage_reservation_lines','usage_settlements','credit_ledger_entries','provider_webhook_events']) sql += table(base,name)+'\n';
sql += table(pricing,'billing_pricing_versions')+'\n';
sql += grantMigration.slice(grantMigration.indexOf('alter table public.credit_grants'),grantMigration.indexOf('-- 2.'))+'\n';
sql += fn(grantMigration,'coden_billing_grant')+'\n'+fn(grantMigration,'coden_ledger_immutable')+'\n';
sql += `create trigger coden_ledger_immutable before update or delete on public.credit_ledger_entries for each row execute function public.coden_ledger_immutable();
grant usage on schema public to service_role; grant all on all tables in schema public to service_role;
insert into public.billing_pricing_versions(version,status,config) values(1,'active','{"schema_version":1}');
`;
await mkdir(resolve(destination),{ recursive:true,mode:0o700 });
await writeFile(resolve(destination,'fixture.sql'),sql,{mode:0o600});
console.log('Synthetic financial fixture generated.');
