/** Central Coden only. Credentials arrive on stdin and never enter Git/logs. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const env=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
const ref='ftmbiocvslxctldfihcp';
if(new URL(env.SUPABASE_URL).hostname!==`${ref}.supabase.co` || !env.CODEN_SUPABASE_MGMT_TOKEN)throw Error('Central database management access required.');
const apply=process.argv.includes('--apply');
const backupPath=process.argv.find(arg=>arg.startsWith('--backup='))?.slice(9);
async function sql(query,read_only=true){
  const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${env.CODEN_SUPABASE_MGMT_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only}),signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`Database release check failed: HTTP ${response.status}`);
  return response.json();
}
const readiness=await sql(`select
 (select count(*) from public.usage_reservations where status='reserved') as open_reservations,
 (select count(*) from (select a.id,coalesce((select sum(g.credits_remaining) from public.credit_grants g where g.account_id=a.id),0)+coalesce((select sum(r.credits_reserved) from public.usage_reservations r where r.account_id=a.id and r.status='reserved'),0)-coalesce((select sum(l.amount_credits) from public.credit_ledger_entries l where l.account_id=a.id and l.entry_type in ('grant','refund','usage','freeze','expiry','expiration','adjustment')),0) delta from public.billing_accounts a) x where abs(delta)>0.0001) as unreconciled_accounts,
 (select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'nullable',is_nullable,'type',udt_name,'default',column_default)) from information_schema.columns where table_schema='public' and table_name in ('project_state_snapshots','project_messages','projects')) as delivery_schema,
 (select jsonb_agg(jsonb_build_object('table',tablename,'definition',indexdef)) from pg_indexes where schemaname='public' and tablename in ('project_state_snapshots','project_messages')) as delivery_indexes,
 (select jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_constraintdef(k.oid))) from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('project_state_snapshots','project_messages','projects')) as delivery_constraints`);
if(Number(readiness[0]?.open_reservations)!==0 || Number(readiness[0]?.unreconciled_accounts)!==0)throw Error('Cutover blocked by financial reconciliation or in-flight reservations.');
const versions=['20261003131955','20261004062311'];
const names=['canonical_billing_fixed_debits','cloud_billing_consent_and_grace'];
const done=await sql(`select version from supabase_migrations.schema_migrations where version in ('${versions.join("','")}')`);
const plan=[];
for(let i=0;i<versions.length;i++){
  const path=`supabase/migrations/${versions[i]}_${names[i]}.sql`,source=await readFile(path,'utf8');
  plan.push({version:versions[i],name:names[i],sha256:createHash('sha256').update(source).digest('hex'),alreadyApplied:done.some(row=>row.version===versions[i])});
}
if(apply){
  if(env.CODEN_PAID_OPERATIONS_PAUSED!=='1' || env.CODEN_CLOUD_MEASURED_BILLING_V1==='1')throw Error('Paid work must be paused and Cloud collectors must remain disabled.');
  if(!backupPath)throw Error('Fresh atomic financial backup is required.');
  const backup=JSON.parse(await readFile(backupPath,'utf8'));
  if(backup.projectRef!==ref || !backup.snapshot || !backup.definitions || !backup.schemaMetadata || Date.now()-Date.parse(backup.capturedAt)>3600000)throw Error('Backup is incomplete or too old.');
  const destination=resolve(process.env.USERPROFILE,'.codex/private/coden-billing',`release-${Date.now()}.json`);
  await mkdir(resolve(destination,'..'),{recursive:true,mode:0o700});
  await writeFile(destination,JSON.stringify({capturedAt:new Date().toISOString(),projectRef:ref,readiness,plan,backupPath}),{flag:'wx',mode:0o600});
  for(const migration of plan){
    if(migration.alreadyApplied)continue;
    const source=await readFile(`supabase/migrations/${migration.version}_${migration.name}.sql`,'utf8');
    if(!/^begin;/i.test(source.trimStart()) || !/commit;\s*$/i.test(source))throw Error('Atomic migration framing required.');
    const journal=`insert into supabase_migrations.schema_migrations(version,name,statements) values('${migration.version}','${migration.name}',array['sha256:${migration.sha256}']);\nnotify pgrst,'reload schema';\ncommit;`;
    await sql(source.replace(/commit;\s*$/i,journal),false);
    migration.applied=true;
  }
  console.log(JSON.stringify({applied:true,projectRef:ref,releaseEvidencePath:destination,plan}));
}else console.log(JSON.stringify({readOnly:true,projectRef:ref,openReservations:0,unreconciledAccounts:0,deliverySchemaVerified:readiness[0]?.delivery_schema?.length>0,plan}));
