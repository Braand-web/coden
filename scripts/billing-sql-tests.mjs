import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const psql=process.env.CODEN_TEST_PSQL;
const url=process.env.CODEN_TEST_DATABASE_URL;
if (!psql || !url || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:15493\//.test(url)) throw new Error('An isolated local financial database on port 15493 is required.');
const args=['--no-psqlrc','-v','ON_ERROR_STOP=1','-At',url];
const sql=q=>execFileSync(psql,[...args,'-c',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const asyncSql=async q=>(await promisify(execFile)(psql,[...args,'-c',q])).stdout.trim();
let checks=0;
const check=(actual,expected)=>{assert.equal(actual,expected); checks++;};
const rejects=q=>{assert.throws(()=>sql(q)); checks++;};
const account='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
check(sql("select pronargdefaults from pg_proc where oid='public.coden_billing_release(uuid,text)'::regprocedure"),'1');
sql(`insert into auth.users(id) values('${account}'),('${other}'); insert into organizations(id) values('${account}'),('${other}');
insert into billing_accounts(id,organization_id,owner_user_id) values('${account}','${account}','${account}'),('${other}','${other}','${other}');`);
sql(`select coden_billing_grant('${account}','topup','general',20,5,0.01,now()+interval '1 year','fixture:grant','fixture:grant','{}');`);
const reserve=(key,credits=0.5,owner=account)=>`select coden_billing_reserve('${owner}','ai_gateway',${credits},99999,'${key}',now()+interval '1 hour');`;
const copies=await Promise.all(Array.from({length:10},()=>asyncSql(reserve('concurrent:same-action'))));
check(new Set(copies).size,1);
check(sql(`select credits_remaining from credit_grants where account_id='${account}'`),'19.5000000000');
const id=copies[0];
rejects(reserve('concurrent:same-action',0.9));
rejects(reserve('concurrent:same-action',0.5,other));
rejects(reserve('insufficient:action',99));
check(sql(`select credits_remaining from credit_grants where account_id='${account}'`),'19.5000000000');
const event=sql(`insert into usage_events(account_id,category,resource,provider,unit,idempotency_key) values('${account}','ai_gateway','conversation','fixture','action','fixture:event') returning id;`).split(/\r?\n/)[0].trim();
const wrong=sql(`insert into usage_events(account_id,category,resource,provider,unit,idempotency_key) values('${other}','ai_gateway','conversation','fixture','action','fixture:other-event') returning id;`).split(/\r?\n/)[0].trim();
rejects(`select coden_billing_settle('${id}','${wrong}',0.5,0.2,999);`);
const settle=`select coden_billing_settle('${id}','${event}',0.5,0.2,999);`;
const results=await Promise.all(Array.from({length:8},()=>asyncSql(settle)));
check(new Set(results).size,1);
check(sql(`select count(*) from credit_ledger_entries where entry_type='usage'`),'1');
check(sql(`select realized_revenue_usd from usage_settlements where reservation_id='${id}'`),'0.1250000000');
rejects(`select coden_billing_settle('${id}','${event}',0.9,0.2,999);`);
const refund=sql(reserve('cancelled:action',1.7));
sql(`select coden_billing_release('${refund}','cancelled'); select coden_billing_release('${refund}','cancelled');`);
check(sql(`select credits_remaining from credit_grants where account_id='${account}'`),'19.5000000000');
rejects(reserve('cancelled:action',1.7));
const micro=sql(reserve('cloud:micro-event',0.0000036));
check(sql(`select credits_reserved from usage_reservations where id='${micro}'`),'0.0000036000');
sql(`select coden_billing_release('${micro}','fixture');`);
for (const role of ['anon','authenticated']) {
  rejects(`set role ${role}; ${reserve('unauthorized:action')}`);
  rejects(`set role ${role}; select * from billing_settlement_outbox;`);
  rejects(`set role ${role}; select * from billing_action_requests;`);
}
rejects(`update credit_ledger_entries set amount_credits=999 where entry_type='usage';`);
rejects(`set role service_role; select coden_activate_pricing_version((select id from billing_pricing_versions limit 1),'fixture');`);
rejects(`insert into billing_pricing_versions(version,status,config) values(2,'active','{"schema_version":1}');`);
const claims=await Promise.all(Array.from({length:8},()=>asyncSql(`select coden_billing_claim_action(repeat('a',64),'${account}',repeat('b',64));`)));
check(claims.filter(r=>JSON.parse(r).claimed).length,1);
rejects(`select coden_billing_claim_action(repeat('a',64),'${other}',repeat('b',64));`);
const delivered=sql(reserve('delivered:pending',0.9));
const deliveredEvent=sql(`insert into usage_events(account_id,category,resource,provider,unit,idempotency_key) values('${account}','ai_gateway','conversation','fixture','action','fixture:delivered-event') returning id;`).split(/\r?\n/)[0].trim();
rejects(`select coden_billing_settle('${delivered}','${event}',0.9,0.001,0);`);
sql(`insert into billing_settlement_outbox(reservation_id,usage_event_id,credits_charged,complete_cost_usd) values('${delivered}','${deliveredEvent}',0.9,0.001);`);
rejects(`select coden_billing_release('${delivered}','bad refund');`);
sql(`select coden_billing_settle('${delivered}','${deliveredEvent}',0.9,0.001,0);`);
check(sql(`select status from billing_settlement_outbox where reservation_id='${delivered}'`),'settled');
const gift=key=>`select coden_billing_grant('${other}','signup_free','general',5,0,1,now()+interval '1 year','${key}','${key}','{}');`;
const gifts=await Promise.all(Array.from({length:8},(_,index)=>asyncSql(gift(`signup:legacy-${index}`))));
check(new Set(gifts).size,1);
check(sql(`select sum(credits_issued) from credit_grants where account_id='${other}'`),'5.0000000000');
const giftRow=sql(`select source_reference from credit_grants where id='${gifts[0]}'`);
check(sql(`select coden_billing_grant('${other}','signup_free','general',5,0,1,now()-interval '1 day','${giftRow}','${giftRow}','{}');`),gifts[0]);
rejects(`select coden_billing_grant('${account}','topup','general',20,5,0.01,now()+interval '1 year','${giftRow}','${giftRow}','{}');`);
rejects(reserve('invalid:nan','\x27NaN\x27'));
const recovery=sql(reserve('delivered:event-failed',0.5));
sql(`insert into billing_delivery_checkpoints(reservation_id,account_id,usage_payload,credits_charged,complete_cost_usd)
values('${recovery}','${account}','{"account_id":"${account}","category":"ai_gateway","idempotency_key":"delivered:recovery-event"}',0.5,0.001);`);
rejects(`select coden_billing_release('${recovery}','must not refund delivered output');`);
for (const role of ['anon','authenticated']) rejects(`set role ${role}; select * from billing_delivery_checkpoints;`);
const guarded=sql(reserve('guarded:delivery',0.5));
rejects(`insert into billing_delivery_checkpoints(reservation_id,account_id,usage_payload,credits_charged,complete_cost_usd)
values('${guarded}','${other}','{"account_id":"${other}","category":"ai_gateway","idempotency_key":"guard:foreign-account"}',0.5,0.001);`);
rejects(`insert into billing_delivery_checkpoints(reservation_id,account_id,usage_payload,credits_charged,complete_cost_usd)
values('${guarded}','${account}','{"account_id":"${account}","category":"build","idempotency_key":"guard:foreign-category"}',0.5,0.001);`);
rejects(`insert into billing_settlement_outbox(reservation_id,usage_event_id,credits_charged,complete_cost_usd)
values('${guarded}','${wrong}',0.5,0.001);`);
rejects(`insert into billing_settlement_outbox(reservation_id,usage_event_id,credits_charged,complete_cost_usd)
values('${guarded}','${event}',0.9,0.001);`);
sql(`select coden_billing_release('${guarded}','fixture');`);
const atomicId='c'.repeat(64),atomicReservation=sql(reserve('atomic:delivered',0.5));
sql(`select coden_billing_claim_action('${atomicId}','${account}',repeat('d',64));`);
const complete=price=>`select coden_billing_complete_action('${atomicId}','${account}','{"text":"durable fixture"}','${atomicReservation}',
'{"account_id":"${account}","category":"ai_gateway","idempotency_key":"atomic:usage"}',${price},0.001);`;
rejects(complete(0.9));
check(sql(`select state from billing_action_requests where id='${atomicId}'`),'processing');
check(sql(`select count(*) from billing_delivery_checkpoints where reservation_id='${atomicReservation}'`),'0');
await Promise.all(Array.from({length:8},()=>asyncSql(complete(0.5))));
check(sql(`select state from billing_action_requests where id='${atomicId}'`),'delivered');
check(sql(`select count(*) from billing_delivery_checkpoints where reservation_id='${atomicReservation}'`),'1');
rejects(complete(0.5).replace('durable fixture','different result'));
rejects(`select coden_billing_release('${atomicReservation}','delivered work');`);
rejects(`set role service_role; delete from billing_delivery_checkpoints where reservation_id='${atomicReservation}';`);
rejects(`set role service_role; update billing_settlement_outbox set credits_charged=999;`);
rejects(`set role service_role; update billing_action_requests set account_id='${other}';`);
for (const role of ['anon','authenticated']) rejects(`set role ${role}; ${complete(0.5)}`);
const app= '33333333-3333-4333-8333-333333333333',foreignApp='44444444-4444-4444-8444-444444444444';
sql(`insert into projects(id,owner_id,organization_id) values('${app}','${account}','${account}'),('${foreignApp}','${other}','${other}');`);
const deliveryId='e'.repeat(64),deliveryReserve=sql(reserve('atomic:app-snapshot',0.9));
sql(`select coden_billing_claim_action('${deliveryId}','${account}',repeat('f',64));`);
const delivery={project_id:app,actor_id:account,project:{id:app,preview_html:'<p>Fixture</p>',preview_status:'verified'},
  files:[{path:'src/App.tsx',content:'export default function App(){return null}'}],message:{content:'Fixture delivered.'}};
const deliverApp=d=>`select coden_billing_complete_action('${deliveryId}','${account}','{"success":true}','${deliveryReserve}',
'{"account_id":"${account}","category":"ai_gateway","project_id":"${app}","idempotency_key":"atomic:app-event"}',0.9,0.001,'${JSON.stringify(d)}');`;
rejects(deliverApp({...delivery,project_id:foreignApp,project:{...delivery.project,id:foreignApp}}));
check(sql(`select state from billing_action_requests where id='${deliveryId}'`),'processing');
check(sql(`select count(*) from billing_delivery_checkpoints where reservation_id='${deliveryReserve}'`),'0');
check(sql(`select count(*) from project_messages where project_id='${app}'`),'0');
await Promise.all(Array.from({length:8},()=>asyncSql(deliverApp(delivery))));
check(sql(`select state from billing_action_requests where id='${deliveryId}'`),'delivered');
check(sql(`select billing_delivery_action_id from project_state_snapshots where project_id='${app}'`),deliveryId);
check(sql(`select jsonb_array_length(files_snapshot) from project_state_snapshots where project_id='${app}'`),'1');
check(sql(`select preview_html from projects where id='${app}'`),'<p>Fixture</p>');
check(sql(`select count(*) from project_messages where project_id='${app}'`),'1');
rejects(`select coden_billing_release('${deliveryReserve}','must retain delivered app');`);
for(const [index,plan] of ['free','pro','business'].entries()){
  const owner=`55555555-5555-4555-8555-55555555555${index}`;
  sql(`insert into auth.users(id) values('${owner}');insert into organizations(id,plan) values('${owner}','${plan}');
    insert into billing_accounts(id,organization_id,owner_user_id) values('${owner}','${owner}','${owner}');
    select coden_billing_grant('${owner}','bonus','general',20,0,0,now()+interval '1 year','test:${plan}:funds','test:${plan}:funds','{}');`);
  for(const [index,price] of [0.5,0.5,0.9,1,1.2,1.7].entries()){
    const key=`test:${plan}:action-${index}`,reservation=sql(reserve(key,price,owner));
    const event=sql(`insert into usage_events(account_id,category,resource,provider,unit,idempotency_key)
      values('${owner}','ai_gateway','fixture','fixture','action','${key}:usage') returning id;`).split(/\r?\n/)[0];
    sql(`select coden_billing_settle('${reservation}','${event}',${price},0.001,0);`);
    check(sql(`select credits_charged from usage_settlements where reservation_id='${reservation}'`),price.toFixed(10));
    sql(`select coden_billing_settle('${reservation}','${event}',${price},0.001,0);`);
    check(sql(`select count(*) from credit_ledger_entries where reservation_id='${reservation}' and entry_type='usage'`),'1');
  }
  check(sql(`select sum(credits_remaining) from credit_grants where account_id='${owner}'`),'14.2000000000');
}
console.log(JSON.stringify({suite:'PostgreSQL financial integration',checks,concurrencyWorkers:10,syntheticOnly:true,passed:true}));
