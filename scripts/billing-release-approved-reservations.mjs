/** Operator tool: only explicitly approved orphan IDs, after an atomic backup. */
import { readFile } from 'node:fs/promises';
const input=[];for await(const part of process.stdin) input.push(part);
const env=JSON.parse(Buffer.concat(input).toString('utf8').replace(/^\uFEFF/,''));
const [backupPath,...ids]=process.argv.slice(2);
if(!backupPath || !ids.length || ids.length>10 || ids.some(id=>!/^[-a-f0-9]{36}$/.test(id))) throw Error('An atomic backup and explicitly approved reservation IDs are required.');
const backup=JSON.parse(await readFile(backupPath,'utf8'));
if(backup.projectRef!=='ftmbiocvslxctldfihcp' || !backup.snapshot || Date.now()-Date.parse(backup.capturedAt)>3600000) throw Error('Fresh central Coden financial backup required.');
if(new URL(env.SUPABASE_URL).hostname!=='ftmbiocvslxctldfihcp.supabase.co') throw Error('Wrong database.');
for(const id of ids){
  const r=backup.tables.usage_reservations.find(row=>row.id===id);
  if(!r || Number(r.credits_reserved)!==1 || !['reserved','released'].includes(r.status)
    || Date.parse(r.expires_at)>=Date.now() || backup.tables.usage_settlements.some(row=>row.reservation_id===id)) throw Error('Reservation is not an approved stale orphan.');
}
const query=`begin;
do $$ declare r public.usage_reservations%rowtype; before_expiry jsonb; after_expiry jsonb;
begin
for r in select * from public.usage_reservations where id in (${ids.map(id=>`'${id}'::uuid`).join(',')}) order by account_id,id loop
  if r.status='released' then continue; end if;
  if r.status<>'reserved' or r.credits_reserved<>1 or r.expires_at>=now()
    or exists(select 1 from public.usage_settlements where reservation_id=r.id) then raise exception 'Orphan state changed; abort release'; end if;
  select jsonb_object_agg(g.id::text,g.expires_at) into before_expiry from public.credit_grants g
    join public.usage_reservation_lines l on l.grant_id=g.id where l.reservation_id=r.id;
  perform public.coden_billing_release(r.id,'Owner-approved stale orphan release; no retroactive billing');
  select jsonb_object_agg(g.id::text,g.expires_at) into after_expiry from public.credit_grants g
    join public.usage_reservation_lines l on l.grant_id=g.id where l.reservation_id=r.id;
  if before_expiry is distinct from after_expiry then raise exception 'Credit expiry changed; rollback'; end if;
end loop; end; $$;
commit;`;
const response=await fetch('https://api.supabase.com/v1/projects/ftmbiocvslxctldfihcp/database/query',{
  method:'POST',headers:{Authorization:`Bearer ${env.CODEN_SUPABASE_MGMT_TOKEN}`,'Content-Type':'application/json'},
  body:JSON.stringify({query,read_only:false}),signal:AbortSignal.timeout(30000)});
if(!response.ok) throw Error(`Approved release failed (HTTP ${response.status}); no secret response printed.`);
console.log(JSON.stringify({approvedReservations:ids.length,idempotentRelease:true,expiryPreserved:true}));
