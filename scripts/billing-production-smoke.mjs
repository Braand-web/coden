/** Controlled synthetic account; no live payment, customer impersonation or extra gift. */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const env=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
const base=String(env.SUPABASE_URL).replace(/\/$/,'');
if(new URL(base).hostname!=='ftmbiocvslxctldfihcp.supabase.co')throw Error('Central Coden project required.');
const privateDir=resolve(process.env.USERPROFILE,'.codex/private/coden-billing');
await mkdir(privateDir,{recursive:true,mode:0o700});
const statePath=resolve(privateDir,'production-smoke-state.json');
const authHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'};
async function request(url,options={},label='request'){
 const response=await fetch(url,{...options,signal:AbortSignal.timeout(90000)});
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
const first=await api('/api/assistant/chat',input);
assert.equal(first.success,true);assert.ok(first.text?.trim(),'An actual model response must be delivered');
const after=await wallet();assert.equal(balance(after),state.beforeBalance-0.5,'Actual action must debit exactly 0.5');
const replay=await api('/api/assistant/chat',input);
assert.equal(replay.text,first.text);assert.equal(balance(await wallet()),balance(after),'Network replay must not debit again');
const ledger=await api('/api/billing/ledger');
const usage=(ledger.ledger || []).filter(row=>row.entry_type==='usage');
assert.equal(usage.length,1);assert.equal(Number(usage[0].amount_credits),-0.5);
const reopened=await api(`/api/projects/${state.projectId}`);
assert.equal(reopened.project?.id || reopened.id,state.projectId);
const messages=(reopened.messages || reopened.chat || []);
assert.ok(messages.some(row=>row.role==='assistant' && row.content?.includes(first.text)),'Durable response must survive a project reload');
const cloud=await api(`/api/billing/cloud-usage?projectId=${state.projectId}`);
assert.equal(cloud.enabled,false,'Unvalidated Cloud collectors must remain disabled');
const v3=await fetch('https://coden.fun/api/billing/pricing',{headers});assert.equal(v3.status,404);
const report={checkedAt:new Date().toISOString(),syntheticOnly:true,projectId:state.projectId,userId:state.userId,
 beforeCredits:state.beforeBalance,afterCredits:balance(after),chargedCredits:0.5,usageEntries:1,replayNoDoubleDebit:true,responsePersists:true,cloudCollectorsDisabled:true,v3Removed:true,livePaymentPerformed:false};
await writeFile(resolve(privateDir,`production-smoke-${Date.now()}.json`),JSON.stringify(report),{flag:'wx',mode:0o600});
console.log(JSON.stringify(report));
