import { describe, expect, it, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizeProviderObservation, pseudonymizeCostId, CostObservationWriter, configureCostObservationWriter, observeProviderCost } from './cost-observability';
import { costObservationSummary } from './cost-observation-summary';
import { marginScenario, invoiceReconciliation } from './cost-economics';
import { evaluateOptimization, observeCostCeiling, type BenchmarkRow } from './cost-optimization-gate';
import { modelPriceSnapshot } from './model-price-history';
import { catalogChanges } from './model-price-sync';
import { validateCostBenchmarkManifest, validateCostBenchmarkPolicy, evaluateCostBenchmarkManifests } from './cost-benchmark-manifest';
import { OpenRouterService } from './openrouter-service';
import { OpenRouterCapabilities } from './openrouter-capabilities';
import { renderCostObservations } from '../admin-cost-observations';
import { ROUTING_MODES } from '../lib/routing-mode';
import { selectModel } from './model-selection';
import { DEFAULT_PROVIDER_MODEL_ID, AI_MODEL_PLAN_ACCESS, isPlanAtLeast } from '../config/ai-models';
import { REASONING_LEVELS, buildOpenRouterRequest } from './openrouter-request';

const observation=()=>normalizeProviderObservation({requestedModel:'openai/gpt-6-luna',result:'succeeded',latencyMs:10,usage:{prompt_tokens:1000,completion_tokens:200,completion_tokens_details:{reasoning_tokens:50},prompt_tokens_details:{cached_tokens:600},cost:.001}}, {actorId:'private-user',projectId:'private-project',mode:'balanced',plan:'pro',selection:'explicit'},'test-secret');
afterEach(()=>{ delete process.env.CODEN_COST_OBSERVABILITY_V1; delete process.env.CODEN_SECRETS_KEY; vi.unstubAllGlobals(); });
describe('private cost observations',()=>{
  it('keeps the admin panel invisible when disabled and shows unknown cache honestly',()=>{
    expect(renderCostObservations({enabled:false})).toBe('');
    const html=renderCostObservations({success:true,enabled:true,policyVersion:'v1',summary:{measuredCostCalls:1,estimatedCostCalls:0,unknownCostCalls:1,missingAttribution:2,byMode:[{mode:'economy',calls:2,unknownCosts:1,cacheReadRate:null}]},coverage:{complete:false},writer:{dropped:2}});
    expect(html).toContain('Économique');expect(html).toContain('Non mesuré');expect(html).toContain('incomplète');expect(html).not.toContain('<select');
  });
  it('pseudonymizes identifiers and never records a prompt or arbitrary metadata',()=>{
    const row=normalizeProviderObservation({requestedModel:'openai/gpt-6-luna',result:'failed',latencyMs:1,metadata:{task:'planning',prompt:'DO NOT RECORD',email:'secret@example.test',prompt_version:'v1'}}, {actorId:'private-user'},'test-secret');
    expect(JSON.stringify(row)).not.toMatch(/private-user|DO NOT RECORD|secret@example/);
    expect(row.actor_key).toHaveLength(64); expect(row.stage).toBe('planning');
    expect(pseudonymizeCostId('private-user','other-secret')).not.toBe(row.actor_key);
  });
  it('reasoning is a subset of output and reported zero cost is a real measurement',()=>{
    expect(observation()).toMatchObject({output_tokens:200,reasoning_tokens:50,cached_read_tokens:600,cost_source:'gateway'});
    const row=normalizeProviderObservation({requestedModel:'x/model',result:'succeeded',latencyMs:0,usage:{cost:0},estimatedCostUsd:2},{},'secret');
    expect(row.cost_usd).toBe(0); expect(row.cost_source).toBe('gateway');
  });
  it('unknown usage and price remain null, not a fake free inference',()=>{
    const row=normalizeProviderObservation({requestedModel:'x/model',result:'cancelled',latencyMs:0},{},'secret');
    expect(row).toMatchObject({cost_source:'unknown',cost_usd:null,reasoning_tokens:null,cached_read_tokens:null,plan:null});
  });
  it('rejects boolean amounts and arbitrary prompt version text',()=>{
    const row=normalizeProviderObservation({requestedModel:'x/model',result:'failed',latencyMs:0,usage:{cost:true,prompt_tokens:false},metadata:{prompt_version:'private-user'}},{},'secret');
    expect(row).toMatchObject({cost_usd:null,input_tokens:null,prompt_version:null});
    expect(normalizeProviderObservation({requestedModel:'x/model',result:'succeeded',latencyMs:0,metadata:{prompt_version:'coden-agent-prompt-stack-v28'}},{},'secret').prompt_version).toBe('coden-agent-prompt-stack-v28');
  });
  it('bounds retries, preserves idempotency, exposes dropped observations',async()=>{
    const keys:string[]=[];let attempts=0;
    const writer=new CostObservationWriter(async rows=>{attempts++;keys.push(rows[0].event_key);throw new Error('private failure');},1);
    writer.enqueue(observation());writer.enqueue(observation());await writer.flush();
    expect(attempts).toBe(3);expect(new Set(keys).size).toBe(1);expect(writer.snapshot()).toMatchObject({dropped:2,failures:3,pending:0});
  });
  it('writing runs asynchronously; enabling requires a flag and the server-only salt',async()=>{
    const seen:any[]=[];configureCostObservationWriter(async rows=>{seen.push(...rows);});
    observeProviderCost({requestedModel:'x/model',result:'succeeded',latencyMs:0});
    await new Promise(r=>setImmediate(r));expect(seen).toHaveLength(0);
    process.env.CODEN_COST_OBSERVABILITY_V1='1';process.env.CODEN_SECRETS_KEY='server-only';
    observeProviderCost({requestedModel:'x/model',result:'succeeded',latencyMs:0});expect(seen).toHaveLength(0);
    await new Promise(r=>setImmediate(r));expect(seen).toHaveLength(1);
  });
  it('cache rate uses only calls with an actual cache measurement',()=>{
    const known=observation(),unknown={...observation(),input_tokens:10000,cached_read_tokens:null,cost_usd:null,cost_source:'unknown' as const};
    const result=costObservationSummary([known,unknown]);expect(result.byMode[0].cacheReadRate).toBe(.6);expect(result.unknownCostCalls).toBe(1);expect(result.costPerSuccessfulTask).toBeNull();
  });
  it('excludes missing denominators and impossible cache counts instead of inventing a rate',()=>{
    const missing={...observation(),input_tokens:null};
    const invalid={...observation(),cached_read_tokens:1001};
    const result=costObservationSummary([observation(),missing,invalid]);
    expect(result.byMode[0]).toMatchObject({cacheReadRate:.6,cacheMeasuredCalls:1,incompleteCacheCalls:1,invalidCacheCalls:1});
    expect(costObservationSummary([missing]).byMode[0].cacheReadRate).toBeNull();
  });
  it('price history is content-addressed and excludes provider input text',()=>{
    const base={id:'x/model',context_length:1000,supported_parameters:[],pricing:{prompt:'0.001',completion:'0.002'}};
    expect(modelPriceSnapshot(base)?.signature).toBe(modelPriceSnapshot({...base})?.signature);
    expect(modelPriceSnapshot({...base,pricing:{prompt:'0.002'}})?.signature).not.toBe(modelPriceSnapshot(base)?.signature);
    expect(modelPriceSnapshot({...base,pricing:undefined})).toBeNull();
  });
  it('reuses the dated catalogue for reversals and conditions, excluding arbitrary content',()=>{
    let current:any[]=[]; const rows:any[]=[];
    const model={id:'x/model',context_length:1000,supported_parameters:[],pricing:{prompt:'0.001'}};
    for (const prompt of ['0.001','0.002','0.001']) {
      const changes=catalogChanges(current,[{id:model.id,inputUsdPerMillion:Number(prompt)*1e6,outputUsdPerMillion:1,catalogPricing:{prompt}}],new Date());
      const added=changes.inserts.map((row,i)=>({...row,id:String(rows.length+i)}));
      rows.push(...added);current=[...current.map(row=>changes.closeIds.includes(row.id)?{...row,effective_until:'closed'}:row),...added];
    }
    expect(rows).toHaveLength(6);expect(rows[0].metadata.price_snapshot_signature).toBe(rows[4].metadata.price_snapshot_signature);
    expect(catalogChanges(current,[{id:model.id,inputUsdPerMillion:1000,outputUsdPerMillion:1,catalogPricing:{prompt:'0.001'}}],new Date()).inserts).toHaveLength(0);
    const special=modelPriceSnapshot({...model,pricing:{prompt:'0.001',overrides:[{min_prompt_tokens:272000,prompt:'0.002',private_text:'do not store'}]} as any});
    expect(special?.pricing.overrides).toEqual([{min_prompt_tokens:272000,prompt:'0.002',unsupported_condition:true}]);
    expect(JSON.stringify(special)).not.toContain('do not store');
  });
  it('does not convert malformed provider cost into a measured amount', async()=>{
    const observed:any[]=[];
    configureCostObservationWriter(async rows=>{observed.push(...rows);});
    process.env.CODEN_COST_OBSERVABILITY_V1='1';process.env.CODEN_SECRETS_KEY='test';
    const capabilities=new OpenRouterCapabilities(async()=>new Response(JSON.stringify({data:[{id:DEFAULT_PROVIDER_MODEL_ID,context_length:200000,supported_parameters:[],top_provider:{max_completion_tokens:32000}}]})));
    vi.stubGlobal('fetch',async()=>new Response(`data: ${JSON.stringify({model:DEFAULT_PROVIDER_MODEL_ID,choices:[{delta:{content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:20,cost:true}})}\n\ndata: [DONE]\n\n`));
    const client=new OpenRouterService({apiKey:'test'} as any,capabilities);
    for await(const _part of client.streamChat(DEFAULT_PROVIDER_MODEL_ID,[{role:'user',content:'test'}],1000)) { /* consume */ }
    await new Promise(r=>setImmediate(r));
    expect(observed).toHaveLength(1);expect(observed[0].cost_source).not.toBe('gateway');expect(observed[0].cost_usd).not.toBe(1);
  });
  it('observes actual SSE cost/cache without changing a pinned model or request payload', async()=>{
    const captured:any[]=[]; const observed:any[]=[];
    configureCostObservationWriter(async rows=>{observed.push(...rows);});
    const capabilities=new OpenRouterCapabilities(async()=>new Response(JSON.stringify({data:[{id:DEFAULT_PROVIDER_MODEL_ID,context_length:200000,supported_parameters:['reasoning'],top_provider:{max_completion_tokens:32000}}]})));
    vi.stubGlobal('fetch', async (_url:any, init:any)=>{
      captured.push(JSON.parse(init.body));
      return new Response(`data: ${JSON.stringify({model:DEFAULT_PROVIDER_MODEL_ID,provider:'test-provider',choices:[{delta:{content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:20,prompt_tokens_details:{cached_tokens:80},completion_tokens_details:{reasoning_tokens:5},cost:.002}})}\n\ndata: [DONE]\n\n`);
    });
    const client=new OpenRouterService({apiKey:'test'} as any,capabilities);
    const run=async()=>{const result:any[]=[];for await(const part of client.streamChat(DEFAULT_PROVIDER_MODEL_ID,[{role:'user',content:'test'}],1000,{reasoningLevel:'low'} as any))result.push(part);return result;};
    const before=await run();await new Promise(r=>setImmediate(r));expect(observed).toHaveLength(0);
    process.env.CODEN_COST_OBSERVABILITY_V1='1';process.env.CODEN_SECRETS_KEY='test';
    const after=await run();await new Promise(r=>setImmediate(r));
    expect(after).toEqual(before);expect(captured[1]).toEqual(captured[0]);
    expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({requested_model:DEFAULT_PROVIDER_MODEL_ID,served_model:DEFAULT_PROVIDER_MODEL_ID,cost_source:'gateway',cost_usd:.002,cached_read_tokens:80,reasoning_tokens:5,result:'succeeded'});
  });
});
describe('economics without touching billing',()=>{
  const s={grossRevenueXaf:12000,creditsIssued:100,creditsConsumed:100,vatRate:.2,paymentFeeRate:.03,paymentFixedXaf:0,refundsXaf:0,disputesXaf:0,xafPerUsd:600,aiCostUsd:10,infrastructureCostUsd:0,servicesCostUsd:0,acquisitionFeeRate:0,fixedCostsXaf:10000};
  it('matches a hand calculation: 12000/1.2 - 360 = 9640; cost 6000',()=>{
    const result=marginScenario(s);expect(result.available).toBe(true);
    if(result.available){expect(result.netRevenueXaf).toBe(9640);expect(result.directCostXaf).toBe(6000);expect(result.grossMargin).toBeCloseTo(3640/9640);expect(result.breakEvenAccounts).toBe(3);}
  });
  it('does not infer zero tax, fees or infrastructure from absent invoices',()=>{
    expect(marginScenario({...s,vatRate:null})).toMatchObject({available:false,missing:['vatRate']});
    expect(invoiceReconciliation(1.64849,null)).toMatchObject({available:false,matched:false});
  });
  it('only reconciles the same-period invoice inside the 5% tolerance',()=>{
    expect(invoiceReconciliation(10,10.4)).toMatchObject({matched:true});
    expect(invoiceReconciliation(10,12)).toMatchObject({matched:false});
    expect(invoiceReconciliation(10,12,2)).toMatchObject({matched:true});
  });
  it.each(ROUTING_MODES)('caps remain observation-only for %s until owner approval',()=>{
    for(const [spend,level] of [[7,70],[9,90],[10,100]])expect(observeCostCeiling(spend,10)).toMatchObject({level,block:false});
    expect(observeCostCeiling(10,10,false,true).block).toBe(false);expect(observeCostCeiling(10,10,true,true).block).toBe(true);
  });
});
describe('frozen client contracts and benchmark gate',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../evals/cost-protected-contract.json',import.meta.url),'utf8'));
  it.each(Object.entries(fixture.files))('keeps %s unchanged, ignoring platform line endings only',(file,hash)=>{
    expect(createHash('sha256').update(readFileSync(new URL(`../../${file}`,import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex')).toBe(hash);
  });
  const reference=JSON.parse(readFileSync(new URL('../../evals/reference-set.json',import.meta.url),'utf8'));
  it('reuses at least 30 reference tasks in each mode, with plan gates unchanged',()=>{
    expect(reference.tasks.length).toBeGreaterThanOrEqual(30);
    for(const mode of ROUTING_MODES)for(const plan of ['free','pro','business'])for(const task of reference.tasks){
      const result=selectModel({task:task.small?'code_edit':'code_generation',plan,mode,credits:10000,complexity:task.small?'simple':'medium'});
      expect(isPlanAtLeast(plan,AI_MODEL_PLAN_ACCESS[result.modelId])).toBe(true);expect(result.decisionMs).toBeLessThan(300);
    }
  });
  it.each(ROUTING_MODES)('an explicit model and reasoning level stay pinned in %s',mode=>{
    for(const plan of ['free','pro','business'])expect(selectModel({task:'conversation',plan,mode,credits:10000,requestedModel:DEFAULT_PROVIDER_MODEL_ID}).modelId).toBe(DEFAULT_PROVIDER_MODEL_ID);
    const model={id:DEFAULT_PROVIDER_MODEL_ID,context_length:200000,top_provider:{max_completion_tokens:32000},supported_parameters:['reasoning']};
    for(const level of REASONING_LEVELS){const body=buildOpenRouterRequest(model,level,[{role:'user',content:'test'}]);expect(body.model).toBe(DEFAULT_PROVIDER_MODEL_ID);if(level==='none')expect(body.reasoning).toMatchObject({enabled:false});}
  });
  const rows=(real=true):BenchmarkRow[]=>ROUTING_MODES.flatMap(mode=>Array.from({length:32},(_,i)=>({taskId:String(i),mode,success:true,quality:90,latencyMs:100,costUsd:1,realExecution:real})));
  const gate={ownerApproved:true,qualityNoise:0,latencyNoiseRatio:0,successNoise:0};
  it('rejects synthetic tests, insufficient tasks and unapproved thresholds',()=>{
    expect(evaluateOptimization(rows(false),rows(false),gate).eligible).toBe(false);
    expect(evaluateOptimization(rows(),rows().slice(1),gate).eligible).toBe(false);
    expect(evaluateOptimization(rows(),rows(),{...gate,ownerApproved:false}).eligible).toBe(false);
  });
  it('requests rollback per mode if cheaper work loses quality or reliability',()=>{
    const after=rows().map((r,i)=>({...r,costUsd:.5,...(i===0?{quality:0}: {})}));
    expect(evaluateOptimization(rows(),after,gate)).toMatchObject({eligible:false,rollback:true});
    expect(evaluateOptimization(rows(),rows().map(r=>({...r,latencyMs:101})),gate).rollback).toBe(true);
    expect(evaluateOptimization(rows(),rows().map(r=>({...r,costUsd:.5})),gate).eligible).toBe(true);
  });
  it('cannot bypass admission with NaN thresholds or equal cost; checks mode promises',()=>{
    const cheap=rows().map(r=>({...r,costUsd:.5}));
    expect(evaluateOptimization(rows(),cheap,{...gate,qualityNoise:NaN}).eligible).toBe(false);
    expect(evaluateOptimization(rows(),rows(),gate).eligible).toBe(false);
    expect(evaluateOptimization(rows(),cheap,{...gate,economyCostRatio:.8}).reasons).toContain('economy:not_distinctly_cheaper');
    expect(evaluateOptimization(rows(),cheap,{...gate,minimumQuality:95}).eligible).toBe(false);
  });
  it('requires the same tasks across modes, not just paired tasks within each mode',()=>{
    const replace=(r:BenchmarkRow)=>({...r,taskId:r.mode==='economy'?`different-${r.taskId}`:r.taskId});
    expect(evaluateOptimization(rows().map(replace),rows().map(replace).map(r=>({...r,costUsd:.5})),gate).reasons).toContain('common_reference_tasks_required');
  });
  const manifest=()=>({schemaVersion:1,referenceVersion:reference.version,measurementKind:'live',deploymentCommit:'a'.repeat(40),plan:'pro',rows:ROUTING_MODES.flatMap(mode=>reference.tasks.map((task:any)=>({taskId:task.id,mode,success:true,quality:90,latencyMs:100,costUsd:1,realExecution:true,costSource:'gateway',iterations:1,errors:0})))});
  it('validates only reference IDs and refuses payload content, synthetic or estimated data',()=>{
    expect(validateCostBenchmarkManifest(manifest(),reference).rows).toHaveLength(reference.tasks.length*3);
    expect(()=>validateCostBenchmarkManifest({...manifest(),prompt:'PRIVATE CONTENT'},reference)).toThrow('INVALID_MANIFEST_FIELDS');
    expect(()=>validateCostBenchmarkManifest({...manifest(),measurementKind:'synthetic'},reference)).toThrow('LIVE_MATCHING_REFERENCE_REQUIRED');
    for(const replacement of [{taskId:'customer-email'},{costSource:'estimated'},{realExecution:false},{errors:NaN},{prompt:'PRIVATE CONTENT'}]) {
      expect(()=>validateCostBenchmarkManifest({...manifest(),rows:manifest().rows.map((r:any,i:number)=>i===0?{...r,...replacement}:r)},reference)).toThrow();
    }
  });
  it('offline validation never authorizes production, even when supplied metrics pass',()=>{
    const before=validateCostBenchmarkManifest(manifest(),reference);
    const after=validateCostBenchmarkManifest({...manifest(),deploymentCommit:'b'.repeat(40),rows:manifest().rows.map((r:any)=>({...r,costUsd:.5}))},reference);
    const policy=validateCostBenchmarkPolicy(gate);
    expect(evaluateCostBenchmarkManifests(before,after,policy)).toMatchObject({candidatePassesSuppliedMeasurements:true,eligibleForProduction:false,independentEvidenceVerificationRequired:true,activationPerformed:false});
    expect(()=>evaluateCostBenchmarkManifests(before,{...after,plan:'free'},policy)).toThrow('MATCHING_PLAN_AND_REFERENCE_REQUIRED');
    expect(()=>validateCostBenchmarkPolicy({...gate,qualityNoise:'0'})).toThrow('INVALID_POLICY_THRESHOLDS');
  });
  it('recommends rollback for errors even if the final task succeeds',()=>{
    const before=validateCostBenchmarkManifest(manifest(),reference);
    const after=validateCostBenchmarkManifest({...manifest(),rows:manifest().rows.map((r:any)=>({...r,costUsd:.5,errors:1}))},reference);
    expect(evaluateCostBenchmarkManifests(before,after,gate)).toMatchObject({candidatePassesSuppliedMeasurements:false,rollbackRecommended:true,activationPerformed:false});
  });
});
