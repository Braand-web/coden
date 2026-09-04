import { describe, it, expect, vi } from 'vitest';
import { OpenRouterCapabilities, enforceModelCapabilities, type CatalogModel } from './openrouter-capabilities';
import { readProviderSse } from './provider-sse';
import { selectModel } from './model-selection';
import { runLlmToolLoop } from './llm-tool-loop';
import { validateProject } from './sandbox/validate';

const model:CatalogModel = { id:'test',context_length:10000,supported_parameters:['tools','reasoning','response_format'],architecture:{input_modalities:['text','image']},top_provider:{max_completion_tokens:1000} };
describe('OpenRouter-only capability contract', () => {
  it('preserves required tools, reasoning and structured output without unsupported sampling', () => {
    const payload = enforceModelCapabilities(model,{tools:[{}],tool_choice:'auto',temperature:.6,reasoning:{effort:'high'},response_format:{type:'json_object'},max_tokens:500});
    expect(payload.tools).toEqual([{}]); expect(payload.reasoning.effort).toBe('high'); expect(payload.temperature).toBeUndefined(); expect(payload.tool_choice).toBeUndefined(); expect(payload.provider.require_parameters).toBe(true);
  });
  it('refuses unsupported capabilities, modalities and output limits', () => {
    expect(() => enforceModelCapabilities({...model,supported_parameters:[]},{tools:[{}]})).toThrow('tools');
    expect(() => enforceModelCapabilities(model,{messages:[{content:[{type:'input_audio'}]}]})).toThrow('input_audio');
    expect(() => enforceModelCapabilities(model,{max_tokens:1001})).toThrow('limit');
  });
  it('singleflights catalog requests and refuses unavailable models', async () => {
    const request=vi.fn(async () => new Response(JSON.stringify({data:[model]}))) as any;
    const catalog=new OpenRouterCapabilities(request);
    await Promise.all([catalog.get('test'),catalog.get('test')]); expect(request).toHaveBeenCalledTimes(1);
    await expect(catalog.get('astra')).rejects.toMatchObject({diagnosticCode:'MODEL_UNAVAILABLE'});
  });
  it('fails closed on catalog outage when nothing was ever known', async () => {
    const catalog=new OpenRouterCapabilities(vi.fn(async()=>new Response('',{status:503})) as any);
    await expect(catalog.get('test')).rejects.toMatchObject({diagnosticCode:'MODEL_CATALOG_UNAVAILABLE'});
  });
  /*
   * Every provider call passes through this catalog, so throwing on a failed
   * refresh made an OpenRouter blip a total product outage — while a good
   * catalog sat in memory, discarded for being five minutes old. Capabilities
   * change on the order of weeks. Serving the one we have beats serving none.
   */
  it('keeps serving the last known catalog when a refresh fails', async () => {
    let fail=false;
    const request=vi.fn(async()=>fail?new Response('',{status:503}):new Response(JSON.stringify({data:[model]}))) as any;
    const catalog=new OpenRouterCapabilities(request,0);
    expect((await catalog.get('test')).id).toBe('test');
    fail=true;
    expect((await catalog.get('test')).id).toBe('test');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not retry a catalog that is down on every single request', async () => {
    const request=vi.fn(async()=>new Response(JSON.stringify({data:[model]}))) as any;
    const catalog=new OpenRouterCapabilities(request,0);
    await catalog.get('test');
    request.mockImplementation(async()=>new Response('',{status:503}));
    await catalog.get('test'); await catalog.get('test'); await catalog.get('test');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('stops serving a catalog that has gone stale beyond its grace', async () => {
    let fail=false;
    const request=vi.fn(async()=>fail?new Response('',{status:503}):new Response(JSON.stringify({data:[model]}))) as any;
    const catalog=new OpenRouterCapabilities(request,0,0);
    await catalog.get('test');
    fail=true;
    await expect(catalog.get('test')).rejects.toMatchObject({diagnosticCode:'MODEL_CATALOG_UNAVAILABLE'});
  });
  it('routes by role and refuses a task that cannot meet its capability constraints', () => {
    expect(selectModel({task:'conversation',plan:'enterprise'}).modelId).toBe('openai/gpt-5.6-luna');
    expect(selectModel({task:'architecture',plan:'enterprise'}).modelId).toBe('openai/gpt-5.6-sol');
    expect(selectModel({task:'classification',needs:{vision:true},plan:'enterprise'}).modelId).toBe('google/gemini-3.8-flash');
    expect(() => selectModel({task:'architecture',estimatedInputTokens:100000000,plan:'enterprise'})).toThrow('No eligible');
  });
});
async function* bytes(text:string) { for(const byte of new TextEncoder().encode(text)) yield new Uint8Array([byte]); }
describe('provider stream framing',()=>{
  it('preserves split Unicode, CRLF, comments and multiline data',async()=>{
    const output=[]; for await(const value of readProviderSse(bytes(': heartbeat\r\ndata: {"text":\r\ndata: "Créé 🌍"}\r\n\r\ndata: [DONE]\r\n\r\n'))) output.push(value);
    expect(JSON.parse(output[0])).toEqual({text:'Créé 🌍'}); expect(output[1]).toBe('[DONE]');
  });
  it('refuses an unterminated frame',async()=>{
    await expect((async()=>{for await(const _ of readProviderSse(bytes('data: {"text":"unfinished"}'))) { /* consume */ }})()).rejects.toThrow('TRUNCATED');
  });
});
describe('tool and validation truthfulness',()=>{
  it('never executes malformed arguments and records handler failure',async()=>{
    const handler=vi.fn(async()=>({ok:false,error:'failed'})); let turn=0;
    const gateway={chat:vi.fn(async()=> ++turn===1 ? {text:'',tool_calls:[{id:'a',function:{name:'read_file',arguments:'{"bad"'}},{id:'b',function:{name:'read_file',arguments:'{"path":"app.ts"}'}}]} : {text:'done'})};
    const result=await runLlmToolLoop({gateway:gateway as any,modelId:'test',messages:[],handlers:{read_file:handler}});
    expect(handler).toHaveBeenCalledTimes(1); expect(result.toolExecutions.every(e=>!e.ok)).toBe(true);
  });
  it('does not pass validation when process execution fails',async()=>{
    const sandbox={status:()=>({state:'idle'}),hasFile:async()=>true,readProjectFile:async()=>'{"scripts":{"typecheck":"tsc"}}',runCommand:async()=>{throw new Error('spawn failed');}};
    expect((await validateProject(sandbox as any)).ok).toBe(false);
  });
  it('actually invokes the build without --if-present',async()=>{
    const runCommand=vi.fn(async()=>({code:0,output:''}));
    const sandbox={status:()=>({state:'idle'}),hasFile:async()=>true,readProjectFile:async()=>'{"scripts":{"build":"vite build"}}',runCommand};
    const report=await validateProject(sandbox as any);
    expect(report.ran.build).toBe(true); expect(report.ran.typecheck).toBe(false);
    expect(runCommand.mock.calls.some((call:any)=>call[1].join(' ')==='run build')).toBe(true);
  });
});
