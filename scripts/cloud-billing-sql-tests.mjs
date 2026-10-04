/** All users, projects, measurements and payments in this suite are synthetic. */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const psql=process.env.CODEN_TEST_PSQL,url=process.env.CODEN_TEST_DATABASE_URL;
if (!psql || !/^postgresql:\/\/[^@]+@127\.0\.0\.1:15493\//.test(url || '')) throw new Error('Isolated local database required.');
const args=['--no-psqlrc','-v','ON_ERROR_STOP=1','-At',url];
const sql=q=>execFileSync(psql,[...args,'-c',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const parallel=q=>promisify(execFile)(psql,[...args,'-c',q]).then(r=>r.stdout.trim());
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const rejects=q=>{assert.throws(()=>sql(q));checks++;};
const ids=['66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777','88888888-8888-4888-8888-888888888888'];
for (const [i,plan] of ['free','pro','business'].entries()) {
  const id=ids[i];
  sql(`insert into auth.users(id) values('${id}'); insert into organizations(id,plan) values('${id}','${plan}');
insert into billing_accounts(id,organization_id,owner_user_id) values('${id}','${id}','${id}');
insert into projects(id,organization_id,owner_id) values('${id}','${id}','${id}');`);
}
const consume=(account,project,key,credits=0.25,collector='fixture')=>`select coden_cloud_consume_grace('${account}','${project}','${collector}','${key}',${credits});`;
const result=(...args)=>JSON.parse(sql(consume(...args)));
equal(result(ids[0],ids[0],'cloud:before-collector').reason,'collector_not_validated');
rejects(`insert into cloud_meter_collectors(collector_id,enabled,attribution_verified) values('invalid',true,true);`);
sql(`insert into cloud_meter_collectors(collector_id,enabled,attribution_verified,validation_reference) values('fixture',true,true,'local-synthetic-reference');`);
equal(result(ids[0],ids[0],'cloud:before-consent').reason,'owner_consent_required');
for (const id of ids) sql(`insert into cloud_billing_consents(project_id,account_id,tariff_version,accepted_by) values('${id}','${id}','2026-10-04.cloud-reference-v1','${id}');`);
equal(result(ids[0],ids[1],'cloud:foreign-app').reason,'owner_consent_required');
sql(`update cloud_billing_consents set accepted_by='${ids[1]}' where project_id='${ids[0]}';`);
equal(result(ids[0],ids[0],'cloud:foreign-owner').reason,'owner_consent_required');
sql(`update cloud_billing_consents set accepted_by='${ids[0]}' where project_id='${ids[0]}';`);
for (const [i,budget] of [1,5,10].entries()) {
  const id=ids[i];
  equal(result(id,id,`cloud:first-${i}`,0.25).allowed,true);
  equal(sql(`select budget_credits from cloud_billing_grace where account_id='${id}'`),`${budget}.0000000000`);
  equal(result(id,id,`cloud:first-${i}`,0.25).replayed,true);
  equal(sql(`select used_credits from cloud_billing_grace where account_id='${id}'`),'0.2500000000');
  rejects(consume(id,id,`cloud:first-${i}`,0.3));
}
rejects(consume(ids[1],ids[1],'cloud:first-0',0.25));
const concurrent=await Promise.all(Array.from({length:12},(_,i)=>parallel(consume(ids[0],ids[0],`cloud:concurrent-${i}`,0.25)).then(JSON.parse)));
equal(concurrent.filter(r=>r.allowed).length,3);
equal(sql(`select used_credits from cloud_billing_grace where account_id='${ids[0]}'`),'1.0000000000');
equal(result(ids[0],ids[0],'cloud:budget-exhausted').reason,'cloud_grace_exhausted');
equal(sql(`select count(*) from credit_ledger_entries where account_id='${ids[0]}'`),'0');
sql(`select coden_billing_grant('${ids[0]}','bonus','general',0.0000000001,0,0,now()+interval '1 year','fixture:tiny-bonus','fixture:tiny-bonus','{}');`);
equal(result(ids[0],ids[0],'cloud:bonus-not-rearm').reason,'cloud_grace_exhausted');
sql(`update cloud_billing_grace set started_at=now()-interval '73 hours' where account_id='${ids[1]}';`);
equal(result(ids[1],ids[1],'cloud:deadline-exhausted').reason,'cloud_grace_exhausted');
equal(sql(`select used_credits from cloud_billing_grace where account_id='${ids[1]}'`),'0.2500000000');
sql(`select coden_billing_grant('${ids[0]}','topup','general',1,1,0,now()+interval '1 year','saspay:fixture-tx','fixture:paid-topup','{}');`);
equal(result(ids[0],ids[0],'cloud:wallet-available').reason,'wallet_payment_required');
sql(`select coden_billing_reserve('${ids[0]}','cloud',1,0,'fixture:consume-topup',now()+interval '1 hour');`);
equal(result(ids[0],ids[0],'cloud:unverified-payment').reason,'cloud_grace_exhausted');
sql(`update cloud_billing_grace set started_at=now()-interval '1 hour' where account_id='${ids[0]}';
insert into billing_checkout_intents(account_id,status,provider_transaction_id,provider_checkout_id) values('${ids[0]}','paid','fixture-tx','fixture-checkout');`);
equal(result(ids[0],ids[0],'cloud:verified-replenishment',0.25).allowed,true);
equal(sql(`select used_credits from cloud_billing_grace where account_id='${ids[0]}'`),'0.2500000000');
equal(result(ids[0],ids[0],'cloud:next-event',0.25).allowed,true);
equal(sql(`select used_credits from cloud_billing_grace where account_id='${ids[0]}'`),'0.5000000000');
rejects(consume(ids[0],ids[0],'cloud:negative',-1));
rejects(consume(ids[0],ids[0],'cloud:NaN',"'NaN'"));
rejects(consume(ids[0],ids[0],'cloud:overprecision',0.00000000001));
for (const role of ['anon','authenticated']) {
  rejects(`set role ${role}; ${consume(ids[0],ids[0],'cloud:unauthorized')}`);
  for (const table of ['cloud_billing_consents','cloud_billing_grace','cloud_grace_usage_events','cloud_meter_collectors']) rejects(`set role ${role}; select * from ${table};`);
}
console.log(JSON.stringify({suite:'PostgreSQL Cloud consent, isolation and grace',checks,concurrencyWorkers:12,syntheticOnly:true,passed:true}));
