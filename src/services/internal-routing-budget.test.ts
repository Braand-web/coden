import { describe,expect,it } from 'vitest';
import { buildOpenRouterRequest } from './openrouter-request.ts';
import type { CatalogModel } from './openrouter-capabilities.ts';
import { readFileSync } from 'node:fs';

const model:CatalogModel={id:'test/router',context_length:200000,
  top_provider:{max_completion_tokens:65536},supported_parameters:['reasoning','response_format'],
  pricing:{prompt:0.000001,completion:0.000005}};
const messages=[{role:'user' as const,content:'Create an appointment application.'}];
describe('Coden-funded intent router exception',()=>{
  it('bounds one call including purchase fees without capping customer calls',()=>{
    const normal:any=buildOpenRouterRequest(model,'high',messages);
    const router:any=buildOpenRouterRequest(model,'low',messages,{internalRoutingBudgetUsd:0.05});
    expect(normal.max_tokens).toBe(65536);expect(normal.provider.max_price).toBeUndefined();
    expect(router.max_tokens).toBeLessThanOrEqual(4096);
    expect(router.provider.max_price).toEqual({prompt:1,completion:5,request:0});
    expect(router.provider.allow_fallbacks).toBe(false);
    expect(router.messages).toEqual(messages);
    expect(JSON.stringify(router.messages)).not.toContain('cache_control');
    const input=new TextEncoder().encode(JSON.stringify({messages})).length+4096;
    expect((input*0.000001+router.max_tokens*0.000005)*1.055).toBeLessThanOrEqual(0.05);
  });
  it('fails closed for unknown prices, oversized input and extra paid tools',()=>{
    expect(()=>buildOpenRouterRequest({...model,pricing:undefined},'low',messages,{internalRoutingBudgetUsd:0.05})).toThrow();
    expect(()=>buildOpenRouterRequest(model,'low',[{role:'user',content:'x'.repeat(100000)}],{internalRoutingBudgetUsd:0.05})).toThrow();
    expect(()=>buildOpenRouterRequest(model,'low',messages,{internalRoutingBudgetUsd:0.05,webSearch:{}})).toThrow();
  });
  it('allows at most one classification and one repair, with no model override escaping the cap',()=>{
    const source=readFileSync(new URL('../../server.ts',import.meta.url),'utf8');
    const router=source.slice(source.indexOf('async function classifyIntentWithAi('),source.indexOf('function applyTypedIntentLifecycle('));
    expect(router).not.toContain('runtimeConfigForModel');expect(router).not.toMatch(/maxAttempts: 2|allowFallback: true/);
    expect(router).toContain('internalRoutingBudgetUsd: 0.05');
    expect(router.match(/await providerGateway.chat\(/g)).toHaveLength(2);
    const generation=source.slice(source.indexOf("app.post('/api/projects/:id/generate'"));
    expect(generation.indexOf('pipelineReservation = await reserveUnifiedUsage')).toBeLessThan(generation.indexOf('await prepareGenerationAttachments();'));
  });
});
