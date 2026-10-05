/** Controlled synthetic account; no live payment, customer impersonation or extra gift. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const env=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
const base=String(env.SUPABASE_URL).replace(/\/$/,'');
if(new URL(base).hostname!=='ftmbiocvslxctldfihcp.supabase.co')throw Error('Central Coden project required.');
const privateDir=resolve(process.env.USERPROFILE,'.codex/private/coden-billing');
await mkdir(privateDir,{recursive:true,mode:0o700});
const statePath=resolve(privateDir,'production-smoke-state.json');
const authHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function httpResponse(url,options={}){
 if(process.env.CODEN_RELEASE_TEST_CURL!=='1')return fetch(url,{...options,signal:AbortSignal.timeout(90000)});
 // Windows diagnostic transport only. Credentials use stdin, never argv/files/logs.
 if(new URL(url).protocol!=='https:' || !['coden.fun','ftmbiocvslxctldfihcp.supabase.co'].includes(new URL(url).hostname))throw Error('Unexpected test destination');
 const config=[`url = ${JSON.stringify(url)}`,`request = ${JSON.stringify(options.method || 'GET')}`,
  ...Object.entries(options.headers || {}).map(([name,value])=>`header = ${JSON.stringify(`${name}: ${value}`)}`),
  ...(options.body?[`data = ${JSON.stringify(options.body)}`]:[])].join('\n');
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(resolveCurl(),['--config','-','--silent','--connect-timeout','15','--max-time','90','--write-out','\n%{http_code}'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let body='';child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{body+=chunk;});child.stderr.resume();
  child.on('error',()=>reject(Error('Test HTTP client could not start')));
  child.on('close',code=>code===0?resolve(body):reject(Error(`Test HTTP transport failed (${code})`)));
  child.stdin.on('error',()=>{});child.stdin.end(config+'\n');
 });
 const split=output.lastIndexOf('\n'),status=Number(output.slice(split+1)),body=output.slice(0,split);
 return {ok:status>=200&&status<300,status,json:async()=>JSON.parse(body || 'null')};
}
function resolveCurl(){return resolve(process.env.SystemRoot || 'C:/Windows','System32/curl.exe');}
async function request(url,options={},label='request'){
 const response=await httpResponse(url,options);
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(`${label}: HTTP ${response.status}, ${String(data?.diagnostic_code || 'no diagnostic')}`);
 return data;
}
let state;
try{state=JSON.parse(await readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!state){
 const email=`coden-billing-smoke-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');
 const user=await request(`${base}/auth/v1/admin/users`,{method:'POST',headers:authHeaders,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{name:'Coden billing validation',controlled_test:true}})},'Synthetic account');
 state={userId:user.id,email,password,clientMessageId:`billing-smoke-${randomUUID()}`,assistantMessageId:`billing-answer-${randomUUID()}`};
 await writeFile(statePath,JSON.stringify(state),{flag:'wx',mode:0o600});
}
const session=await request(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers:authHeaders,body:JSON.stringify({email:state.email,password:state.password})},'Synthetic session');
const headers={Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json',Origin:'https://coden.fun'};
const api=(path,body)=>request(`https://coden.fun${path}`,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})},path);
const rpc=(name,body)=>request(`${base}/rest/v1/rpc/${name}`,{method:'POST',headers:authHeaders,body:JSON.stringify(body)},name);
if(process.argv.includes('--inspect')){
 const reservations=await request(`${base}/rest/v1/usage_reservations?select=id,status,credits_reserved,idempotency_key&account_id=eq.${state.userId}`,{headers:authHeaders},'Synthetic reservations');
 const ledger=await api('/api/billing/ledger');
 if(process.argv.includes('--recover-cancellation')){
  for(const row of reservations.filter(r=>r.status==='reserved' && /^smoke-cancel:[0-9a-f-]{36}$/.test(r.idempotency_key) && Number(r.credits_reserved)===0.9)){
   await rpc('coden_billing_release',{p_reservation_id:row.id,p_reason:'Recover controlled pre-delivery test cancellation after transport interruption'});
  }
 }
 console.log(JSON.stringify({syntheticOnly:true,reservations:reservations.map(r=>({status:r.status,credits:Number(r.credits_reserved),controlledCancellation:r.idempotency_key.startsWith('smoke-cancel:')})),
  usage:(ledger.ledger || []).filter(r=>r.entry_type==='usage').map(r=>Number(r.amount_credits)),cancellationRecoveryRequested:process.argv.includes('--recover-cancellation')}));
 process.exit(0);
}
// A interrupted test may have reserved its cancellation credit before losing
// the HTTP response. Reconcile only that persisted test nonce before replays.
if(state.cancellationKey && !state.cancellationRefundVerified){
 const rows=await request(`${base}/rest/v1/usage_reservations?select=id,status,credits_reserved&account_id=eq.${state.userId}&idempotency_key=eq.${state.cancellationKey}`,{headers:authHeaders},'Interrupted controlled cancellation');
 if(rows[0]){
  assert.equal(Number(rows[0].credits_reserved),0.9);
  assert.ok(['reserved','released'].includes(rows[0].status),'A delivered action is never recovered as a cancellation');
  await rpc('coden_billing_release',{p_reservation_id:rows[0].id,p_reason:'Resume controlled test cancellation after transport interruption'});
  await rpc('coden_billing_release',{p_reservation_id:rows[0].id,p_reason:'Resume controlled test cancellation after transport interruption'});
  state.cancellationRefundVerified=true;await writeFile(statePath,JSON.stringify(state),{mode:0o600});
 }
}
if(!state.projectId){
 const created=await api('/api/projects',{name:'Billing validation',prompt:'',modelId:'auto'});
 state.projectId=created.project?.id || created.id;
 assert.ok(state.projectId,'Project creation must return an ID');
 await writeFile(statePath,JSON.stringify(state),{mode:0o600});
}
const wallet=()=>api('/api/billing/wallet');
const balance=row=>Number(row.balance ?? row.wallet?.balance ?? row.wallet?.credits);
const before=await wallet();
assert.ok(Number.isFinite(balance(before)) && balance(before)!==Number.MAX_SAFE_INTEGER,'Synthetic account must not have test-credit exemption');
if(state.beforeBalance===undefined){state.beforeBalance=balance(before);assert.equal(state.beforeBalance,5);await writeFile(statePath,JSON.stringify(state),{mode:0o600});}
const input={prompt:'Bonjour, réponds brièvement en français.',projectId:state.projectId,modelId:'auto',requestedMode:'auto',effort:'auto',clientMessageId:state.clientMessageId,assistantMessageId:state.assistantMessageId};
if(process.argv.includes('--expect-paused')){
 const response=await httpResponse('https://coden.fun/api/assistant/chat',{method:'POST',headers,body:JSON.stringify(input)});
 const body=await response.json();
 assert.equal(response.status,503,'Authenticated paid work must be paused during cutover');
 assert.equal(body.diagnostic_code,'PAID_OPERATIONS_PAUSED');
 assert.equal(balance(await wallet()),balance(before),'Maintenance must not reserve or debit credits');
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),syntheticOnly:true,paidWorkPaused:true,balanceUnchanged:true}));
 process.exit(0);
}
const first=await api('/api/assistant/chat',input);
assert.equal(first.success,true);assert.ok(first.text?.trim(),'An actual model response must be delivered');
const after=await wallet();assert.equal(balance(after),state.beforeBalance-0.5,'Actual action must debit exactly 0.5');
const replay=await api('/api/assistant/chat',input);
assert.equal(replay.text,first.text);assert.equal(balance(await wallet()),balance(after),'Network replay must not debit again');
const ledger=await api('/api/billing/ledger');
const usage=(ledger.ledger || []).filter(row=>row.entry_type==='usage');
assert.equal(usage.length,1);assert.equal(Number(usage[0].amount_credits),-0.5);
if(!state.cancellationRefundVerified){
 if(!state.cancellationKey){state.cancellationKey=`smoke-cancel:${randomUUID()}`;state.cancellationExpiresAt=new Date(Date.now()+3600000).toISOString();await writeFile(statePath,JSON.stringify(state),{mode:0o600});}
 const held=await rpc('coden_billing_reserve',{p_account_id:state.userId,p_category:'build',p_credits:0.9,p_estimated_cogs_usd:0,p_idempotency_key:state.cancellationKey,p_expires_at:state.cancellationExpiresAt});
 const reservation=await request(`${base}/rest/v1/usage_reservations?select=status&account_id=eq.${state.userId}&id=eq.${held}`,{headers:authHeaders},'Controlled cancellation state');
 if(reservation[0]?.status==='reserved')assert.equal(balance(await wallet()),balance(after)-0.9);
 else assert.equal(reservation[0]?.status,'released','Only the same cancellation may be resumed');
 await rpc('coden_billing_release',{p_reservation_id:held,p_reason:'Controlled pre-delivery cancellation validation'});
 await rpc('coden_billing_release',{p_reservation_id:held,p_reason:'Controlled pre-delivery cancellation validation'});
 assert.equal(balance(await wallet()),balance(after),'Cancellation release must restore the same eligible balance once');
 state.cancellationRefundVerified=true;await writeFile(statePath,JSON.stringify(state),{mode:0o600});
}
const reopened=await api(`/api/projects/${state.projectId}`);
assert.equal(reopened.project?.id || reopened.id,state.projectId);
const messages=(reopened.messages || reopened.chat || []);
assert.ok(messages.some(row=>row.role==='assistant' && row.content?.includes(first.text)),'Durable response must survive a project reload');
const cloud=await api(`/api/billing/cloud-usage?projectId=${state.projectId}`);
assert.equal(cloud.enabled,false,'Unvalidated Cloud collectors must remain disabled');
const v3=await httpResponse('https://coden.fun/api/billing/pricing',{headers});assert.equal(v3.status,404);
const report={checkedAt:new Date().toISOString(),syntheticOnly:true,projectId:state.projectId,userId:state.userId,
 beforeCredits:state.beforeBalance,afterCredits:balance(after),chargedCredits:0.5,usageEntries:1,replayNoDoubleDebit:true,cancellationRefundVerified:true,responsePersists:true,cloudCollectorsDisabled:true,v3Removed:true,livePaymentPerformed:false};
await writeFile(resolve(privateDir,`production-smoke-${Date.now()}.json`),JSON.stringify(report),{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
